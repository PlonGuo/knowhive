//! TS/bun sidecar lifecycle for the Tauri shell.
//!
//! The decision-making pieces (arg building, restart policy, port discovery) are
//! unit-tested; the process/HTTP I/O orchestration is thin glue verified by the
//! end-to-end gate. In dev the sidecar is the `server/` bun project; in a packaged
//! build it will be the `bun build --compile` single binary (Phase F).

/// Build the `bun` invocation args. In dev the sidecar is launched from the server
/// dir as `bun run src/index.ts --port <port> --data-dir <dataDir>`.
pub fn build_args(port: u16, data_dir: &str) -> Vec<String> {
    vec![
        "run".into(),
        "src/index.ts".into(),
        "--port".into(),
        port.to_string(),
        "--data-dir".into(),
        data_dir.into(),
    ]
}

/// Release invocation: the bundled bun runtime (Tauri externalBin, next to the app
/// executable) runs the pre-bundled `index.js` from resources (Phase F, Path C).
pub fn release_spawn_args(server_dir: &std::path::Path, port: u16, data_dir: &str) -> Vec<String> {
    vec![
        server_dir.join("index.js").to_string_lossy().into_owned(),
        "--port".into(),
        port.to_string(),
        "--data-dir".into(),
        data_dir.into(),
    ]
}

/// Tracks crash-restart attempts. Mirrors Electron's `handleCrash` counter:
/// restart while `count <= max`, give up once it exceeds `max`.
pub struct RestartPolicy {
    count: u32,
    max: u32,
}

impl RestartPolicy {
    pub fn new(max: u32) -> Self {
        Self { count: 0, max }
    }

    /// Record a crash and report whether another restart should be attempted.
    pub fn should_restart(&mut self) -> bool {
        self.count += 1;
        self.count <= self.max
    }

    pub fn count(&self) -> u32 {
        self.count
    }
}

/// Find a free TCP port in the sidecar range [18200, 18300). Mirrors `port.ts`.
pub fn find_sidecar_port() -> Option<u16> {
    find_port_in_range(18200, 18300)
}

/// Find the first bindable TCP port in `[start, end)` on localhost.
fn find_port_in_range(start: u16, end: u16) -> Option<u16> {
    (start..end).find(|&port| std::net::TcpListener::bind(("127.0.0.1", port)).is_ok())
}

// ---------------------------------------------------------------------------
// Orchestration (I/O glue): spawn the bun sidecar process, poll /health,
// auto-restart on crash, and stop it gracefully on exit.
// Verified by the end-to-end gate (`pnpm tauri:dev`), not unit tests.
// ---------------------------------------------------------------------------

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_MAX_RESTARTS: u32 = 3;
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(200);
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(15);
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Stopped,
    Starting,
    Running,
    Failed,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Stopped => "stopped",
            Status::Starting => "starting",
            Status::Running => "running",
            Status::Failed => "failed",
        }
    }
}

struct Shared {
    port: Option<u16>,
    status: Status,
    stopping: bool,
    pid: Option<u32>,
}

/// Manages the bun sidecar process for the lifetime of the app.
#[derive(Clone)]
pub struct SidecarManager {
    shared: Arc<Mutex<Shared>>,
    server_dir: PathBuf,
    data_dir: PathBuf,
    max_restarts: u32,
}

impl SidecarManager {
    pub fn new(server_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            shared: Arc::new(Mutex::new(Shared {
                port: None,
                status: Status::Stopped,
                stopping: false,
                pid: None,
            })),
            server_dir,
            data_dir,
            max_restarts: DEFAULT_MAX_RESTARTS,
        }
    }

    pub fn backend_url(&self) -> Option<String> {
        self.shared
            .lock()
            .unwrap()
            .port
            .map(|p| format!("http://127.0.0.1:{p}"))
    }

    pub fn status(&self) -> Status {
        self.shared.lock().unwrap().status
    }

    /// Find a port, spawn the sidecar, and launch a monitor thread that flips the
    /// status to Running once `/health` responds and restarts the process on crash.
    pub fn start(&self) {
        let port = match find_sidecar_port() {
            Some(p) => p,
            None => {
                self.shared.lock().unwrap().status = Status::Failed;
                return;
            }
        };
        {
            let mut s = self.shared.lock().unwrap();
            s.port = Some(port);
            s.status = Status::Starting;
            s.stopping = false;
        }

        let shared = self.shared.clone();
        let server_dir = self.server_dir.clone();
        let data_dir = self.data_dir.clone();
        let max_restarts = self.max_restarts;

        thread::spawn(move || {
            let mut restart = RestartPolicy::new(max_restarts);
            loop {
                let mut child = match spawn_child(&server_dir, port, &data_dir) {
                    Ok(c) => c,
                    Err(err) => {
                        eprintln!("[sidecar] spawn error: {err}");
                        shared.lock().unwrap().status = Status::Failed;
                        return;
                    }
                };
                shared.lock().unwrap().pid = Some(child.id());

                // Poll /health until ready (or timeout / stop request).
                let started = Instant::now();
                loop {
                    if shared.lock().unwrap().stopping {
                        break;
                    }
                    if health_ok(port) {
                        shared.lock().unwrap().status = Status::Running;
                        break;
                    }
                    if started.elapsed() >= HEALTH_POLL_TIMEOUT {
                        break;
                    }
                    thread::sleep(HEALTH_POLL_INTERVAL);
                }

                // Block until the process exits.
                let _ = child.wait();

                if shared.lock().unwrap().stopping {
                    shared.lock().unwrap().status = Status::Stopped;
                    return;
                }

                // Unexpected exit → restart per policy.
                if restart.should_restart() {
                    eprintln!(
                        "[sidecar] crashed, restarting (attempt {}/{})",
                        restart.count(),
                        max_restarts
                    );
                    shared.lock().unwrap().status = Status::Starting;
                    continue;
                } else {
                    eprintln!("[sidecar] exceeded max restarts ({max_restarts})");
                    shared.lock().unwrap().status = Status::Failed;
                    return;
                }
            }
        });
    }

    /// Gracefully stop the sidecar: SIGTERM, then SIGKILL after a timeout.
    pub fn stop(&self) {
        let pid = {
            let mut s = self.shared.lock().unwrap();
            s.stopping = true;
            s.pid
        };
        if let Some(pid) = pid {
            terminate(pid);
            let started = Instant::now();
            while process_alive(pid) {
                if started.elapsed() >= GRACEFUL_STOP_TIMEOUT {
                    kill(pid);
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
        self.shared.lock().unwrap().status = Status::Stopped;
    }
}

fn spawn_child(server_dir: &Path, port: u16, data_dir: &Path) -> std::io::Result<Child> {
    let data_dir_str = data_dir.to_string_lossy();
    // Dev: system bun runs the TS sources. Release: the bundled bun runtime (Tauri
    // externalBin, placed next to the app executable) runs the resources bundle.
    let (program, args) = if cfg!(debug_assertions) {
        ("bun".into(), build_args(port, &data_dir_str))
    } else {
        let bundled_bun = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("bun")))
            .unwrap_or_else(|| PathBuf::from("bun"));
        (bundled_bun, release_spawn_args(server_dir, port, &data_dir_str))
    };
    Command::new(program)
        .args(&args)
        .current_dir(server_dir)
        .stdin(Stdio::null())
        // Inherit stdout/stderr so sidecar logs surface in the `tauri dev` console.
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
}

fn health_ok(port: u16) -> bool {
    ureq::get(&format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_millis(500))
        .call()
        .map(|r| r.status() == 200)
        .unwrap_or(false)
}

#[cfg(unix)]
fn terminate(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

#[cfg(unix)]
fn kill(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    // signal 0 probes existence without delivering a signal.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn terminate(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .output();
}

#[cfg(windows)]
fn kill(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

#[cfg(windows)]
fn process_alive(_pid: u32) -> bool {
    // Best-effort on Windows: taskkill /T already requested termination.
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn build_args_matches_bun_invocation() {
        let args = build_args(18250, "/data/dir");
        assert_eq!(
            args,
            vec![
                "run",
                "src/index.ts",
                "--port",
                "18250",
                "--data-dir",
                "/data/dir"
            ]
        );
    }

    #[test]
    fn release_args_run_the_bundled_entrypoint() {
        let args = release_spawn_args(Path::new("/res/server"), 18250, "/data/dir");
        assert_eq!(
            args,
            vec![
                "/res/server/index.js",
                "--port",
                "18250",
                "--data-dir",
                "/data/dir"
            ]
        );
    }

    #[test]
    fn restart_policy_allows_up_to_max_then_stops() {
        let mut p = RestartPolicy::new(3);
        assert!(p.should_restart(), "1st crash should restart");
        assert!(p.should_restart(), "2nd crash should restart");
        assert!(p.should_restart(), "3rd crash should restart");
        assert!(!p.should_restart(), "4th crash exceeds max, should give up");
        assert_eq!(p.count(), 4);
    }

    #[test]
    fn find_sidecar_port_returns_port_in_range() {
        let port = find_sidecar_port().expect("a port should be available");
        assert!((18200..18300).contains(&port));
    }

    #[test]
    fn find_port_in_range_skips_occupied_ports() {
        // Use an isolated range so this never races other tests on the 18200 port.
        let occupied = TcpListener::bind(("127.0.0.1", 18950)).expect("bind 18950");
        let port = find_port_in_range(18950, 18960).expect("a port should be available");
        assert_ne!(port, 18950, "should skip the occupied port");
        assert!((18950..18960).contains(&port));
        drop(occupied);
    }
}

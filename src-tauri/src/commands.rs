use crate::sidecar::SidecarManager;
use serde::Serialize;
use std::process::Command;
use tauri::State;

/// Result of the system dependency probe. Mirrors Electron's `check-setup` IPC shape.
#[derive(Serialize)]
pub struct SetupStatus {
    pub uv_ok: bool,
}

/// Backend base URL the renderer should talk to.
///
/// Honors `BACKEND_URL` (set by the dev flow that runs uvicorn separately); otherwise
/// returns the URL of the Rust-managed sidecar, falling back to the default dev port.
#[tauri::command]
pub fn get_backend_url(manager: State<SidecarManager>) -> String {
    if let Ok(url) = std::env::var("BACKEND_URL") {
        return url;
    }
    manager
        .backend_url()
        .unwrap_or_else(|| "http://127.0.0.1:18200".to_string())
}

/// Current sidecar lifecycle status ("stopped" | "starting" | "running" | "failed").
#[tauri::command]
pub fn get_sidecar_status(manager: State<SidecarManager>) -> String {
    manager.status().as_str().to_string()
}

/// Probe whether required system tools are available. Mirrors Electron's
/// `checkCommand('uv', ['--version'])`.
#[tauri::command]
pub fn check_setup() -> SetupStatus {
    let uv_ok = Command::new("uv")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    SetupStatus { uv_ok }
}

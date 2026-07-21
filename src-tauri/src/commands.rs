use crate::sidecar::SidecarManager;
use tauri::State;

/// Backend base URL the renderer should talk to.
///
/// Honors `BACKEND_URL` (set by the dev flow that runs the sidecar separately); otherwise
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

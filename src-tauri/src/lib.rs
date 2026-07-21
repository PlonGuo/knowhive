mod commands;
mod sidecar;

use std::path::PathBuf;
use tauri::Manager;

/// Resolve the bun sidecar (`server/`) directory.
/// - dev (debug): the project's `server/` (sibling of `src-tauri/`).
/// - packaged: bundled into the app's resource dir (Phase F switches to the compiled binary).
fn resolve_server_dir(app: &tauri::App) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("server"))
            .unwrap_or_else(|| PathBuf::from("server"))
    } else {
        // tauri.conf `resources: ["resources/server"]` preserves the relative path
        // inside the bundle: Contents/Resources/resources/server/.
        app.path()
            .resource_dir()
            .map(|r| r.join("resources").join("server"))
            .unwrap_or_else(|_| PathBuf::from("server"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let server_dir = resolve_server_dir(app);
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir).ok();

            let manager = sidecar::SidecarManager::new(server_dir, data_dir);
            // The dev flow may run the sidecar externally and pass BACKEND_URL — skip
            // managing our own sidecar in that case.
            if std::env::var("BACKEND_URL").is_err() {
                manager.start();
            }
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_backend_url,
            commands::get_sidecar_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // ExitRequested doesn't fire on every macOS quit path (e.g. Apple Events);
            // Exit is the last-chance hook. stop() is idempotent, so handling both is safe.
            // The sidecar also self-terminates when orphaned (see index.ts watchdog).
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    if let Some(manager) = app_handle.try_state::<sidecar::SidecarManager>() {
                        manager.stop();
                    }
                }
                _ => {}
            }
        });
}

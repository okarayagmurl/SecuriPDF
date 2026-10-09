fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_shell_config",
            "set_server_url",
            "local_engine_status",
            "run_local_tool",
        ]),
    ))
    .expect("tauri build failed");
}

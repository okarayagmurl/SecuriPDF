fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "local_engine_status",
            "run_local_tool",
            "save_output",
            "take_opened_files",
            "read_opened_file",
            "html_to_pdf",
        ]),
    ))
    .expect("tauri build failed");
}

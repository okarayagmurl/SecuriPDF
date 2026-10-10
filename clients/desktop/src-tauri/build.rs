fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "local_engine_status",
            "run_local_tool",
            "local_engine_get",
            "save_output",
            "take_opened_files",
            "read_opened_file",
            "html_to_pdf",
            "office_convert",
            "cli_job",
            "cli_start_engine",
            "cli_finish",
            "shell_menu_status",
            "shell_menu_set",
        ]),
    ))
    .expect("tauri build failed");
}

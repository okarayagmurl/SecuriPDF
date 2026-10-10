mod cli;
mod engine;
mod office;
mod print;
mod qpdf;
mod shell_menu;

use engine::{is_local_api_path, Engine, EngineFiles, EngineStatus};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const HEADER_API_PATH: &str = "x-securipdf-api-path";
const HEADER_CONTENT_TYPE: &str = "x-securipdf-content-type";
const HEADER_FILE_NAME: &str = "x-securipdf-file-name";
const LOCAL_TIMEOUT: Duration = Duration::from_secs(900);
const OPENED_EVENT: &str = "securipdf-opened";

#[derive(Default)]
struct Opened(Mutex<OpenedFiles>);

#[derive(Default)]
struct OpenedFiles {
    pending: Vec<PathBuf>,
    readable: HashSet<PathBuf>,
}

/// The folder the user picked for batch results; the page can only write there.
#[derive(Default)]
struct OutputFolder(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    name: String,
}

impl OpenedFile {
    fn from_path(path: &Path) -> Self {
        Self {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.display().to_string(),
        }
    }
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let cli = cli::requested(&args).then(|| command_line(&args));
    let is_cli = cli.is_some();
    let mut builder = tauri::Builder::default()
        .manage(Engine::new())
        .manage(Opened::default())
        .manage(OutputFolder::default());
    builder = match cli {
        Some(cli) => builder.manage(cli),
        None => builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main(app);
            if remember_pdfs(app, &args) {
                let _ = app.emit(OPENED_EVENT, ());
            }
        })),
    };
    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if let Some(cli) = app.try_state::<cli::Cli>() {
                let inputs = cli.inputs().unwrap_or_default();
                if let Ok(mut files) = app.state::<Opened>().0.lock() {
                    files.readable.extend(inputs);
                }
                cli::watch(app.handle().clone());
            } else {
                remember_pdfs(app.handle(), &args);
            }
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
            if is_cli {
                // A WebView2 profile already open with other options would refuse a second browser.
                if let Ok(dir) = app.path().app_local_data_dir() {
                    window = window.data_directory(dir.join("cli-webview"));
                }
            }
            window
                .visible(!is_cli)
                .title("SecuriPDF")
                .inner_size(1180.0, 780.0)
                .min_inner_size(820.0, 560.0)
                .disable_drag_drop_handler()
                .on_navigation(|url| is_app_url(url.scheme(), url.host_str()))
                .on_web_resource_request(|request, response| {
                    if let Some(mime) = asset_mime(request.uri().path()) {
                        response.headers_mut().insert(
                            tauri::http::header::CONTENT_TYPE,
                            tauri::http::HeaderValue::from_static(mime),
                        );
                    }
                })
                .build()?;
            if !is_cli {
                start_engine(app.handle(), "engine");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_engine_status,
            run_local_tool,
            local_engine_get,
            save_output,
            choose_output_folder,
            save_into_folder,
            take_opened_files,
            read_opened_file,
            print::html_to_pdf,
            office::office_convert,
            qpdf::repair_pdf,
            cli::cli_job,
            cli::cli_start_engine,
            cli::cli_finish,
            shell_menu::shell_menu_status,
            shell_menu::shell_menu_set
        ])
        .build(tauri::generate_context!())
        .expect("SecuriPDF başlatılamadı")
        .run(move |app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().stop();
                if is_cli {
                    remove_cli_engine_dir(app);
                }
            }
        });
}

/// Parses the command line, or prints why it cannot run and exits.
fn command_line(args: &[String]) -> cli::Cli {
    let as_json = args.iter().any(|arg| arg == "--json");
    let fail = |code: i32, kind: &str, message: String| -> ! {
        let report = serde_json::json!({ "ok": false, "code": kind, "message": message });
        cli::print(as_json, code, &report, &format!("Hata: {message}\n\n{}", cli::HELP));
        std::process::exit(code);
    };
    let options = match cli::parse(args) {
        Ok(options) => options,
        Err(message) => fail(cli::EXIT_USAGE, "USAGE", message),
    };
    if options.help {
        cli::print(false, 0, &serde_json::Value::Null, cli::HELP);
        std::process::exit(0);
    }
    if let Err(message) = cli::resolve_inputs(&options.inputs) {
        fail(cli::EXIT_INPUT, "INPUT", message);
    }
    cli::wait_for_turn();
    cli::Cli::new(options)
}

fn remove_cli_engine_dir(app: &AppHandle) {
    let Ok(dir) = app
        .path()
        .app_local_data_dir()
        .map(|dir| dir.join(format!("engine-cli-{}", std::process::id())))
    else {
        return;
    };
    // The engine's files stay locked for a moment after it is killed.
    for _ in 0..10 {
        if !dir.exists() || std::fs::remove_dir_all(&dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn is_app_url(scheme: &str, host: Option<&str>) -> bool {
    match scheme {
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => host == Some("tauri.localhost"),
        _ => false,
    }
}

/// Tauri sniffs bundled files by content first, and `infer` reports any file
/// with "%PDF" in its first 1024 bytes as a PDF, which WebView2 then refuses
/// to run as a module script.
fn asset_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "html" => "text/html",
        "wasm" => "application/wasm",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

#[tauri::command]
fn local_engine_status(engine: tauri::State<'_, Engine>) -> EngineStatus {
    engine.status()
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

#[tauri::command]
async fn run_local_tool(
    request: Request<'_>,
    engine: tauri::State<'_, Engine>,
) -> Result<Response, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("LOCAL_BAD_REQUEST".into());
    };
    let api_path = header(&request, HEADER_API_PATH).ok_or("LOCAL_BAD_REQUEST")?;
    let content_type = header(&request, HEADER_CONTENT_TYPE).ok_or("LOCAL_BAD_REQUEST")?;
    if !is_local_api_path(&api_path) || !content_type.starts_with("multipart/form-data; boundary=")
    {
        return Err("LOCAL_BAD_REQUEST".into());
    }
    let base = engine.base_url().ok_or("LOCAL_ENGINE_NOT_READY")?;
    let resp = reqwest::Client::new()
        .post(format!("{base}{api_path}"))
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body.clone())
        .timeout(LOCAL_TIMEOUT)
        .send()
        .await
        .map_err(|_| "LOCAL_ENGINE_UNREACHABLE".to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(http_error(resp).await);
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| "LOCAL_ENGINE_UNREACHABLE".to_string())?;
    if bytes.is_empty() {
        return Err("LOCAL_EMPTY_OUTPUT".into());
    }
    Ok(Response::new(bytes.to_vec()))
}

/// Read-only engine queries, such as the certificates usable for signing.
#[tauri::command]
async fn local_engine_get(
    api_path: String,
    engine: tauri::State<'_, Engine>,
) -> Result<String, String> {
    if !is_local_api_path(&api_path) {
        return Err("LOCAL_BAD_REQUEST".into());
    }
    let base = engine.base_url().ok_or("LOCAL_ENGINE_NOT_READY")?;
    let resp = reqwest::Client::new()
        .get(format!("{base}{api_path}"))
        .timeout(LOCAL_TIMEOUT)
        .send()
        .await
        .map_err(|_| "LOCAL_ENGINE_UNREACHABLE".to_string())?;
    if !resp.status().is_success() {
        return Err(http_error(resp).await);
    }
    resp.text()
        .await
        .map_err(|_| "LOCAL_ENGINE_UNREACHABLE".to_string())
}

/// `LOCAL_HTTP_<status>`, followed by `:<detail>` when the engine explains
/// the failure (wrong keystore password, unknown alias and so on).
async fn http_error(resp: reqwest::Response) -> String {
    let code = format!("LOCAL_HTTP_{}", resp.status().as_u16());
    let body = resp.text().await.unwrap_or_default();
    match engine_error_detail(&body) {
        Some(detail) => format!("{code}:{detail}"),
        None => code,
    }
}

fn engine_error_detail(body: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let detail = ["detail", "message", "error"]
        .iter()
        .filter_map(|key| json.get(key).and_then(|value| value.as_str()))
        .map(str::trim)
        .find(|text| !text.is_empty())?;
    Some(detail.chars().take(300).collect())
}

/// Returns the saved path, or `None` when the user cancels the dialog.
#[tauri::command]
async fn save_output(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Kaydedilecek veri yok.".into());
    };
    let name = header(&request, HEADER_FILE_NAME)
        .map(|raw| safe_file_name(&percent_decode(&raw)))
        .unwrap_or_else(|| "sonuc".into());
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = Path::new(&name).extension().and_then(|ext| ext.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|err| err.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|err| err.to_string())?;
    std::fs::write(&path, body).map_err(|err| format!("Dosya yazılamadı: {err}"))?;
    Ok(Some(path.display().to_string()))
}

/// Returns the chosen folder, or `None` when the user cancels the dialog.
#[tauri::command]
async fn choose_output_folder(
    app: AppHandle,
    folder: tauri::State<'_, OutputFolder>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|err| err.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|err| err.to_string())?;
    let shown = path.display().to_string();
    *folder.0.lock().map_err(|_| "Klasör seçilemedi.")? = Some(path);
    Ok(Some(shown))
}

/// Writes one file into the chosen folder without replacing an existing one.
#[tauri::command]
fn save_into_folder(request: Request<'_>, folder: tauri::State<'_, OutputFolder>) -> Result<String, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Kaydedilecek veri yok.".into());
    };
    let name = header(&request, HEADER_FILE_NAME)
        .map(|raw| safe_file_name(&percent_decode(&raw)))
        .unwrap_or_else(|| "sonuc".into());
    let dir = folder
        .0
        .lock()
        .ok()
        .and_then(|chosen| chosen.clone())
        .ok_or("Önce bir klasör seçin.")?;
    let path = cli::unused_path(&dir.join(name));
    std::fs::write(&path, body).map_err(|err| format!("Dosya yazılamadı: {err}"))?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn take_opened_files(opened: tauri::State<'_, Opened>) -> Vec<OpenedFile> {
    let Ok(mut files) = opened.0.lock() else {
        return Vec::new();
    };
    files.pending.drain(..).map(|path| OpenedFile::from_path(&path)).collect()
}

/// Only files the user opened with the app can be read back.
#[tauri::command]
fn read_opened_file(path: String, opened: tauri::State<'_, Opened>) -> Result<Response, String> {
    let path = PathBuf::from(path);
    let allowed = opened
        .0
        .lock()
        .map(|files| files.readable.contains(&path))
        .unwrap_or(false);
    if !allowed {
        return Err("Bu dosya okunamaz.".into());
    }
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|err| format!("Dosya okunamadı: {err}"))
}

/// Header values must be ASCII, so the page sends the file name URI-encoded.
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn safe_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "sonuc".into()
    } else {
        trimmed
    }
}

fn remember_pdfs(app: &AppHandle, args: &[String]) -> bool {
    let pdfs: Vec<PathBuf> = args
        .iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false)
                && path.is_file()
        })
        .collect();
    if pdfs.is_empty() {
        return false;
    }
    let opened = app.state::<Opened>();
    let Ok(mut files) = opened.0.lock() else {
        return false;
    };
    for path in pdfs {
        files.readable.insert(path.clone());
        files.pending.push(path);
    }
    true
}

fn start_engine(app: &AppHandle, work_dir_name: &str) {
    let engine = app.state::<Engine>().inner().clone();
    let Some(files) = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| EngineFiles::locate(&dir))
    else {
        return;
    };
    let Ok(work_dir) = app.path().app_local_data_dir().map(|dir| dir.join(work_dir_name)) else {
        return;
    };
    match engine.start(files, &work_dir) {
        Ok(port) => {
            tauri::async_runtime::spawn(async move { engine.wait_ready(port).await });
        }
        Err(detail) => engine.fail(&detail),
    }
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::{asset_mime, engine_error_detail, is_app_url, percent_decode, safe_file_name};

    #[test]
    fn engine_errors_keep_their_explanation() {
        assert_eq!(
            engine_error_detail(r#"{"status":400,"detail":"keystore password was incorrect"}"#).as_deref(),
            Some("keystore password was incorrect")
        );
        assert_eq!(engine_error_detail(r#"{"message":" ","error":"Bad Request"}"#).as_deref(), Some("Bad Request"));
        assert_eq!(engine_error_detail("<html>500</html>"), None);
    }

    #[test]
    fn scripts_are_served_by_extension() {
        assert_eq!(asset_mime("/preview.js"), Some("text/javascript"));
        assert_eq!(asset_mime("/vendor/pdfjs/pdf.worker.min.mjs"), Some("text/javascript"));
        assert_eq!(asset_mime("/vendor/pdfjs/wasm/openjpeg.wasm"), Some("application/wasm"));
        assert_eq!(asset_mime("/vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap"), None);
        assert_eq!(asset_mime("/"), None);
    }

    #[test]
    fn turkish_file_names_survive_the_header() {
        assert_eq!(percent_decode("s%C3%B6zle%C5%9Fme_birlesik.pdf"), "sözleşme_birlesik.pdf");
        assert_eq!(percent_decode("100%_bitti"), "100%_bitti");
    }

    #[test]
    fn only_bundled_pages_can_load() {
        assert!(is_app_url("http", Some("tauri.localhost")));
        assert!(is_app_url("tauri", Some("localhost")));
        assert!(!is_app_url("https", Some("example.com")));
        assert!(!is_app_url("file", None));
    }

    #[test]
    fn file_names_cannot_escape_the_dialog() {
        assert_eq!(safe_file_name(r"..\..\evil.pdf"), ".._.._evil.pdf");
        assert_eq!(safe_file_name("rapor_birlesik.pdf"), "rapor_birlesik.pdf");
        assert_eq!(safe_file_name("  ...  "), "sonuc");
    }
}

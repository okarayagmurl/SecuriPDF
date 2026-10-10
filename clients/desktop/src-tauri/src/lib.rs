mod engine;

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

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    name: String,
}

pub fn run() {
    tauri::Builder::default()
        .manage(Engine::new())
        .manage(Opened::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main(app);
            if remember_pdfs(app, &args) {
                let _ = app.emit(OPENED_EVENT, ());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            remember_pdfs(app.handle(), &std::env::args().collect::<Vec<_>>());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
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
            start_engine(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_engine_status,
            run_local_tool,
            save_output,
            take_opened_files,
            read_opened_file
        ])
        .build(tauri::generate_context!())
        .expect("SecuriPDF başlatılamadı")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().stop();
            }
        });
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
        return Err(format!("LOCAL_HTTP_{}", status.as_u16()));
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

#[tauri::command]
fn take_opened_files(opened: tauri::State<'_, Opened>) -> Vec<OpenedFile> {
    let Ok(mut files) = opened.0.lock() else {
        return Vec::new();
    };
    files
        .pending
        .drain(..)
        .map(|path| OpenedFile {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.display().to_string(),
        })
        .collect()
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

fn start_engine(app: &AppHandle) {
    let engine = app.state::<Engine>().inner().clone();
    let Some(files) = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| EngineFiles::locate(&dir))
    else {
        return;
    };
    let Ok(work_dir) = app.path().app_local_data_dir().map(|dir| dir.join("engine")) else {
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
    use super::{asset_mime, is_app_url, percent_decode, safe_file_name};

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

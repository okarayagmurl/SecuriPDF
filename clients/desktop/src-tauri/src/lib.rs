mod engine;
mod policy;

use engine::{is_local_api_path, Engine, EngineFiles, EngineStatus};
use policy::{allows, Policy, ShellConfig};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{CapabilityBuilder, InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const HEADER_API_PATH: &str = "x-securipdf-api-path";
const HEADER_CONTENT_TYPE: &str = "x-securipdf-content-type";
const LOCAL_TIMEOUT: Duration = Duration::from_secs(900);

struct Shell(Arc<Mutex<Policy>>);

pub fn run() {
    let shell = Shell(Arc::new(Mutex::new(Policy::load())));
    let navigation = shell.0.clone();

    tauri::Builder::default()
        .manage(shell)
        .manage(Engine::new())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main(app);
            emit_pdf_args(app, &args);
        }))
        .setup(move |app| {
            let (locked, server_url) = navigation
                .lock()
                .map(|policy| (policy.locked, policy.server_url.clone()))
                .unwrap_or((true, None));
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("SecuriPDF")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .on_navigation({
                let navigation = navigation.clone();
                move |url| {
                    navigation
                        .lock()
                        .map(|policy| allows(url, &policy))
                        .unwrap_or(false)
                }
            })
            .build()?;

            if !locked {
                let change = MenuItem::with_id(
                    app,
                    "change-server",
                    "Sunucu adresi...",
                    true,
                    None::<&str>,
                )?;
                let menu = Menu::with_items(
                    app,
                    &[&Submenu::with_items(app, "SecuriPDF", true, &[&change])?],
                )?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == "change-server" {
                        open_setup(app);
                    }
                });
            }

            start_engine(app.handle());
            emit_pdf_args(app.handle(), &std::env::args().collect::<Vec<_>>());

            if let Some(url) = server_url {
                grant_server(app.handle(), &url)?;
                if let Ok(target) = Url::parse(&url) {
                    let _ = window.navigate(target);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_shell_config,
            set_server_url,
            local_engine_status,
            run_local_tool
        ])
        .build(tauri::generate_context!())
        .expect("SecuriPDF kabuğu başlatılamadı")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().stop();
            }
        });
}

#[tauri::command]
fn get_shell_config(shell: tauri::State<'_, Shell>) -> ShellConfig {
    shell
        .0
        .lock()
        .map(|policy| policy.config())
        .unwrap_or_else(|_| Policy::empty().config())
}

#[tauri::command]
fn set_server_url(
    app: AppHandle,
    shell: tauri::State<'_, Shell>,
    url: String,
    allowed_hosts: Option<Vec<String>>,
) -> Result<(), String> {
    let mut policy = shell.0.lock().map_err(|_| "Kabuk durumu okunamadı.".to_string())?;
    if policy.locked {
        return Err("Sunucu adresi yönetici tarafından kilitli.".into());
    }
    let next = Policy::from_url(&url, false, allowed_hosts.unwrap_or_default())?;
    next.save_user()?;
    *policy = next;
    let target = policy
        .server_url
        .clone()
        .ok_or_else(|| "Sunucu adresi kaydedilemedi.".to_string())?;
    drop(policy);
    grant_server(&app, &target).map_err(|err| err.to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Pencere bulunamadı.".to_string())?;
    window
        .navigate(Url::parse(&target).map_err(|err| err.to_string())?)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn local_engine_status(engine: tauri::State<'_, Engine>) -> EngineStatus {
    engine.status()
}

#[tauri::command]
async fn run_local_tool(
    request: Request<'_>,
    engine: tauri::State<'_, Engine>,
) -> Result<Response, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("LOCAL_BAD_REQUEST".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let api_path = header(HEADER_API_PATH).ok_or("LOCAL_BAD_REQUEST")?;
    let content_type = header(HEADER_CONTENT_TYPE).ok_or("LOCAL_BAD_REQUEST")?;
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

fn grant_server(app: &AppHandle, server_url: &str) -> tauri::Result<()> {
    let id = format!(
        "securipdf-server-{}",
        server_url
            .bytes()
            .map(|b| if b.is_ascii_alphanumeric() { b as char } else { '-' })
            .collect::<String>()
    );
    app.add_capability(
        CapabilityBuilder::new(id)
            .remote(format!("{server_url}/*"))
            .window("main")
            .permission("allow-local-engine-status")
            .permission("allow-run-local-tool"),
    )
}

fn open_setup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(setup) = Url::parse("http://tauri.localhost/index.html") {
            let _ = window.navigate(setup);
        }
        let _ = window.set_focus();
    }
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn emit_pdf_args(app: &AppHandle, args: &[String]) {
    for arg in args.iter().skip(1) {
        let path = Path::new(arg);
        let is_pdf = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);
        if is_pdf && path.exists() {
            let _ = app.emit("securipdf-file", arg.clone());
        }
    }
}

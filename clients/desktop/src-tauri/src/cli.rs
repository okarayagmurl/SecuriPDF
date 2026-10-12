//! Command-line mode for scripts and RPA robots, e.g.
//! `securipdf-desktop.exe --tool ocr-pdf --out C:\cikti\ tarama.pdf`.
//! A hidden main window runs the tool with the same code as the app, so the
//! command line and the window always give the same result.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub const EXIT_TOOL_FAILED: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_ENGINE: i32 = 3;
pub const EXIT_INPUT: i32 = 4;
pub const EXIT_OUTPUT: i32 = 5;
pub const EXIT_TIMEOUT: i32 = 6;
pub const EXIT_LICENSE: i32 = 7;
pub const EXIT_POLICY: i32 = 8;
const JOB_LIMIT: Duration = Duration::from_secs(30 * 60);
const HEADER_STATUS: &str = "x-securipdf-cli-status";
const HEADER_NOTE: &str = "x-securipdf-cli-note";

pub const HELP: &str = "SecuriPDF komut satırı

Kullanım:
  securipdf-desktop.exe --tool <araç> [seçenekler] <girdi> [girdi...]
  securipdf-desktop.exe --list-tools [--json]
  securipdf-desktop.exe --license-status [--json]
  securipdf-desktop.exe --license-activate <dosya.lic>
  securipdf-desktop.exe --policy-status [--json]
  securipdf-desktop.exe --update-status [--json]

Seçenekler:
  --tool <araç>       Çalıştırılacak araç (liste için --list-tools)
  --out <yol>         Çıktı dosyası veya klasörü (verilmezse girdinin yanına yazılır)
  --set <ad>=<değer>  Araç ayarı; birden çok kez verilebilir
  --password <parola> Parolalı girdi için parola
  --json              Sonucu tek satır JSON olarak yaz
  --silent            Hata olsa da pencere gösterme
  --license-status    Lisans / 15 günlük deneme durumunu yaz
  --license-activate  İmzalı .lic dosyasını bu kuruluma yükle
  --policy-status     GPO/SCCM ilkelerini yaz
  --update-status     Kurum içi güncelleme bildirimini yaz

Çıkış kodları:
  0 başarılı, 1 araç hatası, 2 kullanım hatası, 3 PDF motoru açılamadı,
  4 girdi okunamadı, 5 çıktı yazılamadı, 6 zaman aşımı, 7 lisans yok veya süresi doldu, 8 kurum ilkesi reddetti

Komut isteminde bitmesini beklemek için: start \"\" /wait securipdf-desktop.exe ...
PowerShell'de: Start-Process securipdf-desktop.exe -ArgumentList ... -Wait -PassThru
";

#[derive(Debug, Default, PartialEq)]
pub struct Options {
    pub tool: Option<String>,
    pub list_tools: bool,
    pub help: bool,
    pub inputs: Vec<PathBuf>,
    pub params: BTreeMap<String, String>,
    pub out: Option<PathBuf>,
    pub json: bool,
    pub silent: bool,
    pub license_status: bool,
    pub license_activate: Option<PathBuf>,
    pub policy_status: bool,
    pub update_status: bool,
}

/// Command-line mode starts only for these switches, so "Open with" and
/// double-clicking a PDF keep opening the window.
pub fn requested(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| {
        matches!(
            arg.as_str(),
            "--tool"
                | "--list-tools"
                | "--help"
                | "-h"
                | "/?"
                | "--license-status"
                | "--license-activate"
                | "--policy-status"
                | "--update-status"
        )
    })
}

pub fn parse(args: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut rest = args.iter().skip(1);
    while let Some(arg) = rest.next() {
        let mut value = |name: &str| rest.next().cloned().ok_or_else(|| format!("{name} için değer eksik."));
        match arg.as_str() {
            "--tool" => options.tool = Some(value("--tool")?),
            "--out" | "-o" => options.out = Some(PathBuf::from(value("--out")?)),
            "--set" => {
                let pair = value("--set")?;
                let (name, setting) = pair
                    .split_once('=')
                    .filter(|(name, _)| !name.trim().is_empty())
                    .ok_or_else(|| format!("--set ad=değer biçiminde olmalı: {pair}"))?;
                options.params.insert(name.trim().to_string(), setting.to_string());
            }
            "--password" => {
                options.params.insert("password".into(), value("--password")?);
            }
            "--json" => options.json = true,
            "--silent" => options.silent = true,
            "--list-tools" => options.list_tools = true,
            "--license-status" => options.license_status = true,
            "--license-activate" => options.license_activate = Some(PathBuf::from(value("--license-activate")?)),
            "--policy-status" => options.policy_status = true,
            "--update-status" => options.update_status = true,
            "--help" | "-h" | "/?" => options.help = true,
            other if other.starts_with("--") => return Err(format!("Bilinmeyen seçenek: {other}")),
            other => options.inputs.push(PathBuf::from(other)),
        }
    }
    if !options.help
        && !options.list_tools
        && !options.license_status
        && !options.policy_status
        && !options.update_status
        && options.license_activate.is_none()
    {
        if options.tool.is_none() {
            return Err("--tool gerekli.".into());
        }
        if options.inputs.is_empty() {
            return Err("En az bir girdi dosyası verin.".into());
        }
    }
    Ok(options)
}

pub struct Cli {
    pub options: Options,
    started: Instant,
    finished: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    tool: Option<String>,
    list_tools: bool,
    inputs: Vec<crate::OpenedFile>,
    params: BTreeMap<String, String>,
}

impl Cli {
    pub fn new(options: Options) -> Self {
        Self { options, started: Instant::now(), finished: AtomicBool::new(false) }
    }

    pub fn inputs(&self) -> Result<Vec<PathBuf>, String> {
        resolve_inputs(&self.options.inputs)
    }
}

/// Inputs are checked before the window loads so a typo fails at once.
pub fn resolve_inputs(inputs: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    inputs
        .iter()
        .map(|path| {
            let absolute = std::env::current_dir().map(|dir| dir.join(path)).unwrap_or_else(|_| path.clone());
            if absolute.is_file() {
                Ok(absolute)
            } else {
                Err(format!("Girdi bulunamadı: {}", path.display()))
            }
        })
        .collect()
}

/// Explorer starts one process per selected file; running them one at a time
/// keeps a multi-file right-click from starting a PDF engine per file at once.
/// The mutex is released when the process exits.
pub fn wait_for_turn() {
    use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject, INFINITE};
    let name: Vec<u16> = r"Local\SecuriPDF-CLI".encode_utf16().chain(Some(0)).collect();
    let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if !mutex.is_null() {
        unsafe { WaitForSingleObject(mutex, INFINITE) };
    }
}

#[tauri::command]
pub fn cli_job(app: AppHandle) -> Option<Job> {
    let cli = app.try_state::<Cli>()?;
    let inputs = cli.inputs().ok()?;
    Some(Job {
        tool: cli.options.tool.clone(),
        list_tools: cli.options.list_tools,
        inputs: inputs.iter().map(|path| crate::OpenedFile::from_path(path)).collect(),
        params: cli.options.params.clone(),
    })
}

/// The engine is started on demand: UDF and Office jobs do not need it.
#[tauri::command]
pub fn cli_start_engine(app: AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if app.try_state::<Cli>().is_some() && !STARTED.swap(true, Ordering::SeqCst) {
        crate::start_engine(&app, &format!("engine-cli-{}", std::process::id()));
    }
}

#[tauri::command]
pub async fn cli_finish(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let Some(cli) = app.try_state::<Cli>() else {
        return Err("CLI_NOT_ACTIVE".into());
    };
    let InvokeBody::Raw(body) = request.body() else {
        return Err("CLI_BAD_REQUEST".into());
    };
    let status = crate::header(&request, HEADER_STATUS).unwrap_or_default();
    let seconds = (cli.started.elapsed().as_secs_f64() * 10.0).round() / 10.0;
    let (code, report, text) = match status.as_str() {
        "ok" => {
            let name = crate::header(&request, crate::HEADER_FILE_NAME)
                .map(|raw| crate::safe_file_name(&crate::percent_decode(&raw)))
                .unwrap_or_else(|| "sonuc".into());
            let note = crate::header(&request, HEADER_NOTE).map(|raw| crate::percent_decode(&raw));
            let first = cli.inputs().ok().and_then(|inputs| inputs.into_iter().next());
            let target = output_path(cli.options.out.as_deref(), first.as_deref(), &name);
            match write_output(&target, body) {
                Ok(()) => (
                    0,
                    json!({ "ok": true, "tool": cli.options.tool, "output": target, "bytes": body.len(), "seconds": seconds, "note": note }),
                    format!("Tamam: {} ({} bayt, {seconds} sn)", target.display(), body.len()),
                ),
                Err(err) => (
                    EXIT_OUTPUT,
                    json!({ "ok": false, "code": "OUTPUT", "message": err }),
                    format!("Hata: {err}"),
                ),
            }
        }
        "list" => {
            let tools: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let lines: Vec<String> = tools
                .as_array()
                .map(|items| {
                    items.iter().map(|tool| format!("{:<22} {}", tool["id"].as_str().unwrap_or(""), tool["title"].as_str().unwrap_or(""))).collect()
                })
                .unwrap_or_default();
            (0, json!({ "ok": true, "tools": tools }), lines.join("\n"))
        }
        _ => {
            let error: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let kind = error["code"].as_str().unwrap_or("TOOL").to_string();
            let message = error["message"].as_str().unwrap_or("İşlem başarısız.").to_string();
            (
                exit_code_for(&kind),
                json!({ "ok": false, "tool": cli.options.tool, "code": kind, "message": message, "seconds": seconds }),
                format!("Hata: {message}"),
            )
        }
    };
    finish(&app, code, &report, &text).await;
    Ok(())
}

fn exit_code_for(kind: &str) -> i32 {
    match kind {
        "USAGE" | "UNKNOWN_TOOL" | "UNKNOWN_PARAM" | "INVALID" => EXIT_USAGE,
        "ENGINE" => EXIT_ENGINE,
        "INPUT" => EXIT_INPUT,
        "LICENSE" | "LICENSE_EXPIRED" | "LICENSE_REQUIRED" => EXIT_LICENSE,
        "POLICY_GROUP" | "POLICY_TOOL" => EXIT_POLICY,
        _ => EXIT_TOOL_FAILED,
    }
}

/// Prints the result once, shows errors unless `--silent`, and exits.
pub async fn finish(app: &AppHandle, code: i32, report: &Value, text: &str) {
    let Some(cli) = app.try_state::<Cli>() else {
        return;
    };
    if cli.finished.swap(true, Ordering::SeqCst) {
        return;
    }
    print(cli.options.json, code, report, text);
    if code != 0 && !cli.options.silent {
        let dialog = app
            .dialog()
            .message(report["message"].as_str().unwrap_or(text).to_string())
            .title("SecuriPDF")
            .kind(MessageDialogKind::Error);
        let _ = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await;
    }
    app.exit(code);
}

pub fn print(as_json: bool, code: i32, report: &Value, text: &str) {
    attach_console();
    if as_json {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{report}");
        let _ = out.flush();
    } else if code == 0 {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{text}");
        let _ = out.flush();
    } else {
        let _ = writeln!(std::io::stderr(), "{text}");
    }
}

/// Gives up on a job the window never reports, so a robot is not stuck forever.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(JOB_LIMIT);
        let report = json!({ "ok": false, "code": "TIMEOUT", "message": "İşlem 30 dakikada bitmedi." });
        tauri::async_runtime::block_on(finish(&app, EXIT_TIMEOUT, &report, "Hata: İşlem 30 dakikada bitmedi."));
    });
}

fn output_path(out: Option<&Path>, first_input: Option<&Path>, name: &str) -> PathBuf {
    match out {
        Some(path) if path.is_dir() || path.as_os_str().to_string_lossy().ends_with(['\\', '/']) => path.join(name),
        Some(path) => path.to_path_buf(),
        None => {
            let dir = first_input.and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default();
            unused_path(&dir.join(name))
        }
    }
}

/// Without `--out` the result goes next to the input and must not replace anything.
pub(crate) fn unused_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|ext| format!(".{}", ext.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{stem} ({n}){ext}")))
        .find(|candidate| !candidate.exists())
        .expect("some numbered name is free")
}

fn write_output(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|err| format!("Klasör oluşturulamadı ({}): {err}", parent.display()))?;
    }
    std::fs::write(target, bytes).map_err(|err| format!("Çıktı yazılamadı ({}): {err}", target.display()))
}

/// Release builds have no console of their own; printing goes to the console
/// the command was typed in, unless the caller already redirected the output.
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE};
    let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if handle.is_null() {
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    }
}

#[cfg(not(windows))]
fn attach_console() {}

#[cfg(test)]
mod tests {
    use super::{
        exit_code_for, output_path, parse, requested, unused_path, EXIT_ENGINE, EXIT_LICENSE, EXIT_POLICY, EXIT_USAGE,
    };
    use std::path::{Path, PathBuf};

    fn args(list: &[&str]) -> Vec<String> {
        std::iter::once("securipdf-desktop.exe").chain(list.iter().copied()).map(String::from).collect()
    }

    #[test]
    fn only_switches_start_command_line_mode() {
        assert!(requested(&args(&["--tool", "ocr-pdf", "a.pdf"])));
        assert!(requested(&args(&["--list-tools"])));
        assert!(requested(&args(&["--license-status"])));
        assert!(requested(&args(&["--license-activate", "a.lic"])));
        assert!(requested(&args(&["--policy-status"])));
        assert!(requested(&args(&["--update-status"])));
        assert!(!requested(&args(&[r"C:\belgeler\sözleşme.pdf"])));
        assert!(!requested(&args(&[])));
    }

    #[test]
    fn parses_tool_settings_and_inputs() {
        let options = parse(&args(&[
            "--tool", "ocr-pdf", "--set", "languages=tur,eng", "--set", "ocrType=force", "--password", "gizli",
            "--out", r"C:\çıktı\", "--json", "--silent", "a.pdf", "b.pdf",
        ]))
        .unwrap();
        assert_eq!(options.tool.as_deref(), Some("ocr-pdf"));
        assert_eq!(options.params["languages"], "tur,eng");
        assert_eq!(options.params["password"], "gizli");
        assert_eq!(options.out, Some(PathBuf::from(r"C:\çıktı\")));
        assert!(options.json && options.silent);
        assert_eq!(options.inputs, vec![PathBuf::from("a.pdf"), PathBuf::from("b.pdf")]);
    }

    #[test]
    fn rejects_incomplete_commands() {
        assert!(parse(&args(&["--tool"])).is_err());
        assert!(parse(&args(&["--tool", "ocr-pdf"])).is_err());
        assert!(parse(&args(&["a.pdf"])).is_err());
        assert!(parse(&args(&["--tool", "x", "--set", "=1", "a.pdf"])).is_err());
        assert!(parse(&args(&["--tool", "x", "--frobnicate", "a.pdf"])).is_err());
        assert!(parse(&args(&["--list-tools"])).is_ok());
        assert!(parse(&args(&["--license-status"])).is_ok());
        assert!(parse(&args(&["--license-activate", "firma.lic"])).is_ok());
        assert!(parse(&args(&["--policy-status", "--json"])).is_ok());
        assert!(parse(&args(&["--update-status"])).is_ok());
    }

    #[test]
    fn maps_failures_to_exit_codes() {
        assert_eq!(exit_code_for("UNKNOWN_TOOL"), EXIT_USAGE);
        assert_eq!(exit_code_for("ENGINE"), EXIT_ENGINE);
        assert_eq!(exit_code_for("LICENSE_EXPIRED"), EXIT_LICENSE);
        assert_eq!(exit_code_for("POLICY_TOOL"), EXIT_POLICY);
        assert_eq!(exit_code_for("LOCAL_HTTP_500"), 1);
    }

    #[test]
    fn output_goes_next_to_the_input_without_replacing_it() {
        let dir = std::env::temp_dir().join("securipdf-cli-çıktı");
        std::fs::create_dir_all(&dir).unwrap();
        let taken = dir.join("rapor_ocr.pdf");
        std::fs::write(&taken, b"x").unwrap();
        assert_eq!(unused_path(&taken), dir.join("rapor_ocr (2).pdf"));
        assert_eq!(output_path(None, Some(&dir.join("rapor.pdf")), "rapor_ocr.pdf"), dir.join("rapor_ocr (2).pdf"));
        assert_eq!(output_path(Some(&dir), None, "a.pdf"), dir.join("a.pdf"));
        assert_eq!(output_path(Some(Path::new(r"C:\yeni\")), None, "a.pdf"), PathBuf::from(r"C:\yeni\a.pdf"));
        assert_eq!(output_path(Some(Path::new(r"C:\x\son.pdf")), None, "a.pdf"), PathBuf::from(r"C:\x\son.pdf"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

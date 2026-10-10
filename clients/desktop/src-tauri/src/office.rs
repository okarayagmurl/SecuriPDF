//! Converts Office documents with the Microsoft Office installed on the PC.
//! Office lays out its own files best and is already licensed on most Windows
//! desks, so no converter is bundled for it.

use crate::engine::{hide_console, plain_path, short_path};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

const SCRIPT: &str = include_str!("office.ps1");
const HEADER_FORMAT: &str = "x-securipdf-office-format";
/// Office can stall on a dialog nobody sees; the app gives up instead of waiting forever.
const TIMEOUT: Duration = Duration::from_secs(180);
const EXTENSIONS: &[&str] = &[
    "doc", "docx", "docm", "dot", "dotx", "rtf", "odt", "txt", "pdf", "xls", "xlsx", "xlsm",
    "xlsb", "ods", "csv", "ppt", "pptx", "pptm", "pps", "ppsx", "odp",
];

static JOBS: AtomicU64 = AtomicU64::new(0);
/// Office automation fails in odd ways when two documents share one instance.
static BUSY: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq)]
struct Job {
    input_ext: String,
    format: &'static str,
    output_ext: &'static str,
}

#[tauri::command]
pub async fn office_convert(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("OFFICE_BAD_INPUT".into());
    };
    let name = crate::header(&request, crate::HEADER_FILE_NAME)
        .map(|raw| crate::percent_decode(&raw))
        .ok_or("OFFICE_BAD_INPUT")?;
    let format = crate::header(&request, HEADER_FORMAT).unwrap_or_else(|| "pdf".into());
    let job = plan(&name, &format)?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("office")
        .join(format!("job-{}-{}", std::process::id(), JOBS.fetch_add(1, Ordering::Relaxed)));
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = convert(&dir, &job, &body);
        let _ = std::fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|err| err.to_string())?
    .map(Response::new)
}

fn plan(name: &str, format: &str) -> Result<Job, String> {
    let input_ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|ext| EXTENSIONS.contains(&ext.as_str()))
        .ok_or("OFFICE_BAD_INPUT")?;
    let is_pdf = input_ext == "pdf";
    let (format, output_ext) = match format {
        "pdf" if !is_pdf => ("pdf", "pdf"),
        "pdfa" if !is_pdf => ("pdfa", "pdf"),
        "docx" if is_pdf => ("docx", "docx"),
        _ => return Err("OFFICE_BAD_INPUT".into()),
    };
    Ok(Job { input_ext, format, output_ext })
}

fn convert(dir: &Path, job: &Job, body: &[u8]) -> Result<Vec<u8>, String> {
    let _busy = BUSY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    // Windows PowerShell reads a script without a BOM in the ANSI code page.
    std::fs::write(dir.join("office.ps1"), format!("\u{feff}{SCRIPT}")).map_err(|err| err.to_string())?;
    let input = dir.join(format!("input.{}", job.input_ext));
    std::fs::write(&input, body).map_err(|err| err.to_string())?;

    let dir = short_path(&plain_path(dir));
    let output = dir.join(format!("output.{}", job.output_ext));
    let pid_file = dir.join("office.pid");
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .args(["-ExecutionPolicy", "Bypass", "-File"])
        .arg(dir.join("office.ps1"))
        .arg("-Source")
        .arg(dir.join(input.file_name().expect("input has a name")))
        .arg("-Target")
        .arg(&output)
        .arg("-PidFile")
        .arg(&pid_file)
        .args(["-Format", job.format])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| "OFFICE_SCRIPT_FAILED".to_string())?;

    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(250)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                kill_office(&pid_file);
                return Err("OFFICE_TIMEOUT".into());
            }
        }
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut out);
    }
    match status_code(&out) {
        "OK" => std::fs::read(&output).map_err(|_| "OFFICE_EXPORT_FAILED".to_string()),
        code => Err(code.to_string()),
    }
}

/// The script's last line is its status; anything else means it broke midway.
fn status_code(out: &str) -> &str {
    let last = out.lines().map(str::trim).filter(|line| !line.is_empty()).last().unwrap_or("");
    let is_code = last == "OK"
        || (last.starts_with("OFFICE_") && last.chars().all(|c| c.is_ascii_uppercase() || c == '_'));
    if is_code {
        last
    } else {
        "OFFICE_EXPORT_FAILED"
    }
}

/// Office runs outside our process tree, so a stuck instance has to be ended by id.
fn kill_office(pid_file: &Path) {
    let Ok(text) = std::fs::read_to_string(pid_file) else {
        return;
    };
    for pid in text.split_whitespace().filter_map(|id| id.parse::<u32>().ok()) {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        hide_console(&mut command);
        let _ = command.status();
    }
}

#[cfg(test)]
mod tests {
    use super::{plan, status_code, Job};

    #[test]
    fn plans_only_supported_conversions() {
        assert_eq!(
            plan("Sözleşme.DOCX", "pdfa"),
            Ok(Job { input_ext: "docx".into(), format: "pdfa", output_ext: "pdf" })
        );
        assert_eq!(plan("tablo.xlsx", "pdf").map(|job| job.output_ext), Ok("pdf"));
        assert_eq!(plan("rapor.pdf", "docx").map(|job| job.output_ext), Ok("docx"));
        assert!(plan("rapor.pdf", "pdf").is_err());
        assert!(plan("rapor.docx", "docx").is_err());
        assert!(plan("makro.exe", "pdf").is_err());
        assert!(plan("uzantisiz", "pdf").is_err());
    }

    #[test]
    fn reads_the_status_from_the_last_line() {
        assert_eq!(status_code("OK\r\n"), "OK");
        assert_eq!(status_code("noise\r\nOFFICE_MISSING\r\n"), "OFFICE_MISSING");
        assert_eq!(status_code("Exception: something broke"), "OFFICE_EXPORT_FAILED");
        assert_eq!(status_code(""), "OFFICE_EXPORT_FAILED");
    }
}

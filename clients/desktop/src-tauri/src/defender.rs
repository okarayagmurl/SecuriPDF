//! Scans a file with Windows Defender. The file is not quarantined or deleted.

use crate::engine::hide_console;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

static JOBS: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub clean: bool,
    pub threats: Vec<String>,
    pub detail: String,
    pub scanner: String,
}

#[tauri::command]
pub async fn scan_file(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Taranacak veri yok.".into());
    };
    let name = crate::header(&request, crate::HEADER_FILE_NAME)
        .map(|raw| crate::percent_decode(&raw))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "dosya.bin".into());
    let scanner = finder().ok_or("Windows Defender bulunamadı. Windows Güvenliği'nin açık olduğundan emin olun.")?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("scan")
        .join(format!("job-{}-{}", std::process::id(), JOBS.fetch_add(1, Ordering::Relaxed)));
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = scan(&scanner, &dir, &name, &body);
        let _ = std::fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|err| err.to_string())?
    .and_then(|result| serde_json::to_string(&result).map_err(|err| err.to_string()))
}

fn finder() -> Option<PathBuf> {
    let program = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let fixed = program.join(r"Windows Defender\MpCmdRun.exe");
    if fixed.is_file() {
        return Some(fixed);
    }
    let platform = PathBuf::from(r"C:\ProgramData\Microsoft\Windows Defender\Platform");
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(platform) {
        for entry in entries.flatten() {
            let exe = entry.path().join("MpCmdRun.exe");
            if exe.is_file() {
                found.push(exe);
            }
        }
    }
    found.sort();
    found.pop()
}

fn scan(scanner: &Path, dir: &Path, name: &str, body: &[u8]) -> Result<ScanResult, String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("Geçici klasör oluşturulamadı: {err}"))?;
    let safe = name.rsplit(['/', '\\']).next().unwrap_or("dosya.bin");
    let path = dir.join(safe);
    std::fs::write(&path, body).map_err(|err| format!("Geçici dosya yazılamadı: {err}"))?;
    let mut command = Command::new(scanner);
    command
        .args([
            "-Scan",
            "-ScanType",
            "3",
            "-DisableRemediation",
            "-File",
            &path.display().to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command.output().map_err(|err| format!("Windows Defender başlatılamadı: {err}"))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(parse_scan(output.status.code(), &text, scanner))
}

pub(crate) fn parse_scan(code: Option<i32>, text: &str, scanner: &Path) -> ScanResult {
    let threats = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            line.strip_prefix("Threat")
                .or_else(|| line.strip_prefix("Name"))
                .map(str::trim)
                .or_else(|| {
                    if line.contains("was found") || line.contains("threat") && line.contains("detected") {
                        Some(line)
                    } else {
                        None
                    }
                })
                .map(|s| s.trim_start_matches([':', '=', ' ']).to_string())
                .filter(|s| !s.is_empty())
        })
        .collect::<Vec<_>>();
    let lower = text.to_ascii_lowercase();
    let found = code == Some(2)
        || (lower.contains("threat") || lower.contains("malware") || lower.contains("virus"))
            && !(lower.contains("no threat") || lower.contains("found no") || lower.contains("0 threats"));
    ScanResult {
        clean: !found,
        threats,
        detail: text.trim().to_string(),
        scanner: scanner.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_scan;
    use std::path::Path;

    #[test]
    fn clean_scan_is_clean() {
        let result = parse_scan(Some(0), "Scan finished.\nNo threats found.", Path::new("MpCmdRun.exe"));
        assert!(result.clean);
        assert!(result.threats.is_empty());
    }

    #[test]
    fn exit_two_means_a_threat() {
        let result = parse_scan(Some(2), "Threat: Test.Virus\nwas found", Path::new("MpCmdRun.exe"));
        assert!(!result.clean);
        assert!(result.threats.iter().any(|t| t.contains("Test.Virus") || t.contains("found")));
    }
}

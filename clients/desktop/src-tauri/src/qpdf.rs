//! Rewrites a PDF with the bundled qpdf so a damaged xref or trailer can be recovered.
//! Stirling 2.14.3 calls qpdf 12 with flags that version rejects, so repair is done here.

use crate::engine::{hide_console, plain_path};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

static JOBS: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub async fn repair_pdf(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Onarılacak veri yok.".into());
    };
    let qpdf = qpdf_binary(&app).ok_or("qpdf bulunamadı. Motor paketini yeniden hazırlayın.")?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("repair")
        .join(format!("job-{}-{}", std::process::id(), JOBS.fetch_add(1, Ordering::Relaxed)));
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = repair(&qpdf, &dir, &body);
        let _ = std::fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|err| err.to_string())?
    .map(Response::new)
}

fn qpdf_binary(app: &AppHandle) -> Option<PathBuf> {
    find_qpdf(&plain_path(&app.path().resource_dir().ok()?.join("engine").join("qpdf")))
}

pub(crate) fn find_qpdf(dir: &Path) -> Option<PathBuf> {
    ["qpdf-real.exe", "qpdf.exe"]
        .into_iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

/// qpdf 12 needs `--` before the file names; warnings are not treated as failure.
pub(crate) fn repair_args(input: &Path, output: &Path) -> Vec<String> {
    vec![
        "--warning-exit-0".into(),
        "--".into(),
        input.display().to_string(),
        output.display().to_string(),
    ]
}

fn repair(qpdf: &Path, dir: &Path, body: &[u8]) -> Result<Vec<u8>, String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("Geçici klasör oluşturulamadı: {err}"))?;
    let input = dir.join("in.pdf");
    let output = dir.join("out.pdf");
    std::fs::write(&input, body).map_err(|err| format!("Geçici dosya yazılamadı: {err}"))?;
    let mut command = Command::new(qpdf);
    command
        .current_dir(qpdf.parent().unwrap_or(dir))
        .args(repair_args(&input, &output))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command.output().map_err(|err| format!("qpdf başlatılamadı: {err}"))?;
    if !output.is_file() {
        let err = String::from_utf8_lossy(&result.stderr);
        let hint = err
            .lines()
            .rev()
            .find(|line| line.contains("qpdf:"))
            .unwrap_or("PDF onarılamadı. Dosya çok hasarlı olabilir.");
        return Err(hint.trim().to_string());
    }
    let bytes = std::fs::read(&output).map_err(|err| format!("Onarılan dosya okunamadı: {err}"))?;
    if bytes.len() < 5 || &bytes[..4] != b"%PDF" {
        return Err("Onarılan dosya geçersiz.".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{find_qpdf, repair, repair_args};
    use std::path::PathBuf;

    fn qpdf() -> Option<PathBuf> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("engine").join("qpdf");
        find_qpdf(&dir)
    }

    fn tiny_pdf() -> Vec<u8> {
        br#"%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF
"#
        .to_vec()
    }

    #[test]
    fn file_names_follow_the_option_separator() {
        let args = repair_args(std::path::Path::new(r"C:\a.pdf"), std::path::Path::new(r"C:\b.pdf"));
        assert_eq!(args[0], "--warning-exit-0");
        assert_eq!(args[1], "--");
        assert!(args[2].ends_with("a.pdf"));
        assert!(args[3].ends_with("b.pdf"));
    }

    #[test]
    fn qpdf_rewrites_a_file_with_a_bad_startxref() {
        let Some(qpdf) = qpdf() else {
            return;
        };
        let mut damaged = tiny_pdf();
        let text = String::from_utf8_lossy(&damaged);
        let at = text.rfind("startxref").expect("startxref");
        damaged.truncate(at);
        damaged.extend_from_slice(b"startxref\n999999\n%%EOF\n");
        let dir = std::env::temp_dir().join(format!("securipdf-qpdf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let out = repair(&qpdf, &dir, &damaged).expect("repair");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(&out[..4], b"%PDF");
        assert!(String::from_utf8_lossy(&out).contains("startxref"));
        assert!(!String::from_utf8_lossy(&out).contains("999999"));
    }
}

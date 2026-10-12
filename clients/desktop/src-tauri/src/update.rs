//! Internal update feed for GPO/SCCM: a JSON file on a share, not a public store.

use crate::policy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub disabled: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn status() -> UpdateStatus {
    status_with(&policy::load(), current_version())
}

pub fn status_with(policy: &policy::Policy, current: &str) -> UpdateStatus {
    if !policy.enable_updates {
        return UpdateStatus {
            current: current.into(),
            latest: None,
            available: false,
            url: None,
            notes: None,
            disabled: true,
            message: "Kurum içi güncelleme kapalı. EnableUpdates ilkesini açın.".into(),
        };
    }
    let Some(url) = policy.update_manifest_url.as_deref() else {
        return UpdateStatus {
            current: current.into(),
            latest: None,
            available: false,
            url: None,
            notes: None,
            disabled: true,
            message: "UpdateManifestUrl ilkesi yok. Bildirim dosyasının UNC yolunu yazın.".into(),
        };
    };
    match read_manifest(url) {
        Ok(manifest) => {
            let available = version_newer(&manifest.version, current);
            UpdateStatus {
                current: current.into(),
                latest: Some(manifest.version.clone()),
                available,
                url: manifest.url,
                notes: manifest.notes,
                disabled: false,
                message: if available {
                    format!("Yeni sürüm var: {} (kurulu {}).", manifest.version, current)
                } else {
                    format!("Kurulu sürüm güncel ({current}).")
                },
            }
        }
        Err(message) => UpdateStatus {
            current: current.into(),
            latest: None,
            available: false,
            url: None,
            notes: None,
            disabled: false,
            message,
        },
    }
}

#[tauri::command]
pub fn update_status() -> UpdateStatus {
    status()
}

#[tauri::command]
pub fn update_open() -> Result<UpdateStatus, String> {
    let found = status();
    let Some(url) = found.url.as_deref() else {
        return Err(found.message);
    };
    if !found.available {
        return Err(found.message);
    }
    open_installer(url)?;
    Ok(found)
}

fn read_manifest(url: &str) -> Result<Manifest, String> {
    let trimmed = url.trim();
    if trimmed.starts_with("https://") {
        return Err("HTTPS bildirimleri paketlenmez. Bildirimi bir dosya paylaşımına koyun.".into());
    }
    if let Some(http) = trimmed.strip_prefix("http://") {
        return Err(format!(
            "HTTP bildirimleri kapalı ({http}). UpdateManifestUrl bir UNC veya yerel dosya olmalı."
        ));
    }
    let path = if let Some(rest) = trimmed.strip_prefix("file://") {
        PathBuf::from(rest.trim_start_matches('/'))
    } else {
        PathBuf::from(trimmed)
    };
    let text = fs::read_to_string(&path)
        .map_err(|err| format!("Güncelleme bildirimi okunamadı ({}): {err}", path.display()))?;
    parse_manifest(&text)
}

fn parse_manifest(text: &str) -> Result<Manifest, String> {
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "Güncelleme bildirimi okunamadı. version ve url alanları gerekli.".to_string())
}

pub fn version_newer(latest: &str, current: &str) -> bool {
    compare_version(latest) > compare_version(current)
}

fn compare_version(raw: &str) -> (u32, u32, u32) {
    let core = raw.split(['-', '+']).next().unwrap_or(raw);
    let mut parts = core.split('.');
    let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn open_installer(url: &str) -> Result<(), String> {
    let path = Path::new(url);
    if !path.exists() {
        return Err(format!("Kurulum dosyası bulunamadı: {url}"));
    }
    let mut command = Command::new(path);
    crate::engine::hide_console(&mut command);
    command
        .spawn()
        .map_err(|err| format!("Kurulum başlatılamadı: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_manifest, status_with, version_newer};
    use crate::policy::Policy;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn later_version_is_newer() {
        assert!(version_newer("1.2.9", "1.2.8"));
        assert!(version_newer("1.3.0", "1.2.99"));
        assert!(!version_newer("1.2.8", "1.2.8"));
        assert!(!version_newer("1.2.8", "1.2.9"));
    }

    #[test]
    fn manifest_needs_a_version() {
        let parsed = parse_manifest(r#"{"version":"1.2.9","url":"\\\\fs\\SecuriPDF\\setup.exe","notes":"SCCM"}"#).unwrap();
        assert_eq!(parsed.version, "1.2.9");
        assert_eq!(parsed.url.as_deref(), Some(r"\\fs\SecuriPDF\setup.exe"));
    }

    #[test]
    fn file_share_manifest_is_read() {
        let dir = std::env::temp_dir().join(format!(
            "spf-upd-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let manifest = dir.join("update.json");
        fs::write(&manifest, r#"{"version":"9.9.9","url":"\\\\fs\\a.exe"}"#).unwrap();
        let policy = Policy {
            enable_updates: true,
            update_manifest_url: Some(manifest.display().to_string()),
            ..Policy::default()
        };
        let status = status_with(&policy, "1.2.8");
        assert!(status.available);
        assert_eq!(status.latest.as_deref(), Some("9.9.9"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn updates_stay_off_until_policy_says_so() {
        let status = status_with(&Policy::default(), "1.2.8");
        assert!(status.disabled);
        assert!(!status.available);
    }
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

pub const ENV_SERVER_URL: &str = "SECURIPDF_SERVER_URL";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub server_url: Option<String>,
    pub hosts: Vec<String>,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellConfig {
    pub server_url: Option<String>,
    pub locked: bool,
    pub allowed_hosts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionFile {
    server_url: Option<String>,
    #[serde(default)]
    lock_connection: bool,
    #[serde(default)]
    allowed_hosts: Vec<String>,
}

impl Policy {
    pub fn load() -> Self {
        if let Some(policy) = read_policy(&machine_provision_path()) {
            return policy;
        }
        if let Some(policy) = read_policy(&user_provision_path()) {
            return policy;
        }
        match std::env::var(ENV_SERVER_URL) {
            Ok(raw) if !raw.trim().is_empty() => Self::from_url(&raw, false, Vec::new())
                .unwrap_or_else(|_| Self::empty()),
            _ => Self::empty(),
        }
    }

    pub fn empty() -> Self {
        Self {
            server_url: None,
            hosts: Vec::new(),
            locked: false,
        }
    }

    pub fn config(&self) -> ShellConfig {
        ShellConfig {
            server_url: self.server_url.clone(),
            locked: self.locked,
            allowed_hosts: self.hosts.clone(),
        }
    }

    pub fn from_url(
        raw: &str,
        locked: bool,
        extra_hosts: Vec<String>,
    ) -> Result<Self, String> {
        let (server_url, host) = normalize_server_url(raw)?;
        let mut hosts = vec![host];
        for extra in extra_hosts {
            let host = normalize_host(&extra)?;
            if !hosts.iter().any(|item| item.eq_ignore_ascii_case(&host)) {
                hosts.push(host);
            }
        }
        Ok(Self {
            server_url: Some(server_url),
            hosts,
            locked,
        })
    }

    pub fn save_user(&self) -> Result<(), String> {
        if self.locked {
            return Err("Sunucu adresi yönetici tarafından kilitli.".into());
        }
        let Some(server_url) = &self.server_url else {
            return Err("Sunucu adresi boş.".into());
        };
        let path = user_provision_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut hosts = self.hosts.clone();
        if let Some(server_host) = hosts.first().cloned() {
            hosts.retain(|host| !host.eq_ignore_ascii_case(&server_host));
        }
        let body = serde_json::json!({
            "serverUrl": server_url,
            "lockConnection": false,
            "allowedHosts": hosts,
        });
        fs::write(&path, serde_json::to_vec_pretty(&body).map_err(|err| err.to_string())?)
            .map_err(|err| err.to_string())
    }
}

pub fn normalize_server_url(raw: &str) -> Result<(String, String), String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Adres geçersiz. Örnek: https://pdf.sirket.local:8444".to_string())?;
    match url.scheme() {
        "https" | "http" => {}
        _ => return Err("Adres http veya https ile başlamalı.".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Adres kullanıcı adı veya parola içeremez.".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Adreste sunucu adı yok.".to_string())?
        .to_string();
    let mut stored = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        stored.push(':');
        stored.push_str(&port.to_string());
    }
    Ok((stored, host))
}

pub fn allows(url: &Url, policy: &Policy) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost" | "localhost" | "127.0.0.1") => true,
            Some(host) => policy
                .hosts
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(host)),
            None => false,
        },
        _ => false,
    }
}

fn normalize_host(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Ek sunucu adı boş.".into());
    }
    if trimmed.contains("://") {
        return Ok(normalize_server_url(trimmed)?.1);
    }
    if trimmed.contains('/') || trimmed.contains(' ') {
        return Err(format!("Ek sunucu adı geçersiz: {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn read_policy(path: &Path) -> Option<Policy> {
    let text = fs::read_to_string(path).ok()?;
    let file: ProvisionFile = serde_json::from_str(&text).ok()?;
    let raw = file.server_url.unwrap_or_default();
    if raw.trim().is_empty() {
        return None;
    }
    Policy::from_url(&raw, file.lock_connection, file.allowed_hosts).ok()
}

pub fn machine_provision_path() -> PathBuf {
    if let Ok(dir) = std::env::var("PROGRAMDATA") {
        return PathBuf::from(dir)
            .join("SecuriPDF")
            .join("securipdf-provisioning.json");
    }
    PathBuf::from(r"C:\ProgramData\SecuriPDF\securipdf-provisioning.json")
}

pub fn user_provision_path() -> PathBuf {
    if let Ok(dir) = std::env::var("APPDATA") {
        return PathBuf::from(dir)
            .join("SecuriPDF")
            .join("securipdf-provisioning.json");
    }
    PathBuf::from("securipdf-provisioning.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_explicit_access_port() {
        let (url, host) = normalize_server_url("https://pdf.sirket.local:8444/").unwrap();
        assert_eq!(url, "https://pdf.sirket.local:8444");
        assert_eq!(host, "pdf.sirket.local");
    }

    #[test]
    fn rejects_file_urls() {
        assert!(normalize_server_url("file:///C:/temp/a.pdf").is_err());
    }

    #[test]
    fn allows_keycloak_port_on_the_same_host() {
        let policy = Policy::from_url("https://pdf.sirket.local:8444", true, vec![]).unwrap();
        let login = Url::parse("https://pdf.sirket.local:8443/realms/securipdf").unwrap();
        let callback = Url::parse("https://pdf.sirket.local:8444/oauth2/callback").unwrap();
        assert!(allows(&login, &policy));
        assert!(allows(&callback, &policy));
    }

    #[test]
    fn blocks_other_hosts_and_dropped_files() {
        let policy = Policy::from_url("https://pdf.sirket.local:8444", false, vec![]).unwrap();
        assert!(!allows(&Url::parse("https://evil.test/").unwrap(), &policy));
        assert!(!allows(
            &Url::parse("file:///C:/Users/me/report.pdf").unwrap(),
            &policy
        ));
    }

    #[test]
    fn keeps_setup_page_reachable() {
        let policy = Policy::empty();
        assert!(allows(
            &Url::parse("http://tauri.localhost/index.html").unwrap(),
            &policy
        ));
    }
}

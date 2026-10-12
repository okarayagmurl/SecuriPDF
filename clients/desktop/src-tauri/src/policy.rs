//! Reads the desktop Group Policy / SCCM values under
//! `SOFTWARE\Policies\Entera\SecuriPDF\Desktop`. Machine policy wins over user.

use serde::Serialize;
use std::collections::HashMap;

pub const POLICY_KEY: &str = r"SOFTWARE\Policies\Entera\SecuriPDF\Desktop";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub license_file: Option<String>,
    pub license_directory: Option<String>,
    pub disable_demo: bool,
    pub allow_timestamp: bool,
    pub enable_updates: bool,
    pub update_manifest_url: Option<String>,
    /// `None` = user may toggle the Explorer menu; `Some` = GPO/SCCM forces it.
    pub shell_menu: Option<bool>,
    pub source: String,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            license_file: None,
            license_directory: None,
            disable_demo: false,
            allow_timestamp: true,
            enable_updates: false,
            update_manifest_url: None,
            shell_menu: None,
            source: "none".into(),
        }
    }
}

pub fn load() -> Policy {
    from_maps(&read_hive(true), &read_hive(false))
}

pub fn from_maps(machine: &HashMap<String, String>, user: &HashMap<String, String>) -> Policy {
    let mut merged = user.clone();
    for (key, value) in machine {
        merged.insert(key.clone(), value.clone());
    }
    if merged.is_empty() {
        return Policy::default();
    }
    Policy {
        license_file: nonempty(&merged, "LicenseFile"),
        license_directory: nonempty(&merged, "LicenseDirectory"),
        disable_demo: bool_of(&merged, "DisableDemo").unwrap_or(false),
        allow_timestamp: bool_of(&merged, "AllowTimestamp").unwrap_or(true),
        enable_updates: bool_of(&merged, "EnableUpdates").unwrap_or(false),
        update_manifest_url: nonempty(&merged, "UpdateManifestUrl"),
        shell_menu: bool_of(&merged, "EnableShellMenu"),
        source: if machine.is_empty() { "user" } else { "machine" }.into(),
    }
}

fn nonempty(map: &HashMap<String, String>, name: &str) -> Option<String> {
    map.get(name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bool_of(map: &HashMap<String, String>, name: &str) -> Option<bool> {
    map.get(name).and_then(|value| match value.trim() {
        "0" | "false" | "False" | "no" | "No" => Some(false),
        "1" | "true" | "True" | "yes" | "Yes" => Some(true),
        _ => None,
    })
}

#[cfg(windows)]
fn read_hive(machine: bool) -> HashMap<String, String> {
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY,
    };
    let root = if machine {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };
    read_values(root, KEY_READ | KEY_WOW64_64KEY)
}

#[cfg(not(windows))]
fn read_hive(_machine: bool) -> HashMap<String, String> {
    HashMap::new()
}

#[cfg(windows)]
fn read_values(root: windows_sys::Win32::System::Registry::HKEY, access: u32) -> HashMap<String, String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, RegQueryInfoKeyW, HKEY, REG_DWORD, REG_SZ,
    };
    let mut key: HKEY = std::ptr::null_mut();
    let path = wide(POLICY_KEY);
    let opened = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, access, &mut key) };
    if opened != 0 {
        return HashMap::new();
    }
    let mut count = 0u32;
    let info = unsafe {
        RegQueryInfoKeyW(
            key,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut count,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if info != 0 {
        unsafe { RegCloseKey(key) };
        return HashMap::new();
    }
    let mut out = HashMap::new();
    for index in 0..count {
        let mut name = vec![0u16; 256];
        let mut name_len = name.len() as u32;
        let mut kind = 0u32;
        let mut data = vec![0u8; 4096];
        let mut data_len = data.len() as u32;
        let read = unsafe {
            RegEnumValueW(
                key,
                index,
                name.as_mut_ptr(),
                &mut name_len,
                std::ptr::null_mut(),
                &mut kind,
                data.as_mut_ptr(),
                &mut data_len,
            )
        };
        if read != 0 {
            continue;
        }
        let label = String::from_utf16_lossy(&name[..name_len as usize]);
        if kind == REG_DWORD && data_len >= 4 {
            let value = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
            out.insert(label, if value == 0 { "0".into() } else { "1".into() });
        } else if kind == REG_SZ {
            let units: Vec<u16> = data[..data_len as usize]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .take_while(|unit| *unit != 0)
                .collect();
            if let Ok(text) = String::from_utf16(&units) {
                out.insert(label, text);
            }
        }
    }
    unsafe { RegCloseKey(key) };
    out
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

#[tauri::command]
pub fn policy_status() -> Policy {
    load()
}

#[cfg(test)]
mod tests {
    use super::{from_maps, Policy};
    use std::collections::HashMap;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn empty_maps_are_defaults() {
        assert_eq!(from_maps(&HashMap::new(), &HashMap::new()), Policy::default());
    }

    #[test]
    fn machine_policy_wins_over_user() {
        let machine = map(&[
            ("LicenseFile", r"\\files\SecuriPDF\site.lic"),
            ("DisableDemo", "1"),
            ("EnableShellMenu", "1"),
        ]);
        let user = map(&[
            ("LicenseFile", r"C:\user.lic"),
            ("DisableDemo", "0"),
            ("EnableShellMenu", "0"),
            ("AllowTimestamp", "0"),
        ]);
        let policy = from_maps(&machine, &user);
        assert_eq!(policy.license_file.as_deref(), Some(r"\\files\SecuriPDF\site.lic"));
        assert!(policy.disable_demo);
        assert_eq!(policy.shell_menu, Some(true));
        assert!(!policy.allow_timestamp);
        assert_eq!(policy.source, "machine");
    }

    #[test]
    fn admx_uses_the_same_registry_key() {
        let admx = include_str!("../../policy/EnteraSecuriPDF.admx");
        assert!(admx.contains(r#"key="Software\Policies\Entera\SecuriPDF\Desktop""#));
        assert!(admx.contains("LicenseFile"));
        assert!(admx.contains("DisableDemo"));
        assert!(admx.contains("EnableShellMenu"));
        assert!(admx.contains("UpdateManifestUrl"));
    }

    #[test]
    fn missing_shell_menu_stays_user_choice() {
        let policy = from_maps(&map(&[("DisableDemo", "1")]), &HashMap::new());
        assert_eq!(policy.shell_menu, None);
        assert!(policy.disable_demo);
        assert!(policy.allow_timestamp);
        assert!(!policy.enable_updates);
    }
}

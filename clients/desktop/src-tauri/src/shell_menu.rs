//! Adds a "SecuriPDF" submenu to the Explorer right-click menu of supported
//! files. Entries live under HKCU so no administrator rights are needed; each
//! one runs the command-line mode and writes the result next to the file.

use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};

const ROOT: &str = r"Software\Classes\SystemFileAssociations";
const MENU_KEY: &str = "SecuriPDF";
const OFFICE: &[&str] = &[".doc", ".docx", ".rtf", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp"];

struct Entry {
    verb: &'static str,
    label: &'static str,
    tool: &'static str,
}

fn entries(ext: &str) -> &'static [Entry] {
    const PDF: &[Entry] = &[
        Entry { verb: "10ocr", label: "Metin tanıma (OCR)", tool: "ocr-pdf" },
        Entry { verb: "20word", label: "Word'e dönüştür", tool: "pdf-to-word" },
        Entry { verb: "30udf", label: "UDF'e dönüştür", tool: "pdf-to-udf" },
        Entry { verb: "40compress", label: "Sıkıştır", tool: "compress-pdf" },
        Entry { verb: "50pdfa", label: "PDF/A'ya dönüştür", tool: "pdf-to-pdfa" },
    ];
    const TO_PDF_OFFICE: &[Entry] = &[Entry { verb: "10pdf", label: "PDF'e dönüştür", tool: "office-to-pdf" }];
    const TO_PDF_UDF: &[Entry] = &[Entry { verb: "10pdf", label: "PDF'e dönüştür", tool: "udf-to-pdf" }];
    match ext {
        ".pdf" => PDF,
        ".udf" => TO_PDF_UDF,
        _ if OFFICE.contains(&ext) => TO_PDF_OFFICE,
        _ => &[],
    }
}

fn extensions() -> impl Iterator<Item = &'static str> {
    [".pdf", ".udf"].into_iter().chain(OFFICE.iter().copied())
}

/// (subkey, value name, data) for one file type; `None` is the key's default value.
fn plan(ext: &str, exe: &str) -> Vec<(String, Option<&'static str>, String)> {
    let menu = format!(r"{ROOT}\{ext}\shell\{MENU_KEY}");
    let mut values = vec![
        (menu.clone(), Some("MUIVerb"), "SecuriPDF".to_string()),
        (menu.clone(), Some("Icon"), format!("\"{exe}\",0")),
        (menu.clone(), Some("SubCommands"), String::new()),
    ];
    for entry in entries(ext) {
        let verb = format!(r"{menu}\shell\{}", entry.verb);
        values.push((verb.clone(), Some("MUIVerb"), entry.label.to_string()));
        values.push((format!(r"{verb}\command"), None, format!("\"{exe}\" --tool {} \"%1\"", entry.tool)));
    }
    values
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn set_value(subkey: &str, name: Option<&str>, data: &str) -> Result<(), String> {
    let mut key: HKEY = std::ptr::null_mut();
    let path = wide(subkey);
    let created = unsafe {
        RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, std::ptr::null(), &mut key, std::ptr::null_mut())
    };
    if created != 0 {
        return Err(format!("Kayıt defteri anahtarı oluşturulamadı ({created})."));
    }
    let name = name.map(wide);
    let data = wide(data);
    let written = unsafe {
        RegSetValueExW(
            key,
            name.as_ref().map_or(std::ptr::null(), |name| name.as_ptr()),
            0,
            REG_SZ,
            data.as_ptr().cast(),
            (data.len() * 2) as u32,
        )
    };
    unsafe { RegCloseKey(key) };
    if written == 0 {
        Ok(())
    } else {
        Err(format!("Kayıt defterine yazılamadı ({written})."))
    }
}

fn key_exists(subkey: &str) -> bool {
    let mut key: HKEY = std::ptr::null_mut();
    let path = wide(subkey);
    let opened = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_READ, &mut key) };
    if opened == 0 {
        unsafe { RegCloseKey(key) };
    }
    opened == 0
}

fn delete_tree(subkey: &str) {
    let path = wide(subkey);
    unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr()) };
}

fn menu_key(ext: &str) -> String {
    format!(r"{ROOT}\{ext}\shell\{MENU_KEY}")
}

#[tauri::command]
pub fn shell_menu_status() -> bool {
    key_exists(&menu_key(".pdf"))
}

#[tauri::command]
pub fn shell_menu_set(enabled: bool) -> Result<bool, String> {
    for ext in extensions() {
        delete_tree(&menu_key(ext));
    }
    if !enabled {
        return Ok(false);
    }
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let exe = crate::engine::plain_path(&exe).display().to_string();
    for ext in extensions() {
        for (subkey, name, data) in plan(ext, &exe) {
            set_value(&subkey, name, &data)?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{extensions, plan};

    #[test]
    fn pdf_menu_runs_the_command_line_per_file() {
        let values = plan(".pdf", r"C:\Program Files\SecuriPDF\securipdf-desktop.exe");
        let command = values
            .iter()
            .find(|(key, name, _)| key.ends_with(r"10ocr\command") && name.is_none())
            .map(|(_, _, data)| data.as_str());
        assert_eq!(command, Some(r#""C:\Program Files\SecuriPDF\securipdf-desktop.exe" --tool ocr-pdf "%1""#));
        assert!(values.iter().any(|(key, name, data)| key.ends_with(r".pdf\shell\SecuriPDF") && *name == Some("SubCommands") && data.is_empty()));
    }

    #[test]
    fn every_registered_type_has_an_entry() {
        for ext in extensions() {
            assert!(plan(ext, "x.exe").len() > 3, "{ext} has no menu entries");
        }
    }

    #[test]
    fn uninstaller_clears_every_menu_extension() {
        let hooks = include_str!("../windows/hooks.nsh");
        for ext in extensions() {
            assert!(hooks.contains(&format!("SECURIPDF_DELETE_MENU \"{ext}\"")), "hooks.nsh missing {ext}");
        }
        for name in ["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_POSTINSTALL", "NSIS_HOOK_PREUNINSTALL", "NSIS_HOOK_POSTUNINSTALL"] {
            assert!(hooks.contains(&format!("!macro {name}")), "hooks.nsh missing {name}");
        }
    }
}

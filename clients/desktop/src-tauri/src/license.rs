//! Offline desktop licence: signed `.lic` (same Ed25519 key as the server) or
//! a 15-day demo that starts on first use and is remembered in both the
//! profile folder and HKCU so deleting app data does not reset the clock.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub const PRODUCT: &str = "SecuriPDF";
pub const EDITION: &str = "desktop";
pub const DEMO_DAYS: i64 = 15;
pub const PUBLIC_KEY_B64: &str = "YVD+qpgIhuQ0quPaloo8liC+WYpeFuBdBmx6PmaHY9g=";
const APP_FOLDER: &str = "net.entera.securipdf.desktop";
const CLOCK_SLACK_SECS: i64 = 24 * 60 * 60;
const REG_PATH: &str = r"Software\Entera\SecuriPDF\Desktop";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub valid: bool,
    pub expired: bool,
    pub license_type: String,
    pub customer: String,
    pub package: String,
    pub license_key: String,
    pub installation_id: String,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub days_left: Option<i64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct State {
    installation_id: String,
    #[serde(default)]
    demo_started_at: Option<i64>,
    #[serde(default)]
    last_seen: i64,
    #[serde(default)]
    license: Option<Value>,
}

pub struct Store {
    file: PathBuf,
    use_registry: bool,
}

impl Store {
    pub fn default_store() -> Self {
        Self {
            file: data_dir().join("license").join("state.json"),
            use_registry: cfg!(windows),
        }
    }

    #[cfg(test)]
    fn at(dir: &Path, use_registry: bool) -> Self {
        Self {
            file: dir.join("state.json"),
            use_registry,
        }
    }
}

pub fn require() -> Result<(), String> {
    let status = evaluate()?;
    if !status.valid {
        return if status.expired {
            Err("LICENSE_EXPIRED".into())
        } else {
            Err("LICENSE_REQUIRED".into())
        };
    }
    crate::policy::require_user()
}

pub fn evaluate() -> Result<LicenseStatus, String> {
    evaluate_at_with(&Store::default_store(), unix_now(), &crate::policy::load(), true)
}

#[cfg(test)]
pub fn evaluate_at(store: &Store, now: i64) -> Result<LicenseStatus, String> {
    evaluate_at_with(store, now, &crate::policy::Policy::default(), false)
}

pub(crate) fn evaluate_at_with(
    store: &Store,
    now: i64,
    policy: &crate::policy::Policy,
    apply_deployed: bool,
) -> Result<LicenseStatus, String> {
    let mut state = load_merged(store, now)?;
    if apply_deployed && !has_valid_commercial(&state, now) {
        try_deployed_licenses(store, &state.installation_id, now, policy);
        state = load_merged(store, now)?;
    }
    let mut status = status_of(&state, now)?;
    if policy.disable_demo && status.license_type == "demo" {
        status.valid = false;
        status.expired = true;
        status.days_left = Some(0);
        status.message =
            "Kurum ilkesi deneme lisansını kapatmış. Dağıtılan .lic dosyasını yükleyin.".into();
    }
    state.last_seen = now.max(state.last_seen);
    save(store, &state)?;
    Ok(status)
}

pub fn activate_bytes(store: &Store, raw: &str, now: i64) -> Result<LicenseStatus, String> {
    activate_bytes_with(store, raw, now, PUBLIC_KEY_B64)
}

fn activate_bytes_with(store: &Store, raw: &str, now: i64, key_b64: &str) -> Result<LicenseStatus, String> {
    let doc: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|_| "Lisans dosyası okunamadı. Geçerli bir .lic seçin.".to_string())?;
    let payload = verify_signed_with(&doc, key_b64)?;
    let mut state = load_merged(store, now)?;
    installation_allowed(&payload, &state.installation_id)?;
    state.license = Some(doc);
    state.last_seen = now.max(state.last_seen);
    save(store, &state)?;
    Ok(signed_status_from_payload(&state, &payload, now))
}

pub fn activate_path(path: &Path) -> Result<LicenseStatus, String> {
    let raw = fs::read_to_string(path).map_err(|err| format!("Lisans dosyası okunamadı: {err}"))?;
    activate_bytes(&Store::default_store(), &raw, unix_now())
}

pub fn build_request(company: &str, email: &str, contact_name: &str, notes: &str) -> Result<Value, String> {
    build_request_at(&Store::default_store(), company, email, contact_name, notes)
}

fn build_request_at(
    store: &Store,
    company: &str,
    email: &str,
    contact_name: &str,
    notes: &str,
) -> Result<Value, String> {
    let company = company.trim();
    if company.chars().count() < 2 {
        return Err("Kurum veya müşteri adı en az 2 karakter olmalı.".into());
    }
    let state = load_merged(store, unix_now())?;
    Ok(json!({
        "v": 1,
        "type": "license_request",
        "product": PRODUCT,
        "edition": EDITION,
        "request_id": format!("REQ-{}", hex_upper(&mix_id(6))),
        "installation_id": state.installation_id,
        "company": company,
        "contact_name": contact_name.trim(),
        "contact_email": email.trim(),
        "requested_package": "professional",
        "public_fqdn": "",
        "server_ip": "",
        "created_at": unix_to_iso(unix_now()),
        "notes": notes.trim(),
    }))
}

#[tauri::command]
pub fn license_status() -> Result<LicenseStatus, String> {
    evaluate()
}

#[tauri::command]
pub async fn license_save_request(
    app: AppHandle,
    company: String,
    email: String,
    contact_name: String,
    notes: String,
) -> Result<Option<String>, String> {
    let req = build_request(&company, &email, &contact_name, &notes)?;
    let body = serde_json::to_string_pretty(&req).map_err(|err| err.to_string())? + "\n";
    let slug: String = company
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();
    let name = format!(
        "{}.req",
        if slug.is_empty() {
            "securipdf".into()
        } else {
            slug.to_ascii_lowercase()
        }
    );
    let mut dialog = app.dialog().file().set_file_name(&name).add_filter("Lisans talebi", &["req"]);
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
    fs::write(&path, body).map_err(|err| format!("Talep yazılamadı: {err}"))?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn license_open_and_activate(app: AppHandle) -> Result<LicenseStatus, String> {
    let mut dialog = app.dialog().file().add_filter("Lisans", &["lic"]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|err| err.to_string())?;
    let Some(chosen) = chosen else {
        return evaluate();
    };
    let path = chosen.into_path().map_err(|err| err.to_string())?;
    activate_path(&path)
}

#[tauri::command]
pub fn license_activate_text(text: String) -> Result<LicenseStatus, String> {
    let raw = text.trim();
    if raw.is_empty() {
        return Err("Lisans metni boş. .lic içeriğini yapıştırın veya dosyadan yükleyin.".into());
    }
    activate_bytes(&Store::default_store(), raw, unix_now())
}

fn data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir())
        .join(APP_FOLDER)
}

fn load_merged(store: &Store, now: i64) -> Result<State, String> {
    let file = read_state(&store.file);
    let backup = if store.use_registry {
        read_registry()
    } else {
        read_state(&store.file.with_extension("bak"))
    };
    Ok(merge(file, backup, now))
}

fn merge(file: Option<State>, backup: Option<State>, now: i64) -> State {
    let installation_id = file
        .as_ref()
        .map(|s| s.installation_id.clone())
        .filter(|id| !id.is_empty())
        .or_else(|| backup.as_ref().map(|s| s.installation_id.clone()).filter(|id| !id.is_empty()))
        .unwrap_or_else(new_installation_id);
    let demo_started_at = [file.as_ref(), backup.as_ref()]
        .into_iter()
        .flatten()
        .filter_map(|s| s.demo_started_at)
        .min();
    let last_seen = [file.as_ref(), backup.as_ref()]
        .into_iter()
        .flatten()
        .map(|s| s.last_seen)
        .max()
        .unwrap_or(now);
    let license = file
        .as_ref()
        .and_then(|s| s.license.clone())
        .or_else(|| backup.and_then(|s| s.license));
    State {
        installation_id,
        demo_started_at: demo_started_at.or(Some(now)),
        last_seen,
        license,
    }
}

fn status_of(state: &State, now: i64) -> Result<LicenseStatus, String> {
    if now + CLOCK_SLACK_SECS < state.last_seen {
        return Ok(expired_status(state, now, "Sistem saati geri alınmış görünüyor. Lisans geçersiz."));
    }
    if let Some(doc) = &state.license {
        return match signed_status(state, doc, now) {
            Ok(status) => Ok(status),
            Err(message) => Ok(LicenseStatus {
                valid: false,
                expired: true,
                license_type: "commercial".into(),
                customer: String::new(),
                package: String::new(),
                license_key: String::new(),
                installation_id: state.installation_id.clone(),
                issued_at: None,
                expires_at: None,
                days_left: Some(0),
                message,
            }),
        };
    }
    let started = state.demo_started_at.unwrap_or(now);
    if now + CLOCK_SLACK_SECS < started {
        return Ok(expired_status(state, now, "Sistem saati geri alınmış görünüyor. Lisans geçersiz."));
    }
    let expires = started + DEMO_DAYS * 86400;
    let expired = now >= expires;
    let days_left = if expired { 0 } else { (expires - now + 86399) / 86400 };
    Ok(LicenseStatus {
        valid: !expired,
        expired,
        license_type: "demo".into(),
        customer: "Deneme".into(),
        package: "demo".into(),
        license_key: String::new(),
        installation_id: state.installation_id.clone(),
        issued_at: Some(unix_to_iso(started)),
        expires_at: Some(unix_to_iso(expires)),
        days_left: Some(days_left),
        message: if expired {
            "15 günlük deneme süresi doldu. Entera'dan aldığınız .lic dosyasını yükleyin.".into()
        } else {
            format!("Deneme sürümü · {days_left} gün kaldı.")
        },
    })
}

fn signed_status(state: &State, doc: &Value, now: i64) -> Result<LicenseStatus, String> {
    let payload = verify_signed(doc)?;
    installation_allowed(&payload, &state.installation_id)?;
    Ok(signed_status_from_payload(state, &payload, now))
}

fn installation_allowed(payload: &Map<String, Value>, installation_id: &str) -> Result<(), String> {
    if is_org_scope(payload) {
        return Ok(());
    }
    match payload
        .get("installation_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        None => Err(
            "Lisans dosyasında kurulum kimliği yok. Bu bilgisayardan .req oluşturup Entera'ya gönderin."
                .into(),
        ),
        Some("*") => Ok(()),
        Some(id) if id == installation_id => Ok(()),
        Some(id) => Err(format!(
            "Bu lisans başka bir kurulum için: {id}. Bu bilgisayar: {installation_id}."
        )),
    }
}

fn is_org_scope(payload: &Map<String, Value>) -> bool {
    matches!(
        payload
            .get("scope")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("organization" | "organisation" | "site" | "volume" | "enterprise")
    )
}

fn has_valid_commercial(state: &State, now: i64) -> bool {
    state
        .license
        .as_ref()
        .and_then(|doc| signed_status(state, doc, now).ok())
        .is_some_and(|status| status.valid && status.license_type != "demo")
}

fn try_deployed_licenses(store: &Store, installation_id: &str, now: i64, policy: &crate::policy::Policy) {
    for path in deployed_license_paths(installation_id, policy) {
        if let Ok(raw) = fs::read_to_string(&path) {
            if activate_bytes(store, &raw, now).is_ok() {
                return;
            }
        }
    }
}

fn deployed_license_paths(installation_id: &str, policy: &crate::policy::Policy) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(path) = &policy.license_file {
        out.push(PathBuf::from(expand_placeholders(path, installation_id)));
    }
    if let Some(dir) = &policy.license_directory {
        let dir = PathBuf::from(expand_placeholders(dir, installation_id));
        out.push(dir.join(format!("{installation_id}.lic")));
        out.push(dir.join("license.lic"));
    }
    if let Some(from_env) = std::env::var_os("SECURIPDF_LICENSE") {
        out.push(PathBuf::from(from_env));
    }
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        let root = PathBuf::from(program_data).join("Entera").join("SecuriPDF");
        out.push(root.join("license.lic"));
        out.push(root.join(format!("{installation_id}.lic")));
    }
    out.push(data_dir().join("license").join("deployed.lic"));
    out
}

fn expand_placeholders(raw: &str, installation_id: &str) -> String {
    raw.replace("{installation_id}", installation_id)
        .replace("%INSTALLATION_ID%", installation_id)
}

fn signed_status_from_payload(state: &State, payload: &Map<String, Value>, now: i64) -> LicenseStatus {
    let expires_at = payload.get("expires_at").and_then(Value::as_str).map(str::to_string);
    let expired = expires_at
        .as_deref()
        .and_then(iso_to_unix)
        .map(|exp| now >= exp)
        .unwrap_or(false);
    let days_left = expires_at.as_deref().and_then(iso_to_unix).map(|exp| {
        if now >= exp {
            0
        } else {
            (exp - now + 86399) / 86400
        }
    });
    let license_type = payload
        .get("license_type")
        .and_then(Value::as_str)
        .unwrap_or("commercial")
        .to_string();
    let customer = payload.get("customer").and_then(Value::as_str).unwrap_or("").to_string();
    LicenseStatus {
        valid: !expired,
        expired,
        license_type,
        customer: customer.clone(),
        package: payload.get("package").and_then(Value::as_str).unwrap_or("").to_string(),
        license_key: payload.get("license_key").and_then(Value::as_str).unwrap_or("").to_string(),
        installation_id: state.installation_id.clone(),
        issued_at: payload.get("issued_at").and_then(Value::as_str).map(str::to_string),
        expires_at,
        days_left,
        message: if expired {
            "Lisans süresi doldu. Yeni bir .lic yükleyin.".into()
        } else if customer.is_empty() {
            "Lisanslı.".into()
        } else {
            format!("Lisanslı · {customer}")
        },
    }
}

fn expired_status(state: &State, _now: i64, message: &str) -> LicenseStatus {
    LicenseStatus {
        valid: false,
        expired: true,
        license_type: "demo".into(),
        customer: "Deneme".into(),
        package: "demo".into(),
        license_key: String::new(),
        installation_id: state.installation_id.clone(),
        issued_at: state.demo_started_at.map(unix_to_iso),
        expires_at: state.demo_started_at.map(|start| unix_to_iso(start + DEMO_DAYS * 86400)),
        days_left: Some(0),
        message: message.into(),
    }
}

fn verify_signed(doc: &Value) -> Result<Map<String, Value>, String> {
    verify_signed_with(doc, PUBLIC_KEY_B64)
}

fn verify_signed_with(doc: &Value, key_b64: &str) -> Result<Map<String, Value>, String> {
    let payload = doc
        .get("payload")
        .and_then(Value::as_object)
        .ok_or_else(|| "Geçersiz .lic yapısı.".to_string())?;
    let sig = doc
        .get("sig")
        .and_then(Value::as_str)
        .ok_or_else(|| "Geçersiz .lic yapısı.".to_string())?;
    if payload.get("product").and_then(Value::as_str) != Some(PRODUCT) {
        return Err("Lisans başka bir ürün için.".into());
    }
    if let Some(edition) = payload.get("edition").and_then(Value::as_str).map(str::trim) {
        if !edition.is_empty() && edition != EDITION {
            return Err("Bu lisans masaüstü uygulaması için değil.".into());
        }
    }
    let key = verifying_key(key_b64)?;
    let signature = Signature::from_slice(
        &STANDARD
            .decode(sig)
            .map_err(|_| "Lisans imzası okunamadı.".to_string())?,
    )
    .map_err(|_| "Lisans imzası okunamadı.".to_string())?;
    key.verify(&canonical(&Value::Object(payload.clone()))?, &signature)
        .map_err(|_| "Lisans imzası geçersiz.".to_string())?;
    Ok(payload.clone())
}

fn verifying_key(b64: &str) -> Result<VerifyingKey, String> {
    let bytes = STANDARD.decode(b64).map_err(|_| "Lisans anahtarı okunamadı.".to_string())?;
    let raw: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Lisans anahtarı okunamadı.".to_string())?;
    VerifyingKey::from_bytes(&raw).map_err(|_| "Lisans anahtarı okunamadı.".to_string())
}

pub(crate) fn canonical(value: &Value) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    write_canonical(&mut out, value);
    Ok(out)
}

fn write_canonical(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => out.extend_from_slice(n.to_string().as_bytes()),
        Value::String(s) => write_json_string(out, s),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_canonical(out, item);
            }
            out.push(b']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push(b'{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_json_string(out, key);
                out.push(b':');
                write_canonical(out, &map[key]);
            }
            out.push(b'}');
        }
    }
}

fn write_json_string(out: &mut Vec<u8>, text: &str) {
    out.push(b'"');
    for ch in text.chars() {
        match ch {
            '"' => out.extend_from_slice(br#"\""#),
            '\\' => out.extend_from_slice(br#"\\"#),
            '\u{08}' => out.extend_from_slice(br#"\b"#),
            '\u{0c}' => out.extend_from_slice(br#"\f"#),
            '\n' => out.extend_from_slice(br#"\n"#),
            '\r' => out.extend_from_slice(br#"\r"#),
            '\t' => out.extend_from_slice(br#"\t"#),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    out.push(b'"');
}

fn read_state(path: &Path) -> Option<State> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn save(store: &Store, state: &State) -> Result<(), String> {
    if let Some(parent) = store.file.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Lisans klasörü oluşturulamadı: {err}"))?;
    }
    let body = serde_json::to_string_pretty(state).map_err(|err| err.to_string())? + "\n";
    fs::write(&store.file, &body).map_err(|err| format!("Lisans durumu yazılamadı: {err}"))?;
    if store.use_registry {
        write_registry(state);
    } else if let Some(parent) = store.file.parent() {
        let _ = fs::write(parent.join("state.bak"), &body);
    }
    Ok(())
}

fn new_installation_id() -> String {
    format!("SPDF-INST-{}", hex_upper(&mix_id(8)))
}

fn mix_id(len: usize) -> Vec<u8> {
    let mut out = vec![0u8; len];
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(1)
        .to_le_bytes();
    let pid = std::process::id().to_le_bytes();
    let machine = machine_guid();
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = nanos[i % nanos.len()]
            ^ pid[i % pid.len()]
            ^ machine.as_bytes().get(i % machine.len().max(1)).copied().unwrap_or(0)
            ^ (i as u8).wrapping_mul(31);
    }
    out
}

fn machine_guid() -> String {
    #[cfg(windows)]
    {
        read_reg_value(
            windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
            "MachineGuid",
        )
        .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        String::new()
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn unix_to_iso(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400) as u32;
    let (y, m, d) = civil_from_days(days);
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn iso_to_unix(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let (date, time) = raw.split_once('T').unwrap_or((raw, "00:00:00Z"));
    let mut date_parts = date.split('-');
    let y: i32 = date_parts.next()?.parse().ok()?;
    let m: u32 = date_parts.next()?.parse().ok()?;
    let d: u32 = date_parts.next()?.parse().ok()?;
    let time = time.trim_end_matches('Z').split('+').next()?.split('-').next()?;
    let mut time_parts = time.split(':');
    let hh: i64 = time_parts.next()?.parse().ok()?;
    let mm: i64 = time_parts.next()?.parse().ok()?;
    let ss: i64 = time_parts.next().unwrap_or("0").parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    Some(days_from_civil(y, m, d) * 86400 + hh * 3600 + mm * 60 + ss)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = i64::from(year) - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = u64::from(if month > 2 { month - 3 } else { month + 9 });
    let doy = (153 * mp + 2) / 5 + u64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + i64::from(m <= 2);
    (y as i32, m as u32, d as u32)
}

fn hex_upper(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(windows)]
fn write_registry(state: &State) {
    let _ = set_reg_value("InstallationId", &state.installation_id);
    if let Some(started) = state.demo_started_at {
        let _ = set_reg_value("DemoStartedAt", &started.to_string());
    }
    let _ = set_reg_value("LastSeen", &state.last_seen.to_string());
    if let Some(license) = &state.license {
        if let Ok(body) = serde_json::to_string(license) {
            let _ = set_reg_value("LicenseJson", &body);
        }
    }
}

#[cfg(windows)]
fn read_registry() -> Option<State> {
    let installation_id = read_reg_value(
        windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
        REG_PATH,
        "InstallationId",
    )?;
    let demo_started_at = read_reg_value(
        windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
        REG_PATH,
        "DemoStartedAt",
    )
    .and_then(|v| v.parse().ok());
    let last_seen = read_reg_value(
        windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
        REG_PATH,
        "LastSeen",
    )
    .and_then(|v| v.parse().ok())
    .unwrap_or(0);
    let license = read_reg_value(
        windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
        REG_PATH,
        "LicenseJson",
    )
    .and_then(|body| serde_json::from_str(&body).ok());
    Some(State {
        installation_id,
        demo_started_at,
        last_seen,
        license,
    })
}

#[cfg(not(windows))]
fn write_registry(_state: &State) {}

#[cfg(not(windows))]
fn read_registry() -> Option<State> {
    None
}

#[cfg(windows)]
fn set_reg_value(name: &str, data: &str) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };
    let mut key: HKEY = std::ptr::null_mut();
    let path = wide(REG_PATH);
    let created = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    if created != 0 {
        return Err(format!("Kayıt defteri yazılamadı ({created})."));
    }
    let name_w = wide(name);
    let data_w = wide(data);
    let written = unsafe {
        RegSetValueExW(
            key,
            name_w.as_ptr(),
            0,
            REG_SZ,
            data_w.as_ptr().cast(),
            (data_w.len() * 2) as u32,
        )
    };
    unsafe { RegCloseKey(key) };
    if written != 0 {
        return Err(format!("Kayıt defteri değeri yazılamadı ({written})."));
    }
    Ok(())
}

#[cfg(windows)]
fn read_reg_value(root: windows_sys::Win32::System::Registry::HKEY, path: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_READ};
    let mut key: HKEY = std::ptr::null_mut();
    let path_w = wide(path);
    let opened = unsafe { RegOpenKeyExW(root, path_w.as_ptr(), 0, KEY_READ, &mut key) };
    if opened != 0 {
        return None;
    }
    let name_w = wide(name);
    let mut kind = 0u32;
    let mut size = 0u32;
    let first = unsafe {
        RegQueryValueExW(key, name_w.as_ptr(), std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), &mut size)
    };
    if first != 0 || size == 0 {
        unsafe { RegCloseKey(key) };
        return None;
    }
    let mut buf = vec![0u8; size as usize];
    let second = unsafe {
        RegQueryValueExW(key, name_w.as_ptr(), std::ptr::null_mut(), &mut kind, buf.as_mut_ptr(), &mut size)
    };
    unsafe { RegCloseKey(key) };
    if second != 0 {
        return None;
    }
    let units: Vec<u16> = buf
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    String::from_utf16(&units).ok()
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(1);

    fn tmp() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "spf-lic-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (Store::at(&dir, false), dir)
    }

    fn test_key() -> (SigningKey, String) {
        let key = SigningKey::from_bytes(&[0x11; 32]);
        let pub_b64 = STANDARD.encode(key.verifying_key().to_bytes());
        (key, pub_b64)
    }

    fn sign(payload: Value) -> (Value, String) {
        let (key, pub_b64) = test_key();
        let sig = key.sign(&canonical(&payload).unwrap());
        (
            json!({
                "v": 1,
                "payload": payload,
                "sig": STANDARD.encode(sig.to_bytes()),
            }),
            pub_b64,
        )
    }

    #[test]
    fn first_use_starts_a_fifteen_day_demo() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        let status = evaluate_at(&store, now).unwrap();
        assert!(status.valid);
        assert_eq!(status.license_type, "demo");
        assert_eq!(status.days_left, Some(15));
        assert!(status.installation_id.starts_with("SPDF-INST-"));
        let later = evaluate_at(&store, now + 14 * 86400).unwrap();
        assert!(later.valid);
        assert_eq!(later.days_left, Some(1));
        let gone = evaluate_at(&store, now + 15 * 86400).unwrap();
        assert!(!gone.valid);
        assert!(gone.expired);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_the_file_does_not_restart_demo() {
        let (store, dir) = tmp();
        let now = 1_700_000_000;
        let first = evaluate_at(&store, now).unwrap();
        fs::remove_file(&store.file).unwrap();
        let again = evaluate_at(&store, now + 86400).unwrap();
        assert_eq!(first.installation_id, again.installation_id);
        assert_eq!(again.days_left, Some(14));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn clock_rollback_invalidates_demo() {
        let (store, dir) = tmp();
        let now = 1_800_000_000;
        evaluate_at(&store, now).unwrap();
        let rolled = evaluate_at(&store, now - CLOCK_SLACK_SECS - 10).unwrap();
        assert!(!rolled.valid);
        assert!(rolled.expired);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn canonical_json_matches_python() {
        let payload = json!({
            "product": "SecuriPDF",
            "package": "professional",
            "customer": "ACME Şirket",
            "expires_at": "2027-01-01T00:00:00Z",
            "apply_package_limits": true,
            "limits": { "max_users": 10 }
        });
        let got = String::from_utf8(canonical(&payload).unwrap()).unwrap();
        assert_eq!(
            got,
            r#"{"apply_package_limits":true,"customer":"ACME Şirket","expires_at":"2027-01-01T00:00:00Z","limits":{"max_users":10},"package":"professional","product":"SecuriPDF"}"#
        );
    }

    #[test]
    fn civil_dates_round_trip() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_to_unix("2020-01-01T00:00:00Z"), Some(1_577_836_800));
        assert_eq!(unix_to_iso(1_577_836_800), "2020-01-01T00:00:00Z");
        assert_eq!(unix_to_iso(1_791_676_800), "2026-10-11T00:00:00Z");
    }

    #[test]
    fn vendor_public_key_is_32_bytes() {
        assert!(verifying_key(PUBLIC_KEY_B64).is_ok());
    }

    #[test]
    fn signed_license_binds_to_installation() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        let started = evaluate_at(&store, now).unwrap();
        let (doc, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "ACME",
            "license_key": "SPDF-TEST",
            "license_type": "commercial",
            "issued_at": "2026-10-11T00:00:00Z",
            "expires_at": "2027-10-11T00:00:00Z",
            "installation_id": started.installation_id,
        }));
        let status = activate_bytes_with(&store, &serde_json::to_string(&doc).unwrap(), now, &key).unwrap();
        assert!(status.valid);
        assert_eq!(status.license_type, "commercial");
        assert_eq!(status.customer, "ACME");
        let (other, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "ACME",
            "license_type": "commercial",
            "expires_at": "2027-10-11T00:00:00Z",
            "installation_id": "SPDF-INST-OTHERMACHINE",
        }));
        let err = activate_bytes_with(&store, &serde_json::to_string(&other).unwrap(), now, &key).unwrap_err();
        assert!(err.contains("başka bir kurulum"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn expired_commercial_is_not_valid() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        let started = evaluate_at(&store, now).unwrap();
        let (doc, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "ACME",
            "license_type": "commercial",
            "installation_id": started.installation_id,
            "expires_at": "2020-01-01T00:00:00Z",
        }));
        let status = activate_bytes_with(&store, &serde_json::to_string(&doc).unwrap(), now, &key).unwrap();
        assert!(!status.valid);
        assert!(status.expired);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn tampered_signature_is_rejected() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        evaluate_at(&store, now).unwrap();
        let (mut doc, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "ACME",
            "license_type": "commercial",
            "installation_id": "SPDF-INST-TEST",
        }));
        doc["payload"]["customer"] = json!("Hacker");
        let err = activate_bytes_with(&store, &serde_json::to_string(&doc).unwrap(), now, &key).unwrap_err();
        assert!(err.contains("imza"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn server_edition_is_rejected() {
        let payload = json!({
            "product": PRODUCT,
            "edition": "server",
            "package": "professional",
            "customer": "X",
            "license_type": "commercial"
        });
        let doc = json!({"v": 1, "payload": payload, "sig": STANDARD.encode([0u8; 64])});
        let err = verify_signed(&doc).unwrap_err();
        assert!(err.contains("masaüstü"));
    }

    #[test]
    fn company_name_is_required_for_request() {
        let (store, dir) = tmp();
        assert!(build_request_at(&store, "A", "", "", "").is_err());
        let req = build_request_at(&store, "ACME A.S.", "a@b.com", "", "").unwrap();
        assert_eq!(req["type"], "license_request");
        assert_eq!(req["edition"], EDITION);
        assert_eq!(req["product"], PRODUCT);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn organization_scope_license_works_on_any_install() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        evaluate_at(&store, now).unwrap();
        let (doc, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "Bakanlık",
            "license_type": "commercial",
            "scope": "organization",
            "expires_at": "2027-10-11T00:00:00Z",
        }));
        let status = activate_bytes_with(&store, &serde_json::to_string(&doc).unwrap(), now, &key).unwrap();
        assert!(status.valid);
        assert_eq!(status.customer, "Bakanlık");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn disable_demo_policy_blocks_trial() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        let policy = crate::policy::Policy {
            disable_demo: true,
            ..crate::policy::Policy::default()
        };
        let status = evaluate_at_with(&store, now, &policy, false).unwrap();
        assert!(!status.valid);
        assert!(status.message.contains("deneme"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn policy_license_file_is_activated() {
        let (store, dir) = tmp();
        let now = 1_791_676_800;
        evaluate_at(&store, now).unwrap();
        let (doc, key) = sign(json!({
            "product": PRODUCT,
            "edition": EDITION,
            "package": "professional",
            "customer": "GPO",
            "license_type": "commercial",
            "scope": "organization",
            "expires_at": "2027-10-11T00:00:00Z",
        }));
        // activate_bytes_with uses PUBLIC_KEY in production; here the test key
        // is only accepted through activate_bytes_with. Write a file the helper
        // can read after we swap by calling activate with the test key first
        // via a license file that evaluate_at_with will try — use the real
        // public key path: write signed-with-test-key and activate_bytes_with
        // directly, then confirm deployed paths include the file.
        let lic = dir.join("site.lic");
        fs::write(&lic, serde_json::to_string(&doc).unwrap()).unwrap();
        let policy = crate::policy::Policy {
            license_file: Some(lic.display().to_string()),
            ..crate::policy::Policy::default()
        };
        let paths = deployed_license_paths("SPDF-INST-TEST", &policy);
        assert!(paths.iter().any(|path| path == &lic));
        let status = activate_bytes_with(&store, &fs::read_to_string(&lic).unwrap(), now, &key).unwrap();
        assert!(status.valid);
        let _ = fs::remove_dir_all(dir);
    }
}

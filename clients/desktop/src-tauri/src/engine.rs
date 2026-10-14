use serde::Serialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const APP_JAR: [&str; 2] = ["app", "stirling-pdf-server.jar"];
const STARTUP_LIMIT: Duration = Duration::from_secs(180);
/// e-signature token drivers common in Turkey (AKİS, SafeSign, DataKey,
/// ePass2003) that Stirling does not allow by default. Separated with `;`.
const PKCS11_LIBRARIES: &str = r"C:\Windows\System32\akisp11.dll;C:\Windows\System32\aetpkss1.dll;C:\Windows\System32\dkck201.dll;C:\Windows\System32\eps2003csp11.dll";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineState {
    Missing,
    Starting,
    Ready,
    Failed,
}

/// Startup log lines of Stirling-PDF and how far along startup each one is.
/// The splash screen shows real progress instead of a guess.
const STARTUP_MILESTONES: [(&str, u8); 6] = [
    ("Settings file:", 15),
    ("Starting SPDFApplication", 30),
    ("Using fileUploadLimit setting", 55),
    ("Using Tesseract data path", 70),
    ("Starting JobQueue lifecycle", 85),
    ("Started SPDFApplication", 95),
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub state: EngineState,
    pub detail: Option<String>,
    /// 0-100 while starting, 100 once ready.
    pub progress: u8,
    pub elapsed_ms: u64,
    pub app_version: &'static str,
    pub engine_version: Option<String>,
    pub ocr_version: Option<String>,
}

struct Inner {
    state: EngineState,
    detail: Option<String>,
    port: Option<u16>,
    child: Option<Child>,
    log: Option<PathBuf>,
    started: Option<Instant>,
    versions: Versions,
}

#[derive(Clone, Default)]
struct Versions {
    engine: Option<String>,
    ocr: Option<String>,
}

#[derive(Clone)]
pub struct Engine(Arc<Mutex<Inner>>);

/// Layout written by `scripts/fetch-engine.ps1`.
#[derive(Clone)]
pub struct EngineFiles {
    java: PathBuf,
    jar: PathBuf,
    jvm_args: Option<PathBuf>,
    aot_cache: Option<PathBuf>,
    env: Vec<(String, String)>,
    tesseract: Option<PathBuf>,
    qpdf: Option<PathBuf>,
    ghostscript: Option<PathBuf>,
    tessdata: Option<PathBuf>,
    versions: Versions,
}

impl EngineFiles {
    pub fn locate(resource_dir: &Path) -> Option<Self> {
        let root = plain_path(&resource_dir.join("engine"));
        let java = root.join("jre").join("bin").join(java_binary());
        let jar = APP_JAR.iter().fold(root.clone(), |path, part| path.join(part));
        if !java.is_file() || !jar.is_file() {
            return None;
        }
        let existing = |path: PathBuf| path.exists().then_some(path);
        let env = std::fs::read_to_string(root.join("engine.env"))
            .map(|text| parse_env(&text))
            .unwrap_or_default();
        Some(Self {
            java,
            jar,
            jvm_args: existing(root.join("jvm.args")),
            aot_cache: existing(root.join("engine.aot")),
            env,
            tesseract: existing(root.join("tesseract").join("tesseract.exe"))
                .and_then(|exe| exe.parent().map(Path::to_path_buf)),
            qpdf: existing(root.join("qpdf").join("qpdf.exe")).and_then(|exe| exe.parent().map(Path::to_path_buf)),
            ghostscript: ghostscript_bin(&root),
            tessdata: existing(root.join("tessdata")),
            versions: std::fs::read_to_string(root.join("engine.json"))
                .map(|text| parse_versions(&text))
                .unwrap_or_default(),
        })
    }
}

fn parse_versions(text: &str) -> Versions {
    let manifest: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_default();
    let field = |key: &str| manifest.get(key).and_then(|value| value.as_str()).map(str::to_string);
    Versions {
        engine: field("stirlingVersion"),
        ocr: field("tesseract"),
    }
}

fn startup_progress(log: &str) -> u8 {
    STARTUP_MILESTONES
        .iter()
        .filter(|(marker, _)| log.contains(marker))
        .map(|(_, progress)| *progress)
        .max()
        .unwrap_or(5)
}

fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

impl Engine {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            state: EngineState::Missing,
            detail: None,
            port: None,
            child: None,
            log: None,
            started: None,
            versions: Versions::default(),
        })))
    }

    pub fn status(&self) -> EngineStatus {
        let inner = self.0.lock().expect("engine lock");
        let progress = match inner.state {
            EngineState::Ready => 100,
            EngineState::Starting => inner
                .log
                .as_ref()
                .and_then(|path| std::fs::read(path).ok())
                .map(|bytes| startup_progress(&String::from_utf8_lossy(&bytes)))
                .unwrap_or(5),
            _ => 0,
        };
        EngineStatus {
            state: inner.state,
            detail: inner.detail.clone(),
            progress,
            elapsed_ms: inner.started.map_or(0, |at| at.elapsed().as_millis() as u64),
            app_version: env!("CARGO_PKG_VERSION"),
            engine_version: inner.versions.engine.clone(),
            ocr_version: inner.versions.ocr.clone(),
        }
    }

    pub fn base_url(&self) -> Option<String> {
        let inner = self.0.lock().ok()?;
        match (inner.state, inner.port) {
            (EngineState::Ready, Some(port)) => Some(format!("http://127.0.0.1:{port}")),
            _ => None,
        }
    }

    pub fn start(&self, files: EngineFiles, work_dir: &Path) -> Result<u16, String> {
        self.spawn(&files, work_dir, files.aot_cache.is_some(), false)
    }

    fn spawn(&self, files: &EngineFiles, work_dir: &Path, use_aot: bool, append_log: bool) -> Result<u16, String> {
        std::fs::create_dir_all(work_dir).map_err(|err| err.to_string())?;
        let port = free_port()?;
        let log_path = work_dir.join("engine.log");
        let log = if append_log {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
        } else {
            std::fs::File::create(&log_path)
        }
        .map_err(|err| err.to_string())?;
        let log_err = log.try_clone().map_err(|err| err.to_string())?;
        let mut command = Command::new(&files.java);
        command.current_dir(work_dir);
        match &files.jvm_args {
            Some(args) => command.arg(format!("@{}", args.display())),
            None => command.args(["-Xmx1g", "-Djava.awt.headless=true"]),
        };
        // AOT is trained on the build PC. Loading it on an older CPU throws
        // EXCEPTION_ILLEGAL_INSTRUCTION (hs_err AdapterBlob).
        if use_aot {
            if let Some(cache) = &files.aot_cache {
                command.arg(format!("-XX:AOTCache={}", cache.display()));
            }
        } else {
            command.arg("-XX:UseAVX=0");
        }
        // Desktop mode unlocks signing with the Windows certificate store and
        // PKCS#11 tokens, and stops the engine when this process goes away.
        command
            .arg("-DSTIRLING_PDF_TAURI_MODE=true")
            .arg("-jar")
            .arg(&files.jar)
            .arg("--server.address=127.0.0.1")
            .arg(format!("--server.port={port}"))
            .envs(files.env.iter().map(|(key, value)| (key, value)))
            .env("TAURI_PARENT_PID", std::process::id().to_string())
            .env("STIRLING_PKCS11_LIBRARIES", PKCS11_LIBRARIES);
        if let Some(dir) = &files.qpdf {
            restore_qpdf(dir);
        }
        if let Some(dir) = &files.ghostscript {
            ensure_gs_alias(dir);
            if let Some(lib) = ghostscript_lib(dir) {
                command.env("GS_LIB", lib);
            }
        }
        let tools: Vec<PathBuf> = [&files.tesseract, &files.qpdf, &files.ghostscript]
            .into_iter()
            .flatten()
            .map(|dir| short_path(dir))
            .collect();
        if !tools.is_empty() {
            let mut path = std::ffi::OsString::new();
            for dir in &tools {
                path.push(dir);
                path.push(";");
            }
            if let Some(current) = std::env::var_os("PATH") {
                path.push(current);
            }
            command.env("PATH", path);
        }
        if let Some(dir) = &files.tessdata {
            command.env("TESSDATA_PREFIX", short_path(dir));
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err));
        hide_console(&mut command);
        let child = command
            .spawn()
            .map_err(|err| format!("Yerel motor başlatılamadı: {err}"))?;
        tie_to_app(&child);
        let mut inner = self.0.lock().map_err(|_| "Motor durumu okunamadı.".to_string())?;
        inner.state = EngineState::Starting;
        inner.detail = None;
        inner.port = Some(port);
        inner.child = Some(child);
        inner.log = Some(log_path);
        inner.started = Some(Instant::now());
        inner.versions = files.versions.clone();
        Ok(port)
    }

    pub async fn wait_ready(&self, port: u16, files: EngineFiles, work_dir: PathBuf) {
        if self.await_up(port).await {
            return;
        }
        if files.aot_cache.is_none() {
            return;
        }
        match self.spawn(&files, &work_dir, false, true) {
            Ok(port) => {
                let _ = self.await_up(port).await;
            }
            Err(detail) => self.fail(&detail),
        }
    }

    async fn await_up(&self, port: u16) -> bool {
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{port}/api/v1/info/status");
        let started = Instant::now();
        loop {
            if self.exited() {
                self.fail("Yerel motor kapandı.");
                return false;
            }
            if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(3)).send().await {
                if resp.status().is_success() {
                    if let Ok(mut inner) = self.0.lock() {
                        inner.state = EngineState::Ready;
                    }
                    return true;
                }
            }
            if started.elapsed() > STARTUP_LIMIT {
                self.stop();
                self.fail("Yerel motor zamanında açılmadı.");
                return false;
            }
            tokio::time::sleep(Duration::from_millis(750)).await;
        }
    }

    pub fn stop(&self) {
        if let Ok(mut inner) = self.0.lock() {
            if let Some(mut child) = inner.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            inner.port = None;
            if inner.state != EngineState::Missing {
                inner.state = EngineState::Failed;
            }
        }
    }

    fn exited(&self) -> bool {
        let Ok(mut inner) = self.0.lock() else {
            return true;
        };
        match inner.child.as_mut().map(|child| child.try_wait()) {
            Some(Ok(None)) => false,
            _ => true,
        }
    }

    pub fn fail(&self, detail: &str) {
        if let Ok(mut inner) = self.0.lock() {
            inner.state = EngineState::Failed;
            inner.detail = Some(detail.to_string());
        }
    }
}

pub fn is_local_api_path(path: &str) -> bool {
    path.starts_with("/api/v1/")
        && !path.contains("..")
        && !path.contains("//")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_'))
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|err| format!("Yerel motor için kapı bulunamadı: {err}"))
}

fn ghostscript_bin(root: &Path) -> Option<PathBuf> {
    let bundled = root.join("gs").join("bin");
    if gs_exe(&bundled).is_some() {
        return Some(bundled);
    }
    system_ghostscript_bin()
}

fn gs_exe(dir: &Path) -> Option<PathBuf> {
    ["gs.exe", "gswin64c.exe", "gswin32c.exe"]
        .into_iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

fn system_ghostscript_bin() -> Option<PathBuf> {
    let pf = std::env::var_os("ProgramFiles")?;
    let mut found = None;
    if let Ok(entries) = std::fs::read_dir(PathBuf::from(pf).join("gs")) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            if gs_exe(&bin).is_some() {
                found = Some(bin);
            }
        }
    }
    found
}

/// Stirling looks for `gs --version`. Windows ships `gswin64c.exe`.
fn ensure_gs_alias(dir: &Path) {
    let gs = dir.join("gs.exe");
    if gs.is_file() {
        return;
    }
    if let Some(src) = gs_exe(dir) {
        let _ = std::fs::copy(src, gs);
    }
}

fn ghostscript_lib(bin: &Path) -> Option<std::ffi::OsString> {
    let root = bin.parent()?;
    let mut value = std::ffi::OsString::new();
    for folder in [root.join("lib"), root.join("Resource").join("Init")] {
        if folder.is_dir() {
            if !value.is_empty() {
                value.push(";");
            }
            value.push(short_path(&folder));
        }
    }
    (!value.is_empty()).then_some(value)
}

/// Earlier builds renamed the real binary to `qpdf-real.exe` and put a shim on
/// `qpdf.exe`. Stirling compress still needs the real `qpdf.exe` on PATH.
fn restore_qpdf(dir: &Path) {
    let real = dir.join("qpdf-real.exe");
    let qpdf = dir.join("qpdf.exe");
    if real.is_file() {
        let _ = std::fs::copy(&real, &qpdf);
    }
}

/// Tauri reports the resource dir as `\\?\C:\...`; Tesseract appends `/name`
/// to such paths, which verbatim paths do not allow.
pub(crate) fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// Tesseract opens files with ANSI calls, so a path with non-ASCII letters
/// (for example a Turkish user name) is passed in its 8.3 short form.
#[cfg(windows)]
pub(crate) fn short_path(path: &Path) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut buffer = vec![0u16; 1024];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if len == 0 || len >= buffer.len() {
        return path.to_path_buf();
    }
    PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len]))
}

#[cfg(not(windows))]
pub(crate) fn short_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn java_binary() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_command: &mut Command) {}

#[cfg(windows)]
fn tie_to_app(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The job handle is deliberately never closed: Windows closes it when the
    // app process dies, however it dies, and that is what stops the engine.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set != 0 {
            AssignProcessToJobObject(job, child.as_raw_handle() as _);
        }
    }
}

#[cfg(not(windows))]
fn tie_to_app(_child: &Child) {}

#[cfg(test)]
mod tests {
    use super::{is_local_api_path, parse_env, parse_versions, plain_path, startup_progress};
    use std::path::{Path, PathBuf};

    #[test]
    fn startup_progress_follows_the_engine_log() {
        assert_eq!(startup_progress(""), 5);
        assert_eq!(startup_progress("INFO Starting SPDFApplication v2.14.3"), 30);
        let log = "Starting SPDFApplication\nUsing Tesseract data path: C:\\x\nStarted SPDFApplication in 9 s";
        assert_eq!(startup_progress(log), 95);
    }

    #[test]
    fn reads_versions_from_engine_manifest() {
        let versions = parse_versions("\u{feff}{\"stirlingVersion\":\"2.14.3\",\"tesseract\":\"5.4.0.20240606\"}");
        assert_eq!(versions.engine.as_deref(), Some("2.14.3"));
        assert_eq!(versions.ocr.as_deref(), Some("5.4.0.20240606"));
        assert!(parse_versions("not json").engine.is_none());
    }

    #[test]
    fn verbatim_resource_paths_become_plain() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\Program Files\SecuriPDF\engine")), PathBuf::from(r"C:\Program Files\SecuriPDF\engine"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\srv\share\engine")), PathBuf::from(r"\\?\UNC\srv\share\engine"));
        assert_eq!(plain_path(Path::new(r"C:\engine")), PathBuf::from(r"C:\engine"));
    }

    #[cfg(windows)]
    #[test]
    fn short_paths_are_ascii() {
        let dir = std::env::temp_dir().join("securipdf-kısa-yol-ğüş");
        std::fs::create_dir_all(&dir).unwrap();
        let short = super::short_path(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(short.to_string_lossy().is_ascii(), "{}", short.display());
    }

    #[test]
    fn reads_engine_settings_file() {
        let env = parse_env("# yorum\nSECURITY_ENABLELOGIN=false\n\nENDPOINTS_GROUPSTOREMOVE = OCRmyPDF\r\n");
        assert_eq!(
            env,
            vec![
                ("SECURITY_ENABLELOGIN".to_string(), "false".to_string()),
                ("ENDPOINTS_GROUPSTOREMOVE".to_string(), "OCRmyPDF".to_string()),
            ]
        );
    }

    #[test]
    fn accepts_stirling_tool_paths() {
        assert!(is_local_api_path("/api/v1/general/merge-pdfs"));
        assert!(is_local_api_path("/api/v1/convert/pdf/img"));
    }

    #[test]
    fn ghostscript_alias_uses_gswin64c() {
        let dir = std::env::temp_dir().join(format!("securipdf-gs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("gswin64c.exe"), b"gs").unwrap();
        super::ensure_gs_alias(&dir);
        assert!(dir.join("gs.exe").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_tool_api() {
        assert!(!is_local_api_path("/actuator/env"));
        assert!(!is_local_api_path("/api/v1/../actuator"));
        assert!(!is_local_api_path("/api/v1/general/merge?x=1"));
        assert!(!is_local_api_path("http://evil.test/api/v1/x"));
    }
}

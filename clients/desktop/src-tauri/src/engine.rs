use serde::Serialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const JAR_NAME: &str = "stirling-pdf-server.jar";
const STARTUP_LIMIT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineState {
    Missing,
    Starting,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub state: EngineState,
    pub detail: Option<String>,
}

struct Inner {
    state: EngineState,
    detail: Option<String>,
    port: Option<u16>,
    child: Option<Child>,
}

#[derive(Clone)]
pub struct Engine(Arc<Mutex<Inner>>);

pub struct EngineFiles {
    pub java: PathBuf,
    pub jar: PathBuf,
}

impl EngineFiles {
    pub fn locate(resource_dir: &Path) -> Option<Self> {
        let root = resource_dir.join("engine");
        let java = root.join("jre").join("bin").join(java_binary());
        let jar = root.join(JAR_NAME);
        (java.is_file() && jar.is_file()).then_some(Self { java, jar })
    }
}

impl Engine {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            state: EngineState::Missing,
            detail: None,
            port: None,
            child: None,
        })))
    }

    pub fn status(&self) -> EngineStatus {
        let inner = self.0.lock().expect("engine lock");
        EngineStatus {
            state: inner.state,
            detail: inner.detail.clone(),
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
        std::fs::create_dir_all(work_dir).map_err(|err| err.to_string())?;
        let port = free_port()?;
        let log = std::fs::File::create(work_dir.join("engine.log")).map_err(|err| err.to_string())?;
        let log_err = log.try_clone().map_err(|err| err.to_string())?;
        let mut command = Command::new(&files.java);
        command
            .current_dir(work_dir)
            .arg("-Xmx1g")
            .arg("-Djava.awt.headless=true")
            .arg("-jar")
            .arg(&files.jar)
            .arg("--server.address=127.0.0.1")
            .arg(format!("--server.port={port}"))
            .env("SECURITY_ENABLELOGIN", "false")
            .env("DOCKER_ENABLE_SECURITY", "false")
            .env("DISABLE_ADDITIONAL_FEATURES", "true")
            .env("SYSTEM_ENABLEANALYTICS", "false")
            .env("SYSTEM_GOOGLEVISIBILITY", "false")
            .env("SYSTEM_DEFAULTLOCALE", "tr-TR")
            .env("SYSTEM_MAXFILESIZE", "500")
            .env("METRICS_ENABLED", "false")
            .env("SHOW_SURVEY", "false")
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
        Ok(port)
    }

    pub async fn wait_ready(&self, port: u16) {
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{port}/api/v1/info/status");
        let started = Instant::now();
        loop {
            if self.exited() {
                self.fail("Yerel motor kapandı.");
                return;
            }
            if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(3)).send().await {
                if resp.status().is_success() {
                    if let Ok(mut inner) = self.0.lock() {
                        inner.state = EngineState::Ready;
                    }
                    return;
                }
            }
            if started.elapsed() > STARTUP_LIMIT {
                self.stop();
                self.fail("Yerel motor zamanında açılmadı.");
                return;
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

fn java_binary() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

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
    use super::is_local_api_path;

    #[test]
    fn accepts_stirling_tool_paths() {
        assert!(is_local_api_path("/api/v1/general/merge-pdfs"));
        assert!(is_local_api_path("/api/v1/convert/pdf/img"));
    }

    #[test]
    fn rejects_paths_outside_the_tool_api() {
        assert!(!is_local_api_path("/actuator/env"));
        assert!(!is_local_api_path("/api/v1/../actuator"));
        assert!(!is_local_api_path("/api/v1/general/merge?x=1"));
        assert!(!is_local_api_path("http://evil.test/api/v1/x"));
    }
}

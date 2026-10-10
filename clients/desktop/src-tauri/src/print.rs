//! Turns HTML into PDF with WebView2's print engine. UDF and e-Fatura pages
//! are laid out as HTML in the UI, so this keeps their text selectable without
//! bundling another converter.

use serde::Deserialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING};

const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

static JOBS: AtomicU64 = AtomicU64::new(0);

/// Page size and margins in inches, as WebView2 expects them.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    #[serde(default)]
    pub landscape: bool,
}

impl PageSetup {
    fn checked(self) -> Result<Self, String> {
        let sizes = [self.width, self.height];
        let margins = [self.margin_top, self.margin_right, self.margin_bottom, self.margin_left];
        let valid = sizes.iter().all(|value| value.is_finite() && (1.0..=50.0).contains(value))
            && margins.iter().all(|value| value.is_finite() && (0.0..=5.0).contains(value))
            && self.margin_left + self.margin_right < self.width
            && self.margin_top + self.margin_bottom < self.height;
        valid.then_some(self).ok_or_else(|| "PRINT_BAD_PAGE".to_string())
    }
}

#[tauri::command]
pub async fn html_to_pdf(app: AppHandle, html: String, page: PageSetup) -> Result<Response, String> {
    crate::license::require()?;
    let page = page.checked()?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("print");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let job = JOBS.fetch_add(1, Ordering::Relaxed);
    let html_path = dir.join(format!("job-{}-{job}.html", std::process::id()));
    let pdf_path = html_path.with_extension("pdf");
    std::fs::write(&html_path, html).map_err(|err| err.to_string())?;

    let result = render(&app, job, &html_path, &pdf_path, page).await;
    let _ = std::fs::remove_file(&html_path);
    let bytes = result.and_then(|()| std::fs::read(&pdf_path).map_err(|err| err.to_string()));
    let _ = std::fs::remove_file(&pdf_path);
    bytes.map(Response::new)
}

async fn render(app: &AppHandle, job: u64, html: &Path, pdf: &Path, page: PageSetup) -> Result<(), String> {
    let page_url = Url::from_file_path(html).map_err(|()| "PRINT_BAD_PATH".to_string())?;
    let (loaded_tx, loaded_rx) = oneshot::channel::<()>();
    let loaded_tx = Arc::new(Mutex::new(Some(loaded_tx)));
    let window = WebviewWindowBuilder::new(app, format!("print-{job}"), WebviewUrl::External("about:blank".parse().expect("static url")))
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .on_navigation(|url| url.scheme() == "file" || url.as_str() == "about:blank")
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished && payload.url().scheme() == "file" {
                if let Some(tx) = loaded_tx.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(());
                }
            }
        })
        .build()
        .map_err(|err| err.to_string())?;

    let outcome = async {
        let target = HSTRING::from(page_url.as_str());
        window
            .with_webview(move |webview| unsafe {
                let Ok(core) = webview.controller().CoreWebView2() else { return };
                // The document comes from a file the user picked; it must not run code.
                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetIsScriptEnabled(false.into());
                }
                let _ = core.Navigate(&target);
            })
            .map_err(|err| err.to_string())?;
        tokio::time::timeout(LOAD_TIMEOUT, loaded_rx)
            .await
            .map_err(|_| "PRINT_LOAD_TIMEOUT".to_string())?
            .map_err(|_| "PRINT_LOAD_FAILED".to_string())?;

        let (done_tx, done_rx) = oneshot::channel::<Result<(), String>>();
        let target = HSTRING::from(pdf.as_os_str());
        window
            .with_webview(move |webview| {
                let started = unsafe { start_print(&webview, &target, page, done_tx) };
                if let Err((err, done_tx)) = started {
                    let _ = done_tx.send(Err(err));
                }
            })
            .map_err(|err| err.to_string())?;
        tokio::time::timeout(PRINT_TIMEOUT, done_rx)
            .await
            .map_err(|_| "PRINT_TIMEOUT".to_string())?
            .map_err(|_| "PRINT_FAILED".to_string())?
    }
    .await;
    let _ = window.destroy();
    outcome
}

type Done = oneshot::Sender<Result<(), String>>;

unsafe fn start_print(
    webview: &tauri::webview::PlatformWebview,
    target: &HSTRING,
    page: PageSetup,
    done: Done,
) -> Result<(), (String, Done)> {
    let prepared = (|| -> windows_core::Result<_> {
        let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
        let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
        let settings = environment.CreatePrintSettings()?;
        settings.SetOrientation(if page.landscape {
            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
        } else {
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
        })?;
        settings.SetPageWidth(page.width)?;
        settings.SetPageHeight(page.height)?;
        settings.SetMarginTop(page.margin_top)?;
        settings.SetMarginRight(page.margin_right)?;
        settings.SetMarginBottom(page.margin_bottom)?;
        settings.SetMarginLeft(page.margin_left)?;
        settings.SetShouldPrintBackgrounds(true.into())?;
        settings.SetShouldPrintHeaderAndFooter(false.into())?;
        Ok((core, settings))
    })();
    let (core, settings) = match prepared {
        Ok(parts) => parts,
        Err(err) => return Err((format!("PRINT_UNSUPPORTED: {err}"), done)),
    };
    let done = Arc::new(Mutex::new(Some(done)));
    let finish = done.clone();
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |status, ok| {
        if let Some(tx) = finish.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = tx.send(match (status, ok) {
                (Ok(()), true) => Ok(()),
                _ => Err("PRINT_FAILED".to_string()),
            });
        }
        Ok(())
    }));
    if let Err(err) = core.PrintToPdf(target, &settings, &handler) {
        let tx = done.lock().ok().and_then(|mut slot| slot.take());
        if let Some(tx) = tx {
            return Err((format!("PRINT_FAILED: {err}"), tx));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::PageSetup;

    fn a4() -> PageSetup {
        PageSetup {
            width: 8.27,
            height: 11.69,
            margin_top: 0.8,
            margin_right: 1.0,
            margin_bottom: 0.8,
            margin_left: 1.0,
            landscape: false,
        }
    }

    #[test]
    fn accepts_a4_with_margins() {
        assert!(a4().checked().is_ok());
    }

    #[test]
    fn rejects_pages_without_room_for_content() {
        assert!(PageSetup { margin_left: 5.0, margin_right: 4.0, ..a4() }.checked().is_err());
        assert!(PageSetup { width: f64::NAN, ..a4() }.checked().is_err());
        assert!(PageSetup { height: 0.0, ..a4() }.checked().is_err());
    }
}

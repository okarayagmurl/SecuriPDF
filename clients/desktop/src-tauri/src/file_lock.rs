//! Keeps a read handle on a UNC path so other processes cannot replace the
//! file while it is open in the viewer (Adobe-style network file lock).

use std::collections::HashMap;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, OPEN_EXISTING,
};

#[derive(Default)]
pub struct FileLocks {
    handles: Mutex<HashMap<PathBuf, isize>>,
}

impl Drop for FileLocks {
    fn drop(&mut self) {
        unlock_all(self);
    }
}

pub fn is_network_path(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.starts_with("UNC\\") || rest.starts_with("UNC/");
    }
    text.starts_with(r"\\") || text.starts_with("//")
}

pub fn lock(locks: &FileLocks, path: &Path) -> Result<(), String> {
    if !is_network_path(path) {
        return Ok(());
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Ok(());
    }
    let mut map = locks.handles.lock().map_err(|_| "FILE_LOCK_FAILED".to_string())?;
    if let Some(previous) = map.insert(path.to_path_buf(), handle as isize) {
        unsafe { CloseHandle(previous as HANDLE) };
    }
    Ok(())
}

pub fn unlock(locks: &FileLocks, path: &Path) {
    let Ok(mut map) = locks.handles.lock() else {
        return;
    };
    if let Some(handle) = map.remove(path) {
        unsafe { CloseHandle(handle as HANDLE) };
    }
}

pub fn unlock_all(locks: &FileLocks) {
    let Ok(mut map) = locks.handles.lock() else {
        return;
    };
    for (_, handle) in map.drain() {
        unsafe { CloseHandle(handle as HANDLE) };
    }
}

#[cfg(test)]
mod tests {
    use super::is_network_path;
    use std::path::Path;

    #[test]
    fn detects_unc_and_local_paths() {
        assert!(is_network_path(Path::new(r"\\fileserver\share\a.pdf")));
        assert!(is_network_path(Path::new(r"\\?\UNC\fileserver\share\a.pdf")));
        assert!(!is_network_path(Path::new(r"C:\docs\a.pdf")));
        assert!(!is_network_path(Path::new(r"\\?\C:\docs\a.pdf")));
    }
}

//! Builds a QR code BMP so the watermark tool can stamp a URL or short text.

use qrcode::QrCode;

const SCALE: usize = 8;
const QUIET: usize = 4;
const MAX_CHARS: usize = 800;

#[tauri::command]
pub fn make_qr(text: String) -> Result<Vec<u8>, String> {
    render_bmp(&text)
}

pub(crate) fn render_bmp(text: &str) -> Result<Vec<u8>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("QR metni boş bırakılamaz.".into());
    }
    if text.len() > MAX_CHARS {
        return Err("QR metni en fazla 800 karakter olabilir.".into());
    }
    let code = QrCode::new(text.as_bytes()).map_err(|_| "Bu metinden QR kod üretilemedi.".to_string())?;
    let modules = code.width();
    let width = (modules + QUIET * 2) * SCALE;
    Ok(bmp(width, |x, y| {
        let col = x / SCALE;
        let row = y / SCALE;
        col >= QUIET
            && row >= QUIET
            && col < QUIET + modules
            && row < QUIET + modules
            && code[(col - QUIET, row - QUIET)] == qrcode::Color::Dark
    }))
}

fn bmp(width: usize, dark: impl Fn(usize, usize) -> bool) -> Vec<u8> {
    let row_bytes = width * 3;
    let stride = (row_bytes + 3) & !3;
    let pixels = stride * width;
    let mut out = Vec::with_capacity(54 + pixels);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(54 + pixels as u32).to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 24]);
    let mut row = vec![0u8; stride];
    for y in (0..width).rev() {
        for x in 0..width {
            let color = if dark(x, y) { 0 } else { 255 };
            let i = x * 3;
            row[i] = color;
            row[i + 1] = color;
            row[i + 2] = color;
        }
        out.extend_from_slice(&row);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{render_bmp, SCALE};

    #[test]
    fn empty_text_is_rejected() {
        assert!(render_bmp("").is_err());
        assert!(render_bmp("   ").is_err());
    }

    #[test]
    fn hello_makes_a_bitmap_with_finder() {
        let bytes = render_bmp("HELLO").expect("qr");
        assert_eq!(&bytes[0..2], b"BM");
        let width = i32::from_le_bytes(bytes[18..22].try_into().unwrap()) as usize;
        assert!(width >= 21 * SCALE);
        let stride = (width * 3 + 3) & !3;
        let pixel = |x: usize, y: usize| {
            let row = width - 1 - y;
            bytes[54 + row * stride + x * 3]
        };
        // Top-left finder pattern is a dark 3×3 after the quiet zone.
        assert_eq!(pixel(4 * SCALE, 4 * SCALE), 0);
        assert_eq!(pixel(0, 0), 255);
    }
}

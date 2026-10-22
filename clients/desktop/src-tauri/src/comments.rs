//! Writes sticky-note comments into a PDF as text annotations.

use lopdf::{dictionary, Document, Object, ObjectId, StringFormat};
use serde::Deserialize;
use std::io::Cursor;
use tauri::ipc::{InvokeBody, Request, Response};

const HEADER_COMMENTS: &str = "x-securipdf-comments";
const HEADER_STRIP: &str = "x-securipdf-strip-comments";

#[derive(Debug, Deserialize)]
struct CommentSpec {
    page: u32,
    x: f32,
    y: f32,
    text: String,
    #[serde(default)]
    color: String,
}

#[tauri::command]
pub async fn add_comments(request: Request<'_>) -> Result<Response, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("PDF yok.".into());
    };
    let json = crate::header(&request, HEADER_COMMENTS).ok_or("Yorum tanımı yok.")?;
    let json = crate::percent_decode(&json);
    let specs: Vec<CommentSpec> =
        serde_json::from_str(&json).map_err(|_| "Yorum tanımı okunamadı.".to_string())?;
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || add_comments_to(&body, &specs))
        .await
        .map_err(|err| err.to_string())?
        .map(Response::new)
}

#[derive(Debug, Deserialize)]
struct CommentKey {
    page: u32,
    text: String,
}

#[tauri::command]
pub async fn strip_comments(request: Request<'_>) -> Result<Response, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("PDF yok.".into());
    };
    let json = crate::header(&request, HEADER_STRIP).ok_or("Silinecek yorum yok.")?;
    let json = crate::percent_decode(&json);
    let keys: Vec<CommentKey> =
        serde_json::from_str(&json).map_err(|_| "Silinecek yorum okunamadı.".to_string())?;
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || strip_comments_from(&body, &keys))
        .await
        .map_err(|err| err.to_string())?
        .map(Response::new)
}

fn add_comments_to(pdf: &[u8], specs: &[CommentSpec]) -> Result<Vec<u8>, String> {
    if specs.is_empty() {
        return Ok(pdf.to_vec());
    }
    let mut doc = Document::load_from(Cursor::new(pdf))
        .map_err(|_| "PDF okunamadı. Dosya bozuk veya parolalı olabilir.".to_string())?;
    if doc.is_encrypted() {
        return Err("Parola korumalı PDF'e yorum eklenemez. Önce parolayı kaldırın.".into());
    }
    let mut wrote = 0;
    for spec in specs {
        if add_one(&mut doc, spec)? {
            wrote += 1;
        }
    }
    if wrote == 0 {
        return Err("Eklenecek yorum yok.".into());
    }
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|err| format!("Yorumlu PDF yazılamadı: {err}"))?;
    if out.len() < 5 || &out[..4] != b"%PDF" {
        return Err("Yorumlu PDF geçersiz.".into());
    }
    Ok(out)
}

fn add_one(doc: &mut Document, spec: &CommentSpec) -> Result<bool, String> {
    let text = spec.text.trim();
    if text.is_empty() || !spec.x.is_finite() || !spec.y.is_finite() {
        return Ok(false);
    }
    let text = text.chars().take(4000).collect::<String>();
    let pages = doc.get_pages();
    let page_id = *pages
        .get(&spec.page)
        .ok_or_else(|| format!("Sayfa {} yok.", spec.page))?;
    let size = 22.0;
    let annot = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Text",
        "Name" => "Comment",
        "F" => 4,
        "Open" => false,
        "P" => page_id,
        "Rect" => vec![
            Object::Real(spec.x),
            Object::Real(spec.y),
            Object::Real(spec.x + size),
            Object::Real(spec.y + size)
        ],
        "Contents" => pdf_string(&text),
        "T" => pdf_string("SecuriPDF"),
        "C" => color_array(parse_color(&spec.color)),
        "CA" => Object::Real(1.0)
    };
    let id = doc.add_object(annot);
    page_add_annot(doc, page_id, id)?;
    Ok(true)
}

fn parse_color(raw: &str) -> [f32; 3] {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() == 6 {
        if let Ok(value) = u32::from_str_radix(hex, 16) {
            return [
                ((value >> 16) & 255) as f32 / 255.0,
                ((value >> 8) & 255) as f32 / 255.0,
                (value & 255) as f32 / 255.0,
            ];
        }
    }
    [0.96, 0.62, 0.04]
}

fn color_array(color: [f32; 3]) -> Vec<Object> {
    color.into_iter().map(Object::Real).collect()
}

fn pdf_string(text: &str) -> Object {
    if text.is_ascii() {
        return Object::string_literal(text);
    }
    let mut bytes = vec![0xFE, 0xFF];
    for unit in text.encode_utf16() {
        bytes.push((unit >> 8) as u8);
        bytes.push((unit & 0xFF) as u8);
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

fn strip_comments_from(pdf: &[u8], keys: &[CommentKey]) -> Result<Vec<u8>, String> {
    if keys.is_empty() {
        return Ok(pdf.to_vec());
    }
    let mut doc = Document::load_from(Cursor::new(pdf))
        .map_err(|_| "PDF okunamadı. Dosya bozuk veya parolalı olabilir.".to_string())?;
    if doc.is_encrypted() {
        return Err("Parola korumalı PDF'ten yorum silinemez. Önce parolayı kaldırın.".into());
    }
    for key in keys {
        let _ = strip_one(&mut doc, key);
    }
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|err| format!("Yorumu silinmiş PDF yazılamadı: {err}"))?;
    Ok(out)
}

fn strip_one(doc: &mut Document, key: &CommentKey) -> bool {
    let text = key.text.trim();
    if text.is_empty() {
        return false;
    }
    let pages = doc.get_pages();
    let Some(page_id) = pages.get(&key.page).copied() else {
        return false;
    };
    let (array_id, items) = match annot_array(doc, page_id) {
        Some(found) => found,
        None => return false,
    };
    let mut kept = Vec::new();
    let mut removed = false;
    for item in items {
        if !removed && annot_contents(doc, &item).as_deref() == Some(text) {
            removed = true;
            continue;
        }
        kept.push(item);
    }
    if !removed {
        return false;
    }
    if let Some(id) = array_id {
        if let Ok(Object::Array(arr)) = doc.get_object_mut(id) {
            *arr = kept;
            return true;
        }
        return false;
    }
    let Ok(page) = doc.get_object_mut(page_id) else {
        return false;
    };
    let Ok(dict) = page.as_dict_mut() else {
        return false;
    };
    dict.set("Annots", kept);
    true
}

fn annot_array(doc: &Document, page_id: ObjectId) -> Option<(Option<ObjectId>, Vec<Object>)> {
    let page = doc.get_object(page_id).ok()?.as_dict().ok()?;
    match page.get(b"Annots").ok()? {
        Object::Reference(id) => {
            let arr = doc.get_object(*id).ok()?.as_array().ok()?.clone();
            Some((Some(*id), arr))
        }
        Object::Array(arr) => Some((None, arr.clone())),
        _ => None,
    }
}

fn annot_contents(doc: &Document, item: &Object) -> Option<String> {
    let dict = match item {
        Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok()?,
        Object::Dictionary(dict) => dict,
        _ => return None,
    };
    let contents = dict.get(b"Contents").ok()?;
    object_text(contents)
}

fn object_text(obj: &Object) -> Option<String> {
    let Object::String(bytes, _) = obj else {
        return None;
    };
    let text = decode_pdf_bytes(bytes);
    let trimmed = text.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

fn decode_pdf_bytes(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let units: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter_map(|chunk| chunk.try_into().ok().map(u16::from_be_bytes))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn page_add_annot(doc: &mut Document, page_id: ObjectId, annot: ObjectId) -> Result<(), String> {
    let annots_ref = {
        let page = doc.get_object(page_id).map_err(|err| err.to_string())?;
        let dict = page.as_dict().map_err(|err| err.to_string())?;
        match dict.get(b"Annots") {
            Ok(Object::Reference(id)) => Some(*id),
            _ => None,
        }
    };
    if let Some(id) = annots_ref {
        if let Ok(Object::Array(arr)) = doc.get_object_mut(id) {
            arr.push(Object::Reference(annot));
            return Ok(());
        }
    }
    let page = doc.get_object_mut(page_id).map_err(|err| err.to_string())?;
    let dict = page.as_dict_mut().map_err(|err| err.to_string())?;
    match dict.get_mut(b"Annots") {
        Ok(Object::Array(arr)) => arr.push(Object::Reference(annot)),
        _ => dict.set("Annots", vec![Object::Reference(annot)]),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{add_comments_to, strip_comments_from, CommentKey, CommentSpec};
    use lopdf::{dictionary, Document, Object, Stream};
    use lopdf::content::Content;
    use std::io::Cursor;

    fn sample_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let content = Content { operations: vec![] };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Contents" => content_id
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id
        });
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn writes_a_sticky_comment() {
        let out = add_comments_to(
            &sample_pdf(),
            &[CommentSpec {
                page: 1,
                x: 40.0,
                y: 700.0,
                text: "Kontrol edilsin".into(),
                color: "#f59e0b".into(),
            }],
        )
        .unwrap();
        let doc = Document::load_from(Cursor::new(out)).unwrap();
        let annot = doc.objects.values().find(|object| {
            object.as_dict().ok().and_then(|dict| dict.get(b"Subtype").ok()).and_then(|name| name.as_name().ok()) == Some(b"Text")
        }).expect("text annotation");
        let contents = annot.as_dict().unwrap().get(b"Contents").unwrap().as_str().unwrap();
        assert_eq!(String::from_utf8_lossy(contents), "Kontrol edilsin");
    }

    #[test]
    fn strips_the_matching_comment() {
        let with = add_comments_to(
            &sample_pdf(),
            &[CommentSpec {
                page: 1,
                x: 40.0,
                y: 700.0,
                text: "Kontrol edilsin".into(),
                color: "#f59e0b".into(),
            }],
        )
        .unwrap();
        let out = strip_comments_from(
            &with,
            &[CommentKey { page: 1, text: "Kontrol edilsin".into() }],
        )
        .unwrap();
        let doc = Document::load_from(Cursor::new(out)).unwrap();
        let page_id = doc.get_pages()[&1];
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let annots = page.get(b"Annots").ok().and_then(|obj| match obj {
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|item| item.as_array().ok().cloned()),
            Object::Array(arr) => Some(arr.clone()),
            _ => None,
        });
        let left = annots.map(|arr| arr.len()).unwrap_or(0);
        assert_eq!(left, 0);
    }
}

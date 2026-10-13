//! Adds AcroForm widgets (text, checkbox, dropdown) so a PDF can be filled later.
//! Appearance streams are written for checkboxes; text fields rely on NeedAppearances.

use lopdf::{dictionary, Document, Object, ObjectId, Stream, StringFormat};
use serde::Deserialize;
use std::io::Cursor;
use tauri::ipc::{InvokeBody, Request, Response};

const HEADER_FIELDS: &str = "x-securipdf-form-fields";

#[derive(Debug, Deserialize)]
pub struct FieldSpec {
    pub page: u32,
    pub kind: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub multiline: bool,
}

#[tauri::command]
pub async fn add_form_fields(request: Request<'_>) -> Result<Response, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("PDF yok.".into());
    };
    let json = crate::header(&request, HEADER_FIELDS).ok_or("Alan tanımı yok.")?;
    let json = crate::percent_decode(&json);
    let specs: Vec<FieldSpec> =
        serde_json::from_str(&json).map_err(|_| "Alan tanımı okunamadı.".to_string())?;
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || add_fields(&body, &specs))
        .await
        .map_err(|err| err.to_string())?
        .map(Response::new)
}

pub fn add_fields(pdf: &[u8], specs: &[FieldSpec]) -> Result<Vec<u8>, String> {
    if specs.is_empty() {
        return Err("Eklenecek form alanı yok.".into());
    }
    let mut doc = Document::load_from(Cursor::new(pdf))
        .map_err(|_| "PDF okunamadı. Dosya bozuk veya parolalı olabilir.".to_string())?;
    if doc.is_encrypted() {
        return Err("Parola korumalı PDF'e form alanı eklenemez. Önce parolayı kaldırın.".into());
    }
    let helv = helvetica(&mut doc);
    for spec in specs {
        add_one(&mut doc, spec, helv)?;
    }
    attach_acroform(&mut doc, helv, specs)?;
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|err| format!("Formlu PDF yazılamadı: {err}"))?;
    if out.len() < 5 || &out[..4] != b"%PDF" {
        return Err("Formlu PDF geçersiz.".into());
    }
    Ok(out)
}

fn helvetica(doc: &mut Document) -> ObjectId {
    doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding"
    })
}

fn add_one(doc: &mut Document, spec: &FieldSpec, helv: ObjectId) -> Result<ObjectId, String> {
    let name = spec.name.trim();
    if name.is_empty() {
        return Err("Alan adı yazın.".into());
    }
    let width = spec.width.abs().max(12.0);
    let height = spec.height.abs().max(12.0);
    let x1 = spec.x.min(spec.x + spec.width);
    let y1 = spec.y.min(spec.y + spec.height);
    let x2 = x1 + width;
    let y2 = y1 + height;
    let pages = doc.get_pages();
    let page_id = *pages
        .get(&spec.page)
        .ok_or_else(|| format!("Sayfa {} yok.", spec.page))?;
    let kind = spec.kind.to_ascii_lowercase();
    let widget = match kind.as_str() {
        "checkbox" | "check" | "onay" => checkbox_widget(doc, spec, page_id, x1, y1, x2, y2, width, height)?,
        "dropdown" | "choice" | "liste" => choice_widget(doc, spec, page_id, x1, y1, x2, y2)?,
        _ => text_widget(doc, spec, page_id, helv, x1, y1, x2, y2)?,
    };
    page_add_annot(doc, page_id, widget)?;
    Ok(widget)
}

fn text_widget(
    doc: &mut Document,
    spec: &FieldSpec,
    page_id: ObjectId,
    helv: ObjectId,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
) -> Result<ObjectId, String> {
    let mut flags = 0;
    if spec.multiline {
        flags |= 1 << 12;
    }
    let mut widget = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Tx",
        "T" => pdf_string(spec.name.trim()),
        "F" => 4,
        "Ff" => flags,
        "P" => page_id,
        "Rect" => rect(x1, y1, x2, y2),
        "DA" => Object::string_literal("/Helv 11 Tf 0 g"),
        "Q" => 0,
        "MK" => dictionary! { "BG" => vec![1.into(), 1.into(), 1.into()] },
        "DR" => dictionary! { "Font" => dictionary! { "Helv" => helv } }
    };
    if !spec.value.is_empty() {
        widget.set("V", pdf_string(spec.value.as_str()));
        widget.set("DV", pdf_string(spec.value.as_str()));
    }
    Ok(doc.add_object(widget))
}

fn checkbox_widget(
    doc: &mut Document,
    spec: &FieldSpec,
    page_id: ObjectId,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    width: f32,
    height: f32,
) -> Result<ObjectId, String> {
    let on = appearance(doc, width, height, true);
    let off = appearance(doc, width, height, false);
    let checked = matches!(spec.value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on" | "evet");
    let state = if checked { "Yes" } else { "Off" };
    let widget = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Btn",
        "T" => pdf_string(spec.name.trim()),
        "F" => 4,
        "P" => page_id,
        "Rect" => rect(x1, y1, x2, y2),
        "AS" => Object::Name(state.as_bytes().to_vec()),
        "V" => Object::Name(state.as_bytes().to_vec()),
        "AP" => dictionary! {
            "N" => dictionary! {
                "Yes" => on,
                "Off" => off
            }
        }
    };
    Ok(doc.add_object(widget))
}

fn choice_widget(
    doc: &mut Document,
    spec: &FieldSpec,
    page_id: ObjectId,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
) -> Result<ObjectId, String> {
    let options: Vec<Object> = spec
        .options
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(pdf_string)
        .collect();
    if options.is_empty() {
        return Err("Liste için en az bir seçenek yazın (noktalı virgülle ayırın).".into());
    }
    let selected = if spec.value.trim().is_empty() {
        spec.options.iter().map(|item| item.trim()).find(|item| !item.is_empty()).unwrap_or("")
    } else {
        spec.value.trim()
    };
    let widget = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Ch",
        "T" => pdf_string(spec.name.trim()),
        "F" => 4,
        "Ff" => 1 << 17,
        "P" => page_id,
        "Rect" => rect(x1, y1, x2, y2),
        "DA" => Object::string_literal("/Helv 11 Tf 0 g"),
        "Opt" => options,
        "V" => pdf_string(selected),
        "DV" => pdf_string(selected)
    };
    Ok(doc.add_object(widget))
}

fn appearance(doc: &mut Document, width: f32, height: f32, checked: bool) -> ObjectId {
    let w = width.max(8.0);
    let h = height.max(8.0);
    let mut ops = format!("q 0.15 0.15 0.2 RG 0.9 0.92 0.95 rg 1 w 0.5 0.5 {} {} re B ", w - 1.0, h - 1.0);
    if checked {
        ops.push_str(&format!(
            "0.11 0.45 0.27 RG 1.6 w {0} {1} m {2} {3} l {4} {5} l S ",
            w * 0.22,
            h * 0.48,
            w * 0.42,
            h * 0.22,
            w * 0.78,
            h * 0.78
        ));
    }
    ops.push_str("Q");
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => rect(0.0, 0.0, w, h),
            "Resources" => dictionary! {}
        },
        ops.into_bytes(),
    );
    doc.add_object(stream)
}

fn attach_acroform(doc: &mut Document, helv: ObjectId, specs: &[FieldSpec]) -> Result<(), String> {
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| "PDF katalogu okunamadı.".to_string())?;
    let mut fields: Vec<Object> = existing_fields(doc, catalog_id);
    let pages = doc.get_pages();
    for spec in specs {
        if let Some(page_id) = pages.get(&spec.page) {
            if let Some(annot) = last_annot_named(doc, *page_id, spec.name.trim()) {
                fields.push(Object::Reference(annot));
            }
        }
    }
    fields.sort_by_key(|item| match item {
        Object::Reference(id) => (id.0, id.1),
        _ => (0, 0),
    });
    fields.dedup();
    let acro = doc.add_object(dictionary! {
        "Fields" => fields,
        "NeedAppearances" => true,
        "DA" => Object::string_literal("/Helv 11 Tf 0 g"),
        "DR" => dictionary! { "Font" => dictionary! { "Helv" => helv } }
    });
    let catalog = doc.get_object_mut(catalog_id).map_err(|err| err.to_string())?;
    let dict = catalog.as_dict_mut().map_err(|err| err.to_string())?;
    dict.set("AcroForm", acro);
    Ok(())
}

fn existing_fields(doc: &Document, catalog_id: ObjectId) -> Vec<Object> {
    let Ok(Object::Dictionary(catalog)) = doc.get_object(catalog_id) else {
        return Vec::new();
    };
    let Ok(acro) = catalog.get(b"AcroForm") else {
        return Vec::new();
    };
    let dict = match acro {
        Object::Reference(id) => match doc.get_object(*id) {
            Ok(Object::Dictionary(inner)) => inner,
            _ => return Vec::new(),
        },
        Object::Dictionary(inner) => inner,
        _ => return Vec::new(),
    };
    match dict.get(b"Fields") {
        Ok(Object::Array(items)) => items.clone(),
        _ => Vec::new(),
    }
}

fn last_annot_named(doc: &Document, page_id: ObjectId, name: &str) -> Option<ObjectId> {
    let Object::Dictionary(page) = doc.get_object(page_id).ok()? else {
        return None;
    };
    let annots = match page.get(b"Annots") {
        Ok(Object::Array(items)) => items.clone(),
        Ok(Object::Reference(id)) => match doc.get_object(*id).ok()? {
            Object::Array(items) => items.clone(),
            _ => return None,
        },
        _ => return None,
    };
    annots.into_iter().rev().find_map(|item| {
        let Object::Reference(id) = item else { return None };
        let Object::Dictionary(dict) = doc.get_object(id).ok()? else { return None };
        let Object::String(bytes, _) = dict.get(b"T").ok()? else { return None };
        let label = pdf_string_text(bytes);
        (label == name).then_some(id)
    })
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

fn pdf_string_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn rect(x1: f32, y1: f32, x2: f32, y2: f32) -> Vec<Object> {
    vec![
        Object::Real(x1),
        Object::Real(y1),
        Object::Real(x2),
        Object::Real(y2),
    ]
}

#[cfg(test)]
mod tests {
    use super::{add_fields, FieldSpec};
    use lopdf::{dictionary, Document, Object, Stream};
    use lopdf::content::Content;

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
    fn adds_text_and_checkbox() {
        let pdf = sample_pdf();
        let out = add_fields(
            &pdf,
            &[
                FieldSpec {
                    page: 1,
                    kind: "text".into(),
                    name: "ad".into(),
                    x: 72.0,
                    y: 700.0,
                    width: 200.0,
                    height: 18.0,
                    value: "Ayşe".into(),
                    options: vec![],
                    multiline: false,
                },
                FieldSpec {
                    page: 1,
                    kind: "checkbox".into(),
                    name: "onay".into(),
                    x: 72.0,
                    y: 670.0,
                    width: 14.0,
                    height: 14.0,
                    value: "yes".into(),
                    options: vec![],
                    multiline: false,
                },
                FieldSpec {
                    page: 1,
                    kind: "dropdown".into(),
                    name: "il".into(),
                    x: 72.0,
                    y: 640.0,
                    width: 160.0,
                    height: 18.0,
                    value: "Ankara".into(),
                    options: vec!["Ankara".into(), "İstanbul".into()],
                    multiline: false,
                },
            ],
        )
        .expect("fields");
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("/FT") && text.contains("/Tx"), "{text}");
        assert!(text.contains("/Btn"), "{text}");
        assert!(text.contains("/Ch"), "{text}");
        assert!(text.contains("ad"), "{text}");
        assert!(text.contains("onay"), "{text}");
        assert!(text.contains("/AcroForm"), "{text}");
        assert!(text.contains("/NeedAppearances"), "{text}");
    }
}

//! Writes drawn shapes into a PDF as ink annotations with an appearance stream.

use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;
use std::io::Cursor;
use tauri::ipc::{InvokeBody, Request, Response};

const HEADER_SHAPES: &str = "x-securipdf-shapes";

#[derive(Debug, Deserialize)]
struct ShapePath {
    points: Vec<f32>,
    #[serde(default)]
    close: bool,
    #[serde(default)]
    fill: bool,
}

#[derive(Debug, Deserialize)]
struct ShapeSpec {
    page: u32,
    #[serde(default)]
    color: String,
    #[serde(default = "default_stroke")]
    stroke: f32,
    paths: Vec<ShapePath>,
}

fn default_stroke() -> f32 {
    1.6
}

#[tauri::command]
pub async fn add_shapes(request: Request<'_>) -> Result<Response, String> {
    crate::license::require()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("PDF yok.".into());
    };
    let json = crate::header(&request, HEADER_SHAPES).ok_or("Şekil tanımı yok.")?;
    let json = crate::percent_decode(&json);
    let specs: Vec<ShapeSpec> =
        serde_json::from_str(&json).map_err(|_| "Şekil tanımı okunamadı.".to_string())?;
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || add_shapes_to(&body, &specs))
        .await
        .map_err(|err| err.to_string())?
        .map(Response::new)
}

fn add_shapes_to(pdf: &[u8], specs: &[ShapeSpec]) -> Result<Vec<u8>, String> {
    if specs.is_empty() {
        return Ok(pdf.to_vec());
    }
    let mut doc = Document::load_from(Cursor::new(pdf))
        .map_err(|_| "PDF okunamadı. Dosya bozuk veya parolalı olabilir.".to_string())?;
    if doc.is_encrypted() {
        return Err("Parola korumalı PDF'e şekil eklenemez. Önce parolayı kaldırın.".into());
    }
    let mut wrote = 0;
    for spec in specs {
        if add_one(&mut doc, spec)? {
            wrote += 1;
        }
    }
    if wrote == 0 {
        return Err("Eklenecek şekil yok.".into());
    }
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|err| format!("Şekilli PDF yazılamadı: {err}"))?;
    if out.len() < 5 || &out[..4] != b"%PDF" {
        return Err("Şekilli PDF geçersiz.".into());
    }
    Ok(out)
}

fn add_one(doc: &mut Document, spec: &ShapeSpec) -> Result<bool, String> {
    let stroke = if spec.stroke.is_finite() && spec.stroke > 0.2 && spec.stroke < 24.0 {
        spec.stroke
    } else {
        default_stroke()
    };
    let mut page_paths: Vec<(Vec<(f32, f32)>, bool, bool)> = Vec::new();
    for path in &spec.paths {
        let pts = pairs(&path.points);
        if pts.len() < 2 {
            continue;
        }
        page_paths.push((pts, path.close, path.fill));
    }
    if page_paths.is_empty() {
        return Ok(false);
    }
    let pad = stroke + 1.0;
    let (min_x, min_y, max_x, max_y) = bounds(&page_paths, pad);
    let width = (max_x - min_x).max(1.0);
    let height = (max_y - min_y).max(1.0);
    let color = parse_color(&spec.color);
    let form_paths: Vec<(Vec<(f32, f32)>, bool, bool)> = page_paths
        .iter()
        .map(|(pts, close, fill)| {
            (
                pts.iter().map(|(x, y)| (x - min_x, y - min_y)).collect(),
                *close,
                *fill,
            )
        })
        .collect();
    let appearance = appearance_stream(doc, width, height, color, stroke, &form_paths);
    let ink = ink_list(&page_paths);
    let pages = doc.get_pages();
    let page_id = *pages
        .get(&spec.page)
        .ok_or_else(|| format!("Sayfa {} yok.", spec.page))?;
    let annot = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Ink",
        "F" => 4,
        "P" => page_id,
        "Rect" => rect(min_x, min_y, max_x, max_y),
        "C" => color_array(color),
        "CA" => Object::Real(1.0),
        "BS" => dictionary! {
            "W" => Object::Real(stroke),
            "S" => "S"
        },
        "InkList" => ink,
        "AP" => dictionary! { "N" => appearance }
    };
    let id = doc.add_object(annot);
    page_add_annot(doc, page_id, id)?;
    Ok(true)
}

fn pairs(points: &[f32]) -> Vec<(f32, f32)> {
    points
        .chunks_exact(2)
        .filter(|pair| pair[0].is_finite() && pair[1].is_finite())
        .map(|pair| (pair[0], pair[1]))
        .collect()
}

fn bounds(paths: &[(Vec<(f32, f32)>, bool, bool)], pad: f32) -> (f32, f32, f32, f32) {
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for (pts, _, _) in paths {
        for (x, y) in pts {
            min_x = min_x.min(*x);
            min_y = min_y.min(*y);
            max_x = max_x.max(*x);
            max_y = max_y.max(*y);
        }
    }
    (min_x - pad, min_y - pad, max_x + pad, max_y + pad)
}

fn appearance_stream(
    doc: &mut Document,
    width: f32,
    height: f32,
    color: [f32; 3],
    stroke: f32,
    paths: &[(Vec<(f32, f32)>, bool, bool)],
) -> ObjectId {
    let mut ops = format!(
        "q\n{:.4} {:.4} {:.4} RG\n{:.4} {:.4} {:.4} rg\n{:.2} w\n1 J\n1 j\n",
        color[0], color[1], color[2], color[0], color[1], color[2], stroke
    );
    for (pts, close, fill) in paths {
        if pts.len() < 2 {
            continue;
        }
        ops.push_str(&format!("{:.2} {:.2} m\n", pts[0].0, pts[0].1));
        for (x, y) in pts.iter().skip(1) {
            ops.push_str(&format!("{:.2} {:.2} l\n", x, y));
        }
        if *close {
            ops.push_str("h\n");
        }
        ops.push_str(if *fill { "B\n" } else { "S\n" });
    }
    ops.push_str("Q\n");
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => rect(0.0, 0.0, width, height),
            "Resources" => dictionary! {}
        },
        ops.into_bytes(),
    );
    doc.add_object(stream)
}

fn ink_list(paths: &[(Vec<(f32, f32)>, bool, bool)]) -> Vec<Object> {
    paths
        .iter()
        .map(|(pts, _, _)| {
            Object::Array(
                pts.iter()
                    .flat_map(|(x, y)| [Object::Real(*x), Object::Real(*y)])
                    .collect(),
            )
        })
        .collect()
}

fn parse_color(raw: &str) -> [f32; 3] {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
        }
    }
    [0.882, 0.114, 0.282]
}

fn color_array(color: [f32; 3]) -> Vec<Object> {
    color.into_iter().map(Object::Real).collect()
}

fn rect(x1: f32, y1: f32, x2: f32, y2: f32) -> Vec<Object> {
    vec![
        Object::Real(x1),
        Object::Real(y1),
        Object::Real(x2),
        Object::Real(y2),
    ]
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
    use super::{add_shapes_to, ShapePath, ShapeSpec};
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
    fn writes_a_rectangle_shape() {
        let out = add_shapes_to(
            &sample_pdf(),
            &[ShapeSpec {
                page: 1,
                color: "#e11d48".into(),
                stroke: 1.6,
                paths: vec![ShapePath {
                    points: vec![72.0, 700.0, 180.0, 700.0, 180.0, 760.0, 72.0, 760.0],
                    close: true,
                    fill: false,
                }],
            }],
        )
        .unwrap();
        let doc = Document::load_from(Cursor::new(out)).unwrap();
        let pages = doc.get_pages();
        let page = doc.get_object(pages[&1]).unwrap().as_dict().unwrap();
        let annots = page.get(b"Annots").unwrap().as_array().unwrap();
        assert_eq!(annots.len(), 1);
        let Object::Reference(id) = annots[0] else { panic!("annot ref") };
        let annot = doc.get_object(id).unwrap().as_dict().unwrap();
        assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
        let ap = annot.get(b"AP").unwrap().as_dict().unwrap();
        let Object::Reference(stream_id) = ap.get(b"N").unwrap() else { panic!("appearance") };
        let stream = doc.get_object(*stream_id).unwrap().as_stream().unwrap();
        let content = String::from_utf8_lossy(&stream.content);
        assert!(content.contains(" m\n"), "{content}");
        assert!(content.contains("\nh\n"), "{content}");
    }
}

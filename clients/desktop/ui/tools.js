// Field names and option values follow the Stirling-PDF 3.1.0 OpenAPI spec (/v1/api-docs).
(function () {
  const PDF = ".pdf,application/pdf";
  const IMAGES = ".jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp,image/*";
  const UDF = ".udf";
  const XML = ".xml,text/xml,application/xml";
  const OFFICE = ".doc,.docx,.docm,.dot,.dotx,.rtf,.odt,.txt,.xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.ppt,.pptx,.pptm,.pps,.ppsx,.odp";

  const MARGINS = [
    { value: "small", label: "Küçük" },
    { value: "medium", label: "Orta" },
    { value: "large", label: "Büyük" },
    { value: "x-large", label: "Çok büyük" },
  ];
  const FONT_TYPES = [
    { value: "helvetica", label: "Helvetica" },
    { value: "times", label: "Times" },
    { value: "courier", label: "Courier" },
  ];
  const ALPHABETS = [
    { value: "roman", label: "Latin (Türkçe)" },
    { value: "arabic", label: "Arapça" },
    { value: "japanese", label: "Japonca" },
    { value: "korean", label: "Korece" },
    { value: "chinese", label: "Çince" },
    { value: "thai", label: "Tayca" },
  ];
  const COLOR_TYPES = [
    { value: "color", label: "Renkli" },
    { value: "greyscale", label: "Gri tonlamalı" },
    { value: "blackwhite", label: "Siyah-beyaz" },
  ];
  const ORIENTATIONS = [
    { value: "PORTRAIT", label: "Dikey" },
    { value: "LANDSCAPE", label: "Yatay" },
  ];
  const pageHint = "Örnek: 1,3,5-9. Tümü için all yazın.";

  const colorDecimal = (hex) => {
    const value = parseInt(String(hex || "").replace("#", ""), 16);
    return String(Number.isFinite(value) ? value : 0);
  };

  const safeFileName = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

  const HARDWARE = "/api/v1/security/cert-sign/hardware";
  const CERTS = ".cer,.crt,.pem,.der";

  async function windowsCertificates({ get }) {
    const list = await get(`${HARDWARE}/windows-certificates`);
    const usable = (cert) => !cert.expired && !cert.notYetValid;
    return list.filter(usable).concat(list.filter((cert) => !usable(cert))).map((cert) => ({
      value: cert.alias,
      label: `${cert.subjectCommonName || cert.subject || cert.alias} · ${String(cert.notAfter || "").slice(0, 10)}` +
        (cert.expired ? " (süresi dolmuş)" : cert.notYetValid ? " (henüz geçerli değil)" : ""),
    }));
  }

  async function tokenDrivers({ get }) {
    const capabilities = await get(`${HARDWARE}/capabilities`);
    return (capabilities.detectedLibraries || []).map((lib) => ({ value: lib.path, label: `${lib.name} (${lib.path})` }));
  }

  // Same pattern set as the web redaction studio (services/platform/app/redaction_presets.py).
  const REDACT_PRESETS = {
    tckn: /\b[1-9][0-9]{10}\b/g,
    vkn: /\b[0-9]{10}\b/g,
    mobile_tr: /(?:\+?90[\s.-]?|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}|\+?90[\s.-]?5\d{9}|\b90[\s.-]?5\d{9}\b/g,
    phone_tr: /(?:\+?90[\s.-]?|0)?[\s.-]*\(?(?:2\d{2}|3\d{2}|4\d{2}|5\d{2})\)?[\s.-]*(?:\d{7}|\d{3}[\s.-]?\d{2}[\s.-]?\d{2})|\+?90[\s.-]?[2345]\d{9}|\b90[\s.-]?\(?[2345]\d{2}\)?[\s.-]*\d{7}\b/g,
    email: /[a-zA-Z0-9][a-zA-Z0-9._%+\-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.\-]{0,62}\.[a-zA-Z]{2,}/g,
    passport: /\b[A-Z]{1,2}[0-9]{6,9}\b/g,
    iban_tr: /TR\d{2}[\s]?(?:\d{4}[\s]?){5}\d{2}/gi,
    credit_card: /\b(?:\d{4}[\s\-]?){3}\d{4,7}\b/g,
    postal_code_tr: /\b[0-9]{5}\b/g,
    address_tr: /[\wÇĞİÖŞÜçğıöşü''\-\.]+\s+(?:mah\.?|mahallesi?|mh\.?)\s+.{5,200}?(?:sk\.?|sok\.?|sokak|cad\.?|cadde|cd\.?|bulvar|blv\.?|site(?:si)?|sit\.?).{0,140}?(?:no\.?\s*:?\s*\d+).{0,120}?[A-ZÇĞİÖŞÜ][A-Za-zçğıöşü''\-]+(?:\s*\/\s*[A-ZÇĞİÖŞÜ][A-Za-zçğıöşü''\-]+)?/giu,
  };
  REDACT_PRESETS.phone = REDACT_PRESETS.mobile_tr;
  REDACT_PRESETS.iban = REDACT_PRESETS.iban_tr;
  REDACT_PRESETS.card = REDACT_PRESETS.credit_card;

  /** Global RegExps for the form values; throws when a regular expression is invalid. */
  function redactPatterns(v) {
    const escape = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
    // JavaScript does not fold the Turkish dotted and dotless i into each other.
    const turkishI = (pattern) => pattern.replace(/[iİıI]/g, "[iİıI]");
    const words = v.words.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      let source = v.regex ? line : escape(line);
      if (v.ignoreCase && !v.regex) source = turkishI(source);
      if (v.wholeWord) source = `(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`;
      try {
        return new RegExp(source, v.ignoreCase ? "giu" : "gu");
      } catch {
        throw new Error(`Düzenli ifade geçersiz: ${line}`);
      }
    });
    return words.concat(v.presets.map((key) => REDACT_PRESETS[key]).filter(Boolean).map((pattern) => new RegExp(pattern)));
  }

  // The engine's own text search misplaces boxes and leaves text behind, so
  // the matches are located with PDF.js and the engine only paints the boxes
  // and turns the pages into images, which removes the text underneath.
  async function redact({ files, values, engine, note }) {
    const file = files.fileInput[0];
    const patterns = redactPatterns(values);
    let boxes = await window.SecuriPreview.textBoxes(file, patterns);
    if (!boxes.length) throw new Error("Aranan metinler belgede bulunamadı. Taranmış bir belgeyse önce OCR uygulayın.");
    let input = file;
    // FreeText/form text sits above page content. Flatten it into the page
    // first so convert-to-image cannot paint the original words on top of the boxes.
    if (boxes.some((box) => box.annotation)) {
      const flatten = new FormData();
      flatten.append("fileInput", file, file.name);
      flatten.append("flattenOnlyForms", "false");
      input = new File([await engine("/api/v1/misc/flatten", flatten)], file.name, { type: "application/pdf" });
      const after = await window.SecuriPreview.textBoxes(input, patterns);
      if (after.length) boxes = after;
    }
    const form = new FormData();
    form.append("fileInput", input, file.name);
    form.append("redactions", JSON.stringify(boxes.map((box) => ({
      page: box.page, x: box.x, y: box.y, width: box.width, height: box.height, color: values.redactColor,
    }))));
    form.append("convertPDFToImage", "true");
    let bytes = await engine("/api/v1/security/redact", form);
    if (values.ocr) {
      const ocr = new FormData();
      ocr.append("fileInput", new File([bytes], file.name, { type: "application/pdf" }), file.name);
      ["tur", "eng"].forEach((language) => ocr.append("languages", language));
      Object.entries({ ocrType: "skip-text", ocrRenderType: "hocr", deskew: "false", clean: "false", cleanFinal: "false", sidecar: "false", removeImagesAfter: "false" })
        .forEach(([key, value]) => ocr.append(key, value));
      bytes = await engine("/api/v1/misc/ocr-pdf", ocr);
    }
    note(`${boxes.length} alan karartıldı`);
    return bytes;
  }

  async function qrPng(bmp) {
    const url = URL.createObjectURL(new Blob([bmp], { type: "image/bmp" }));
    try {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error("QR görseli okunamadı."));
        node.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("QR görseli yazılamadı."))), "image/png");
      });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function signError(status, detail) {
    if (/CertificateExpired/i.test(detail)) return "Seçilen sertifikanın süresi dolmuş.";
    if (/CertificateNotYetValid/i.test(detail)) return "Seçilen sertifika henüz geçerli değil.";
    if (/password|keystore|mac check|decrypt|\bPIN\b|CKR_PIN|login/i.test(detail)) return "Sertifika açılamadı. Parolayı veya PIN'i kontrol edin.";
    if (/allowed list/i.test(detail)) return "Bu kart sürücüsünün kullanılmasına izin verilmiyor.";
    if (/alias/i.test(detail)) return "Seçilen sertifika bulunamadı. Kartın takılı olduğundan emin olup listeyi yenileyin.";
    if (/desktop app/i.test(detail)) return "Donanımla imzalama yalnızca masaüstü uygulamasında kullanılabilir.";
    return detail ? `İmzalanamadı: ${detail}` : null;
  }

  function pdfFile(bytes, name) {
    return new File([bytes], name, { type: "application/pdf" });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function pageInches(pt) {
    return Math.min(50, Math.max(1, Number(pt) / 72 || 8.27));
  }

  // WebView2'nin bastığı PDF, PDFBox bindirmesinde sık sık 500 veriyor.
  // Düz renk için motorun okuyabildiği sade bir PDF üretilir.
  function solidColorPdf(pages, hex) {
    const color = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#f8fafc";
    const channels = [1, 3, 5].map((start) => (parseInt(color.slice(start, start + 2), 16) / 255).toFixed(3));
    const paint = `${channels.join(" ")} rg\n`;
    const contentIds = [];
    const pageIds = [];
    let next = 3;
    pages.forEach(() => {
      contentIds.push(next);
      pageIds.push(next + 1);
      next += 2;
    });
    const chunks = ["%PDF-1.4\n"];
    const offsets = [0];
    const add = (body) => {
      offsets.push(chunks.join("").length);
      chunks.push(body);
    };
    add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    add(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
    pages.forEach((page, index) => {
      const width = Math.max(1, Number(page.width) || 595).toFixed(2);
      const height = Math.max(1, Number(page.height) || 842).toFixed(2);
      const stream = `${paint}0 0 ${width} ${height} re\nf\n`;
      add(`${contentIds[index]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
      add(`${pageIds[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentIds[index]} 0 R >>\nendobj\n`);
    });
    const startxref = chunks.join("").length;
    let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index++) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    chunks.push(`${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
    const text = chunks.join("");
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 255;
    return bytes;
  }

  async function extractPages(engine, file, pageNumbers) {
    const form = new FormData();
    form.append("fileInput", file, file.name || "belge.pdf");
    form.append("pageNumbers", String(pageNumbers));
    form.append("customMode", "CUSTOM");
    return engine("/api/v1/general/rearrange-pages", form);
  }

  async function mergePdfs(engine, files) {
    const form = new FormData();
    files.forEach((file, index) => form.append("fileInput", file, file.name || `parca-${index + 1}.pdf`));
    form.append("sortType", "orderProvided");
    form.append("removeCertSign", "true");
    return engine("/api/v1/general/merge-pdfs", form);
  }

  async function deflateBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  const pdfText = (value) => new TextEncoder().encode(value);

  const pdfNum = (value) => (Math.round(Number(value) * 100) / 100).toFixed(2);

  // A printed HTML page is an opaque sheet, so overlaying it hides the document
  // and PDFBox often rejects the print file. This page draws only the image.
  async function imageLayerPdf(page, file, x, yTop, widthPt) {
    const source = await createImageBitmap(file);
    try {
      const drawWidth = Math.max(4, Number(widthPt) || 4);
      const drawHeight = Math.max(4, drawWidth * source.height / Math.max(1, source.width));
      const longest = Math.max(drawWidth, drawHeight);
      const pixelScale = Math.min(2, 1400 / longest);
      const pixelWidth = Math.max(1, Math.round(drawWidth * pixelScale));
      const pixelHeight = Math.max(1, Math.round(drawHeight * pixelScale));
      const canvas = document.createElement("canvas");
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx.drawImage(source, 0, 0, pixelWidth, pixelHeight);
      const pixels = ctx.getImageData(0, 0, pixelWidth, pixelHeight).data;
      const rgb = new Uint8Array(pixelWidth * pixelHeight * 3);
      const alpha = new Uint8Array(pixelWidth * pixelHeight);
      for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
        rgb[pixel * 3] = pixels[index];
        rgb[pixel * 3 + 1] = pixels[index + 1];
        rgb[pixel * 3 + 2] = pixels[index + 2];
        alpha[pixel] = pixels[index + 3];
      }
      const [rgbDeflated, alphaDeflated] = await Promise.all([deflateBytes(rgb), deflateBytes(alpha)]);
      const pageWidth = Math.max(1, Number(page.width) || 595);
      const pageHeight = Math.max(1, Number(page.height) || 842);
      const left = Math.max(0, Number(x) || 0);
      const top = Math.max(0, Number(yTop) || 0);
      const bottom = pageHeight - top - drawHeight;
      const content = `q\n${pdfNum(drawWidth)} 0 0 ${pdfNum(drawHeight)} ${pdfNum(left)} ${pdfNum(bottom)} cm\n/Im0 Do\nQ\n`;
      const objects = [
        pdfText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
        pdfText("2 0 obj\n<< /Type /Pages /Kids [6 0 R] /Count 1 >>\nendobj\n"),
        pdfText(`3 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`),
        concatBytes([
          pdfText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${rgbDeflated.length} /SMask 5 0 R >>\nstream\n`),
          rgbDeflated,
          pdfText("\nendstream\nendobj\n"),
        ]),
        concatBytes([
          pdfText(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alphaDeflated.length} >>\nstream\n`),
          alphaDeflated,
          pdfText("\nendstream\nendobj\n"),
        ]),
        pdfText(`6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(pageWidth)} ${pdfNum(pageHeight)}] /Contents 3 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>\nendobj\n`),
      ];
      const header = pdfText("%PDF-1.4\n");
      let offset = header.length;
      const offsets = [0];
      objects.forEach((body) => {
        offsets.push(offset);
        offset += body.length;
      });
      let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
      for (let index = 1; index < offsets.length; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
      const trailer = pdfText(`${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
      return concatBytes([header, ...objects, trailer]);
    } finally {
      source.close();
    }
  }

  async function overlayPdfs(engine, base, overlay, behind) {
    const form = new FormData();
    form.append("fileInput", pdfFile(base, "ana.pdf"), "ana.pdf");
    form.append("overlayFiles", pdfFile(overlay, "bindir.pdf"), "bindir.pdf");
    form.append("overlayMode", "SequentialOverlay");
    form.append("overlayPosition", behind ? "1" : "0");
    return engine("/api/v1/general/overlay-pdfs", form);
  }

  async function numberStamp(engine, file, text, position, fontSize, fontColor, fontType) {
    const form = new FormData();
    form.append("fileInput", file, file.name || "belge.pdf");
    form.append("customText", text);
    form.append("position", String(position));
    form.append("startingNumber", "1");
    form.append("pagesToNumber", "all");
    form.append("pageNumbers", "all");
    form.append("fontSize", String(fontSize || 12));
    form.append("fontType", fontType || "helvetica");
    form.append("fontColor", fontColor || "#000000");
    form.append("customMargin", "medium");
    return engine("/api/v1/misc/add-page-numbers", form);
  }

  async function fileDataUrl(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    const mime = file.type || (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
    return `data:${mime};base64,${btoa(binary)}`;
  }

  async function readJson(engine, path, file) {
    const form = new FormData();
    form.append("fileInput", file, file.name || "belge.pdf");
    const bytes = await engine(path, form);
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }

  async function pdfInfo(engine, file) {
    try {
      return await readJson(engine, "/api/v1/security/get-info-on-pdf", file);
    } catch {
      return readJson(engine, "/api/v1/misc/get-info-on-pdf", file);
    }
  }

  window.SECURIPDF_CATEGORIES = [
    { id: "view", title: "Görüntüle" },
    { id: "edit", title: "Düzenle" },
    { id: "ocr", title: "Metin tanıma" },
    { id: "pages", title: "Sayfalar" },
    { id: "security", title: "Güvenlik" },
    { id: "sign", title: "E-imza" },
    { id: "convert", title: "Dönüştür" },
    { id: "optimize", title: "Optimize" },
  ];

  window.SECURIPDF_TOOLS = [
    {
      id: "open-pdf",
      category: "view",
      title: "Belge aç",
      description: "PDF'i açın; yazdırın, arayın, form ekleyip doldurun, işaretleyin veya seçilen satırı ve hücreyi değiştirin. Uzun düzenleme için Word'e dönüştürün.",
      viewer: true,
      batch: false,
      files: [{ name: "fileInput", label: "PDF belgesi", accept: PDF }],
      fields: [
        { name: "protectedView", label: "Korumalı aç (JavaScript, ek ve bağlantıları kaldır)", type: "checkbox", default: false, local: true,
          hint: "Adobe korumalı görünümünün karşılığı: belge önce temizlenir, sonra görüntülenir." },
      ],
    },
    {
      id: "merge-pdfs",
      category: "edit",
      title: "PDF Birleştir",
      description: "Birden fazla PDF dosyasını tek belgede birleştirin. Dosyalar listedeki sırayla eklenir.",
      apiPath: "/api/v1/general/merge-pdfs",
      suffix: "birlesik",
      files: [{ name: "fileInput", label: "PDF dosyaları", accept: PDF, multiple: true, min: 2 }],
      fields: [
        { name: "sortType", label: "Sıralama", type: "select", default: "orderProvided", options: [
          { value: "orderProvided", label: "Listedeki sıra" },
          { value: "byFileName", label: "Dosya adına göre" },
          { value: "byDateModified", label: "Değiştirilme tarihine göre" },
          { value: "byDateCreated", label: "Oluşturulma tarihine göre" },
          { value: "byPDFTitle", label: "PDF başlığına göre" },
        ] },
        { name: "removeCertSign", label: "Sertifika imzalarını kaldır", type: "checkbox", default: true },
        { name: "generateToc", label: "İçindekiler sayfası oluştur", type: "checkbox", default: false },
      ],
    },
    {
      id: "split-pages",
      category: "edit",
      title: "PDF Böl",
      description: "PDF'i sayfa numarasına, sayfa sayısına, boyuta veya sayfa bölümlerine göre ayırın. Birden çok parça ZIP olarak kaydedilir.",
      apiPath: (v) => ({
        pages: "/api/v1/general/split-pages",
        count: "/api/v1/general/split-by-size-or-count",
        sections: "/api/v1/general/split-pdf-by-sections",
      })[v.mode],
      suffix: "bolunmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "mode", label: "Bölme şekli", type: "select", local: true, default: "pages", options: [
          { value: "pages", label: "Belirli sayfalardan sonra" },
          { value: "count", label: "Sayfa sayısı, belge sayısı veya boyut" },
          { value: "sections", label: "Her sayfayı parçalara ayır" },
        ] },
        { name: "pageNumbers", label: "Hangi sayfalardan sonra kesilsin", type: "text", required: true, pagePicker: "split",
          placeholder: "2,5", hint: "Önizlemede sayfaya tıklayın veya yazın. Örnek: 2,5 yazılırsa 1-2, 3-5 ve 6-son olarak bölünür.",
          showIf: { mode: "pages" } },
        { name: "splitType", label: "Ölçüt", type: "select", default: "1", showIf: { mode: "count" }, options: [
          { value: "1", label: "Her parçada şu kadar sayfa" },
          { value: "2", label: "Şu kadar belgeye böl" },
          { value: "0", label: "Her parça en fazla şu boyutta" },
        ] },
        { name: "splitValue", label: "Değer", type: "text", required: true, default: "5",
          hint: "Boyut için MB yazın, örnek: 10MB.", showIf: { mode: "count" } },
        { name: "horizontalDivisions", label: "Yatay kesim sayısı", type: "number", default: 0, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "verticalDivisions", label: "Dikey kesim sayısı", type: "number", default: 1, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "merge", label: "Parçaları tek PDF'te birleştir", type: "checkbox", default: true, showIf: { mode: "sections" } },
      ],
      constants: (v) => (v.mode === "sections" ? { pageNumbers: "all", splitMode: "SPLIT_ALL" } : {}),
    },
    {
      id: "ocr-pdf",
      category: "ocr",
      title: "OCR / Aranabilir PDF",
      description: "Taranmış belgedeki metni tanıyıp görünmez bir metin katmanı ekler; belge aranabilir ve kopyalanabilir olur. Görünüm değişmez.",
      apiPath: "/api/v1/misc/ocr-pdf",
      suffix: "aranabilir",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "languages", label: "Belge dili", type: "checks", default: ["tur", "eng"], options: [
          { value: "tur", label: "Türkçe" },
          { value: "eng", label: "İngilizce" },
          { value: "deu", label: "Almanca" },
          { value: "fra", label: "Fransızca" },
          { value: "spa", label: "İspanyolca" },
          { value: "ita", label: "İtalyanca" },
          { value: "ara", label: "Arapça" },
        ] },
        { name: "ocrType", label: "Metin içeren sayfalar", type: "select", default: "skip-text", options: [
          { value: "skip-text", label: "Atla, yalnızca taranmış sayfaları tanı" },
          { value: "force-ocr", label: "Tüm sayfaları yeniden tanı" },
        ] },
        { name: "rotatePages", label: "Yanlış yöndeki sayfaları otomatik düzelt", type: "checkbox", default: true,
          hint: "Taranmış belgede yan veya ters sayfaları Tesseract OSD ile 90/180/270 döndürür." },
      ],
      constants: { ocrRenderType: "hocr", deskew: "false", clean: "false", cleanFinal: "false", sidecar: "false", removeImagesAfter: "false" },
      validate: (v) => (v.languages.length ? null : "En az bir dil seçin."),
    },
    {
      id: "overlay-pdf",
      category: "edit",
      title: "PDF Bindir",
      description: "Bir PDF'in sayfalarını başka bir PDF'in üzerine veya arkasına yerleştirin.",
      apiPath: "/api/v1/general/overlay-pdfs",
      suffix: "bindirilmis",
      files: [
        { name: "fileInput", label: "Ana PDF", accept: PDF },
        { name: "overlayFiles", label: "Bindirilecek PDF'ler", accept: PDF, multiple: true, min: 1 },
      ],
      fields: [
        { name: "overlayMode", label: "Yöntem", type: "select", default: "SequentialOverlay", options: [
          { value: "SequentialOverlay", label: "Sırayla" },
          { value: "InterleavedOverlay", label: "Dönüşümlü" },
          { value: "FixedRepeatOverlay", label: "Her dosyayı belirli sayıda tekrarla" },
        ] },
        { name: "counts", label: "Tekrar sayısı", type: "number", default: 1, min: 1, perFile: "overlayFiles",
          showIf: { overlayMode: "FixedRepeatOverlay" } },
        { name: "overlayPosition", label: "Konum", type: "select", default: "0", options: [
          { value: "0", label: "Önde" },
          { value: "1", label: "Arkada" },
        ] },
      ],
    },
    {
      id: "flatten",
      category: "edit",
      title: "Düzleştir",
      description: "Form alanlarını ve etkileşimli öğeleri sabit sayfa içeriğine dönüştürün. Form Doldur ile yazdığınız değerleri belgede kalıcı hale getirmek için kullanın.",
      apiPath: "/api/v1/misc/flatten",
      suffix: "duzlestirilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "flattenOnlyForms", label: "Yalnızca formları düzleştir", type: "checkbox", default: true,
          hint: "Kapalıysa her sayfa görsele çevrilir; metin seçilemez ve dosya büyür." },
      ],
    },
    {
      id: "rotate-pdf",
      category: "pages",
      title: "Döndür",
      description: "Tüm sayfaları saat yönünde döndürün.",
      apiPath: "/api/v1/general/rotate-pdf",
      suffix: "dondurulmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "angle", label: "Açı", type: "select", default: "90", options: [
          { value: "90", label: "90°" },
          { value: "180", label: "180°" },
          { value: "270", label: "270°" },
        ] },
      ],
    },
    {
      id: "auto-rotate-pdf",
      category: "pages",
      title: "Otomatik döndür",
      description: "Her sayfanın yönünü metin veya tarama algısıyla bulur; yan ve ters sayfaları dik konumuna çevirir. Taranmış belgelerde OCR'dan önce çalıştırın.",
      apiPath: "/api/v1/misc/auto-rotate-pdf",
      suffix: "duzeltilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "detectionMode", label: "Algılama", type: "select", default: "auto", options: [
          { value: "auto", label: "Metin, yoksa tarama (OSD)" },
          { value: "text", label: "Yalnızca gömülü metin" },
          { value: "osd", label: "Yalnızca tarama (OSD)" },
        ] },
      ],
      constants: { dryRun: "false", inferUndetected: "true" },
    },
    {
      id: "remove-pages",
      category: "pages",
      title: "Sayfa Sil",
      description: "Belirttiğiniz sayfaları PDF'ten kaldırın.",
      apiPath: "/api/v1/general/remove-pages",
      suffix: "sayfalar-silindi",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Silinecek sayfalar", type: "text", required: true, pagePicker: "remove",
          placeholder: "2,4-6", hint: "Önizlemede sayfalara tıklayın veya yazın. Örnek: 1,3,5-9." },
      ],
    },
    {
      id: "extract-pages",
      category: "pages",
      title: "Sayfa Çıkar",
      description: "Yalnızca seçtiğiniz sayfaları yeni bir PDF olarak alın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "secilen-sayfalar",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Alınacak sayfalar", type: "text", required: true, pagePicker: "pick",
          placeholder: "1,3-5", hint: "Önizlemede sayfalara tıklayın veya yazın. Yazarken sıra değiştirilebilir." },
      ],
      constants: { customMode: "CUSTOM" },
    },
    {
      id: "rearrange-pages",
      category: "pages",
      title: "Sayfaları Sırala",
      description: "Sayfa sırasını değiştirin veya hazır bir düzen uygulayın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "siralanmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "customMode", label: "Düzen", type: "select", default: "CUSTOM", options: [
          { value: "CUSTOM", label: "Kendi sıram" },
          { value: "REVERSE_ORDER", label: "Ters çevir" },
          { value: "DUPLEX_SORT", label: "Çift taraflı tarama sırası" },
          { value: "BOOKLET_SORT", label: "Kitapçık" },
          { value: "SIDE_STITCH_BOOKLET_SORT", label: "Yandan dikişli kitapçık" },
          { value: "ODD_EVEN_SPLIT", label: "Önce tek, sonra çift sayfalar" },
          { value: "REMOVE_FIRST", label: "İlk sayfayı çıkar" },
          { value: "REMOVE_LAST", label: "Son sayfayı çıkar" },
          { value: "REMOVE_FIRST_AND_LAST", label: "İlk ve son sayfayı çıkar" },
          { value: "DUPLICATE", label: "Her sayfayı çoğalt" },
        ] },
        { name: "pageNumbers", label: "Yeni sayfa sırası", type: "text", required: true, placeholder: "3,1,2",
          hint: "Örnek: 3,1,2 veya 5-1.", showIf: { customMode: "CUSTOM" } },
      ],
      constants: (v) => (v.customMode === "CUSTOM" ? {} : { pageNumbers: "all" }),
    },
    {
      id: "scale-pages",
      category: "pages",
      title: "Sayfa Ölçekle",
      description: "Sayfaları A4, Letter gibi bir boyuta getirin veya içeriği büyütüp küçültün.",
      apiPath: "/api/v1/general/scale-pages",
      suffix: "olceklenmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageSize", label: "Sayfa boyutu", type: "select", default: "A4", options:
          ["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map((s) => ({ value: s, label: s })).concat([
            { value: "LETTER", label: "Letter" },
            { value: "LEGAL", label: "Legal" },
            { value: "KEEP", label: "Boyutu koru" },
          ]) },
        { name: "orientation", label: "Yön", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "scaleFactor", label: "İçerik ölçeği", type: "range", default: 1, min: 0.1, max: 10, step: 0.1, unit: "×" },
      ],
    },
    {
      id: "crop",
      category: "pages",
      title: "Kırp",
      description: "Sayfa kenarlarındaki boşluğu otomatik kırpın veya önizlemede kalacak alanı sürükleyerek seçin.",
      apiPath: "/api/v1/general/crop",
      suffix: "kirpilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "autoCrop", label: "Beyaz kenarları otomatik kırp", type: "checkbox", default: true,
          hint: "Kapalıysa önizlemede kalacak alanı çizin; seçim tüm sayfalara uygulanır." },
        { name: "removeDataOutsideCrop", label: "Alan dışındaki metni sil", type: "checkbox", default: false, showIf: { autoCrop: false } },
        { name: "x", label: "Sol (x)", type: "number", default: 0, min: 0, showIf: { autoCrop: false }, advanced: true },
        { name: "y", label: "Alt (y)", type: "number", default: 0, min: 0, showIf: { autoCrop: false }, advanced: true },
        { name: "width", label: "Genişlik", type: "number", default: 595, min: 1, showIf: { autoCrop: false }, advanced: true },
        { name: "height", label: "Yükseklik", type: "number", default: 842, min: 1, showIf: { autoCrop: false }, advanced: true },
      ],
    },
    {
      id: "multi-page-layout",
      category: "pages",
      title: "Çok Sayfa Düzeni",
      description: "Birden fazla sayfayı tek kağıda yerleştirin.",
      apiPath: "/api/v1/general/multi-page-layout",
      suffix: "coklu-duzen",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pagesPerSheet", label: "Kağıt başına sayfa", type: "select", default: "2", options:
          ["2", "4", "9", "16"].map((n) => ({ value: n, label: n })) },
        { name: "arrangement", label: "Yerleşim", type: "select", default: "BY_ROWS", options: [
          { value: "BY_ROWS", label: "Satır satır" },
          { value: "BY_COLUMNS", label: "Sütun sütun" },
        ] },
        { name: "readingDirection", label: "Okuma yönü", type: "select", default: "LTR", options: [
          { value: "LTR", label: "Soldan sağa" },
          { value: "RTL", label: "Sağdan sola" },
        ] },
        { name: "orientation", label: "Kağıt yönü", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "addBorder", label: "Sayfaların çevresine çerçeve çiz", type: "checkbox", default: false },
      ],
      constants: { mode: "DEFAULT" },
    },
    {
      id: "pdf-to-single-page",
      category: "pages",
      title: "Tek Sayfaya Dönüştür",
      description: "Tüm sayfaları alt alta birleştirerek tek uzun bir sayfa oluşturun.",
      apiPath: "/api/v1/general/pdf-to-single-page",
      suffix: "tek-sayfa",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "add-page-numbers",
      category: "pages",
      title: "Sayfa Numarası Ekle",
      description: "Sayfalara numara ekleyin.",
      apiPath: "/api/v1/misc/add-page-numbers",
      suffix: "numarali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "position", label: "Konum", type: "pad", default: "8", options: [
          { value: "1", label: "Üst sol" }, { value: "2", label: "Üst orta" }, { value: "3", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "7", label: "Alt sol" }, { value: "8", label: "Alt orta" }, { value: "9", label: "Alt sağ" },
        ] },
        { name: "customText", label: "Metin", type: "text", default: "{n}", hint: "{n} sayfa numarası, {total} toplam sayfa. Örnek: Sayfa {n} / {total}." },
        { name: "startingNumber", label: "Başlangıç numarası", type: "number", default: 1, min: 0 },
        { name: "pagesToNumber", label: "Numaralanacak sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 12, min: 4, max: 96 },
        { name: "fontType", label: "Yazı tipi", type: "select", default: "helvetica", options: FONT_TYPES },
        { name: "fontColor", label: "Renk", type: "color", default: "#000000" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { pageNumbers: "all" },
    },
    {
      id: "add-stamp",
      category: "security",
      title: "Damga",
      description: "Sayfalara metin damgası ekleyin.",
      apiPath: "/api/v1/misc/add-stamp",
      suffix: "damgali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "stampText", label: "Damga metni", type: "text", required: true, default: "GİZLİ" },
        // Motor 1'i sol üste koyar. Eski numara düzeni (7 = üst) damgayı ters köşeye basıyordu.
        { name: "position", label: "Konum", type: "pad", default: "5", options: [
          { value: "1", label: "Üst sol" }, { value: "2", label: "Üst orta" }, { value: "3", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "7", label: "Alt sol" }, { value: "8", label: "Alt orta" }, { value: "9", label: "Alt sağ" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 40, min: 4, max: 300 },
        { name: "alphabet", label: "Yazı tipi (alfabe)", type: "select", default: "roman", options: ALPHABETS,
          hint: "Damga metninin diline uygun alfabeyi seçin. Türkçe için Latin yeterlidir." },
        { name: "rotation", label: "Açı", type: "range", default: 0, min: -180, max: 180, step: 5, unit: "°" },
        { name: "opacity", label: "Saydamlık", type: "range", default: 0.5, min: 0, max: 1, step: 0.05, unit: "%" },
        { name: "customColor", label: "Renk", type: "color", default: "#d3d3d3" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { stampType: "text", overrideX: "-1", overrideY: "-1" },
    },
    {
      id: "add-watermark",
      category: "security",
      title: "Filigran",
      description: "Sayfalara tekrarlanan metin, görsel veya QR kod filigranı ekleyin.",
      apiPath: "/api/v1/security/add-watermark",
      suffix: "filigranli",
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "watermarkImage", label: "Filigran görseli", accept: IMAGES, showIf: { watermarkType: "image" } },
      ],
      fields: [
        { name: "watermarkType", label: "Tür", type: "select", default: "text", options: [
          { value: "text", label: "Metin" },
          { value: "image", label: "Görsel" },
          { value: "qr", label: "QR kod" },
        ] },
        { name: "watermarkText", label: "Filigran metni", type: "text", default: "GİZLİ",
          showIf: { watermarkType: "text" }, required: true },
        { name: "qrText", label: "QR içeriği", type: "text", default: "https://",
          showIf: { watermarkType: "qr" }, required: true, local: true,
          hint: "Adres veya kısa metin. Kod bu bilgisayarda üretilir." },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 30, min: 4, max: 200,
          showIf: { watermarkType: "text" } },
        { name: "alphabet", label: "Yazı tipi (alfabe)", type: "select", default: "roman", options: ALPHABETS,
          showIf: { watermarkType: "text" },
          hint: "Filigran metninin diline uygun alfabeyi seçin. Türkçe için Latin yeterlidir." },
        { name: "customColor", label: "Renk", type: "color", default: "#808080",
          showIf: { watermarkType: "text" } },
        { name: "rotation", label: "Açı", type: "range", default: 45, min: -180, max: 180, step: 5, unit: "°",
          showIf: { watermarkType: ["text", "image"] } },
        { name: "opacity", label: "Saydamlık", type: "range", default: 0.3, min: 0, max: 1, step: 0.05, unit: "%" },
        { name: "widthSpacer", label: "Yatay aralık", type: "range", default: 50, min: 0, max: 400, step: 5 },
        { name: "heightSpacer", label: "Dikey aralık", type: "range", default: 50, min: 0, max: 400, step: 5 },
        { name: "convertPDFToImage", label: "Sayfaları görsele çevir (filigran kaldırılamaz)", type: "checkbox", default: false },
      ],
      constants: (v) => (v.watermarkType === "text" ? {} : { alphabet: "roman" }),
      usesEngine: true,
      async run({ files, values, engine, form, makeQr }) {
        if (values.watermarkType !== "qr") return engine("/api/v1/security/add-watermark", form());
        const text = (values.qrText || "").trim();
        if (!text) throw new Error("QR içeriği boş bırakılamaz.");
        const image = await qrPng(await makeQr(text));
        const body = new FormData();
        files.fileInput.forEach((file) => body.append("fileInput", file, file.name));
        body.append("watermarkImage", new File([image], "qr.png", { type: "image/png" }), "qr.png");
        body.append("watermarkType", "image");
        body.append("alphabet", "roman");
        body.append("fontSize", "30");
        body.append("customColor", "#808080");
        body.append("opacity", String(values.opacity || "0.3").replace(",", "."));
        body.append("widthSpacer", String(values.widthSpacer || "50"));
        body.append("heightSpacer", String(values.heightSpacer || "50"));
        body.append("rotation", "0");
        body.append("convertPDFToImage", values.convertPDFToImage ? "true" : "false");
        return engine("/api/v1/security/add-watermark", body);
      },
    },
    {
      id: "add-password",
      category: "security",
      title: "Parola Ekle",
      description: "PDF'e açma parolası ve kullanım kısıtlamaları ekleyin.",
      apiPath: "/api/v1/security/add-password",
      suffix: "parolali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "Açma parolası", type: "password" },
        { name: "ownerPassword", label: "Yetki parolası", type: "password", hint: "Kısıtlamaları değiştirmek için gerekir. Boş bırakılabilir." },
        { name: "keyLength", label: "Şifreleme", type: "select", default: "256", options: [
          { value: "256", label: "AES 256 bit" },
          { value: "128", label: "AES 128 bit" },
        ] },
        { name: "preventPrinting", label: "Yazdırmayı engelle", type: "checkbox", default: false },
        { name: "preventExtractContent", label: "İçerik kopyalamayı engelle", type: "checkbox", default: false },
        { name: "preventModify", label: "Değiştirmeyi engelle", type: "checkbox", default: false },
        { name: "preventModifyAnnotations", label: "Not eklemeyi engelle", type: "checkbox", default: false },
        { name: "preventFillInForm", label: "Form doldurmayı engelle", type: "checkbox", default: false },
        { name: "preventAssembly", label: "Sayfa düzenlemeyi engelle", type: "checkbox", default: false },
      ],
      validate: (v) => (v.password || v.ownerPassword ? null : "En az bir parola girin."),
    },
    {
      id: "remove-password",
      category: "security",
      title: "Parola Kaldır",
      description: "Parolasını bildiğiniz PDF'in şifresini kaldırın.",
      apiPath: "/api/v1/security/remove-password",
      suffix: "parolasiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "password", label: "Parola", type: "password", required: true }],
    },
    {
      id: "redact",
      category: "security",
      title: "Karartma",
      description: "Belirttiğiniz metinleri ve kişisel verileri (TC kimlik, VKN, pasaport, telefon, e-posta, IBAN, kart, posta kodu, adres) kalıcı olarak karartın. Sayfalar görsele çevrilir; karartılan bilgi belgede hiçbir biçimde kalmaz.",
      suffix: "karartilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "presets", label: "Hassas veri desenleri", type: "checks", local: true, default: [], options: [
          { value: "tckn", label: "T.C. Kimlik No", group: "Kimlik" },
          { value: "vkn", label: "Vergi Kimlik No (VKN)", group: "Kimlik" },
          { value: "passport", label: "Pasaport No", group: "Kimlik" },
          { value: "mobile_tr", label: "Cep telefonu", group: "İletişim" },
          { value: "phone_tr", label: "Telefon (sabit/cep)", group: "İletişim" },
          { value: "email", label: "E-posta", group: "İletişim" },
          { value: "iban_tr", label: "IBAN (TR)", group: "Finans" },
          { value: "credit_card", label: "Banka / kredi kartı", group: "Finans" },
          { value: "postal_code_tr", label: "Posta kodu", group: "Adres" },
          { value: "address_tr", label: "Adres", group: "Adres" },
        ] },
        { name: "words", label: "Karartılacak metinler", type: "textarea", local: true, placeholder: "Ahmet Yılmaz\nGizli Proje",
          hint: "Her satıra bir metin yazın." },
        { name: "ignoreCase", label: "Büyük/küçük harfe duyarsız", type: "checkbox", local: true, default: true },
        { name: "wholeWord", label: "Yalnızca tam kelimeler", type: "checkbox", local: true, default: false },
        { name: "regex", label: "Satırları düzenli ifade (regex) olarak yorumla", type: "checkbox", local: true, default: false },
        { name: "redactColor", label: "Kutu rengi", type: "color", local: true, default: "#000000" },
        { name: "ocr", label: "Karartmadan sonra metni yeniden tanı (OCR)", type: "checkbox", local: true, default: false,
          hint: "Görsele çevrilen sayfalar Türkçe ve İngilizce OCR ile yeniden aranabilir olur; karartılan alanlar tanınmaz. İşlem uzar." },
      ],
      validate: (v) => {
        try {
          return redactPatterns(v).length ? null : "Karartılacak bir metin yazın veya kişisel veri türü seçin.";
        } catch (err) {
          return err.message;
        }
      },
      usesEngine: true,
      run: redact,
    },
    {
      id: "scan-file",
      category: "security",
      title: "Virüs Tara",
      description: "Dosyayı bu bilgisayardaki Windows Defender ile tarayın. Dosya karantinaya alınmaz ve silinmez; sonuç PDF rapor olarak hazırlanır.",
      suffix: "tarama",
      files: [{ name: "fileInput", label: "Dosya", accept: "*/*" }],
      fields: [],
      async run({ files, scan, htmlToPdf, note }) {
        const file = files.fileInput[0];
        const result = await scan(file);
        note(result.clean ? "Tehdit bulunamadı" : "Tehdit bulundu");
        const { html, page } = window.SecuriFormats.scanReport(file.name, result);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "cert-sign",
      category: "sign",
      title: "Dijital İmza",
      description: "PDF'i sertifikanızla imzalayın: Windows sertifika deposu (e-imza kartları dahil), PKCS#11 akıllı kart, PFX/P12 veya PEM dosyası. İmza, belgenin imzadan sonra değişmediğini kanıtlar. CMS/PKCS#7 imzasıdır; PAdES profili iddia edilmez.",
      apiPath: "/api/v1/security/cert-sign",
      suffix: "imzali",
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "p12File", label: "Sertifika dosyası (.pfx / .p12)", accept: ".pfx,.p12", preview: false, showIf: { certType: "PKCS12" } },
        { name: "certFile", label: "Sertifika (.pem / .crt / .cer)", accept: CERTS, preview: false, showIf: { certType: "PEM" } },
        { name: "privateKeyFile", label: "Özel anahtar (.pem / .key)", accept: ".pem,.key,.der", preview: false, showIf: { certType: "PEM" } },
      ],
      fields: [
        { name: "certType", label: "Sertifika kaynağı", type: "select", default: "WINDOWS_STORE", options: [
          { value: "WINDOWS_STORE", label: "Windows sertifika deposu" },
          { value: "PKCS11", label: "Akıllı kart / token (PKCS#11)" },
          { value: "PKCS12", label: "PFX / P12 dosyası" },
          { value: "PEM", label: "PEM sertifika ve anahtar" },
        ] },
        { name: "alias", label: "Sertifika", type: "select", options: [], load: windowsCertificates, required: true,
          empty: "Özel anahtarı olan sertifika bulunamadı",
          hint: "Kartınız Windows'a tanıtıldıysa (sürücüsü kuruluysa) sertifikası burada görünür. PIN gerekirse Windows sorar.",
          showIf: { certType: "WINDOWS_STORE" } },
        { name: "pkcs11LibraryPath", label: "Kart sürücüsü", type: "select", options: [], load: tokenDrivers, required: true,
          empty: "Bilinen bir kart sürücüsü bulunamadı",
          hint: "AKİS, SafeNet, Gemalto IDPrime, OpenSC, YubiKey, SafeSign, DataKey ve ePass2003 sürücüleri tanınır.",
          showIf: { certType: "PKCS11" } },
        { name: "tokenAlias", label: "Karttaki sertifika adı (isteğe bağlı)", type: "text", local: true,
          hint: "Kartta birden çok sertifika varsa yazın; boşsa ilk sertifika kullanılır.", showIf: { certType: "PKCS11" } },
        { name: "password", label: "Parola / PIN", type: "password", required: true, showIf: { certType: ["PKCS11", "PKCS12", "PEM"] },
          hint: "Yalnızca bu işlem için kullanılır, saklanmaz." },
        { name: "reason", label: "İmza nedeni", type: "text", placeholder: "Onaylıyorum" },
        { name: "location", label: "Yer", type: "text", placeholder: "İstanbul" },
        { name: "showSignature", label: "Sayfada görünür imza kutusu ekle", type: "checkbox", default: false },
        { name: "name", label: "Kutuda görünecek ad", type: "text", showIf: { showSignature: true } },
        { name: "pageNumber", label: "Sayfa", type: "number", default: 1, min: 1, showIf: { showSignature: true } },
      ],
      constants: (v) => ({ showLogo: "false", ...(v.certType === "PKCS11" && v.tokenAlias ? { alias: v.tokenAlias } : {}) }),
      httpError: signError,
      usesEngine: true,
      // The engine signs with another certificate of the store when the alias is unknown.
      async run({ values, engine, engineGet, form }) {
        if (values.certType === "WINDOWS_STORE") {
          const certs = await windowsCertificates({ get: engineGet });
          if (!certs.some((cert) => cert.value === values.alias)) {
            throw new Error("Seçilen sertifika Windows sertifika deposunda bulunamadı. Listeyi yenileyip yeniden seçin.");
          }
        }
        return engine("/api/v1/security/cert-sign", form());
      },
    },
    {
      id: "timestamp-pdf",
      category: "sign",
      title: "Zaman Damgası",
      description: "Belgeye RFC 3161 zaman damgası ekleyerek o anda bu içerikle var olduğunu kanıtlayın. Sunucuya yalnızca belgenin SHA-256 özeti gider. Hazır TSA veya kurum içi adres yazılabilir; GPO ile kapatılabilir.",
      usesEngine: true,
      suffix: "zaman-damgali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "tsaUrl", label: "Zaman damgası sunucusu", type: "select", local: true, default: "http://timestamp.digicert.com", options: [
          { value: "http://timestamp.digicert.com", label: "DigiCert" },
          { value: "http://timestamp.sectigo.com", label: "Sectigo" },
          { value: "http://ts.ssl.com", label: "SSL.com" },
          { value: "https://freetsa.org/tsr", label: "FreeTSA" },
          { value: "http://tsa.mesign.com", label: "MeSign" },
          { value: "custom", label: "Kurum / özel adres" },
        ] },
        { name: "tsaCustom", label: "TSA adresi", type: "text", local: true, default: "",
          placeholder: "http://tsa.kurum.local/tsr", showIf: { tsaUrl: "custom" },
          hint: "Kurum içi TSA için internet gerekmez; genel TSA için ağ çıkışı gerekir." },
      ],
      httpError: (status, detail) => (/TSA|timestamp|connect|timed out|UnknownHost/i.test(detail)
        ? "Zaman damgası sunucusundan yanıt alınamadı. Adresi, ağı veya GPO AllowTimestamp ilkesini kontrol edin."
        : null),
      async run({ files, values, engine }) {
        const url = values.tsaUrl === "custom" ? String(values.tsaCustom || "").trim() : values.tsaUrl;
        if (!url) throw new Error("Zaman damgası sunucusu adresini yazın.");
        if (!/^https?:\/\//i.test(url)) throw new Error("TSA adresi http:// veya https:// ile başlamalı.");
        const form = new FormData();
        form.append("fileInput", files.fileInput[0], files.fileInput[0].name);
        form.append("tsaUrl", url);
        return engine("/api/v1/security/timestamp-pdf", form);
      },
    },
    {
      id: "validate-signature",
      category: "sign",
      title: "İmza Doğrula",
      description: "PDF'teki dijital imzaları denetleyin: belge imzadan sonra değişmiş mi, sertifika güvenilir mi, süresi geçerli mi. Sonuç PDF rapor olarak hazırlanır.",
      suffix: "imza-raporu",
      usesEngine: true,
      files: [
        { name: "fileInput", label: "İmzalı PDF", accept: PDF },
        { name: "certFile", label: "Güvenilen kök sertifika (isteğe bağlı)", accept: CERTS, preview: false, min: 0 },
      ],
      fields: [],
      async run({ files, engine, form, htmlToPdf, note }) {
        const data = JSON.parse(new TextDecoder("utf-8").decode(await engine("/api/v1/security/validate-signature", form())));
        const results = Array.isArray(data) ? data : data.results || [];
        const verdicts = results.map((result) => window.SecuriFormats.signatureVerdict(result).level);
        note(!results.length ? "Belgede imza yok"
          : verdicts.every((level) => level === "ok") ? `${results.length} imza, tümü geçerli`
          : verdicts.includes("bad") ? `${results.length} imza, geçersiz imza var`
          : `${results.length} imza, uyarı var`);
        const { html, page } = window.SecuriFormats.signatureReport(results, files.fileInput[0].name);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "remove-cert-sign",
      category: "sign",
      title: "İmzaları Kaldır",
      description: "PDF'teki dijital imzaları kaldırın. Belge içeriği değişmez; imzalı hâli gerekiyorsa orijinali saklayın.",
      apiPath: "/api/v1/security/remove-cert-sign",
      suffix: "imzasiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "pdf-to-img",
      category: "convert",
      title: "PDF → Görsel",
      description: "PDF sayfalarını görsele dönüştürün. Birden çok görsel ZIP olarak kaydedilir.",
      apiPath: "/api/v1/convert/pdf/img",
      suffix: "gorsel",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "imageFormat", label: "Biçim", type: "select", default: "png", options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "webp", label: "WebP" },
          { value: "gif", label: "GIF" },
          { value: "bmp", label: "BMP" },
        ] },
        { name: "singleOrMultiple", label: "Çıktı", type: "select", default: "multiple", options: [
          { value: "multiple", label: "Her sayfa ayrı görsel" },
          { value: "single", label: "Tüm sayfalar tek görselde" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "dpi", label: "Çözünürlük (DPI)", type: "number", default: 150, min: 36, max: 600 },
      ],
    },
    {
      id: "img-to-pdf",
      category: "convert",
      title: "Görsel → PDF",
      description: "Görselleri tek PDF belgesinde birleştirin.",
      apiPath: "/api/v1/convert/img/pdf",
      suffix: "",
      files: [{ name: "fileInput", label: "Görseller", accept: IMAGES, multiple: true, min: 1 }],
      fields: [
        { name: "fitOption", label: "Sayfaya yerleşim", type: "select", default: "maintainAspectRatio", options: [
          { value: "maintainAspectRatio", label: "Oranı koru" },
          { value: "fillPage", label: "Sayfayı doldur" },
          { value: "fitDocumentToImage", label: "Sayfa görsel boyutunda olsun" },
        ] },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "autoRotate", label: "Görseli sayfaya göre otomatik döndür", type: "checkbox", default: false },
      ],
    },
    {
      id: "udf-to-pdf",
      category: "convert",
      title: "UDF → PDF",
      description: "UYAP Doküman Editörü belgesini (.udf) PDF'e dönüştürün. Yazı tipi, hizalama, tablo ve görseller korunur.",
      suffix: "",
      files: [{ name: "fileInput", label: "UDF dosyası", accept: UDF }],
      fields: [],
      async run({ files, htmlToPdf }) {
        const bytes = new Uint8Array(await files.fileInput[0].arrayBuffer());
        const { html, page } = await window.SecuriFormats.udfToHtml(bytes);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "pdf-to-udf",
      category: "convert",
      title: "PDF → UDF",
      description: "PDF'teki metni UYAP Doküman Editörü belgesine (.udf) aktarın. Metin ve satırlar aktarılır; görseller ve tablo düzeni aktarılmaz.",
      suffix: "",
      outputExt: "udf",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "PDF parolası (varsa)", type: "password", local: true },
      ],
      async run({ files, values }) {
        const lines = await window.SecuriPreview.textLines(files.fileInput[0], values.password);
        if (!lines.some((line) => line.text.trim())) throw new Error("FORMAT_NO_TEXT");
        return window.SecuriFormats.linesToUdf(lines);
      },
    },
    {
      id: "einvoice-to-pdf",
      category: "convert",
      title: "e-Fatura XML → PDF",
      description: "e-Fatura, e-Arşiv fatura veya e-İrsaliye XML dosyasını PDF'e dönüştürün. Belgede gömülü görsel şablon (XSLT) varsa o kullanılır.",
      suffix: "",
      files: [{ name: "fileInput", label: "XML dosyası", accept: XML }],
      fields: [
        { name: "template", label: "Görünüm", type: "select", local: true, default: "embedded", options: [
          { value: "embedded", label: "Belgedeki şablon (yoksa standart)" },
          { value: "standard", label: "SecuriPDF standart şablonu" },
        ] },
      ],
      async run({ files, values, htmlToPdf, note }) {
        const text = new TextDecoder("utf-8").decode(await files.fileInput[0].arrayBuffer());
        const { html, page, template } = window.SecuriFormats.invoiceToHtml(text, values.template === "embedded");
        if (values.template === "embedded" && template === "standard") note("Belgede şablon bulunamadı; standart şablon kullanıldı");
        return htmlToPdf(html, page);
      },
    },
    {
      id: "office-to-pdf",
      category: "convert",
      title: "Office → PDF",
      description: "Word, Excel veya PowerPoint belgesini PDF'e dönüştürün. Microsoft Office kuruluysa o kullanılır. Office yoksa LibreOffice gerekir. İkisi de yoksa bu dönüşüm yapılmaz. Makrolar çalıştırılmaz.",
      suffix: "",
      files: [{ name: "fileInput", label: "Office belgesi", accept: OFFICE }],
      fields: [
        { name: "format", label: "Çıktı", type: "select", local: true, default: "pdf", options: [
          { value: "pdf", label: "PDF" },
          { value: "pdfa", label: "PDF/A (arşiv)" },
        ] },
      ],
      async run({ files, values, office, engine, note }) {
        const file = files.fileInput[0];
        try {
          return await office(file, values.format);
        } catch (err) {
          const code = String(err && err.message || err);
          if (!/OFFICE_MISSING|OFFICE_SCRIPT_FAILED/.test(code)) throw err;
          try {
            const form = new FormData();
            form.append("fileInput", file, file.name);
            let pdf = await engine("/api/v1/convert/file/pdf", form);
            if (values.format === "pdfa") {
              const archive = new FormData();
              archive.append("fileInput", new File([pdf], "belge.pdf", { type: "application/pdf" }));
              archive.append("outputFormat", "pdfa-2b");
              archive.append("strict", "false");
              pdf = await engine("/api/v1/convert/pdf/pdfa", archive);
              note("Microsoft Office yok; LibreOffice ile PDF/A üretildi. Sayfa düzeni Word kadar sadık olmayabilir.");
            } else {
              note("Microsoft Office yok; LibreOffice ile PDF üretildi. Sayfa düzeni Word kadar sadık olmayabilir.");
            }
            return pdf;
          } catch (fallback) {
            const detail = String(fallback && fallback.message || fallback);
            if (/LOCAL_ENGINE_NOT_READY/.test(detail)) {
              throw new Error("Microsoft Office yok. LibreOffice ile denemek için ön gereksinimlerin hazır olmasını bekleyin.");
            }
            throw new Error("Microsoft Office yok ve LibreOffice ile de dönüştürülemedi. Word, Excel, PowerPoint veya LibreOffice kurun.");
          }
        }
      },
    },
    {
      id: "pdf-to-word",
      category: "convert",
      title: "PDF → Word",
      description: "PDF'i bu bilgisayardaki Microsoft Word ile düzenlenebilir Word belgesine (.docx) dönüştürün. Word kurulu değilse bu araç çalışmaz; LibreOffice bu dönüşümü yapmaz. Karmaşık sayfa düzenleri birebir korunmayabilir.",
      suffix: "",
      outputExt: "docx",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      run: ({ files, office }) => office(files.fileInput[0], "docx"),
    },
    {
      id: "pdf-to-excel",
      category: "convert",
      title: "PDF → Excel",
      description: "PDF'teki tabloları Excel çalışma kitabına (.xlsx) aktarın. Birleşik hücre ve aynı hücredeki alt satır korunur. Izgara bulunamazsa motorun tablosu kullanılır; taranmış sayfada önce OCR gerekir.",
      suffix: "",
      outputExt: "xlsx",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint, pagePicker: true }],
      async run({ files, values, engine, form, note }) {
        const file = files.fileInput[0];
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (window.SecuriPreview && window.SecuriPreview.exportTables) {
          try {
            const made = await window.SecuriPreview.exportTables(bytes, values.pageNumbers, "xlsx", values.password);
            if (made) {
              note("Tablolar satır ve sütun hizasından çıkarıldı. Birleşik hücreler ve çok satırlı hücreler korundu.");
              return made;
            }
          } catch { /* motor tablosu */ }
        }
        note("Izgara bulunamadı; motorun tablosu kullanıldı. Birleşik hücreler bozulabilir.");
        return engine("/api/v1/convert/pdf/xlsx", form());
      },
    },
    {
      id: "pdf-to-csv",
      category: "convert",
      title: "PDF → CSV",
      description: "PDF'teki tabloları CSV olarak çıkarın. Aynı hücredeki alt satır tırnak içinde kalır. CSV birleşik hücre tutamaz; değer sol üst hücrede durur. Izgara bulunamazsa motorun çıktısı kullanılır.",
      suffix: "",
      outputExt: "csv",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint, pagePicker: true }],
      async run({ files, values, engine, form, note }) {
        const file = files.fileInput[0];
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (window.SecuriPreview && window.SecuriPreview.exportTables) {
          try {
            const made = await window.SecuriPreview.exportTables(bytes, values.pageNumbers, "csv", values.password);
            if (made) {
              note("Tablolar satır ve sütun hizasından çıkarıldı. Çok satırlı hücreler tek hücrede kaldı.");
              return made;
            }
          } catch { /* motor tablosu */ }
        }
        note("Izgara bulunamadı; motorun CSV çıktısı kullanıldı.");
        return engine("/api/v1/convert/pdf/csv", form());
      },
    },
    {
      id: "pdf-to-text",
      category: "convert",
      title: "PDF → Metin",
      description: "PDF'teki metni düz metin dosyasına aktarın.",
      apiPath: "/api/v1/convert/pdf/text",
      suffix: "",
      outputExt: "txt",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      constants: { outputFormat: "txt" },
    },
    {
      id: "pdf-to-pdfa",
      category: "convert",
      title: "PDF → PDF/A / PDF/X",
      description: "PDF'i arşiv (PDF/A) veya baskı (PDF/X) biçimine dönüştürün. Ghostscript motorla gelir; PDF/X için zorunludur.",
      apiPath: "/api/v1/convert/pdf/pdfa",
      suffix: "arsiv",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "outputFormat", label: "Biçim", type: "select", default: "pdfa-2b", options: [
          { value: "pdfa-1", label: "PDF/A-1b" },
          { value: "pdfa-2b", label: "PDF/A-2b" },
          { value: "pdfa-3b", label: "PDF/A-3b" },
          { value: "pdfx", label: "PDF/X" },
        ] },
      ],
      constants: { strict: "false" },
      httpError: (_status, detail) => /ghostscript|pdf\/?x conversion|pdf\/?a conversion failed/i.test(detail || "")
        ? "PDF/A ve PDF/X dönüşümü Ghostscript ister. SecuriPDF'i kapatıp yeniden açın; sürmezse yeni kurucuyu yükleyin."
        : "",
    },
    {
      id: "compress-pdf",
      category: "optimize",
      title: "Sıkıştır",
      description: "PDF boyutunu küçültün. Düşük düzeyler metni korur; yüksek düzeyler görselleri yeniden kodlar.",
      apiPath: "/api/v1/misc/compress-pdf",
      suffix: "sikistirilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "optimizeLevel", label: "Düzey", type: "select", default: "4", options: [
          { value: "1", label: "1 — kayıpsız (yapı)" },
          { value: "2", label: "2 — kayıpsız (akışlar)" },
          { value: "3", label: "3 — kayıpsız (nesneler)" },
          { value: "4", label: "4 — görselleri yeniden kodla" },
          { value: "5", label: "5 — daha küçük görseller" },
        ] },
        { name: "grayscale", label: "Gri tonlamaya çevir", type: "checkbox", default: false },
        { name: "linearize", label: "Web için doğrusal hale getir", type: "checkbox", default: false },
      ],
    },
    {
      id: "update-metadata",
      category: "optimize",
      title: "Üstveri",
      description: "PDF başlığı, yazarı, konusu ve anahtar kelimelerini düzenleyin veya tümünü silin.",
      apiPath: "/api/v1/misc/update-metadata",
      suffix: "ustveri",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "deleteAll", label: "Tüm üstveriyi sil", type: "checkbox", default: false },
        { name: "title", label: "Başlık", type: "text", showIf: { deleteAll: false } },
        { name: "author", label: "Yazar", type: "text", showIf: { deleteAll: false } },
        { name: "subject", label: "Konu", type: "text", showIf: { deleteAll: false } },
        { name: "keywords", label: "Anahtar kelimeler", type: "text", showIf: { deleteAll: false } },
      ],
    },
    {
      id: "remove-blanks",
      category: "optimize",
      title: "Boş Sayfa Sil",
      description: "Beyaz veya neredeyse boş sayfaları belgeden çıkarın.",
      suffix: "bosluksuz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "threshold", label: "Beyaz eşiği", type: "range", default: 10, min: 0, max: 255, hint: "Düşük değer yalnızca neredeyse beyaz pikselleri boş sayar." },
        { name: "whitePercent", label: "Beyaz oranı", type: "range", default: 99.9, min: 50, max: 100, step: 0.1, unit: "%" },
      ],
      usesEngine: true,
      async run({ form, engine, note }) {
        const zip = await engine("/api/v1/misc/remove-blanks", form());
        const entries = await window.SecuriFormats.zipEntries(zip);
        const kept = entries.find((entry) => /nonBlank|non-blank|_processed/i.test(entry.name) && entry.data[0] === 0x25)
          || entries.find((entry) => entry.data[0] === 0x25);
        if (!kept) throw new Error("Boş olmayan sayfa kalmadı.");
        const blanks = entries.find((entry) => /blank/i.test(entry.name) && !/nonBlank|non-blank/i.test(entry.name));
        if (blanks) {
          const count = await window.SecuriPreview.countPages(new File([blanks.data], "blank.pdf"));
          if (count) note(`${count} boş sayfa silindi`);
        }
        return kept.data;
      },
    },
    {
      id: "repair-pdf",
      category: "optimize",
      title: "Onar",
      description: "Hasarlı veya kesik PDF yapısını onarın. Ağır hasarlı belgeler açılamayabilir.",
      suffix: "onarilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      run: ({ files, repair }) => repair(files.fileInput[0]),
    },
    {
      id: "sanitize-pdf",
      category: "optimize",
      title: "Temizle",
      description: "JavaScript, gömülü dosya, bağlantı ve üstveriyi belgeden çıkarın.",
      apiPath: "/api/v1/security/sanitize-pdf",
      suffix: "temiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "removeJavaScript", label: "JavaScript'i kaldır", type: "checkbox", default: true },
        { name: "removeEmbeddedFiles", label: "Gömülü dosyaları kaldır", type: "checkbox", default: true },
        { name: "removeLinks", label: "Bağlantıları kaldır", type: "checkbox", default: true },
        { name: "removeMetadata", label: "Üstveriyi kaldır", type: "checkbox", default: true },
        { name: "removeXMPMetadata", label: "XMP üstverisini kaldır", type: "checkbox", default: true },
        { name: "removeFonts", label: "Gömülü yazı tiplerini kaldır", type: "checkbox", default: false,
          hint: "Yazı tipleri kaldırılırsa metin başka bir bilgisayarda bozulabilir." },
      ],
    },
    {
      id: "extract-images",
      category: "optimize",
      title: "Görselleri Çıkar",
      description: "PDF'e gömülü görselleri ayrı dosyalar olarak çıkarın. Birden çok görsel ZIP olarak kaydedilir.",
      apiPath: "/api/v1/misc/extract-images",
      suffix: "gorseller",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "format", label: "Biçim", type: "select", default: "png", options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "gif", label: "GIF" },
        ] },
      ],
    },
    {
      id: "booklet",
      category: "pages",
      title: "Kitapçık",
      description: "Sayfaları katlanıp ciltlenecek kitapçık düzenine yerleştirin (2 sayfa / yaprak).",
      apiPath: "/api/v1/general/booklet-imposition",
      suffix: "kitapcik",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "spineLocation", label: "Sırt", type: "select", default: "LEFT", options: [
          { value: "LEFT", label: "Sol (soldan sağa)" },
          { value: "RIGHT", label: "Sağ (sağdan sola)" },
        ] },
        { name: "doubleSided", label: "Çift taraflı yazdırma", type: "checkbox", default: true },
        { name: "addGutter", label: "Cilt payı ekle", type: "checkbox", default: false },
        { name: "gutterSize", label: "Cilt payı (punto)", type: "number", default: 12, min: 0, max: 72,
          showIf: { addGutter: true } },
        { name: "addBorder", label: "Kesim çizgisi ekle", type: "checkbox", default: false },
      ],
      constants: { pagesPerSheet: "2", duplexPass: "BOTH", flipOnShortEdge: "false" },
    },
    {
      id: "insert-pages",
      category: "pages",
      title: "Sayfa Ekle",
      description: "Belirttiğiniz sayfadan önce boş sayfa veya başka bir PDF ekleyin.",
      suffix: "sayfa-eklendi",
      usesEngine: false,
      files: [
        { name: "fileInput", label: "Hedef PDF", accept: PDF },
        { name: "insertPdf", label: "Eklenecek PDF", accept: PDF, showIf: { source: "pdf" } },
      ],
      fields: [
        { name: "source", label: "Eklenecek", type: "select", local: true, default: "blank", options: [
          { value: "blank", label: "Boş sayfa" },
          { value: "pdf", label: "Başka bir PDF" },
        ] },
        { name: "atPage", label: "Şu sayfadan önce ekle", type: "number", default: 1, min: 1,
          hint: "1 belgenin başına ekler. Son sayfadan büyük bir değer sona ekler." },
        { name: "blankCount", label: "Boş sayfa sayısı", type: "number", default: 1, min: 1, max: 50, showIf: { source: "blank" } },
      ],
      async run({ files, values, assemble }) {
        const dest = files.fileInput[0];
        const destBytes = new Uint8Array(await dest.arrayBuffer());
        const pages = await window.SecuriPreview.countPages(dest);
        if (!pages) throw new Error("PDF sayfaları okunamadı.");
        const at = Math.max(1, Math.min(pages + 1, Number(values.atPage) || 1));
        let insertBytes;
        if (values.source === "blank") {
          const info = await window.SecuriPreview.pageInfo(dest);
          const first = info[0] || { width: 595, height: 842 };
          const count = Math.max(1, Math.min(50, Number(values.blankCount) || 1));
          insertBytes = solidColorPdf(Array.from({ length: count }, () => ({ width: first.width, height: first.height })), "#ffffff");
        } else {
          const chosen = files.insertPdf && files.insertPdf[0];
          if (!chosen) throw new Error("Eklenecek PDF seçin.");
          insertBytes = new Uint8Array(await chosen.arrayBuffer());
        }
        const parts = [];
        if (at > 1) parts.push({ bytes: destBytes, pages: `1-${at - 1}` });
        parts.push({ bytes: insertBytes, pages: "1-z" });
        if (at <= pages) parts.push({ bytes: destBytes, pages: `${at}-z` });
        return assemble(parts);
      },
    },
    {
      id: "add-header-footer",
      category: "pages",
      title: "Üst / Alt Bilgi",
      description: "Sayfaların üstüne ve altına metin veya sayfa numarası ekleyin. {n} sayfa, {total} toplam sayfadır.",
      suffix: "ust-alt",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "header", label: "Üst bilgi", type: "text", default: "", placeholder: "Kurum adı" },
        { name: "headerPos", label: "Üst konum", type: "select", default: "2", options: [
          { value: "1", label: "Sol" }, { value: "2", label: "Orta" }, { value: "3", label: "Sağ" },
        ] },
        { name: "footer", label: "Alt bilgi", type: "text", default: "Sayfa {n} / {total}" },
        { name: "footerPos", label: "Alt konum", type: "select", default: "8", options: [
          { value: "7", label: "Sol" }, { value: "8", label: "Orta" }, { value: "9", label: "Sağ" },
        ] },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 10, min: 4, max: 72 },
        { name: "fontType", label: "Yazı tipi", type: "select", default: "helvetica", options: FONT_TYPES },
        { name: "fontColor", label: "Renk", type: "color", default: "#334155" },
      ],
      validate: (v) => (v.header.trim() || v.footer.trim() ? null : "Üst veya alt bilgi yazın."),
      async run({ files, values, engine }) {
        let bytes = new Uint8Array(await files.fileInput[0].arrayBuffer());
        if (values.header.trim()) {
          bytes = await numberStamp(engine, pdfFile(bytes, "belge.pdf"), values.header.trim(), values.headerPos, values.fontSize, values.fontColor, values.fontType);
        }
        if (values.footer.trim()) {
          bytes = await numberStamp(engine, pdfFile(bytes, "belge.pdf"), values.footer.trim(), values.footerPos, values.fontSize, values.fontColor, values.fontType);
        }
        return bytes;
      },
    },
    {
      id: "add-background",
      category: "pages",
      title: "Arka Plan",
      description: "Tüm sayfaların arkasına düz renk veya görsel yerleştirin.",
      suffix: "arkaplan",
      usesEngine: true,
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "bgImage", label: "Arka plan görseli", accept: IMAGES, showIf: { kind: "image" } },
      ],
      fields: [
        { name: "kind", label: "Tür", type: "select", local: true, default: "color", options: [
          { value: "color", label: "Renk" },
          { value: "image", label: "Görsel" },
        ] },
        { name: "color", label: "Renk", type: "color", default: "#f8fafc", showIf: { kind: "color" } },
      ],
      httpError: (status, detail) => (status >= 500
        ? "Arka plan yerleştirilemedi. Sayfa boyutu bu dosyayla uyuşmuyor olabilir." + (detail ? ` (${String(detail).replace(/\s+/g, " ").slice(0, 160)})` : "")
        : null),
      async run({ files, values, engine, htmlToPdf, repair }) {
        const dest = files.fileInput[0];
        const info = await window.SecuriPreview.pageInfo(dest);
        if (!info.length) throw new Error("PDF sayfaları okunamadı.");
        let background;
        if (values.kind === "image") {
          const image = files.bgImage && files.bgImage[0];
          if (!image) throw new Error("Arka plan görseli seçin.");
          const url = await fileDataUrl(image);
          const layers = [];
          for (const page of info) {
            const setup = {
              width: pageInches(page.width),
              height: pageInches(page.height),
              marginTop: 0,
              marginRight: 0,
              marginBottom: 0,
              marginLeft: 0,
              landscape: false,
            };
            const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:${page.width}pt;height:${page.height}pt;}img{width:100%;height:100%;object-fit:cover;display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head><body><img src="${url}" alt=""></body></html>`;
            let layer = await htmlToPdf(html, setup);
            if (repair) {
              try { layer = await repair(pdfFile(layer, `zemin-${page.number}.pdf`)); } catch { /* yazıcı çıktısı olduğu gibi denenir */ }
            }
            layers.push(pdfFile(layer, `zemin-${page.number}.pdf`));
          }
          background = layers.length === 1 ? new Uint8Array(await layers[0].arrayBuffer()) : await mergePdfs(engine, layers);
        } else {
          const color = /^#[0-9a-fA-F]{6}$/.test(values.color) ? values.color : "#f8fafc";
          background = solidColorPdf(info, color);
        }
        return overlayPdfs(engine, new Uint8Array(await dest.arrayBuffer()), background, true);
      },
    },
    {
      id: "add-image",
      category: "edit",
      title: "Görsel Ekle",
      description: "Seçilen sayfaya veya tüm sayfalara görsel yerleştirin. Belgenin yazısı durur; görsel seçilen noktaya biner. Görüntüleyicide Görsel aracıyla da ekleyip sürükleyerek taşıyabilirsiniz.",
      suffix: "gorsel-eklendi",
      usesEngine: true,
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "imageFile", label: "Görsel", accept: IMAGES },
      ],
      fields: [
        { name: "pageNumber", label: "Sayfa", type: "number", default: 1, min: 1 },
        { name: "everyPage", label: "Tüm sayfalara ekle", type: "checkbox", default: false, local: true },
        { name: "x", label: "X (punto)", type: "number", default: 40, min: 0 },
        { name: "y", label: "Y (punto, üstten)", type: "number", default: 40, min: 0 },
        { name: "imageScalePercent", label: "Genişlik (sayfanın %)", type: "range", default: 30, min: 5, max: 100, unit: "%" },
      ],
      httpError: (status, detail) => (status >= 500
        ? "Görsel sayfaya yerleştirilemedi." + (detail ? ` (${String(detail).replace(/\s+/g, " ").slice(0, 160)})` : "")
        : null),
      async run({ files, values, engine }) {
        const dest = files.fileInput[0];
        const image = files.imageFile[0];
        if (!image) throw new Error("Görsel seçin.");
        const info = await window.SecuriPreview.pageInfo(dest);
        if (!info.length) throw new Error("PDF sayfaları okunamadı.");
        const target = Math.max(1, Math.min(info.length, Number(values.pageNumber) || 1));
        const scale = Math.max(5, Number(values.imageScalePercent) || 30) / 100;
        const x = Math.max(0, Number(values.x) || 0);
        const y = Math.max(0, Number(values.y) || 0);
        const pages = values.everyPage ? info : [info[target - 1]];
        const overlays = [];
        for (const page of pages) {
          const width = Math.max(20, page.width * scale);
          let layer;
          try {
            layer = await imageLayerPdf(page, image, x, y, width);
          } catch {
            throw new Error("Görsel açılamadı. PNG, JPEG veya WebP deneyin.");
          }
          overlays.push(pdfFile(layer, `gorsel-${page.number}.pdf`));
        }
        if (values.everyPage) {
          const layer = overlays.length === 1 ? await overlays[0].arrayBuffer() : await mergePdfs(engine, overlays);
          return overlayPdfs(engine, new Uint8Array(await dest.arrayBuffer()), new Uint8Array(layer), false);
        }
        const pageBytes = await extractPages(engine, dest, String(target));
        const stamped = await overlayPdfs(engine, pageBytes, new Uint8Array(await overlays[0].arrayBuffer()), false);
        const parts = [];
        if (target > 1) parts.push(pdfFile(await extractPages(engine, dest, `1-${target - 1}`), "once.pdf"));
        parts.push(pdfFile(stamped, "orta.pdf"));
        if (target < info.length) parts.push(pdfFile(await extractPages(engine, dest, `${target + 1}-${info.length}`), "sonra.pdf"));
        return parts.length === 1 ? new Uint8Array(await parts[0].arrayBuffer()) : mergePdfs(engine, parts);
      },
    },
    {
      id: "remove-image-pdf",
      category: "optimize",
      title: "Görselleri Kaldır",
      description: "PDF'e gömülü görselleri silin. Metin kalır; dosya küçülür.",
      apiPath: "/api/v1/general/remove-image-pdf",
      suffix: "gorselsiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "compare-pdfs",
      category: "edit",
      title: "PDF Karşılaştır",
      description: "İki PDF'in metin katmanını sayfa sayfa karşılaştırır. Silinen kelimeler kırmızı, eklenenler yeşil işaretlenir. Sonuç PDF rapordur.",
      suffix: "karsilastirma",
      batch: false,
      files: [
        { name: "fileInput", label: "İlk PDF", accept: PDF },
        { name: "fileInput2", label: "İkinci PDF", accept: PDF },
      ],
      fields: [],
      async run({ files, htmlToPdf }) {
        const left = files.fileInput[0];
        const right = files.fileInput2[0];
        const [leftLines, rightLines] = await Promise.all([
          window.SecuriPreview.textLines(left),
          window.SecuriPreview.textLines(right),
        ]);
        const { html, page } = window.SecuriFormats.compareReport(left.name, right.name, leftLines, rightLines);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "add-form-fields",
      category: "edit",
      title: "Form Alanı Ekle",
      description: "Görüntüleyicide sürükleyerek metin, onay kutusu veya liste alanı ekleyin. Eklenen alanlar AcroForm'dur; Form Doldur veya Kaydet ile yazılır. Hesaplama ve JavaScript eklenmez.",
      viewer: true,
      suffix: "formlu",
      batch: false,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "kind", label: "Alan türü", type: "select", local: true, cliOnly: true, default: "text", options: [
          { value: "text", label: "Metin" },
          { value: "checkbox", label: "Onay kutusu" },
          { value: "dropdown", label: "Liste" },
        ] },
        { name: "fieldName", label: "Alan adı", type: "text", local: true, cliOnly: true, default: "alan1" },
        { name: "pageNumber", label: "Sayfa", type: "number", cliOnly: true, default: 1, min: 1 },
        { name: "x", label: "X (punto)", type: "number", cliOnly: true, default: 72, min: 0 },
        { name: "y", label: "Y (punto, alttan)", type: "number", cliOnly: true, default: 700, min: 0 },
        { name: "width", label: "Genişlik", type: "number", cliOnly: true, default: 180, min: 12 },
        { name: "height", label: "Yükseklik", type: "number", cliOnly: true, default: 18, min: 12 },
        { name: "value", label: "Varsayılan / seçenekler (;)", type: "text", local: true, cliOnly: true, default: "" },
      ],
      async run({ files, values, addFormFields }) {
        const bytes = new Uint8Array(await files.fileInput[0].arrayBuffer());
        const options = String(values.value || "").split(";").map((item) => item.trim()).filter(Boolean);
        return addFormFields(bytes, [{
          page: Math.max(1, Number(values.pageNumber) || 1),
          kind: values.kind || "text",
          name: values.fieldName || "alan1",
          x: Number(values.x) || 0,
          y: Number(values.y) || 0,
          width: Number(values.width) || 180,
          height: Number(values.height) || 18,
          value: values.kind === "dropdown" ? (options[0] || "") : (values.value || ""),
          options: values.kind === "dropdown" ? options : [],
          multiline: Number(values.height) > 28,
        }]);
      },
    },
    {
      id: "fill-forms",
      category: "edit",
      title: "Form Doldur",
      description: "PDF form alanlarını görüntüleyicide doldurun ve Kaydet ile yazın. Yeni alan için Form Alanı Ekle kullanın; kilitli formlar için önce Form Kilidini Aç.",
      viewer: true,
      batch: false,
      files: [{ name: "fileInput", label: "PDF formu", accept: PDF }],
      fields: [],
    },
    {
      id: "unlock-pdf-forms",
      category: "edit",
      title: "Form Kilidini Aç",
      description: "PDF form alanlarının düzenleme kısıtlamasını kaldırır; alanlar tekrar doldurulabilir olur.",
      apiPath: "/api/v1/misc/unlock-pdf-forms",
      suffix: "form-acik",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "pdf-to-ppt",
      category: "convert",
      title: "PDF → PowerPoint",
      description: "PDF sayfalarını PowerPoint sunumuna (.pptx) dönüştürün. Metin slayt için LibreOffice, görsel slayt için PowerPoint kullanılır. İkisi de yoksa sayfalar yine görsel bir sunum olarak kaydedilir.",
      suffix: "",
      outputExt: "pptx",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint, pagePicker: true },
        { name: "dpi", label: "Görsel slayt çözünürlüğü (DPI)", type: "number", default: 120, min: 72, max: 300 },
      ],
      async run({ files, values, engine, office, note }) {
        const file = files.fileInput[0];
        try {
          const form = new FormData();
          form.append("fileInput", file, file.name);
          form.append("outputFormat", "pptx");
          return await engine("/api/v1/convert/pdf/presentation", form);
        } catch {
          /* LibreOffice yoksa görsel slayt */
        }
        const form = new FormData();
        form.append("fileInput", file, file.name);
        form.append("imageFormat", "png");
        form.append("singleOrMultiple", "multiple");
        form.append("colorType", "color");
        form.append("dpi", String(values.dpi || 120));
        form.append("pageNumbers", values.pageNumbers || "all");
        const zip = await engine("/api/v1/convert/pdf/img", form);
        try {
          const pptx = await office(new File([zip], "sayfalar.zip", { type: "application/zip" }), "pptx");
          note("Sayfalar görsel slayt olarak aktarıldı (PowerPoint).");
          return pptx;
        } catch {
          note("Sayfalar görsel slayt olarak aktarıldı.");
          return window.SecuriFormats.imagesToPptx(await window.SecuriFormats.zipEntries(zip));
        }
      },
    },
    {
      id: "get-info-on-pdf",
      category: "optimize",
      title: "PDF Bilgisi",
      description: "Sayfa sayısı, şifreleme, form, üstveri ve gömülü dosya özetini PDF rapor olarak üretir.",
      suffix: "bilgi",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      async run({ files, engine, htmlToPdf }) {
        const file = files.fileInput[0];
        const info = await pdfInfo(engine, file);
        const { html, page } = window.SecuriFormats.infoReport(file.name, info);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "edit-table-of-contents",
      category: "edit",
      title: "İçindekiler",
      description: "PDF yer imlerini okuyun veya JSON ile değiştirin. Ayrı bir içindekiler sayfası basılmaz.",
      apiPath: (values) => values.mode === "edit"
        ? "/api/v1/general/edit-table-of-contents"
        : "/api/v1/general/extract-bookmarks",
      suffix: "yer-imi",
      outputExt: (bytes) => (bytes[0] === 0x7b || bytes[0] === 0x5b ? "json" : "pdf"),
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "mode", label: "İşlem", type: "select", local: true, default: "extract", options: [
          { value: "extract", label: "Yer imlerini oku" },
          { value: "edit", label: "Yer imlerini yaz" },
        ] },
        { name: "bookmarkData", label: "Yer imi JSON", type: "textarea", required: true, rows: 8,
          showIf: { mode: "edit" },
          placeholder: '[{"title":"Bölüm 1","pageNumber":1,"children":[]}]',
          hint: "Her öğede title ve pageNumber zorunlu." },
        { name: "replaceExisting", label: "Mevcut yer imlerini değiştir", type: "checkbox", default: true,
          showIf: { mode: "edit" } },
      ],
    },
    {
      id: "add-attachments",
      category: "edit",
      title: "Ek dosya ekle",
      description: "PDF'in içine dosya gömer. Ekler, belgeyi açan programın ekler panelinde görünür.",
      apiPath: "/api/v1/misc/add-attachments",
      suffix: "ekli",
      batch: false,
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "attachments", label: "Eklenecek dosyalar", multiple: true, min: 1 },
      ],
      fields: [
        { name: "convertToPdfA3b", label: "PDF/A-3b uyumlu yaz", type: "checkbox", default: false },
      ],
    },
    {
      id: "extract-attachments",
      category: "optimize",
      title: "Ekleri çıkar",
      description: "PDF'e gömülü dosya eklerini ZIP olarak çıkarır. Ek yoksa işlem hata verir.",
      apiPath: "/api/v1/misc/extract-attachments",
      suffix: "ekler",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "create-portfolio",
      category: "pages",
      title: "Portföy oluştur",
      description: "Seçilen PDF'lerin sayfalarını bir kapak sayfasının ardına ekler. PDF olmayan dosyalar belgenin ekine konur.",
      suffix: "portfoy",
      batch: false,
      usesEngine: true,
      files: [{ name: "files", label: "Dosyalar", multiple: true, min: 2 }],
      fields: [
        { name: "coverTitle", label: "Kapak başlığı", type: "text", default: "" },
        { name: "coverText", label: "Kapak metni", type: "textarea", rows: 3,
          default: "PDF dosyalarının sayfaları bu kapağın ardından gelir.",
          hint: "Başlığın altında görünür. Her satır ayrı paragraf olur. Boş bırakılırsa bu paragraf yazılmaz." },
      ],
      async run({ files, values, engine, htmlToPdf, assemble, note }) {
        const inputs = files.files || [];
        const pdfs = [];
        const others = [];
        inputs.forEach((file) => {
          if (/\.pdf$/i.test(file.name || "") || file.type === "application/pdf") pdfs.push(file);
          else others.push(file);
        });
        const english = window.SecuriI18n && window.SecuriI18n.lang === "en";
        const title = (values.coverTitle || "").trim() || (english ? "Portfolio" : "Portföy");
        const stockTr = "PDF dosyalarının sayfaları bu kapağın ardından gelir.";
        const stockEn = "The pages of each PDF follow this cover.";
        let intro = (values.coverText || "").replace(/\r/g, "").trim();
        if (!intro) intro = "";
        else if (english && intro === stockTr) intro = stockEn;
        const extra = others.length
          ? (english
            ? "Files that are not PDFs are attached to this document."
            : "PDF olmayan dosyalar bu belgenin ekindedir.")
          : "";
        const paragraphs = intro.split("\n").map((line) => line.trim()).filter(Boolean)
          .map((line) => `<p>${escapeHtml(line)}</p>`).join("");
        const items = inputs.map((file, index) => `<li>${escapeHtml(file.name || ("dosya-" + (index + 1)))}</li>`).join("");
        const html = `<!doctype html><html lang="${english ? "en" : "tr"}"><head><meta charset="utf-8"><style>
          body{margin:0;font-family:"Segoe UI",sans-serif;color:#0f172a;}
          h1{font-size:28px;margin:0 0 12px;}
          p{font-size:14px;line-height:1.45;margin:0 0 8px;}
          ol{font-size:14px;line-height:1.5;padding-left:1.2em;}
        </style></head><body><h1>${escapeHtml(title)}</h1>${paragraphs}${extra ? `<p>${escapeHtml(extra)}</p>` : ""}<ol>${items}</ol></body></html>`;
        const cover = await htmlToPdf(html, {
          width: 8.27, height: 11.69, marginTop: 0.7, marginRight: 0.7, marginBottom: 0.7, marginLeft: 0.7, landscape: false,
        });
        const parts = [{ bytes: cover, pages: "1-z" }];
        for (const file of pdfs) parts.push({ bytes: new Uint8Array(await file.arrayBuffer()), pages: "1-z" });
        let bytes = parts.length === 1 ? cover : await assemble(parts);
        if (others.length) {
          const form = new FormData();
          form.append("fileInput", pdfFile(bytes, "portfoy.pdf"), "portfoy.pdf");
          others.forEach((file) => form.append("attachments", file, file.name || "ek"));
          bytes = await engine("/api/v1/misc/add-attachments", form);
          note(english
            ? "PDF pages follow the cover. Other files are in the document attachments."
            : "PDF sayfaları kapağın ardında. Diğer dosyalar belgenin ekindedir.");
        }
        return bytes;
      },
    },
    {
      id: "flatten-portfolio",
      category: "pages",
      title: "Portföyü düzleştir",
      description: "Eski PDF portföyünün kapak sarmalayıcısını kaldırır. Yeni portföy çıktısı sayfaları zaten içerir.",
      apiPath: "/api/v1/misc/flatten-portfolio",
      suffix: "duz",
      files: [{ name: "fileInput", label: "Portföy PDF", accept: PDF }],
      fields: [],
    },
    {
      id: "auto-rename",
      category: "edit",
      title: "Otomatik adlandır",
      description: "Dosya adını belgenin başlığından, başlık yoksa ilk metin satırından üretir.",
      suffix: "ad",
      batch: false,
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "useFirstTextAsFallback", label: "Başlık yoksa ilk satırı kullan", type: "checkbox", default: true },
      ],
      async run({ files, values, engine, note }) {
        const file = files.fileInput[0];
        const form = new FormData();
        form.append("fileInput", file, file.name);
        form.append("useFirstTextAsFallback", values.useFirstTextAsFallback ? "true" : "false");
        const bytes = await engine("/api/v1/misc/auto-rename", form);
        const named = new File([bytes], file.name, { type: "application/pdf" });
        let title = "";
        try {
          const info = await pdfInfo(engine, named);
          const piles = [info, info && info.metadata, info && info.info, info && info.documentInfo];
          for (const pile of piles) {
            if (!pile || typeof pile !== "object") continue;
            const found = pile.Title || pile.title;
            if (found && !/untitled|anonymous/i.test(String(found))) {
              title = String(found);
              break;
            }
          }
        } catch { /* başlık okunamadı */ }
        if (!title && values.useFirstTextAsFallback && window.SecuriPreview.textLines) {
          const lines = await window.SecuriPreview.textLines(named);
          const first = lines.find((line) => line && String(line.text || "").trim());
          title = first ? first.text : "";
        }
        const safe = safeFileName(title);
        if (!safe) {
          note("Belgede başlık veya ilk satır bulunamadı. Dosya adı değişmedi.");
          return bytes;
        }
        note("Dosya adı belgenin başlığından geldi.");
        return { bytes, name: safe + ".pdf" };
      },
    },
    {
      id: "replace-invert-pdf",
      category: "optimize",
      title: "Renk değiştir",
      description: "Metin ve zemini yüksek kontrasta çevirir, renkleri tersine alır veya seçtiğiniz renklere boyar.",
      suffix: "renk",
      usesEngine: true,
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "replaceAndInvertOption", label: "İşlem", type: "select", default: "HIGH_CONTRAST_COLOR", options: [
          { value: "HIGH_CONTRAST_COLOR", label: "Yüksek kontrast" },
          { value: "FULL_INVERSION", label: "Renkleri ters çevir" },
          { value: "CUSTOM_COLOR", label: "Özel renk" },
          { value: "COLOR_SPACE_CONVERSION", label: "Baskı renk uzayı (CMYK)" },
        ] },
        { name: "highContrastColorCombination", label: "Kontrast", type: "select", default: "WHITE_TEXT_ON_BLACK",
          showIf: { replaceAndInvertOption: "HIGH_CONTRAST_COLOR" }, options: [
            { value: "WHITE_TEXT_ON_BLACK", label: "Beyaz yazı, siyah zemin" },
            { value: "BLACK_TEXT_ON_WHITE", label: "Siyah yazı, beyaz zemin" },
            { value: "YELLOW_TEXT_ON_BLACK", label: "Sarı yazı, siyah zemin" },
            { value: "GREEN_TEXT_ON_BLACK", label: "Yeşil yazı, siyah zemin" },
          ] },
        { name: "textColor", label: "Yazı rengi", type: "color", default: "#ffffff",
          showIf: { replaceAndInvertOption: "CUSTOM_COLOR" } },
        { name: "backGroundColor", label: "Zemin rengi", type: "color", default: "#000000",
          showIf: { replaceAndInvertOption: "CUSTOM_COLOR" } },
      ],
      async run({ files, values, engine }) {
        const file = files.fileInput[0];
        const form = new FormData();
        form.append("fileInput", file, file.name);
        form.append("replaceAndInvertOption", values.replaceAndInvertOption || "HIGH_CONTRAST_COLOR");
        if (values.replaceAndInvertOption === "HIGH_CONTRAST_COLOR") {
          form.append("highContrastColorCombination", values.highContrastColorCombination || "WHITE_TEXT_ON_BLACK");
        }
        if (values.replaceAndInvertOption === "CUSTOM_COLOR") {
          form.append("textColor", colorDecimal(values.textColor));
          form.append("backGroundColor", colorDecimal(values.backGroundColor));
        }
        return engine("/api/v1/misc/replace-invert-pdf", form);
      },
    },
  ];
})();

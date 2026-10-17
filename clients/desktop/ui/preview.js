import * as pdfjs from "./vendor/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const LOAD_OPTIONS = {
  standardFontDataUrl: "./vendor/pdfjs/standard_fonts/",
  cMapUrl: "./vendor/pdfjs/cmaps/",
  cMapPacked: true,
  wasmUrl: "./vendor/pdfjs/wasm/",
  iccUrl: "./vendor/pdfjs/iccs/",
  enableXfa: false,
};
const THUMB_WIDTH = 104;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function toBytes(source) {
  if (source instanceof Uint8Array) return source.slice();
  return new Uint8Array(await source.arrayBuffer());
}

function kindOf(bytes, name) {
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === "%PDF" || /\.pdf$/i.test(name || "")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (/\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(name || "") ||
      (bytes[0] === 0x89 && head.slice(1) === "PNG") || (bytes[0] === 0xff && bytes[1] === 0xd8) ||
      head === "GIF8" || head === "RIFF") return "image";
  return "other";
}

// Reads names and sizes from the ZIP central directory without unpacking.
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return [];
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count && offset + 46 <= bytes.length; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name.endsWith("/")) entries.push({ name, size });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function renderPage(page, canvas, cssWidth) {
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = Math.floor(viewport.width / ratio) + "px";
  canvas.style.height = Math.floor(viewport.height / ratio) + "px";
  const task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport });
  await task.promise;
}

// ---- Full-page viewer ----

let viewer = null;
let viewerLib = null;

// The viewer component reads the core library from a global, so it is loaded
// only after that global exists.
async function loadViewerLib() {
  if (viewerLib) return viewerLib;
  globalThis.pdfjsLib = pdfjs;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "./vendor/pdfjs/web/pdf_viewer.css";
  document.head.appendChild(css);
  viewerLib = await import("./vendor/pdfjs/web/pdf_viewer.mjs");
  return viewerLib;
}

function closeViewer(force = true) {
  if (!viewer) return true;
  if (!force && viewer.isDirty() && !window.confirm("Kaydedilmemiş işaretlemeler var. Görüntüleyici kapatılsın mı?")) return false;
  const closing = viewer;
  if (closing.thumbsObserver) closing.thumbsObserver.disconnect();
  if (typeof closing.cleanup === "function") closing.cleanup();
  viewer.root.remove();
  document.removeEventListener("keydown", viewer.onKey, true);
  viewer.task.destroy();
  viewer = null;
  if (typeof closing.onClose === "function") closing.onClose();
  return true;
}

const ICONS = {
  prev: '<polyline points="15 18 9 12 15 6"/>',
  next: '<polyline points="9 18 15 12 9 6"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  width: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  select: '<path d="M4 4l7.5 17 1.8-7 7-1.8z"/>',
  highlight: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  ink: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  word: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l2 8 2-5 2 5 2-8"/>',
  pages: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="16.65" y1="16.65" x2="21" y2="21"/>',
  form: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
};

function svgIcon(inner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function t(text) {
  return window.SecuriI18n ? window.SecuriI18n.t(text) : text;
}

function button(label, title, kind, icon) {
  const cls = kind === "primary" ? "viewer-btn viewer-btn-primary"
    : kind === "ghost" ? "viewer-btn viewer-btn-ghost"
    : kind === "icon" ? "viewer-btn viewer-btn-icon"
    : kind === "tool" ? "viewer-btn viewer-btn-tool"
    : "viewer-btn";
  const node = el("button", cls);
  node.type = "button";
  const shown = label ? t(label) : "";
  if (title) node.title = t(title);
  if (icon) node.innerHTML = svgIcon(icon) + (shown ? `<span>${shown}</span>` : "");
  else node.textContent = shown;
  return node;
}

function cluster(...items) {
  const node = el("div", "viewer-cluster");
  node.append(...items.filter(Boolean));
  return node;
}

function group(caption, ...items) {
  const node = el("div", "viewer-group");
  const tools = el("div", "viewer-group-tools");
  tools.append(...items.filter(Boolean));
  node.append(tools, el("span", "viewer-group-caption", caption));
  return node;
}

const MARKS = [
  { mode: pdfjs.AnnotationEditorType.NONE, label: "Seç", title: "Metin seçimi, gezinme, form doldurma ve satır değiştirme" },
  { mode: pdfjs.AnnotationEditorType.HIGHLIGHT, label: "Vurgula", title: "Metni seçerek vurgulayın veya yorum bırakın", color: pdfjs.AnnotationEditorParamsType.HIGHLIGHT_COLOR, initial: "#ffff98" },
  { mode: pdfjs.AnnotationEditorType.INK, label: "Çiz", title: "Serbest çizim", color: pdfjs.AnnotationEditorParamsType.INK_COLOR, initial: "#e11d48" },
  { mode: pdfjs.AnnotationEditorType.FREETEXT, label: "Metin", title: "Yazı tipini, kalın veya italik seçin, sayfaya tıklayıp metin yazın" },
  { mode: pdfjs.AnnotationEditorType.STAMP, label: "Görsel", title: "Sayfaya görsel ekleyin; sürükleyerek taşıyın" },
];

// Stirling writes these fallback faces into the page. "Belgedeki" keeps the run's own fontId
// until bold or italic asks for a face that can carry that style.
const TEXT_FONTS = [
  { id: "", label: "Belgedeki", css: "\"Segoe UI\", sans-serif", face: "" },
  { id: "helvetica", label: "Helvetica", css: "Arial, Helvetica, sans-serif", face: "sans" },
  { id: "times", label: "Times", css: "\"Times New Roman\", Times, serif", face: "serif" },
  { id: "courier", label: "Courier", css: "\"Courier New\", Courier, monospace", face: "mono" },
];

const liberationId = (face, bold, italic) => {
  const family = face === "mono" ? "mono" : face === "serif" ? "serif" : "sans";
  const suffix = bold && italic ? "-bolditalic" : bold ? "-bold" : italic ? "-italic" : "";
  return `fallback-liberation-${family}${suffix}`;
};

const faceFromFontId = (fontId) => {
  const id = String(fontId || "").toLowerCase();
  if (/mono|courier|cour/.test(id)) return "mono";
  if (/serif|times|roman/.test(id)) return "serif";
  return "sans";
};

const fontChoice = (familyId, bold, italic, currentFontId) => {
  const family = TEXT_FONTS.find((font) => font.id === familyId) || TEXT_FONTS[0];
  const face = family.face || ((bold || italic) ? faceFromFontId(currentFontId) : "");
  return {
    css: family.css,
    weight: bold ? "700" : "500",
    style: italic ? "italic" : "normal",
    stirling: face ? liberationId(face, bold, italic) : "",
  };
};

/**
 * Opens `source` in a scrolling viewer with search, zoom and markup tools.
 * options.onSave(bytes) receives the PDF with the markup written into it.
 */
async function openViewer(source, pageNumber, title, options = {}) {
  if (!closeViewer(false)) return;
  const lib = await loadViewerLib();
  const root = el("div", "viewer");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", title ? `Belge: ${title}` : "PDF görüntüleyici");
  const chrome = el("div", "viewer-chrome");
  const top = el("div", "viewer-top");
  const ribbon = el("div", "viewer-ribbon");
  const brand = el("img", "viewer-brand");
  brand.src = "logo-mark.svg";
  brand.alt = "";
  const name = el("span", "viewer-title", title || "Belge");
  const dirtyBadge = el("span", "viewer-dirty", "Kaydedilmedi");
  dirtyBadge.hidden = true;
  const titleWrap = el("div", "viewer-title-wrap");
  titleWrap.append(brand, name, dirtyBadge);

  const prev = button("", "Önceki sayfa", "icon", ICONS.prev);
  const pageInput = el("input", "viewer-page");
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.title = "Sayfaya git";
  const pageTotal = el("span", "viewer-pos");
  const next = button("", "Sonraki sayfa", "icon", ICONS.next);

  const pageBox = el("div", "viewer-page-box");
  pageBox.append(pageInput, pageTotal);

  const zoomOut = button("", "Uzaklaştır", "icon", ICONS.minus);
  const zoomLabel = el("span", "viewer-zoom", "—");
  const zoomIn = button("", "Yakınlaştır", "icon", ICONS.plus);
  const fitWidth = button("Genişlik", "Sayfa genişliğine sığdır", "tool", ICONS.width);
  const fitPage = button("Sığdır", "Tüm sayfayı göster", "tool", ICONS.fit);
  const rotate = button("Döndür", "Sayfaları 90° döndür", "tool", ICONS.rotate);

  const find = el("input", "viewer-find");
  find.type = "search";
  find.placeholder = "Belgede ara";
  find.setAttribute("aria-label", "Belgede ara (Ctrl+F)");
  const findPrev = button("", "Önceki eşleşme", "icon", ICONS.prev);
  const findNext = button("", "Sonraki eşleşme", "icon", ICONS.next);
  const findCount = el("span", "viewer-count");
  const searchBox = el("div", "viewer-search");
  const searchIcon = el("span", "viewer-search-icon");
  searchIcon.innerHTML = svgIcon(ICONS.search);
  searchBox.append(searchIcon, find, findPrev, findNext, findCount);

  const marks = el("div", "viewer-marks");
  const markIcons = [ICONS.select, ICONS.highlight, ICONS.ink, ICONS.text, ICONS.image];
  const markButtons = MARKS.map((mark, index) => {
    const node = button(mark.label, mark.title, "tool", markIcons[index]);
    node.dataset.mode = String(mark.mode);
    marks.appendChild(node);
    return node;
  });
  const color = el("input", "viewer-color");
  color.type = "color";
  color.title = "Renk";
  color.hidden = true;
  marks.appendChild(color);
  const textFont = el("select", "viewer-font");
  textFont.title = "Yazı tipi";
  textFont.hidden = true;
  textFont.setAttribute("aria-label", "Yazı tipi");
  TEXT_FONTS.filter((font) => font.face).forEach((font) => {
    const option = el("option", null, t(font.label));
    option.value = font.id;
    option.style.fontFamily = font.css;
    textFont.appendChild(option);
  });
  textFont.value = "helvetica";
  const styleToggle = (label, title) => {
    const node = button(label, title);
    node.classList.add("style-toggle");
    node.setAttribute("aria-pressed", "false");
    return node;
  };
  const bindToggle = (node, onChange) => {
    node.onclick = () => {
      const on = !node.classList.contains("on");
      node.classList.toggle("on", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
      onChange();
    };
  };
  const textBold = styleToggle("B", "Kalın");
  textBold.style.fontWeight = "700";
  textBold.hidden = true;
  const textItalic = styleToggle("I", "İtalik");
  textItalic.style.fontStyle = "italic";
  textItalic.hidden = true;
  const textSize = el("input", "viewer-size");
  textSize.type = "number";
  textSize.min = "6";
  textSize.max = "72";
  textSize.value = "14";
  textSize.title = "Yazı boyutu (punto)";
  textSize.setAttribute("aria-label", "Yazı boyutu");
  textSize.hidden = true;
  const textColor = el("input", "viewer-color");
  textColor.type = "color";
  textColor.value = "#111827";
  textColor.title = "Yazı rengi";
  textColor.setAttribute("aria-label", "Yazı rengi");
  textColor.hidden = true;
  marks.append(textFont, textBold, textItalic, textSize, textColor);
  const replace = button("Metni değiştir", "Seçilen satırı veya hücreyi değiştirir. Sütundaki diğer satırlar olduğu gibi kalır.", "tool", ICONS.edit);
  const formBtn = options.addFormFields
    ? button("Form", "Sayfada sürükleyerek metin, onay kutusu veya liste alanı ekleyin.", "tool", ICONS.form)
    : null;
  const printBtn = button("Yazdır", "Belgeyi yazıcıya gönderin (Ctrl+P)", "ghost", ICONS.print);
  const toWord = options.onToWord ? button("Word", "Uzun düzenleme için Word belgesine dönüştürün", "ghost", ICONS.word) : null;
  const save = button("Kaydet", "İşaretlemeleri, formu ve yorumları PDF'e yazın (Ctrl+S)", "primary", ICONS.save);
  save.disabled = true;
  const close = button("", "Görüntüleyiciyi kapat (Esc)", "icon", ICONS.close);
  close.classList.add("viewer-btn-close");

  top.append(titleWrap, searchBox, cluster(...[printBtn, toWord, save].filter(Boolean)), close);
  const processBtns = options.onProcess ? [
    button("OCR", "Taranmış sayfayı aranabilir yap, sonra karartın veya imzalayın", "tool", ICONS.text),
    button("Karart", "Kişisel veriyi kalıcı olarak kapatın", "tool", ICONS.highlight),
    button("İmzala", "Dijital imza ekleyin", "tool", ICONS.edit),
  ] : [];
  if (processBtns.length) {
    processBtns[0].onclick = () => options.onProcess("ocr-pdf");
    processBtns[1].onclick = () => options.onProcess("redact");
    processBtns[2].onclick = () => options.onProcess("cert-sign");
  }
  ribbon.append(...[
    group("Sayfa", prev, pageBox, next),
    group("Görünüm", zoomOut, zoomLabel, zoomIn, fitWidth, fitPage, rotate),
    group("İşaretle", marks),
    group("Düzenle", replace, formBtn),
    processBtns.length ? group("İşle", ...processBtns) : null,
  ].filter(Boolean));
  chrome.append(top, ribbon);
  const workspace = el("div", "viewer-workspace");
  const thumbs = el("aside", "viewer-thumbs");
  const thumbsHead = el("div", "viewer-thumbs-head");
  const thumbsTitle = el("strong", null, "Sayfalar");
  const thumbsToggle = button("", "Sayfa listesini gizle veya göster", "icon", ICONS.pages);
  thumbsHead.append(thumbsTitle, thumbsToggle);
  const thumbsList = el("div", "viewer-thumbs-list");
  thumbs.append(thumbsHead, thumbsList);
  thumbsToggle.onclick = () => {
    root.classList.toggle("thumbs-collapsed");
    thumbsToggle.title = root.classList.contains("thumbs-collapsed") ? "Sayfa listesini göster" : "Sayfa listesini gizle";
  };
  const body = el("div", "viewer-body");
  const stage = el("div", "viewer-stage");
  const pages = el("div", "pdfViewer");
  const loading = el("p", "viewer-loading", "Belge açılıyor…");
  stage.appendChild(pages);
  body.append(stage, loading);
  workspace.append(thumbs, body);
  const status = el("div", "viewer-status");
  const statusPage = el("span", "viewer-status-page", "Sayfa —");
  const statusMode = el("span", "viewer-status-mode", MARKS[0].title);
  const statusKeys = el("span", "viewer-status-keys", "Ctrl+S kaydet · Ctrl+F ara · Esc kapat");
  const statusZoom = el("span", "viewer-status-zoom", "—");
  status.append(statusPage, statusMode, statusKeys, statusZoom);
  const jobProgress = el("div", "viewer-progress");
  jobProgress.hidden = true;
  const jobTrack = el("div", "progress");
  const jobBar = el("div", "progress-bar");
  jobTrack.appendChild(jobBar);
  const jobLabel = el("span", "viewer-progress-label", "");
  jobProgress.append(jobTrack, jobLabel);
  root.append(chrome, workspace, jobProgress, status);
  const setJobProgress = (percent, label) => {
    jobProgress.hidden = false;
    jobBar.classList.remove("indeterminate");
    jobBar.style.width = Math.max(4, Math.min(100, percent)) + "%";
    jobLabel.textContent = label;
    statusMode.textContent = label;
  };
  const hideJobProgress = () => { jobProgress.hidden = true; };
  document.body.appendChild(root);

  const eventBus = new lib.EventBus();
  const linkService = new lib.PDFLinkService({ eventBus });
  const findController = new lib.PDFFindController({ eventBus, linkService });
  const pdfViewer = new lib.PDFViewer({
    container: stage,
    viewer: pages,
    eventBus,
    linkService,
    findController,
    annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
    textLayerMode: 1,
    annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
    enableHighlightFloatingButton: true,
    imageResourcesPath: "./vendor/pdfjs/web/images/",
  });
  linkService.setViewer(pdfViewer);

  let dirty = false;
  let formMode = false;
  let hideFormDraft = () => {};
  let hideAdd = () => {};
  let setFormMode = () => {};
  let printDocument = () => {};
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: await toBytes(source), password: options.password || undefined });
  const onKey = (event) => {
    const typing = event.target.closest && event.target.closest("input, textarea, [contenteditable=true], .freeTextEditor");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      find.focus();
      find.select();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      printDocument();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save.click();
    } else if (!typing && event.key === "PageDown") {
      event.preventDefault();
      pdfViewer.nextPage();
    } else if (!typing && event.key === "PageUp") {
      event.preventDefault();
      pdfViewer.previousPage();
    } else if (event.key === "Escape" && !typing) {
      if (formMode) { event.preventDefault(); setFormMode(false); hideFormDraft(); return; }
      closeViewer(false);
    }
  };
  document.addEventListener("keydown", onKey, true);
  const current = { root, onKey, task, isDirty: () => dirty, onClose: options.onClose };
  viewer = current;

  let doc;
  try {
    doc = await task.promise;
  } catch {
    if (viewer === current) {
      loading.textContent = "PDF açılamadı.";
    }
    return;
  }
  if (viewer !== current) return;
  const markDirty = (value) => {
    dirty = value;
    save.disabled = false;
    dirtyBadge.hidden = !value;
  };
  save.disabled = false;
  doc.annotationStorage.onSetModified = () => markDirty(true);
  doc.annotationStorage.onResetModified = () => markDirty(false);
  pdfViewer.setDocument(doc);
  linkService.setDocument(doc, null);
  pageTotal.textContent = `/ ${doc.numPages}`;
  pageInput.max = String(doc.numPages);

  const fillThumbs = (document) => {
    if (current.thumbsObserver) current.thumbsObserver.disconnect();
    thumbsList.replaceChildren();
    thumbsTitle.textContent = `${document.numPages} sayfa`;
    const observer = new IntersectionObserver((items) => {
      items.forEach((item) => {
        if (!item.isIntersecting) return;
        observer.unobserve(item.target);
        const number = Number(item.target.dataset.page);
        document.getPage(number)
          .then((page) => renderPage(page, item.target.querySelector("canvas"), THUMB_WIDTH))
          .catch(() => {});
      });
    }, { root: thumbsList, rootMargin: "200px" });
    current.thumbsObserver = observer;
    for (let number = 1; number <= document.numPages; number++) {
      const cell = el("button", "viewer-thumb");
      cell.type = "button";
      cell.dataset.page = String(number);
      cell.title = `Sayfa ${number}`;
      const canvas = el("canvas");
      canvas.style.width = THUMB_WIDTH + "px";
      canvas.style.height = Math.round(THUMB_WIDTH * 1.41) + "px";
      cell.append(canvas, el("span", null, String(number)));
      cell.onclick = () => { pdfViewer.currentPageNumber = number; };
      thumbsList.appendChild(cell);
      observer.observe(cell);
    }
  };
  fillThumbs(doc);

  let restoreView = null;
  eventBus.on("pagesinit", () => {
    loading.remove();
    if (restoreView) {
      pdfViewer.currentScaleValue = restoreView.scale;
      pdfViewer.currentPageNumber = restoreView.page;
      restoreView = null;
      return;
    }
    pdfViewer.currentScaleValue = "page-fit";
    pdfViewer.currentPageNumber = Math.min(doc.numPages, Math.max(1, pageNumber));
  });
  eventBus.on("pagechanging", ({ pageNumber: number }) => {
    pageInput.value = String(number);
    statusPage.textContent = `Sayfa ${number} / ${doc.numPages}`;
    prev.disabled = number <= 1;
    next.disabled = number >= doc.numPages;
    thumbsList.querySelectorAll(".viewer-thumb").forEach((node) => {
      const currentPage = node.dataset.page === String(number);
      node.classList.toggle("current", currentPage);
      if (currentPage) node.scrollIntoView({ block: "nearest" });
    });
  });
  eventBus.on("scalechanging", ({ scale }) => {
    const shown = Math.round(scale * 100) + "%";
    zoomLabel.textContent = shown;
    statusZoom.textContent = shown;
  });

  prev.onclick = () => pdfViewer.previousPage();
  next.onclick = () => pdfViewer.nextPage();
  pageInput.onchange = () => {
    const number = Math.round(Number(pageInput.value));
    if (number >= 1 && number <= doc.numPages) pdfViewer.currentPageNumber = number;
    else pageInput.value = String(pdfViewer.currentPageNumber);
  };
  zoomIn.onclick = () => pdfViewer.increaseScale();
  zoomOut.onclick = () => pdfViewer.decreaseScale();
  fitWidth.onclick = () => { pdfViewer.currentScaleValue = "page-width"; };
  fitPage.onclick = () => { pdfViewer.currentScaleValue = "page-fit"; };
  rotate.onclick = () => { pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360; };

  printDocument = async () => {
    printBtn.disabled = true;
    const host = el("div", "print-sheet");
    document.body.appendChild(host);
    try {
      const limit = Math.min(doc.numPages, 200);
      for (let number = 1; number <= limit; number++) {
        const page = await doc.getPage(number);
        const viewport = page.getViewport({ scale: 1.5, rotation: pdfViewer.pagesRotation });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const img = el("img");
        img.src = canvas.toDataURL("image/png");
        img.alt = `Sayfa ${number}`;
        host.appendChild(img);
        page.cleanup();
      }
      window.print();
    } catch {
      window.alert("Yazdırma başlatılamadı.");
    } finally {
      host.remove();
      printBtn.disabled = false;
    }
  };
  printBtn.onclick = () => printDocument();

  const search = (type, findPrevious = false) => {
    eventBus.dispatch("find", {
      source: find, type, query: find.value, caseSensitive: false, entireWord: false,
      highlightAll: true, findPrevious, matchDiacritics: false,
    });
  };
  find.addEventListener("input", () => search(""));
  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); search("again", event.shiftKey); }
  });
  findNext.onclick = () => search("again");
  findPrev.onclick = () => search("again", true);
  const showCount = ({ matchesCount, state }) => {
    if (!find.value) findCount.textContent = "";
    else if (state === lib.FindState.NOT_FOUND || (matchesCount && !matchesCount.total)) findCount.textContent = "Bulunamadı";
    else if (matchesCount && matchesCount.total) findCount.textContent = `${matchesCount.current} / ${matchesCount.total}`;
  };
  eventBus.on("updatefindmatchescount", showCount);
  eventBus.on("updatefindcontrolstate", showCount);

  setFormMode = (on) => {
    formMode = on;
    if (formBtn) formBtn.classList.toggle("active", on);
    root.classList.toggle("form-placing", on);
    if (on) {
      hideFormDraft();
      hideAdd();
      root.classList.remove("text-placing");
      textFont.hidden = true;
      textBold.hidden = true;
      textItalic.hidden = true;
      textSize.hidden = true;
      textColor.hidden = true;
      activeMark = MARKS[0];
      try { pdfViewer.annotationEditorMode = { mode: pdfjs.AnnotationEditorType.NONE }; } catch { /* ignore */ }
      markButtons.forEach((node) => node.classList.remove("active"));
      statusMode.textContent = "Sayfada sürükleyerek form alanı çizin. Metin, onay kutusu veya liste eklenir.";
    } else {
      hideFormDraft();
      if (!markButtons.some((node) => node.classList.contains("active"))) {
        statusMode.textContent = MARKS[0].title;
      }
    }
  };
  const setMark = (mark) => {
    if (formMode) setFormMode(false);
    const placingText = mark.mode === pdfjs.AnnotationEditorType.FREETEXT;
    try {
      pdfViewer.annotationEditorMode = { mode: placingText ? pdfjs.AnnotationEditorType.NONE : mark.mode };
    } catch {
      return;
    }
    root.classList.toggle("text-placing", placingText);
    markButtons.forEach((node) => node.classList.toggle("active", node.dataset.mode === String(mark.mode)));
    statusMode.textContent = t(mark.title);
    color.hidden = !mark.color || placingText;
    textFont.hidden = !placingText;
    textBold.hidden = !placingText;
    textItalic.hidden = !placingText;
    textSize.hidden = !placingText;
    textColor.hidden = !placingText;
    if (!placingText) hideAdd();
    if (mark.mode === pdfjs.AnnotationEditorType.HIGHLIGHT) {
      eventBus.dispatch("switchannotationeditorparams", {
        source: color,
        type: pdfjs.AnnotationEditorParamsType.HIGHLIGHT_FREE,
        value: false,
      });
    }
    if (mark.color) {
      color.value = mark.current || mark.initial;
      eventBus.dispatch("switchannotationeditorparams", { source: color, type: mark.color, value: color.value });
    }
  };
  let activeMark = MARKS[0];
  markButtons.forEach((node, index) => { node.onclick = () => { activeMark = MARKS[index]; setMark(activeMark); }; });
  color.oninput = () => {
    activeMark.current = color.value;
    eventBus.dispatch("switchannotationeditorparams", { source: color, type: activeMark.color, value: color.value });
  };
  eventBus.on("annotationeditoruimanager", () => setMark(MARKS[0]));

  // Toolbar clicks would clear the text selection; keep it so "Metni değiştir" can read it.
  chrome.addEventListener("mousedown", (event) => {
    if (event.target.closest("input, textarea, select, [contenteditable=true]")) return;
    event.preventDefault();
  });

  const field = el("textarea", "replace-field");
  field.hidden = true;
  field.rows = 2;
  field.setAttribute("aria-label", "Yeni metin");
  field.setAttribute("spellcheck", "false");
  const actions = el("div", "replace-actions");
  actions.hidden = true;
  const fontSel = el("select", "replace-font");
  fontSel.title = "Yazı tipi. Belgedeki, satırın kendi yazı tipini korur.";
  fontSel.setAttribute("aria-label", "Yazı tipi");
  TEXT_FONTS.forEach((font) => {
    const option = el("option", null, t(font.label));
    option.value = font.id;
    option.style.fontFamily = font.css;
    fontSel.appendChild(option);
  });
  const sizeInput = el("input", "replace-size");
  sizeInput.type = "number";
  sizeInput.min = "6";
  sizeInput.max = "72";
  sizeInput.placeholder = "pt";
  sizeInput.title = "Yazı boyutu (punto). Boş bırakılırsa belgedeki boyut kalır.";
  sizeInput.setAttribute("aria-label", "Yazı boyutu");
  const replaceColor = el("input", "viewer-color");
  replaceColor.type = "color";
  replaceColor.value = "#111827";
  replaceColor.title = "Yazı rengi. Değiştirirseniz belgeye bu renk yazılır.";
  replaceColor.setAttribute("aria-label", "Yazı rengi");
  const boldBtn = styleToggle("B", "Kalın");
  boldBtn.style.fontWeight = "700";
  const italicBtn = styleToggle("I", "İtalik");
  italicBtn.style.fontStyle = "italic";
  const applyBtn = button("Uygula", "Değişikliği belgenin yazısına işle", "primary");
  const cancelBtn = button("Vazgeç");
  actions.append(fontSel, boldBtn, italicBtn, sizeInput, replaceColor, applyBtn, cancelBtn);
  let colorTouched = false;
  root.append(field, actions);
  let pendingReplace = null;
  const covers = [];

  const clearCovers = () => {
    covers.splice(0).forEach((node) => node.remove());
  };

  const hideReplace = () => {
    field.hidden = true;
    actions.hidden = true;
    root.append(field, actions);
    clearCovers();
    pendingReplace = null;
  };

  const padBox = (rect, pad) => ({
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  });

  const textSpans = (pageEl) => Array.from(pageEl.querySelectorAll(".textLayer span")).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent || "",
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }).filter((item) => item.width > 1 && item.height > 1 && item.text.trim());

  const sameBand = (a, b) => {
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlap > Math.min(a.height, b.height) * 0.45;
  };

  // Joins fragments of the selected cell. A gap the size of another column stays a different cell,
  // and nothing above or below the selection is pulled in.
  const cellMates = (spans, seeds) => {
    const selected = new Set(seeds);
    let growing = true;
    while (growing) {
      growing = false;
      spans.forEach((item) => {
        if (selected.has(item)) return;
        const touch = Array.from(selected).some((mate) => {
          if (!sameBand(mate, item)) return false;
          const gap = item.left >= mate.right ? item.left - mate.right : mate.left - item.right;
          return gap < Math.max(6, mate.height * 0.45);
        });
        if (touch) {
          selected.add(item);
          growing = true;
        }
      });
    }
    return Array.from(selected).sort((a, b) => a.left - b.left);
  };

  const wrapLines = (ctx, text, maxWidth) => {
    const lines = [];
    String(text).replace(/\r/g, "").split("\n").forEach((block) => {
      const words = block.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      if (!words.length) {
        lines.push("");
        return;
      }
      let current = "";
      words.forEach((word) => {
        const trial = current ? current + " " + word : word;
        if (current && ctx.measureText(trial).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = trial;
        }
      });
      if (current) lines.push(current);
    });
    return lines.length ? lines : [""];
  };

  const captureSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !root.contains(sel.anchorNode)) return null;
    const text = String(sel).replace(/\s+/g, " ").trim();
    if (!text) return null;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const pageEl = node && node.closest && node.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return null;
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!pageNumber || !view || !view.getPagePoint) return null;
    const range = sel.getRangeAt(0);
    const screen = Array.from(range.getClientRects()).filter((box) => box.width > 1 && box.height > 1);
    if (!screen.length) return null;
    const originEl = pageEl.querySelector(".canvasWrapper") || pageEl.querySelector("canvas") || pageEl;
    const origin = originEl.getBoundingClientRect();
    const spans = textSpans(pageEl);
    const hits = spans.filter((item) => screen.some((rect) =>
      item.left < rect.right && item.right > rect.left && item.top < rect.bottom && item.bottom > rect.top));
    const bands = [];
    hits.slice().sort((a, b) => a.top - b.top || a.left - b.left).forEach((hit) => {
      const band = bands.find((entry) => sameBand(entry.seed, hit));
      if (band) band.hits.push(hit);
      else bands.push({ seed: hit, hits: [hit] });
    });
    let lines = (bands.length ? bands : []).map((band) => cellMates(spans, band.hits));
    const rowHasAnotherColumn = (line) => {
      const left = Math.min(...line.map((item) => item.left));
      const right = Math.max(...line.map((item) => item.right));
      const band = { top: Math.min(...line.map((item) => item.top)), bottom: Math.max(...line.map((item) => item.bottom)), height: Math.max(...line.map((item) => item.height)) };
      return spans.some((item) => !line.includes(item) && sameBand(band, item) && (item.right < left - 8 || item.left > right + 8));
    };
    if (lines.length > 1 && lines.some(rowHasAnotherColumn)) {
      const anchorEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const anchorMid = anchorEl ? (anchorEl.getBoundingClientRect().top + anchorEl.getBoundingClientRect().bottom) / 2 : lines[0][0].top;
      lines = [lines.reduce((best, line) => {
        const mid = (Math.min(...line.map((item) => item.top)) + Math.max(...line.map((item) => item.bottom))) / 2;
        const bestMid = (Math.min(...best.map((item) => item.top)) + Math.max(...best.map((item) => item.bottom))) / 2;
        return Math.abs(mid - anchorMid) < Math.abs(bestMid - anchorMid) ? line : best;
      })];
    }
    const pad = Math.max(2, (screen[0].height || 12) * 0.12);
    let boxes = lines.length
      ? lines.map((line) => {
        const left = Math.min(...line.map((item) => item.left));
        const top = Math.min(...line.map((item) => item.top));
        const right = Math.max(...line.map((item) => item.right));
        const bottom = Math.max(...line.map((item) => item.bottom));
        return padBox({ left, top, right, bottom, width: right - left, height: bottom - top }, pad);
      })
      : screen.map((rect) => padBox(rect, pad));
    const value = lines.length
      ? lines.map((line) => line.map((item) => item.text).join("")).join("\n").trim()
      : text;
    const wrapWidth = Math.max(...boxes.map((box) => box.width));
    const toPdf = (x, y) => view.getPagePoint(x - origin.left, y - origin.top);
    const pdfOf = (box) => {
      const a = toPdf(box.left, box.top);
      const b = toPdf(box.right, box.bottom);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    return { text: value, pageNumber, pageEl, originEl, view, boxes, pdfRects: boxes.map(pdfOf), wrapWidth };
  };

  const showReplace = (found) => {
    hideReplace();
    pendingReplace = found;
    const pageBox = found.pageEl.getBoundingClientRect();
    found.boxes.forEach((box) => {
      const cover = el("div", "replace-cover");
      cover.style.left = (box.left - pageBox.left) + "px";
      cover.style.top = (box.top - pageBox.top) + "px";
      cover.style.width = box.width + "px";
      cover.style.height = box.height + "px";
      found.pageEl.appendChild(cover);
      covers.push(cover);
    });
    const first = found.boxes[0];
    const last = found.boxes[found.boxes.length - 1];
    const blockWidth = found.wrapWidth || Math.max(...found.boxes.map((box) => box.width));
    const blockHeight = Math.max(last.bottom - first.top, first.height);
    field.style.left = (first.left - pageBox.left) + "px";
    field.style.top = (first.top - pageBox.top) + "px";
    field.style.width = Math.max(blockWidth, 72) + "px";
    field.style.height = Math.max(blockHeight, 36) + "px";
    field.value = found.text;
    field.style.fontSize = Math.round(Math.max(12, first.height * 0.72)) + "px";
    field.style.lineHeight = "1.25";
    colorTouched = false;
    replaceColor.value = "#111827";
    boldBtn.classList.remove("on");
    italicBtn.classList.remove("on");
    boldBtn.setAttribute("aria-pressed", "false");
    italicBtn.setAttribute("aria-pressed", "false");
    paintReplaceFont();
    field.hidden = false;
    found.pageEl.appendChild(field);
    actions.style.left = (first.left - pageBox.left) + "px";
    actions.style.top = (last.bottom - pageBox.top + 6) + "px";
    actions.hidden = false;
    found.pageEl.appendChild(actions);
    field.focus();
    field.select();
    window.getSelection().removeAllRanges();
  };

  const boxOf = (item) => {
    const matrix = item.textMatrix || [];
    const size = Number(item.fontSize || matrix[0] || 12);
    const x = Number(matrix.length > 4 ? matrix[4] : item.x || 0);
    const y = Number(matrix.length > 5 ? matrix[5] : item.y || 0);
    const width = Number(item.width || size);
    const height = Math.max(Number(item.height || 0), size);
    return { left: x, right: x + width, bottom: y - size * 0.25, top: y + height * 0.15, x, y, size };
  };

  const overlapsPdf = (box, rect) => box.left < rect[2] && box.right > rect[0] && box.bottom < rect[3] && box.top > rect[1];

  const wrapPdfLines = (text, fontSize, maxWidth, face) => {
    const measure = document.createElement("canvas").getContext("2d");
    const chosen = face || { css: "sans-serif", weight: "500" };
    measure.font = `${chosen.style || "normal"} ${chosen.weight || 500} ${fontSize}px ${chosen.css || "sans-serif"}`;
    return wrapLines(measure, text, Math.max(40, maxWidth));
  };

  const waitForTextJob = async (jobId, onProgress) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const job = await options.engineGet(`/api/v1/general/job/${jobId}`);
      const reported = Number(job && (job.progress ?? job.percent));
      const fraction = Number.isFinite(reported) && reported > 0
        ? Math.min(1, reported > 1 ? reported / 100 : reported)
        : Math.min(1, (attempt + 1) / 20);
      if (onProgress) onProgress(fraction);
      if (job && job.complete) {
        if (job.error) throw new Error(String(job.error));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt < 6 ? 400 : 900));
    }
    throw new Error("Metin düzenleyici zaman aşımına uğradı.");
  };

  const showEditedDocument = async (bytes, page, scale) => {
    const nextTask = pdfjs.getDocument({ ...LOAD_OPTIONS, data: bytes, password: options.password || undefined });
    const nextDoc = await nextTask.promise;
    if (viewer !== current) { nextTask.destroy(); return false; }
    current.task.destroy();
    current.task = nextTask;
    doc = nextDoc;
    doc.annotationStorage.onSetModified = () => markDirty(true);
    doc.annotationStorage.onResetModified = () => markDirty(false);
    let painted = false;
    const paintedDone = new Promise((resolve) => {
      const onPaint = (evt) => {
        if (evt.pageNumber !== page) return;
        eventBus.off("pagerendered", onPaint);
        painted = true;
        resolve();
      };
      eventBus.on("pagerendered", onPaint);
      setTimeout(() => { eventBus.off("pagerendered", onPaint); resolve(); }, 5000);
    });
    restoreView = { page, scale };
    pdfViewer.setDocument(doc);
    linkService.setDocument(doc, null);
    pageTotal.textContent = `/ ${doc.numPages}`;
    pageInput.max = String(doc.numPages);
    fillThumbs(doc);
    await paintedDone;
    pdfViewer.currentPageNumber = page;
    const view = pdfViewer.getPageView(page - 1);
    if (!painted && view && typeof view.reset === "function") {
      view.reset();
      pdfViewer.update();
    }
    if (view && view.div) view.div.scrollIntoView({ block: "nearest" });
    return true;
  };

  const assignLine = (items, line) => {
    const size = boxOf(items[0]).size;
    items.forEach((item, index) => {
      item.text = index === 0 ? line : "";
      if (index === 0) item.width = Math.max(size, line.length * (Number(item.spaceWidth) || size * 0.5));
      delete item.charCodes;
    });
  };

  const spawnLine = (anchor, line, x, y, size) => ({
    text: line,
    fontId: anchor.fontId,
    fontSize: size,
    fontMatrixSize: size,
    fontSizeInPt: size,
    spaceWidth: size * 0.28,
    width: Math.max(size, line.length * size * 0.5),
    height: size * 0.7,
    zOrder: (Number(anchor.zOrder) || 0) + 1,
    fillColor: anchor.fillColor,
    textMatrix: [size, 0, 0, size, x, y],
  });

  // The selected block keeps its width. Extra lines are new runs under that block;
  // paragraphs below the selection are left where they are.
  const writeLines = (page, chosen, text, bandCount, targetYs) => {
    const groups = [];
    chosen.forEach((item) => {
      const box = boxOf(item);
      const group = groups.find((entry) => Math.abs(entry.y - box.y) < Math.max(2.5, box.size * 0.35));
      if (group) group.items.push(item);
      else groups.push({ y: box.y, items: [item] });
    });
    groups.sort((a, b) => b.y - a.y);
    if (bandCount && groups.length > bandCount) {
      const targets = targetYs && targetYs.length ? targetYs : groups.map((group) => group.y);
      const distance = (group) => Math.min(...targets.map((y) => Math.abs(group.y - y)));
      groups.sort((a, b) => distance(a) - distance(b));
      groups.length = bandCount;
      groups.sort((a, b) => b.y - a.y);
    }
    const upright = chosen.every((item) => {
      const matrix = item.textMatrix || [];
      return Math.abs(Number(matrix[1]) || 0) < 0.25 && Math.abs(Number(matrix[2]) || 0) < 0.25;
    });
    if (!upright) {
      const lines = String(text).replace(/\r/g, "").split("\n");
      if (groups.length === 1) assignLine(groups[0].items, lines.join(" ").replace(/\s+/g, " ").trim());
      else groups.forEach((group, index) => assignLine(group.items, index < lines.length ? lines[index] : ""));
      return { created: [], touched: groups.flatMap((group) => group.items) };
    }
    const typed = Number(sizeInput.value);
    const span = groups.flatMap((group) => group.items);
    const fontSize = typed >= 6 && typed <= 72 ? typed : boxOf(span[0]).size;
    const left = Math.min(...span.map((item) => boxOf(item).left));
    const right = Math.max(...span.map((item) => boxOf(item).right));
    const wrapped = wrapPdfLines(text, fontSize, Math.max(40, right - left), chosenReplaceFont());
    const created = [];
    const kept = new Set(groups.flatMap((group) => group.items));
    const occupied = (y) => (page.textElements || []).some((item) => {
      if (kept.has(item) || created.includes(item)) return false;
      return Math.abs(boxOf(item).y - y) < Math.max(fontSize * 0.85, 3);
    });
    let pending = [];
    let blocked = false;
    wrapped.forEach((line, index) => {
      if (index < groups.length) {
        assignLine(groups[index].items, line);
        return;
      }
      const anchor = groups[groups.length - 1].items[0];
      const y = boxOf(anchor).y - fontSize * 1.2 * (created.length + 1);
      if (blocked || occupied(y)) {
        blocked = true;
        pending.push(line);
        return;
      }
      const element = spawnLine(anchor, line, left, y, fontSize);
      page.textElements = page.textElements || [];
      page.textElements.push(element);
      created.push(element);
    });
    groups.slice(wrapped.length).forEach((group) => assignLine(group.items, ""));
    if (pending.length) {
      const last = created.length ? created[created.length - 1] : groups[Math.min(wrapped.length, groups.length) - 1].items[0];
      last.text = [last.text, ...pending].filter(Boolean).join(" ");
      last.width = Math.max(fontSize, last.text.length * fontSize * 0.5);
    }
    return { created, touched: groups.flatMap((group) => group.items) };
  };

  const chosenReplaceFont = (currentFontId) => fontChoice(fontSel.value, boldBtn.classList.contains("on"), italicBtn.classList.contains("on"), currentFontId);

  const paintReplaceFont = () => {
    const chosen = chosenReplaceFont();
    field.style.fontFamily = chosen.css;
    field.style.fontWeight = chosen.weight;
    field.style.fontStyle = chosen.style;
    const size = Number(sizeInput.value);
    if (size >= 6 && size <= 72) field.style.fontSize = Math.round(size * (pdfViewer.currentScale || 1)) + "px";
    field.style.color = replaceColor.value || "#111827";
  };
  fontSel.onchange = paintReplaceFont;
  sizeInput.oninput = paintReplaceFont;
  bindToggle(boldBtn, paintReplaceFont);
  bindToggle(italicBtn, paintReplaceFont);
  replaceColor.oninput = () => {
    colorTouched = true;
    paintReplaceFont();
  };

  const fillColorOf = (hex) => {
    const raw = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
    const value = parseInt(raw, 16);
    return {
      colorSpace: "DeviceRGB",
      components: [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255],
    };
  };

  const styleRun = (item) => {
    const chosen = chosenReplaceFont(item.fontId);
    if (chosen.stirling) item.fontId = chosen.stirling;
    if (colorTouched) {
      const fill = fillColorOf(replaceColor.value);
      if (fill) item.fillColor = fill;
    }
    const size = Number(sizeInput.value);
    if (!(size >= 6 && size <= 72)) return;
    const matrix = Array.isArray(item.textMatrix) ? item.textMatrix.slice() : null;
    const current = matrix
      ? (Math.hypot(Number(matrix[0]) || 0, Number(matrix[1]) || 0) || Number(item.fontSize) || size)
      : (Number(item.fontSize) || size);
    const scale = current > 0 ? size / current : 1;
    item.fontSize = size;
    item.fontMatrixSize = size;
    item.fontSizeInPt = size;
    if (matrix && matrix.length >= 6 && Number.isFinite(scale) && scale > 0) {
      item.textMatrix = [matrix[0] * scale, matrix[1] * scale, matrix[2] * scale, matrix[3] * scale, matrix[4], matrix[5]];
    }
  };

  const replaceAnnotation = (page, annot, text) => {
    const rect = annot.rect;
    const contents = String(annot.contents || "");
    const lineCount = Math.max(1, contents.split(/\n/).filter((line) => line.trim()).length);
    const typed = Number(sizeInput.value);
    const size = typed >= 6 && typed <= 72 ? typed : Math.max(9, Math.min(16, (rect[3] - rect[1]) / lineCount * 0.72));
    const chosen = chosenReplaceFont();
    const fontId = chosen.stirling || (page.textElements || []).map((item) => item.fontId).find(Boolean) || "helv";
    const wrapped = wrapPdfLines(text, size, Math.max(40, rect[2] - rect[0] - 4), chosen);
    const fill = colorTouched ? fillColorOf(replaceColor.value) : null;
    page.annotations = (page.annotations || []).filter((item) => item !== annot);
    page.textElements = page.textElements || [];
    wrapped.forEach((line, index) => {
      const y = rect[3] - size * (index + 1) * 1.2;
      const element = {
        text: line,
        fontId,
        fontSize: size,
        fontMatrixSize: size,
        spaceWidth: size * 0.28,
        width: Math.max(size, line.length * size * 0.5),
        height: size * 0.7,
        zOrder: 2000000 + index,
        textMatrix: [size, 0, 0, size, rect[0] + 2, y],
      };
      if (fill) element.fillColor = fill;
      page.textElements.push(element);
    });
  };

  const applyReplace = async () => {
    if (!pendingReplace) return;
    const next = field.value;
    if (!next.trim()) {
      hideReplace();
      return;
    }
    if (!options.engine || !options.engineGet || !options.engineJson) {
      window.alert("Metin düzenleyici için yerel motor hazır olmalı.");
      return;
    }
    const { pageNumber, pdfRects } = pendingReplace;
    const norm = (value) => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
    const wanted = norm(pendingReplace.text);
    const onBaseline = (item, rect) => {
      const box = boxOf(item);
      const padX = Math.max(1.5, box.size * 0.2);
      const padY = Math.max(1.2, box.size * 0.2);
      const x = box.left + Math.min(box.size, Math.max(0, box.right - box.left) / 2);
      return x >= rect[0] - padX && x <= rect[2] + padX && box.y >= rect[1] - padY && box.y <= rect[3] + padY;
    };
    applyBtn.disabled = true;
    setJobProgress(8, "Belge hazırlanıyor…");
    try {
      const bytes = await doc.saveDocument();
      setJobProgress(18, "Metin düzenleyiciye gönderiliyor…");
      const form = new FormData();
      form.append("fileInput", new File([bytes], "belge.pdf", { type: "application/pdf" }));
      form.append("async", "true");
      form.append("lightweight", "true");
      const started = JSON.parse(new TextDecoder().decode(await options.engine("/api/v1/convert/pdf/text-editor", form)));
      if (!started.jobId) throw new Error("Metin düzenleyici işi başlamadı.");
      await waitForTextJob(started.jobId, (fraction) => setJobProgress(22 + Math.round(fraction * 48), "Sayfa okunuyor…"));
      setJobProgress(74, "Seçilen yazı bulunuyor…");
      const page = await options.engineGet(`/api/v1/convert/pdf/text-editor/page/${started.jobId}/${pageNumber}`);
      const elements = page.textElements || [];
      const readable = elements.filter((item) => String(item.text || "").trim());
      let picked = readable.filter((item) => (pdfRects || []).some((rect) => onBaseline(item, rect)));
      if (!picked.length && (pdfRects || []).length) {
        const targetY = pdfRects.reduce((sum, rect) => sum + (rect[1] + rect[3]) / 2, 0) / pdfRects.length;
        const overlapping = readable.filter((item) => pdfRects.some((rect) => overlapsPdf(boxOf(item), rect)));
        const pool = overlapping.length ? overlapping : readable;
        const closest = pool.reduce((best, item) => (Math.abs(boxOf(item).y - targetY) < Math.abs(boxOf(best).y - targetY) ? item : best));
        const band = Math.max(2.5, boxOf(closest).size * 0.35);
        picked = pool.filter((item) => Math.abs(boxOf(item).y - boxOf(closest).y) <= band && pdfRects.some((rect) => {
          const box = boxOf(item);
          return box.right > rect[0] - 4 && box.left < rect[2] + 4;
        }));
      }
      if (!picked.length && wanted) {
        const exact = readable.filter((item) => norm(item.text) === wanted);
        if (exact.length === 1) picked = exact;
      }
      const annot = (page.annotations || []).find((item) => Array.isArray(item.rect) && item.rect.length >= 4 && (pdfRects || []).some((rect) => overlapsPdf({
        left: item.rect[0], right: item.rect[2], bottom: item.rect[1], top: item.rect[3],
      }, rect)));
      if (picked.length) {
        const targets = (pdfRects || []).map((rect) => (rect[1] + rect[3]) / 2);
        const written = writeLines(page, picked, next, (pendingReplace.boxes || []).length, targets);
        written.touched.forEach(styleRun);
        written.created.forEach(styleRun);
      } else if (annot) replaceAnnotation(page, annot, next);
      else throw new Error("Seçilen yazı bu sayfada düzenlenebilir metin değil. Taranmış bir sayfaysa önce OCR uygulayın.");
      if (page.pageNumber == null) page.pageNumber = pageNumber;
      setJobProgress(86, "Yazı belgeye işleniyor…");
      const rebuilt = await options.engineJson(`/api/v1/convert/pdf/text-editor/partial/${started.jobId}`, { pages: [page] });
      setJobProgress(94, "Sayfa yenileniyor…");
      const shown = await showEditedDocument(rebuilt, pageNumber, pdfViewer.currentScaleValue);
      if (!shown) return;
      markDirty(true);
      hideReplace();
      setJobProgress(100, "Metin yazıldı");
      statusMode.textContent = "Metin belgenin yazısına işlendi. Kaydet ile dosyaya yazın.";
    } catch (err) {
      hideReplace();
      const message = options.errorText ? options.errorText(err) : String((err && err.message) || err || "Metin yazılamadı.");
      window.alert(message);
    } finally {
      applyBtn.disabled = false;
      setTimeout(hideJobProgress, 700);
    }
  };

  const openReplace = () => {
    const found = captureSelection() || pendingReplace;
    if (!found || !found.boxes) {
      statusMode.textContent = "Önce Seç kipinde değiştirilecek satırı veya hücreyi işaretleyin.";
      return;
    }
    showReplace(found);
  };

  stage.addEventListener("mouseup", () => {
    const found = captureSelection();
    if (found) pendingReplace = found;
  });
  replace.onclick = () => openReplace();
  applyBtn.onclick = () => applyReplace();
  cancelBtn.onclick = hideReplace;
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); applyReplace(); }
    if (event.key === "Escape") { event.preventDefault(); hideReplace(); }
  });

  const addField = el("textarea", "replace-field");
  addField.hidden = true;
  addField.rows = 2;
  addField.placeholder = "Metin";
  addField.setAttribute("aria-label", "Eklenecek metin");
  addField.setAttribute("spellcheck", "false");
  const addActions = el("div", "replace-actions");
  addActions.hidden = true;
  const addApply = button("Uygula", "Metni seçilen yazı tipiyle sayfaya yaz", "primary");
  const addCancel = button("Vazgeç");
  addActions.append(addApply, addCancel);
  root.append(addField, addActions);
  let addDraft = null;

  const chosenAddFont = () => fontChoice(textFont.value, textBold.classList.contains("on"), textItalic.classList.contains("on"));
  const chosenAddSize = () => {
    const size = Number(textSize.value);
    return size >= 6 && size <= 72 ? size : 14;
  };
  const paintAddFont = () => {
    const chosen = chosenAddFont();
    const size = chosenAddSize();
    addField.style.fontFamily = chosen.css;
    addField.style.fontWeight = chosen.weight;
    addField.style.fontStyle = chosen.style;
    addField.style.fontSize = Math.round(size * (pdfViewer.currentScale || 1)) + "px";
    addField.style.color = textColor.value || "#111827";
    addField.style.lineHeight = "1.25";
  };
  textFont.onchange = paintAddFont;
  textSize.oninput = paintAddFont;
  textColor.oninput = paintAddFont;
  bindToggle(textBold, paintAddFont);
  bindToggle(textItalic, paintAddFont);

  hideAdd = () => {
    addField.hidden = true;
    addActions.hidden = true;
    addField.value = "";
    root.append(addField, addActions);
    addDraft = null;
  };

  const openAddText = (pageEl, clientX, clientY) => {
    hideReplace();
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!pageNumber || !view || !view.getPagePoint) return;
    const originEl = pageEl.querySelector(".canvasWrapper") || pageEl.querySelector("canvas") || pageEl;
    const origin = originEl.getBoundingClientRect();
    const point = view.getPagePoint(clientX - origin.left, clientY - origin.top);
    const size = chosenAddSize();
    addDraft = { pageNumber, x: point[0], y: point[1] - size * 0.8 };
    const pageBox = pageEl.getBoundingClientRect();
    const height = Math.max(36, size * (pdfViewer.currentScale || 1) * 1.8);
    addField.style.left = (clientX - pageBox.left) + "px";
    addField.style.top = (clientY - pageBox.top) + "px";
    addField.style.width = "240px";
    addField.style.height = height + "px";
    paintAddFont();
    addField.hidden = false;
    pageEl.appendChild(addField);
    addActions.style.left = addField.style.left;
    addActions.style.top = (clientY - pageBox.top + height + 6) + "px";
    addActions.hidden = false;
    pageEl.appendChild(addActions);
    addField.focus();
  };

  const applyAdd = async () => {
    if (!addDraft) return;
    const next = addField.value.replace(/\s+$/g, "");
    if (!next.trim()) {
      hideAdd();
      return;
    }
    if (!options.engine || !options.engineGet || !options.engineJson) {
      window.alert("Metin eklemek için yerel motor hazır olmalı.");
      return;
    }
    const { pageNumber, x, y } = addDraft;
    const chosen = chosenAddFont();
    const size = chosenAddSize();
    addApply.disabled = true;
    setJobProgress(8, "Belge hazırlanıyor…");
    try {
      const bytes = await doc.saveDocument();
      setJobProgress(18, "Metin düzenleyiciye gönderiliyor…");
      const form = new FormData();
      form.append("fileInput", new File([bytes], "belge.pdf", { type: "application/pdf" }));
      form.append("async", "true");
      form.append("lightweight", "true");
      const started = JSON.parse(new TextDecoder().decode(await options.engine("/api/v1/convert/pdf/text-editor", form)));
      if (!started.jobId) throw new Error("Metin düzenleyici işi başlamadı.");
      await waitForTextJob(started.jobId, (fraction) => setJobProgress(22 + Math.round(fraction * 48), "Sayfa okunuyor…"));
      setJobProgress(74, "Metin ekleniyor…");
      const page = await options.engineGet(`/api/v1/convert/pdf/text-editor/page/${started.jobId}/${pageNumber}`);
      page.textElements = page.textElements || [];
      const lines = next.replace(/\r/g, "").split("\n");
      const fill = fillColorOf(textColor.value);
      const width = Math.max(40, 240 / (pdfViewer.currentScale || 1));
      const wrapped = wrapPdfLines(next, size, width, chosen);
      wrapped.forEach((line, index) => {
        const element = {
          text: line,
          fontId: chosen.stirling,
          fontSize: size,
          fontMatrixSize: size,
          fontSizeInPt: size,
          spaceWidth: size * 0.28,
          width: Math.max(size, line.length * size * 0.52),
          height: size * 0.7,
          zOrder: 2100000 + index,
          textMatrix: [size, 0, 0, size, x, y - index * size * 1.25],
        };
        if (fill) element.fillColor = fill;
        page.textElements.push(element);
      });
      if (page.pageNumber == null) page.pageNumber = pageNumber;
      setJobProgress(86, "Yazı belgeye işleniyor…");
      const rebuilt = await options.engineJson(`/api/v1/convert/pdf/text-editor/partial/${started.jobId}`, { pages: [page] });
      setJobProgress(94, "Sayfa yenileniyor…");
      const shown = await showEditedDocument(rebuilt, pageNumber, pdfViewer.currentScaleValue);
      if (!shown) return;
      markDirty(true);
      hideAdd();
      setJobProgress(100, "Metin eklendi");
      statusMode.textContent = "Metin seçilen yazı tipiyle sayfaya yazıldı. Kaydet ile dosyaya yazın.";
    } catch (err) {
      const message = options.errorText ? options.errorText(err) : String((err && err.message) || err || "Metin eklenemedi.");
      window.alert(message);
    } finally {
      addApply.disabled = false;
      setTimeout(hideJobProgress, 700);
    }
  };

  stage.addEventListener("mousedown", (event) => {
    if (activeMark.mode !== pdfjs.AnnotationEditorType.FREETEXT || event.button !== 0) return;
    if (event.target.closest && event.target.closest("textarea, .replace-actions, .form-actions, .form-draft")) return;
    const pageEl = event.target.closest && event.target.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return;
    event.preventDefault();
    openAddText(pageEl, event.clientX, event.clientY);
  });
  addApply.onclick = () => applyAdd();
  addCancel.onclick = () => hideAdd();
  addField.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); applyAdd(); }
    if (event.key === "Escape") { event.preventDefault(); hideAdd(); }
  });

  const draftBox = el("div", "form-draft");
  draftBox.hidden = true;
  const formPanel = el("div", "form-actions");
  formPanel.hidden = true;
  const kindSel = el("select", "replace-font");
  [["text", "Metin"], ["checkbox", "Onay kutusu"], ["dropdown", "Liste"]].forEach(([value, label]) => {
    const option = el("option", null, t(label));
    option.value = value;
    kindSel.appendChild(option);
  });
  kindSel.title = "Alan türü";
  const nameInput = el("input", "form-name");
  nameInput.type = "text";
  nameInput.placeholder = "Alan adı";
  nameInput.title = "Form alanı adı";
  nameInput.setAttribute("aria-label", "Alan adı");
  const extraInput = el("input", "form-extra");
  extraInput.type = "text";
  extraInput.placeholder = "Varsayılan metin";
  extraInput.title = "Varsayılan değer veya liste seçenekleri";
  extraInput.setAttribute("aria-label", "Varsayılan değer");
  const addFieldBtn = button("Ekle", "Alanı PDF'e yaz", "primary");
  const skipFieldBtn = button("Vazgeç");
  formPanel.append(kindSel, nameInput, extraInput, addFieldBtn, skipFieldBtn);
  root.append(draftBox, formPanel);
  let formDrag = null;
  let formRect = null;
  let formCount = 0;
  hideFormDraft = () => {
    formDrag = null;
    formRect = null;
    draftBox.hidden = true;
    formPanel.hidden = true;
    root.append(draftBox, formPanel);
  };
  const placeDraft = (pageEl, a, b) => {
    const pageBox = pageEl.getBoundingClientRect();
    const left = Math.min(a.x, b.x) - pageBox.left;
    const top = Math.min(a.y, b.y) - pageBox.top;
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    draftBox.style.left = left + "px";
    draftBox.style.top = top + "px";
    draftBox.style.width = width + "px";
    draftBox.style.height = height + "px";
    draftBox.hidden = false;
    pageEl.appendChild(draftBox);
  };
  kindSel.onchange = () => {
    extraInput.placeholder = kindSel.value === "dropdown" ? "Seçenek1; Seçenek2" : kindSel.value === "checkbox" ? "işaretli ise evet" : "Varsayılan metin";
  };
  stage.addEventListener("mousedown", (event) => {
    if (!formMode || event.button !== 0) return;
    if (event.target.closest && event.target.closest(".form-actions")) return;
    const pageEl = event.target.closest && event.target.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return;
    event.preventDefault();
    hideFormDraft();
    formDrag = { pageEl, x: event.clientX, y: event.clientY };
    placeDraft(pageEl, formDrag, { x: event.clientX, y: event.clientY });
  });
  const onFormMove = (event) => {
    if (!formDrag) return;
    placeDraft(formDrag.pageEl, formDrag, { x: event.clientX, y: event.clientY });
  };
  const onFormUp = (event) => {
    if (!formDrag) return;
    const start = formDrag;
    formDrag = null;
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    if (width < 12 || height < 12) {
      hideFormDraft();
      return;
    }
    placeDraft(start.pageEl, start, { x: event.clientX, y: event.clientY });
    const originEl = start.pageEl.querySelector(".canvasWrapper") || start.pageEl.querySelector("canvas") || start.pageEl;
    const origin = originEl.getBoundingClientRect();
    const pageNumber = Number(start.pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!view || !view.getPagePoint) { hideFormDraft(); return; }
    const a = view.getPagePoint(Math.min(start.x, event.clientX) - origin.left, Math.min(start.y, event.clientY) - origin.top);
    const b = view.getPagePoint(Math.max(start.x, event.clientX) - origin.left, Math.max(start.y, event.clientY) - origin.top);
    formRect = {
      page: pageNumber,
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      width: Math.abs(a[0] - b[0]),
      height: Math.abs(a[1] - b[1]),
      pageEl: start.pageEl,
    };
    formCount += 1;
    nameInput.value = "alan" + formCount;
    extraInput.value = "";
    formPanel.style.left = (Math.min(start.x, event.clientX) - start.pageEl.getBoundingClientRect().left) + "px";
    formPanel.style.top = (Math.max(start.y, event.clientY) - start.pageEl.getBoundingClientRect().top + 8) + "px";
    formPanel.hidden = false;
    start.pageEl.appendChild(formPanel);
    nameInput.focus();
    nameInput.select();
  };
  document.addEventListener("mousemove", onFormMove, true);
  document.addEventListener("mouseup", onFormUp, true);
  current.cleanup = () => {
    document.removeEventListener("mousemove", onFormMove, true);
    document.removeEventListener("mouseup", onFormUp, true);
  };
  skipFieldBtn.onclick = () => hideFormDraft();
  addFieldBtn.onclick = async () => {
    if (!formRect || !options.addFormFields) return;
    const kind = kindSel.value;
    const fieldName = nameInput.value.trim() || ("alan" + formCount);
    const extra = extraInput.value.trim();
    const spec = {
      page: formRect.page,
      kind,
      name: fieldName,
      x: formRect.x,
      y: formRect.y,
      width: formRect.width,
      height: formRect.height,
      value: kind === "checkbox" ? extra : extra,
      options: kind === "dropdown" ? extra.split(";").map((item) => item.trim()).filter(Boolean) : [],
      multiline: kind === "text" && formRect.height > 28,
    };
    addFieldBtn.disabled = true;
    const work = window.SecuriWork;
    if (work) work.begin("Form alanı ekleniyor…");
    try {
      const bytes = await doc.saveDocument();
      const next = await options.addFormFields(bytes, [spec]);
      restoreView = { page: pdfViewer.currentPageNumber, scale: pdfViewer.currentScaleValue };
      const nextTask = pdfjs.getDocument({ ...LOAD_OPTIONS, data: next, password: options.password || undefined });
      const nextDoc = await nextTask.promise;
      if (viewer !== current) { nextTask.destroy(); return; }
      current.task.destroy();
      current.task = nextTask;
      doc = nextDoc;
      doc.annotationStorage.onSetModified = () => markDirty(true);
      doc.annotationStorage.onResetModified = () => markDirty(false);
      pdfViewer.setDocument(doc);
      linkService.setDocument(doc, null);
      pageTotal.textContent = `/ ${doc.numPages}`;
      pageInput.max = String(doc.numPages);
      fillThumbs(doc);
      markDirty(true);
      hideFormDraft();
      statusMode.textContent = `"${fieldName}" alanı eklendi. Kaydet ile PDF'e yazın.`;
    } catch (err) {
      window.alert(String(err && err.message || err || "Form alanı eklenemedi."));
    } finally {
      if (work) work.end();
      addFieldBtn.disabled = false;
    }
  };
  if (formBtn) {
    formBtn.onclick = () => {
      hideReplace();
      setFormMode(!formMode);
    };
  }
  if (options.formDesign && formBtn) setFormMode(true);

  save.onclick = async () => {
    if (!options.onSave) return;
    save.disabled = true;
    const work = window.SecuriWork;
    if (work) work.begin("Kaydediliyor…");
    try {
      const bytes = await doc.saveDocument();
      const saved = await options.onSave(bytes);
      markDirty(!saved);
    } catch {
      markDirty(true);
      window.alert("İşaretlemeler kaydedilemedi.");
    } finally {
      if (work) work.end();
      save.disabled = false;
    }
  };
  if (toWord) {
    toWord.onclick = () => {
      if (!closeViewer(false)) return;
      options.onToWord();
    };
  }
  close.onclick = () => closeViewer(false);
}

// ---- Thumbnail grid ----

/**
 * Shows `source` (File or bytes) inside `host`.
 * options.pick: { mode: "remove" | "pick" | "split", selected: Set<number>, onToggle(page) }
 * options.crop: { box: { x, y, width, height }, onChange(box) } — PDF points, bottom-left origin
 * options.password: used to open encrypted PDFs.
 * Returns { kind, pageCount, setSelected(set), setCrop(box), destroy() }.
 */
async function show(host, source, options = {}) {
  host.replaceChildren(el("p", "preview-note", "Önizleme hazırlanıyor…"));
  const name = options.name || (source && source.name) || "";
  let bytes;
  try {
    bytes = await toBytes(source);
  } catch {
    host.replaceChildren(el("p", "preview-note", "Dosya okunamadı."));
    return { kind: "other", pageCount: 0, setSelected() {}, destroy() {} };
  }
  const kind = kindOf(bytes, name);

  if (kind === "image") {
    const url = URL.createObjectURL(new Blob([bytes]));
    const img = el("img", "preview-image");
    img.src = url;
    img.alt = name;
    host.replaceChildren(img);
    return { kind, pageCount: 1, setSelected() {}, destroy() { URL.revokeObjectURL(url); } };
  }

  if (kind === "zip") {
    const entries = zipEntries(bytes);
    const list = el("ul", "zip-list");
    entries.forEach((entry) => {
      const item = el("li");
      item.append(el("span", "name", entry.name), el("span", "size", formatSize(entry.size)));
      list.appendChild(item);
    });
    host.replaceChildren(el("p", "preview-note", `ZIP içinde ${entries.length} dosya var.`), list);
    return { kind, pageCount: entries.length, setSelected() {}, destroy() {} };
  }

  if (kind !== "pdf") {
    host.replaceChildren(el("p", "preview-note", "Bu dosya türü için önizleme yok."));
    return { kind, pageCount: 0, setSelected() {}, destroy() {} };
  }

  // The viewer loads its own copy so markup there never touches the thumbnails.
  const original = bytes.slice();
  const open = (number) => openViewer(original, number, name, { password: options.password, onSave: options.onSave });
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: bytes, password: options.password || undefined });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const locked = err && err.name === "PasswordException";
    host.replaceChildren(el("p", "preview-note", locked
      ? "Belge parolalı. Önizleme için parola alanını doldurun."
      : "PDF açılamadı; dosya bozuk olabilir."));
    return { kind, pageCount: 0, locked, setSelected() {}, destroy() { task.destroy(); } };
  }

  const pick = options.pick;
  const crop = options.crop;
  if (crop) {
    const handle = await showCrop(host, doc, crop, () => open(1));
    return {
      kind,
      pageCount: doc.numPages,
      setSelected() {},
      setCrop: handle.setCrop,
      destroy() {
        handle.destroy();
        closeViewer();
        task.destroy();
      },
    };
  }
  const grid = el("div", "thumbs" + (pick ? " pickable mode-" + pick.mode : ""));
  const header = el("p", "preview-note", pick
    ? `${doc.numPages} sayfa. Sayfaya tıklayarak seçin; açmak için çift tıklayın.`
    : `${doc.numPages} sayfa. Açmak, aramak veya işaretlemek için sayfaya tıklayın.`);
  host.replaceChildren(header, grid);

  const cells = [];
  const observer = new IntersectionObserver((items) => {
    items.forEach((item) => {
      if (!item.isIntersecting) return;
      observer.unobserve(item.target);
      const number = Number(item.target.dataset.page);
      doc.getPage(number)
        .then((page) => renderPage(page, item.target.querySelector("canvas"), THUMB_WIDTH))
        .catch(() => {});
    });
  }, { root: host.closest(".preview-scroll") || null, rootMargin: "300px" });

  for (let number = 1; number <= doc.numPages; number++) {
    const cell = el("button", "thumb");
    cell.type = "button";
    cell.dataset.page = String(number);
    cell.title = pick ? "Seçmek için tıklayın, büyütmek için çift tıklayın" : "Büyüt";
    const canvas = el("canvas");
    canvas.style.width = THUMB_WIDTH + "px";
    canvas.style.height = Math.round(THUMB_WIDTH * 1.41) + "px";
    cell.append(canvas, el("span", "thumb-label", String(number)));
    if (pick) {
      cell.addEventListener("click", () => pick.onToggle(number));
      cell.addEventListener("dblclick", () => open(number));
    } else {
      cell.addEventListener("click", () => open(number));
    }
    grid.appendChild(cell);
    cells.push(cell);
    observer.observe(cell);
  }

  const setSelected = (selected) => {
    cells.forEach((cell, index) => cell.classList.toggle("selected", selected.has(index + 1)));
  };
  if (pick) setSelected(pick.selected);

  return {
    kind,
    pageCount: doc.numPages,
    setSelected,
    destroy() {
      observer.disconnect();
      closeViewer();
      task.destroy();
    },
  };
}

/** PDF crop box uses a bottom-left origin, in points. */
function showCrop(host, doc, crop, open) {
  return doc.getPage(1).then(async (page) => {
    const base = page.getViewport({ scale: 1 });
    const note = el("p", "preview-note", "Kalacak alanı sürükleyerek çizin veya köşelerden tutup ayarlayın. Tüm sayfalara uygulanır.");
    const stage = el("div", "crop-stage");
    const canvas = el("canvas");
    const boxEl = el("div", "crop-box");
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((name) => {
      const handle = el("span", "crop-handle " + name);
      handle.dataset.handle = name;
      boxEl.appendChild(handle);
    });
    stage.append(canvas, boxEl);
    host.replaceChildren(note, stage);
    const cssWidth = Math.min(400, Math.max(220, (host.clientWidth || 360) - 8));
    await renderPage(page, canvas, cssWidth);
    const cssHeight = canvas.offsetHeight || Math.round(cssWidth * base.height / base.width);
    stage.style.width = cssWidth + "px";
    stage.style.height = cssHeight + "px";

    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const toCss = (box) => ({
      left: box.x / base.width * cssWidth,
      top: (base.height - box.y - box.height) / base.height * cssHeight,
      width: box.width / base.width * cssWidth,
      height: box.height / base.height * cssHeight,
    });
    const toPdf = (rect) => ({
      x: rect.left / cssWidth * base.width,
      y: (cssHeight - rect.top - rect.height) / cssHeight * base.height,
      width: rect.width / cssWidth * base.width,
      height: rect.height / cssHeight * base.height,
    });
    const round = (box) => ({
      x: Math.round(box.x * 10) / 10,
      y: Math.round(box.y * 10) / 10,
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
    });
    const fullDefault = crop.box && crop.box.width === 595 && crop.box.height === 842 && crop.box.x === 0 && crop.box.y === 0;
    let box = (!crop.box || crop.box.width < 1 || crop.box.height < 1 || fullDefault)
      ? { x: base.width * 0.08, y: base.height * 0.08, width: base.width * 0.84, height: base.height * 0.84 }
      : crop.box;
    box = round({
      x: clamp(box.x, 0, base.width - 2),
      y: clamp(box.y, 0, base.height - 2),
      width: clamp(box.width, 2, base.width),
      height: clamp(box.height, 2, base.height),
    });

    const paint = () => {
      const css = toCss(box);
      boxEl.style.left = css.left + "px";
      boxEl.style.top = css.top + "px";
      boxEl.style.width = css.width + "px";
      boxEl.style.height = css.height + "px";
    };
    const emit = () => { if (crop.onChange) crop.onChange(round(box)); };
    paint();
    if (fullDefault || !crop.box) emit();

    let drag = null;
    const point = (event) => {
      const bounds = stage.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const at = point(event);
      const handle = event.target.dataset && event.target.dataset.handle;
      const css = toCss(box);
      drag = handle
        ? { kind: "resize", handle, start: at, rect: { ...css } }
        : event.target === boxEl
          ? { kind: "move", start: at, rect: { ...css } }
          : { kind: "draw", start: at, rect: { left: at.x, top: at.y, width: 0, height: 0 }, previous: { ...box } };
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const at = point(event);
      let rect = { ...drag.rect };
      if (drag.kind === "draw") {
        rect = {
          left: Math.min(drag.start.x, at.x),
          top: Math.min(drag.start.y, at.y),
          width: Math.abs(at.x - drag.start.x),
          height: Math.abs(at.y - drag.start.y),
        };
      } else if (drag.kind === "move") {
        rect.left = clamp(drag.rect.left + at.x - drag.start.x, 0, cssWidth - drag.rect.width);
        rect.top = clamp(drag.rect.top + at.y - drag.start.y, 0, cssHeight - drag.rect.height);
      } else {
        const dx = at.x - drag.start.x;
        const dy = at.y - drag.start.y;
        const h = drag.handle;
        if (h.includes("w")) { rect.left = drag.rect.left + dx; rect.width = drag.rect.width - dx; }
        if (h.includes("e")) rect.width = drag.rect.width + dx;
        if (h.includes("n")) { rect.top = drag.rect.top + dy; rect.height = drag.rect.height - dy; }
        if (h.includes("s")) rect.height = drag.rect.height + dy;
        if (rect.width < 8) { rect.left = drag.rect.left; rect.width = 8; }
        if (rect.height < 8) { rect.top = drag.rect.top; rect.height = 8; }
      }
      rect.left = clamp(rect.left, 0, cssWidth - 8);
      rect.top = clamp(rect.top, 0, cssHeight - 8);
      rect.width = clamp(rect.width, 8, cssWidth - rect.left);
      rect.height = clamp(rect.height, 8, cssHeight - rect.top);
      box = toPdf(rect);
      paint();
    });
    const end = () => {
      if (!drag) return;
      const cssBox = toCss(box);
      if (drag.kind === "draw" && drag.previous && (cssBox.width < 12 || cssBox.height < 12)) {
        box = drag.previous;
      }
      drag = null;
      box = round(box);
      paint();
      emit();
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    boxEl.addEventListener("dblclick", (event) => { event.stopPropagation(); open(); });

    return {
      setCrop(next) {
        if (!next || drag) return;
        box = round(next);
        paint();
      },
      destroy() {},
    };
  });
}

async function countPages(data, password) {
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: await toBytes(data), password: password || undefined });
  try {
    return (await task.promise).numPages;
  } catch {
    return 0;
  } finally {
    task.destroy();
  }
}

/** [{ number, width, height }] in PDF points. */
async function pageInfo(data, password) {
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: await toBytes(data), password: password || undefined });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ number, width: viewport.width, height: viewport.height });
      page.cleanup();
    }
    return pages;
  } catch {
    return [];
  } finally {
    task.destroy();
  }
}

/** Text lines of every page: [{ text, size, pageBreakBefore }]. */
async function textLines(data, password) {
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: await toBytes(data), password: password || undefined });
  try {
    const doc = await task.promise;
    const lines = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let line = null;
      let lastY = null;
      let lastEnd = null;
      const flush = () => {
        if (line) lines.push({ ...line, text: line.text.replace(/\s+$/, "") });
        line = null;
      };
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
        const x = item.transform[4];
        const y = item.transform[5];
        if (line && lastY !== null && Math.abs(y - lastY) > size * 0.5) flush();
        if (!line) {
          line = { text: "", size, pageBreakBefore: number > 1 && !lines.some((l) => l.page === number), page: number };
          lastEnd = null;
        }
        if (lastEnd !== null && item.str && !/\s$/.test(line.text) && x - lastEnd > size * 0.15) line.text += " ";
        line.text += item.str;
        line.size = Math.max(line.size, size);
        lastY = y;
        lastEnd = x + (item.width || 0);
        if (item.hasEOL) flush();
      }
      flush();
      const annotations = await page.getAnnotations({ intent: "display" });
      for (const annot of annotations) {
        for (const { text } of annotationLines(annot)) {
          const trimmed = text.replace(/\s+$/, "");
          if (!trimmed) continue;
          lines.push({
            text: trimmed,
            size: 12,
            pageBreakBefore: number > 1 && !lines.some((row) => row.page === number),
            page: number,
          });
        }
      }
      page.cleanup();
    }
    return lines;
  } finally {
    task.destroy();
  }
}

let measureContext = null;

/** Width of `text` relative to `whole`, so a match inside a text run gets its own box. */
function textRatio(text, whole, family) {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  measureContext.font = `100px ${family}`;
  const full = measureContext.measureText(whole).width;
  return full ? measureContext.measureText(text).width / full : text.length / Math.max(whole.length, 1);
}

/** CSS font list that measures like the PDF font: the installed font of the same name, if any. */
function measureFamily(page, item, styles) {
  const generic = (styles[item.fontName] && styles[item.fontName].fontFamily) || "sans-serif";
  const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
  const name = font && typeof font.name === "string" ? font.name.replace(/^[A-Z]{6}\+/, "").split(/[,-]/)[0] : "";
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return generic;
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/MT$|PS$/, "").trim();
  return `"${spaced}", "${name}", ${generic}`;
}

function boxesOverlap(a, b, pad) {
  return a.x < b.x + b.width + pad && a.x + a.width + pad > b.x
    && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
}

/** Join touching boxes on a page so a split word does not leave a visible gap. */
function mergeBoxes(boxes) {
  const out = [];
  boxes.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x).forEach((box) => {
    const prev = out.find((other) => other.page === box.page && boxesOverlap(other, box, 3));
    if (!prev) {
      out.push({ ...box });
      return;
    }
    const x = Math.min(prev.x, box.x);
    const y = Math.min(prev.y, box.y);
    prev.width = Math.max(prev.x + prev.width, box.x + box.width) - x;
    prev.height = Math.max(prev.y + prev.height, box.y + box.height) - y;
    prev.x = x;
    prev.y = y;
    if (box.annotation) prev.annotation = true;
  });
  return out;
}

/** FreeText comments and filled widgets store text outside getTextContent(). */
function annotationPlainText(annot) {
  if (!annot || annot.subtype === "Popup") return "";
  const widget = annot.subtype === "Widget" || annot.fieldType;
  if (widget) {
    const value = annot.fieldValue;
    if (Array.isArray(value)) return value.filter((part) => typeof part === "string").join("\n");
    if (typeof value === "string" && value) return value;
  }
  if (annot.subtype !== "FreeText" && !widget) return "";
  if (annot.contentsObj && typeof annot.contentsObj.str === "string" && annot.contentsObj.str) {
    return annot.contentsObj.str;
  }
  return typeof annot.contents === "string" ? annot.contents : "";
}

function annotationFontSize(annot) {
  const data = annot && annot.defaultAppearanceData;
  if (data && Number(data.fontSize) > 0) return Number(data.fontSize);
  const appearance = String((annot && (annot.defaultAppearance || annot.da)) || "");
  const tf = /(?:^|[\s/])(\d+(?:\.\d+)?)\s+Tf/.exec(appearance);
  if (tf) return Number(tf[1]);
  const html = String((annot && (annot.richText || annot.rc)) || "");
  const css = /font(?:-size)?\s*:\s*(\d+(?:\.\d+)?)\s*px/i.exec(html);
  return css ? Number(css[1]) : 0;
}

function annotationLines(annot) {
  const text = annotationPlainText(annot);
  const rect = annot && annot.rect;
  if (!text || !Array.isArray(rect) || rect.length < 4) return [];
  const rows = text.split(/\r\n|\n|\r/);
  const x1 = Math.min(rect[0], rect[2]);
  const x2 = Math.max(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const y2 = Math.max(rect[1], rect[3]);
  // Preview/macOS FreeText /Rect is often taller than the text. Stretching
  // rows to fill it shifts later lines (the TCKN box lands on the phone).
  const size = annotationFontSize(annot) || 12;
  const lineHeight = Math.min(size * 1.2, (y2 - y1) / Math.max(rows.length, 1));
  return rows.map((line, index) => ({
    text: line,
    rect: [x1, y2 - (index + 1) * lineHeight, x2, y2 - index * lineHeight],
  }));
}

function viewportBox(viewport, rect, page, annotation) {
  const [x1, y1, x2, y2] = rect;
  const corners = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  return {
    page,
    x: left,
    y: top,
    width: Math.min(viewport.width, Math.max(...xs)) - left,
    height: Math.min(viewport.height, Math.max(...ys)) - top,
    annotation,
  };
}

function boxesForAnnotation(annot, patterns, page, viewport) {
  const rows = annotationLines(annot);
  const joined = rows.map((row) => row.text).join("\n");
  if (!joined) return [];
  const boxes = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(joined))) {
      if (!match[0]) { pattern.lastIndex++; continue; }
      const start = match.index;
      const end = start + match[0].length;
      let offset = 0;
      for (const row of rows) {
        const lineEnd = offset + row.text.length;
        if (end > offset && start < lineEnd) {
          const from = Math.max(0, start - offset);
          const to = Math.min(row.text.length, end - offset);
          const [x1, y1, x2, y2] = row.rect;
          const width = x2 - x1;
          const length = Math.max(row.text.length, 1);
          const pad = Math.max(2, width * 0.04);
          const padY = Math.max(1.5, (y2 - y1) * 0.15);
          const left = x1 + (width * from) / length - (from === 0 ? pad : width * 0.12);
          const right = x1 + (width * to) / length + (to >= row.text.length ? pad : width * 0.12);
          const box = viewportBox(viewport, [left, y1 - padY, right, y2 + padY], page, true);
          if (box.width > 0 && box.height > 0) boxes.push(box);
        }
        offset = lineEnd + 1;
      }
    }
  }
  return boxes;
}

/**
 * Boxes around every match of `patterns` (global RegExps), in points from the
 * top-left corner of the page as displayed: [{ page, x, y, width, height }].
 */
async function textBoxes(data, patterns, password) {
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: await toBytes(data), password: password || undefined });
  try {
    const doc = await task.promise;
    const boxes = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      await page.getOperatorList();
      // One string per line; `owners[i]` is the text run and offset of character i.
      const lines = [];
      let line = null;
      let lastY = null;
      let lastEnd = null;
      for (const item of content.items) {
        if (typeof item.str !== "string" || !item.str) continue;
        const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
        const x = item.transform[4];
        const y = item.transform[5];
        if (!line || (lastY !== null && Math.abs(y - lastY) > size * 0.5)) {
          line = { text: "", owners: [] };
          lines.push(line);
          lastEnd = null;
        }
        if (lastEnd !== null && !/\s$/.test(line.text) && x - lastEnd > size * 0.15) {
          line.text += " ";
          line.owners.push(null);
        }
        for (let i = 0; i < item.str.length; i++) line.owners.push({ item, index: i });
        line.text += item.str;
        lastY = y;
        lastEnd = x + (item.width || 0);
        if (item.hasEOL) line = null;
      }
      for (const { text, owners } of lines) {
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text))) {
            if (!match[0]) { pattern.lastIndex++; continue; }
            const runs = new Map();
            for (let i = match.index; i < match.index + match[0].length; i++) {
              const owner = owners[i];
              if (!owner) continue;
              const run = runs.get(owner.item) || { from: owner.index, to: owner.index };
              run.to = owner.index;
              runs.set(owner.item, run);
            }
            for (const [item, run] of runs) {
              const family = measureFamily(page, item, content.styles);
              const [a, b, c, d, e, f] = item.transform;
              const along = Math.hypot(a, b) || 1;
              const up = Math.hypot(c, d) || item.height || 12;
              const width = item.width || 0;
              const whole = run.from === 0 && run.to === item.str.length - 1;
              const start = whole ? 0 : width * textRatio(item.str.slice(0, run.from), item.str, family);
              const end = whole ? width : width * textRatio(item.str.slice(0, run.to + 1), item.str, family);
              // Canvas widths are estimates; extra cover hides the unredacted edge
              // that otherwise survives convert-to-image and later OCR.
              const padStart = up * (whole || run.from === 0 ? 0.2 : 0.5);
              const padEnd = up * (whole || run.to === item.str.length - 1 ? 0.2 : 0.5);
              const corners = [[start - padStart, -0.4 * up], [end + padEnd, -0.4 * up], [start - padStart, 1.2 * up], [end + padEnd, 1.2 * up]]
                .map(([dx, dy]) => viewport.convertToViewportPoint(e + (a / along) * dx + (c / up) * dy, f + (b / along) * dx + (d / up) * dy));
              const xs = corners.map((point) => point[0]);
              const ys = corners.map((point) => point[1]);
              const left = Math.max(0, Math.min(...xs));
              const top = Math.max(0, Math.min(...ys));
              boxes.push({
                page: number,
                x: left,
                y: top,
                width: Math.min(viewport.width, Math.max(...xs)) - left,
                height: Math.min(viewport.height, Math.max(...ys)) - top,
              });
            }
          }
        }
      }
      const annotations = await page.getAnnotations({ intent: "display" });
      for (const annot of annotations) boxes.push(...boxesForAnnotation(annot, patterns, number, viewport));
      page.cleanup();
    }
    return mergeBoxes(boxes);
  } finally {
    task.destroy();
  }
}

async function exportTables(data, pageSpec, kind, password) {
  if (!window.SecuriTables) return null;
  const bytes = await toBytes(data);
  const task = pdfjs.getDocument({ ...LOAD_OPTIONS, data: bytes, password: password || undefined });
  try {
    const doc = await task.promise;
    const pages = window.SecuriTables.pageList(pageSpec, doc.numPages);
    const sheets = [];
    for (const number of pages) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const items = [];
      for (const item of content.items) {
        if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
        items.push({
          x: item.transform[4],
          y: item.transform[5],
          w: item.width || 0,
          h: Math.hypot(item.transform[2], item.transform[3]) || item.height || 10,
          text: item.str,
        });
      }
      const tables = window.SecuriTables.gridFromItems(items);
      tables.forEach((table, index) => {
        sheets.push({
          name: tables.length > 1 ? `Sayfa ${number}-${index + 1}` : `Sayfa ${number}`,
          rows: table.rows,
          merges: table.merges,
        });
      });
      page.cleanup();
    }
    if (!sheets.length) return null;
    return kind === "csv" ? window.SecuriTables.csvBytes(sheets) : window.SecuriTables.xlsxBytes(sheets);
  } finally {
    try { await task.destroy(); } catch { /* already closed */ }
  }
}

window.SecuriPreview = { show, openViewer, closeViewer, countPages, pageInfo, textLines, textBoxes, exportTables };
window.dispatchEvent(new Event("securipreview-ready"));

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
};

function svgIcon(inner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function button(label, title, kind, icon) {
  const cls = kind === "primary" ? "viewer-btn viewer-btn-primary"
    : kind === "ghost" ? "viewer-btn viewer-btn-ghost"
    : kind === "icon" ? "viewer-btn viewer-btn-icon"
    : kind === "tool" ? "viewer-btn viewer-btn-tool"
    : "viewer-btn";
  const node = el("button", cls);
  node.type = "button";
  if (title) node.title = title;
  if (icon) node.innerHTML = svgIcon(icon) + (label ? `<span>${label}</span>` : "");
  else node.textContent = label;
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
  { mode: pdfjs.AnnotationEditorType.FREETEXT, label: "Metin", title: "Sayfaya tıklayıp yeni metin yazın", color: pdfjs.AnnotationEditorParamsType.FREETEXT_COLOR, initial: "#1d4ed8" },
  { mode: pdfjs.AnnotationEditorType.STAMP, label: "Görsel", title: "Sayfaya görsel ekleyin; sürükleyerek taşıyın" },
];

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
  const replace = button("Metni değiştir", "Seçilen paragrafta satırlar bu blokta kayar. Alttaki paragraflar yerinde kalır.", "tool", ICONS.edit);
  const printBtn = button("Yazdır", "Belgeyi yazıcıya gönderin (Ctrl+P)", "ghost", ICONS.print);
  const toWord = options.onToWord ? button("Word", "Uzun düzenleme için Word belgesine dönüştürün", "ghost", ICONS.word) : null;
  const save = button("Kaydet", "İşaretlemeleri, formu ve yorumları PDF'e yazın (Ctrl+S)", "primary", ICONS.save);
  save.disabled = true;
  const close = button("", "Görüntüleyiciyi kapat (Esc)", "icon", ICONS.close);
  close.classList.add("viewer-btn-close");

  top.append(titleWrap, searchBox, cluster(...[printBtn, toWord, save].filter(Boolean)), close);
  ribbon.append(
    group("Sayfa", prev, pageBox, next),
    group("Görünüm", zoomOut, zoomLabel, zoomIn, fitWidth, fitPage, rotate),
    group("İşaretle", marks),
    group("Düzenle", replace),
  );
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
  root.append(chrome, workspace, status);
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

  thumbsTitle.textContent = `${doc.numPages} sayfa`;
  const observer = new IntersectionObserver((items) => {
    items.forEach((item) => {
      if (!item.isIntersecting) return;
      observer.unobserve(item.target);
      const number = Number(item.target.dataset.page);
      doc.getPage(number)
        .then((page) => renderPage(page, item.target.querySelector("canvas"), THUMB_WIDTH))
        .catch(() => {});
    });
  }, { root: thumbsList, rootMargin: "200px" });
  current.thumbsObserver = observer;
  for (let number = 1; number <= doc.numPages; number++) {
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

  eventBus.on("pagesinit", () => {
    loading.remove();
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

  const setMark = (mark) => {
    try {
      pdfViewer.annotationEditorMode = { mode: mark.mode };
    } catch {
      return;
    }
    markButtons.forEach((node) => node.classList.toggle("active", node.dataset.mode === String(mark.mode)));
    statusMode.textContent = mark.title;
    color.hidden = !mark.color;
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
  let uiManager = null;
  eventBus.on("annotationeditoruimanager", (event) => {
    uiManager = event.uiManager;
    setMark(MARKS[0]);
  });

  // Toolbar clicks would clear the text selection; keep it so "Metni değiştir" can read it.
  chrome.addEventListener("mousedown", (event) => {
    if (event.target.closest("input, textarea, [contenteditable=true]")) return;
    event.preventDefault();
  });

  const field = el("textarea", "replace-field");
  field.hidden = true;
  field.rows = 2;
  field.setAttribute("aria-label", "Yeni metin");
  field.setAttribute("spellcheck", "false");
  const actions = el("div", "replace-actions");
  actions.hidden = true;
  const fontColor = el("input", "replace-color");
  fontColor.type = "color";
  fontColor.value = "#0f172a";
  fontColor.title = "Yazı rengi";
  const fontSizeInput = el("input", "replace-size");
  fontSizeInput.type = "number";
  fontSizeInput.min = "8";
  fontSizeInput.max = "96";
  fontSizeInput.title = "Yazı boyutu (punto)";
  const fontFamily = el("select", "replace-font");
  fontFamily.title = "Yazı tipi";
  [
    ["Segoe UI, sans-serif", "Segoe UI"],
    ["Arial, Helvetica, sans-serif", "Arial"],
    ["Calibri, sans-serif", "Calibri"],
    ['"Times New Roman", Times, serif', "Times New Roman"],
    ["Georgia, serif", "Georgia"],
    ['"Courier New", Courier, monospace', "Courier New"],
  ].forEach(([value, label]) => {
    const option = el("option", null, label);
    option.value = value;
    fontFamily.appendChild(option);
  });
  const applyBtn = button("Uygula", "Değişikliği yaz", "primary");
  const cancelBtn = button("Vazgeç");
  actions.append(fontFamily, fontColor, fontSizeInput, applyBtn, cancelBtn);
  const syncFieldFace = () => {
    field.style.fontFamily = fontFamily.value;
    field.style.color = fontColor.value || "#0f172a";
    field.style.fontSize = Math.max(8, Number(fontSizeInput.value) || 12) + "px";
  };
  fontFamily.onchange = syncFieldFace;
  fontColor.oninput = syncFieldFace;
  fontSizeInput.oninput = syncFieldFace;
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

  const paragraphAround = (pageEl, seed) => {
    const spans = Array.from(pageEl.querySelectorAll(".textLayer span")).map((node) => {
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
    const hits = spans.filter((item) =>
      item.left < seed.right && item.right > seed.left && item.top < seed.bottom && item.bottom > seed.top);
    if (!hits.length) return null;
    const sortedHit = hits.slice().sort((a, b) => a.left - b.left);
    const colLeft = sortedHit[Math.floor(sortedHit.length / 2)].left;
    const lineH = hits.slice().sort((a, b) => a.height - b.height)[Math.floor(hits.length / 2)].height;
    const included = new Set(hits);
    let growing = true;
    while (growing) {
      growing = false;
      const members = Array.from(included);
      const top = Math.min(...members.map((item) => item.top));
      const bottom = Math.max(...members.map((item) => item.bottom));
      const right = Math.max(...members.map((item) => item.right));
      spans.forEach((item) => {
        if (included.has(item)) return;
        const sameCol = Math.abs(item.left - colLeft) <= 28 || (item.left >= colLeft - 10 && item.left < right);
        const near = item.top <= bottom + lineH * 1.35 && item.bottom >= top - lineH * 1.35;
        if (sameCol && near) {
          included.add(item);
          growing = true;
        }
      });
    }
    const list = Array.from(included).sort((a, b) => a.top - b.top || a.left - b.left);
    const pad = Math.max(3, lineH * 0.22);
    const boxes = list.map((item) => padBox(item, pad));
    return {
      text: list.map((item) => item.text).join("").replace(/\s+/g, " ").trim(),
      boxes,
      wrapWidth: Math.max(...boxes.map((box) => box.width)),
    };
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
    const pad = Math.max(3, screen[0].height * 0.22);
    let boxes = screen.map((rect) => padBox(rect, pad));
    const seed = {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    const paragraph = paragraphAround(pageEl, seed);
    let wrapWidth = Math.max(...boxes.map((box) => box.width));
    let value = text;
    if (paragraph && paragraph.boxes.length) {
      boxes = paragraph.boxes;
      wrapWidth = paragraph.wrapWidth;
      value = paragraph.text;
    }
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
    field.style.width = Math.max(blockWidth, 160) + "px";
    field.style.height = Math.max(blockHeight, 36) + "px";
    field.value = found.text;
    fontSizeInput.value = String(Math.round(Math.max(8, first.height * 0.72)));
    field.style.fontSize = fontSizeInput.value + "px";
    field.style.fontFamily = fontFamily.value;
    field.style.color = fontColor.value || "#0f172a";
    field.style.lineHeight = "1.25";
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

  const stampLayer = async (pageIndex) => {
    try {
      pdfViewer.annotationEditorMode = { mode: pdfjs.AnnotationEditorType.STAMP };
    } catch {
      /* already in stamp mode */
    }
    for (let i = 0; i < 40; i++) {
      const view = pdfViewer.getPageView(pageIndex);
      const builder = view && view.annotationEditorLayer;
      if (builder && !builder.annotationEditorLayer && view.viewport) {
        await builder.render({ viewport: view.viewport });
      }
      if (builder && builder.annotationEditorLayer) return builder.annotationEditorLayer;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const applyReplace = async () => {
    if (!pendingReplace) return;
    const next = field.value;
    if (!next.trim()) {
      hideReplace();
      return;
    }
    const { pageNumber, boxes, view, wrapWidth } = pendingReplace;
    const pageIndex = pageNumber - 1;
    const first = boxes[0];
    const fontSize = Math.max(8, Number(fontSizeInput.value) || first.height * 0.72);
    const ink = fontColor.value || "#0f172a";
    const face = fontFamily.value || "Segoe UI, sans-serif";
    const scale = 3;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `500 ${fontSize * scale}px ${face}`;
    const column = Math.max(40, wrapWidth || Math.max(...boxes.map((box) => box.width)));
    const lines = wrapLines(measure, next, (column - 6) * scale);
    const lineHeight = fontSize * 1.25;
    const union = {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.min(...boxes.map((box) => box.left)) + column,
      bottom: Math.max(...boxes.map((box) => box.bottom), Math.min(...boxes.map((box) => box.top)) + lines.length * lineHeight + 4),
    };
    union.width = union.right - union.left;
    union.height = union.bottom - union.top;
    const origin = pendingReplace.originEl.getBoundingClientRect();
    const a = view.getPagePoint(union.left - origin.left, union.top - origin.top);
    const b = view.getPagePoint(union.right - origin.left, union.bottom - origin.top);
    const pdfBox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.ceil(union.width * scale));
    canvas.height = Math.max(2, Math.ceil(union.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    boxes.forEach((box) => {
      ctx.fillRect((box.left - union.left) * scale, (box.top - union.top) * scale, box.width * scale, box.height * scale);
    });
    ctx.fillStyle = ink;
    ctx.font = `500 ${fontSize * scale}px ${face}`;
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, 2 * scale, (2 + index * lineHeight) * scale);
    });
    const layer = await stampLayer(pageIndex);
    const packed = uiManager && uiManager.imageManager && uiManager.imageManager.getFromCanvas
      ? uiManager.imageManager.getFromCanvas("spf-" + Date.now(), canvas)
      : null;
    if (!layer || !layer.deserialize) {
      hideReplace();
      window.alert("Metin bu belgede değiştirilemedi. Uzun düzenleme için Word'e dönüştürün.");
      return;
    }
    const editor = await layer.deserialize({
      annotationType: pdfjs.AnnotationEditorType.STAMP,
      bitmapId: packed && packed.id,
      bitmap: packed && packed.bitmap,
      bitmapUrl: packed ? undefined : canvas.toDataURL("image/png"),
      pageIndex,
      rect: pdfBox,
      rotation: 0,
      isSvg: false,
    });
    if (!editor) {
      hideReplace();
      window.alert("Metin bu belgede değiştirilemedi. Uzun düzenleme için Word'e dönüştürün.");
      return;
    }
    layer.addOrRebuild(editor);
    markDirty(true);
    hideReplace();
    setTimeout(() => setMark(MARKS[0]), 400);
  };

  const openReplace = () => {
    const found = captureSelection() || pendingReplace;
    if (!found || !found.boxes) {
      statusMode.textContent = "Önce Seç kipinde değiştirilecek paragrafı işaretleyin. Satırlar bu blokta kayar; alttaki paragraflar yerinde kalır.";
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

  save.onclick = async () => {
    if (!options.onSave) return;
    save.disabled = true;
    try {
      const bytes = await doc.saveDocument();
      const saved = await options.onSave(bytes);
      markDirty(!saved);
    } catch {
      markDirty(true);
      window.alert("İşaretlemeler kaydedilemedi.");
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
  });
  return out;
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
      page.cleanup();
    }
    return mergeBoxes(boxes);
  } finally {
    task.destroy();
  }
}

window.SecuriPreview = { show, openViewer, closeViewer, countPages, pageInfo, textLines, textBoxes };
window.dispatchEvent(new Event("securipreview-ready"));

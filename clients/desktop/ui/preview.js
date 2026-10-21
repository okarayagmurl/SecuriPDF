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
const docSessions = [];
let docTabStrip = null;
let addDocument = null;

function sessionAlive(session) {
  return docSessions.includes(session);
}

function renderDocTabs() {
  if (!docTabStrip) {
    docTabStrip = el("div", "doc-tabs");
    document.body.appendChild(docTabStrip);
  }
  docTabStrip.replaceChildren();
  docSessions.forEach((session) => {
    const tab = el("button", "doc-tab" + (session === viewer ? " active" : ""));
    tab.type = "button";
    tab.title = session.title || "Belge";
    const label = el("span", "doc-tab-label", session.title || "Belge");
    const close = el("span", "doc-tab-x", "×");
    close.title = t("Kapat");
    tab.append(label, close);
    tab.addEventListener("click", () => activateSession(session));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeSession(session, false);
    });
    docTabStrip.appendChild(tab);
  });
  const add = el("button", "doc-tab-add", "+");
  add.type = "button";
  add.title = t("Başka belge aç");
  add.addEventListener("click", () => { if (addDocument) addDocument(); });
  docTabStrip.appendChild(add);
  const open = docSessions.length > 0;
  docTabStrip.hidden = !open;
  document.documentElement.classList.toggle("has-doc-tabs", open);
}

function activateSession(session) {
  if (!sessionAlive(session)) return;
  docSessions.forEach((item) => {
    if (item.onKey) document.removeEventListener("keydown", item.onKey, true);
    item.root.hidden = item !== session;
    item.parked = false;
  });
  viewer = session;
  session.root.hidden = false;
  if (session.onKey) document.addEventListener("keydown", session.onKey, true);
  renderDocTabs();
  notifyViewer(true);
}

function closeSession(session, force) {
  if (!sessionAlive(session)) return true;
  if (!force && session.isDirty() && !window.confirm(t("Kaydedilmemiş değişiklikler var. Bu belge kapatılsın mı?"))) return false;
  if (session.thumbsObserver) session.thumbsObserver.disconnect();
  if (typeof session.cleanup === "function") session.cleanup();
  if (session.onKey) document.removeEventListener("keydown", session.onKey, true);
  session.root.remove();
  try { session.task.destroy(); } catch { /* already closed */ }
  const index = docSessions.indexOf(session);
  docSessions.splice(index, 1);
  session.closed = true;
  if (typeof session.onClose === "function") session.onClose();
  if (viewer === session) {
    viewer = null;
    const next = docSessions[index] || docSessions[index - 1] || null;
    if (next) activateSession(next);
    else notifyViewer(false);
  }
  renderDocTabs();
  return true;
}

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
  return closeSession(viewer, force);
}

function notifyViewer(shown) {
  document.dispatchEvent(new CustomEvent("securipdf-viewer-visibility", {
    detail: { shown: Boolean(shown), title: viewer ? viewer.title : "" },
  }));
}

function parkViewer() {
  if (!viewer) return false;
  if (viewer.onKey) document.removeEventListener("keydown", viewer.onKey, true);
  viewer.root.hidden = true;
  viewer.parked = true;
  if (docTabStrip) docTabStrip.hidden = true;
  document.documentElement.classList.remove("has-doc-tabs");
  notifyViewer(false);
  return true;
}

function resumeViewer() {
  if (!viewer) return false;
  viewer.parked = false;
  activateSession(viewer);
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
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  curve: '<path d="M4 16c4-9 12-9 16 0"/>',
  pentagon: '<path d="M12 3.5l7.6 5.5-2.9 8.5H7.3L4.4 9z"/>',
  cloud: '<path d="M7 17h10a3.5 3.5 0 0 0 .4-7 4.5 4.5 0 0 0-8.6-1.5A3.4 3.4 0 0 0 7 17z"/>',
  line: '<line x1="5" y1="19" x2="19" y2="5"/>',
  zigzag: '<polyline points="3 16 7 8 11 16 15 8 19 16"/>',
  arrow: '<line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-5a6 6 0 0 0-6-6H4"/>',
  redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-5a6 6 0 0 1 6-6h10"/>',
  eraser: '<path d="M20 20H9L3.5 14.5a2 2 0 0 1 0-2.8L12 3.2a2 2 0 0 1 2.8 0L20 8.4"/><path d="M7 13l6 6"/>',
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

function bandsOverlap(a, b) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap > Math.min(a.height, b.height) * 0.45;
}

function unionSpan(items) {
  const left = Math.min(...items.map((item) => item.left));
  const top = Math.min(...items.map((item) => item.top));
  const right = Math.max(...items.map((item) => item.right));
  const bottom = Math.max(...items.map((item) => item.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Groups text runs into dashed edit regions. mergeLines keeps a paragraph together; a table cell stays separate. */
function clusterTextBlocks(spans, mergeLines = true) {
  const runs = [];
  spans.slice().sort((a, b) => a.top - b.top || a.left - b.left).forEach((span) => {
    const run = runs.find((entry) => {
      if (!bandsOverlap(entry, span)) return false;
      const gap = span.left >= entry.right ? span.left - entry.right : entry.left - span.right;
      return gap < Math.max(8, span.height * 0.8);
    });
    if (!run) {
      runs.push({ spans: [span], ...unionSpan([span]) });
      return;
    }
    run.spans.push(span);
    Object.assign(run, unionSpan(run.spans));
  });
  const blocks = runs.map((run) => ({ spans: run.spans.slice(), ...unionSpan(run.spans) }));
  const visible = (list) => list.filter((block) => block.width > 4 && block.height > 4 && block.spans.some((span) => span.text.trim()));
  if (!mergeLines) return visible(blocks);
  const beside = (block, other) => {
    if (!bandsOverlap(block, other)) return false;
    return other.right < block.left - 8 || other.left > block.right + 8;
  };
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (blocks.some((other) => other !== a && other !== b && (beside(a, other) || beside(b, other)))) continue;
        const upper = a.top <= b.top ? a : b;
        const lower = upper === a ? b : a;
        const gap = lower.top - upper.bottom;
        const height = Math.max(8, a.height, b.height);
        if (gap > height * 0.7 || gap < -height * 0.25) continue;
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const narrow = Math.min(a.width, b.width);
        const aligned = Math.abs(a.left - b.left) < height;
        if (overlap < narrow * 0.4 && !aligned) continue;
        a.spans.push(...b.spans);
        Object.assign(a, unionSpan(a.spans));
        blocks.splice(j, 1);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return visible(blocks);
}

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

const SHAPE_STROKE = 1.6;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Screen-space outline for a drag from `a` to `b`. Closed shapes use the bounding box. */
function shapePaths(kind, a, b) {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const box = (pts, close, fill) => [{ points: pts, close, fill }];
  if (kind === "rect") {
    return box([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }], true, false);
  }
  if (kind === "ellipse") {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max(1, (right - left) / 2);
    const ry = Math.max(1, (bottom - top) / 2);
    const pts = [];
    for (let i = 0; i < 40; i += 1) {
      const ang = (i / 40) * Math.PI * 2;
      pts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
    }
    return box(pts, true, false);
  }
  if (kind === "pentagon") {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max(1, (right - left) / 2);
    const ry = Math.max(1, (bottom - top) / 2);
    const pts = [];
    for (let i = 0; i < 5; i += 1) {
      const ang = -Math.PI / 2 + i * Math.PI * 2 / 5;
      pts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
    }
    return box(pts, true, false);
  }
  if (kind === "cloud") {
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    const bump = Math.max(8, Math.min(w, h) / 5);
    const edges = [
      [left, top, right, top, 0, -1],
      [right, top, right, bottom, 1, 0],
      [right, bottom, left, bottom, 0, 1],
      [left, bottom, left, top, -1, 0],
    ];
    const pts = [];
    edges.forEach(([x0, y0, x1, y1, nx, ny]) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const count = Math.max(1, Math.round(len / (bump * 2)));
      for (let i = 0; i < count; i += 1) {
        const t0 = i / count;
        const t1 = (i + 0.5) / count;
        pts.push({ x: x0 + (x1 - x0) * t0, y: y0 + (y1 - y0) * t0 });
        pts.push({
          x: x0 + (x1 - x0) * t1 + nx * bump * 0.7,
          y: y0 + (y1 - y0) * t1 + ny * bump * 0.7,
        });
      }
    });
    return box(pts, true, false);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  if (kind === "curve") {
    const ox = -dy * 0.35;
    const oy = dx * 0.35;
    const c = { x: (a.x + b.x) / 2 + ox, y: (a.y + b.y) / 2 + oy };
    const pts = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const u = 1 - t;
      pts.push({
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      });
    }
    return box(pts, false, false);
  }
  if (kind === "zigzag") {
    const nx = -dy / len;
    const ny = dx / len;
    const amp = Math.min(16, len * 0.12);
    const steps = 8;
    const pts = [{ x: a.x, y: a.y }];
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const sign = i % 2 ? 1 : -1;
      pts.push({ x: a.x + dx * t + nx * amp * sign, y: a.y + dy * t + ny * amp * sign });
    }
    pts.push({ x: b.x, y: b.y });
    return box(pts, false, false);
  }
  if (kind === "arrow") {
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const head = Math.min(18, len * 0.28);
    const base = { x: b.x - ux * head, y: b.y - uy * head };
    const wing = head * 0.55;
    return [
      { points: [{ x: a.x, y: a.y }, base], close: false, fill: false },
      {
        points: [
          { x: b.x, y: b.y },
          { x: base.x + px * wing, y: base.y + py * wing },
          { x: base.x - px * wing, y: base.y - py * wing },
        ],
        close: true,
        fill: true,
      },
    ];
  }
  return box([{ x: a.x, y: a.y }, { x: b.x, y: b.y }], false, false);
}

/**
 * Opens `source` in a scrolling viewer with search, zoom and markup tools.
 * options.onSave(bytes) receives the PDF with the markup written into it.
 */
async function openViewer(source, pageNumber, title, options = {}) {
  const tabTitle = title || "Belge";
  const existing = docSessions.find((session) => session.title === tabTitle);
  if (existing) {
    activateSession(existing);
    if (existing.goToPage) existing.goToPage(pageNumber || 1);
    return;
  }
  if (options.onAddDocument) addDocument = options.onAddDocument;
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
  const printBtn = button("Yazdır", "Belgeyi yazıcıya gönderin (Ctrl+P)", "ghost", ICONS.print);
  const toWord = options.onTask ? button("Word", "Uzun düzenleme için Word belgesine dönüştürün", "ghost", ICONS.word) : null;
  const save = button("Kaydet", "İşaretlemeleri, formu ve yorumları PDF'e yazın (Ctrl+S)", "primary", ICONS.save);
  save.disabled = true;
  const close = button("", "Görüntüleyiciyi kapat (Esc)", "icon", ICONS.close);
  close.classList.add("viewer-btn-close");

  top.append(titleWrap, searchBox, cluster(...[printBtn, toWord, save].filter(Boolean)), close);
  if (options.onTask) {
    const ocrBtn = button("OCR", "Taranmış sayfayı aranabilir yap", "tool", ICONS.text);
    const redactBtn = button("Karart", "Kişisel veriyi kalıcı olarak kapatın", "tool", ICONS.highlight);
    ocrBtn.onclick = () => openTask("ocr-pdf");
    redactBtn.onclick = () => openTask("redact");
    marks.append(ocrBtn, redactBtn);
  }
  const pageGroup = group("Sayfa", prev, pageBox, next);
  const viewGroup = group("Görünüm", zoomOut, zoomLabel, zoomIn, fitWidth, fitPage, rotate);
  const markGroup = group("İşaret", marks);
  const editHint = el("p", "viewer-ribbon-hint", t("Kesik çizgili alan yazının kendisidir. Tıklayınca orada değişir."));
  const formHint = el("p", "viewer-ribbon-hint", t("Sayfada sürükleyerek metin, onay kutusu veya liste alanı çizin."));
  const convertTools = Array.isArray(options.convertTools) ? options.convertTools.filter((tool) => tool && tool.id && tool.title) : [];
  const signTools = Array.isArray(options.signTools) ? options.signTools.filter((tool) => tool && tool.id && tool.title) : [];
  const pageTools = Array.isArray(options.pageTools) ? options.pageTools.filter((tool) => tool && tool.id && tool.title) : [];
  const toolCatalog = Array.isArray(options.tools) ? options.tools.filter((tool) => tool && tool.id && tool.title) : [];
  const shapeKinds = [
    ["rect", "Dikdörtgen", "Dikdörtgen çizin", ICONS.rect],
    ["ellipse", "Elips", "Elips çizin", ICONS.ellipse],
    ["curve", "Eğri", "Eğri çizin", ICONS.curve],
    ["pentagon", "Beşgen", "Beşgen çizin", ICONS.pentagon],
    ["cloud", "Bulut", "Bulut çizin", ICONS.cloud],
    ["line", "Çizgi", "Düz çizgi çizin", ICONS.line],
    ["zigzag", "Zikzak", "Zikzak çizin", ICONS.zigzag],
    ["arrow", "Ok", "Ok çizin", ICONS.arrow],
  ];
  let shapeTool = "rect";
  let shapeColorValue = "#e11d48";
  let selectedShapeId = null;
  let chooseShape = (id) => { shapeTool = id; };
  let undoShape = () => {};
  let redoShape = () => {};
  const shapeSelectBtn = button("", "Şekli seç", "icon", ICONS.select);
  shapeSelectBtn.classList.add("viewer-shape-select");
  shapeSelectBtn.setAttribute("aria-label", t("Seç"));
  shapeSelectBtn.onclick = () => chooseShape("select");
  const shapeButtons = shapeKinds.map(([id, label, title, icon]) => {
    const node = button("", title, "icon", icon);
    node.classList.add("viewer-shape-tool");
    node.setAttribute("aria-label", t(label));
    node.classList.toggle("active", id === shapeTool);
    node.onclick = () => chooseShape(id);
    return node;
  });
  const shapeColor = el("input", "viewer-color");
  shapeColor.type = "color";
  shapeColor.value = shapeColorValue;
  shapeColor.title = t("Şekil rengi");
  shapeColor.setAttribute("aria-label", t("Şekil rengi"));
  shapeColor.oninput = () => { shapeColorValue = shapeColor.value; };
  let shapeColorUndoArmed = false;
  const shapeSep = () => el("span", "viewer-sep");
  const shapeUndoBtn = button("", "Geri al", "icon", ICONS.undo);
  const shapeRedoBtn = button("", "Yinele", "icon", ICONS.redo);
  const shapeEraseBtn = button("", "Silgi", "icon", ICONS.eraser);
  shapeEraseBtn.classList.add("viewer-shape-tool");
  shapeUndoBtn.onclick = () => undoShape();
  shapeRedoBtn.onclick = () => redoShape();
  shapeEraseBtn.onclick = () => chooseShape("eraser");
  const shapeGroup = group(t("Şekiller"), shapeSelectBtn, ...shapeButtons, shapeSep(), shapeColor, shapeSep(), shapeUndoBtn, shapeRedoBtn, shapeEraseBtn);
  let pendingViewerMode = null;
  let setViewerMode = (mode) => { pendingViewerMode = mode; };
  let openTask = () => {};
  const commandItems = [
    ["edit", "Metin", "Yazıyı yerinde düzenle"],
    ["add", "Ekle", "Görsel ekle, damga koy veya dosya iliştir"],
    ["shapes", "Şekil", "Otomatik şekiller"],
  ];
  if (options.addFormFields) commandItems.push(["form", "Form", "Form alanı ekle"]);
  commandItems.push(["note", "İşaret", "Vurgula, çiz veya karart"]);
  if (options.onTask && pageTools.length) commandItems.push(["pages", "Sayfa", "Döndür, kırp, sil veya sırala"]);
  if (options.onTask && convertTools.length) commandItems.push(["convert", "Dönüştür", "Belgeyi başka biçime çevir"]);
  if (options.onTask && signTools.length) commandItems.push(["sign", "İmzala", "Sertifika, doğrulama ve zaman damgası"]);
  let openCommandMenu = () => {};
  const commandButtons = commandItems.map(([id, label, title]) => {
    const node = button(label, title);
    node.classList.add("viewer-command");
    node.dataset.mode = id;
    node.onclick = (event) => {
      if (id === "add" || id === "pages" || id === "convert" || id === "sign") {
        event.stopPropagation();
        const rect = node.getBoundingClientRect();
        openCommandMenu(id, rect.left, rect.bottom + 4);
        return;
      }
      setViewerMode(id);
    };
    return node;
  });
  const toolFind = el("input", "viewer-toolfind");
  toolFind.type = "search";
  toolFind.placeholder = t("Araç ara");
  toolFind.setAttribute("aria-label", t("Araç ara"));
  toolFind.autocomplete = "off";
  let showToolMatches = () => {};
  toolFind.oninput = () => showToolMatches();
  toolFind.onfocus = () => showToolMatches();
  const commandBar = el("div", "viewer-commands");
  commandBar.append(...commandButtons, toolFind);
  ribbon.append(...[pageGroup, viewGroup, commandBar, markGroup, editHint, formHint, shapeGroup].filter(Boolean));
  chrome.append(top, ribbon);
  const workspace = el("div", "viewer-workspace");
  const side = el("aside", "viewer-side");
  side.hidden = true;
  const sideTitle = el("h2", "viewer-side-title", t("Metin Stilleri"));
  const stylePane = el("div", "viewer-style");
  const formPane = el("div", "viewer-form-pane");
  const formList = el("ul", "viewer-form-items");
  const formEmpty = el("div", "viewer-form-empty");
  formEmpty.innerHTML = svgIcon(ICONS.form);
  formEmpty.appendChild(el("p", null, t("Bu belgede form alanı yok")));
  formPane.append(formList, formEmpty);
  side.append(sideTitle, stylePane, formPane);
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
  const taskPane = el("aside", "viewer-task");
  taskPane.hidden = true;
  const taskHead = el("div", "viewer-task-head");
  const taskTitle = el("h2", "viewer-side-title", "");
  const taskClose = button("", "Paneli kapat", "icon", ICONS.close);
  taskHead.append(taskTitle, taskClose);
  const taskBody = el("div", "viewer-task-body");
  taskPane.append(taskHead, taskBody);
  let taskToken = 0;
  const closeTask = () => {
    taskToken += 1;
    taskPane.hidden = true;
    taskPane.dataset.open = "";
    taskBody.replaceChildren();
    applyViewerChrome(viewerMode);
  };
  taskClose.onclick = (event) => {
    event.stopPropagation();
    closeTask();
  };
  workspace.append(thumbs, body, side, taskPane);
  const status = el("div", "viewer-status");
  const statusPage = el("span", "viewer-status-page", "Sayfa —");
  const statusMode = el("span", "viewer-status-mode", MARKS[0].title);
  const statusKeys = el("span", "viewer-status-keys", t("Ctrl+S kaydet · Ctrl+F ara · Ctrl+tekerlek yakınlaştır"));
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
  docSessions.forEach((item) => { item.root.hidden = true; });

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
  let editorUi = null;
  eventBus.on("annotationeditoruimanager", (evt) => { editorUi = evt.uiManager; });
  let hideMenu = () => false;
  let pickImage = () => {};

  let dirty = false;
  let formMode = false;
  let viewerMode = "view";
  const applyViewerChrome = (mode) => {
    viewerMode = mode;
    commandButtons.forEach((node) => node.classList.toggle("active", node.dataset.mode === mode));
    markGroup.hidden = mode !== "note";
    shapeGroup.hidden = mode !== "shapes";
    editHint.hidden = mode !== "edit";
    formHint.hidden = mode !== "form";
    const showSide = taskPane.dataset.open !== "1" && (mode === "edit" || mode === "form");
    side.hidden = !showSide;
    taskPane.hidden = taskPane.dataset.open !== "1";
    stylePane.hidden = mode !== "edit";
    formPane.hidden = mode !== "form";
    sideTitle.textContent = mode === "form" ? t("Form Alanı Listesi") : t("Metin Stilleri");
  };
  applyViewerChrome("view");
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
    } else if (!typing && viewerMode === "shapes" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoShape();
      else undoShape();
    } else if (!typing && viewerMode === "shapes" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoShape();
    } else if (!typing && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "+" || event.key === "=" || event.key === "Add" || event.code === "NumpadAdd")) {
      event.preventDefault();
      pdfViewer.increaseScale();
    } else if (!typing && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "-" || event.key === "_" || event.key === "Subtract" || event.code === "NumpadSubtract")) {
      event.preventDefault();
      pdfViewer.decreaseScale();
    } else if (!typing && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0")) {
      event.preventDefault();
      pdfViewer.currentScaleValue = "page-fit";
    } else if (!typing && event.key === "PageDown") {
      event.preventDefault();
      pdfViewer.nextPage();
    } else if (!typing && event.key === "PageUp") {
      event.preventDefault();
      pdfViewer.previousPage();
    } else if (event.key === "Escape" && !typing) {
      if (hideMenu()) { event.preventDefault(); return; }
      if (taskPane.dataset.open === "1") { event.preventDefault(); closeTask(); return; }
      if (viewerMode !== "view") { event.preventDefault(); setViewerMode("view"); return; }
      closeViewer(false);
    }
  };
  const current = { root, onKey, task, title: tabTitle, pendingPage: pageNumber || 1, isDirty: () => dirty, onClose: options.onClose };
  docSessions.push(current);
  activateSession(current);

  let doc;
  try {
    doc = await task.promise;
  } catch {
    if (sessionAlive(current)) loading.textContent = "PDF açılamadı.";
    return;
  }
  if (!sessionAlive(current)) return;
  current.goToPage = (number) => {
    if (!number) return;
    current.pendingPage = number;
    pdfViewer.currentPageNumber = number;
  };
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
  let readCurrentFile = async () => {
    throw new Error("Belge henüz hazır değil.");
  };
  let adoptDocument = async () => false;

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
  root.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const raw = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const steps = Math.max(0.25, Math.min(2, Math.abs(raw) / 120));
    if (raw < 0) pdfViewer.increaseScale({ steps });
    else if (raw > 0) pdfViewer.decreaseScale({ steps });
  }, { capture: true, passive: false });

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

  let leaveRegions = () => {};
  setFormMode = (on) => {
    if (on) leaveRegions();
    formMode = on;
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
    leaveRegions();
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
        value: true,
      });
    }
    if (mark.color) {
      color.value = mark.current || mark.initial;
      eventBus.dispatch("switchannotationeditorparams", { source: color, type: mark.color, value: color.value });
    }
  };
  let activeMark = MARKS[0];
  markButtons.forEach((node, index) => {
    node.onclick = () => {
      activeMark = MARKS[index];
      if (activeMark.mode === pdfjs.AnnotationEditorType.STAMP) {
        pickImage(Math.max(0, (pdfViewer.currentPageNumber || 1) - 1), null, null);
        return;
      }
      setMark(activeMark);
      if (activeMark.mode === pdfjs.AnnotationEditorType.HIGHLIGHT && editorUi) {
        try { editorUi.highlightSelection("toolbar"); } catch { /* selection comes from the page */ }
      }
    };
  });
  color.oninput = () => {
    activeMark.current = color.value;
    eventBus.dispatch("switchannotationeditorparams", { source: color, type: activeMark.color, value: color.value });
  };
  // Toolbar clicks would clear the text selection; keep it so "Metni değiştir" can read it.
  // Buttons stay clickable: cancelling mousedown also cancels their click.
  chrome.addEventListener("mousedown", (event) => {
    if (event.target.closest("input, textarea, select, button, [contenteditable=true]")) return;
    event.preventDefault();
  });

  const field = el("textarea", "replace-field");
  field.hidden = true;
  field.rows = 2;
  field.setAttribute("aria-label", "Yeni metin");
  field.setAttribute("spellcheck", "false");
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
  applyBtn.disabled = true;
  const fontLabel = el("label", "viewer-side-label", t("Yazı tipi"));
  const styleRow = el("div", "viewer-style-row");
  styleRow.append(boldBtn, italicBtn, sizeInput, replaceColor);
  const styleNote = el("p", "viewer-side-note", t("Kesik çizgili bir alana tıklayın."));
  const applyRow = el("div", "viewer-style-row");
  applyRow.append(cancelBtn);
  stylePane.append(fontLabel, fontSel, styleRow, styleNote, applyRow);
  let colorTouched = false;
  root.append(field);
  let pendingReplace = null;
  const covers = [];

  const clearCovers = () => {
    covers.splice(0).forEach((node) => node.remove());
  };

  const hideReplace = () => {
    field.hidden = true;
    root.appendChild(field);
    applyBtn.disabled = true;
    styleNote.textContent = t("Kesik çizgili bir alana tıklayın.");
    stage.querySelectorAll(".edit-region.selected").forEach((node) => node.classList.remove("selected"));
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

  // A page can expose the same glyphs twice (text layer plus extraction, or a redraw
  // a fraction of a line away). Keep one box so the line is not shown stacked.
  const dedupeSpans = (spans) => {
    const kept = [];
    spans.forEach((span) => {
      const text = span.text.replace(/\s+/g, " ").trim();
      const mid = (span.top + span.bottom) / 2;
      const twin = kept.find((other) => {
        const otherText = other.text.replace(/\s+/g, " ").trim();
        const overlapX = Math.min(other.right, span.right) - Math.max(other.left, span.left);
        const minW = Math.min(other.width, span.width);
        const minH = Math.min(other.height, span.height);
        const sameLine = Math.abs(((other.top + other.bottom) / 2) - mid) < Math.max(minH, 4) * 0.65;
        const sameText = text === otherText;
        return sameLine && overlapX > minW * 0.45 && (sameText || overlapX > minW * 0.75);
      });
      if (!twin) kept.push({ ...span, text });
    });
    return kept;
  };

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
      cover.style.left = (box.left - pageBox.left - 1) + "px";
      cover.style.top = (box.top - pageBox.top - 1) + "px";
      cover.style.width = (box.width + 2) + "px";
      cover.style.height = (box.height + 2) + "px";
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
    field.style.height = Math.max(blockHeight, 16) + "px";
    field.value = found.text;
    field.style.fontSize = Math.round(Math.max(10, first.height * 0.86)) + "px";
    field.style.lineHeight = "1";
    field.style.padding = "0 2px";
    colorTouched = false;
    styleDirty = false;
    watchStyle = false;
    replaceColor.value = "#111827";
    boldBtn.classList.remove("on");
    italicBtn.classList.remove("on");
    boldBtn.setAttribute("aria-pressed", "false");
    italicBtn.setAttribute("aria-pressed", "false");
    paintReplaceFont();
    watchStyle = true;
    styleNote.textContent = found.text.replace(/\s+/g, " ").trim() || t("Kesik çizgili bir alana tıklayın.");
    applyBtn.disabled = false;
    field.hidden = false;
    found.pageEl.appendChild(field);
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

  let textRuns = new Map();
  const showEditedDocument = async (bytes, page, scale) => {
    textRuns = new Map();
    const nextTask = pdfjs.getDocument({ ...LOAD_OPTIONS, data: bytes, password: options.password || undefined });
    const nextDoc = await nextTask.promise;
    if (!sessionAlive(current)) { nextTask.destroy(); return false; }
    current.task.destroy();
    current.task = nextTask;
    doc = nextDoc;
    const safePage = Math.min(Math.max(1, page || 1), doc.numPages);
    doc.annotationStorage.onSetModified = () => markDirty(true);
    doc.annotationStorage.onResetModified = () => markDirty(false);
    let painted = false;
    const paintedDone = new Promise((resolve) => {
      const onPaint = (evt) => {
        if (evt.pageNumber !== safePage) return;
        eventBus.off("pagerendered", onPaint);
        painted = true;
        resolve();
      };
      eventBus.on("pagerendered", onPaint);
      setTimeout(() => { eventBus.off("pagerendered", onPaint); resolve(); }, 5000);
    });
    restoreView = { page: safePage, scale };
    pdfViewer.setDocument(doc);
    linkService.setDocument(doc, null);
    pageTotal.textContent = `/ ${doc.numPages}`;
    pageInput.max = String(doc.numPages);
    fillThumbs(doc);
    await paintedDone;
    pdfViewer.currentPageNumber = safePage;
    const view = pdfViewer.getPageView(safePage - 1);
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

  let styleDirty = false;
  let watchStyle = false;
  let replaceBusy = false;
  const paintReplaceFont = () => {
    if (watchStyle) styleDirty = true;
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

  let editorSig = "";
  let editorTask = null;
  let editorReady = false;
  const postEditor = options.engineQuiet || options.engine;
  const writeEditor = options.engineJsonQuiet || options.engineJson;
  const byteSig = (bytes) => {
    const count = bytes.length;
    let hash = count >>> 0;
    const step = Math.max(1, Math.floor(count / 48));
    for (let index = 0; index < count; index += step) hash = (Math.imul(hash, 33) + bytes[index]) >>> 0;
    return count + ":" + hash;
  };
  const ensureEditorJob = (bytes, onProgress) => {
    const sig = byteSig(bytes);
    if (!(editorTask && editorSig === sig)) {
      editorSig = sig;
      editorReady = false;
      const task = (async () => {
        const form = new FormData();
        form.append("fileInput", new File([bytes], "belge.pdf", { type: "application/pdf" }));
        form.append("async", "true");
        form.append("lightweight", "true");
        const started = JSON.parse(new TextDecoder().decode(await postEditor("/api/v1/convert/pdf/text-editor", form)));
        if (!started.jobId) throw new Error("Metin düzenleyici işi başlamadı.");
        await waitForTextJob(started.jobId, onProgress);
        if (editorSig === sig) editorReady = true;
        return started.jobId;
      })();
      editorTask = task.catch((err) => {
        if (editorSig === sig) { editorTask = null; editorSig = ""; editorReady = false; }
        throw err;
      });
    }
    return editorTask;
  };
  const warmEditor = () => {
    if (!postEditor) return;
    doc.saveDocument().then((raw) => ensureEditorJob(new Uint8Array(raw))).catch(() => {});
  };

  const applyReplace = async () => {
    if (replaceBusy || !pendingReplace) return;
    const next = field.value;
    if (!next.trim() || (next === pendingReplace.text && !styleDirty && !colorTouched)) {
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
    replaceBusy = true;
    applyBtn.disabled = true;
    try {
      const bytes = await doc.saveDocument();
      const ready = editorReady && editorTask && editorSig === byteSig(bytes);
      if (!ready) setJobProgress(18, "Sayfa hazırlanıyor…");
      const jobId = await ensureEditorJob(bytes, ready ? null : (fraction) => setJobProgress(22 + Math.round(fraction * 48), "Sayfa okunuyor…"));
      setJobProgress(74, "Seçilen yazı bulunuyor…");
      const page = await options.engineGet(`/api/v1/convert/pdf/text-editor/page/${jobId}/${pageNumber}`);
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
      const rebuilt = await writeEditor(`/api/v1/convert/pdf/text-editor/partial/${jobId}`, { pages: [page] });
      setJobProgress(94, "Sayfa yenileniyor…");
      const shown = await showEditedDocument(rebuilt, pageNumber, pdfViewer.currentScaleValue);
      if (!shown) return;
      markDirty(true);
      hideReplace();
      warmEditor();
      setJobProgress(100, "Metin yazıldı");
      statusMode.textContent = "Metin belgenin yazısına işlendi. Kaydet ile dosyaya yazın.";
    } catch (err) {
      hideReplace();
      const message = options.errorText ? options.errorText(err) : String((err && err.message) || err || "Metin yazılamadı.");
      window.alert(message);
    } finally {
      replaceBusy = false;
      applyBtn.disabled = !pendingReplace;
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
  let regionMode = false;
  let regionOcrTried = false;
  let regionBusy = false;
  const regionNodes = [];
  const clearRegions = () => {
    regionNodes.splice(0).forEach((node) => node.remove());
  };
  const foundFromSpans = (pageEl, spans) => {
    if (!spans.length) return null;
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!pageNumber || !view || !view.getPagePoint) return null;
    const originEl = pageEl.querySelector(".canvasWrapper") || pageEl.querySelector("canvas") || pageEl;
    const origin = originEl.getBoundingClientRect();
    const lines = [];
    spans.slice().sort((a, b) => a.top - b.top || a.left - b.left).forEach((span) => {
      const line = lines.find((entry) => sameBand(entry[0], span));
      if (line) line.push(span);
      else lines.push([span]);
    });
    lines.forEach((line) => line.sort((a, b) => a.left - b.left));
    const pad = Math.max(2, (spans[0].height || 12) * 0.12);
    const boxes = lines.map((line) => padBox(unionSpan(line), pad));
    const value = lines.map((line) => line.map((item) => item.text).join("")).join("\n").trim();
    if (!value) return null;
    const toPdf = (x, y) => view.getPagePoint(x - origin.left, y - origin.top);
    const pdfOf = (box) => {
      const a = toPdf(box.left, box.top);
      const b = toPdf(box.right, box.bottom);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    return {
      text: value,
      pageNumber,
      pageEl,
      originEl,
      view,
      boxes,
      pdfRects: boxes.map(pdfOf),
      wrapWidth: Math.max(...boxes.map((box) => box.width)),
    };
  };
  const loadPageRuns = async (pageNumber) => {
    if (textRuns.has(pageNumber)) return textRuns.get(pageNumber);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const vt = viewport.transform;
    const runs = [];
    for (const item of content.items || []) {
      const text = item && typeof item.str === "string" ? item.str : "";
      if (!text.trim() || !item.transform) continue;
      const m = item.transform;
      const tx = [
        vt[0] * m[0] + vt[2] * m[1],
        vt[1] * m[0] + vt[3] * m[1],
        vt[0] * m[2] + vt[2] * m[3],
        vt[1] * m[2] + vt[3] * m[3],
        vt[0] * m[4] + vt[2] * m[5] + vt[4],
        vt[1] * m[4] + vt[3] * m[5] + vt[5],
      ];
      const fontSize = Math.max(0.8, Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 8);
      const userScale = Math.max(Math.hypot(vt[0], vt[1]), 0.01);
      const width = Math.max((Number(item.width) || 0) * userScale, text.trim().length * fontSize * 0.45);
      const left = tx[4];
      const top = tx[5] - fontSize * 0.8;
      const height = fontSize;
      runs.push({ text, left, top, right: left + width, bottom: top + height, width, height });
    }
    const packed = {
      width: viewport.width,
      height: viewport.height,
      runs,
      chars: runs.reduce((sum, run) => sum + run.text.trim().length, 0),
    };
    textRuns.set(pageNumber, packed);
    return packed;
  };
  const pageScreenSpans = (pageEl) => {
    const painted = textSpans(pageEl);
    if (painted.length) return dedupeSpans(painted);
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const packed = textRuns.get(pageNumber);
    const canvas = pageEl.querySelector("canvas");
    if (!packed || !canvas) return [];
    const canvasBox = canvas.getBoundingClientRect();
    if (canvasBox.width < 8 || !packed.width || !packed.height) return [];
    const sx = canvasBox.width / packed.width;
    const sy = canvasBox.height / packed.height;
    return dedupeSpans(packed.runs.map((run) => ({
      text: run.text,
      left: canvasBox.left + run.left * sx,
      top: canvasBox.top + run.top * sy,
      width: Math.max(4, run.width * sx),
      height: Math.max(4, run.height * sy),
      right: canvasBox.left + run.right * sx,
      bottom: canvasBox.top + run.bottom * sy,
    })));
  };
  const paintRegions = () => {
    clearRegions();
    if (!regionMode) return;
    stage.querySelectorAll(".page").forEach((pageEl) => {
      const pageBox = pageEl.getBoundingClientRect();
      if (pageBox.width < 8) return;
      clusterTextBlocks(pageScreenSpans(pageEl), false).forEach((block) => {
        const node = document.createElement("div");
        node.className = "edit-region";
        node.style.left = (block.left - pageBox.left) + "px";
        node.style.top = (block.top - pageBox.top) + "px";
        node.style.width = block.width + "px";
        node.style.height = block.height + "px";
        node.title = block.spans.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
        const open = (event) => {
          if (replaceBusy) return;
          event.preventDefault();
          event.stopPropagation();
          const current = pageEl.getBoundingClientRect();
          const box = {
            left: current.left + parseFloat(node.style.left),
            top: current.top + parseFloat(node.style.top),
            width: parseFloat(node.style.width),
            height: parseFloat(node.style.height),
          };
          box.right = box.left + box.width;
          box.bottom = box.top + box.height;
          const inside = pageScreenSpans(pageEl).filter((span) =>
            span.left < box.right && span.right > box.left && span.top < box.bottom && span.bottom > box.top);
          const found = foundFromSpans(pageEl, inside.length ? inside : block.spans);
          if (!found) return;
          regionNodes.forEach((item) => item.classList.remove("selected"));
          node.classList.add("selected");
          showReplace(found);
        };
        node.addEventListener("mousedown", open);
        node.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
        pageEl.appendChild(node);
        regionNodes.push(node);
      });
    });
  };
  const recognizePage = async (pageNumber) => {
    const bytes = await doc.saveDocument();
    const form = new FormData();
    form.append("fileInput", new File([bytes], "belge.pdf", { type: "application/pdf" }));
    form.append("languages", "tur");
    form.append("languages", "eng");
    form.append("ocrType", "skip-text");
    form.append("rotatePages", "true");
    form.append("ocrRenderType", "hocr");
    form.append("deskew", "false");
    form.append("clean", "false");
    form.append("cleanFinal", "false");
    form.append("sidecar", "false");
    form.append("removeImagesAfter", "false");
    const recognized = await (options.engineQuiet || options.engine)("/api/v1/misc/ocr-pdf", form);
    return showEditedDocument(recognized, pageNumber, pdfViewer.currentScaleValue);
  };
  const enterRegions = async () => {
    if (formMode) setFormMode(false);
    hideAdd();
    root.classList.remove("text-placing");
    try { pdfViewer.annotationEditorMode = { mode: pdfjs.AnnotationEditorType.NONE }; } catch { /* ignore */ }
    markButtons.forEach((node) => node.classList.remove("active"));
    textFont.hidden = true;
    textBold.hidden = true;
    textItalic.hidden = true;
    textSize.hidden = true;
    textColor.hidden = true;
    regionMode = true;
    root.classList.add("is-editing");
    const pageNumber = pdfViewer.currentPageNumber || 1;
    let packed = { chars: 0, runs: [] };
    try {
      packed = await loadPageRuns(pageNumber);
    } catch {
      packed = { chars: 0, runs: [], width: 1, height: 1 };
      textRuns.set(pageNumber, packed);
    }
    if (!regionMode) return;
    paintRegions();
    const ready = () => {
      statusMode.textContent = "Kesik çizgili alan yazının kendisidir. Tıklayınca orada değişir; başka yere tıklayınca yazılır.";
      warmEditor();
    };
    if (regionNodes.length) {
      ready();
      return;
    }
    if (packed.chars > 0) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = (evt) => {
          if (evt && evt.pageNumber && evt.pageNumber !== pageNumber) return;
          if (settled) return;
          settled = true;
          eventBus.off("pagerendered", finish);
          resolve();
        };
        eventBus.on("pagerendered", finish);
        setTimeout(finish, 1500);
      });
      if (!regionMode) return;
      paintRegions();
      if (regionNodes.length) ready();
      else statusMode.textContent = "Yazı sayfada var. Sayfa çizilince kesik alanlar görünecek.";
      return;
    }
    const pageEl = stage.querySelector(`.page[data-page-number="${pageNumber}"]`);
    let noted = false;
    if (pageEl && !regionOcrTried) {
      if (!options.engine) {
        noted = true;
        statusMode.textContent = "Bu sayfada seçilebilir yazı yok. Tanıma için yerel motor hazır olmalı.";
      } else {
        regionOcrTried = true;
        setJobProgress(12, "Taranmış sayfa tanınıyor…");
        try {
          const shown = await recognizePage(pageNumber);
          if (shown) {
            markDirty(true);
            setJobProgress(100, "Yazı tanındı");
          }
        } catch (err) {
          regionOcrTried = false;
          noted = true;
          const message = options.errorText ? options.errorText(err) : String((err && err.message) || err || "Yazı tanınamadı.");
          statusMode.textContent = message;
        } finally {
          setTimeout(hideJobProgress, 700);
        }
      }
    }
    if (!regionMode) return;
    if (!textRuns.has(pageNumber)) await loadPageRuns(pageNumber);
    paintRegions();
    if (regionNodes.length) ready();
    else if (!noted) statusMode.textContent = "Bu sayfada düzenlenebilir yazı alanı bulunamadı.";
  };
  leaveRegions = () => {
    if (!regionMode) return;
    regionMode = false;
    root.classList.remove("is-editing");
    clearRegions();
    hideReplace();
  };
  let formListToken = 0;
  const fieldKindLabel = (kind) => ({
    text: "Metin", checkbox: "Onay", radiobutton: "Seçim", combobox: "Liste", listbox: "Liste", button: "Düğme", signature: "İmza",
  }[String(kind || "").toLowerCase()] || "Alan");
  const refreshFormList = async () => {
    const token = ++formListToken;
    formList.replaceChildren(el("li", "viewer-form-wait", t("Alanlar okunuyor…")));
    formEmpty.hidden = true;
    const rows = [];
    try {
      for (let number = 1; number <= doc.numPages; number += 1) {
        const page = await doc.getPage(number);
        const annots = await page.getAnnotations();
        annots.forEach((ann) => {
          if (!ann.fieldName) return;
          rows.push({ name: ann.fieldName, page: number, kind: fieldKindLabel(ann.fieldType) });
        });
      }
    } catch { /* the empty state stays */ }
    if (token !== formListToken || viewerMode !== "form") return;
    sideTitle.textContent = `${t("Form Alanı Listesi")} (${rows.length})`;
    formList.replaceChildren();
    formEmpty.hidden = rows.length > 0;
    rows.forEach((row) => {
      const item = el("li", "viewer-form-item");
      item.append(el("strong", null, row.name), el("span", null, `${row.kind} · ${row.page}`));
      formList.appendChild(item);
    });
  };
  setViewerMode = async (mode) => {
    if (regionBusy && mode === "edit") return;
    if (taskPane.dataset.open === "1") closeTask();
    applyViewerChrome(mode);
    if (mode === "edit") {
      if (formMode) setFormMode(false);
      regionBusy = true;
      try { await enterRegions(); } finally { regionBusy = false; }
      return;
    }
    if (mode === "form") {
      leaveRegions();
      setFormMode(true);
      refreshFormList();
      return;
    }
    if (mode === "shapes") {
      if (formMode) setFormMode(false);
      leaveRegions();
      try { pdfViewer.annotationEditorMode = { mode: pdfjs.AnnotationEditorType.NONE }; } catch { /* ignore */ }
      markButtons.forEach((node) => node.classList.remove("active"));
      root.classList.add("is-shaping");
      root.classList.toggle("is-erasing", shapeTool === "eraser");
      root.classList.toggle("is-selecting", shapeTool === "select");
      statusMode.textContent = t(shapeTool === "select"
        ? "Bir şekle tıklayın. Rengi veya biçimini şeritten değiştirin."
        : "Şekli sürükleyerek çizin. Silgi kaldırır. Kaydet ile PDF'e yazılır.");
      return;
    }
    root.classList.remove("is-shaping", "is-erasing", "is-selecting");
    if (formMode) setFormMode(false);
    leaveRegions();
    if (mode === "note" && markButtons.some((node) => node.classList.contains("active"))) return;
    setMark(MARKS[0]);
  };
  if (pendingViewerMode) {
    const queued = pendingViewerMode;
    pendingViewerMode = null;
    setViewerMode(queued);
  }
  eventBus.on("textlayerrendered", (evt) => {
    if (!regionMode) return;
    const number = evt && evt.pageNumber;
    const draw = () => {
      paintRegions();
      if (regionNodes.length) statusMode.textContent = "Kesik çizgili alan yazının kendisidir. Tıklayınca orada değişir; başka yere tıklayınca yazılır.";
    };
    if (!number || textRuns.has(number)) draw();
    else loadPageRuns(number).then(draw);
  });
  applyBtn.hidden = true;
  applyBtn.onclick = () => applyReplace();
  cancelBtn.addEventListener("pointerdown", (event) => event.preventDefault());
  cancelBtn.onclick = hideReplace;
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); applyReplace(); }
    if (event.key === "Escape") { event.preventDefault(); hideReplace(); }
  });
  field.addEventListener("focusout", (event) => {
    if (replaceBusy || !pendingReplace) return;
    const next = event.relatedTarget;
    if (next && (side.contains(next) || next === field || next === cancelBtn)) return;
    applyReplace();
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
    const height = Math.max(36, size * (pdfViewer.currentScale || 1) * 1.8);
    const width = 240;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - 56);
    addField.style.position = "fixed";
    addActions.style.position = "fixed";
    addField.style.left = Math.min(Math.max(margin, clientX), maxLeft) + "px";
    addField.style.top = Math.min(Math.max(margin, clientY), maxTop) + "px";
    addField.style.width = width + "px";
    addField.style.height = height + "px";
    addField.style.zIndex = "100";
    paintAddFont();
    addField.hidden = false;
    document.body.appendChild(addField);
    addActions.style.left = addField.style.left;
    addActions.style.top = (parseFloat(addField.style.top) + height + 6) + "px";
    addActions.style.zIndex = "100";
    addActions.hidden = false;
    document.body.appendChild(addActions);
    addField.focus();
  };

  let addBusy = false;
  const applyAdd = async () => {
    if (addBusy) return;
    if (!addDraft) {
      statusMode.textContent = t("Önce sayfada metnin duracağı yere tıklayın.");
      return;
    }
    const next = addField.value.replace(/\s+$/g, "");
    if (!next.trim()) {
      statusMode.textContent = t("Eklenecek metin boş.");
      return;
    }
    if (!options.engine || !options.engineGet || !options.engineJson) {
      window.alert("Metin eklemek için yerel motor hazır olmalı.");
      return;
    }
    const { pageNumber, x, y } = addDraft;
    const chosen = chosenAddFont();
    const size = chosenAddSize();
    addBusy = true;
    addApply.disabled = true;
    try {
      const bytes = await doc.saveDocument();
      const ready = editorReady && editorTask && editorSig === byteSig(bytes);
      if (!ready) setJobProgress(18, "Sayfa hazırlanıyor…");
      const jobId = await ensureEditorJob(bytes, ready ? null : (fraction) => setJobProgress(22 + Math.round(fraction * 48), "Sayfa okunuyor…"));
      setJobProgress(74, "Metin ekleniyor…");
      const page = await options.engineGet(`/api/v1/convert/pdf/text-editor/page/${jobId}/${pageNumber}`);
      page.textElements = page.textElements || [];
      const fill = fillColorOf(textColor.value);
      const width = Math.max(40, 240 / (pdfViewer.currentScale || 1));
      const wrapped = wrapPdfLines(next, size, width, chosen);
      const pageView = pdfViewer.getPageView(pageNumber - 1);
      const viewBox = pageView && pageView.viewport ? pageView.viewport.viewBox : null;
      const minY = viewBox ? Math.min(viewBox[1], viewBox[3]) : 0;
      const maxY = viewBox ? Math.max(viewBox[1], viewBox[3]) : y + size;
      wrapped.forEach((line, index) => {
        const baseline = Math.min(maxY - size * 0.3, Math.max(minY + size, y - index * size * 1.25));
        const element = {
          text: line,
          fontId: chosen.stirling || "fallback-liberation-sans",
          fontSize: size,
          fontMatrixSize: size,
          fontSizeInPt: size,
          spaceWidth: size * 0.28,
          width: Math.max(size, line.length * size * 0.52),
          height: size * 0.7,
          x,
          y: baseline,
          zOrder: 2100000 + index,
          textMatrix: [size, 0, 0, size, x, baseline],
          fallbackUsed: true,
        };
        if (fill) element.fillColor = fill;
        page.textElements.push(element);
      });
      if (page.pageNumber == null) page.pageNumber = pageNumber;
      setJobProgress(86, "Yazı belgeye işleniyor…");
      const rebuilt = await writeEditor(`/api/v1/convert/pdf/text-editor/partial/${jobId}`, { pages: [page] });
      setJobProgress(94, "Sayfa yenileniyor…");
      const shown = await showEditedDocument(rebuilt, pageNumber, pdfViewer.currentScaleValue);
      if (!shown) return;
      markDirty(true);
      hideAdd();
      warmEditor();
      setJobProgress(100, "Metin eklendi");
      const written = await doc.getPage(pageNumber).then((page) => page.getTextContent()).catch(() => null);
      const flat = written ? written.items.map((item) => String(item.str || "")).join("").replace(/\s+/g, "") : "";
      const probe = next.replace(/\s+/g, "").slice(0, 12);
      if (probe && /^[\u0000-\u007F]+$/.test(probe) && !flat.includes(probe)) {
        statusMode.textContent = t("Metin belgeye işlenemedi. Sayfa yenilendi ama yazı görünmüyor.");
        window.alert(t("Metin belgeye işlenemedi. Sayfa yenilendi ama yazı görünmüyor."));
      } else {
        statusMode.textContent = "Metin seçilen yazı tipiyle sayfaya yazıldı. Kaydet ile dosyaya yazın.";
      }
    } catch (err) {
      const message = options.errorText ? options.errorText(err) : String((err && err.message) || err || "Metin eklenemedi.");
      window.alert(message);
    } finally {
      addBusy = false;
      addApply.disabled = false;
      setTimeout(hideJobProgress, 700);
    }
  };

  const boxContains = (node, event) => {
    if (!node || node.hidden) return false;
    const rect = node.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  stage.addEventListener("mousedown", (event) => {
    if (activeMark.mode !== pdfjs.AnnotationEditorType.FREETEXT || event.button !== 0) return;
    if (event.target.closest && event.target.closest("textarea, button, .replace-actions, .form-actions, .form-draft, .viewer-menu")) return;
    if (boxContains(addField, event) || boxContains(addActions, event)) return;
    const pageEl = event.target.closest && event.target.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return;
    event.preventDefault();
    openAddText(pageEl, event.clientX, event.clientY);
  });
  const keepPopupClick = (node) => {
    node.addEventListener("mousedown", (event) => event.stopPropagation());
    node.addEventListener("pointerdown", (event) => event.stopPropagation());
  };
  keepPopupClick(addField);
  keepPopupClick(addActions);
  keepPopupClick(field);
  const onApplyAdd = (event) => {
    event.preventDefault();
    event.stopPropagation();
    applyAdd();
  };
  addApply.addEventListener("pointerdown", onApplyAdd);
  addApply.addEventListener("click", onApplyAdd);
  addCancel.onclick = () => hideAdd();
  addField.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); applyAdd(); }
    if (event.key === "Escape") { event.preventDefault(); hideAdd(); }
  });

  const menu = el("div", "viewer-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  root.appendChild(menu);
  hideMenu = () => {
    if (menu.hidden) return false;
    menu.hidden = true;
    menu.replaceChildren();
    return true;
  };
  const openMenu = (x, y, items) => {
    menu.replaceChildren();
    items.forEach((item) => {
      const node = el("button", null, t(item.label));
      node.type = "button";
      node.disabled = Boolean(item.disabled);
      const run = (event) => {
        if (node.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        hideMenu();
        item.run();
      };
      if (item.keepSelection) node.addEventListener("pointerdown", run);
      else node.onclick = run;
      menu.appendChild(node);
    });
    menu.hidden = false;
    const width = 240;
    const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 48));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  };
  openTask = (toolId) => {
    if (!options.onTask || !toolId) return;
    taskToken += 1;
    const token = taskToken;
    taskPane.dataset.open = "1";
    taskPane.hidden = false;
    side.hidden = true;
    taskBody.replaceChildren();
    taskTitle.textContent = "";
    options.onTask(toolId, {
      host: taskBody,
      alive: () => token === taskToken && sessionAlive(current),
      setTitle: (text) => { taskTitle.textContent = text; },
      currentFile: () => readCurrentFile(),
      pageCount: () => (doc ? doc.numPages : 0),
      adopt: (bytes) => adoptDocument(bytes),
      save: (bytes, fileName) => (options.onSave ? options.onSave(bytes, fileName) : null),
      close: closeTask,
      busy: (on, label) => { if (on) setJobProgress(45, label || "İşleniyor…"); else hideJobProgress(); },
    });
  };
  openCommandMenu = (id, x, y) => {
    const runTool = (toolId) => () => openTask(toolId);
    if (id === "pages") {
      openMenu(x, y, pageTools.map((tool) => ({ label: tool.title, run: runTool(tool.id) })));
    } else if (id === "convert") {
      openMenu(x, y, convertTools.map((tool) => ({ label: tool.title, run: runTool(tool.id) })));
    } else if (id === "sign") {
      openMenu(x, y, signTools.map((tool) => ({ label: tool.title, run: runTool(tool.id) })));
    } else if (id === "add") {
      openMenu(x, y, [
        { label: "Görsel ekle", run: () => pickImage(Math.max(0, (pdfViewer.currentPageNumber || 1) - 1), null, null) },
        { label: "Damga", run: runTool("add-stamp") },
        { label: "Ek dosya ekle", run: runTool("add-attachments") },
      ]);
    }
  };
  showToolMatches = () => {
    const query = toolFind.value.trim().toLocaleLowerCase("tr");
    if (!query || !options.onTask) {
      hideMenu();
      return;
    }
    const hits = toolCatalog.filter((tool) => tool.title.toLocaleLowerCase("tr").includes(query)).slice(0, 12);
    const rect = toolFind.getBoundingClientRect();
    if (!hits.length) {
      hideMenu();
      return;
    }
    openMenu(rect.left, rect.bottom + 4, hits.map((tool) => ({
      label: tool.title,
      run: () => {
        if (tool.id === "add-image") {
          pickImage(Math.max(0, (pdfViewer.currentPageNumber || 1) - 1), null, null);
          return;
        }
        if (tool.id === "add-form-fields" || tool.id === "fill-forms") {
          setViewerMode("form");
          return;
        }
        openTask(tool.id);
      },
    })));
  };
  const imageInput = el("input");
  imageInput.type = "file";
  imageInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
  imageInput.hidden = true;
  root.appendChild(imageInput);
  let imageTarget = null;
  const placeImage = async (file, pageIndex, clientX, clientY) => {
    const layer = editorUi && editorUi.getLayer(pageIndex);
    if (!layer || !layer.div) {
      window.alert(t("Bu sayfa henüz çizilmedi. Sayfayı görüntüleyip yeniden deneyin."));
      return;
    }
    const rect = layer.div.getBoundingClientRect();
    const x = clientX == null ? rect.width / 2 : clientX - rect.left;
    const y = clientY == null ? rect.height / 2 : clientY - rect.top;
    try {
      await layer.pasteEditor(
        { mode: pdfjs.AnnotationEditorType.STAMP },
        { bitmapFile: file, x, y, isCentered: true },
      );
      markDirty(true);
      statusMode.textContent = t("Görsel sayfaya eklendi. Kaydet ile dosyaya yazın.");
    } catch {
      window.alert(t("Görsel eklenemedi."));
    }
  };
  pickImage = (pageIndex, clientX, clientY) => {
    imageTarget = { pageIndex, clientX, clientY };
    imageInput.value = "";
    imageInput.click();
  };
  imageInput.onchange = () => {
    const file = imageInput.files && imageInput.files[0];
    const target = imageTarget;
    imageTarget = null;
    if (file && target) placeImage(file, target.pageIndex, target.clientX, target.clientY);
  };
  const markOf = (mode) => MARKS.find((mark) => mark.mode === mode) || MARKS[0];
  const onHighlightPointer = (event) => {
    const button = event.target.closest && event.target.closest(".editToolbar .highlightButton");
    if (!button || !root.contains(button) || !editorUi) return;
    try { editorUi.highlightSelection("floating_button"); } catch { /* the selection was already used */ }
  };
  document.addEventListener("pointerdown", onHighlightPointer, true);
  stage.addEventListener("contextmenu", (event) => {
    const pageEl = event.target.closest && event.target.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return;
    event.preventDefault();
    const pageIndex = Math.max(0, Number(pageEl.dataset.pageNumber) - 1);
    const selected = window.getSelection();
    const hasText = Boolean(selected && !selected.isCollapsed && String(selected).trim());
    openMenu(event.clientX, event.clientY, [
      {
        label: "Vurgula",
        keepSelection: true,
        run: () => {
          if (hasText && editorUi) {
            leaveRegions();
            try { editorUi.highlightSelection("context_menu"); } catch { /* the tool below still turns highlight on */ }
            return;
          }
          setViewerMode("note").then(() => {
            activeMark = markOf(pdfjs.AnnotationEditorType.HIGHLIGHT);
            setMark(activeMark);
            statusMode.textContent = t("Metni seçin veya sürükleyerek vurgulayın.");
          });
        },
      },
      {
        label: "Metin ekle",
        run: () => {
          setViewerMode("note").then(() => {
            activeMark = markOf(pdfjs.AnnotationEditorType.FREETEXT);
            setMark(activeMark);
            openAddText(pageEl, event.clientX, event.clientY);
          });
        },
      },
      { label: "Görsel ekle", run: () => pickImage(pageIndex, event.clientX, event.clientY) },
      {
        label: "Kopyala",
        keepSelection: true,
        disabled: !hasText,
        run: () => {
          const text = String(window.getSelection() || "");
          if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        },
      },
      { label: "Yakınlaştır", run: () => pdfViewer.increaseScale() },
      { label: "Uzaklaştır", run: () => pdfViewer.decreaseScale() },
      { label: "Genişliğe sığdır", run: () => { pdfViewer.currentScaleValue = "page-width"; } },
      { label: "Sayfaya sığdır", run: () => { pdfViewer.currentScaleValue = "page-fit"; } },
    ]);
  });
  const onMenuDismiss = (event) => {
    if (menu.hidden) return;
    if (event.target.closest && event.target.closest(".viewer-menu")) return;
    hideMenu();
  };
  document.addEventListener("pointerdown", onMenuDismiss, true);
  stage.addEventListener("scroll", () => hideMenu());

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

  const shapes = [];
  let shapeSeq = 1;
  const shapeUndo = [];
  const shapeRedo = [];
  let shapeDrag = null;
  let shapeDraft = null;
  const shapeStatus = "Şekli sürükleyerek çizin. Silgi kaldırır. Kaydet ile PDF'e yazılır.";
  const snapshotShapes = () => JSON.stringify({ shapes, selectedShapeId });
  const restoreShapes = (raw) => {
    const parsed = JSON.parse(raw);
    const next = Array.isArray(parsed) ? parsed : parsed.shapes;
    shapes.splice(0, shapes.length, ...next);
    selectedShapeId = Array.isArray(parsed) ? selectedShapeId : parsed.selectedShapeId;
  };
  const selectedShape = () => shapes.find((shape) => shape.id === selectedShapeId) || null;
  const rememberShapes = () => {
    shapeUndo.push(snapshotShapes());
    if (shapeUndo.length > 50) shapeUndo.shift();
    shapeRedo.length = 0;
    markDirty(true);
  };
  const syncShapeSelection = () => {
    const selected = selectedShape();
    if (!selected) selectedShapeId = null;
    else {
      shapeColorValue = selected.color;
      shapeColor.value = selected.color;
    }
    shapeSelectBtn.classList.toggle("active", shapeTool === "select");
    shapeButtons.forEach((node, index) => {
      const kind = shapeKinds[index][0];
      node.classList.toggle("active", shapeTool === kind);
      node.classList.toggle("picked", !!(selected && shapeTool === "select" && selected.kind === kind));
    });
    shapeEraseBtn.classList.toggle("active", shapeTool === "eraser");
    root.classList.toggle("is-erasing", viewerMode === "shapes" && shapeTool === "eraser");
    root.classList.toggle("is-selecting", viewerMode === "shapes" && shapeTool === "select");
  };
  undoShape = () => {
    if (!shapeUndo.length) return;
    shapeRedo.push(snapshotShapes());
    restoreShapes(shapeUndo.pop());
    syncShapeSelection();
    paintShapes();
    markDirty(true);
  };
  redoShape = () => {
    if (!shapeRedo.length) return;
    shapeUndo.push(snapshotShapes());
    restoreShapes(shapeRedo.pop());
    syncShapeSelection();
    paintShapes();
    markDirty(true);
  };
  chooseShape = (id) => {
    const selected = selectedShape();
    if (selected && shapeTool === "select" && id !== "select" && id !== "eraser") {
      if (selected.kind !== id) {
        rememberShapes();
        const pageEl = stage.querySelector(`.page[data-page-number="${selected.page}"]`);
        const rebuilt = pageEl && selected.from && selected.to ? pathsFromEnds(pageEl, id, selected.from, selected.to) : null;
        if (rebuilt && rebuilt.length) {
          selected.kind = id;
          selected.paths = rebuilt;
        }
        paintShapes();
      }
      syncShapeSelection();
      statusMode.textContent = t("Seçili şeklin rengini veya biçimini şeritten değiştirin.");
      return;
    }
    shapeTool = id;
    if (id !== "select") selectedShapeId = null;
    syncShapeSelection();
    if (viewerMode !== "shapes") return;
    statusMode.textContent = t(id === "select"
      ? "Bir şekle tıklayın. Rengi veya biçimini şeritten değiştirin."
      : shapeStatus);
  };
  shapeColor.addEventListener("pointerdown", () => {
    if (shapeColorUndoArmed || !selectedShape()) return;
    rememberShapes();
    shapeColorUndoArmed = true;
  });
  shapeColor.addEventListener("change", () => { shapeColorUndoArmed = false; });
  shapeColor.oninput = () => {
    shapeColorValue = shapeColor.value;
    const selected = selectedShape();
    if (!selected) return;
    selected.color = shapeColorValue;
    paintShapes();
    markDirty(true);
  };
  const pagePdfPoint = (pageEl, clientX, clientY) => {
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!view || !view.getPagePoint) return null;
    const originEl = pageEl.querySelector(".canvasWrapper") || pageEl.querySelector("canvas") || pageEl;
    const origin = originEl.getBoundingClientRect();
    const point = view.getPagePoint(clientX - origin.left, clientY - origin.top);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    return { page: pageNumber, x: point[0], y: point[1] };
  };
  const clientFromPdf = (pageEl, x, y) => {
    const pageNumber = Number(pageEl.dataset.pageNumber);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (!view || !view.viewport) return null;
    const originEl = pageEl.querySelector(".canvasWrapper") || pageEl.querySelector("canvas") || pageEl;
    const origin = originEl.getBoundingClientRect();
    const vp = view.viewport.convertToViewportPoint(x, y);
    return { x: origin.left + vp[0], y: origin.top + vp[1] };
  };
  const pathsFromEnds = (pageEl, kind, from, to) => {
    const a = clientFromPdf(pageEl, from.x, from.y);
    const b = clientFromPdf(pageEl, to.x, to.y);
    if (!a || !b) return null;
    return shapePaths(kind, a, b).map((path) => ({
      close: !!path.close,
      fill: !!path.fill,
      points: path.points.flatMap((point) => {
        const pdf = pagePdfPoint(pageEl, point.x, point.y);
        return pdf ? [pdf.x, pdf.y] : [];
      }),
    })).filter((path) => path.points.length >= 4);
  };
  const paintShapes = () => {
    stage.querySelectorAll(".page").forEach((pageEl) => {
      let layer = pageEl.querySelector(":scope > .shape-layer");
      if (!layer) {
        layer = document.createElementNS(SVG_NS, "svg");
        layer.classList.add("shape-layer");
        pageEl.appendChild(layer);
      }
      const pageNumber = Number(pageEl.dataset.pageNumber);
      const view = pdfViewer.getPageView(pageNumber - 1);
      const canvas = pageEl.querySelector("canvas");
      const pageBox = pageEl.getBoundingClientRect();
      layer.setAttribute("viewBox", `0 0 ${Math.max(1, pageBox.width)} ${Math.max(1, pageBox.height)}`);
      layer.replaceChildren();
      if (!view || !view.viewport || !canvas || pageBox.width < 8) return;
      const canvasBox = canvas.getBoundingClientRect();
      const ox = canvasBox.left - pageBox.left;
      const oy = canvasBox.top - pageBox.top;
      const strokePx = SHAPE_STROKE * (canvasBox.width / Math.max(1, view.viewport.width));
      const draw = (points, color, width, close, fill, id) => {
        if (!points || points.length < 2) return;
        const node = document.createElementNS(SVG_NS, fill || close ? "polygon" : "polyline");
        node.setAttribute("points", points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "));
        node.setAttribute("fill", fill ? color : "none");
        node.setAttribute("stroke", color);
        node.setAttribute("stroke-width", String(Math.max(1.25, width)));
        node.setAttribute("stroke-linejoin", "round");
        node.setAttribute("stroke-linecap", "round");
        node.style.pointerEvents = fill ? "all" : "stroke";
        if (id != null) {
          node.dataset.shape = String(id);
          const hit = document.createElementNS(SVG_NS, "polyline");
          hit.setAttribute("points", node.getAttribute("points"));
          hit.setAttribute("fill", "none");
          hit.setAttribute("stroke", "transparent");
          hit.setAttribute("stroke-width", "14");
          hit.style.pointerEvents = "stroke";
          hit.dataset.shape = String(id);
          layer.appendChild(hit);
        }
        layer.appendChild(node);
      };
      shapes.filter((shape) => shape.page === pageNumber).forEach((shape) => {
        const bounds = [];
        shape.paths.forEach((path) => {
          const pts = [];
          for (let i = 0; i + 1 < path.points.length; i += 2) {
            const vp = view.viewport.convertToViewportPoint(path.points[i], path.points[i + 1]);
            pts.push([ox + vp[0], oy + vp[1]]);
          }
          pts.forEach((point) => bounds.push(point));
          draw(pts, shape.color, strokePx, path.close, path.fill, shape.id);
        });
        if (shape.id === selectedShapeId && bounds.length) {
          const left = Math.min(...bounds.map((point) => point[0])) - 4;
          const top = Math.min(...bounds.map((point) => point[1])) - 4;
          const right = Math.max(...bounds.map((point) => point[0])) + 4;
          const bottom = Math.max(...bounds.map((point) => point[1])) + 4;
          const box = document.createElementNS(SVG_NS, "rect");
          box.setAttribute("x", String(left));
          box.setAttribute("y", String(top));
          box.setAttribute("width", String(Math.max(1, right - left)));
          box.setAttribute("height", String(Math.max(1, bottom - top)));
          box.setAttribute("fill", "none");
          box.setAttribute("stroke", "#2563eb");
          box.setAttribute("stroke-width", "1.5");
          box.setAttribute("stroke-dasharray", "4 3");
          box.style.pointerEvents = "none";
          layer.appendChild(box);
        }
      });
      if (shapeDraft && shapeDraft.page === pageNumber) {
        shapeDraft.paths.forEach((path) => {
          draw(path.points.map((point) => [point.x - pageBox.left, point.y - pageBox.top]), shapeColorValue, Math.max(1.25, strokePx), path.close, path.fill, null);
        });
      }
    });
  };
  readCurrentFile = async () => {
    let bytes = await doc.saveDocument();
    if (shapes.length && options.addShapes) {
      bytes = await options.addShapes(bytes, shapes.slice());
      shapes.splice(0, shapes.length);
      selectedShapeId = null;
      paintShapes();
    }
    const label = (name.textContent || "belge").trim() || "belge";
    const fileName = /\.pdf$/i.test(label) ? label : label + ".pdf";
    return new File([bytes], fileName, { type: "application/pdf" });
  };
  adoptDocument = async (bytes) => {
    const page = pdfViewer.currentPageNumber || 1;
    const scale = pdfViewer.currentScaleValue;
    const ok = await showEditedDocument(bytes, page, scale);
    if (ok) markDirty(true);
    return ok;
  };
  const onShapeDown = (event) => {
    if (viewerMode !== "shapes" || event.button !== 0) return;
    if (event.target.closest && event.target.closest("button, input, textarea, select, .viewer-menu, .viewer-chrome")) return;
    const pageEl = event.target.closest && event.target.closest(".page");
    if (!pageEl || !root.contains(pageEl)) return;
    if (shapeTool === "select" || shapeTool === "eraser") {
      const hit = event.target.closest && event.target.closest("[data-shape]");
      const id = hit ? Number(hit.dataset.shape) : null;
      const index = shapes.findIndex((shape) => shape.id === id);
      event.preventDefault();
      event.stopPropagation();
      if (shapeTool === "eraser") {
        if (index < 0) return;
        rememberShapes();
        if (selectedShapeId === id) selectedShapeId = null;
        shapes.splice(index, 1);
        syncShapeSelection();
        paintShapes();
        return;
      }
      selectedShapeId = index >= 0 ? id : null;
      syncShapeSelection();
      paintShapes();
      statusMode.textContent = t(selectedShapeId
        ? "Seçili şeklin rengini veya biçimini şeritten değiştirin."
        : "Bir şekle tıklayın. Rengi veya biçimini şeritten değiştirin.");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    shapeDrag = { pageEl, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    try { pageEl.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  const onShapeMove = (event) => {
    if (!shapeDrag || event.pointerId !== shapeDrag.pointer) return;
    shapeDraft = {
      page: Number(shapeDrag.pageEl.dataset.pageNumber),
      paths: shapePaths(shapeTool, { x: shapeDrag.x, y: shapeDrag.y }, { x: event.clientX, y: event.clientY }),
    };
    paintShapes();
  };
  const onShapeUp = (event) => {
    if (!shapeDrag || (event.pointerId != null && event.pointerId !== shapeDrag.pointer)) return;
    const start = shapeDrag;
    shapeDrag = null;
    shapeDraft = null;
    const end = { x: event.clientX, y: event.clientY };
    const boxed = shapeTool === "rect" || shapeTool === "ellipse" || shapeTool === "pentagon" || shapeTool === "cloud";
    const tooSmall = boxed
      ? Math.abs(end.x - start.x) < 6 || Math.abs(end.y - start.y) < 6
      : Math.hypot(end.x - start.x, end.y - start.y) < 6;
    if (tooSmall) {
      paintShapes();
      return;
    }
    const from = pagePdfPoint(start.pageEl, start.x, start.y);
    const to = pagePdfPoint(start.pageEl, end.x, end.y);
    if (!from || !to) {
      paintShapes();
      return;
    }
    const paths = shapePaths(shapeTool, { x: start.x, y: start.y }, end).map((path) => ({
      close: !!path.close,
      fill: !!path.fill,
      points: path.points.flatMap((point) => {
        const pdf = pagePdfPoint(start.pageEl, point.x, point.y);
        return pdf ? [pdf.x, pdf.y] : [];
      }),
    })).filter((path) => path.points.length >= 4);
    if (!paths.length) {
      paintShapes();
      return;
    }
    rememberShapes();
    shapes.push({
      id: shapeSeq,
      page: from.page,
      kind: shapeTool,
      color: shapeColorValue,
      stroke: SHAPE_STROKE,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      paths,
    });
    shapeSeq += 1;
    paintShapes();
    statusMode.textContent = t(shapeStatus);
  };
  stage.addEventListener("pointerdown", onShapeDown, true);
  stage.addEventListener("pointermove", onShapeMove);
  stage.addEventListener("pointerup", onShapeUp);
  stage.addEventListener("pointercancel", onShapeUp);
  const onShapePaint = () => { if (shapes.length || shapeDraft) paintShapes(); };
  eventBus.on("pagerendered", onShapePaint);
  eventBus.on("scalechanging", onShapePaint);

  current.cleanup = () => {
    document.removeEventListener("mousemove", onFormMove, true);
    document.removeEventListener("mouseup", onFormUp, true);
    document.removeEventListener("pointerdown", onHighlightPointer, true);
    document.removeEventListener("pointerdown", onMenuDismiss, true);
    stage.removeEventListener("pointerdown", onShapeDown, true);
    stage.removeEventListener("pointermove", onShapeMove);
    stage.removeEventListener("pointerup", onShapeUp);
    stage.removeEventListener("pointercancel", onShapeUp);
    eventBus.off("pagerendered", onShapePaint);
    eventBus.off("scalechanging", onShapePaint);
    hideMenu();
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
      if (!sessionAlive(current)) { nextTask.destroy(); return; }
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
      refreshFormList();
      statusMode.textContent = `"${fieldName}" alanı eklendi. Kaydet ile PDF'e yazın.`;
    } catch (err) {
      window.alert(String(err && err.message || err || "Form alanı eklenemedi."));
    } finally {
      if (work) work.end();
      addFieldBtn.disabled = false;
    }
  };
  if (options.formDesign && options.addFormFields) setViewerMode("form");

  save.onclick = async () => {
    if (!options.onSave) return;
    save.disabled = true;
    const work = window.SecuriWork;
    if (work) work.begin("Kaydediliyor…");
    try {
      let bytes = await doc.saveDocument();
      if (shapes.length) {
        if (!options.addShapes) throw new Error("Şekiller bu pencerede dosyaya yazılamıyor.");
        bytes = await options.addShapes(bytes, shapes.map((shape) => ({
          page: shape.page,
          color: shape.color,
          stroke: shape.stroke,
          paths: shape.paths,
        })));
      }
      const saved = await options.onSave(bytes);
      markDirty(!saved);
    } catch (err) {
      markDirty(true);
      window.alert(String((err && err.message) || err || "İşaretlemeler kaydedilemedi."));
    } finally {
      if (work) work.end();
      save.disabled = false;
    }
  };
  if (toWord) toWord.onclick = () => openTask("pdf-to-word");
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
  const open = (number) => openViewer(original, number, name, {
    password: options.password,
    onSave: options.onSave,
    addShapes: options.addShapes,
  });
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

window.SecuriPreview = {
  show, openViewer, closeViewer, parkViewer, resumeViewer, countPages, pageInfo, textLines, textBoxes, exportTables,
  hasSession: () => docSessions.length > 0,
};
window.dispatchEvent(new Event("securipreview-ready"));

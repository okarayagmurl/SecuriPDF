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
const THUMB_WIDTH = 132;

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

function closeViewer() {
  if (!viewer) return;
  viewer.root.remove();
  document.removeEventListener("keydown", viewer.onKey);
  viewer = null;
}

async function openViewer(doc, pageNumber, title) {
  closeViewer();
  const root = el("div", "viewer");
  const bar = el("div", "viewer-bar");
  const name = el("span", "viewer-title", title || "");
  const prev = el("button", "secondary", "‹");
  const position = el("span", "viewer-pos");
  const next = el("button", "secondary", "›");
  const zoomOut = el("button", "secondary", "−");
  const zoomIn = el("button", "secondary", "+");
  const fit = el("button", "secondary", "Sığdır");
  const close = el("button", "secondary", "Kapat");
  [prev, next, zoomOut, zoomIn, fit, close].forEach((b) => { b.type = "button"; });
  prev.title = "Önceki sayfa";
  next.title = "Sonraki sayfa";
  bar.append(name, prev, position, next, zoomOut, zoomIn, fit, close);
  const stage = el("div", "viewer-stage");
  const canvas = el("canvas");
  stage.appendChild(canvas);
  root.append(bar, stage);
  document.body.appendChild(root);

  const state = { page: pageNumber, zoom: 0 };
  const draw = async () => {
    position.textContent = `${state.page} / ${doc.numPages}`;
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= doc.numPages;
    const page = await doc.getPage(state.page);
    const fitWidth = Math.min(stage.clientWidth - 40, (stage.clientHeight - 40) * page.view[2] / page.view[3]);
    const width = state.zoom ? fitWidth * state.zoom : Math.max(200, fitWidth);
    await renderPage(page, canvas, width);
  };
  const go = (delta) => {
    const target = Math.min(doc.numPages, Math.max(1, state.page + delta));
    if (target !== state.page) { state.page = target; draw(); }
  };
  const zoom = (factor) => { state.zoom = Math.min(4, Math.max(0.5, (state.zoom || 1) * factor)); draw(); };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  zoomIn.onclick = () => zoom(1.25);
  zoomOut.onclick = () => zoom(0.8);
  fit.onclick = () => { state.zoom = 0; draw(); };
  close.onclick = closeViewer;
  root.addEventListener("click", (event) => { if (event.target === stage) closeViewer(); });
  const onKey = (event) => {
    if (event.key === "Escape") closeViewer();
    else if (event.key === "ArrowLeft" || event.key === "PageUp") go(-1);
    else if (event.key === "ArrowRight" || event.key === "PageDown") go(1);
  };
  document.addEventListener("keydown", onKey);
  viewer = { root, onKey };
  await draw();
}

// ---- Thumbnail grid ----

/**
 * Shows `source` (File or bytes) inside `host`.
 * options.pick: { mode: "remove" | "pick" | "split", selected: Set<number>, onToggle(page) }
 * options.password: used to open encrypted PDFs.
 * Returns { kind, pageCount, setSelected(set), destroy() }.
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
  const grid = el("div", "thumbs" + (pick ? " pickable mode-" + pick.mode : ""));
  const header = el("p", "preview-note", pick
    ? `${doc.numPages} sayfa. Sayfaya tıklayarak seçin; büyütmek için çift tıklayın.`
    : `${doc.numPages} sayfa. Büyütmek için sayfaya tıklayın.`);
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
      cell.addEventListener("dblclick", () => openViewer(doc, number, name));
    } else {
      cell.addEventListener("click", () => openViewer(doc, number, name));
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

window.SecuriPreview = { show, closeViewer, countPages };
window.dispatchEvent(new Event("securipreview-ready"));

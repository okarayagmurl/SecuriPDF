/* How a finished tool is shown. A declared extension wins over the byte sniff,
   so a Word file (which starts like a ZIP) is never treated as a PDF. */
(function (root) {
  function sniffExtension(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const ascii = (start, end) => String.fromCharCode.apply(null, view.subarray(start, end));
    if (ascii(0, 4) === "%PDF") return "pdf";
    if (view[0] === 0x50 && view[1] === 0x4b) return "zip";
    if (view[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (view[0] === 0xff && view[1] === 0xd8) return "jpg";
    if (ascii(0, 4) === "GIF8") return "gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (ascii(0, 2) === "BM") return "bmp";
    return "bin";
  }

  function declaredExtension(tool, bytes) {
    const declared = tool && (typeof tool.outputExt === "function" ? tool.outputExt(bytes) : tool.outputExt);
    return declared || sniffExtension(bytes);
  }

  function usesOpenPdf(tool) {
    const accept = (tool && tool.files && tool.files[0] && tool.files[0].accept) || "";
    return /pdf/i.test(accept);
  }

  function resultAction(tool, bytes) {
    const ext = declaredExtension(tool, bytes);
    if (ext === "pdf" && usesOpenPdf(tool)) return { ext, action: "replace" };
    if (ext === "pdf") return { ext, action: "open" };
    return { ext, action: "show" };
  }

  function outputFileName(sourceName, tool, bytes) {
    const base = String(sourceName || "belge").replace(/\.[^.]+$/, "") || "belge";
    const suffix = tool && tool.suffix ? "_" + tool.suffix : "";
    return base + suffix + "." + declaredExtension(tool, bytes);
  }

  function togglePageValue(current, page, allowAll) {
    const raw = String(current || "").trim();
    if (raw === "all" || raw === "") return String(page);
    const pages = new Set();
    raw.split(",").forEach((part) => {
      const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if (!range) return;
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : from;
      for (let value = Math.min(from, to); value <= Math.max(from, to); value++) pages.add(value);
    });
    if (pages.has(page)) pages.delete(page);
    else pages.add(page);
    if (!pages.size) return allowAll ? "all" : "";
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i++) {
      let end = i;
      while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
      parts.push(end === i ? String(sorted[i]) : sorted[i] + "-" + sorted[end]);
      i = end;
    }
    return parts.join(",");
  }

  function padValue(hit) {
    const row = Math.max(0, Math.min(2, Number(hit && hit.row) || 0));
    const col = Math.max(0, Math.min(2, Number(hit && hit.col) || 0));
    return String(row * 3 + col + 1);
  }

  const api = {
    sniffExtension,
    declaredExtension,
    usesOpenPdf,
    resultAction,
    outputFileName,
    togglePageValue,
    padValue,
  };
  root.SecuriTask = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

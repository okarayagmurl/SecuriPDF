// Readers and writers for document formats the PDF engine does not handle:
// UYAP UDF (a ZIP holding content.xml) and UBL-TR e-Fatura / e-Arşiv / e-İrsaliye XML.
// Both are laid out as HTML here and printed to PDF by WebView2 (print.rs).
(function () {
  const A4 = { width: 8.27, height: 11.69 };
  const POINT = 1 / 72;

  // ---- ZIP ----

  async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function zipEntry(bytes, match) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error("FORMAT_NOT_ZIP");
    let offset = view.getUint32(end + 16, true);
    const count = view.getUint16(end + 10, true);
    for (let n = 0; n < count; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("FORMAT_BAD_ZIP");
      const method = view.getUint16(offset + 10, true);
      const size = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const skip = nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      offset += 46 + skip;
      if (!match(name)) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error("FORMAT_BAD_ZIP");
    }
    return null;
  }

  async function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error("FORMAT_NOT_ZIP");
    const count = view.getUint16(end + 10, true);
    const entries = [];
    let offset = view.getUint32(end + 16, true);
    for (let n = 0; n < count; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("FORMAT_BAD_ZIP");
      const method = view.getUint16(offset + 10, true);
      const size = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extra = view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      offset += 46 + nameLength + extra;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (data) entries.push({ name, data });
    }
    return entries;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /** Stored (uncompressed) ZIP; entries: [{ name, data: Uint8Array }]. */
  function zipStore(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    entries.forEach((entry) => {
      const name = encoder.encode(entry.name);
      const crc = crc32(entry.data);
      const header = (signature, central) => {
        const buffer = new Uint8Array((central ? 46 : 30) + name.length);
        const view = new DataView(buffer.buffer);
        let p = 0;
        const u16 = (value) => { view.setUint16(p, value, true); p += 2; };
        const u32 = (value) => { view.setUint32(p, value, true); p += 4; };
        u32(signature);
        if (central) u16(20);
        u16(20); u16(0x0800); u16(0); u16(time); u16(date);
        u32(crc); u32(entry.data.length); u32(entry.data.length);
        u16(name.length); u16(0);
        if (central) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
        buffer.set(name, p);
        return buffer;
      };
      const local = header(0x04034b50, false);
      centrals.push(header(0x02014b50, true));
      locals.push(local, entry.data);
      offset += local.length + entry.data.length;
    });
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
    const parts = locals.concat(centrals, [end]);
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let p = 0;
    parts.forEach((part) => { out.set(part, p); p += part.length; });
    return out;
  }

  // ---- Shared HTML helpers ----

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function parseXml(text, error) {
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(error);
    return doc;
  }

  function page(html, setup) {
    return { html: "\uFEFF" + html, page: { ...A4, landscape: false, ...setup } };
  }

  // ---- UDF → HTML ----

  const ALIGN = { 0: "left", 1: "center", 2: "right", 3: "justify" };

  function attrs(element) {
    const out = {};
    if (element) for (const attr of element.attributes) out[attr.name] = attr.value;
    return out;
  }

  function javaColor(value) {
    const number = Number(value);
    if (value === undefined || value === "" || !Number.isFinite(number)) return null;
    return "#" + ((number >>> 0) & 0xffffff).toString(16).padStart(6, "0");
  }

  function number(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function fontCss(style) {
    const css = [];
    if (style.family) css.push(`font-family:"${style.family.replace(/["\\<>]/g, "")}","Times New Roman",serif`);
    if (style.size) css.push(`font-size:${number(style.size, 12)}pt`);
    if (style.bold === "true") css.push("font-weight:700");
    if (style.italic === "true") css.push("font-style:italic");
    const lines = [style.underline === "true" && "underline", style.strikethrough === "true" && "line-through"].filter(Boolean);
    if (lines.length) css.push(`text-decoration:${lines.join(" ")}`);
    const color = javaColor(style.foreground);
    if (color) css.push(`color:${color}`);
    const background = javaColor(style.background);
    if (background && background !== "#ffffff") css.push(`background:${background}`);
    return css.join(";");
  }

  function paragraphCss(style) {
    const css = [`text-align:${ALIGN[style.Alignment] || "left"}`];
    const pt = (name, property) => { const value = number(style[name], 0); if (value) css.push(`${property}:${value}pt`); };
    pt("LeftIndent", "margin-left");
    pt("RightIndent", "margin-right");
    pt("FirstLineIndent", "text-indent");
    pt("SpaceAbove", "margin-top");
    pt("SpaceBelow", "margin-bottom");
    css.push(`line-height:${(1.2 * (1 + number(style.LineSpacing, 0))).toFixed(2)}`);
    return css.join(";");
  }

  function udfRenderer(doc) {
    const text = (doc.querySelector("template > content") || {}).textContent || "";
    const styles = {};
    doc.querySelectorAll("styles > style").forEach((node) => { styles[node.getAttribute("name")] = attrs(node); });
    const elements = doc.querySelector("template > elements");
    const resolver = elements && elements.getAttribute("resolver");
    const base = { ...styles.default, ...(resolver && styles[resolver]) };
    const styled = (own, inherited) => ({ ...inherited, ...(own.resolver && styles[own.resolver]), ...own });

    function slice(own) {
      const start = number(own.startOffset, -1);
      const length = number(own.length, 0);
      return start < 0 ? "" : text.substr(start, length).replace(/\r?\n/g, "");
    }

    function run(node, inherited) {
      const own = attrs(node);
      const style = styled(own, inherited);
      switch (node.localName) {
        case "image": {
          const data = own.imageData;
          if (!data) return "";
          const size = [own.width && `width:${number(own.width, 0)}pt`, own.height && `height:${number(own.height, 0)}pt`].filter(Boolean).join(";");
          return `<img src="data:image/png;base64,${data.replace(/[^A-Za-z0-9+/=]/g, "")}" style="${size}" alt="">`;
        }
        case "tab":
          return `<span style="${fontCss(style)}">\t</span>`;
        default: {
          const piece = slice(own);
          return piece ? `<span style="${fontCss(style)}">${escapeHtml(piece)}</span>` : "";
        }
      }
    }

    function paragraph(node, inherited) {
      const style = styled(attrs(node), inherited);
      const inner = Array.from(node.children).map((child) => run(child, style)).join("");
      return `<p style="${paragraphCss(style)};${fontCss(style)}">${inner || "&nbsp;"}</p>`;
    }

    function table(node, inherited) {
      const own = attrs(node);
      const bordered = own.border !== "borderNone";
      const widths = (own.columnSpans || "").split(",").map((value) => number(value, 0)).filter((value) => value > 0);
      const cols = widths.length ? `<colgroup>${widths.map((width) => `<col style="width:${width}pt">`).join("")}</colgroup>` : "";
      const rows = Array.from(node.children).filter((row) => row.localName === "row").map((row) => {
        const cells = Array.from(row.children).filter((cell) => cell.localName === "cell").map((cell) => {
          const cellAttrs = attrs(cell);
          const span = ["colspan", "colSpan"].map((name) => cellAttrs[name]).find(Boolean);
          const rowSpan = ["rowspan", "rowSpan"].map((name) => cellAttrs[name]).find(Boolean);
          const spanAttrs = (span ? ` colspan="${number(span, 1)}"` : "") + (rowSpan ? ` rowspan="${number(rowSpan, 1)}"` : "");
          const background = javaColor(cellAttrs.bgColor || cellAttrs.background);
          return `<td${spanAttrs} style="${bordered ? "border:0.5pt solid #000;" : ""}${background ? `background:${background}` : ""}">${block(cell, inherited)}</td>`;
        }).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      return `<table>${cols}${rows}</table>`;
    }

    function block(container, inherited) {
      return Array.from(container.children).map((node) => {
        switch (node.localName) {
          case "paragraph": return paragraph(node, inherited);
          case "table": return table(node, inherited);
          case "header": case "footer": return `<div class="${node.localName}">${block(node, inherited)}</div>`;
          case "page-break": case "pageBreak": return `<div style="break-after:page"></div>`;
          default: {
            const own = attrs(node);
            return own.startOffset !== undefined ? `<p>${run(node, inherited)}</p>` : block(node, inherited);
          }
        }
      }).join("");
    }

    return { text, base, elements, render: () => (elements && elements.children.length ? block(elements, base) : "") };
  }

  async function udfToHtml(bytes) {
    const xml = await zipEntry(bytes, (name) => name.toLowerCase() === "content.xml");
    if (!xml) throw new Error("FORMAT_UDF_NO_CONTENT");
    const doc = parseXml(new TextDecoder("utf-8").decode(xml), "FORMAT_UDF_BAD_XML");
    if (!doc.querySelector("template")) throw new Error("FORMAT_UDF_BAD_XML");
    const renderer = udfRenderer(doc);
    let body = renderer.render();
    if (!body.replace(/<[^>]+>|&nbsp;/g, "").trim() && renderer.text.trim()) {
      body = renderer.text.split(/\r?\n/).map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`).join("");
    }
    const format = attrs(doc.querySelector("properties > pageFormat"));
    const margin = (name, fallback) => number(format[name], fallback) * POINT;
    const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><style>
      body { margin: 0; font: 12pt "Times New Roman", serif; color: #000; white-space: pre-wrap; tab-size: 4; }
      p { margin: 0; }
      table { border-collapse: collapse; width: 100%; margin: 2pt 0; }
      td { vertical-align: top; padding: 2pt 4pt; }
      .header, .footer { font-size: 10pt; }
      img { max-width: 100%; }
    </style></head><body style="${fontCss(renderer.base)}">${body}</body></html>`;
    return page(html, {
      marginTop: margin("topMargin", 42.5),
      marginRight: margin("rightMargin", 42.5),
      marginBottom: margin("bottomMargin", 42.5),
      marginLeft: margin("leftMargin", 42.5),
      landscape: format.paperOrientation === "0" || format.paperOrientation === "2",
    });
  }

  // ---- PDF text → UDF ----

  /** lines: [{ text, size, bold, pageBreakBefore }] */
  function linesToUdf(lines) {
    let content = "";
    const paragraphs = lines.map((line) => {
      const start = content.length;
      const value = line.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
      content += value + "\n";
      const run = value.length
        ? `<content startOffset="${start}" length="${value.length}" size="${Math.round(line.size || 12)}"${line.bold ? ' bold="true"' : ""}/>`
        : "";
      return `<paragraph Alignment="0" LeftIndent="0.0" RightIndent="0.0" SpaceAbove="${line.pageBreakBefore ? "12.0" : "0.0"}">${run}<content startOffset="${start + value.length}" length="1"/></paragraph>`;
    });
    const cdata = content.replace(/\]\]>/g, "]]]]><![CDATA[>");
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<template format_id="1.8">
<content><![CDATA[${cdata}]]></content>
<properties><pageFormat mediaSizeName="1" leftMargin="42.525" rightMargin="42.525" topMargin="42.525" bottomMargin="42.525" paperOrientation="1" headerFOffset="20.0" footerFOffset="20.0" /></properties>
<elements resolver="hvl-default">
${paragraphs.join("\n")}
</elements>
<styles><style name="default" description="Geçerli" family="Dialog" size="12" bold="false" italic="false" foreground="-13421773" /><style name="hvl-default" family="Times New Roman" size="12" description="Gövde" /></styles>
</template>
`;
    return zipStore([{ name: "content.xml", data: new TextEncoder().encode(xml) }]);
  }

  // ---- UBL-TR → HTML ----

  function child(node, name) {
    if (!node) return null;
    for (const item of node.children) if (item.localName === name) return item;
    return null;
  }

  function children(node, name) {
    return node ? Array.from(node.children).filter((item) => item.localName === name) : [];
  }

  function path(node, names) {
    return names.reduce((current, name) => child(current, name), node);
  }

  function value(node, names) {
    const found = path(node, names);
    return found ? found.textContent.trim() : "";
  }

  function decodeBase64(text) {
    const binary = atob(text.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function embeddedXslt(doc) {
    const nodes = Array.from(doc.getElementsByTagNameNS("*", "EmbeddedDocumentBinaryObject"));
    const named = nodes.filter((node) => /\.xslt?$/i.test(node.getAttribute("filename") || "") || /xsl/i.test(node.getAttribute("mimeCode") || ""));
    for (const node of named.concat(nodes.filter((node) => !named.includes(node)))) {
      try {
        const text = decodeBase64(node.textContent);
        if (/<(\w+:)?stylesheet\b|<(\w+:)?transform\b/.test(text)) return text;
      } catch {
        // Not base64 text; keep looking.
      }
    }
    return null;
  }

  function transform(doc, xsltText) {
    if (typeof XSLTProcessor !== "function") return null;
    const processor = new XSLTProcessor();
    processor.importStylesheet(parseXml(xsltText, "FORMAT_XSLT_BAD"));
    const out = processor.transformToDocument(doc);
    if (!out || !out.documentElement) return null;
    const html = out.documentElement.outerHTML || new XMLSerializer().serializeToString(out);
    return /<body[\s>]/i.test(html) || html.length > 200 ? "<!DOCTYPE html>" + html : null;
  }

  function money(node) {
    if (!node) return "";
    const amount = Number(node.textContent.trim());
    const currency = node.getAttribute("currencyID") || "";
    if (!Number.isFinite(amount)) return escapeHtml(node.textContent.trim());
    return amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (currency ? " " + escapeHtml(currency) : "");
  }

  function party(node) {
    const p = child(node, "Party");
    if (!p) return "";
    const person = child(p, "Person");
    const name = value(p, ["PartyName", "Name"]) || [value(person, ["FirstName"]), value(person, ["FamilyName"])].filter(Boolean).join(" ");
    const ids = children(p, "PartyIdentification").map((item) => {
      const id = child(item, "ID");
      return id ? `${escapeHtml(id.getAttribute("schemeID") || "No")}: ${escapeHtml(id.textContent.trim())}` : "";
    }).filter(Boolean);
    const address = child(p, "PostalAddress");
    const addressLine = [
      value(address, ["StreetName"]), value(address, ["BuildingNumber"]), value(address, ["CitySubdivisionName"]),
      value(address, ["CityName"]), value(address, ["PostalZone"]), value(address, ["Country", "Name"]),
    ].filter(Boolean).join(" ");
    const taxOffice = value(p, ["PartyTaxScheme", "TaxScheme", "Name"]);
    const contact = [value(p, ["Contact", "Telephone"]), value(p, ["Contact", "ElectronicMail"]), value(p, ["WebsiteURI"])].filter(Boolean).join(" · ");
    return [
      `<strong>${escapeHtml(name)}</strong>`,
      addressLine && escapeHtml(addressLine),
      taxOffice && `Vergi dairesi: ${escapeHtml(taxOffice)}`,
      ids.join(" · "),
      contact && escapeHtml(contact),
    ].filter(Boolean).join("<br>");
  }

  const DOCUMENT_TITLES = { Invoice: "Fatura", CreditNote: "İade Faturası", DespatchAdvice: "e-İrsaliye", ReceiptAdvice: "İrsaliye Yanıtı" };

  function standardInvoice(doc) {
    const root = doc.documentElement;
    const kind = root.localName;
    const profile = value(root, ["ProfileID"]);
    const type = value(root, ["InvoiceTypeCode"]) || value(root, ["DespatchAdviceTypeCode"]);
    const title = profile === "EARSIVFATURA" ? "e-Arşiv Fatura" : kind === "Invoice" ? "e-Fatura" : DOCUMENT_TITLES[kind] || kind;
    const supplier = child(root, "AccountingSupplierParty") || child(root, "DespatchSupplierParty");
    const customer = child(root, "AccountingCustomerParty") || child(root, "DeliveryCustomerParty");
    const lineName = { Invoice: "InvoiceLine", CreditNote: "CreditNoteLine", DespatchAdvice: "DespatchLine" }[kind] || "InvoiceLine";
    const lines = children(root, lineName).map((line) => {
      const quantity = children(line, "InvoicedQuantity")[0] || children(line, "CreditedQuantity")[0] || children(line, "DeliveredQuantity")[0];
      const percent = value(line, ["TaxTotal", "TaxSubtotal", "Percent"]);
      return `<tr>
        <td>${escapeHtml(value(line, ["ID"]))}</td>
        <td>${escapeHtml(value(line, ["Item", "Name"]))}${value(line, ["Item", "Description"]) ? `<br><small>${escapeHtml(value(line, ["Item", "Description"]))}</small>` : ""}</td>
        <td class="num">${quantity ? escapeHtml(quantity.textContent.trim()) + " " + escapeHtml(quantity.getAttribute("unitCode") || "") : ""}</td>
        <td class="num">${money(path(line, ["Price", "PriceAmount"]))}</td>
        <td class="num">${percent ? "%" + escapeHtml(percent) : ""}</td>
        <td class="num">${money(child(line, "LineExtensionAmount"))}</td>
      </tr>`;
    }).join("");
    const taxes = children(root, "TaxTotal").flatMap((total) => children(total, "TaxSubtotal")).map((sub) =>
      `<tr><th>${escapeHtml(value(sub, ["TaxCategory", "TaxScheme", "Name"]) || "Vergi")} ${value(sub, ["Percent"]) ? "%" + escapeHtml(value(sub, ["Percent"])) : ""}</th><td class="num">${money(child(sub, "TaxAmount"))}</td></tr>`).join("");
    const totals = child(root, "LegalMonetaryTotal");
    const totalRow = (label, name) => (child(totals, name) ? `<tr><th>${label}</th><td class="num">${money(child(totals, name))}</td></tr>` : "");
    const notes = children(root, "Note").map((note) => `<p>${escapeHtml(note.textContent.trim())}</p>`).join("");
    const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><style>
      body { margin: 0; font: 9.5pt "Segoe UI", Arial, sans-serif; color: #111; }
      h1 { font-size: 18pt; margin: 0 0 4pt; }
      .meta td, .meta th { padding: 1pt 8pt 1pt 0; text-align: left; vertical-align: top; }
      .parties { display: flex; gap: 16pt; margin: 10pt 0; }
      .parties > div { flex: 1; border: 0.75pt solid #999; padding: 6pt 8pt; }
      .parties h2 { font-size: 9pt; text-transform: uppercase; color: #555; margin: 0 0 4pt; }
      table.lines { width: 100%; border-collapse: collapse; margin-top: 8pt; }
      table.lines th, table.lines td { border: 0.75pt solid #999; padding: 3pt 5pt; vertical-align: top; }
      table.lines th { background: #eee; text-align: left; }
      .num { text-align: right; white-space: nowrap; }
      table.totals { margin: 8pt 0 0 auto; border-collapse: collapse; }
      table.totals th, table.totals td { padding: 2pt 6pt; border-bottom: 0.5pt solid #ccc; text-align: left; }
      .payable th, .payable td { font-weight: 700; font-size: 11pt; }
      .notes { margin-top: 10pt; font-size: 8.5pt; }
      .source { margin-top: 14pt; font-size: 7.5pt; color: #666; }
      tr { break-inside: avoid; }
    </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <table class="meta">
        <tr><th>Belge no</th><td>${escapeHtml(value(root, ["ID"]))}</td><th>Tarih</th><td>${escapeHtml([value(root, ["IssueDate"]), value(root, ["IssueTime"])].filter(Boolean).join(" "))}</td></tr>
        <tr><th>Senaryo</th><td>${escapeHtml(profile)}</td><th>Tip</th><td>${escapeHtml(type)}</td></tr>
        <tr><th>ETTN</th><td colspan="3">${escapeHtml(value(root, ["UUID"]))}</td></tr>
      </table>
      <div class="parties">
        <div><h2>Satıcı</h2>${party(supplier)}</div>
        <div><h2>Alıcı</h2>${party(customer)}</div>
      </div>
      <table class="lines">
        <thead><tr><th>#</th><th>Mal / hizmet</th><th>Miktar</th><th>Birim fiyat</th><th>KDV</th><th>Tutar</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
      <table class="totals">
        ${totalRow("Mal / hizmet toplamı", "LineExtensionAmount")}
        ${totalRow("İskonto", "AllowanceTotalAmount")}
        ${totalRow("Vergiler hariç", "TaxExclusiveAmount")}
        ${taxes}
        ${totalRow("Vergiler dahil", "TaxInclusiveAmount")}
        <tr class="payable"><th>Ödenecek tutar</th><td class="num">${money(child(totals, "PayableAmount"))}</td></tr>
      </table>
      ${notes ? `<div class="notes">${notes}</div>` : ""}
      <p class="source">Bu görünüm SecuriPDF standart şablonuyla oluşturuldu.</p>
    </body></html>`;
    return html;
  }

  /** Returns { html, page, template: "embedded" | "standard" }. */
  function invoiceToHtml(xmlText, preferEmbedded) {
    const doc = parseXml(xmlText, "FORMAT_XML_BAD");
    const root = doc.documentElement;
    if (!/^(Invoice|CreditNote|DespatchAdvice|ReceiptAdvice)$/.test(root.localName)) throw new Error("FORMAT_NOT_UBL");
    if (preferEmbedded) {
      const xslt = embeddedXslt(doc);
      const html = xslt && transform(doc, xslt);
      if (html) return { ...page(html, { marginTop: 0.4, marginRight: 0.4, marginBottom: 0.4, marginLeft: 0.4 }), template: "embedded" };
    }
    const html = standardInvoice(doc);
    return { ...page(html, { marginTop: 0.5, marginRight: 0.5, marginBottom: 0.5, marginLeft: 0.5 }), template: "standard" };
  }

  // ---- Signature validation report ----

  /** The overall verdict of one /validate-signature result. */
  function signatureVerdict(result) {
    if (!result.valid) return { level: "bad", text: "Geçersiz: belge imzalandıktan sonra değiştirilmiş veya imza bozuk" };
    if (result.coversEntireDocument === false) return { level: "warn", text: "İmza geçerli, ancak imzadan sonra belgeye ekleme yapılmış" };
    if (result.chainValid === false || result.trustValid === false) return { level: "warn", text: "İmza bütün, ancak sertifika güvenilir bir kök sertifikaya bağlanamadı" };
    if (result.notExpired === false) return { level: "warn", text: "İmza bütün, ancak sertifikanın süresi dolmuş" };
    if (/revoked/i.test(result.revocationStatus || "")) return { level: "bad", text: "Sertifika iptal edilmiş" };
    return { level: "ok", text: "Geçerli" };
  }

  function signatureReport(results, fileName) {
    const yesNo = (value) => (value === true ? "Evet" : value === false ? "Hayır" : "—");
    const row = (label, value) => (value === undefined || value === null || value === "" ? "" :
      `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`);
    const items = results.map((result, index) => {
      const verdict = signatureVerdict(result);
      return `<section class="${verdict.level}">
        <h2>İmza ${index + 1}: ${escapeHtml(result.signerName || "Bilinmeyen imzacı")}</h2>
        <p class="verdict">${escapeHtml(verdict.text)}</p>
        <table>
          ${row("İmza tarihi", result.signatureDate)}
          ${row("Neden", result.reason)}
          ${row("Yer", result.location)}
          ${row("İmza bütünlüğü", yesNo(result.valid))}
          ${row("Tüm belgeyi kapsıyor", yesNo(result.coversEntireDocument))}
          ${row("Sertifika zinciri", yesNo(result.chainValid))}
          ${row("Güvenilir kök", yesNo(result.trustValid))}
          ${row("Zincir hatası", result.chainValidationError)}
          ${row("Sertifika süresi içinde", yesNo(result.notExpired))}
          ${row("İptal durumu", result.revocationChecked ? result.revocationStatus : "Denetlenmedi")}
          ${row("Sertifika sahibi", result.subjectDN)}
          ${row("Yayıncı", result.issuerDN)}
          ${row("Seri no", result.serialNumber)}
          ${row("Geçerlilik", [result.validFrom, result.validUntil].filter(Boolean).join(" – "))}
          ${row("Anahtar", result.keySize ? result.keySize + " bit" : "")}
          ${row("Hata", result.errorMessage)}
        </table>
      </section>`;
    }).join("");
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      body { margin: 0; font: 10pt "Segoe UI", Arial, sans-serif; color: #111; }
      h1 { font-size: 16pt; margin: 0 0 2pt; }
      .file { color: #555; margin: 0 0 12pt; }
      section { border: 0.75pt solid #999; border-left-width: 5pt; padding: 6pt 10pt; margin-bottom: 10pt; break-inside: avoid; }
      section.ok { border-left-color: #1a7f37; }
      section.warn { border-left-color: #bf8700; }
      section.bad { border-left-color: #cf222e; }
      h2 { font-size: 11.5pt; margin: 0 0 2pt; }
      .verdict { font-weight: 700; margin: 0 0 6pt; }
      table { border-collapse: collapse; }
      th, td { text-align: left; vertical-align: top; padding: 1.5pt 10pt 1.5pt 0; }
      th { color: #555; font-weight: 600; white-space: nowrap; }
      td { word-break: break-word; }
      .source { margin-top: 14pt; font-size: 8pt; color: #666; }
    </style></head><body>
      <h1>İmza doğrulama raporu</h1>
      <p class="file">${escapeHtml(fileName)} · ${escapeHtml(new Date().toLocaleString("tr-TR"))}</p>
      ${items || "<p>Belgede dijital imza bulunamadı.</p>"}
      <p class="source">SecuriPDF ile bu bilgisayarda oluşturuldu. Güvenilir kök denetimi Java'nın kök sertifikalarıyla ve varsa seçtiğiniz sertifikayla yapılır.</p>
    </body></html>`;
    return page(html, { marginTop: 0.6, marginRight: 0.6, marginBottom: 0.6, marginLeft: 0.6 });
  }

  window.SecuriFormats = { zipEntry, zipEntries, zipStore, udfToHtml, linesToUdf, invoiceToHtml, signatureVerdict, signatureReport, crc32 };
})();

// Turns positioned PDF text into a grid. Merged cells come from a run that
// covers the next column; a short gap under the same column stays one cell.
(function (root) {
  function pageList(spec, count) {
    const text = String(spec || "all").trim().toLowerCase();
    if (!text || text === "all") {
      const pages = [];
      for (let page = 1; page <= count; page++) pages.push(page);
      return pages;
    }
    const pages = [];
    text.split(",").forEach((part) => {
      const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if (!match) return;
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      for (let page = Math.min(from, to); page <= Math.max(from, to) && page <= count; page++) {
        if (page >= 1) pages.push(page);
      }
    });
    return Array.from(new Set(pages));
  }

  function gridFromItems(items) {
    const usable = (items || []).filter((item) => item && String(item.text || "").trim());
    if (usable.length < 4) return [];
    const heights = usable.map((item) => item.h || 10).sort((a, b) => a - b);
    const font = heights[Math.floor(heights.length / 2)] || 10;
    const yTol = Math.max(2, font * 0.45);
    const joinGap = Math.max(6, font * 0.45);
    const colTol = Math.max(8, font * 0.7);

    const sorted = usable.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    sorted.forEach((item) => {
      const line = lines.find((entry) => Math.abs(entry.y - item.y) <= yTol);
      if (line) {
        line.items.push(item);
        line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
      } else lines.push({ y: item.y, items: [item] });
    });
    lines.sort((a, b) => b.y - a.y);

    const prepared = lines.map((line) => {
      const tokens = line.items.slice().sort((a, b) => a.x - b.x);
      const cells = [];
      tokens.forEach((token) => {
        const text = String(token.text).replace(/\s+/g, " ").trim();
        if (!text) return;
        const right = token.x + Math.max(0, token.w || 0);
        const prev = cells[cells.length - 1];
        if (prev && token.x - prev.right <= joinGap) {
          prev.text += (prev.text.endsWith("-") ? "" : " ") + text;
          prev.right = Math.max(prev.right, right);
        } else cells.push({ x: token.x, right, text });
      });
      return { y: line.y, cells };
    }).filter((line) => line.cells.length);

    const lefts = [];
    prepared.forEach((line) => {
      if (line.cells.length < 2) return;
      line.cells.forEach((cell) => lefts.push(cell.x));
    });
    lefts.sort((a, b) => a - b);
    const columns = [];
    lefts.forEach((x) => {
      const last = columns[columns.length - 1];
      if (last && x - last.mean <= colTol) {
        last.sum += x;
        last.count += 1;
        last.mean = last.sum / last.count;
      } else columns.push({ sum: x, count: 1, mean: x });
    });
    const edges = columns.map((column) => column.mean);
    if (edges.length < 2) return [];

    const columnOf = (x) => {
      let best = -1;
      let distance = Infinity;
      edges.forEach((edge, index) => {
        const gap = Math.abs(edge - x);
        if (gap < distance) {
          distance = gap;
          best = index;
        }
      });
      return distance <= colTol * 1.4 ? best : -1;
    };
    const spanOf = (cell) => {
      const start = columnOf(cell.x);
      if (start < 0) return { start: -1, span: 1 };
      let span = 1;
      while (start + span < edges.length && cell.right > edges[start + span] + colTol * 0.35) span += 1;
      return { start, span };
    };
    const tableLine = (line) => {
      const placed = line.cells.filter((cell) => columnOf(cell.x) >= 0);
      if (placed.length >= 2) return true;
      return line.cells.some((cell) => spanOf(cell).span >= 2);
    };

    const regions = [];
    let current = null;
    prepared.forEach((line) => {
      const gap = current ? current[current.length - 1].y - line.y : Infinity;
      if (tableLine(line)) {
        if (current && gap > font * 3.5) {
          regions.push(current);
          current = [];
        }
        if (!current) current = [];
        current.push(line);
        return;
      }
      const under = current && line.cells.length === 1 && columnOf(line.cells[0].x) >= 0 && gap < font * 2.2;
      if (under) current.push(line);
      else if (current) {
        regions.push(current);
        current = null;
      }
    });
    if (current) regions.push(current);

    return regions.map((region) => regionToTable(region, edges, columnOf, spanOf, font)).filter(Boolean);
  }

  function regionToTable(lines, edges, columnOf, spanOf, font) {
    if (lines.length < 2) return null;
    const gaps = [];
    for (let index = 1; index < lines.length; index++) gaps.push(lines[index - 1].y - lines[index].y);
    const positive = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
    const median = positive[Math.floor(positive.length / 2)] || font;
    const small = positive.filter((gap) => gap < median * 0.72);
    const large = positive.filter((gap) => gap >= median * 0.72);
    let splitAt = median * 0.85;
    if (small.length && large.length && Math.max.apply(null, small) < Math.min.apply(null, large)) {
      splitAt = (Math.max.apply(null, small) + Math.min.apply(null, large)) / 2;
    }

    const rows = [];
    const horizontal = [];
    let row = null;
    lines.forEach((line, index) => {
      const gap = index === 0 ? Infinity : lines[index - 1].y - line.y;
      const fresh = index === 0 || gap > splitAt;
      if (fresh) {
        row = edges.map(() => "");
        rows.push(row);
      }
      line.cells.forEach((cell) => {
        const placed = spanOf(cell);
        if (placed.start < 0) return;
        row[placed.start] = row[placed.start] ? row[placed.start] + "\n" + cell.text : cell.text;
        if (fresh && placed.span > 1) {
          for (let extra = 1; extra < placed.span; extra++) row[placed.start + extra] = "";
          horizontal.push({ row: rows.length - 1, col: placed.start, span: placed.span });
        }
      });
    });

    const filled = rows.map((cells) => cells.filter(Boolean).length).sort((a, b) => a - b);
    if ((filled[Math.floor(filled.length / 2)] || 0) < 2) return null;

    const merges = [];
    const covered = new Set();
    const take = (r1, c1, r2, c2) => {
      const keys = [];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) keys.push(r + ":" + c);
      }
      if (keys.some((key) => covered.has(key))) return false;
      keys.forEach((key) => covered.add(key));
      merges.push(colName(c1) + (r1 + 1) + ":" + colName(c2) + (r2 + 1));
      return true;
    };
    horizontal.forEach((merge) => take(merge.row, merge.col, merge.row, merge.col + merge.span - 1));
    for (let col = 0; col < edges.length; col++) {
      let rowIndex = 0;
      while (rowIndex < rows.length) {
        if (!rows[rowIndex][col]) {
          rowIndex += 1;
          continue;
        }
        let end = rowIndex;
        while (end + 1 < rows.length && !rows[end + 1][col] && rows[end + 1].some((value, index) => index !== col && value)) end += 1;
        const later = rows.slice(end + 1).some((cells) => cells[col]);
        if (later && end > rowIndex) take(rowIndex, col, end, col);
        rowIndex = end + 1;
      }
    }
    return { rows, merges };
  }

  function colName(index) {
    let number = index + 1;
    let name = "";
    while (number > 0) {
      const rem = (number - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      number = Math.floor((number - 1) / 26);
    }
    return name;
  }

  function xmlText(text) {
    return String(text == null ? "" : text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
  }

  function sheetName(name, used) {
    const clean = String(name || "Sayfa").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sayfa";
    let next = clean;
    let count = 2;
    while (used.has(next.toLowerCase())) {
      const suffix = " " + count;
      next = clean.slice(0, 31 - suffix.length) + suffix;
      count += 1;
    }
    used.add(next.toLowerCase());
    return next;
  }

  function sheetXml(table) {
    const rows = table.rows || [];
    const merges = table.merges || [];
    const body = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'];
    body.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
    rows.forEach((row, rowIndex) => {
      const lines = Math.max(1, ...row.map((cell) => String(cell || "").split("\n").length));
      const height = lines > 1 ? ` ht="${Math.min(120, 15 * lines)}" customHeight="1"` : "";
      body.push(`<row r="${rowIndex + 1}"${height}>`);
      row.forEach((cell, col) => {
        if (cell == null || cell === "") return;
        const ref = colName(col) + (rowIndex + 1);
        body.push(`<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlText(cell)}</t></is></c>`);
      });
      body.push("</row>");
    });
    body.push("</sheetData>");
    if (merges.length) {
      body.push(`<mergeCells count="${merges.length}">`);
      merges.forEach((ref) => body.push(`<mergeCell ref="${xmlText(ref)}"/>`));
      body.push("</mergeCells>");
    }
    body.push("</worksheet>");
    return body.join("");
  }

  const encoder = new TextEncoder();

  function crc32(bytes) {
    if (!crc32.table) {
      const table = new Uint32Array(256);
      for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        table[index] = value >>> 0;
      }
      crc32.table = table;
    }
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) crc = crc32.table[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(8, 0, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);
      const record = new Uint8Array(46 + name.length);
      const header = new DataView(record.buffer);
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 20, true);
      header.setUint32(16, crc, true);
      header.setUint32(20, data.length, true);
      header.setUint32(24, data.length, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true);
      record.set(name, 46);
      central.push(record);
      offset += local.length + data.length;
    });
    const centralSize = central.reduce((sum, record) => sum + record.length, 0);
    const end = new Uint8Array(22);
    const ending = new DataView(end.buffer);
    ending.setUint32(0, 0x06054b50, true);
    ending.setUint16(8, files.length, true);
    ending.setUint16(10, files.length, true);
    ending.setUint32(12, centralSize, true);
    ending.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centralSize + end.length);
    let cursor = 0;
    parts.concat(central, [end]).forEach((chunk) => {
      out.set(chunk, cursor);
      cursor += chunk.length;
    });
    return out;
  }

  function xlsxBytes(sheets) {
    const used = new Set();
    const named = (sheets || []).map((sheet, index) => ({
      name: sheetName(sheet.name || ("Sayfa " + (index + 1)), used),
      rows: sheet.rows || [],
      merges: sheet.merges || [],
    }));
    const contentTypes = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ];
    named.forEach((_, index) => {
      contentTypes.push(`<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    });
    contentTypes.push("</Types>");
    const workbook = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
    ];
    named.forEach((sheet, index) => {
      workbook.push(`<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`);
    });
    workbook.push("</sheets></workbook>");
    const workbookRels = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ];
    named.forEach((_, index) => {
      workbookRels.push(`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`);
    });
    workbookRels.push(`<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
    workbookRels.push("</Relationships>");
    const styles = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>',
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
      '<cellXfs count="2">',
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>',
      "</cellXfs></styleSheet>",
    ].join("");
    const files = [
      { name: "[Content_Types].xml", data: encoder.encode(contentTypes.join("")) },
      { name: "_rels/.rels", data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: "xl/workbook.xml", data: encoder.encode(workbook.join("")) },
      { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels.join("")) },
      { name: "xl/styles.xml", data: encoder.encode(styles) },
    ];
    named.forEach((sheet, index) => {
      files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: encoder.encode(sheetXml(sheet)) });
    });
    return zipStore(files);
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    if (/[",\n\r;]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csvBytes(sheets) {
    const blocks = (sheets || []).map((sheet) => (sheet.rows || []).map((row) => row.map(csvCell).join(",")).join("\r\n"));
    const text = blocks.filter(Boolean).join("\r\n\r\n");
    const encoded = encoder.encode(text);
    const out = new Uint8Array(3 + encoded.length);
    out.set([0xef, 0xbb, 0xbf], 0);
    out.set(encoded, 3);
    return out;
  }

  root.SecuriTables = { pageList, gridFromItems, xlsxBytes, csvBytes };
})(typeof window !== "undefined" ? window : globalThis);

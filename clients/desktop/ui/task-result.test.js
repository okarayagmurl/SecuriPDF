const { readFileSync } = require("fs");
const assert = require("assert");
const test = require("node:test");

const window = global;
eval(readFileSync(require("path").join(__dirname, "tools.js"), "utf8"));
eval(readFileSync(require("path").join(__dirname, "menu-icons.js"), "utf8"));
eval(readFileSync(require("path").join(__dirname, "task-result.js"), "utf8"));
const task = global.SecuriTask;
const tools = global.SECURIPDF_TOOLS;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

test("every tool keeps its declared extension and is not forced to PDF", () => {
  assert.ok(tools.length > 20);
  tools.forEach((tool) => {
    const bytes = typeof tool.outputExt === "string" && tool.outputExt !== "pdf" ? ZIP : PDF;
    const plan = task.resultAction(tool, bytes);
    const name = task.outputFileName("sozlesme.pdf", tool, bytes);
    if (typeof tool.outputExt === "string") {
      assert.strictEqual(plan.ext, tool.outputExt, tool.id);
      assert.ok(name.endsWith("." + tool.outputExt), tool.id + " " + name);
    }
    if (plan.ext !== "pdf") {
      assert.strictEqual(plan.action, "show", tool.id);
      assert.ok(!name.endsWith(".pdf"), tool.id + " was named " + name);
    }
  });
});

test("Word, Excel, PowerPoint, CSV, text and UDF stay downloadable files", () => {
  ["pdf-to-word", "pdf-to-excel", "pdf-to-ppt", "pdf-to-csv", "pdf-to-text", "pdf-to-udf"].forEach((id) => {
    const tool = tools.find((item) => item.id === id);
    assert.ok(tool, id);
    const plan = task.resultAction(tool, ZIP);
    assert.notStrictEqual(plan.ext, "pdf", id);
    assert.strictEqual(plan.action, "show", id);
    assert.ok(!task.outputFileName("belge.pdf", tool, ZIP).endsWith(".pdf"));
  });
});

test("a PDF result that started from the open document replaces the tab", () => {
  const tool = tools.find((item) => item.id === "rotate-pdf");
  assert.deepStrictEqual(task.resultAction(tool, PDF), { ext: "pdf", action: "replace" });
});

test("a PDF built from another file opens in a new tab", () => {
  const tool = tools.find((item) => item.id === "office-to-pdf");
  assert.deepStrictEqual(task.resultAction(tool, PDF), { ext: "pdf", action: "open" });
});

test("bookmark export follows the bytes", () => {
  const tool = tools.find((item) => item.id === "edit-table-of-contents");
  assert.strictEqual(task.resultAction(tool, new Uint8Array([0x7b])).ext, "json");
  assert.strictEqual(task.resultAction(tool, PDF).action, "replace");
});

test("page clicks and the number box describe the same pages", () => {
  assert.strictEqual(task.togglePageValue("all", 2, true), "2");
  assert.strictEqual(task.togglePageValue("2", 4, true), "2,4");
  assert.strictEqual(task.togglePageValue("2,4", 3, true), "2-4");
  assert.strictEqual(task.togglePageValue("2", 2, true), "all");
  assert.strictEqual(task.togglePageValue("2", 2, false), "");
});

test("a click on the page maps to the same pad cell", () => {
  assert.strictEqual(task.padValue({ row: 0, col: 0 }), "1");
  assert.strictEqual(task.padValue({ row: 0, col: 2 }), "3");
  assert.strictEqual(task.padValue({ row: 1, col: 1 }), "5");
  assert.strictEqual(task.padValue({ row: 2, col: 2 }), "9");
});

test("every page, convert and sign tool has a menu icon", () => {
  const icons = global.SECURIPDF_MENU_ICONS;
  tools.filter((tool) => tool.category === "pages" || tool.category === "convert" || tool.category === "sign")
    .forEach((tool) => {
      assert.ok(icons[tool.id], tool.id + " has no menu icon");
      assert.ok(icons[tool.id].includes("<"), tool.id);
    });
  ["add-image", "add-stamp", "add-attachments"].forEach((id) => {
    assert.ok(icons[id], id);
  });
});

test("image bytes are not called PDF", () => {
  assert.strictEqual(task.sniffExtension(PNG), "png");
  assert.strictEqual(task.sniffExtension(ZIP), "zip");
  assert.strictEqual(task.sniffExtension(PDF), "pdf");
});

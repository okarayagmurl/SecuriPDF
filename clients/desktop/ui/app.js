(function () {
  const tauri = window.__TAURI__;
  const core = tauri && tauri.core;
  const tools = window.SECURIPDF_TOOLS;
  const categories = window.SECURIPDF_CATEGORIES;
  const $ = (id) => document.getElementById(id);

  const state = {
    tool: null,
    files: {},
    result: null,
    engine: "starting",
    busy: false,
    preview: { tab: "source", file: null, handle: null, token: 0 },
  };

  const previewReady = window.SecuriPreview
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener("securipreview-ready", resolve, { once: true }));
  const pageCounts = new WeakMap();

  const ERRORS = {
    LOCAL_ENGINE_NOT_READY: "PDF motoru henüz hazır değil. Biraz bekleyip tekrar deneyin.",
    LOCAL_ENGINE_UNREACHABLE: "PDF motoruna ulaşılamadı. Uygulamayı kapatıp yeniden açın.",
    LOCAL_EMPTY_OUTPUT: "İşlem boş bir sonuç üretti.",
    LOCAL_BAD_REQUEST: "İstek oluşturulamadı.",
    FORMAT_NOT_ZIP: "Dosya geçerli bir UDF belgesi değil.",
    FORMAT_BAD_ZIP: "UDF dosyası bozuk veya desteklenmeyen biçimde sıkıştırılmış.",
    FORMAT_UDF_NO_CONTENT: "UDF dosyasında belge içeriği (content.xml) bulunamadı.",
    FORMAT_UDF_BAD_XML: "UDF belgesinin içeriği okunamadı.",
    FORMAT_XML_BAD: "XML dosyası okunamadı; dosya bozuk olabilir.",
    FORMAT_NOT_UBL: "Bu XML bir e-Fatura, e-Arşiv veya e-İrsaliye (UBL-TR) belgesi değil.",
    FORMAT_XSLT_BAD: "Belgedeki görsel şablon (XSLT) okunamadı.",
    FORMAT_NO_TEXT: "PDF'te metin bulunamadı. Taranmış bir belgeyse önce OCR uygulayın.",
    PRINT_LOAD_TIMEOUT: "Belge sayfası zamanında yüklenmedi.",
    PRINT_TIMEOUT: "PDF oluşturma zaman aşımına uğradı.",
    PRINT_FAILED: "PDF oluşturulamadı.",
    PRINT_BAD_PAGE: "Sayfa boyutu veya kenar boşlukları geçersiz.",
    OFFICE_MISSING: "Bu dönüşüm için bilgisayarda Microsoft Office (Word, Excel veya PowerPoint) kurulu olmalı.",
    OFFICE_OPEN_FAILED: "Office belgeyi açamadı. Dosya bozuk veya parola korumalı olabilir.",
    OFFICE_EXPORT_FAILED: "Office belgeyi dönüştüremedi.",
    OFFICE_BAD_INPUT: "Bu dosya türü bu dönüşümde desteklenmiyor.",
    OFFICE_PDFA_WORD_ONLY: "Excel PDF/A çıktısı vermez. PDF seçin, ardından \"PDF/A'ya dönüştür\" aracını kullanın.",
    OFFICE_TIMEOUT: "Office 3 dakika içinde yanıt vermedi ve kapatıldı. Office'i bir kez elle açıp bekleyen bir uyarı (etkinleştirme, duyarlılık etiketi vb.) olup olmadığını kontrol edin.",
    OFFICE_SCRIPT_FAILED: "Office dönüştürücüsü başlatılamadı (PowerShell bulunamadı veya engellendi).",
  };

  function errorText(err) {
    const code = typeof err === "string" ? err : (err && err.message) || String(err);
    if (ERRORS[code]) return ERRORS[code];
    const prefixed = Object.keys(ERRORS).find((key) => code.startsWith(key + ":"));
    if (prefixed) return ERRORS[prefixed];
    const http = /^LOCAL_HTTP_(\d+)(?::([\s\S]*))?$/.exec(code);
    if (http) {
      const specific = state.tool && state.tool.httpError && state.tool.httpError(Number(http[1]), http[2] || "");
      if (specific) return specific;
      return Number(http[1]) >= 500
        ? "İşlem tamamlanamadı. Dosya bozuk olabilir, parola yanlış olabilir veya seçenek dosyaya uymuyor olabilir."
        : "Seçenekler kabul edilmedi. Değerleri kontrol edin.";
    }
    return code;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  // ---- Page ranges ----

  function parsePages(text) {
    const pages = new Set();
    String(text || "").split(",").forEach((part) => {
      const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if (!range) return;
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : from;
      for (let page = Math.min(from, to); page <= Math.max(from, to) && page - from < 10000; page++) {
        if (page > 0) pages.add(page);
      }
    });
    return pages;
  }

  function formatPages(pages) {
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i++) {
      let end = i;
      while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
      parts.push(end > i + 1 ? `${sorted[i]}-${sorted[end]}` : end === i + 1 ? `${sorted[i]},${sorted[end]}` : `${sorted[i]}`);
      i = end;
    }
    return parts.join(",");
  }

  // ---- Engine status ----

  function pollEngine() {
    if (!core) {
      setEngine("missing", "Bu sayfa SecuriPDF uygulamasının içinde açılır.");
      hideSplash();
      return;
    }
    core.invoke("local_engine_status").then((status) => {
      setEngine(status.state, status.detail);
      updateSplash(status);
      if (status.state === "starting") setTimeout(pollEngine, 500);
    }).catch((err) => {
      setEngine("failed", errorText(err));
      updateSplash({ state: "failed", detail: errorText(err) });
    });
  }

  // ---- Splash ----

  // Progress values reported by the engine (see STARTUP_MILESTONES in engine.rs).
  const MILESTONES = [5, 15, 30, 55, 70, 85, 95, 100];
  const STAGES = [
    [15, "PDF motoru başlatılıyor…"],
    [55, "Ayarlar yükleniyor…"],
    [85, "PDF araçları hazırlanıyor…"],
    [100, "Son hazırlıklar yapılıyor…"],
  ];
  const splash = { shown: 0, versionSet: false, closed: false };

  function updateSplash(status) {
    if (!splash.versionSet && status.appVersion) {
      splash.versionSet = true;
      const parts = [`Sürüm ${status.appVersion}`];
      if (status.engineVersion) parts.push(`PDF motoru ${status.engineVersion}`);
      if (status.ocrVersion) parts.push(`OCR ${status.ocrVersion.split(".").slice(0, 3).join(".")}`);
      $("splashVersion").textContent = parts.join(" · ");
      $("brandVersion").textContent = `v${status.appVersion}`;
      $("brandVersion").title = parts.join(" · ");
    }
    if (splash.closed) return;

    if (status.state === "failed" || status.state === "missing") {
      $("splashStage").textContent = "PDF motoru açılamadı.";
      $("splashPercent").textContent = "";
      $("splashError").hidden = false;
      $("splashError").textContent = (status.detail || "Uygulamayı kapatıp yeniden açın.") +
        " Kayıt: %LOCALAPPDATA%\\net.entera.securipdf.desktop\\engine\\engine.log";
      $("splashSkip").textContent = "Kapat";
      $("splashProgress").classList.add("failed");
      return;
    }

    const reported = status.progress || 0;
    const next = MILESTONES.find((value) => value > reported) || 100;
    // Creep towards the next milestone so the bar keeps moving between log lines,
    // but never claim the next step before the engine reaches it.
    const creep = splash.shown + (next - splash.shown) * 0.08;
    splash.shown = status.state === "ready" ? 100 : Math.max(reported, Math.min(creep, next - 1));
    const percent = Math.round(splash.shown);
    $("splashBar").style.width = percent + "%";
    $("splashProgress").setAttribute("aria-valuenow", String(percent));
    $("splashPercent").textContent = `%${percent}`;
    $("splashStage").textContent = status.state === "ready"
      ? "Hazır"
      : (STAGES.find(([limit]) => reported < limit) || STAGES[STAGES.length - 1])[1];
    if (status.state === "ready") setTimeout(hideSplash, 450);
  }

  function hideSplash() {
    if (splash.closed) return;
    splash.closed = true;
    const node = $("splash");
    node.classList.add("leaving");
    setTimeout(() => { node.hidden = true; }, 400);
  }

  function setEngine(engineState, detail) {
    state.engine = engineState;
    const badge = $("engine");
    badge.dataset.state = engineState;
    badge.textContent = {
      ready: "Motor hazır",
      starting: "Motor hazırlanıyor…",
      failed: "Motor başlatılamadı",
      missing: "Motor bulunamadı",
    }[engineState] || engineState;
    badge.title = detail || (engineState === "starting"
      ? "Bu sırada dosya seçip önizleyebilirsiniz."
        : "");
    updateRunButton();
    if (engineState === "ready" && state.tool && state.loadedOptions) applyVisibility();
  }

  // Tools with their own `run` work in the UI and only need the engine when they say so.
  function needsEngine(tool) {
    return Boolean(tool && (!tool.run || tool.usesEngine));
  }

  function updateRunButton() {
    const run = $("run");
    const waiting = needsEngine(state.tool) && state.engine !== "ready";
    run.disabled = state.busy || waiting;
    run.textContent = state.busy ? "İşleniyor…" : waiting ? "Motor hazırlanıyor…" : "Çalıştır";
    if (needsEngine(state.tool) && (state.engine === "failed" || state.engine === "missing")) {
      run.textContent = "Motor çalışmıyor";
      $("formError").textContent = ($("engine").title || "PDF motoru başlatılamadı.") +
        " Kayıt: %LOCALAPPDATA%\\net.entera.securipdf.desktop\\engine\\engine.log";
    }
  }

  // ---- Tool list ----

  function renderToolList(filter) {
    const query = (filter || "").trim().toLocaleLowerCase("tr");
    const list = $("toolList");
    list.replaceChildren();
    categories.forEach((category) => {
      const items = tools.filter((tool) => tool.category === category.id &&
        (!query || (tool.title + " " + tool.description).toLocaleLowerCase("tr").includes(query)));
      if (!items.length) return;
      list.appendChild(el("h2", { text: category.title }));
      items.forEach((tool) => {
        list.appendChild(el("button", {
          type: "button",
          text: tool.title,
          "aria-current": state.tool && state.tool.id === tool.id ? "true" : "false",
          onclick: () => selectTool(tool.id),
        }));
      });
    });
  }

  function acceptsPdf(spec) {
    return /\.pdf|application\/pdf/.test(spec.accept || "");
  }

  function selectTool(id, carry) {
    const tool = tools.find((item) => item.id === id);
    if (!tool) return;
    const previous = carry || (state.tool ? state.files[state.tool.files[0].name] || [] : []);
    state.tool = tool;
    state.files = {};
    tool.files.forEach((spec) => { state.files[spec.name] = []; });
    const primary = tool.files[0];
    const carried = previous.filter((file) => matchesAccept(file, primary.accept));
    state.files[primary.name] = primary.multiple ? carried : carried.slice(0, 1);
    clearResult();
    $("tool").hidden = false;
    $("toolTitle").textContent = tool.title;
    $("toolDescription").textContent = tool.description;
    $("formError").textContent = "";
    renderFields();
    renderFiles();
    renderToolList($("search").value);
    updateRunButton();
  }

  // ---- Files ----

  function matchesAccept(file, accept) {
    if (!accept) return true;
    const name = file.name.toLowerCase();
    return accept.split(",").some((rule) => {
      rule = rule.trim().toLowerCase();
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return (file.type || "").startsWith(rule.slice(0, -1));
      return file.type === rule;
    });
  }

  function addFiles(spec, fileList) {
    const all = Array.from(fileList);
    const accepted = all.filter((file) => matchesAccept(file, spec.accept));
    $("formError").textContent = accepted.length < all.length
      ? "Bazı dosyalar bu araç için uygun değil ve eklenmedi."
      : "";
    if (!accepted.length) return;
    state.files[spec.name] = spec.multiple ? state.files[spec.name].concat(accepted) : [accepted[0]];
    clearResult();
    renderFiles();
  }

  function allFiles() {
    return state.tool.files.filter((spec) => spec.preview !== false).flatMap((spec) => state.files[spec.name]);
  }

  function renderFiles() {
    const host = $("fileInputs");
    host.replaceChildren();
    const files = allFiles();
    if (!files.includes(state.preview.file)) state.preview.file = files[0] || null;
    state.tool.files.forEach((spec) => {
      const picker = el("input", {
        type: "file",
        accept: spec.accept,
        multiple: !!spec.multiple,
        hidden: true,
        onchange: (event) => { addFiles(spec, event.target.files); event.target.value = ""; },
      });
      const list = state.files[spec.name];
      const items = list.map((file, index) => el("li", { class: file === state.preview.file ? "previewing" : "" }, [
        spec.preview === false
          ? el("span", { class: "name", text: file.name })
          : el("span", { class: "name link", text: file.name, title: "Önizle", onclick: () => previewFile(file) }),
        el("span", { class: "size", text: formatSize(file.size) }),
        spec.multiple && index > 0 ? el("button", { type: "button", title: "Yukarı taşı", text: "↑", onclick: () => moveFile(spec, index, -1) }) : null,
        spec.multiple && index < list.length - 1 ? el("button", { type: "button", title: "Aşağı taşı", text: "↓", onclick: () => moveFile(spec, index, 1) }) : null,
        el("button", { type: "button", title: "Kaldır", text: "✕", onclick: () => removeFile(spec, index) }),
      ]));
      const drop = el("div", { class: "drop", "data-files": spec.name, hidden: !isVisible(spec, readValues()) }, [
        el("div", { class: "drop-head" }, [
          el("strong", { text: spec.label }),
          el("button", { type: "button", class: "secondary", text: spec.multiple ? "Dosya ekle" : "Dosya seç", onclick: () => picker.click() }),
        ]),
        el("p", { class: "drop-hint", text: spec.multiple ? "Dosyaları buraya sürükleyebilirsiniz." : "Dosyayı buraya sürükleyebilirsiniz." }),
        el("ul", { class: "files" }, items),
        picker,
      ]);
      drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("over");
        addFiles(spec, event.dataTransfer.files);
      });
      host.appendChild(drop);
    });
    if (state.preview.tab === "source") refreshPreview();
  }

  function moveFile(spec, index, delta) {
    const files = state.files[spec.name];
    const [file] = files.splice(index, 1);
    files.splice(index + delta, 0, file);
    clearResult();
    renderFiles();
  }

  function removeFile(spec, index) {
    state.files[spec.name].splice(index, 1);
    clearResult();
    renderFiles();
  }

  // ---- Fields ----

  function renderFields() {
    const host = $("fields");
    host.replaceChildren();
    state.tool.fields.forEach((field) => {
      const id = "f-" + field.name;
      let input;
      if (field.type === "select") {
        input = el("select", { id, name: field.name }, field.options.map((option) =>
          el("option", { value: option.value, text: option.label, selected: String(option.value) === String(field.default) })));
      } else if (field.type === "checkbox") {
        input = el("input", { id, name: field.name, type: "checkbox", checked: !!field.default });
      } else if (field.type === "checks") {
        input = el("div", { id, class: "checks" }, field.options.map((option) => el("label", {}, [
          el("input", { type: "checkbox", value: option.value, checked: (field.default || []).includes(option.value) }),
          document.createTextNode(option.label),
        ])));
      } else {
        input = el("input", {
          id,
          name: field.name,
          type: field.type,
          value: field.default !== undefined ? String(field.default) : "",
          placeholder: field.placeholder,
          min: field.min,
          max: field.max,
          step: field.step || (field.type === "number" ? "any" : undefined),
          autocomplete: field.type === "password" ? "new-password" : "off",
        });
      }
      input.addEventListener("change", () => onFieldChange(field));
      input.addEventListener("input", () => onFieldChange(field));
      const wrapper = field.type === "checkbox"
        ? el("div", { class: "field check", "data-field": field.name }, [el("label", { for: id }, [input, document.createTextNode(field.label)])])
        : el("div", { class: "field", "data-field": field.name }, [el(field.type === "checks" ? "span" : "label", { for: id, class: "label", text: field.label }), input]);
      if (field.load) {
        wrapper.appendChild(el("button", { type: "button", class: "secondary refresh", text: "Listeyi yenile", onclick: () => loadOptions(field, true) }));
      }
      if (field.hint) wrapper.appendChild(el("p", { class: "hint", text: field.hint }));
      host.appendChild(wrapper);
    });
    state.loadedOptions = new Set();
    applyVisibility();
  }

  // Options that come from the engine, such as the certificates in the
  // Windows store, are read when the field first becomes visible.
  async function loadOptions(field, force) {
    if (state.engine !== "ready" || (!force && state.loadedOptions.has(field.name))) return;
    state.loadedOptions.add(field.name);
    const tool = state.tool;
    const select = $("f-" + field.name);
    const previous = select.value;
    select.replaceChildren(el("option", { value: previous, text: "Yükleniyor…" }));
    let options;
    try {
      options = await field.load({ get: engineGet });
    } catch (err) {
      options = [];
      if (state.tool === tool) $("formError").textContent = errorText(err);
    }
    if (state.tool !== tool) return;
    field.options = options;
    const current = select.value;
    select.replaceChildren(...(options.length
      ? options.map((option) => el("option", { value: option.value, text: option.label }))
      : [el("option", { value: "", text: field.empty || "Kayıt bulunamadı" })]));
    if (options.some((option) => option.value === current)) select.value = current;
  }

  function onFieldChange(field) {
    applyVisibility();
    if (field.pagePicker && state.preview.handle) {
      state.preview.handle.setSelected(parsePages(readValues()[field.name]));
    }
    if ((field.pagePicker || field.showIf || field.type === "password" || field.type === "select") && state.preview.tab === "source") {
      const pick = activePicker();
      const handle = state.preview.handle;
      const needsReload = (handle && handle.locked && field.type === "password") ||
        (handle && Boolean(pick) !== Boolean(handle.pickMode)) ||
        (handle && pick && pick.pagePicker !== handle.pickMode);
      if (needsReload) refreshPreview(true);
    }
  }

  function readValues() {
    const values = {};
    state.tool.fields.forEach((field) => {
      const input = $("f-" + field.name);
      if (!input) values[field.name] = field.type === "checks" ? [] : field.type === "checkbox" ? false : "";
      else if (field.type === "checkbox") values[field.name] = input.checked;
      else if (field.type === "checks") values[field.name] = Array.from(input.querySelectorAll("input:checked")).map((box) => box.value);
      else values[field.name] = input.value.trim();
    });
    return values;
  }

  function isVisible(field, values) {
    return Object.entries(field.showIf || {}).every(([key, expected]) =>
      (Array.isArray(expected) ? expected.includes(values[key]) : values[key] === expected));
  }

  function applyVisibility() {
    const values = readValues();
    state.tool.fields.forEach((field) => {
      const visible = isVisible(field, values);
      document.querySelector(`[data-field="${field.name}"]`).hidden = !visible;
      if (visible && field.load) loadOptions(field);
    });
    state.tool.files.forEach((spec) => {
      const drop = document.querySelector(`[data-files="${spec.name}"]`);
      if (drop) drop.hidden = !isVisible(spec, values);
    });
  }

  function activePicker() {
    const values = readValues();
    return state.tool.fields.find((field) => field.pagePicker && isVisible(field, values)) || null;
  }

  // ---- Preview ----

  function setTab(tab) {
    state.preview.tab = tab;
    $("tabSource").setAttribute("aria-selected", String(tab === "source"));
    $("tabResult").setAttribute("aria-selected", String(tab === "result"));
    refreshPreview(true);
  }

  function previewFile(file) {
    state.preview.file = file;
    if (state.preview.tab !== "source") setTab("source");
    else renderFiles();
  }

  async function refreshPreview(force) {
    const preview = state.preview;
    const source = preview.tab === "result" && state.result
      ? { data: state.result.bytes, name: state.result.name }
      : preview.file ? { data: preview.file, name: preview.file.name } : null;
    const pick = preview.tab === "source" ? activePicker() : null;
    const key = source ? source.data : null;
    if (!force && preview.handle && preview.key === key && preview.handle.pickMode === (pick && pick.pagePicker)) return;

    const token = ++preview.token;
    if (preview.handle) preview.handle.destroy();
    preview.handle = null;
    preview.key = key;
    $("previewName").textContent = source ? source.name : "";
    const host = $("previewHost");
    if (!source) {
      host.replaceChildren(el("p", { class: "preview-note", text: "Önizleme için bir dosya seçin." }));
      return;
    }
    await previewReady;
    if (token !== preview.token) return;
    const values = readValues();
    const options = {
      name: source.name,
      password: values.password || undefined,
      onSave: (bytes) => saveBytes(bytes, (source.name.replace(/\.[^.]+$/, "") || "belge") + "_isaretli.pdf"),
    };
    if (pick) {
      options.pick = {
        mode: pick.pagePicker,
        selected: parsePages(values[pick.name]),
        onToggle: (page) => togglePage(pick, page),
      };
    }
    // A slower, superseded render must not paint over the current one.
    const frame = el("div");
    host.replaceChildren(frame);
    const handle = await window.SecuriPreview.show(frame, source.data, options);
    if (token !== preview.token) { handle.destroy(); return; }
    handle.pickMode = pick ? pick.pagePicker : undefined;
    preview.handle = handle;
    if (preview.tab === "source" && handle.pageCount) pageCounts.set(source.data, handle.pageCount);
  }

  function togglePage(field, page) {
    const input = $("f-" + field.name);
    const pages = parsePages(input.value);
    if (pages.has(page)) pages.delete(page); else pages.add(page);
    input.value = formatPages(pages);
    if (state.preview.handle) state.preview.handle.setSelected(pages);
    $("formError").textContent = "";
  }

  // ---- Run ----

  function sourcePageCount() {
    const spec = state.tool.files[0];
    const file = spec && state.files[spec.name][0];
    return file ? pageCounts.get(file) || 0 : 0;
  }

  async function countSourcePages(values) {
    const spec = state.tool.files[0];
    const file = spec && state.files[spec.name][0];
    if (!file || pageCounts.has(file) || !activePicker()) return;
    await previewReady;
    const count = await window.SecuriPreview.countPages(file, values.password);
    if (count) pageCounts.set(file, count);
  }

  function validate(values) {
    for (const spec of state.tool.files) {
      if (!isVisible(spec, values)) continue;
      const count = state.files[spec.name].length;
      const min = spec.min !== undefined ? spec.min : 1;
      if (count < min) {
        return min > 1 ? `${spec.label}: en az ${min} dosya seçin.` : `${spec.label}: dosya seçin.`;
      }
    }
    for (const field of state.tool.fields) {
      if (!isVisible(field, values)) continue;
      const value = values[field.name];
      if (field.required && value === "") return `${field.label} boş bırakılamaz.`;
      if (field.type === "number" && value !== "") {
        const number = Number(value.replace(",", "."));
        if (!Number.isFinite(number)) return `${field.label} bir sayı olmalı.`;
        if (field.min !== undefined && number < field.min) return `${field.label} en az ${field.min} olmalı.`;
        if (field.max !== undefined && number > field.max) return `${field.label} en fazla ${field.max} olmalı.`;
      }
      const total = field.pagePicker && value !== "" ? sourcePageCount() : 0;
      if (total) {
        const beyond = Array.from(parsePages(value)).filter((page) => page > total);
        if (beyond.length) return `${field.label}: belgede ${total} sayfa var (${beyond.join(", ")} yok).`;
        if (field.pagePicker === "remove" && parsePages(value).size >= total) {
          return "Tüm sayfalar silinemez; en az bir sayfa kalmalı.";
        }
      }
    }
    return state.tool.validate ? state.tool.validate(values) : null;
  }

  function buildForm(values) {
    const form = new FormData();
    state.tool.files.forEach((spec) => {
      if (!isVisible(spec, values)) return;
      state.files[spec.name].forEach((file) => form.append(spec.name, file, file.name));
    });
    state.tool.fields.forEach((field) => {
      if (field.local || !isVisible(field, values)) return;
      let value = values[field.name];
      if (field.type === "checks") {
        value.forEach((item) => form.append(field.name, item));
        return;
      }
      if (field.type === "checkbox") value = value ? "true" : "false";
      else if (field.type === "number") value = value.replace(",", ".");
      if (value === "" && field.type !== "checkbox") return;
      const times = field.perFile ? state.files[field.perFile].length : 1;
      for (let i = 0; i < times; i++) form.append(field.name, value);
    });
    const constants = typeof state.tool.constants === "function"
      ? state.tool.constants(values)
      : state.tool.constants || {};
    Object.entries(constants).forEach(([key, value]) => form.append(key, value));
    return form;
  }

  function outputExtension(bytes) {
    const ascii = (start, end) => String.fromCharCode.apply(null, bytes.subarray(start, end));
    if (ascii(0, 4) === "%PDF") return "pdf";
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
    if (ascii(0, 4) === "GIF8") return "gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    return "bin";
  }

  function outputName(bytes) {
    const first = state.files[state.tool.files[0].name][0];
    const base = first.name.replace(/\.[^.]+$/, "") || "belge";
    const suffix = state.tool.suffix ? "_" + state.tool.suffix : "";
    return `${base}${suffix}.${state.tool.outputExt || outputExtension(bytes)}`;
  }

  // Callers re-render files or the preview afterwards; refreshing here could
  // read fields that belong to the previous tool.
  function clearResult() {
    state.result = null;
    $("result").hidden = true;
    $("tabResult").disabled = true;
    state.preview.tab = "source";
    $("tabSource").setAttribute("aria-selected", "true");
    $("tabResult").setAttribute("aria-selected", "false");
  }

  async function callEngine(apiPath, form) {
    const request = new Request("http://local.invalid/", { method: "POST", body: form });
    const body = new Uint8Array(await request.arrayBuffer());
    const output = await core.invoke("run_local_tool", body, {
      headers: {
        "x-securipdf-api-path": apiPath,
        "x-securipdf-content-type": request.headers.get("content-type"),
      },
    });
    return new Uint8Array(output);
  }

  async function engineGet(apiPath) {
    return JSON.parse(await core.invoke("local_engine_get", { apiPath }));
  }

  async function htmlToPdf(html, page) {
    return new Uint8Array(await core.invoke("html_to_pdf", { html, page }));
  }

  async function office(file, format) {
    const body = new Uint8Array(await file.arrayBuffer());
    const output = await core.invoke("office_convert", body, {
      headers: {
        "x-securipdf-file-name": encodeURIComponent(file.name),
        "x-securipdf-office-format": format,
      },
    });
    return new Uint8Array(output);
  }

  async function execute(tool, values) {
    let note = "";
    const bytes = tool.run
      ? await tool.run({
        files: state.files,
        values,
        engine: callEngine,
        engineGet,
        form: () => buildForm(values),
        htmlToPdf,
        office,
        note: (text) => { note = text; },
      })
      : await callEngine(typeof tool.apiPath === "function" ? tool.apiPath(values) : tool.apiPath, buildForm(values));
    return { bytes, note };
  }

  async function runTool(event) {
    event.preventDefault();
    if (state.busy || (needsEngine(state.tool) && state.engine !== "ready")) return;
    const values = readValues();
    await countSourcePages(values);
    if (state.busy) return;
    const problem = validate(values);
    $("formError").textContent = problem || "";
    if (problem) return;

    const tool = state.tool;
    state.busy = true;
    clearResult();
    refreshPreview();
    updateRunButton();
    const started = Date.now();
    try {
      const { bytes, note } = await execute(tool, values);
      if (state.tool !== tool) return;
      state.result = { bytes, name: outputName(bytes) };
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      $("resultText").textContent = `Hazır: ${state.result.name} (${formatSize(bytes.length)}, ${seconds} sn)${note ? ". " + note : ""}`;
      $("continue").hidden = outputExtension(bytes) !== "pdf";
      $("result").hidden = false;
      $("tabResult").disabled = false;
      setTab("result");
    } catch (err) {
      $("formError").textContent = errorText(err);
    } finally {
      state.busy = false;
      updateRunButton();
    }
  }

  /** Returns the saved path, or null when the user cancels the dialog. */
  function saveBytes(bytes, name) {
    return core.invoke("save_output", bytes, {
      headers: { "x-securipdf-file-name": encodeURIComponent(name) },
    });
  }

  async function saveResult() {
    if (!state.result) return;
    const button = $("save");
    button.disabled = true;
    try {
      const saved = await saveBytes(state.result.bytes, state.result.name);
      if (saved) $("resultText").textContent = `Kaydedildi: ${saved}`;
    } catch (err) {
      $("formError").textContent = errorText(err);
    } finally {
      button.disabled = false;
    }
  }

  function continueWithResult() {
    if (!state.result) return;
    const file = new File([state.result.bytes], state.result.name, { type: "application/pdf" });
    const next = acceptsPdf(state.tool.files[0]) ? state.tool : tools.find((tool) => acceptsPdf(tool.files[0]));
    state.preview.file = file;
    selectTool(next.id, [file]);
  }

  // ---- Files opened with the app ----

  async function loadOpenedFiles() {
    if (!core) return;
    const opened = await core.invoke("take_opened_files").catch(() => []);
    if (!opened.length) return;
    const files = [];
    for (const item of opened) {
      try {
        const data = await core.invoke("read_opened_file", { path: item.path });
        files.push(new File([data], item.name, { type: "application/pdf" }));
      } catch (err) {
        $("formError").textContent = errorText(err);
      }
    }
    if (!files.length) return;
    if (!acceptsPdf(state.tool.files[0])) selectTool("merge-pdfs");
    addFiles(state.tool.files[0], files);
    previewFile(files[0]);
    hideSplash();
  }

  $("toolForm").addEventListener("submit", runTool);
  $("splashSkip").addEventListener("click", hideSplash);
  $("save").addEventListener("click", saveResult);
  $("continue").addEventListener("click", continueWithResult);
  $("tabSource").addEventListener("click", () => setTab("source"));
  $("tabResult").addEventListener("click", () => { if (state.result) setTab("result"); });
  $("search").addEventListener("input", (event) => renderToolList(event.target.value));
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  // ---- Command line (see cli.rs): the window stays hidden and reports back ----

  function cliFinish(status, body, headers = {}) {
    return core.invoke("cli_finish", body, { headers: { "x-securipdf-cli-status": status, ...headers } });
  }

  function cliFail(code, message) {
    return cliFinish("error", new TextEncoder().encode(JSON.stringify({ code, message })));
  }

  function describeTool(tool) {
    return {
      id: tool.id,
      title: tool.title,
      description: tool.description,
      accepts: tool.files[0].accept,
      multiple: Boolean(tool.files[0].multiple),
      usesEngine: needsEngine(tool),
      settings: tool.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        default: field.default,
        values: field.options && !field.load ? field.options.map((option) => option.value) : undefined,
      })),
    };
  }

  function applySetting(tool, name, value) {
    const field = tool.fields.find((item) => item.name === name);
    if (!field) {
      return `"${tool.id}" aracında "${name}" ayarı yok. Ayarlar: ${tool.fields.map((item) => item.name).join(", ") || "yok"}.`;
    }
    const input = $("f-" + name);
    const allowed = field.options ? field.options.map((option) => String(option.value)) : null;
    if (field.type === "checkbox") {
      input.checked = /^(1|true|evet|yes|on)$/i.test(value);
    } else if (field.type === "checks") {
      const wanted = value.split(",").map((item) => item.trim()).filter(Boolean);
      const unknown = wanted.filter((item) => !allowed.includes(item));
      if (unknown.length) return `${name}: geçersiz değer (${unknown.join(", ")}). Geçerli: ${allowed.join(", ")}.`;
      input.querySelectorAll("input").forEach((box) => { box.checked = wanted.includes(box.value); });
    } else if (field.load) {
      input.replaceChildren(el("option", { value, text: value }));
      state.loadedOptions.add(field.name);
    } else if (field.type === "select") {
      if (!allowed.includes(value)) return `${name}: geçersiz değer "${value}". Geçerli: ${allowed.join(", ")}.`;
      input.value = value;
    } else {
      input.value = value;
    }
    return null;
  }

  function waitForEngine() {
    return new Promise((resolve) => {
      const check = () => core.invoke("local_engine_status").then((status) => {
        setEngine(status.state, status.detail);
        if (status.state === "starting") setTimeout(check, 500);
        else resolve();
      }).catch((err) => { setEngine("failed", errorText(err)); resolve(); });
      check();
    });
  }

  async function runCli(job) {
    try {
      if (job.listTools) {
        await cliFinish("list", new TextEncoder().encode(JSON.stringify(tools.map(describeTool))));
        return;
      }
      const tool = tools.find((item) => item.id === job.tool);
      if (!tool) {
        await cliFail("UNKNOWN_TOOL", `Bilinmeyen araç: ${job.tool}. Araçların listesi için --list-tools kullanın.`);
        return;
      }
      selectTool(tool.id);
      const spec = tool.files[0];
      const files = [];
      for (const input of job.inputs) {
        const data = await core.invoke("read_opened_file", { path: input.path });
        files.push(new File([data], input.name, { type: /\.pdf$/i.test(input.name) ? "application/pdf" : "" }));
      }
      if (files.some((file) => !matchesAccept(file, spec.accept))) {
        await cliFail("INPUT", `"${tool.id}" aracı bu dosya türünü kabul etmez (${spec.accept}).`);
        return;
      }
      if (!spec.multiple && files.length > 1) {
        await cliFail("USAGE", `"${tool.id}" aracı tek dosya alır.`);
        return;
      }
      state.files[spec.name] = files;
      for (const [name, value] of Object.entries(job.params)) {
        const problem = applySetting(tool, name, value);
        if (problem) {
          await cliFail("UNKNOWN_PARAM", problem);
          return;
        }
      }
      applyVisibility();
      const values = readValues();
      await previewReady;
      if (needsEngine(tool)) {
        await core.invoke("cli_start_engine");
        await waitForEngine();
        if (state.engine !== "ready") {
          await cliFail("ENGINE", $("engine").title || "PDF motoru başlatılamadı.");
          return;
        }
      }
      await countSourcePages(values);
      const problem = validate(values);
      if (problem) {
        await cliFail("INVALID", problem);
        return;
      }
      const { bytes, note } = await execute(tool, values);
      const headers = { "x-securipdf-file-name": encodeURIComponent(outputName(bytes)) };
      if (note) headers["x-securipdf-cli-note"] = encodeURIComponent(note);
      await cliFinish("ok", bytes, headers);
    } catch (err) {
      await cliFail("TOOL", errorText(err));
    }
  }

  // ---- Explorer right-click menu ----

  async function initShellMenu() {
    const box = $("shellMenu");
    box.checked = await core.invoke("shell_menu_status").catch(() => false);
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        box.checked = await core.invoke("shell_menu_set", { enabled: box.checked });
      } catch (err) {
        box.checked = !box.checked;
        $("formError").textContent = errorText(err);
      } finally {
        box.disabled = false;
      }
    });
  }

  // Read-only view used by the automated UI tests.
  window.SecuriApp = { lastResult: () => state.result && { name: state.result.name, bytes: state.result.bytes.slice() } };

  selectTool(tools[0].id);
  (async () => {
    const job = core ? await core.invoke("cli_job").catch(() => null) : null;
    if (job) {
      runCli(job);
      return;
    }
    pollEngine();
    loadOpenedFiles();
    if (core) initShellMenu();
    if (tauri && tauri.event) tauri.event.listen("securipdf-opened", loadOpenedFiles);
  })();
})();

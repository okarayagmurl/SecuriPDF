(function () {
  const tauri = window.__TAURI__;
  const core = tauri && tauri.core;
  const tools = window.SECURIPDF_TOOLS;
  const categories = window.SECURIPDF_CATEGORIES;
  const $ = (id) => document.getElementById(id);
  const t = (text) => (window.SecuriI18n ? window.SecuriI18n.t(text) : text);

  const state = {
    tool: null,
    files: {},
    result: null,
    engine: "starting",
    busy: false,
    batch: false,
    preview: { tab: "source", file: null, handle: null, token: 0 },
    license: null,
    policy: null,
  };

  const previewReady = window.SecuriPreview
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener("securipreview-ready", resolve, { once: true }));
  const pageCounts = new WeakMap();

  const ERRORS = {
    LOCAL_ENGINE_NOT_READY: "Ön gereksinimler henüz hazır değil. Biraz bekleyip tekrar deneyin.",
    LOCAL_ENGINE_UNREACHABLE: "Ön gereksinimlere ulaşılamadı. Uygulamayı kapatıp yeniden açın.",
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
    OFFICE_MISSING: "Bu dönüşüm için Microsoft Office gerekir. Office belgesinden PDF, Office yoksa LibreOffice ile de yapılır. PDF'i Word belgesine çevirmek için Word şarttır.",
    OFFICE_OPEN_FAILED: "Office belgeyi açamadı. Dosya bozuk veya parola korumalı olabilir.",
    OFFICE_EXPORT_FAILED: "Office belgeyi dönüştüremedi.",
    OFFICE_BAD_INPUT: "Bu dosya türü bu dönüşümde desteklenmiyor.",
    OFFICE_PDFA_WORD_ONLY: "Excel PDF/A çıktısı vermez. PDF seçin, ardından \"PDF/A'ya dönüştür\" aracını kullanın.",
    OFFICE_TIMEOUT: "Office 3 dakika içinde yanıt vermedi ve kapatıldı. Office'i bir kez elle açıp bekleyen bir uyarı (etkinleştirme, duyarlılık etiketi vb.) olup olmadığını kontrol edin.",
    OFFICE_SCRIPT_FAILED: "Office dönüştürücüsü başlatılamadı (PowerShell bulunamadı veya engellendi).",
    LICENSE_EXPIRED: "Lisans süresi doldu. Üst çubuktaki Lisans düğmesinden .lic yükleyin.",
    LICENSE_REQUIRED: "Çalıştırmak için geçerli bir lisans veya deneme süresi gerekir.",
    POLICY_TIMESTAMP: "Kurum ilkesi zaman damgasını kapatmış.",
    POLICY_SHELL: "Gezgin menüsü kurum ilkesiyle kilitli.",
    POLICY_TOOL: "Kurum ilkesi bu aracı kapatmış.",
    POLICY_GROUP: "Kurum ilkesi bu kullanıcıya SecuriPDF izni vermiyor.",
    GHOSTSCRIPT_MISSING: "PDF/A ve PDF/X dönüşümü Ghostscript ister. SecuriPDF'i kapatıp yeniden açın; sürmezse yeni kurucuyu yükleyin.",
  };

  function isGhostscriptFailure(text) {
    return /ghostscript|pdf\/?x conversion|pdf\/?a conversion failed/i.test(text || "");
  }

  function errorText(err) {
    const code = typeof err === "string" ? err : (err && err.message) || String(err);
    if (ERRORS[code]) return t(ERRORS[code]);
    const prefixed = Object.keys(ERRORS).find((key) => code.startsWith(key + ":"));
    if (prefixed) return t(ERRORS[prefixed]);
    if (isGhostscriptFailure(code)) return t(ERRORS.GHOSTSCRIPT_MISSING);
    const http = /^LOCAL_HTTP_(\d+)(?::([\s\S]*))?$/.exec(code);
    if (http) {
      if (isGhostscriptFailure(http[2] || "")) return t(ERRORS.GHOSTSCRIPT_MISSING);
      const specific = state.tool && state.tool.httpError && state.tool.httpError(Number(http[1]), http[2] || "");
      if (specific) return t(specific);
      return t(Number(http[1]) >= 500
        ? "İşlem tamamlanamadı. Dosya bozuk olabilir, parola yanlış olabilir veya seçenek dosyaya uymuyor olabilir."
        : "Seçenekler kabul edilmedi. Değerleri kontrol edin.");
    }
    return t(code);
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
      if (key === "text") node.textContent = t(value);
      else if (key === "placeholder" || key === "title" || key === "aria-label") node.setAttribute(key, t(value));
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
    [15, "Ön gereksinimler hazırlanıyor…"],
    [55, "Ayarlar yükleniyor…"],
    [85, "Araçlar hazırlanıyor…"],
    [100, "Son hazırlıklar yapılıyor…"],
  ];
  const splash = { shown: 12, versionSet: false, closed: false };

  function updateSplash(status) {
    if (!splash.versionSet && status.appVersion) {
      splash.versionSet = true;
      const parts = [`Sürüm ${status.appVersion}`];
      if (status.engineVersion) parts.push(`PDF ${status.engineVersion}`);
      if (status.ocrVersion) parts.push(`OCR ${status.ocrVersion.split(".").slice(0, 3).join(".")}`);
      $("splashVersion").textContent = parts.join(" · ");
      $("brandVersion").textContent = `v${status.appVersion}`;
      $("brandVersion").title = parts.join(" · ");
    }
    if (splash.closed) return;

    if (status.state === "failed" || status.state === "missing") {
      $("splashStage").textContent = t("Ön gereksinimler hazırlanamadı.");
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
    badge.textContent = t({
      ready: "Hazır",
      starting: "Ön gereksinimler hazırlanıyor…",
      failed: "Hazırlık başarısız",
      missing: "Kurulum eksik",
    }[engineState] || engineState);
    badge.title = detail || (engineState === "starting"
      ? t("Bu sırada dosya seçip önizleyebilirsiniz.")
        : "");
    updateRunButton();
    if (engineState === "ready" && state.tool && state.loadedOptions) applyVisibility();
  }

  // Tools with their own `run` work in the UI and only need the engine when they say so.
  function needsEngine(tool) {
    return Boolean(tool && !tool.viewer && (!tool.run || tool.usesEngine));
  }

  function isViewerTool(tool) {
    return Boolean(tool && tool.viewer);
  }

  const PROCESS_STEPS = [
    { id: "auto-rotate-pdf", label: "Döndür", title: "Yan ve ters sayfaları düzelt" },
    { id: "ocr-pdf", label: "OCR", title: "Taranmış sayfayı aranabilir yap" },
    { id: "redact", label: "Karart", title: "Kişisel veriyi kalıcı kapat" },
    { id: "cert-sign", label: "İmzala", title: "Dijital imza ekle" },
  ];
  const PROCESS_MORE = [
    { id: "compress-pdf", label: "Sıkıştır" },
    { id: "pdf-to-word", label: "Word" },
    { id: "merge-pdfs", label: "Birleştir" },
    { id: "office-to-pdf", label: "Office → PDF" },
  ];

  function sessionPdf() {
    if (state.result && /\.pdf$/i.test(state.result.name || "")) {
      return new File([state.result.bytes], state.result.name, { type: "application/pdf" });
    }
    const open = state.preview.file || (state.tool && allFiles()[0]);
    return open && /\.pdf$/i.test(open.name || "") ? open : null;
  }

  function applyToSession(toolId) {
    const file = sessionPdf();
    selectTool(toolId, file ? [file] : []);
  }

  function renderProcess() {
    const box = $("process");
    const steps = $("processSteps");
    const more = $("processMore");
    if (!box || !steps || !more) return;
    const allowed = new Set(allowedTools().map((tool) => tool.id));
    const file = sessionPdf();
    const hasResult = Boolean(state.result && /\.pdf$/i.test(state.result.name || ""));
    box.hidden = false;
    $("processLabel").textContent = t(hasResult
      ? "Sonuçla sonraki adım"
      : file
        ? "Bu belgeyle sonraki adım"
        : "Önerilen süreç");
    steps.replaceChildren();
    let stepNo = 0;
    PROCESS_STEPS.forEach((step) => {
      if (!allowed.has(step.id)) return;
      stepNo += 1;
      const item = el("li");
      if (steps.childElementCount) item.appendChild(el("span", { class: "join", text: "→" }));
      item.appendChild(el("button", {
        type: "button",
        title: step.title,
        disabled: !file,
        "aria-current": state.tool && state.tool.id === step.id ? "true" : undefined,
        onclick: () => applyToSession(step.id),
      }, [
        el("span", { class: "n", text: String(stepNo) }),
        el("span", { text: step.label }),
      ]));
      steps.appendChild(item);
    });
    more.replaceChildren();
    PROCESS_MORE.forEach((step) => {
      if (!allowed.has(step.id)) return;
      more.appendChild(el("button", {
        type: "button",
        text: step.label,
        disabled: step.id !== "office-to-pdf" && step.id !== "merge-pdfs" && !file,
        onclick: () => applyToSession(step.id),
      }));
    });
    const catalog = $("processTools");
    if (!catalog) return;
    const home = state.tool && state.tool.id === "open-pdf";
    catalog.hidden = !home;
    catalog.replaceChildren();
    if (!home) return;
    const shown = new Set(PROCESS_STEPS.concat(PROCESS_MORE).map((step) => step.id));
    const toolButton = (tool) => {
      const spec = tool.files && tool.files[0];
      const needsPdf = Boolean(spec && acceptsPdf(spec));
      const optional = tool.id === "merge-pdfs" || tool.id === "office-to-pdf";
      const button = el("button", {
        type: "button",
        title: tool.description || tool.title,
        disabled: !optional && needsPdf && !file,
        onclick: () => applyToSession(tool.id),
      });
      const icon = (window.SECURIPDF_MENU_ICONS || {})[tool.id];
      if (icon) {
        const mark = document.createElement("span");
        mark.className = "tool-icon";
        mark.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
        button.appendChild(mark);
      }
      button.appendChild(el("span", { text: tool.title }));
      return button;
    };
    const favorites = readFavorites().filter((id) => allowed.has(id) && id !== "open-pdf");
    if (favorites.length) {
      catalog.appendChild(el("p", { class: "process-label", text: "Sık kullanılanlar" }));
      const row = el("div", { class: "process-cat-tools" });
      favorites.forEach((id) => {
        const tool = allowedTools().find((item) => item.id === id);
        if (tool) row.appendChild(toolButton(tool));
      });
      catalog.appendChild(row);
    }
    const favoriteIds = new Set(favorites);
    const sections = [];
    categories.forEach((category) => {
      const items = allowedTools().filter((tool) => tool.category === category.id && tool.id !== "open-pdf" && !shown.has(tool.id) && !favoriteIds.has(tool.id));
      if (!items.length) return;
      const row = el("div", { class: "process-cat-tools" });
      items.forEach((tool) => row.appendChild(toolButton(tool)));
      sections.push(el("section", { class: "process-cat" }, [
        el("h3", { text: category.title }),
        row,
      ]));
    });
    if (sections.length) {
      catalog.appendChild(el("p", { class: "process-label", text: "Diğer araçlar" }));
      sections.forEach((section) => catalog.appendChild(section));
    }
  }

  let workTimer = null;
  let workDepth = 0;

  function showWork(label) {
    const box = $("workProgress");
    const bar = $("workBar");
    const text = $("workLabel");
    if (box) box.hidden = false;
    if (bar) {
      bar.classList.add("indeterminate");
      bar.style.width = "";
    }
    const started = Date.now();
    const title = label || "İşleniyor…";
    if (text) text.textContent = title;
    if (workTimer) clearInterval(workTimer);
    workTimer = setInterval(() => {
      if (!text) return;
      const seconds = Math.floor((Date.now() - started) / 1000);
      text.textContent = seconds ? `${title} ${seconds} sn` : title;
    }, 250);
  }

  function beginWork(label) {
    workDepth += 1;
    state.busy = true;
    if (workDepth === 1) showWork(label);
    updateRunButton();
  }

  function endWork() {
    workDepth = Math.max(0, workDepth - 1);
    if (workDepth > 0) return;
    state.busy = false;
    if (workTimer) {
      clearInterval(workTimer);
      workTimer = null;
    }
    const box = $("workProgress");
    const bar = $("workBar");
    if (box) box.hidden = true;
    if (bar) {
      bar.classList.add("indeterminate");
      bar.style.width = "";
    }
    updateRunButton();
  }

  async function withWork(label, fn) {
    beginWork(label);
    try {
      return await fn();
    } finally {
      endWork();
    }
  }

  function setWorkFraction(done, total) {
    const bar = $("workBar");
    const text = $("workLabel");
    if (bar) {
      bar.classList.remove("indeterminate");
      bar.style.width = Math.max(6, Math.round((done / Math.max(total, 1)) * 100)) + "%";
    }
    if (text) text.textContent = `İşleniyor… ${done}/${total}`;
    $("run").textContent = `İşleniyor… ${done}/${total}`;
  }

  function updateRunButton() {
    const run = $("run");
    const waiting = needsEngine(state.tool) && state.engine !== "ready";
    const unlicensed = state.license && !state.license.valid;
    const viewing = isViewerTool(state.tool);
    const home = state.tool && state.tool.id === "open-pdf";
    const hasFile = Boolean(state.tool && allFiles()[0]);
    run.hidden = viewing;
    $("openViewer").hidden = !viewing || !hasFile;
    $("toWord").hidden = !viewing || !hasFile;
    document.body.classList.toggle("viewing", viewing);
    document.body.classList.toggle("home", home);
    renderProcess();
    run.disabled = viewing || state.busy || waiting || unlicensed;
    run.textContent = state.busy ? t("İşleniyor…") : waiting ? t("Ön gereksinimler hazırlanıyor…") : t("Çalıştır");
    if (unlicensed && !viewing) run.textContent = t("Lisans gerekli");
    $("openViewer").disabled = viewing && !hasFile;
    $("toWord").disabled = viewing && !hasFile;
    if (needsEngine(state.tool) && (state.engine === "failed" || state.engine === "missing")) {
      run.textContent = t("Hazır değil");
      $("formError").textContent = ($("engine").title || "Ön gereksinimler hazırlanamadı.") +
        " Kayıt: %LOCALAPPDATA%\\net.entera.securipdf.desktop\\engine\\engine.log";
    }
  }

  // ---- Tool list ----

  function allowedTools() {
    const blocked = ((state.policy && state.policy.blockedTools) || []).map((id) => String(id).toLowerCase());
    return tools.filter((tool) => !blocked.includes(String(tool.id).toLowerCase()));
  }

  function renderToolList(filter) {
    const query = (filter || "").trim().toLocaleLowerCase("tr");
    const list = $("toolList");
    list.replaceChildren();
    categories.forEach((category) => {
      const items = allowedTools().filter((tool) => tool.category === category.id &&
        (!query || (tool.title + " " + tool.description).toLocaleLowerCase("tr").includes(query)));
      if (!items.length) return;
      list.appendChild(el("h2", { text: category.title }));
      items.forEach((tool) => {
        const button = el("button", {
          type: "button",
          "aria-current": state.tool && state.tool.id === tool.id ? "true" : undefined,
          onclick: () => selectTool(tool.id),
        });
        const icon = (window.SECURIPDF_MENU_ICONS || {})[tool.id];
        if (icon) {
          const mark = document.createElement("span");
          mark.className = "tool-icon";
          mark.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
          button.appendChild(mark);
        }
        button.appendChild(el("span", { text: tool.title }));
        list.appendChild(button);
      });
    });
  }

  function acceptsPdf(spec) {
    return /\.pdf|application\/pdf/.test(spec.accept || "");
  }

  // Tools that take one file can run on many, one after another.
  function canBatch(tool) {
    return !tool.files[0].multiple && tool.batch !== false;
  }

  function isMultiple(spec) {
    return Boolean(spec.multiple || (state.batch && spec === state.tool.files[0]));
  }

  let officeNoteToken = 0;

  function officeNoteText(kind, status) {
    const office = Boolean(status.word || status.excel || status.powerpoint);
    if (kind === "word") {
      return status.word
        ? "Bu bilgisayarda Microsoft Word var. Dönüşüm Word ile yapılır."
        : "Bu bilgisayarda Microsoft Word yok. PDF → Word yalnızca Word ile çalışır; LibreOffice bu aracı karşılamaz.";
    }
    if (kind === "ppt") {
      return status.powerpoint || status.libre
        ? "Bu bilgisayarda PowerPoint veya LibreOffice var. Metin slayt LibreOffice ile, görsel slayt PowerPoint ile üretilebilir."
        : "Bu bilgisayarda PowerPoint ve LibreOffice yok. Sayfalar yine de görsel bir sunum olarak kaydedilir.";
    }
    if (office) return "Bu bilgisayarda Microsoft Office var. Dönüşüm önce Office ile yapılır.";
    if (status.libre) return "Microsoft Office yok. Office belgesinden PDF, bu bilgisayardaki LibreOffice ile yapılır. Sayfa düzeni Word kadar sadık olmayabilir.";
    return "Bu bilgisayarda Microsoft Office da LibreOffice da yok. Office → PDF bu durumda çalışmaz. PDF araçlarının geri kalanı Office istemez.";
  }

  async function refreshOfficeNote() {
    const note = $("officeNote");
    if (!note) return;
    const id = state.tool && state.tool.id;
    const kind = id === "office-to-pdf" ? "office" : id === "pdf-to-word" ? "word" : id === "pdf-to-ppt" ? "ppt" : "";
    if (!kind || !core) {
      note.hidden = true;
      note.textContent = "";
      return;
    }
    const token = ++officeNoteToken;
    note.hidden = false;
    note.textContent = t("Bu bilgisayarda Office ve LibreOffice denetleniyor…");
    let status = null;
    try {
      status = await core.invoke("office_status");
    } catch {
      status = null;
    }
    if (token !== officeNoteToken) return;
    if (!status) {
      note.hidden = true;
      note.textContent = "";
      return;
    }
    note.textContent = t(officeNoteText(kind, status));
  }

  function selectTool(id, carry) {
    const tool = tools.find((item) => item.id === id);
    if (!tool) return;
    const previous = carry || (state.tool ? state.files[state.tool.files[0].name] || [] : []);
    state.tool = tool;
    state.batch = state.batch && canBatch(tool);
    $("batchToggle").hidden = !canBatch(tool);
    $("batch").checked = state.batch;
    state.files = {};
    tool.files.forEach((spec) => { state.files[spec.name] = []; });
    const primary = tool.files[0];
    const carried = previous.filter((file) => matchesAccept(file, primary.accept));
    state.files[primary.name] = isMultiple(primary) ? carried : carried.slice(0, 1);
    clearResult();
    $("tool").hidden = false;
    $("toolTitle").textContent = t(tool.title);
    $("toolDescription").textContent = t(tool.description);
    refreshOfficeNote();
    $("formError").textContent = "";
    $("toolForm").hidden = false;
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
      if (rule === "*/*" || rule === "*") return true;
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return (file.type || "").startsWith(rule.slice(0, -1));
      return file.type === rule;
    });
  }

  function addFiles(spec, fileList) {
    const all = Array.from(fileList);
    const accepted = all.filter((file) => matchesAccept(file, spec.accept));
    $("formError").textContent = accepted.length < all.length
      ? t("Bazı dosyalar bu araç için uygun değil ve eklenmedi.")
      : "";
    if (!accepted.length) return;
    state.files[spec.name] = isMultiple(spec) ? state.files[spec.name].concat(accepted) : [accepted[0]];
    clearResult();
    renderFiles();
    if (isViewerTool(state.tool) && accepted[0] && /\.pdf$/i.test(accepted[0].name)) {
      previewFile(accepted[0]);
      openCurrentViewer(accepted[0]);
    }
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
      const multiple = isMultiple(spec);
      const picker = el("input", {
        type: "file",
        accept: spec.accept,
        multiple,
        hidden: true,
        onchange: (event) => { addFiles(spec, event.target.files); event.target.value = ""; },
      });
      const list = state.files[spec.name];
      const items = list.map((file, index) => el("li", { class: file === state.preview.file ? "previewing" : "" }, [
        spec.preview === false
          ? el("span", { class: "name", text: file.name })
          : el("span", { class: "name link", text: file.name, title: "Önizle", onclick: () => previewFile(file) }),
        el("span", { class: "size", text: formatSize(file.size) }),
        multiple && index > 0 ? el("button", { type: "button", title: "Yukarı taşı", text: "↑", onclick: () => moveFile(spec, index, -1) }) : null,
        multiple && index < list.length - 1 ? el("button", { type: "button", title: "Aşağı taşı", text: "↓", onclick: () => moveFile(spec, index, 1) }) : null,
        el("button", { type: "button", title: "Kaldır", text: "✕", onclick: () => removeFile(spec, index) }),
      ]));
      const home = state.tool && state.tool.id === "open-pdf";
      const dropTitle = document.createElement("strong");
      dropTitle.textContent = home
        ? t("PDF belgesini açın")
        : t(spec.label) + (multiple && !spec.multiple ? " " + t("(her biri ayrı işlenir)") : "");
      const drop = el("div", { class: "drop", "data-files": spec.name, hidden: !isVisible(spec, readValues()) }, [
        el("div", { class: "drop-head" }, [
          dropTitle,
          el("button", { type: "button", class: "secondary", text: multiple ? "Dosya ekle" : "Dosya seç", onclick: () => picker.click() }),
        ]),
        el("p", { class: "drop-hint", text: home
          ? "Dosyayı buraya sürükleyin, seçin veya Birlikte aç ile gönderin."
          : (multiple ? "Dosyaları buraya sürükleyebilirsiniz." : "Dosyayı buraya sürükleyebilirsiniz.") }),
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
        const groups = [];
        field.options.forEach((option) => {
          const name = option.group || "";
          const last = groups[groups.length - 1];
          if (!last || last.name !== name) groups.push({ name, options: [option] });
          else last.options.push(option);
        });
        const box = (option) => el("label", {}, [
          el("input", { type: "checkbox", value: option.value, checked: (field.default || []).includes(option.value) }),
          document.createTextNode(t(option.label)),
        ]);
        input = el("div", { id, class: "checks" + (groups.some((group) => group.name) ? " grouped" : "") },
          groups.flatMap((group) => group.name
            ? [el("div", { class: "check-group" }, [el("span", { class: "check-group-label", text: group.name }), el("div", { class: "checks" }, group.options.map(box))])]
            : group.options.map(box)));
      } else if (field.type === "textarea") {
        input = el("textarea", { id, name: field.name, rows: field.rows || 4, placeholder: field.placeholder, spellcheck: "false" });
        input.value = field.default || "";
      } else if (field.type === "pad") {
        input = el("div", { id, class: "pad", "data-value": String(field.default) }, field.options.map((option) =>
          el("button", {
            type: "button",
            "data-value": option.value,
            title: option.label,
            class: String(option.value) === String(field.default) ? "active" : "",
            text: option.mark || "",
            onclick: () => {
              input.dataset.value = option.value;
              input.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.value === option.value));
              onFieldChange(field);
            },
          })));
      } else if (field.type === "range") {
        const slider = el("input", {
          type: "range", min: field.min, max: field.max, step: field.step || 1,
          value: field.default !== undefined ? String(field.default) : "0",
        });
        const shown = el("span", { class: "value", text: formatRange(field, slider.value) });
        slider.addEventListener("input", () => { shown.textContent = formatRange(field, slider.value); onFieldChange(field); });
        input = el("div", { id, class: "range" }, [slider, shown]);
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
      const kind = ["field", field.type === "checkbox" ? "check" : "", field.cliOnly ? "cli-only" : ""].filter(Boolean).join(" ");
      const wrapper = field.type === "checkbox"
        ? el("div", { class: kind, "data-field": field.name }, [el("label", { for: id }, [input, document.createTextNode(t(field.label))])])
        : el("div", { class: kind, "data-field": field.name }, [el(field.type === "checks" || field.type === "pad" || field.type === "range" ? "span" : "label", { for: id, class: "label", text: field.label }), input]);
      if (field.load) {
        wrapper.appendChild(el("button", { type: "button", class: "secondary refresh", text: "Listeyi yenile", onclick: () => loadOptions(field, true) }));
      }
      if (field.hint) wrapper.appendChild(el("p", { class: "hint", text: field.hint }));
      if (field.advanced) {
        if (!host.querySelector("details.advanced")) {
          host.appendChild(el("details", { class: "advanced" }, [el("summary", { text: "Sayısal değerler" })]));
        }
        host.querySelector("details.advanced").appendChild(wrapper);
      } else {
        host.appendChild(wrapper);
      }
    });
    state.loadedOptions = new Set();
    applyVisibility();
  }

  function formatRange(field, value) {
    const number = Number(value);
    if (field.unit === "%") {
      const percent = number * (field.max <= 1 ? 100 : 1);
      return (Math.round(percent * 10) / 10) + "%";
    }
    if (field.unit) return String(value) + field.unit;
    return String(value);
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
    if (["x", "y", "width", "height"].includes(field.name) && state.preview.handle && state.preview.handle.setCrop) {
      const values = readValues();
      state.preview.handle.setCrop({
        x: Number(values.x) || 0,
        y: Number(values.y) || 0,
        width: Number(values.width) || 0,
        height: Number(values.height) || 0,
      });
    }
    if ((field.pagePicker || field.showIf || field.name === "autoCrop" || field.type === "password" || field.type === "select") && state.preview.tab === "source") {
      const pick = activePicker();
      const crop = activeCrop();
      const handle = state.preview.handle;
      const needsReload = (handle && handle.locked && field.type === "password") ||
        (handle && Boolean(pick) !== Boolean(handle.pickMode)) ||
        (handle && pick && pick.pagePicker !== handle.pickMode) ||
        (handle && Boolean(crop) !== Boolean(handle.cropMode));
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
      else if (field.type === "pad") values[field.name] = input.dataset.value || "";
      else if (field.type === "range") values[field.name] = (input.querySelector("input") || input).value;
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
    const advanced = $("fields").querySelector("details.advanced");
    if (advanced) {
      advanced.hidden = !Array.from(advanced.querySelectorAll("[data-field]")).some((node) => !node.hidden);
    }
  }

  function activePicker() {
    const values = readValues();
    return state.tool.fields.find((field) => field.pagePicker && isVisible(field, values)) || null;
  }

  function activeCrop() {
    if (!state.tool || state.tool.id !== "crop") return null;
    const values = readValues();
    if (values.autoCrop) return null;
    return {
      box: {
        x: Number(values.x) || 0,
        y: Number(values.y) || 0,
        width: Number(values.width) || 0,
        height: Number(values.height) || 0,
      },
      onChange(box) {
        ["x", "y", "width", "height"].forEach((name) => {
          const input = $("f-" + name);
          if (input) input.value = String(box[name]);
        });
      },
    };
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
      ? state.result.preview || { data: state.result.bytes, name: state.result.name }
      : preview.file ? { data: preview.file, name: preview.file.name } : null;
    const pick = preview.tab === "source" ? activePicker() : null;
    const crop = preview.tab === "source" ? activeCrop() : null;
    const key = source ? source.data : null;
    if (!force && preview.handle && preview.key === key
      && preview.handle.pickMode === (pick && pick.pagePicker)
      && preview.handle.cropMode === Boolean(crop)) return;

    const token = ++preview.token;
    if (preview.handle) preview.handle.destroy();
    preview.handle = null;
    preview.key = key;
    $("previewName").textContent = source ? source.name : "";
    const host = $("previewHost");
    if (!source) {
      host.replaceChildren(el("p", { class: "preview-note preview-empty", text: "Bir dosya seçince sayfalar burada görünür." }));
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
    if (crop) options.crop = crop;
    // A slower, superseded render must not paint over the current one.
    const frame = el("div");
    host.replaceChildren(frame);
    const handle = await window.SecuriPreview.show(frame, source.data, options);
    if (token !== preview.token) { handle.destroy(); return; }
    handle.pickMode = pick ? pick.pagePicker : undefined;
    handle.cropMode = Boolean(crop);
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
      if ((field.type === "number" || field.type === "range") && value !== "") {
        const number = Number(String(value).replace(",", "."));
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

  function buildForm(values, files = state.files) {
    const form = new FormData();
    state.tool.files.forEach((spec) => {
      if (!isVisible(spec, values)) return;
      files[spec.name].forEach((file) => form.append(spec.name, file, file.name));
    });
    state.tool.fields.forEach((field) => {
      if (field.local || !isVisible(field, values)) return;
      let value = values[field.name];
      if (field.type === "checks") {
        value.forEach((item) => form.append(field.name, item));
        return;
      }
      if (field.type === "checkbox") value = value ? "true" : "false";
      else if (field.type === "number" || field.type === "range") value = String(value).replace(",", ".");
      if (value === "" && field.type !== "checkbox") return;
      const times = field.perFile ? files[field.perFile].length : 1;
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
    if (ascii(0, 2) === "BM") return "bmp";
    return "bin";
  }

  function outputName(bytes, files = state.files) {
    const first = files[state.tool.files[0].name][0];
    const base = first.name.replace(/\.[^.]+$/, "") || "belge";
    const suffix = state.tool.suffix ? "_" + state.tool.suffix : "";
    const ext = typeof state.tool.outputExt === "function" ? state.tool.outputExt(bytes) : state.tool.outputExt;
    return `${base}${suffix}.${ext || outputExtension(bytes)}`;
  }

  // Callers re-render files or the preview afterwards; refreshing here could
  // read fields that belong to the previous tool.
  function clearResult() {
    state.result = null;
    $("result").hidden = true;
    $("save").textContent = "Kaydet…";
    $("saveFolder").hidden = true;
    $("tabResult").disabled = true;
    state.preview.tab = "source";
    $("tabSource").setAttribute("aria-selected", "true");
    $("tabResult").setAttribute("aria-selected", "false");
  }

  async function callEngine(apiPath, form, quiet) {
    const run = async () => {
      const request = new Request("http://local.invalid/", { method: "POST", body: form });
      const body = new Uint8Array(await request.arrayBuffer());
      const output = await core.invoke("run_local_tool", body, {
        headers: {
          "x-securipdf-api-path": apiPath,
          "x-securipdf-content-type": request.headers.get("content-type"),
        },
      });
      return new Uint8Array(output);
    };
    return quiet ? run() : withWork("İşleniyor…", run);
  }

  async function engineGet(apiPath) {
    return JSON.parse(await core.invoke("local_engine_get", { apiPath }));
  }

  async function callEngineJson(apiPath, payload, quiet) {
    const run = async () => {
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const output = await core.invoke("run_local_tool", body, {
        headers: {
          "x-securipdf-api-path": apiPath,
          "x-securipdf-content-type": "application/json",
        },
      });
      return new Uint8Array(output);
    };
    return quiet ? run() : withWork("İşleniyor…", run);
  }

  async function htmlToPdf(html, page) {
    return withWork("PDF üretiliyor…", async () => new Uint8Array(await core.invoke("html_to_pdf", { html, page })));
  }

  async function scan(file) {
    return withWork("Taranıyor…", async () => {
      const body = new Uint8Array(await file.arrayBuffer());
      return JSON.parse(await core.invoke("scan_file", body, {
        headers: { "x-securipdf-file-name": encodeURIComponent(file.name) },
      }));
    });
  }

  async function assemblePdf(parts) {
    const chunks = [new TextEncoder().encode("SPDF")];
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, parts.length, true);
    chunks.push(count);
    const enc = new TextEncoder();
    parts.forEach((part) => {
      const spec = enc.encode(part.pages || "1-z");
      const specLen = new Uint8Array(4);
      new DataView(specLen.buffer).setUint32(0, spec.length, true);
      const pdfLen = new Uint8Array(4);
      new DataView(pdfLen.buffer).setUint32(0, part.bytes.length, true);
      chunks.push(specLen, spec, pdfLen, part.bytes);
    });
    let size = 0;
    chunks.forEach((chunk) => { size += chunk.length; });
    const body = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => { body.set(chunk, offset); offset += chunk.length; });
    return withWork("Sayfalar birleştiriliyor…", async () => new Uint8Array(await core.invoke("assemble_pdf", body)));
  }

  async function repair(file) {
    return withWork("Onarılıyor…", async () => {
      const body = new Uint8Array(await file.arrayBuffer());
      const output = await core.invoke("repair_pdf", body, {
        headers: { "x-securipdf-file-name": encodeURIComponent(file.name) },
      });
      return new Uint8Array(output);
    });
  }

  async function makeQr(text) {
    return new Uint8Array(await core.invoke("make_qr", { text }));
  }

  async function addFormFields(bytes, fields) {
    return withWork("Form alanı ekleniyor…", async () => {
      const output = await core.invoke("add_form_fields", bytes, {
        headers: { "x-securipdf-form-fields": encodeURIComponent(JSON.stringify(fields)) },
      });
      return new Uint8Array(output);
    });
  }

  async function office(file, format) {
    return withWork("Dönüştürülüyor…", async () => {
      const body = new Uint8Array(await file.arrayBuffer());
      const output = await core.invoke("office_convert", body, {
        headers: {
          "x-securipdf-file-name": encodeURIComponent(file.name),
          "x-securipdf-office-format": format,
        },
      });
      return new Uint8Array(output);
    });
  }

  async function execute(tool, values, files = state.files) {
    let note = "";
    const produced = tool.run
      ? await tool.run({
        files,
        values,
        engine: callEngine,
        engineGet,
        form: () => buildForm(values, files),
        htmlToPdf,
        office,
        addFormFields,
        repair,
        scan,
        makeQr,
        assemble: assemblePdf,
        note: (text) => { note = text; },
      })
      : await callEngine(typeof tool.apiPath === "function" ? tool.apiPath(values) : tool.apiPath, buildForm(values, files));
    const bytes = produced instanceof Uint8Array ? produced : produced.bytes;
    const name = produced instanceof Uint8Array ? "" : (produced.name || "");
    return { bytes, note, name };
  }

  /** Runs the tool once per file; results and a report are kept for a ZIP or a folder. */
  async function executeBatch(tool, values, onProgress) {
    const primary = tool.files[0].name;
    const inputs = state.files[primary];
    const outputs = [];
    const rows = [];
    const taken = new Set();
    for (let i = 0; i < inputs.length; i++) {
      onProgress(i + 1, inputs.length);
      const input = inputs[i];
      const files = { ...state.files, [primary]: [input] };
      const started = Date.now();
      try {
        const { bytes, note, name: given } = await execute(tool, values, files);
        let name = given || outputName(bytes, files);
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = (given || outputName(bytes, files)).replace(/(\.[^.]+)?$/, ` (${n})$1`);
        taken.add(name.toLowerCase());
        outputs.push({ name, data: bytes });
        rows.push([input.name, "Başarılı", name, String(bytes.length), ((Date.now() - started) / 1000).toFixed(1), note]);
      } catch (err) {
        rows.push([input.name, "Hata", "", "", ((Date.now() - started) / 1000).toFixed(1), errorText(err)]);
      }
    }
    // Excel runs cells that start with =, +, - or @ as formulas.
    const cell = (raw) => {
      const value = /^[=+\-@]/.test(raw) ? "'" + raw : raw;
      return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };
    const report = "\uFEFF" + [["Dosya", "Durum", "Çıktı", "Boyut (bayt)", "Süre (sn)", "Not"], ...rows]
      .map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
    return { outputs, report: new TextEncoder().encode(report), failed: rows.filter((row) => row[1] === "Hata").length };
  }

  async function openCurrentViewer(file) {
    let source = file || state.preview.file || allFiles()[0];
    if (!source || !/\.pdf$/i.test(source.name || "")) return;
    return withWork("Açılıyor…", async () => {
      await previewReady;
      const values = readValues();
      if (values.protectedView) {
        if (state.engine !== "ready") {
          $("formError").textContent = "Korumalı açmak için ön gereksinimlerin hazır olması gerekir.";
          return;
        }
        const form = new FormData();
        form.append("fileInput", source, source.name);
        form.append("removeJavaScript", "true");
        form.append("removeEmbeddedFiles", "true");
        form.append("removeLinks", "true");
        form.append("removeMetadata", "false");
        form.append("removeXMPMetadata", "false");
        form.append("removeFonts", "false");
        const cleaned = await callEngine("/api/v1/security/sanitize-pdf", form);
        source = new File([cleaned], source.name, { type: "application/pdf" });
      }
      const stem = (source.name || "belge").replace(/\.[^.]+$/, "") || "belge";
      const lockPath = source.securipdfPath || source.path;
      if (lockPath && core) {
        await core.invoke("lock_opened_file", { path: lockPath }).catch(() => {});
      }
      await window.SecuriPreview.openViewer(source, 1, source.name, {
        password: values.password || undefined,
        formDesign: state.tool && state.tool.id === "add-form-fields",
        addFormFields,
        engine: callEngine,
        engineQuiet: (path, form) => callEngine(path, form, true),
        engineGet,
        engineJson: callEngineJson,
        engineJsonQuiet: (path, payload) => callEngineJson(path, payload, true),
        errorText,
        onSave: (bytes) => saveBytes(bytes, stem + "_duzenli.pdf"),
        onToWord: () => selectTool("pdf-to-word", [source]),
        onProcess: (toolId) => {
          if (!window.SecuriPreview.closeViewer(false)) return;
          selectTool(toolId, [source]);
        },
        onClose: () => {
          if (lockPath && core) core.invoke("unlock_opened_file", { path: lockPath }).catch(() => {});
        },
      });
    });
  }

  async function runTool(event) {
    event.preventDefault();
    if (isViewerTool(state.tool)) {
      openCurrentViewer();
      return;
    }
    if (state.license && !state.license.valid) {
      openLicense(true);
      return;
    }
    if (state.tool && state.policy && state.policy.blockedTools &&
        state.policy.blockedTools.some((id) => String(id).toLowerCase() === String(state.tool.id).toLowerCase())) {
      $("formError").textContent = ERRORS.POLICY_TOOL;
      return;
    }
    if (state.tool && state.tool.id === "timestamp-pdf" && state.policy && state.policy.allowTimestamp === false) {
      $("formError").textContent = ERRORS.POLICY_TIMESTAMP;
      return;
    }
    if (state.busy || (needsEngine(state.tool) && state.engine !== "ready")) return;
    const values = readValues();
    beginWork("İşleniyor…");
    try {
      await countSourcePages(values);
      const problem = validate(values);
      $("formError").textContent = problem || "";
      if (problem) return;
      const tool = state.tool;
      clearResult();
      refreshPreview();
      const started = Date.now();
      if (state.batch && state.files[tool.files[0].name].length > 1) {
        await runBatch(tool, values, started);
        return;
      }
      const { bytes, note, name } = await execute(tool, values);
      if (state.tool !== tool) return;
      state.result = { bytes, name: name || outputName(bytes) };
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      $("resultText").textContent = `Hazır: ${state.result.name} (${formatSize(bytes.length)}, ${seconds} sn)${note ? ". " + note : ""}`;
      renderProcess();
      $("saveFolder").hidden = true;
      $("result").hidden = false;
      $("tabResult").disabled = false;
      setTab("result");
    } catch (err) {
      $("formError").textContent = errorText(err);
    } finally {
      endWork();
    }
  }

  const REPORT_NAME = "islem-raporu.csv";

  async function runBatch(tool, values, started) {
    const { outputs, report, failed } = await executeBatch(tool, values, (n, total) => {
      setWorkFraction(n, total);
    });
    if (state.tool !== tool) return;
    const total = outputs.length + failed;
    const zip = window.SecuriFormats.zipStore(outputs.concat([{ name: REPORT_NAME, data: report }]));
    const preview = outputs.find((output) => outputExtension(output.data) === "pdf");
    state.result = {
      bytes: zip,
      name: `toplu_${tool.suffix || tool.id}.zip`,
      outputs,
      report,
      preview: preview && { data: preview.data, name: preview.name },
    };
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    $("resultText").textContent = `${total} dosyadan ${outputs.length} tanesi hazır${failed ? `, ${failed} tanesinde hata var (ayrıntı ${REPORT_NAME} içinde)` : ""} (${seconds} sn).`;
    renderProcess();
    $("saveFolder").hidden = !outputs.length;
    $("save").textContent = "ZIP olarak kaydet…";
    $("result").hidden = false;
    $("tabResult").disabled = !preview;
    if (preview) setTab("result");
  }

  async function saveToFolder() {
    if (!state.result || !state.result.outputs) return;
    const button = $("saveFolder");
    button.disabled = true;
    try {
      beginWork("Kaydediliyor…");
      const folder = await core.invoke("choose_output_folder");
      if (!folder) return;
      const files = state.result.outputs.concat([{ name: REPORT_NAME, data: state.result.report }]);
      for (const file of files) {
        await core.invoke("save_into_folder", file.data, { headers: { "x-securipdf-file-name": encodeURIComponent(file.name) } });
      }
      $("resultText").textContent = `${state.result.outputs.length} dosya ve işlem raporu kaydedildi: ${folder}`;
    } catch (err) {
      $("formError").textContent = errorText(err);
    } finally {
      endWork();
      button.disabled = false;
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
      const saved = await withWork("Kaydediliyor…", () => saveBytes(state.result.bytes, state.result.name));
      if (saved) $("resultText").textContent = `Kaydedildi: ${saved}`;
    } catch (err) {
      $("formError").textContent = errorText(err);
    } finally {
      button.disabled = false;
    }
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
        const opened = new File([data], item.name, { type: "application/pdf" });
        opened.securipdfPath = item.path;
        files.push(opened);
      } catch (err) {
        $("formError").textContent = errorText(err);
      }
    }
    if (!files.length) return;
    selectTool("open-pdf");
    addFiles(state.tool.files[0], files);
    hideSplash();
  }

  $("toolForm").addEventListener("submit", runTool);
  $("openViewer").addEventListener("click", () => openCurrentViewer());
  $("toWord").addEventListener("click", () => {
    const file = allFiles()[0];
    selectTool("pdf-to-word", file ? [file] : []);
  });
  $("openFile").addEventListener("click", () => {
    selectTool("open-pdf");
    const picker = document.querySelector("#fileInputs input[type=file]");
    if (picker) picker.click();
  });
  $("splashSkip").addEventListener("click", hideSplash);
  $("save").addEventListener("click", saveResult);
  $("saveFolder").addEventListener("click", saveToFolder);
  $("batch").addEventListener("change", (event) => {
    state.batch = event.target.checked;
    const primary = state.tool.files[0].name;
    if (!state.batch) state.files[primary] = state.files[primary].slice(0, 1);
    clearResult();
    renderFiles();
  });
  $("tabSource").addEventListener("click", () => setTab("source"));
  $("tabResult").addEventListener("click", () => { if (state.result) setTab("result"); });
  $("search").addEventListener("input", (event) => renderToolList(event.target.value));
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.target.closest && event.target.closest(".drop")) return;
    const files = Array.from(event.dataTransfer.files || []).filter((file) => /\.pdf$/i.test(file.name));
    if (!files.length) return;
    selectTool("open-pdf");
    addFiles(state.tool.files[0], files);
  });

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
    } else if (field.type === "select" || field.type === "pad") {
      if (!allowed.includes(value)) return `${name}: geçersiz değer "${value}". Geçerli: ${allowed.join(", ")}.`;
      if (field.type === "pad") {
        input.dataset.value = value;
        input.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.value === value));
      } else {
        input.value = value;
      }
    } else if (field.type === "range") {
      const slider = input.querySelector("input") || input;
      slider.value = value;
      const shown = input.querySelector(".value");
      if (shown) shown.textContent = formatRange(field, value);
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
        await cliFinish("list", new TextEncoder().encode(JSON.stringify(
          tools.filter((tool) => !tool.viewer || tool.run).map(describeTool))));
        return;
      }
      const tool = tools.find((item) => item.id === job.tool);
      if (!tool || (tool.viewer && !tool.run)) {
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
          await cliFail("ENGINE", $("engine").title || "Ön gereksinimler hazırlanamadı.");
          return;
        }
      }
      await countSourcePages(values);
      const problem = validate(values);
      if (problem) {
        await cliFail("INVALID", problem);
        return;
      }
      const { bytes, note, name } = await withWork("İşleniyor…", () => execute(tool, values));
      const headers = { "x-securipdf-file-name": encodeURIComponent(name || outputName(bytes)) };
      if (note) headers["x-securipdf-cli-note"] = encodeURIComponent(note);
      await cliFinish("ok", bytes, headers);
    } catch (err) {
      await cliFail("TOOL", errorText(err));
    }
  }

  // ---- License ----

  function formatLicenseDate(iso) {
    if (!iso) return "Süresiz";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("tr-TR");
  }

  function applyLicense(status) {
    state.license = status;
    const btn = $("licenseBtn");
    const banner = $("licenseBanner");
    const kind = !status.valid ? "expired" : status.licenseType === "demo" ? "demo" : "commercial";
    btn.dataset.state = kind;
    btn.textContent = !status.valid
      ? "Lisans doldu"
      : status.licenseType === "demo"
        ? `Demo · ${status.daysLeft == null ? "?" : status.daysLeft} gün`
        : (status.customer ? `Lisanslı · ${status.customer}` : "Lisanslı");
    btn.title = status.message || "Lisans";
    $("licenseSummary").textContent = status.message || "";
    $("licenseKind").textContent = !status.valid
      ? (status.expired ? "Süresi dolmuş" : "Geçersiz")
      : status.licenseType === "demo" ? "Deneme (15 gün)" : "Ticari";
    $("licenseInstall").textContent = status.installationId || "—";
    $("licenseCustomer").textContent = status.customer || "—";
    $("licenseKey").textContent = status.licenseKey || "—";
    $("licenseExpiry").textContent = formatLicenseDate(status.expiresAt);
    const policyNote = state.policy && (state.policy.licenseFile || state.policy.licenseDirectory || state.policy.disableDemo);
    $("licensePolicyRow").hidden = !policyNote;
    $("licensePolicy").textContent = !policyNote
      ? ""
      : [
          state.policy.licenseFile ? `LicenseFile: ${state.policy.licenseFile}` : "",
          state.policy.licenseDirectory ? `LicenseDirectory: ${state.policy.licenseDirectory}` : "",
          state.policy.disableDemo ? "Deneme kapalı" : "",
        ].filter(Boolean).join(" · ");
    banner.hidden = status.valid;
    banner.textContent = status.valid ? "" : status.message;
    updateRunButton();
  }

  function openLicense(force) {
    $("licenseDialog").hidden = false;
    if (force) $("licenseError").textContent = state.license && !state.license.valid
      ? (state.license.message || "Lisans gerekli.")
      : "";
  }

  async function refreshLicense(openIfExpired) {
    if (!core) return;
    try {
      applyLicense(await core.invoke("license_status"));
      if (openIfExpired && state.license && !state.license.valid) openLicense(true);
    } catch (err) {
      $("licenseBtn").dataset.state = "expired";
      $("licenseBtn").textContent = "Lisans";
      $("licenseError").textContent = errorText(err);
    }
  }

  function initLicense() {
    $("licenseBtn").addEventListener("click", () => openLicense(false));
    $("licenseClose").addEventListener("click", () => { $("licenseDialog").hidden = true; });
    $("licenseDialog").addEventListener("click", (event) => {
      if (event.target === $("licenseDialog")) $("licenseDialog").hidden = true;
    });
    $("licenseRequest").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("licenseError").textContent = "";
      try {
        const path = await core.invoke("license_save_request", {
          company: $("licenseCompany").value,
          email: $("licenseEmail").value,
          contactName: "",
          notes: "",
        });
        if (path) $("licenseSummary").textContent = `Talep kaydedildi: ${path}. Bu dosyayı Entera'ya gönderin.`;
      } catch (err) {
        $("licenseError").textContent = errorText(err);
      }
    });
    $("licenseCopyId").addEventListener("click", async () => {
      const id = $("licenseInstall").textContent.trim();
      if (!id || id === "—") return;
      try {
        await navigator.clipboard.writeText(id);
        $("licenseError").textContent = "";
        $("licenseSummary").textContent = "Kurulum kimliği panoya kopyalandı.";
      } catch {
        $("licenseError").textContent = "Kimlik kopyalanamadı.";
      }
    });
    $("licenseLoad").addEventListener("click", async () => {
      $("licenseError").textContent = "";
      try {
        applyLicense(await core.invoke("license_open_and_activate"));
        if (state.license && state.license.valid) {
          $("licensePaste").value = "";
          $("licenseSummary").textContent = state.license.message || "Lisans güncellendi.";
        }
      } catch (err) {
        $("licenseError").textContent = errorText(err);
      }
    });
    $("licenseApplyPaste").addEventListener("click", async () => {
      $("licenseError").textContent = "";
      try {
        applyLicense(await core.invoke("license_activate_text", { text: $("licensePaste").value }));
        if (state.license && state.license.valid) {
          $("licensePaste").value = "";
          $("licenseSummary").textContent = state.license.message || "Lisans güncellendi.";
        } else {
          $("licenseError").textContent = (state.license && state.license.message) || "Lisans uygulanamadı.";
        }
      } catch (err) {
        $("licenseError").textContent = errorText(err);
      }
    });
    refreshLicense(true);
  }

  // ---- Explorer right-click menu ----

  const FAVORITES_KEY = "securipdf-favorites";

  function readFavorites() {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  function writeFavorites(ids) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  }

  async function writeShellMenu(enabled) {
    const lang = window.SecuriI18n ? window.SecuriI18n.lang : "tr";
    return core.invoke("shell_menu_set", { enabled, lang });
  }

  function syncShellChecks(enabled, locked) {
    ["shellMenu", "settingsShell"].forEach((id) => {
      const box = $(id);
      if (!box) return;
      box.checked = enabled;
      box.disabled = !!locked;
    });
  }

  async function initShellMenu() {
    const box = $("shellMenu");
    const label = box.closest(".shell-menu");
    let enabled = await core.invoke("shell_menu_status").catch(() => false);
    const locked = state.policy && state.policy.shellMenu != null;
    if (locked) enabled = !!state.policy.shellMenu;
    syncShellChecks(enabled, locked);
    if (locked && label) {
      label.classList.add("is-locked");
      label.title = t("Gezgin menüsü kurum ilkesiyle kilitli.");
    }
    if (enabled) {
      try { enabled = await writeShellMenu(enabled); } catch { /* keep the stored menu */ }
      syncShellChecks(enabled, locked);
    }
    const onToggle = async (source) => {
      source.disabled = true;
      try {
        const next = await writeShellMenu(source.checked);
        syncShellChecks(next, false);
      } catch (err) {
        syncShellChecks(!source.checked, false);
        const message = errorText(err);
        $("formError").textContent = message;
        const settingsError = $("settingsError");
        if (settingsError) settingsError.textContent = message;
      } finally {
        source.disabled = false;
      }
    };
    if (!locked) box.addEventListener("change", () => onToggle(box));
    const settingsShell = $("settingsShell");
    if (settingsShell && !locked) settingsShell.addEventListener("change", () => onToggle(settingsShell));
  }

  function renderFavoriteChoices() {
    const host = $("settingsFavorites");
    if (!host) return;
    const selected = new Set(readFavorites());
    host.replaceChildren();
    allowedTools().filter((tool) => tool.id !== "open-pdf").forEach((tool) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selected.has(tool.id);
      box.addEventListener("change", () => {
        const ids = readFavorites().filter((id) => id !== tool.id);
        if (box.checked) ids.push(tool.id);
        writeFavorites(ids);
        renderProcess();
      });
      const label = document.createElement("label");
      label.append(box, document.createTextNode(t(tool.title)));
      host.appendChild(label);
    });
  }

  function initSettings() {
    const dialog = $("settingsDialog");
    const open = $("settingsBtn");
    const close = $("settingsClose");
    const lang = $("settingsLang");
    if (!dialog || !open) return;
    const show = (visible) => {
      dialog.hidden = !visible;
      if (!visible) return;
      if (lang && window.SecuriI18n) lang.value = window.SecuriI18n.lang;
      const shell = $("shellMenu");
      if (shell) syncShellChecks(shell.checked, shell.disabled);
      renderFavoriteChoices();
      const settingsError = $("settingsError");
      if (settingsError) settingsError.textContent = "";
    };
    open.addEventListener("click", () => show(true));
    if (close) close.addEventListener("click", () => show(false));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) show(false); });
    if (lang) {
      lang.addEventListener("change", () => {
        if (!window.SecuriI18n) return;
        window.SecuriI18n.set(lang.value);
        const header = $("lang");
        if (header) header.value = lang.value;
        refreshLanguage();
      });
    }
  }

  async function initPolicy() {
    try {
      state.policy = await core.invoke("policy_status");
    } catch (_err) {
      state.policy = null;
    }
  }

  async function initUpdate() {
    const btn = $("updateBtn");
    if (!btn) return;
    try {
      const status = await core.invoke("update_status");
      btn.hidden = !status.available;
      btn.title = status.message || "Güncelleme";
      btn.textContent = status.latest ? `Güncelle · ${status.latest}` : "Güncelleme";
    } catch (_err) {
      btn.hidden = true;
    }
    btn.addEventListener("click", async () => {
      try {
        await core.invoke("update_open");
      } catch (err) {
        $("formError").textContent = errorText(err);
      }
    });
  }

  // Read-only view used by the automated UI tests.
  window.SecuriWork = { begin: beginWork, end: endWork };
  window.SecuriApp = { lastResult: () => state.result && { name: state.result.name, bytes: state.result.bytes.slice() } };

  function refreshLanguage() {
    if (window.SecuriI18n) window.SecuriI18n.apply();
    if (state.engine) setEngine(state.engine);
    renderToolList($("search") ? $("search").value : "");
    if (!state.tool) return;
    $("toolTitle").textContent = t(state.tool.title);
    $("toolDescription").textContent = t(state.tool.description);
    refreshOfficeNote();
    renderFields();
    renderFiles();
    renderProcess();
    renderFavoriteChoices();
    const shell = $("shellMenu");
    if (shell && shell.checked) writeShellMenu(true).catch(() => {});
    const settingsLang = $("settingsLang");
    if (settingsLang && window.SecuriI18n) settingsLang.value = window.SecuriI18n.lang;
    updateRunButton();
  }
  const langBox = $("lang");
  if (langBox && window.SecuriI18n) {
    langBox.value = window.SecuriI18n.lang;
    langBox.addEventListener("change", () => {
      window.SecuriI18n.set(langBox.value);
      refreshLanguage();
    });
    window.SecuriI18n.apply();
  }

  initSettings();
  selectTool("open-pdf");
  (async () => {
    const job = core ? await core.invoke("cli_job").catch(() => null) : null;
    if (job) {
      runCli(job);
      return;
    }
    pollEngine();
    loadOpenedFiles();
    if (core) {
      await initPolicy();
      renderToolList($("search") && $("search").value);
      initShellMenu();
      initLicense();
      initUpdate();
    }
    if (tauri && tauri.event) tauri.event.listen("securipdf-opened", loadOpenedFiles);
  })();
})();

// Field names and option values follow the Stirling-PDF 2.14.3 OpenAPI spec (/v1/api-docs).
(function () {
  const PDF = ".pdf,application/pdf";
  const IMAGES = ".jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp,image/*";
  const UDF = ".udf";
  const XML = ".xml,text/xml,application/xml";
  const OFFICE = ".doc,.docx,.docm,.dot,.dotx,.rtf,.odt,.txt,.xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.ppt,.pptx,.pptm,.pps,.ppsx,.odp";

  const MARGINS = [
    { value: "small", label: "Küçük" },
    { value: "medium", label: "Orta" },
    { value: "large", label: "Büyük" },
    { value: "x-large", label: "Çok büyük" },
  ];
  const COLOR_TYPES = [
    { value: "color", label: "Renkli" },
    { value: "greyscale", label: "Gri tonlamalı" },
    { value: "blackwhite", label: "Siyah-beyaz" },
  ];
  const ORIENTATIONS = [
    { value: "PORTRAIT", label: "Dikey" },
    { value: "LANDSCAPE", label: "Yatay" },
  ];
  const pageHint = "Örnek: 1,3,5-9. Tümü için all yazın.";

  window.SECURIPDF_CATEGORIES = [
    { id: "edit", title: "Düzenle" },
    { id: "ocr", title: "Metin tanıma" },
    { id: "pages", title: "Sayfalar" },
    { id: "security", title: "Güvenlik" },
    { id: "convert", title: "Dönüştür" },
  ];

  window.SECURIPDF_TOOLS = [
    {
      id: "merge-pdfs",
      category: "edit",
      title: "PDF Birleştir",
      description: "Birden fazla PDF dosyasını tek belgede birleştirin. Dosyalar listedeki sırayla eklenir.",
      apiPath: "/api/v1/general/merge-pdfs",
      suffix: "birlesik",
      files: [{ name: "fileInput", label: "PDF dosyaları", accept: PDF, multiple: true, min: 2 }],
      fields: [
        { name: "sortType", label: "Sıralama", type: "select", default: "orderProvided", options: [
          { value: "orderProvided", label: "Listedeki sıra" },
          { value: "byFileName", label: "Dosya adına göre" },
          { value: "byDateModified", label: "Değiştirilme tarihine göre" },
          { value: "byDateCreated", label: "Oluşturulma tarihine göre" },
          { value: "byPDFTitle", label: "PDF başlığına göre" },
        ] },
        { name: "removeCertSign", label: "Sertifika imzalarını kaldır", type: "checkbox", default: true },
        { name: "generateToc", label: "İçindekiler sayfası oluştur", type: "checkbox", default: false },
      ],
    },
    {
      id: "split-pages",
      category: "edit",
      title: "PDF Böl",
      description: "PDF'i sayfa numarasına, sayfa sayısına, boyuta veya sayfa bölümlerine göre ayırın. Birden çok parça ZIP olarak kaydedilir.",
      apiPath: (v) => ({
        pages: "/api/v1/general/split-pages",
        count: "/api/v1/general/split-by-size-or-count",
        sections: "/api/v1/general/split-pdf-by-sections",
      })[v.mode],
      suffix: "bolunmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "mode", label: "Bölme şekli", type: "select", local: true, default: "pages", options: [
          { value: "pages", label: "Belirli sayfalardan sonra" },
          { value: "count", label: "Sayfa sayısı, belge sayısı veya boyut" },
          { value: "sections", label: "Her sayfayı parçalara ayır" },
        ] },
        { name: "pageNumbers", label: "Hangi sayfalardan sonra kesilsin", type: "text", required: true, pagePicker: "split",
          placeholder: "2,5", hint: "Önizlemede sayfaya tıklayın veya yazın. Örnek: 2,5 yazılırsa 1-2, 3-5 ve 6-son olarak bölünür.",
          showIf: { mode: "pages" } },
        { name: "splitType", label: "Ölçüt", type: "select", default: "1", showIf: { mode: "count" }, options: [
          { value: "1", label: "Her parçada şu kadar sayfa" },
          { value: "2", label: "Şu kadar belgeye böl" },
          { value: "0", label: "Her parça en fazla şu boyutta" },
        ] },
        { name: "splitValue", label: "Değer", type: "text", required: true, default: "5",
          hint: "Boyut için MB yazın, örnek: 10MB.", showIf: { mode: "count" } },
        { name: "horizontalDivisions", label: "Yatay kesim sayısı", type: "number", default: 0, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "verticalDivisions", label: "Dikey kesim sayısı", type: "number", default: 1, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "merge", label: "Parçaları tek PDF'te birleştir", type: "checkbox", default: true, showIf: { mode: "sections" } },
      ],
      constants: (v) => (v.mode === "sections" ? { pageNumbers: "all", splitMode: "SPLIT_ALL" } : {}),
    },
    {
      id: "ocr-pdf",
      category: "ocr",
      title: "OCR / Aranabilir PDF",
      description: "Taranmış belgedeki metni tanıyıp görünmez bir metin katmanı ekler; belge aranabilir ve kopyalanabilir olur. Görünüm değişmez.",
      apiPath: "/api/v1/misc/ocr-pdf",
      suffix: "aranabilir",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "languages", label: "Belge dili", type: "checks", default: ["tur", "eng"], options: [
          { value: "tur", label: "Türkçe" },
          { value: "eng", label: "İngilizce" },
        ] },
        { name: "ocrType", label: "Metin içeren sayfalar", type: "select", default: "skip-text", options: [
          { value: "skip-text", label: "Atla, yalnızca taranmış sayfaları tanı" },
          { value: "force-ocr", label: "Tüm sayfaları yeniden tanı" },
        ] },
      ],
      constants: { ocrRenderType: "hocr", deskew: "false", clean: "false", cleanFinal: "false", sidecar: "false", removeImagesAfter: "false" },
      validate: (v) => (v.languages.length ? null : "En az bir dil seçin."),
    },
    {
      id: "overlay-pdf",
      category: "edit",
      title: "PDF Bindir",
      description: "Bir PDF'in sayfalarını başka bir PDF'in üzerine veya arkasına yerleştirin.",
      apiPath: "/api/v1/general/overlay-pdfs",
      suffix: "bindirilmis",
      files: [
        { name: "fileInput", label: "Ana PDF", accept: PDF },
        { name: "overlayFiles", label: "Bindirilecek PDF'ler", accept: PDF, multiple: true, min: 1 },
      ],
      fields: [
        { name: "overlayMode", label: "Yöntem", type: "select", default: "SequentialOverlay", options: [
          { value: "SequentialOverlay", label: "Sırayla" },
          { value: "InterleavedOverlay", label: "Dönüşümlü" },
          { value: "FixedRepeatOverlay", label: "Her dosyayı belirli sayıda tekrarla" },
        ] },
        { name: "counts", label: "Tekrar sayısı", type: "number", default: 1, min: 1, perFile: "overlayFiles",
          showIf: { overlayMode: "FixedRepeatOverlay" } },
        { name: "overlayPosition", label: "Konum", type: "select", default: "0", options: [
          { value: "0", label: "Önde" },
          { value: "1", label: "Arkada" },
        ] },
      ],
    },
    {
      id: "flatten",
      category: "edit",
      title: "Düzleştir",
      description: "Form alanlarını ve etkileşimli öğeleri sabit sayfa içeriğine dönüştürün.",
      apiPath: "/api/v1/misc/flatten",
      suffix: "duzlestirilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "flattenOnlyForms", label: "Yalnızca formları düzleştir", type: "checkbox", default: true,
          hint: "Kapalıysa her sayfa görsele çevrilir; metin seçilemez ve dosya büyür." },
      ],
    },
    {
      id: "rotate-pdf",
      category: "pages",
      title: "Döndür",
      description: "Tüm sayfaları saat yönünde döndürün.",
      apiPath: "/api/v1/general/rotate-pdf",
      suffix: "dondurulmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "angle", label: "Açı", type: "select", default: "90", options: [
          { value: "90", label: "90°" },
          { value: "180", label: "180°" },
          { value: "270", label: "270°" },
        ] },
      ],
    },
    {
      id: "remove-pages",
      category: "pages",
      title: "Sayfa Sil",
      description: "Belirttiğiniz sayfaları PDF'ten kaldırın.",
      apiPath: "/api/v1/general/remove-pages",
      suffix: "sayfalar-silindi",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Silinecek sayfalar", type: "text", required: true, pagePicker: "remove",
          placeholder: "2,4-6", hint: "Önizlemede sayfalara tıklayın veya yazın. Örnek: 1,3,5-9." },
      ],
    },
    {
      id: "extract-pages",
      category: "pages",
      title: "Sayfa Çıkar",
      description: "Yalnızca seçtiğiniz sayfaları yeni bir PDF olarak alın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "secilen-sayfalar",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Alınacak sayfalar", type: "text", required: true, pagePicker: "pick",
          placeholder: "1,3-5", hint: "Önizlemede sayfalara tıklayın veya yazın. Yazarken sıra değiştirilebilir." },
      ],
      constants: { customMode: "CUSTOM" },
    },
    {
      id: "rearrange-pages",
      category: "pages",
      title: "Sayfaları Sırala",
      description: "Sayfa sırasını değiştirin veya hazır bir düzen uygulayın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "siralanmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "customMode", label: "Düzen", type: "select", default: "CUSTOM", options: [
          { value: "CUSTOM", label: "Kendi sıram" },
          { value: "REVERSE_ORDER", label: "Ters çevir" },
          { value: "DUPLEX_SORT", label: "Çift taraflı tarama sırası" },
          { value: "BOOKLET_SORT", label: "Kitapçık" },
          { value: "SIDE_STITCH_BOOKLET_SORT", label: "Yandan dikişli kitapçık" },
          { value: "ODD_EVEN_SPLIT", label: "Önce tek, sonra çift sayfalar" },
          { value: "REMOVE_FIRST", label: "İlk sayfayı çıkar" },
          { value: "REMOVE_LAST", label: "Son sayfayı çıkar" },
          { value: "REMOVE_FIRST_AND_LAST", label: "İlk ve son sayfayı çıkar" },
          { value: "DUPLICATE", label: "Her sayfayı çoğalt" },
        ] },
        { name: "pageNumbers", label: "Yeni sayfa sırası", type: "text", required: true, placeholder: "3,1,2",
          hint: "Örnek: 3,1,2 veya 5-1.", showIf: { customMode: "CUSTOM" } },
      ],
      constants: (v) => (v.customMode === "CUSTOM" ? {} : { pageNumbers: "all" }),
    },
    {
      id: "scale-pages",
      category: "pages",
      title: "Sayfa Ölçekle",
      description: "Sayfaları A4, Letter gibi bir boyuta getirin veya içeriği büyütüp küçültün.",
      apiPath: "/api/v1/general/scale-pages",
      suffix: "olceklenmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageSize", label: "Sayfa boyutu", type: "select", default: "A4", options:
          ["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map((s) => ({ value: s, label: s })).concat([
            { value: "LETTER", label: "Letter" },
            { value: "LEGAL", label: "Legal" },
            { value: "KEEP", label: "Boyutu koru" },
          ]) },
        { name: "orientation", label: "Yön", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "scaleFactor", label: "İçerik ölçeği", type: "number", default: 1, min: 0.1, max: 10, step: 0.1 },
      ],
    },
    {
      id: "crop",
      category: "pages",
      title: "Kırp",
      description: "Sayfa kenarlarındaki boşluğu otomatik kırpın veya bir alan belirtin. Ölçüler punto cinsindendir (A4: 595 × 842).",
      apiPath: "/api/v1/general/crop",
      suffix: "kirpilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "autoCrop", label: "Beyaz kenarları otomatik kırp", type: "checkbox", default: true },
        { name: "x", label: "Sol (x)", type: "number", default: 0, min: 0, showIf: { autoCrop: false } },
        { name: "y", label: "Alt (y)", type: "number", default: 0, min: 0, showIf: { autoCrop: false } },
        { name: "width", label: "Genişlik", type: "number", default: 595, min: 1, showIf: { autoCrop: false } },
        { name: "height", label: "Yükseklik", type: "number", default: 842, min: 1, showIf: { autoCrop: false } },
        { name: "removeDataOutsideCrop", label: "Alan dışındaki metni sil", type: "checkbox", default: false, showIf: { autoCrop: false } },
      ],
    },
    {
      id: "multi-page-layout",
      category: "pages",
      title: "Çok Sayfa Düzeni",
      description: "Birden fazla sayfayı tek kağıda yerleştirin.",
      apiPath: "/api/v1/general/multi-page-layout",
      suffix: "coklu-duzen",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pagesPerSheet", label: "Kağıt başına sayfa", type: "select", default: "2", options:
          ["2", "4", "9", "16"].map((n) => ({ value: n, label: n })) },
        { name: "arrangement", label: "Yerleşim", type: "select", default: "BY_ROWS", options: [
          { value: "BY_ROWS", label: "Satır satır" },
          { value: "BY_COLUMNS", label: "Sütun sütun" },
        ] },
        { name: "readingDirection", label: "Okuma yönü", type: "select", default: "LTR", options: [
          { value: "LTR", label: "Soldan sağa" },
          { value: "RTL", label: "Sağdan sola" },
        ] },
        { name: "orientation", label: "Kağıt yönü", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "addBorder", label: "Sayfaların çevresine çerçeve çiz", type: "checkbox", default: false },
      ],
      constants: { mode: "DEFAULT" },
    },
    {
      id: "pdf-to-single-page",
      category: "pages",
      title: "Tek Sayfaya Dönüştür",
      description: "Tüm sayfaları alt alta birleştirerek tek uzun bir sayfa oluşturun.",
      apiPath: "/api/v1/general/pdf-to-single-page",
      suffix: "tek-sayfa",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "add-page-numbers",
      category: "pages",
      title: "Sayfa Numarası Ekle",
      description: "Sayfalara numara ekleyin.",
      apiPath: "/api/v1/misc/add-page-numbers",
      suffix: "numarali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "position", label: "Konum", type: "select", default: "8", options: [
          { value: "1", label: "Üst sol" }, { value: "2", label: "Üst orta" }, { value: "3", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "7", label: "Alt sol" }, { value: "8", label: "Alt orta" }, { value: "9", label: "Alt sağ" },
        ] },
        { name: "customText", label: "Metin", type: "text", default: "{n}", hint: "{n} sayfa numarası, {total} toplam sayfa. Örnek: Sayfa {n} / {total}." },
        { name: "startingNumber", label: "Başlangıç numarası", type: "number", default: 1, min: 0 },
        { name: "pagesToNumber", label: "Numaralanacak sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 12, min: 4, max: 96 },
        { name: "fontType", label: "Yazı tipi", type: "select", default: "helvetica", options: [
          { value: "helvetica", label: "Helvetica" },
          { value: "times", label: "Times" },
          { value: "courier", label: "Courier" },
        ] },
        { name: "fontColor", label: "Renk", type: "color", default: "#000000" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { pageNumbers: "all" },
    },
    {
      id: "add-stamp",
      category: "security",
      title: "Damga",
      description: "Sayfalara metin damgası ekleyin.",
      apiPath: "/api/v1/misc/add-stamp",
      suffix: "damgali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "stampText", label: "Damga metni", type: "text", required: true, default: "GİZLİ" },
        { name: "position", label: "Konum", type: "select", default: "5", options: [
          { value: "7", label: "Üst sol" }, { value: "8", label: "Üst orta" }, { value: "9", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "1", label: "Alt sol" }, { value: "2", label: "Alt orta" }, { value: "3", label: "Alt sağ" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 40, min: 4, max: 300 },
        { name: "rotation", label: "Açı (derece)", type: "number", default: 0, min: -360, max: 360 },
        { name: "opacity", label: "Saydamlık (0-1)", type: "number", default: 0.5, min: 0, max: 1, step: 0.05 },
        { name: "customColor", label: "Renk", type: "color", default: "#d3d3d3" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { stampType: "text", alphabet: "roman", overrideX: "-1", overrideY: "-1" },
    },
    {
      id: "add-password",
      category: "security",
      title: "Parola Ekle",
      description: "PDF'e açma parolası ve kullanım kısıtlamaları ekleyin.",
      apiPath: "/api/v1/security/add-password",
      suffix: "parolali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "Açma parolası", type: "password" },
        { name: "ownerPassword", label: "Yetki parolası", type: "password", hint: "Kısıtlamaları değiştirmek için gerekir. Boş bırakılabilir." },
        { name: "keyLength", label: "Şifreleme", type: "select", default: "256", options: [
          { value: "256", label: "AES 256 bit" },
          { value: "128", label: "AES 128 bit" },
        ] },
        { name: "preventPrinting", label: "Yazdırmayı engelle", type: "checkbox", default: false },
        { name: "preventExtractContent", label: "İçerik kopyalamayı engelle", type: "checkbox", default: false },
        { name: "preventModify", label: "Değiştirmeyi engelle", type: "checkbox", default: false },
        { name: "preventModifyAnnotations", label: "Not eklemeyi engelle", type: "checkbox", default: false },
        { name: "preventFillInForm", label: "Form doldurmayı engelle", type: "checkbox", default: false },
        { name: "preventAssembly", label: "Sayfa düzenlemeyi engelle", type: "checkbox", default: false },
      ],
      validate: (v) => (v.password || v.ownerPassword ? null : "En az bir parola girin."),
    },
    {
      id: "remove-password",
      category: "security",
      title: "Parola Kaldır",
      description: "Parolasını bildiğiniz PDF'in şifresini kaldırın.",
      apiPath: "/api/v1/security/remove-password",
      suffix: "parolasiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "password", label: "Parola", type: "password", required: true }],
    },
    {
      id: "pdf-to-img",
      category: "convert",
      title: "PDF → Görsel",
      description: "PDF sayfalarını görsele dönüştürün. Birden çok görsel ZIP olarak kaydedilir.",
      apiPath: "/api/v1/convert/pdf/img",
      suffix: "gorsel",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "imageFormat", label: "Biçim", type: "select", default: "png", options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "webp", label: "WebP" },
          { value: "gif", label: "GIF" },
        ] },
        { name: "singleOrMultiple", label: "Çıktı", type: "select", default: "multiple", options: [
          { value: "multiple", label: "Her sayfa ayrı görsel" },
          { value: "single", label: "Tüm sayfalar tek görselde" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "dpi", label: "Çözünürlük (DPI)", type: "number", default: 150, min: 36, max: 600 },
      ],
    },
    {
      id: "img-to-pdf",
      category: "convert",
      title: "Görsel → PDF",
      description: "Görselleri tek PDF belgesinde birleştirin.",
      apiPath: "/api/v1/convert/img/pdf",
      suffix: "",
      files: [{ name: "fileInput", label: "Görseller", accept: IMAGES, multiple: true, min: 1 }],
      fields: [
        { name: "fitOption", label: "Sayfaya yerleşim", type: "select", default: "maintainAspectRatio", options: [
          { value: "maintainAspectRatio", label: "Oranı koru" },
          { value: "fillPage", label: "Sayfayı doldur" },
          { value: "fitDocumentToImage", label: "Sayfa görsel boyutunda olsun" },
        ] },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "autoRotate", label: "Görseli sayfaya göre otomatik döndür", type: "checkbox", default: false },
      ],
    },
    {
      id: "udf-to-pdf",
      category: "convert",
      title: "UDF → PDF",
      description: "UYAP Doküman Editörü belgesini (.udf) PDF'e dönüştürün. Yazı tipi, hizalama, tablo ve görseller korunur.",
      suffix: "",
      files: [{ name: "fileInput", label: "UDF dosyası", accept: UDF }],
      fields: [],
      async run({ files, htmlToPdf }) {
        const bytes = new Uint8Array(await files.fileInput[0].arrayBuffer());
        const { html, page } = await window.SecuriFormats.udfToHtml(bytes);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "pdf-to-udf",
      category: "convert",
      title: "PDF → UDF",
      description: "PDF'teki metni UYAP Doküman Editörü belgesine (.udf) aktarın. Metin ve satırlar aktarılır; görseller ve tablo düzeni aktarılmaz.",
      suffix: "",
      outputExt: "udf",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "PDF parolası (varsa)", type: "password", local: true },
      ],
      async run({ files, values }) {
        const lines = await window.SecuriPreview.textLines(files.fileInput[0], values.password);
        if (!lines.some((line) => line.text.trim())) throw new Error("FORMAT_NO_TEXT");
        return window.SecuriFormats.linesToUdf(lines);
      },
    },
    {
      id: "einvoice-to-pdf",
      category: "convert",
      title: "e-Fatura XML → PDF",
      description: "e-Fatura, e-Arşiv fatura veya e-İrsaliye XML dosyasını PDF'e dönüştürün. Belgede gömülü görsel şablon (XSLT) varsa o kullanılır.",
      suffix: "",
      files: [{ name: "fileInput", label: "XML dosyası", accept: XML }],
      fields: [
        { name: "template", label: "Görünüm", type: "select", local: true, default: "embedded", options: [
          { value: "embedded", label: "Belgedeki şablon (yoksa standart)" },
          { value: "standard", label: "SecuriPDF standart şablonu" },
        ] },
      ],
      async run({ files, values, htmlToPdf, note }) {
        const text = new TextDecoder("utf-8").decode(await files.fileInput[0].arrayBuffer());
        const { html, page, template } = window.SecuriFormats.invoiceToHtml(text, values.template === "embedded");
        if (values.template === "embedded" && template === "standard") note("Belgede şablon bulunamadı; standart şablon kullanıldı");
        return htmlToPdf(html, page);
      },
    },
    {
      id: "office-to-pdf",
      category: "convert",
      title: "Office → PDF",
      description: "Word, Excel veya PowerPoint belgesini bilgisayardaki Microsoft Office ile PDF'e dönüştürün. Makrolar çalıştırılmaz.",
      suffix: "",
      files: [{ name: "fileInput", label: "Office belgesi", accept: OFFICE }],
      fields: [
        { name: "format", label: "Çıktı", type: "select", local: true, default: "pdf", options: [
          { value: "pdf", label: "PDF" },
          { value: "pdfa", label: "PDF/A (arşiv; Word ve PowerPoint)" },
        ] },
      ],
      run: ({ files, values, office }) => office(files.fileInput[0], values.format),
    },
    {
      id: "pdf-to-word",
      category: "convert",
      title: "PDF → Word",
      description: "PDF'i bilgisayardaki Microsoft Word ile düzenlenebilir Word belgesine (.docx) dönüştürün. Karmaşık sayfa düzenleri birebir korunmayabilir.",
      suffix: "",
      outputExt: "docx",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      run: ({ files, office }) => office(files.fileInput[0], "docx"),
    },
  ];
})();

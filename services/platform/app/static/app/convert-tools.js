(function (global) {
  'use strict';

  var COLOR_TYPES = { COLOR: 'color', GRAYSCALE: 'grayscale', BLACK_WHITE: 'blackwhite' };
  var OUTPUT_OPTIONS = { SINGLE: 'single', MULTIPLE: 'multiple' };
  var FIT_OPTIONS = {
    FIT_PAGE: 'fitDocumentToPage',
    MAINTAIN_ASPECT: 'maintainAspectRatio',
    FILL_PAGE: 'fillPage'
  };

  var CONVERSION_ENDPOINTS = {
    'office-pdf': '/api/v1/convert/file/pdf',
    'pdf-image': '/api/v1/convert/pdf/img',
    'image-pdf': '/api/v1/convert/img/pdf',
    'svg-pdf': '/api/v1/convert/svg/pdf',
    'cbz-pdf': '/api/v1/convert/cbz/pdf',
    'pdf-cbz': '/api/v1/convert/pdf/cbz',
    'pdf-office-word': '/api/v1/convert/pdf/word',
    'pdf-office-presentation': '/api/v1/convert/pdf/presentation',
    'pdf-office-text': '/api/v1/convert/pdf/text',
    'pdf-csv': '/api/v1/convert/pdf/csv',
    'pdf-xlsx': '/api/v1/convert/pdf/xlsx',
    'pdf-markdown': '/api/v1/convert/pdf/markdown',
    'pdf-html': '/api/v1/convert/pdf/html',
    'pdf-xml': '/api/v1/convert/pdf/xml',
    'pdf-pdfa': '/api/v1/convert/pdf/pdfa',
    'html-pdf': '/api/v1/convert/html/pdf',
    'markdown-pdf': '/api/v1/convert/markdown/pdf',
    'eml-pdf': '/api/v1/convert/eml/pdf',
    'cbr-pdf': '/api/v1/convert/cbr/pdf',
    'pdf-cbr': '/api/v1/convert/pdf/cbr',
    'ebook-pdf': '/api/v1/convert/ebook/pdf',
    'pdf-epub': '/api/v1/convert/pdf/epub'
  };

  var ENDPOINT_NAMES = {
    'office-pdf': 'file-to-pdf',
    'pdf-image': 'pdf-to-img',
    'image-pdf': 'img-to-pdf',
    'svg-pdf': 'svg-to-pdf',
    'cbz-pdf': 'cbz-to-pdf',
    'pdf-cbz': 'pdf-to-cbz',
    'pdf-office-word': 'pdf-to-word',
    'pdf-office-presentation': 'pdf-to-presentation',
    'pdf-office-text': 'pdf-to-text',
    'pdf-csv': 'pdf-to-csv',
    'pdf-xlsx': 'pdf-to-xlsx',
    'pdf-markdown': 'pdf-to-markdown',
    'pdf-html': 'pdf-to-html',
    'pdf-xml': 'pdf-to-xml',
    'pdf-pdfa': 'pdf-to-pdfa',
    'html-pdf': 'html-to-pdf',
    'markdown-pdf': 'markdown-to-pdf',
    'eml-pdf': 'eml-to-pdf',
    'ebook-pdf': 'ebook-to-pdf',
    'cbr-pdf': 'cbr-to-pdf',
    'pdf-cbr': 'pdf-to-cbr',
    'pdf-epub': 'pdf-to-epub'
  };

  var FROM_FORMAT_OPTIONS = [
    { value: 'pdf', label: 'PDF', group: 'Belge' },
    { value: 'docx', label: 'DOCX', group: 'Belge' },
    { value: 'doc', label: 'DOC', group: 'Belge' },
    { value: 'odt', label: 'ODT', group: 'Belge' },
    { value: 'xlsx', label: 'XLSX', group: 'Tablo' },
    { value: 'xls', label: 'XLS', group: 'Tablo' },
    { value: 'ods', label: 'ODS', group: 'Tablo' },
    { value: 'pptx', label: 'PPTX', group: 'Sunum' },
    { value: 'ppt', label: 'PPT', group: 'Sunum' },
    { value: 'odp', label: 'ODP', group: 'Sunum' },
    { value: 'jpg', label: 'JPG', group: 'Görsel' },
    { value: 'jpeg', label: 'JPEG', group: 'Görsel' },
    { value: 'png', label: 'PNG', group: 'Görsel' },
    { value: 'gif', label: 'GIF', group: 'Görsel' },
    { value: 'bmp', label: 'BMP', group: 'Görsel' },
    { value: 'tiff', label: 'TIFF', group: 'Görsel' },
    { value: 'webp', label: 'WEBP', group: 'Görsel' },
    { value: 'svg', label: 'SVG', group: 'Görsel' },
    { value: 'html', label: 'HTML', group: 'Web' },
    { value: 'zip', label: 'ZIP (HTML)', group: 'Web' },
    { value: 'md', label: 'Markdown', group: 'Metin' },
    { value: 'txt', label: 'TXT', group: 'Metin' },
    { value: 'rtf', label: 'RTF', group: 'Metin' },
    { value: 'eml', label: 'EML', group: 'E-posta' },
    { value: 'msg', label: 'MSG (Outlook)', group: 'E-posta' },
    { value: 'cbz', label: 'CBZ', group: 'Arşiv' },
    { value: 'cbr', label: 'CBR', group: 'Arşiv' },
    { value: 'epub', label: 'EPUB', group: 'e-Kitap' },
    { value: 'mobi', label: 'MOBI', group: 'e-Kitap' },
    { value: 'azw3', label: 'AZW3', group: 'e-Kitap' },
    { value: 'fb2', label: 'FB2', group: 'e-Kitap' }
  ];

  var TO_FORMAT_OPTIONS = [
    { value: 'pdf', label: 'PDF', group: 'Belge' },
    { value: 'pdfa', label: 'PDF/A', group: 'Belge' },
    { value: 'pdfx', label: 'PDF/X', group: 'Belge' },
    { value: 'docx', label: 'DOCX', group: 'Belge' },
    { value: 'odt', label: 'ODT', group: 'Belge' },
    { value: 'cbz', label: 'CBZ', group: 'Arşiv' },
    { value: 'cbr', label: 'CBR', group: 'Arşiv' },
    { value: 'csv', label: 'CSV', group: 'Tablo' },
    { value: 'xlsx', label: 'XLSX', group: 'Tablo' },
    { value: 'pptx', label: 'PPTX', group: 'Sunum' },
    { value: 'odp', label: 'ODP', group: 'Sunum' },
    { value: 'txt', label: 'TXT', group: 'Metin' },
    { value: 'rtf', label: 'RTF', group: 'Metin' },
    { value: 'md', label: 'Markdown', group: 'Metin' },
    { value: 'png', label: 'PNG', group: 'Görsel' },
    { value: 'jpg', label: 'JPG', group: 'Görsel' },
    { value: 'jpeg', label: 'JPEG', group: 'Görsel' },
    { value: 'gif', label: 'GIF', group: 'Görsel' },
    { value: 'tiff', label: 'TIFF', group: 'Görsel' },
    { value: 'tif', label: 'TIF', group: 'Görsel' },
    { value: 'bmp', label: 'BMP', group: 'Görsel' },
    { value: 'webp', label: 'WEBP', group: 'Görsel' },
    { value: 'html', label: 'HTML', group: 'Web' },
    { value: 'xml', label: 'XML', group: 'Web' },
    { value: 'epub', label: 'EPUB', group: 'e-Kitap' },
    { value: 'azw3', label: 'AZW3', group: 'e-Kitap' }
  ];

  var CONVERSION_MATRIX = {
    pdf: ['png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'bmp', 'webp', 'docx', 'odt', 'pptx', 'odp', 'csv', 'xlsx', 'txt', 'rtf', 'md', 'html', 'xml', 'pdfa', 'pdfx', 'cbz', 'cbr', 'epub', 'azw3'],
    cbz: ['pdf'],
    docx: ['pdf'], doc: ['pdf'], odt: ['pdf'],
    xlsx: ['pdf'], xls: ['pdf'], ods: ['pdf'],
    pptx: ['pdf'], ppt: ['pdf'], odp: ['pdf'],
    jpg: ['pdf'], jpeg: ['pdf'], png: ['pdf'], gif: ['pdf'], bmp: ['pdf'], tiff: ['pdf'], webp: ['pdf'],
    svg: ['pdf'],
    html: ['pdf'], zip: ['pdf'], md: ['pdf'],
    txt: ['pdf'], rtf: ['pdf'],
    eml: ['pdf'], msg: ['pdf'], cbr: ['pdf'],
    epub: ['pdf'], mobi: ['pdf'], azw3: ['pdf'], fb2: ['pdf'],
    any: ['pdf']
  };

  var EXTENSION_TO_ENDPOINT = {
    any: { pdf: 'file-to-pdf' },
    pdf: {
      png: 'pdf-to-img', jpg: 'pdf-to-img', jpeg: 'pdf-to-img', gif: 'pdf-to-img',
      tiff: 'pdf-to-img', tif: 'pdf-to-img', bmp: 'pdf-to-img', webp: 'pdf-to-img',
      docx: 'pdf-to-word', odt: 'pdf-to-word',
      pptx: 'pdf-to-presentation', odp: 'pdf-to-presentation',
      csv: 'pdf-to-csv', xlsx: 'pdf-to-xlsx',
      txt: 'pdf-to-text', rtf: 'pdf-to-text', md: 'pdf-to-markdown',
      html: 'pdf-to-html', xml: 'pdf-to-xml',
      pdfa: 'pdf-to-pdfa', pdfx: 'pdf-to-pdfa',
      cbr: 'pdf-to-cbr', cbz: 'pdf-to-cbz',
      epub: 'pdf-to-epub', azw3: 'pdf-to-epub'
    },
    cbz: { pdf: 'cbz-to-pdf' },
    docx: { pdf: 'file-to-pdf' }, doc: { pdf: 'file-to-pdf' }, odt: { pdf: 'file-to-pdf' },
    xlsx: { pdf: 'file-to-pdf' }, xls: { pdf: 'file-to-pdf' }, ods: { pdf: 'file-to-pdf' },
    pptx: { pdf: 'file-to-pdf' }, ppt: { pdf: 'file-to-pdf' }, odp: { pdf: 'file-to-pdf' },
    jpg: { pdf: 'img-to-pdf' }, jpeg: { pdf: 'img-to-pdf' }, png: { pdf: 'img-to-pdf' },
    gif: { pdf: 'img-to-pdf' }, bmp: { pdf: 'img-to-pdf' }, tiff: { pdf: 'img-to-pdf' }, webp: { pdf: 'img-to-pdf' },
    svg: { pdf: 'svg-to-pdf' },
    html: { pdf: 'html-to-pdf' }, zip: { pdf: 'html-to-pdf' }, md: { pdf: 'markdown-to-pdf' },
    txt: { pdf: 'file-to-pdf' }, rtf: { pdf: 'file-to-pdf' },
    cbr: { pdf: 'cbr-to-pdf' }, eml: { pdf: 'eml-to-pdf' }, msg: { pdf: 'eml-to-pdf' },
    epub: { pdf: 'ebook-to-pdf' }, mobi: { pdf: 'ebook-to-pdf' }, azw3: { pdf: 'ebook-to-pdf' }, fb2: { pdf: 'ebook-to-pdf' }
  };

  var OFFICE_ACCEPT = '.doc,.docx,.odt,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.rtf,.txt';

  function detectFileExtension(name) {
    if (!name) return '';
    var parts = String(name).toLowerCase().split('.');
    if (parts.length < 2) return '';
    return normalizeImageExt(parts.pop() || '');
  }

  function normalizeImageExt(ext) {
    var e = String(ext || '').toLowerCase();
    if (e === 'tif') return 'tiff';
    return e;
  }

  function toStirlingImageFormat(ext) {
    return normalizeImageExt(ext);
  }

  function isImageFormat(ext) {
    return ['png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'bmp', 'webp'].indexOf(String(ext).toLowerCase()) >= 0;
  }

  function isWebFormat(ext) {
    return ['html', 'zip'].indexOf(String(ext).toLowerCase()) >= 0;
  }

  function isOfficeFormat(ext) {
    return ['docx', 'doc', 'odt', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'].indexOf(String(ext).toLowerCase()) >= 0;
  }

  function getEndpointName(fromExt, toExt) {
    if (!fromExt || !toExt) return '';
    var endpointKey = EXTENSION_TO_ENDPOINT[fromExt] && EXTENSION_TO_ENDPOINT[fromExt][toExt];
    if (!endpointKey && toExt === 'pdf' && fromExt !== 'any') {
      endpointKey = EXTENSION_TO_ENDPOINT.any && EXTENSION_TO_ENDPOINT.any.pdf;
    }
    return endpointKey || '';
  }

  function getApiPath(fromExt, toExt) {
    var actualTo = toExt === 'pdfx' ? 'pdfa' : toExt;
    var endpointName = getEndpointName(fromExt, actualTo);
    if (!endpointName) return '';
    var keys = Object.keys(CONVERSION_ENDPOINTS);
    for (var i = 0; i < keys.length; i++) {
      if (ENDPOINT_NAMES[keys[i]] === endpointName) {
        return CONVERSION_ENDPOINTS[keys[i]];
      }
    }
    return '';
  }

  function getAvailableToFormats(fromExt) {
    if (!fromExt) return [];
    var supported = CONVERSION_MATRIX[fromExt] || [];
    if (!supported.length && fromExt !== 'any') {
      supported = CONVERSION_MATRIX.any || [];
    }
    return TO_FORMAT_OPTIONS.filter(function (opt) {
      return supported.indexOf(opt.value) >= 0;
    });
  }

  function buildGroupedSelect(id, options, value, label) {
    var groups = {};
    options.forEach(function (opt) {
      if (!groups[opt.group]) groups[opt.group] = [];
      groups[opt.group].push(opt);
    });
    var html = '<label class="convert-select-field"><span class="field-label">' + label + '</span><select id="' + id + '" class="convert-format-select">';
    Object.keys(groups).forEach(function (group) {
      html += '<optgroup label="' + group + '">';
      groups[group].forEach(function (opt) {
        html += '<option value="' + opt.value + '"' + (opt.value === value ? ' selected' : '') + '>' + opt.label + '</option>';
      });
      html += '</optgroup>';
    });
    html += '</select></label>';
    return html;
  }

  function acceptForFromFormat(fromExt) {
    if (fromExt === 'pdf') return '.pdf,application/pdf';
    if (isImageFormat(fromExt)) return 'image/*';
    if (fromExt === 'svg') return '.svg,image/svg+xml';
    if (isWebFormat(fromExt)) return fromExt === 'html' ? '.html,.htm,text/html' : '.zip,application/zip';
    if (fromExt === 'md') return '.md,text/markdown';
    if (fromExt === 'eml') return '.eml,message/rfc822';
    if (fromExt === 'msg') return '.msg';
    if (fromExt === 'cbz') return '.cbz';
    if (fromExt === 'cbr') return '.cbr,.rar,application/vnd.comicbook-rar';
    if (['epub', 'mobi', 'azw3', 'fb2'].indexOf(fromExt) >= 0) return '.' + fromExt;
    if (isOfficeFormat(fromExt) || fromExt === 'txt' || fromExt === 'rtf') return OFFICE_ACCEPT;
    return '*/*';
  }

  function analyzeFiles(files) {
    if (!files || !files.length) {
      return { fromExt: 'pdf', toExt: 'docx' };
    }
    if (files.length === 1) {
      var ext = detectFileExtension(files[0].name);
      var targets = getAvailableToFormats(ext);
      var toExt = targets.length === 1 ? targets[0].value : (ext === 'pdf' ? 'docx' : 'pdf');
      return { fromExt: ext || 'pdf', toExt: toExt };
    }
    var exts = [];
    for (var i = 0; i < files.length; i++) {
      exts.push(detectFileExtension(files[i].name));
    }
    var unique = exts.filter(function (v, idx) { return exts.indexOf(v) === idx; });
    if (unique.length === 1) {
      var singleExt = unique[0];
      var t = getAvailableToFormats(singleExt);
      return { fromExt: singleExt, toExt: t.length === 1 ? t[0].value : 'pdf' };
    }
    var allImages = unique.every(isImageFormat);
    if (allImages) return { fromExt: 'png', toExt: 'pdf' };
    var allWeb = unique.every(isWebFormat);
    if (allWeb) return { fromExt: 'html', toExt: 'pdf' };
    return { fromExt: 'docx', toExt: 'pdf' };
  }

  global.SecuriConvert = {
    COLOR_TYPES: COLOR_TYPES,
    OUTPUT_OPTIONS: OUTPUT_OPTIONS,
    FIT_OPTIONS: FIT_OPTIONS,
    FROM_FORMAT_OPTIONS: FROM_FORMAT_OPTIONS,
    TO_FORMAT_OPTIONS: TO_FORMAT_OPTIONS,
    OFFICE_ACCEPT: OFFICE_ACCEPT,
    detectFileExtension: detectFileExtension,
    normalizeImageExt: normalizeImageExt,
    toStirlingImageFormat: toStirlingImageFormat,
    isImageFormat: isImageFormat,
    isWebFormat: isWebFormat,
    isOfficeFormat: isOfficeFormat,
    getEndpointName: getEndpointName,
    getApiPath: getApiPath,
    getAvailableToFormats: getAvailableToFormats,
    buildGroupedSelect: buildGroupedSelect,
    acceptForFromFormat: acceptForFromFormat,
    analyzeFiles: analyzeFiles
  };
})(window);

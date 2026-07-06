(function (global) {
  'use strict';

  var DEFAULT_PAGE = { width: 595, height: 842 };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function roundPt(n) {
    return Math.round(n * 10) / 10;
  }

  function defaultRect(page) {
    var pw = (page && page.width) || DEFAULT_PAGE.width;
    var ph = (page && page.height) || DEFAULT_PAGE.height;
    return { x: 0, y: 0, width: pw, height: ph };
  }

  function clampRect(rect, page) {
    var pw = (page && page.width) || DEFAULT_PAGE.width;
    var ph = (page && page.height) || DEFAULT_PAGE.height;
    var w = clamp(rect.width, 1, pw);
    var h = clamp(rect.height, 1, ph);
    var x = clamp(rect.x, 0, pw - w);
    var y = clamp(rect.y, 0, ph - h);
    return { x: roundPt(x), y: roundPt(y), width: roundPt(w), height: roundPt(h) };
  }

  function rectToMargins(rect, page) {
    var pw = (page && page.width) || DEFAULT_PAGE.width;
    var ph = (page && page.height) || DEFAULT_PAGE.height;
    return {
      top: roundPt(rect.y),
      right: roundPt(pw - rect.x - rect.width),
      bottom: roundPt(ph - rect.y - rect.height),
      left: roundPt(rect.x)
    };
  }

  function marginsToRect(margins, page) {
    var pw = (page && page.width) || DEFAULT_PAGE.width;
    var ph = (page && page.height) || DEFAULT_PAGE.height;
    var left = clamp(Number(margins.left) || 0, 0, pw - 1);
    var top = clamp(Number(margins.top) || 0, 0, ph - 1);
    var right = clamp(Number(margins.right) || 0, 0, pw - left - 1);
    var bottom = clamp(Number(margins.bottom) || 0, 0, ph - top - 1);
    return clampRect({
      x: left,
      y: top,
      width: pw - left - right,
      height: ph - top - bottom
    }, page);
  }

  function presetRect(id, page) {
    var pw = (page && page.width) || DEFAULT_PAGE.width;
    var ph = (page && page.height) || DEFAULT_PAGE.height;
    if (id === 'full') return { x: 0, y: 0, width: pw, height: ph };
    if (id === 'margin5') {
      var m5 = Math.min(pw, ph) * 0.05;
      return marginsToRect({ top: m5, right: m5, bottom: m5, left: m5 }, page);
    }
    if (id === 'margin10') {
      var m10 = Math.min(pw, ph) * 0.1;
      return marginsToRect({ top: m10, right: m10, bottom: m10, left: m10 }, page);
    }
    if (id === 'center80') {
      var w = pw * 0.8;
      var h = ph * 0.8;
      return clampRect({ x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h }, page);
    }
    return defaultRect(page);
  }

  global.SecuriCrop = {
    DEFAULT_PAGE: DEFAULT_PAGE,
    defaultRect: defaultRect,
    clampRect: clampRect,
    rectToMargins: rectToMargins,
    marginsToRect: marginsToRect,
    presetRect: presetRect,
    roundPt: roundPt
  };
})(typeof window !== 'undefined' ? window : this);

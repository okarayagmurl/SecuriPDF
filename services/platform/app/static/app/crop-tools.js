(function (global) {
  'use strict';

  var DEFAULT_PAGE = { width: 595, height: 842 };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function intPt(n) {
    return Math.round(Number(n) || 0);
  }

  function pageDims(page) {
    return {
      width: intPt((page && page.width) || DEFAULT_PAGE.width),
      height: intPt((page && page.height) || DEFAULT_PAGE.height)
    };
  }

  function defaultRect(page) {
    var ps = pageDims(page);
    return { x: 0, y: 0, width: ps.width, height: ps.height };
  }

  function clampRect(rect, page) {
    var ps = pageDims(page);
    var w = clamp(intPt(rect.width), 1, ps.width);
    var h = clamp(intPt(rect.height), 1, ps.height);
    var x = clamp(intPt(rect.x), 0, ps.width - w);
    var y = clamp(intPt(rect.y), 0, ps.height - h);
    return { x: x, y: y, width: w, height: h };
  }

  function rectToMargins(rect, page) {
    var ps = pageDims(page);
    var r = clampRect(rect, page);
    return {
      top: r.y,
      right: ps.width - r.x - r.width,
      bottom: ps.height - r.y - r.height,
      left: r.x
    };
  }

  function marginsToRect(margins, page) {
    var ps = pageDims(page);
    var left = clamp(intPt(margins.left), 0, ps.width - 1);
    var top = clamp(intPt(margins.top), 0, ps.height - 1);
    var right = clamp(intPt(margins.right), 0, ps.width - left - 1);
    var bottom = clamp(intPt(margins.bottom), 0, ps.height - top - 1);
    return clampRect({
      x: left,
      y: top,
      width: ps.width - left - right,
      height: ps.height - top - bottom
    }, page);
  }

  function presetRect(id, page) {
    var ps = pageDims(page);
    if (id === 'full') return { x: 0, y: 0, width: ps.width, height: ps.height };
    if (id === 'margin5') {
      var m5 = Math.round(Math.min(ps.width, ps.height) * 0.05);
      return marginsToRect({ top: m5, right: m5, bottom: m5, left: m5 }, page);
    }
    if (id === 'margin10') {
      var m10 = Math.round(Math.min(ps.width, ps.height) * 0.1);
      return marginsToRect({ top: m10, right: m10, bottom: m10, left: m10 }, page);
    }
    if (id === 'center80') {
      var w = Math.round(ps.width * 0.8);
      var h = Math.round(ps.height * 0.8);
      return clampRect({
        x: Math.round((ps.width - w) / 2),
        y: Math.round((ps.height - h) / 2),
        width: w,
        height: h
      }, page);
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
    intPt: intPt,
    pageDims: pageDims
  };
})(typeof window !== 'undefined' ? window : this);

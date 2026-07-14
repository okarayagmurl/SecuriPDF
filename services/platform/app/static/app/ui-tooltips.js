(function (global) {
  'use strict';

  var GAP = 8;
  var openBtn = null;
  var scrollParents = [];

  function tipEl(btn) {
    return btn && btn._uiTip;
  }

  function closeTip(btn) {
    if (!btn) return;
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    var tip = tipEl(btn);
    if (tip) {
      tip.classList.remove('is-visible');
      tip.setAttribute('aria-hidden', 'true');
    }
    if (openBtn === btn) openBtn = null;
  }

  function closeAllTips(except) {
    document.querySelectorAll('.ui-tip-trigger.is-open').forEach(function (btn) {
      if (btn !== except) closeTip(btn);
    });
  }

  function purgeOrphanTips() {
    document.querySelectorAll('body > .ui-tip').forEach(function (tip) {
      var btn = tip._uiTrigger;
      if (!btn || !btn.isConnected) {
        if (openBtn && openBtn._uiTip === tip) openBtn = null;
        tip.remove();
      }
    });
  }

  function unbindScrollParents() {
    scrollParents.forEach(function (el) {
      el.removeEventListener('scroll', onReposition, true);
    });
    scrollParents = [];
    window.removeEventListener('resize', onReposition);
  }

  function bindScrollParents(btn) {
    unbindScrollParents();
    var node = btn.parentElement;
    while (node && node !== document.body) {
      var style = window.getComputedStyle(node);
      var oy = style.overflowY;
      var ox = style.overflowX;
      if (oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
        scrollParents.push(node);
        node.addEventListener('scroll', onReposition, true);
      }
      node = node.parentElement;
    }
    window.addEventListener('resize', onReposition);
  }

  function onReposition() {
    if (openBtn) positionTip(openBtn);
  }

  function preferredPlacement(btn) {
    var tip = tipEl(btn);
    return (tip && tip.getAttribute('data-placement')) || 'top';
  }

  function positionTip(btn) {
    var tip = tipEl(btn);
    if (!tip || !btn.isConnected) return;

    tip.style.visibility = 'hidden';
    tip.classList.add('is-visible');
    tip.style.left = '0px';
    tip.style.top = '0px';

    var rect = btn.getBoundingClientRect();
    var tipRect = tip.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var place = preferredPlacement(btn);
    var top;
    var left;

    function placeTop() {
      top = rect.top - tipRect.height - GAP;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      place = 'top';
    }
    function placeBottom() {
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      place = 'bottom';
    }
    function placeLeft() {
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.left - tipRect.width - GAP;
      place = 'left';
    }
    function placeRight() {
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.right + GAP;
      place = 'right';
    }

    if (place === 'left') {
      placeLeft();
      if (left < 8) placeRight();
      if (left + tipRect.width > vw - 8) placeTop();
    } else if (place === 'right') {
      placeRight();
      if (left + tipRect.width > vw - 8) placeLeft();
      if (left < 8) placeTop();
    } else if (place === 'bottom') {
      placeBottom();
      if (top + tipRect.height > vh - 8) placeTop();
    } else {
      placeTop();
      if (top < 8) placeBottom();
    }

    if (left < 8) left = 8;
    if (left + tipRect.width > vw - 8) left = Math.max(8, vw - tipRect.width - 8);
    if (top < 8) top = 8;
    if (top + tipRect.height > vh - 8) top = Math.max(8, vh - tipRect.height - 8);

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.setAttribute('data-placement', place);
    tip.style.visibility = '';
    tip.setAttribute('aria-hidden', 'false');
  }

  function openTip(btn) {
    closeAllTips(btn);
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    openBtn = btn;
    positionTip(btn);
    bindScrollParents(btn);
  }

  function createTrigger(text, opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-tip-trigger' + (opts.inline ? ' ui-tip-trigger-inline' : '');
    btn.setAttribute('aria-label', opts.ariaLabel || 'Bilgi');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="ui-tip-icon" aria-hidden="true">?</span>';

    var tip = document.createElement('span');
    tip.className = 'ui-tip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    tip.textContent = text;
    if (opts.placement) tip.setAttribute('data-placement', opts.placement);
    document.body.appendChild(tip);
    btn._uiTip = tip;
    tip._uiTrigger = btn;
    purgeOrphanTips();

    function show() {
      openTip(btn);
    }
    function hide() {
      if (!btn.classList.contains('is-open')) return;
      // Keep open when pinned via click until click-outside / Escape.
      if (btn._tipPinned) return;
      closeTip(btn);
      unbindScrollParents();
    }

    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', function () {
      // Delay so click on tip content (if any) can run; tip is pointer-events none normally.
      setTimeout(function () {
        if (document.activeElement !== btn && !btn._tipPinned) {
          closeTip(btn);
          unbindScrollParents();
        }
      }, 0);
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = btn.classList.contains('is-open') && btn._tipPinned;
      if (open) {
        btn._tipPinned = false;
        closeTip(btn);
        unbindScrollParents();
      } else {
        btn._tipPinned = true;
        openTip(btn);
      }
    });

    return btn;
  }

  function attach(el, text, opts) {
    if (!el || !text) return null;
    opts = opts || {};
    var trigger = createTrigger(text, opts);
    if (opts.appendInside) {
      el.appendChild(trigger);
    } else if (el.parentNode) {
      el.parentNode.insertBefore(trigger, el.nextSibling);
    } else {
      el.appendChild(trigger);
    }
    return trigger;
  }

  function wrapLabel(labelEl, text) {
    if (!labelEl || !text) return null;
    labelEl.classList.add('ui-tip-label-wrap');
    var trigger = createTrigger(text, { inline: true });
    labelEl.appendChild(trigger);
    return trigger;
  }

  function processSteps(steps) {
    var bar = document.createElement('div');
    bar.className = 'ui-process-steps';
    bar.setAttribute('aria-label', 'İşlem adımları');
    (steps || []).forEach(function (step, i) {
      if (i > 0) {
        var arrow = document.createElement('span');
        arrow.className = 'ui-process-step-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        bar.appendChild(arrow);
      }
      var item = document.createElement('span');
      item.className = 'ui-process-step';
      item.innerHTML =
        '<span class="ui-process-step-num">' + (i + 1) + '</span>' +
        '<span class="ui-process-step-text">' + step + '</span>';
      bar.appendChild(item);
    });
    return bar;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.ui-tip-trigger')) {
        document.querySelectorAll('.ui-tip-trigger.is-open').forEach(function (btn) {
          btn._tipPinned = false;
          closeTip(btn);
        });
        unbindScrollParents();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.ui-tip-trigger.is-open').forEach(function (btn) {
          btn._tipPinned = false;
          closeTip(btn);
        });
        unbindScrollParents();
      }
    });
  }

  global.SecuriTips = {
    attach: attach,
    wrapLabel: wrapLabel,
    processSteps: processSteps,
    createTrigger: createTrigger,
    purgeOrphanTips: purgeOrphanTips
  };
})(typeof window !== 'undefined' ? window : this);

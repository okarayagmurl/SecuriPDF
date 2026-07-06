(function (global) {
  'use strict';

  function closeAllTips(except) {
    document.querySelectorAll('.ui-tip-trigger.is-open').forEach(function (btn) {
      if (btn !== except) btn.classList.remove('is-open');
    });
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
    tip.textContent = text;
    if (opts.placement) tip.setAttribute('data-placement', opts.placement);
    btn.appendChild(tip);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = btn.classList.contains('is-open');
      closeAllTips(btn);
      if (!open) {
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    return btn;
  }

  function attach(el, text, opts) {
    if (!el || !text) return null;
    opts = opts || {};
    var trigger = createTrigger(text, opts);
    if (el.parentNode) {
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
        closeAllTips(null);
        document.querySelectorAll('.ui-tip-trigger[aria-expanded="true"]').forEach(function (btn) {
          btn.setAttribute('aria-expanded', 'false');
        });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllTips(null);
        document.querySelectorAll('.ui-tip-trigger[aria-expanded="true"]').forEach(function (btn) {
          btn.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  global.SecuriTips = {
    attach: attach,
    wrapLabel: wrapLabel,
    processSteps: processSteps
  };
})(typeof window !== 'undefined' ? window : this);

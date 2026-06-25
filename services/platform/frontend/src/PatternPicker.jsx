import { useCallback, useEffect, useMemo, useState } from 'react';
import './PatternPicker.css';

function groupByCategory(presets) {
  const map = new Map();
  presets.forEach((p) => {
    const key = p.category || 'other';
    if (!map.has(key)) {
      map.set(key, { id: key, label: p.categoryLabel || key, items: [] });
    }
    map.get(key).items.push(p);
  });
  return Array.from(map.values());
}

export default function PatternPicker({ apiBase, onChange, initialIds = [], initialCustomRegex = '' }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const [customRegex, setCustomRegex] = useState(initialCustomRegex);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBase}/redaction-patterns`, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('Desenler yüklenemedi');
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setPresets(data.presets || []);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Yükleme hatası');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiBase]);

  const emit = useCallback((nextSelected, nextCustom) => {
    onChange?.({
      patternIds: Array.from(nextSelected),
      customRegex: nextCustom,
    });
  }, [onChange]);

  useEffect(() => {
    emit(selected, customRegex);
  }, [selected, customRegex, emit]);

  const groups = useMemo(() => groupByCategory(presets), [presets]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q) ||
            (p.example || '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, filter]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(items, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      items.forEach((p) => {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      });
      return next;
    });
  }

  function selectCommon() {
    setSelected(new Set(['tckn', 'mobile_tr', 'email', 'vkn']));
  }

  if (loading) {
    return <p className="rp-hint">Desenler yükleniyor…</p>;
  }

  if (error) {
    return <p className="rp-error">{error}</p>;
  }

  return (
    <div className="pattern-picker">
      <div className="rp-toolbar">
        <input
          type="search"
          className="rp-search"
          placeholder="Desen ara…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Desen ara"
        />
        <button type="button" className="rp-btn" onClick={selectCommon}>
          Sık kullanılanları seç
        </button>
        <button type="button" className="rp-btn rp-btn-muted" onClick={() => setSelected(new Set())}>
          Temizle
        </button>
      </div>

      <div className="rp-groups">
        {filteredGroups.map((group) => {
          const allChecked = group.items.every((p) => selected.has(p.id));
          const someChecked = group.items.some((p) => selected.has(p.id));
          return (
            <section key={group.id} className="rp-group">
              <header className="rp-group-head">
                <label className="rp-group-toggle">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !allChecked && someChecked;
                    }}
                    onChange={(e) => toggleGroup(group.items, e.target.checked)}
                  />
                  <span>{group.label}</span>
                </label>
                <span className="rp-count">
                  {group.items.filter((p) => selected.has(p.id)).length}/{group.items.length}
                </span>
              </header>
              <div className="rp-cards">
                {group.items.map((preset) => (
                  <label
                    key={preset.id}
                    className={'rp-card' + (selected.has(preset.id) ? ' active' : '')}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(preset.id)}
                      onChange={() => toggle(preset.id)}
                    />
                    <div className="rp-card-body">
                      <strong>{preset.title}</strong>
                      {preset.description ? <p>{preset.description}</p> : null}
                      {preset.example ? (
                        <code className="rp-example">örn. {preset.example}</code>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="rp-custom">
        <label className="rp-custom-label">
          <span>Özel regex (isteğe bağlı)</span>
          <textarea
            rows={2}
            value={customRegex}
            placeholder="Ek desen: örn. GİZLİ|ÇOK GİZLİ"
            onChange={(e) => setCustomRegex(e.target.value)}
          />
        </label>
        <p className="rp-hint">
          Seçilen desenler regex olarak PDF metninde aranır. Taranmış belgelerde önce OCR uygulayın.
        </p>
      </div>
    </div>
  );
}

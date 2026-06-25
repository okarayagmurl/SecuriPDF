import { useCallback, useEffect, useMemo, useState } from 'react';
import PatternPicker from './PatternPicker.jsx';
import PdfPreview from './PdfPreview.jsx';
import './RedactionWorkspace.css';

export default function RedactionWorkspace({
  apiBase,
  form,
  fileInputName = 'fileInput',
  onChange,
}) {
  const [blobUrl, setBlobUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [patternIds, setPatternIds] = useState([]);
  const [customRegex, setCustomRegex] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const emit = useCallback((ids, custom) => {
    onChange?.({ patternIds: ids, customRegex: custom });
  }, [onChange]);

  const handlePatternChange = useCallback((state) => {
    setPatternIds(state.patternIds || []);
    setCustomRegex(state.customRegex || '');
    emit(state.patternIds || [], state.customRegex || '');
    setScanResult(null);
    setScanError('');
  }, [emit]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    if (!form) return undefined;
    const input = form.querySelector(`[name="${fileInputName}"]`);
    if (!input) return undefined;
    let objectUrl = '';

    function onFileChange() {
      const file = input.files && input.files[0];
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
      if (!file) {
        setBlobUrl('');
        setFileName('');
        setScanResult(null);
        return;
      }
      setFileName(file.name);
      setScanResult(null);
      setScanError('');
      setCurrentPage(1);
      objectUrl = URL.createObjectURL(file);
      setBlobUrl(objectUrl);
    }

    input.addEventListener('change', onFileChange);
    return () => {
      input.removeEventListener('change', onFileChange);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [form, fileInputName]);

  const currentPageData = useMemo(() => {
    if (!scanResult?.pages) return { matches: [] };
    const page = scanResult.pages.find((p) => p.page === currentPage);
    return { matches: page?.matches || [] };
  }, [scanResult, currentPage]);

  async function runScan() {
    if (!form) {
      setScanError('Form bulunamadı');
      return;
    }
    const input = form.querySelector(`[name="${fileInputName}"]`);
    const file = input?.files?.[0];
    if (!file) {
      setScanError('Önce PDF dosyası seçin');
      return;
    }
    if (!patternIds.length && !customRegex.trim()) {
      setScanError('En az bir desen seçin');
      return;
    }

    setScanning(true);
    setScanError('');
    const fd = new FormData();
    fd.append('fileInput', file);
    fd.append('redactPatternIds', JSON.stringify(patternIds));
    fd.append('customRedactRegex', customRegex);

    try {
      const resp = await fetch(`${apiBase}/redaction/scan`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!resp.ok) {
        let msg = 'Tarama başarısız';
        if (data?.detail) {
          msg = typeof data.detail === 'string' ? data.detail : (data.detail[0]?.msg || msg);
        } else if (text) {
          msg = text.slice(0, 200);
        }
        throw new Error(msg);
      }
      setScanResult(data);
      setCurrentPage(1);
    } catch (err) {
      setScanResult(null);
      setScanError(err.message || 'Tarama hatası');
    } finally {
      setScanning(false);
    }
  }

  const pageCount = scanResult?.pageCount || 0;

  return (
    <div className="redaction-workspace">
      <div className="rw-preview">
        <div className="rw-preview-head">
          <strong>Belge önizleme</strong>
          {fileName ? <span className="rw-file-name">{fileName}</span> : (
            <span className="rw-hint">Yukarıdan PDF seçin</span>
          )}
        </div>
        <div className="rw-preview-scroll">
          <PdfPreview blobUrl={blobUrl} fileName={fileName} />
        </div>
        {scanResult ? (
          <>
            <div className="rw-page-nav">
              <button
                type="button"
                className="rp-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Önceki
              </button>
              <span>
                Sayfa {currentPage} / {pageCount}
                {' · '}
                <strong>{scanResult.totalMatches}</strong> eşleşme
              </span>
              <button
                type="button"
                className="rp-btn"
                disabled={currentPage >= pageCount}
                onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
              >
                Sonraki
              </button>
            </div>
            {currentPageData.matches.length > 0 ? (
              <ul className="rw-match-list">
                {currentPageData.matches.slice(0, 12).map((m, i) => (
                  <li key={i}>
                    <span className="rw-match-tag">{m.patternTitle}</span>
                    <code>{m.text}</code>
                  </li>
                ))}
                {currentPageData.matches.length > 12 ? (
                  <li className="rw-hint">+{currentPageData.matches.length - 12} eşleşme daha…</li>
                ) : null}
              </ul>
            ) : (
              <p className="rw-hint">Bu sayfada eşleşme yok.</p>
            )}
          </>
        ) : null}
      </div>

      <div className="rw-patterns">
        <PatternPicker apiBase={apiBase} onChange={handlePatternChange} />
        <div className="rw-scan-bar">
          <button
            type="button"
            className="rp-btn rw-scan-btn"
            disabled={scanning || !blobUrl}
            onClick={runScan}
          >
            {scanning ? 'Taranıyor…' : 'Belgede tara'}
          </button>
          {scanResult ? (
            <span className="rw-scan-ok">
              {scanResult.totalMatches} alan karartılacak — İşle ile uygulayın
            </span>
          ) : null}
          {scanError ? <span className="rw-scan-err">{scanError}</span> : null}
        </div>
      </div>
    </div>
  );
}

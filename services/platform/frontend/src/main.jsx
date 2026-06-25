import { createRoot } from 'react-dom/client';
import PatternPicker from './PatternPicker.jsx';
import RedactionWorkspace from './RedactionWorkspace.jsx';

function mount(container, options = {}) {
  if (!container) throw new Error('mount container gerekli');
  const root = createRoot(container);
  root.render(
    <PatternPicker
      apiBase={options.apiBase || '/api/app/v1'}
      onChange={options.onChange}
      initialIds={options.initialIds || []}
      initialCustomRegex={options.initialCustomRegex || ''}
    />,
  );
  return { unmount() { root.unmount(); } };
}

function mountWorkspace(container, options = {}) {
  if (!container) throw new Error('mount container gerekli');
  const root = createRoot(container);
  root.render(
    <RedactionWorkspace
      apiBase={options.apiBase || '/api/app/v1'}
      form={options.form || null}
      fileInputName={options.fileInputName || 'fileInput'}
      onChange={options.onChange}
    />,
  );
  return { unmount() { root.unmount(); } };
}

window.SecuriPDFRedaction = { mount, mountWorkspace };

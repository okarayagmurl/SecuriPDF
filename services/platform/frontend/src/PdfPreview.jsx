export default function PdfPreview({ blobUrl, fileName }) {
  if (!blobUrl) {
    return <div className="rw-preview-empty">PDF seçildiğinde burada görüntülenir</div>;
  }
  return (
    <iframe
      title={fileName || 'PDF önizleme'}
      className="rw-pdf-iframe"
      src={blobUrl}
    />
  );
}

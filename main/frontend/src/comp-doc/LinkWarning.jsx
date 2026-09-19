export function LinkWarning({ text = '', onDismiss }) {
  if (!text) return null;

  return (
    <>
      <span className="doc-link-warning" role="alert">
        <span>{text}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </span>
      <span className="doc-link-warning-arrow" aria-hidden="true" />
    </>
  );
}
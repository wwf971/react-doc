import { DocNavigationButtons } from './DocNavigationButtons.jsx';

export function DocPageToolbar() {
  return (
    <div className="doc-page-toolbar" role="toolbar" aria-label="Document actions">
      <DocNavigationButtons />
    </div>
  );
}
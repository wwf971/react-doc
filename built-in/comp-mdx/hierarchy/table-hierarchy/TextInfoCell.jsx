import { Info } from '../../../../main/frontend/UICommon.js';
import './TableHierarchy.css';

function TextInfoCell({ data = {} }) {
  const text = String(data.value ?? '');
  const tooltip = typeof data.tooltip === 'string' ? data.tooltip.trim() : '';
  return (
    <span className="text-info-cell">
      <span className="table-hierarchy-cell-plain" title={text}>{text}</span>
      {tooltip ? <button type="button" className="text-info-cell-icon"
        title={tooltip} aria-label={`${text}: ${tooltip}`}>
        <Info size={14} aria-hidden="true" />
      </button> : null}
    </span>
  );
}

export { TextInfoCell };
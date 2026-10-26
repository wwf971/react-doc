import { Eye, EyeOff, Filter } from '../../../../main/frontend/UICommon.js';
import { toolDisplayModeNext } from '../table-hierarchy/TableCapabilityData.js';
import './ListHierarchy.css';

const modeById = {
  all: { label: '\u5168\u3066\u8868\u793a', Icon: Eye },
  supported: { label: '\u5bfe\u5fdc\u30fb\u4e00\u90e8\u5bfe\u5fdc\u306e\u307f\u8868\u793a', Icon: Filter },
  hidden: { label: '\u975e\u8868\u793a', Icon: EyeOff },
};

function ListToolsControls({ data = {}, onEvent }) {
  const displayById = data.context?.toolDisplayById ?? {};
  return (
    <div className="list-tools-controls" role="group" aria-label="表示する開発ツール">
      {(data.columns ?? []).map((column) => {
        const mode = displayById[column.id] ?? 'supported';
        const definition = modeById[mode];
        if (!definition) return <span key={column.id} role="alert">{`Unknown tool display mode: ${String(mode)}`}</span>;
        const modeNext = toolDisplayModeNext(mode);
        const { Icon } = definition;
        const title = `${column.label}: ${definition.label}\n\u6b21: ${modeById[modeNext].label}`;
        return <button key={column.id} type="button" className={`list-tools-control is-${mode}`}
          title={title} aria-label={title} aria-pressed={mode !== 'hidden'}
          onClick={() => onEvent?.('contextChange', { context: { toolDisplayById: { ...displayById, [column.id]: modeNext } } })}>
          <Icon size={13} aria-hidden="true" /><span>{column.label}</span>
        </button>;
      })}
    </div>
  );
}

export { ListToolsControls };
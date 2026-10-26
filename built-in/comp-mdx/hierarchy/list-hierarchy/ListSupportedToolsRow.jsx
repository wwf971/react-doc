import { Check, CircleHelp, Minus, TriangleAlert, X } from '../../../../main/frontend/UICommon.js';
import { TableHierarchyCell } from '../table-hierarchy/TableHierarchyCell.jsx';
import { capabilityValueGet, toolsDisplayBuild } from '../table-hierarchy/TableCapabilityData.js';

const statusById = {
  yes: { label: '\u5bfe\u5fdc', Icon: Check },
  partial: { label: '\u4e00\u90e8\u5bfe\u5fdc', Icon: TriangleAlert },
  no: { label: '\u975e\u5bfe\u5fdc', Icon: X },
  na: { label: '\u5bfe\u8c61\u5916', Icon: Minus },
  unknown: { label: '\u672a\u78ba\u8a8d', Icon: CircleHelp },
};

function ListSupportedToolsRow({ data = {}, config = {}, onEvent }) {
  let tools;
  let isUnknown;
  const displayById = data.context?.toolDisplayById ?? {};
  const isHiddenAll = data.columns?.every((column) => displayById[column.id] === 'hidden');
  try {
    tools = toolsDisplayBuild(data.columns, data.row.cells, displayById);
    isUnknown = data.columns.some((column) => {
      const cell = data.row.cells[column.id];
      return displayById[column.id] !== 'hidden' && capabilityValueGet(cell?.value ?? cell?.data?.value).status === 'unknown';
    });
  } catch (error) {
    return <span role="alert">{String(error.message ?? error)}</span>;
  }
  return (
    <div className="list-supported-tools-row">
      <span className="table-hierarchy-name"><TableHierarchyCell cell={data.row.labelCell} config={config}
        onEvent={onEvent} instanceId={`${config.instanceId}:name`} />
        {data.row.description ? <small title={data.row.description}>{data.row.description}</small> : null}
      </span>
      <div className="list-supported-tools-badges">
        {tools.map((tool) => {
          const { label: labelStatus, Icon } = statusById[tool.status];
          return <span key={tool.id} className={`list-supported-tools-badge is-${tool.status}`}
            aria-label={`${tool.label}: ${labelStatus}`} title={[tool.description, labelStatus, tool.note].filter(Boolean).join('\n')}>
            <Icon size={12} aria-hidden="true" /><span>{tool.label}</span>
          </span>;
        })}
        {!tools.length ? <span className="list-supported-tools-empty">{isHiddenAll ? '表示対象なし' : isUnknown ? '対応ツール未確認' : '対応ツールなし'}</span> : null}
      </div>
    </div>
  );
}

export { ListSupportedToolsRow };
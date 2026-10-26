import { useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from '../../../../main/frontend/UICommon.js';
import { tableHierarchyDataParse, tableHierarchyRowsBuild, hierarchyGroupsStateBuild } from './TableHierarchyData.js';
import { TableHierarchyCell } from './TableHierarchyCell.jsx';
import { hierarchyGroupHandlersBuild } from './HierarchyGroupInteraction.js';
import { HierarchyHeader, useHierarchyContext } from './HierarchyHeader.jsx';
import './TableHierarchy.css';

function TableHierarchy({ data = {}, config = {}, onEvent }) {
  let value;
  try {
    value = tableHierarchyDataParse(data);
  } catch (error) {
    return <div className="table-hierarchy-error" role="alert">{String(error.message ?? error)}</div>;
  }

  return <TableHierarchyView key={JSON.stringify(value)} value={value} config={config} onEvent={onEvent} />;
}

function TableHierarchyView({ value, config, onEvent }) {
  const titleId = useId();
  const [expandedByKey, setExpandedByKey] = useState({});
  const { context, eventHandle } = useHierarchyContext(value.context, onEvent);
  const configShared = { ...config, context };
  const dragRef = useRef(null);
  const model = tableHierarchyRowsBuild(value.rows, expandedByKey);
  const groupToggle = (node, isExpanded) => {
    setExpandedByKey((previous) => ({ ...previous, [node.key]: !isExpanded }));
  };
  const groupsSet = (isExpanded) => {
    setExpandedByKey(hierarchyGroupsStateBuild(value.rows, isExpanded));
  };
  const widthTable = `calc(${Array.from({ length: model.depth }, () => value.rowHeaderWidth).concat(value.columns.map((column) => column.width)).join(' + ')})`;
  const dragEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = { ...drag, isFinished: true };
  };
  return (
    <section
      className={`table-hierarchy-panel not-prose is-height-${value.heightMode} is-density-${value.density}${value.cellBorders ? ' has-cell-borders' : ''}`}
      style={value.heightMode === 'auto' ? undefined : { [value.heightMode === 'fixed' ? 'height' : 'maxHeight']: value.height }}
      aria-labelledby={titleId}
    >
      <HierarchyHeader id={titleId} value={value} context={context} config={configShared}
        onEvent={eventHandle} onGroupsSet={groupsSet} />
    <div
      className="table-hierarchy-scroll"
      tabIndex={0}
      role="region"
      aria-label={value.title || value.rowHeader}
      onPointerDown={(event) => {
        dragRef.current = null;
        const panel = event.currentTarget;
        if (event.pointerType !== 'mouse' || event.button !== 0
          || panel.scrollWidth <= panel.clientWidth
          || event.target.closest('button, a, input, select, textarea, .table-hierarchy-name, .table-hierarchy-row-group.is-band')) return;
        dragRef.current = {
          pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          scrollLeft: panel.scrollLeft, isDragging: false,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.isFinished || drag.pointerId !== event.pointerId) return;
        const distance = event.clientX - drag.x;
        if (!drag.isDragging) {
          if (Math.abs(distance) < 6) return;
          if (Math.abs(event.clientY - drag.y) > Math.abs(distance)) {
            dragRef.current = null;
            return;
          }
          drag.isDragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add('is-dragging');
        }
        event.preventDefault();
        event.currentTarget.scrollLeft = drag.scrollLeft - distance;
      }}
      onPointerUp={dragEnd}
      onPointerCancel={dragEnd}
      onLostPointerCapture={dragEnd}
      onPointerLeave={(event) => {
        if (!dragRef.current?.isDragging) dragEnd(event);
      }}
      onClickCapture={(event) => {
        if (dragRef.current?.isDragging) {
          event.preventDefault();
          event.stopPropagation();
        }
        dragRef.current = null;
      }}
    >
      <table className="table-hierarchy" aria-labelledby={titleId} style={{ width: widthTable, minWidth: '100%' }}>
        <colgroup>
          {Array.from({ length: model.depth }, (_, index) => <col key={`row-${index}`} style={{ width: value.rowHeaderWidth }} />)}
          {value.columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="table-hierarchy-row-heading" colSpan={model.depth} scope={model.depth === 1 ? 'col' : 'colgroup'}>
              {value.rowHeader}
            </th>
            {value.columns.map((column) => (
              <th className="table-hierarchy-column-heading" key={column.id} scope="col">
                <span>{column.label}</span>
                {column.description ? <small>{column.description}</small> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.key}>
              {row.headers.map(({ node, indent, rowSpan, colSpan, isExpanded }) => {
                const isLeaf = !node.children;
                return (
                  <th
                    className={isLeaf ? 'table-hierarchy-row-leaf' : `table-hierarchy-row-group${node.groupDisplay === 'row' ? ' is-band' : ''}`}
                    colSpan={colSpan + (row.isGroupRow && node.groupDisplay === 'row' ? value.columns.length : 0)}
                    key={node.key}
                    rowSpan={rowSpan}
                    scope={isLeaf ? 'row' : 'rowgroup'}
                    {...(!isLeaf ? hierarchyGroupHandlersBuild(() => groupToggle(node, isExpanded)) : {})}
                  >
                    <div className="table-hierarchy-row-label" style={{ paddingInlineStart: `${indent * 0.65}rem` }}>
                      {!isLeaf ? (
                        <button
                          className="table-hierarchy-toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={node.label}
                          title={isExpanded ? '折りたたむ' : '展開する'}
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      ) : null}
                      <span className="table-hierarchy-name">
                        <TableHierarchyCell cell={node.labelCell} config={configShared} onEvent={eventHandle} instanceId={`${config.instanceId}:label:${node.key}`} />
                        {node.description ? <small title={node.description}>{node.description}</small> : null}
                      </span>
                      {!isLeaf && node.groupDisplay === 'row' ? <span className="table-hierarchy-group-rule" /> : null}
                    </div>
                  </th>
                );
              })}
              {!row.isGroupRow && value.columns.map((column) => (
                row.cells
                  ? <td key={column.id}><TableHierarchyCell cell={row.cells[column.id]} component={column.cellComponent} config={configShared} onEvent={eventHandle} instanceId={`${config.instanceId}:${row.key}:${column.id}`} /></td>
                  : <td key={column.id} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </section>
  );
}

export { TableHierarchy };

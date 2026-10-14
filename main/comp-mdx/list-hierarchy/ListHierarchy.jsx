import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from '../../frontend/UICommon.js';
import { RegisteredComp } from '../../comp-doc/registry/RegisteredComp.jsx';
import { listHierarchyDataParse, hierarchyListRowsBuild, hierarchyGroupsStateBuild } from '../table-hierarchy/TableHierarchyData.js';
import { TableHierarchyCell } from '../table-hierarchy/TableHierarchyCell.jsx';
import { hierarchyGroupHandlersBuild } from '../table-hierarchy/HierarchyGroupInteraction.js';
import { HierarchyHeader, useHierarchyContext } from '../table-hierarchy/HierarchyHeader.jsx';
import '../table-hierarchy/TableHierarchy.css';
import './ListHierarchy.css';

function ListHierarchy({ data = {}, config = {}, onEvent }) {
  let value;
  try {
    value = listHierarchyDataParse(data);
  } catch (error) {
    return <div role="alert">{String(error.message ?? error)}</div>;
  }
  return <ListHierarchyPanel key={JSON.stringify(value)} value={value} config={config} onEvent={onEvent} />;
}

function ListHierarchyPanel({ value, config, onEvent }) {
  const id = useId();
  const [expandedByKey, setExpandedByKey] = useState({});
  const { context, eventHandle } = useHierarchyContext(value.context, onEvent);
  const configShared = { ...config, context };
  const rows = hierarchyListRowsBuild(value.rows, expandedByKey);
  return (
    <section className={`table-hierarchy-panel list-hierarchy-panel not-prose is-height-${value.heightMode}`}
      style={value.heightMode === 'auto' ? undefined : { [value.heightMode === 'fixed' ? 'height' : 'maxHeight']: value.height }}
      aria-labelledby={id}>
      <HierarchyHeader id={id} value={value} context={context} config={configShared} onEvent={eventHandle}
        onGroupsSet={(isExpanded) => setExpandedByKey(hierarchyGroupsStateBuild(value.rows, isExpanded))} />
      <div className="table-hierarchy-scroll" role="region" aria-labelledby={id} tabIndex={0}>
        <ul className="list-hierarchy-rows">
          {rows.map(({ node, depth, isExpanded }) => (
            <li key={node.key} style={{ paddingInlineStart: `${depth * 0.65 + (node.children ? 0 : 1.65)}rem` }}>
              {node.children ? (
                <div className="list-hierarchy-group" {...hierarchyGroupHandlersBuild(() => {
                  setExpandedByKey((previous) => ({ ...previous, [node.key]: !isExpanded }));
                })}>
                  <button type="button" className="table-hierarchy-toggle" aria-expanded={isExpanded}
                    aria-label={node.label} title={isExpanded ? '折りたたむ' : '展開する'}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <span className="table-hierarchy-name"><TableHierarchyCell cell={node.labelCell} config={configShared}
                    onEvent={eventHandle} instanceId={`${config.instanceId ?? id}:label:${node.key}`} />
                    {node.description ? <small title={node.description}>{node.description}</small> : null}
                  </span>
                  <span className="table-hierarchy-group-rule" />
                </div>
              ) : <RegisteredComp compName={node.component || value.rowComponent} placement="hierarchyRow"
                configRuntime={{ ...configShared, instanceId: `${config.instanceId ?? id}:row:${node.key}` }}
                input={{ data: { ...node.data, row: node, columns: value.columns, context }, lang: config.lang }}
                onEventRuntime={eventHandle} />}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export { ListHierarchy };
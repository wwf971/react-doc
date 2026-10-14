import { useState } from 'react';
import { ListChevronsDownUp, ListChevronsUpDown } from '../../frontend/UICommon.js';
import { RegisteredComp } from '../../comp-doc/registry/RegisteredComp.jsx';
import { hierarchyContextMerge } from './TableHierarchyData.js';

function useHierarchyContext(contextInitial, onEvent) {
  const [context, setContext] = useState(contextInitial);
  const eventHandle = (eventType, eventData = {}) => {
    if (eventType === 'contextChange') {
      const patch = hierarchyContextMerge({}, eventData.context);
      setContext((previous) => hierarchyContextMerge(previous, patch));
      return { isHandled: true };
    }
    return onEvent?.(eventType, eventData);
  };
  return { context, eventHandle };
}

function HierarchyHeader({ id, value, context, config, onEvent, onGroupsSet }) {
  return (
    <div className="table-hierarchy-title">
      <span id={id} className="table-hierarchy-title-text" title={value.title || value.rowHeader}>{value.title || value.rowHeader}</span>
      <div className="hierarchy-header-right">
        {value.headerRight ? <div className="hierarchy-header-custom">
          <RegisteredComp compName={value.headerRight.component} placement="hierarchyHeader"
            configRuntime={{ ...config, instanceId: `${config.instanceId ?? id}:headerRight` }}
            input={{ data: { ...value.headerRight.data, columns: value.columns, rows: value.rows, context }, config: value.headerRight.config }}
            onEventRuntime={onEvent} />
        </div> : null}
        <div className="table-hierarchy-title-actions">
          <button type="button" title="すべて展開" aria-label="すべて展開" onClick={() => onGroupsSet(true)}><ListChevronsUpDown size={16} /></button>
          <button type="button" title="すべて折りたたむ" aria-label="すべて折りたたむ" onClick={() => onGroupsSet(false)}><ListChevronsDownUp size={16} /></button>
        </div>
      </div>
    </div>
  );
}

export { HierarchyHeader, useHierarchyContext };
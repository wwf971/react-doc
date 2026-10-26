import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';

function TableHierarchyCell({ cell, component, config, onEvent, instanceId }) {
  const compName = cell.component || component;
  if (compName) {
    return (
      <RegisteredComp
        compName={compName}
        placement="tableCell"
        configRuntime={{ ...config, instanceId }}
        input={{ data: { value: cell.value, ...cell.data }, config: cell.config }}
        onEventRuntime={onEvent}
      />
    );
  }
  const text = cell.value === null ? '' : String(cell.value ?? '');
  return <span className="table-hierarchy-cell-plain" title={text}>{text}</span>;
}

export { TableHierarchyCell };
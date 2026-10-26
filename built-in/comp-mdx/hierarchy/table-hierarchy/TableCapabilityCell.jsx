const statusById = {
  yes: { symbol: '○', label: '対応' },
  partial: { symbol: '△', label: '一部対応' },
  no: { symbol: '×', label: '非対応' },
  na: { symbol: '—', label: '対象外' },
  unknown: { symbol: '?', label: '未確認' },
};

function TableCapabilityCell({ data = {} }) {
  const value = data.value;
  const statusId = typeof value === 'string' ? value : value?.status;
  const status = statusById[statusId];
  if (!status) return <span role="alert">Unknown capability: {String(statusId)}</span>;
  return (
    <div className={`table-capability-cell is-${statusId}`}>
      <span className="table-hierarchy-status">
        <span aria-hidden="true" className="table-hierarchy-status-symbol">{status.symbol}</span>
        <span>{value?.label ?? status.label}</span>
      </span>
      {value?.note ? <small>{value.note}</small> : null}
    </div>
  );
}

export { TableCapabilityCell };
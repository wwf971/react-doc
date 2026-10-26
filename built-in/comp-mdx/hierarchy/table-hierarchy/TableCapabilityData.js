function capabilityValueGet(value) {
  const status = typeof value === 'string' ? value : value?.status;
  if (!['yes', 'partial', 'no', 'na', 'unknown'].includes(status)) {
    throw new Error(`Unknown capability: ${String(status)}`);
  }
  return { status, note: typeof value?.note === 'string' ? value.note : '' };
}

function toolsSupportedBuild(columns, cells) {
  return toolsDisplayBuild(columns, cells);
}

function toolsDisplayBuild(columns, cells, displayById = {}) {
  return columns.flatMap((column) => {
    const cell = cells[column.id];
    const value = capabilityValueGet(cell?.value ?? cell?.data?.value);
    const mode = displayById[column.id] ?? 'supported';
    if (!['all', 'supported', 'hidden'].includes(mode)) throw new Error(`Unknown tool display mode: ${String(mode)}`);
    return mode === 'all' || (mode === 'supported' && ['yes', 'partial'].includes(value.status))
      ? [{ ...column, ...value }] : [];
  }).sort((toolFirst, toolSecond) => {
    const order = { yes: 0, partial: 1, no: 2, unknown: 3, na: 4 };
    return order[toolFirst.status] - order[toolSecond.status];
  });
}

function toolDisplayModeNext(mode = 'supported') {
  const modes = ['all', 'supported', 'hidden'];
  if (!modes.includes(mode)) throw new Error(`Unknown tool display mode: ${String(mode)}`);
  return modes[(modes.indexOf(mode) + 1) % modes.length];
}

export { capabilityValueGet, toolsSupportedBuild, toolsDisplayBuild, toolDisplayModeNext };
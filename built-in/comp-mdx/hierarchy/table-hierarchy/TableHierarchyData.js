import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';

function tableHierarchyDataParse(data = {}) {
  return hierarchyDataParse(data, false);
}

function listHierarchyDataParse(data = {}) {
  return hierarchyDataParse(data, true);
}

function hierarchyDataParse(data, isList) {
  const parsed = data.raw ? yamlParse(data.raw) : data;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TableHierarchy data must be a mapping.');
  }

  const columns = isList && parsed.columns === undefined ? [] : columnsNormalize(parsed.columns);
  const columnIdSet = new Set(columns.map((column) => column.id));
  const groupDisplay = groupDisplayNormalize(parsed.groupDisplay, 'column', 'groupDisplay');
  const isExpandedDefault = booleanNormalize(parsed.isExpandedDefault, true, 'isExpandedDefault');
  const rows = rowsNormalize(parsed.rows, columnIdSet, 'rows', { groupDisplay, isExpandedDefault, isList });
  const rowComponent = textOptional(parsed.rowComponent);
  if (isList) {
    const check = (nodes) => nodes.forEach((node) => {
      if (node.children) check(node.children);
      else if (!node.component && !rowComponent) throw new Error(`ListHierarchy ${node.key} requires a rowComponent or component.`);
    });
    check(rows);
  }
  const heightMode = parsed.heightMode ?? 'auto';
  if (!['auto', 'fixed', 'max'].includes(heightMode)) {
    throw new Error('TableHierarchy heightMode must be auto, fixed, or max.');
  }
  const height = sizeNormalize(parsed.height, heightMode === 'auto' ? undefined : '24rem', 'height');
  const density = parsed.density ?? 'normal';
  if (!['normal', 'roomy'].includes(density)) {
    throw new Error('TableHierarchy density must be normal or roomy.');
  }

  return {
    headerRight: parsed.headerRight === undefined ? undefined : {
      ...cellNormalize(parsed.headerRight, 'headerRight'),
      component: textRequired(parsed.headerRight?.component, 'headerRight.component'),
    },
    context: hierarchyContextMerge({}, parsed.context ?? {}),
    rowComponent,
    heightMode,
    height,
    density,
    cellBorders: booleanNormalize(parsed.cellBorders, false, 'cellBorders'),
    rowHeaderWidth: sizeNormalize(parsed.rowHeaderWidth, '10rem', 'rowHeaderWidth'),
    title: textOptional(parsed.title),
    rowHeader: textOptional(parsed.rowHeader) || '項目',
    columns,
    rows,
    depth: rowDepthGet(rows),
  };
}

function hierarchyContextMerge(context, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Hierarchy context must be a mapping.');
  }
  return { ...context, ...patch };
}

export { hierarchyContextMerge };

function columnsNormalize(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('TableHierarchy requires a non-empty columns list.');
  }
  const idSet = new Set();
  return columns.map((column, index) => {
    if (!column || typeof column !== 'object' || Array.isArray(column)) {
      throw new Error(`TableHierarchy columns[${index}] must be a mapping.`);
    }
    const id = textRequired(column.id, `columns[${index}].id`);
    if (idSet.has(id)) throw new Error(`TableHierarchy column id must be unique: ${id}.`);
    idSet.add(id);
    return {
      id,
      label: textRequired(column.label, `columns[${index}].label`),
      description: textOptional(column.description),
      width: sizeNormalize(column.width, '9rem', `columns[${index}].width`),
      cellComponent: textOptional(column.cellComponent),
    };
  });
}

function rowsNormalize(rows, columnIdSet, path = 'rows', defaults = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`TableHierarchy ${path} must be a non-empty list.`);
  }
  return rows.map((row, index) => rowNormalize(row, columnIdSet, `${path}[${index}]`, defaults));
}

function rowNormalize(row, columnIdSet, path, defaults) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`TableHierarchy ${path} must be a mapping.`);
  }
  const children = row.children === undefined
    ? null
    : rowsNormalize(row.children, columnIdSet, `${path}.children`, defaults);
  if (children && (row.cells !== undefined || row.data !== undefined)) {
    throw new Error(`TableHierarchy ${path} cannot define both children and cells or data.`);
  }
  if (row.data !== undefined && (!row.data || typeof row.data !== 'object' || Array.isArray(row.data))) {
    throw new Error(`ListHierarchy ${path}.data must be a mapping.`);
  }
  if (!children && !(defaults.isList && row.data !== undefined)
    && (!row.cells || typeof row.cells !== 'object' || Array.isArray(row.cells))) {
    throw new Error(`TableHierarchy ${path} requires children or a cells mapping.`);
  }

  const result = {
    key: path,
    groupDisplay: groupDisplayNormalize(row.groupDisplay, defaults.groupDisplay, `${path}.groupDisplay`),
    isExpanded: booleanNormalize(row.isExpanded, defaults.isExpandedDefault, `${path}.isExpanded`),
    label: typeof row.label === 'object' ? textOptional(row.label?.value) : textRequired(row.label, `${path}.label`),
    labelCell: cellNormalize(row.label, `${path}.label`),
    description: textOptional(row.description),
    component: row.component === undefined ? undefined : textRequired(row.component, `${path}.component`),
    data: row.data,
    children,
    cells: children || row.cells === undefined ? null : cellsNormalize(row.cells, columnIdSet, `${path}.cells`),
  };
  result.leafCount = children
    ? children.reduce((count, child) => count + child.leafCount, 0)
    : 1;
  return result;
}

function cellsNormalize(cells, columnIdSet, path) {
  for (const cellId of Object.keys(cells)) {
    if (!columnIdSet.has(cellId)) {
      throw new Error(`TableHierarchy ${path} uses unknown column id: ${cellId}.`);
    }
  }
  return Object.fromEntries([...columnIdSet].map((columnId) => {
    if (cells[columnId] === undefined) {
      throw new Error(`TableHierarchy ${path}.${columnId} is required.`);
    }
    return [columnId, cellNormalize(cells[columnId], `${path}.${columnId}`)];
  }));
}

function cellNormalize(cell, path) {
  if (cell === null || ['string', 'number', 'boolean'].includes(typeof cell)) {
    return { value: cell };
  }
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
    throw new Error(`TableHierarchy ${path} must be a plain value or cell mapping.`);
  }
  if (cell.component !== undefined) {
    return { ...cell, component: textRequired(cell.component, `${path}.component`) };
  }
  return Object.hasOwn(cell, 'value') ? { ...cell } : { value: cell };
}

function sizeNormalize(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${value}px`;
  if (typeof value === 'string' && /^(?:\d+(?:\.\d+)?)(?:px|rem|em|vh|dvh|vw|%)$/.test(value) && parseFloat(value) > 0) return value;
  throw new Error(`TableHierarchy ${path} must be a positive number of pixels or CSS length.`);
}

function rowDepthGet(rows) {
  return Math.max(...rows.map((row) => (
    row.children ? 1 + rowDepthGet(row.children) : 1
  )));
}

function textRequired(value, path) {
  const text = textOptional(value);
  if (!text) throw new Error(`TableHierarchy ${path} is required.`);
  return text;
}

function textOptional(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function groupDisplayNormalize(value, fallback, path) {
  const result = value ?? fallback;
  if (result !== 'row' && result !== 'column') {
    throw new Error(`TableHierarchy ${path} must be row or column.`);
  }
  return result;
}

function booleanNormalize(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`TableHierarchy ${path} must be a boolean.`);
  return value;
}

function tableHierarchyRowsBuild(rows, expandedByKey = {}) {
  const depthGet = (nodes) => Math.max(...nodes.map((node) => (
    node.children
      ? (node.groupDisplay === 'column' ? 1 : 0) + depthGet(node.children)
      : 1
  )));
  const depth = depthGet(rows);
  const visit = (node, level, indent) => {
    const isExpanded = expandedByKey[node.key] ?? node.isExpanded;
    if (!node.children) {
      return [{ key: node.key, headers: [{ node, level, indent, rowSpan: 1, colSpan: depth - level }], cells: node.cells }];
    }
    const header = { node, level, indent, isExpanded, rowSpan: 1, colSpan: 1 };
    if (node.groupDisplay === 'row') {
      header.colSpan = depth - level;
      return [
        { key: node.key, headers: [header], isGroupRow: true, cells: null },
        ...(isExpanded ? node.children.flatMap((child) => visit(child, level, indent + 1)) : []),
      ];
    }
    if (!isExpanded) {
      header.colSpan = depth - level;
      return [{ key: node.key, headers: [header], cells: null }];
    }
    const children = node.children.flatMap((child) => visit(child, level + 1, indent));
    header.rowSpan = children.length;
    children[0].headers.unshift(header);
    return children;
  };
  return { depth, rows: rows.flatMap((row) => visit(row, 0, 0)) };
}

function hierarchyListRowsBuild(rows, expandedByKey = {}) {
  const visit = (node, depth) => {
    const isExpanded = expandedByKey[node.key] ?? node.isExpanded;
    return [
      { node, depth, isExpanded },
      ...(node.children && isExpanded ? node.children.flatMap((child) => visit(child, depth + 1)) : []),
    ];
  };
  return rows.flatMap((node) => visit(node, 0));
}

function hierarchyGroupsStateBuild(rows, isExpanded) {
  const state = {};
  const visit = (nodes) => nodes.forEach((node) => {
    if (!node.children) return;
    state[node.key] = isExpanded;
    visit(node.children);
  });
  visit(rows);
  return state;
}

export { tableHierarchyDataParse, tableHierarchyRowsBuild, listHierarchyDataParse, hierarchyListRowsBuild, hierarchyGroupsStateBuild };

import assert from 'node:assert/strict';
import test from 'node:test';
import { toolsSupportedBuild, toolsDisplayBuild, toolDisplayModeNext } from './TableCapabilityData.js';
import { hierarchyGroupHandlersBuild } from './HierarchyGroupInteraction.js';
import { hierarchyContextMerge } from './TableHierarchyData.js';
import { tableHierarchyDataParse, tableHierarchyRowsBuild, listHierarchyDataParse, hierarchyListRowsBuild, hierarchyGroupsStateBuild } from './TableHierarchyData.js';
test('compact groups honor defaults and keep nested expansion state', () => {
  const value = tableHierarchyDataParse({
    groupDisplay: 'row',
    isExpandedDefault: false,
    columns: [{ id: 'api', label: 'API' }],
    rows: [{ label: 'Data', isExpanded: true, children: [
      { label: 'CRUD', children: [{ label: 'Read', cells: { api: 'yes' } }] },
    ] }],
  });
  const initial = tableHierarchyRowsBuild(value.rows);
  assert.equal(initial.depth, 1);
  assert.equal(initial.rows.length, 2);
  assert.equal(initial.rows[1].headers[0].indent, 1);
  const expanded = { [value.rows[0].children[0].key]: true };
  assert.equal(tableHierarchyRowsBuild(value.rows, expanded).rows.length, 3);
  expanded[value.rows[0].key] = false;
  assert.equal(tableHierarchyRowsBuild(value.rows, expanded).rows.length, 1);
});

test('mixed groups count visible header rows in column spans', () => {
  const value = tableHierarchyDataParse({
    columns: [{ id: 'api', label: 'API' }],
    rows: [{ label: 'Data', children: [{ label: 'CRUD', groupDisplay: 'row', children: [
      { label: 'Read', cells: { api: 'yes' } },
    ] }] }],
  });
  const result = tableHierarchyRowsBuild(value.rows);
  assert.equal(result.depth, 2);
  assert.equal(result.rows[0].headers[0].rowSpan, 2);
  assert.equal(result.rows[0].isGroupRow, true);
});

test('normalizes rows nested at multiple levels and counts leaf rows', () => {
  const result = tableHierarchyDataParse({
    rowHeader: '操作',
    columns: [
      { id: 'cli', label: 'CLI' },
      { id: 'api', label: 'API' },
    ],
    rows: [
      {
        label: 'テーブル行',
        children: [
          {
            label: '書き込み',
            children: [
              { label: '作成', cells: { cli: 'partial', api: 'yes' } },
              { label: '更新', cells: { cli: 'no', api: { status: 'yes', note: 'PATCH' } } },
            ],
          },
          { label: '削除', cells: { cli: 'no', api: 'yes' } },
        ],
      },
    ],
  });

  assert.equal(result.depth, 3);
  assert.equal(result.rows[0].leafCount, 3);
  assert.equal(result.rows[0].children[0].leafCount, 2);
  assert.deepEqual(result.rows[0].children[0].children[1].cells.api, {
    value: { status: 'yes', note: 'PATCH' },
  });
});

test('rejects a leaf missing a declared column', () => {
  assert.throws(() => tableHierarchyDataParse({
    columns: [{ id: 'cli', label: 'CLI' }, { id: 'api', label: 'API' }],
    rows: [{ label: '参照', cells: { cli: 'yes' } }],
  }), /cells\.api is required/);
});

test('rejects rows that mix child rows and cells', () => {
  assert.throws(() => tableHierarchyDataParse({
    columns: [{ id: 'api', label: 'API' }],
    rows: [{
      label: 'データ',
      cells: { api: 'yes' },
      children: [{ label: '参照', cells: { api: 'yes' } }],
    }],
  }), /cannot define both children and cells/);
});

test('parses yes and no status IDs from authored YAML', () => {
  const result = tableHierarchyDataParse({
    raw: `
columns:
  - id: api
    label: API
  - id: cli
    label: CLI
rows:
  - label: 更新
    cells:
      api: yes
      cli: no
`,
  });

  assert.equal(result.rows[0].cells.api.value, 'yes');
  assert.equal(result.rows[0].cells.cli.value, 'no');
});

test('accepts general values, registered renderers, and bounded sizing', () => {
  const result = tableHierarchyDataParse({
    heightMode: 'fixed', height: 320, rowHeaderWidth: '8rem', density: 'roomy', cellBorders: true,
    columns: [{ id: 'score', label: 'Score', cellComponent: 'MetricCell', width: '6rem' }],
    rows: [
      { label: 'Model A', cells: { score: 95.2 } },
      { label: 'Model C', cells: { score: { mean: 91, count: 10 } } },
      { label: { component: 'NameCell', value: 'Model B', data: { name: 'B' } }, cells: { score: { component: 'ChartCell', data: { points: [1, 2] } } } },
    ],
  });
  assert.equal(result.height, '320px');
  assert.equal(result.rowHeaderWidth, '8rem');
  assert.equal(result.density, 'roomy');
  assert.equal(result.cellBorders, true);
  assert.equal(result.rows[0].cells.score.value, 95.2);
  assert.deepEqual(result.rows[1].cells.score, { value: { mean: 91, count: 10 } });
  assert.equal(result.rows[2].labelCell.component, 'NameCell');
  assert.equal(result.rows[2].cells.score.component, 'ChartCell');
});

test('validates height modes and sizes', () => {
  const base = { columns: [{ id: 'value', label: 'Value' }], rows: [{ label: 'Item', cells: { value: true } }] };
  assert.equal(tableHierarchyDataParse({ ...base, heightMode: 'max' }).height, '24rem');
  assert.throws(() => tableHierarchyDataParse({ ...base, heightMode: 'invalid' }), /heightMode/);
  assert.throws(() => tableHierarchyDataParse({ ...base, height: -1 }), /positive/);
  assert.throws(() => tableHierarchyDataParse({ ...base, density: 'dense' }), /density/);
  assert.throws(() => tableHierarchyDataParse({ ...base, cellBorders: 'yes' }), /cellBorders/);
});

test('list hierarchy accepts custom rows without comparison cells', () => {
  const value = listHierarchyDataParse({
    rowComponent: 'BadgeRow', isExpandedDefault: false,
    rows: [{ label: 'Group', isExpanded: true, children: [
      { label: 'First', data: { badges: ['A', 'B'] } },
      { label: 'Nested', children: [{ label: 'Second', component: 'OtherRow', data: { value: 2 } }] },
    ] }],
  });
  assert.equal(value.columns.length, 0);
  assert.equal(hierarchyListRowsBuild(value.rows).length, 3);
  assert.equal(hierarchyListRowsBuild(value.rows)[1].depth, 1);
  const state = hierarchyGroupsStateBuild(value.rows, true);
  assert.equal(hierarchyListRowsBuild(value.rows, state).length, 4);
  assert.deepEqual(value.rows[0].children[0].data, { badges: ['A', 'B'] });
  assert.throws(() => listHierarchyDataParse({ rows: [{ label: 'Missing renderer', data: {} }] }), /rowComponent/);
});

test('list hierarchy accepts the same comparison dataset as the table', () => {
  const data = { rowComponent: 'ToolRow', columns: [{ id: 'api', label: 'API' }], rows: [{ label: 'Read', cells: { api: 'yes' } }] };
  assert.deepEqual(listHierarchyDataParse(data).rows, tableHierarchyDataParse(data).rows);
});

test('supported tools put full support first and preserve priority within each status', () => {
  const columns = ['sdkCodeApps', 'pac', 'webApi', 'no', 'na', 'unknown'].map((id) => ({ id, label: id }));
  const cells = { sdkCodeApps: { value: 'yes' }, pac: { value: { status: 'partial', note: 'Via solution' } },
    webApi: { value: 'yes' }, no: { value: 'no' }, na: { value: 'na' }, unknown: { value: 'unknown' } };
  const tools = toolsSupportedBuild(columns, cells);
  assert.deepEqual(tools.map((tool) => tool.id), ['sdkCodeApps', 'webApi', 'pac']);
  assert.equal(tools[2].note, 'Via solution');
  assert.throws(() => toolsSupportedBuild(columns, { ...cells, pac: { value: 'invalid' } }), /Unknown capability/);
});

test('divider clicks preserve selections and independent controls', () => {
  let count = 0;
  const handlers = hierarchyGroupHandlersBuild(() => count++);
  const eventBuild = ({ x = 10, isCollapsed = true, control = '', button = 0 } = {}) => ({
    button, clientX: x, clientY: 20,
    target: { closest: (selector) => {
      if (control === 'toggle' && selector === '.table-hierarchy-toggle') return {};
      return control && selector.startsWith('button') ? {} : null;
    } },
    currentTarget: { ownerDocument: { getSelection: () => ({ isCollapsed }) } },
  });
  handlers.onPointerDown(eventBuild());
  handlers.onClick(eventBuild());
  assert.equal(count, 1);
  for (const release of [{ x: 11 }, { isCollapsed: false }, { control: 'link' }, { control: 'info' }]) {
    handlers.onPointerDown(eventBuild());
    handlers.onClick(eventBuild(release));
    assert.equal(count, 1);
  }
  handlers.onPointerDown(eventBuild({ button: 2 }));
  handlers.onClick(eventBuild());
  assert.equal(count, 1);
  handlers.onPointerDown(eventBuild());
  handlers.onPointerCancel();
  handlers.onClick(eventBuild());
  assert.equal(count, 1);
  handlers.onClick(eventBuild({ x: 0, control: 'toggle' }));
  assert.equal(count, 2);
});

test('custom info labels preserve their text and tooltip in both hierarchy views', () => {
  const label = { component: 'TextInfoCell', value: 'Table settings', data: { tooltip: 'Display names and table properties, not data rows.' } };
  const data = { rowComponent: 'ToolRow', columns: [{ id: 'api', label: 'API' }], rows: [{ label, children: [{ label, cells: { api: 'yes' } }] }] };
  const table = tableHierarchyDataParse(data);
  const list = listHierarchyDataParse(data);
  assert.deepEqual(table.rows, list.rows);
  assert.equal(table.rows[0].label, label.value);
  assert.deepEqual(table.rows[0].labelCell, label);
  assert.deepEqual(table.rows[0].children[0].labelCell, label);
});

test('tool display modes include unsupported statuses without treating them as supported', () => {
  const columns = ['no', 'unknown', 'na', 'partial', 'yes'].map((id) => ({ id, label: id }));
  const cells = Object.fromEntries(columns.map((column) => [column.id, { value: column.id }]));
  assert.deepEqual(toolsDisplayBuild(columns, cells).map((tool) => tool.id), ['yes', 'partial']);
  assert.deepEqual(toolsDisplayBuild(columns, cells, { no: 'all', unknown: 'all', na: 'all', yes: 'hidden' }).map((tool) => tool.id), ['partial', 'no', 'unknown', 'na']);
  assert.equal(toolDisplayModeNext('all'), 'supported');
  assert.equal(toolDisplayModeNext('supported'), 'hidden');
  assert.equal(toolDisplayModeNext('hidden'), 'all');
  assert.throws(() => toolsDisplayBuild(columns, cells, { no: 'invalid' }), /display mode/);
});

test('hierarchy header slots and shared context stay independent of capability logic', () => {
  const data = { columns: [{ id: 'metric', label: 'Metric' }], rowComponent: 'MetricRow', rows: [{ label: 'Item', cells: { metric: 1 } }],
    headerRight: { component: 'MetricControls', data: { unit: 'ms' } }, context: { scale: 2, color: 'red' } };
  for (const parse of [tableHierarchyDataParse, listHierarchyDataParse]) {
    const value = parse(data);
    assert.deepEqual(value.headerRight, data.headerRight);
    assert.deepEqual(value.context, data.context);
    assert.deepEqual(hierarchyContextMerge(value.context, { scale: 3 }), { scale: 3, color: 'red' });
    assert.equal(value.context.scale, 2);
    assert.throws(() => parse({ ...data, headerRight: { data: {} } }), /headerRight.component/);
    assert.throws(() => parse({ ...data, context: [] }), /context must be a mapping/);
  }
});
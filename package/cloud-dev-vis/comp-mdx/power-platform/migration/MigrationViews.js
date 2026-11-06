import {
	migrationChoiceListOf, migrationChoicePairGet, migrationMappingRowListOf, migrationMappingTableOfPair, migrationPairGet, migrationRankBuild, migrationRowSegmentOf, migrationTableListOf,
} from './MigrationData.js';
import { switchPathLast, switchPathParent, switchRectRead, switchTabsApply } from '../../card-diagram-switch/SwitchData.js';

// The views of a migration, generated from its data items (power-platform-migration.md):
// a provider of the switching layer. Every view is a diagram of the card diagram format,
// a function of the model and nothing else; the same table keeps its node id in every
// view drawing it, which is what lets a switch move it instead of replacing it.
//
//   /overview                         the databases, the tool, the three reports
//   /overview/tabs/{report}           the same, the reports in tabs
//   /overview/{db}                    the ER diagram of a database
//   /overview/{db}/{table}            one table and what it refers to
//   /overview/mapping                 both ER diagrams, the mappings of tables as lines
//   /overview/mapping/{pair}          two tables, the mappings of their columns as lines
//   /overview/mapping/{pair}/{row}    one column through its operators
//   /overview/choice[/{pair}]         the mappings of option sets
//   /overview/plan|run|verify[/...]   the three reports and their sections
const TABLE_WIDTH = 400;
const TABLE_HEIGHT_HEAD = 62;
const TABLE_HEIGHT_ROW = 33;
const CHOICE_WIDTH = TABLE_WIDTH;
const GAP_COLUMN = 170;
const GAP_ROW = 56;
const COLOR_LOOKUP = '#64748b';
const COLOR_CHOICE = '#7c3aed';
const COLOR_MAPPING = '#0d9488';
const LABEL_DEFAULT = {
	sourceDatabase: 'Source database', targetDatabase: 'Target database', migrationServer: 'Migration server', artifacts: 'Outputs',
	overview: 'Overview', tabs: 'Reports in tabs', mapping: 'ER diagrams and mappings', choice: 'Option sets',
	plan: 'Migration plan', run: 'Run report', verify: 'Verification report',
	runFlow: 'How the rows were sent', runResult: 'Result of each batch', verifyFlow: 'How the result was checked', verifySample: 'One row compared', verifyResult: 'Result of the checks', detailHint: 'Click for the details',
	row: 'row', rowOrder: 'the rows in GUID order', batchUnit: 'batches', exceptionUnit: 'exceptions', columnColumn: 'Column', columnSource: 'In the CSV', columnExpected: 'Expected', columnActual: 'In the target',
	planOrder: 'Order of loading', rank: 'Rank', rankRoot: 'looks up nothing', rankNext: 'after what it looks up', rankRule: 'The rank of a table is one past the highest rank it looks up; a table looking up nothing has rank 1. Tables of one rank may load side by side.', cycle: 'a cycle: filled in by a later pass', planBatch: 'Batches', runBatch: 'Batches run', runDlq: 'Dead letters',
	verifySet: 'Sets compared', verifyValue: 'Values compared', verifyException: 'Open exceptions',
	readSource: 'read the structure and the data', readTarget: 'read the structure and the result', write: 'create and update',
	planMake: 'collect, design: save the plan', runMake: 'run, retry: save the result', verifyMake: 'read back, compare: save the verdict',
	planToRun: 'batches', runToVerify: 'success, dead letters', planToVerify: 'keys and expected values',
	abandon: 'Abandon', defaultValue: 'Default value', columnOrder: 'Order', columnTable: 'Table', columnFile: 'File', columnRange: 'Range', columnRows: 'Rows',
	columnStatus: 'Status', columnTry: 'Tries', columnReason: 'Reason', columnKey: 'Key', columnCheck: 'Check', columnResult: 'Result', columnNote: 'Note',
	columnValue: 'Value', columnLabel: 'Label', columnUnit: 'columns', tableUnit: 'tables', choiceUnit: 'option sets', source: 'source', target: 'target', statSuccess: 'success', statDlq: 'dead letters', statTotal: 'total', statMatched: 'matched', statException: 'exceptions',
};

function labelOf(model, id) {
	return model.system.labels?.[id] ?? LABEL_DEFAULT[id] ?? id;
}

const tableNodeId = (dbId, logical) => `table:${dbId}:${logical}`;
const choiceNodeId = (dbId, logical) => `choice:${dbId}:${logical}`;
const dbIdOfRole = (model, role) => (role === 'source' ? model.system.source.id : model.system.target.id);

// ---------- nodes ----------

function tableNodeBuild(table, { x, y, handleList = [], link, width = TABLE_WIDTH, columnList, idNode }) {
	return {
		id: idNode ?? tableNodeId(table.db, table.logical),
		renderer: { type: 'dataverse-table' },
		position: { x, y },
		size: { width, height: 'auto' },
		link,
		data: {
			name: table.name,
			nameLogical: table.logical,
			columns: (columnList ?? table.columnList).map((column) => ({
				id: column.id, name: column.name, nameLogical: column.logical ?? column.id, type: column.type, key: column.key, isRequired: column.isRequired, description: column.description, isEllipsis: column.isEllipsis, tone: column.tone,
			})),
		},
		handles: handleList,
	};
}

function choiceNodeBuild(choice, { x, y, handleList = [], link }) {
	return {
		id: choiceNodeId(choice.db, choice.logical),
		renderer: { type: 'dataverse-choice' },
		position: { x, y },
		size: { width: CHOICE_WIDTH, height: 'auto' },
		link,
		data: {
			name: choice.name,
			nameLogical: choice.logical,
			columns: choice.optionList.map((option) => ({ id: `option-${option.value}`, name: option.label, nameLogical: String(option.value), type: 'Option' })),
		},
		handles: handleList,
	};
}

function genericTableNodeBuild({ id, x, y, width = 520, name, subtitle, tone, fieldList, rowList, handleList = [], link, columnTemplate, isCompact = true }) {
	return {
		id,
		renderer: { type: 'table' },
		position: { x, y },
		size: { width, height: 'auto' },
		link,
		data: { name, nameLogical: subtitle ?? '', isCompact, tone, fields: fieldList, rows: rowList, columnTemplate },
		handles: handleList,
	};
}

function noteNodeBuild({ id, x, y, width = 220, title, text, tone, metaList, tag, handleList = [], link }) {
	return { id, renderer: { type: 'card-note' }, position: { x, y }, size: { width, height: 'auto' }, link, data: { title, text, tone, metaList, tag }, handles: handleList };
}

function embedNodeBuild({ id, x, y, width, height, view, title, subtitle, icon, tone, statList, handleList = [] }) {
	return { id, renderer: { type: 'view-embed' }, position: { x, y }, size: { width, height }, data: { view, title, subtitle, icon, tone, statList }, handles: handleList };
}

const handleOf = (id, direction, side, target = 'body') => ({ id, direction, anchor: { target, side } });
const lineOf = (id, source, target, extra = {}) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] }, ...extra });

const heightOfTable = (table) => TABLE_HEIGHT_HEAD + table.columnList.length * TABLE_HEIGHT_ROW;
const heightOfChoice = (choice) => TABLE_HEIGHT_HEAD + choice.optionList.length * TABLE_HEIGHT_ROW;

// ---------- an ER diagram ----------

// the tables in columns by their lookups (what is referred to at the right), the
// option sets in a row below them. returns nodes and lines, placed from a point
function erBuild(model, dbId, { x = 0, y = 0, linkOf } = {}) {
	const tableList = migrationTableListOf(model, dbId);
	const choiceList = migrationChoiceListOf(model, dbId);
	const depthByKey = new Map();
	const depthOf = (table, chain = []) => {
		if (depthByKey.has(table.key)) return depthByKey.get(table.key);
		if (chain.includes(table.key)) return 0;
		const lookupList = table.columnList.map((column) => model.tableByKey.get(column.lookup)).filter((item) => item && item.key !== table.key);
		const depth = lookupList.length === 0 ? 0 : 1 + Math.max(...lookupList.map((item) => depthOf(item, [...chain, table.key])));
		depthByKey.set(table.key, depth);
		return depth;
	};
	tableList.forEach((table) => depthOf(table));
	const depthMax = Math.max(0, ...depthByKey.values());
	const columnOfTable = new Map();
	const heightByColumn = new Map();
	const placeByKey = new Map();
	for (const table of tableList) {
		const column = depthMax - depthByKey.get(table.key);
		columnOfTable.set(table.key, column);
		const top = heightByColumn.get(column) ?? 0;
		placeByKey.set(table.key, { x: x + column * (TABLE_WIDTH + GAP_COLUMN), y: y + top });
		heightByColumn.set(column, top + heightOfTable(table) + GAP_ROW);
	}
	const handleByNode = new Map();
	const handleAdd = (nodeId, handle) => {
		const list = handleByNode.get(nodeId) ?? [];
		if (!list.some((item) => item.id === handle.id)) list.push(handle);
		handleByNode.set(nodeId, list);
		return handle.id;
	};
	const connections = [];
	for (const table of tableList) {
		const nodeId = tableNodeId(dbId, table.logical);
		for (const column of table.columnList) {
			if (column.lookup && model.tableByKey.has(column.lookup)) {
				const refer = model.tableByKey.get(column.lookup);
				const referId = tableNodeId(dbId, refer.logical);
				const pk = refer.columnList.find((item) => item.key === 'PK') ?? refer.columnList[0];
				const isForward = columnOfTable.get(refer.key) > columnOfTable.get(table.key);
				const out = handleAdd(nodeId, handleOf(`lookup-${column.id}`, 'out', isForward ? 'right' : 'left', `column/${column.id}`));
				const into = handleAdd(referId, handleOf(`pk-${isForward ? 'left' : 'right'}`, 'in', isForward ? 'left' : 'right', `column/${pk.id}`));
				connections.push(lineOf(`lookup:${dbId}:${table.logical}:${column.id}`, [nodeId, out], [referId, into], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.25 } }));
			}
			if (column.choice && model.choiceByKey.has(column.choice)) {
				const choice = model.choiceByKey.get(column.choice);
				const choiceId = choiceNodeId(dbId, choice.logical);
				const out = handleAdd(nodeId, handleOf(`choice-${column.id}`, 'out', 'right', `column/${column.id}`));
				const into = handleAdd(choiceId, handleOf('in', 'in', 'top'));
				connections.push(lineOf(`choice:${dbId}:${table.logical}:${column.id}`, [nodeId, out], [choiceId, into], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
			}
		}
	}
	const heightTables = Math.max(0, ...heightByColumn.values());
	const nodes = tableList.map((table) => tableNodeBuild(table, { ...placeByKey.get(table.key), link: linkOf?.table(table), handleList: handleByNode.get(tableNodeId(dbId, table.logical)) ?? [] }));
	// an option set stands below the first table using it, so its line stays short
	const heightChoiceByColumn = new Map();
	for (const choice of choiceList) {
		const columnList = tableList.filter((table) => table.columnList.some((column) => column.choice === choice.key)).map((table) => columnOfTable.get(table.key));
		const column = columnList.length > 0 ? Math.min(...columnList) : depthMax;
		const top = heightChoiceByColumn.get(column) ?? 0;
		nodes.push(choiceNodeBuild(choice, { x: x + column * (TABLE_WIDTH + GAP_COLUMN), y: y + heightTables + 60 + top, link: linkOf?.choice?.(choice), handleList: handleByNode.get(choiceNodeId(dbId, choice.logical)) ?? [] }));
		heightChoiceByColumn.set(column, top + heightOfChoice(choice) + 40);
	}
	const width = (depthMax + 1) * TABLE_WIDTH + depthMax * GAP_COLUMN;
	const height = heightTables + 60 + Math.max(0, ...heightChoiceByColumn.values());
	return { nodes, connections, width, height };
}

function viewErBuild(model, dbId) {
	const er = erBuild(model, dbId, { linkOf: { table: (table) => `/overview/${dbId}/${table.logical}` } });
	return { nodes: er.nodes, connections: er.connections };
}

// one table in the middle: what refers to it on the left, what it refers to on the right
function viewTableBuild(model, dbId, logical) {
	const table = migrationTableListOf(model, dbId).find((item) => item.logical === logical);
	if (!table) return null;
	const nodes = [];
	const connections = [];
	const nodeId = tableNodeId(dbId, logical);
	const handleList = [];
	const xRight = TABLE_WIDTH + GAP_COLUMN;
	let yRight = 0;
	for (const column of table.columnList) {
		const refer = model.tableByKey.get(column.lookup);
		const choice = model.choiceByKey.get(column.choice);
		if (refer) {
			handleList.push(handleOf(`lookup-${column.id}`, 'out', 'right', `column/${column.id}`));
			const id = `refer:${column.id}`;
			nodes.push(noteNodeBuild({ id, x: xRight, y: yRight, width: 240, title: refer.name, text: refer.logical, tone: 'slate', link: `/overview/${dbId}/${refer.logical}`, handleList: [handleOf('in', 'in', 'left')] }));
			connections.push(lineOf(`refer:${column.id}`, [nodeId, `lookup-${column.id}`], [id, 'in'], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.25 } }));
			yRight += 80;
		}
		if (choice) {
			handleList.push(handleOf(`choice-${column.id}`, 'out', 'right', `column/${column.id}`));
			const id = choiceNodeId(dbId, choice.logical);
			if (!nodes.some((node) => node.id === id)) {
				nodes.push(choiceNodeBuild(choice, { x: xRight, y: yRight, handleList: [handleOf('in-side', 'in', 'left', 'header')] }));
				yRight += heightOfChoice(choice) + 30;
			}
			connections.push(lineOf(`choice:${dbId}:${logical}:${column.id}`, [nodeId, `choice-${column.id}`], [id, 'in-side'], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
		}
	}
	let yLeft = 0;
	const referList = migrationTableListOf(model, dbId).flatMap((item) => item.columnList.filter((column) => column.lookup === table.key).map((column) => ({ table: item, column })));
	const pk = table.columnList.find((column) => column.key === 'PK') ?? table.columnList[0];
	if (referList.length > 0) handleList.push(handleOf('pk-left', 'in', 'left', `column/${pk.id}`));
	for (const { table: from, column } of referList) {
		const id = `from:${from.logical}:${column.id}`;
		nodes.push(noteNodeBuild({ id, x: -320, y: yLeft, width: 240, title: from.name, text: `${from.logical}.${column.logical ?? column.id}`, tone: 'slate', link: `/overview/${dbId}/${from.logical}`, handleList: [handleOf('out', 'out', 'right')] }));
		connections.push(lineOf(`from:${from.logical}:${column.id}`, [id, 'out'], [nodeId, 'pk-left'], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.25 } }));
		yLeft += 80;
	}
	nodes.push(tableNodeBuild(table, { x: 0, y: 0, handleList }));
	return { nodes, connections };
}

// ---------- mappings ----------

// both ER diagrams; a mapping of tables is a line between them, whose label opens it
function viewMappingAllBuild(model) {
	const idSource = dbIdOfRole(model, 'source');
	const idTarget = dbIdOfRole(model, 'target');
	const erSource = erBuild(model, idSource, { linkOf: { table: (table) => `/overview/${idSource}/${table.logical}` } });
	const offset = erSource.width + 420;
	const erTarget = erBuild(model, idTarget, { x: offset, linkOf: { table: (table) => `/overview/${idTarget}/${table.logical}` } });
	const nodes = [...erSource.nodes, ...erTarget.nodes];
	const connections = [...erSource.connections, ...erTarget.connections];
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	for (const mapping of model.mappingTableByKey.values()) {
		const source = model.tableByKey.get(mapping.source);
		const target = model.tableByKey.get(mapping.target);
		if (!source || !target) continue;
		const nodeSource = nodeById.get(tableNodeId(idSource, source.logical));
		const nodeTarget = nodeById.get(tableNodeId(idTarget, target.logical));
		if (!nodeSource || !nodeTarget) continue;
		nodeSource.handles = [...nodeSource.handles, handleOf(`map-${mapping.key}`, 'out', 'right')];
		nodeTarget.handles = [...nodeTarget.handles, handleOf(`map-${mapping.key}`, 'in', 'left')];
		const pair = migrationPairGet(model, mapping);
		connections.push(lineOf(`map:${pair}`, [nodeSource.id, `map-${mapping.key}`], [nodeTarget.id, `map-${mapping.key}`], {
			renderer: { type: 'bezier' },
			style: { stroke: COLOR_MAPPING, strokeWidth: 2 },
			label: { text: mapping.label ?? `${migrationMappingRowListOf(model, mapping).length} ${labelOf(model, 'columnUnit')}`, position: 0.72 },
			link: `/overview/mapping/${pair}`,
		}));
	}
	for (const mapping of model.mappingChoiceByKey.values()) {
		const source = model.choiceByKey.get(mapping.source);
		const target = model.choiceByKey.get(mapping.target);
		if (!source || !target) continue;
		const nodeSource = nodeById.get(choiceNodeId(idSource, source.logical));
		const nodeTarget = nodeById.get(choiceNodeId(idTarget, target.logical));
		if (!nodeSource || !nodeTarget) continue;
		nodeSource.handles = [...nodeSource.handles, handleOf(`map-${mapping.key}`, 'out', 'right', 'header')];
		nodeTarget.handles = [...nodeTarget.handles, handleOf(`map-${mapping.key}`, 'in', 'left', 'header')];
		const pair = migrationChoicePairGet(model, mapping);
		connections.push(lineOf(`map-choice:${pair}`, [nodeSource.id, `map-${mapping.key}`], [nodeTarget.id, `map-${mapping.key}`], {
			renderer: { type: 'bezier' },
			style: { stroke: COLOR_CHOICE, strokeWidth: 1.5 },
			label: { text: mapping.label ?? labelOf(model, 'choice'), position: 0.5 },
			link: `/overview/choice/${pair}`,
		}));
	}
	return { nodes, connections };
}

const ROW_WIDTH_OPERATOR = { abandon: 96, text: 210, mapping: 240, choice: 240, lookup: 210 };

// two tables, the row mappings between them as lines with a label. a column abandoned
// ends on the abandon card; a target column filled with a default starts from a card
function viewMappingTableBuild(model, pair) {
	const mapping = migrationMappingTableOfPair(model, pair);
	if (!mapping) return null;
	const source = model.tableByKey.get(mapping.source);
	const target = model.tableByKey.get(mapping.target);
	if (!source || !target) return null;
	const xTarget = TABLE_WIDTH + 560;
	const handleSource = [];
	const handleTarget = [];
	const connections = [];
	const nodes = [];
	const heightMax = Math.max(heightOfTable(source), heightOfTable(target));
	const abandonId = 'operator:abandon';
	const rowList = migrationMappingRowListOf(model, mapping);
	const isAbandon = rowList.some((row) => row.target === undefined || row.target === null);
	if (isAbandon) nodes.push({ id: abandonId, renderer: { type: 'operator-abandon' }, position: { x: TABLE_WIDTH + 70, y: heightMax + 70 }, size: { width: ROW_WIDTH_OPERATOR.abandon, height: 'auto' }, data: { name: labelOf(model, 'abandon') }, handles: [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right')] });
	let yDefault = heightMax + 70;
	const labelPositionOf = (index) => 0.34 + ((index % 3) * 0.16);
	rowList.forEach((row, index) => {
		const link = `/overview/mapping/${pair}/${migrationRowSegmentOf(row)}`;
		const style = { stroke: row.source && row.target ? COLOR_MAPPING : '#94a3b8', strokeWidth: 1.25 };
		const label = { text: row.label ?? row.kind ?? '', position: labelPositionOf(index) };
		if (row.source && row.target) {
			handleSource.push(handleOf(`row-${row.source}`, 'out', 'right', `column/${row.source}`));
			handleTarget.push(handleOf(`row-${row.target}`, 'in', 'left', `column/${row.target}`));
			connections.push(lineOf(`row:${row.key}`, [tableNodeId(source.db, source.logical), `row-${row.source}`], [tableNodeId(target.db, target.logical), `row-${row.target}`], { style, label, link }));
		} else if (row.source) {
			handleSource.push(handleOf(`row-${row.source}`, 'out', 'right', `column/${row.source}`));
			connections.push(lineOf(`row:${row.key}`, [tableNodeId(source.db, source.logical), `row-${row.source}`], [abandonId, 'left'], { style: { ...style, strokeDasharray: '4 4' }, label: { ...label, position: 0.55 }, link }));
		} else if (row.target) {
			const id = `operator:default:${row.target}`;
			nodes.push({ id, renderer: { type: 'operator-text' }, position: { x: xTarget - 280, y: yDefault }, size: { width: ROW_WIDTH_OPERATOR.text, height: 'auto' }, data: { name: labelOf(model, 'defaultValue'), description: row.label ?? '' }, handles: [handleOf('right', 'out', 'right')] });
			yDefault += 100;
			handleTarget.push(handleOf(`row-${row.target}`, 'in', 'left', `column/${row.target}`));
			connections.push(lineOf(`row:${row.key}`, [id, 'right'], [tableNodeId(target.db, target.logical), `row-${row.target}`], { style, label: { text: '', position: 0.5 }, link }));
		}
	});
	nodes.unshift(
		tableNodeBuild(source, { x: 0, y: 0, handleList: handleSource }),
		tableNodeBuild(target, { x: xTarget, y: 0, handleList: handleTarget }),
	);
	return { nodes, connections };
}

// the rows kept of a table in the view of one column: that one, its neighbours, and
// an ellipsis where others are left out
function columnListAround(table, columnId) {
	const index = table.columnList.findIndex((column) => column.id === columnId);
	if (index < 0) return table.columnList.slice(0, 4);
	const start = Math.max(0, index - 1);
	const end = Math.min(table.columnList.length, index + 2);
	const list = table.columnList.slice(start, end).map((column) => (column.id === columnId ? { ...column, tone: 'green' } : column));
	if (start > 0) list.unshift({ id: '~before', name: '⋮', isEllipsis: true });
	if (end < table.columnList.length) list.push({ id: '~after', name: '⋮', isEllipsis: true });
	return list;
}

// one column: source -> operator -> ... -> target. each step is a node of its own
function viewMappingRowBuild(model, pair, rowSegment) {
	const mapping = migrationMappingTableOfPair(model, pair);
	if (!mapping) return null;
	const row = migrationMappingRowListOf(model, mapping).find((item) => migrationRowSegmentOf(item) === rowSegment);
	if (!row) return null;
	const source = model.tableByKey.get(mapping.source);
	const target = model.tableByKey.get(mapping.target);
	const operatorList = row.stepList.map((step, index) => ({ step, id: `step:${index}`, width: ROW_WIDTH_OPERATOR[step.op] ?? 210 }));
	const widthSource = TABLE_WIDTH;
	let x = widthSource + 110;
	const yOperator = 60;
	const nodes = [];
	const connections = [];
	const lineStyle = { stroke: COLOR_MAPPING, strokeWidth: 1.5 };
	const handleSource = row.source ? [handleOf('out', 'out', 'right', `column/${row.source}`)] : [];
	const handleTarget = row.target ? [handleOf('in', 'in', 'left', `column/${row.target}`)] : [];
	const nodeList = operatorList.map(({ step, id, width }) => {
		const node = operatorNodeBuild(model, step, { id, x, y: yOperator, width });
		x += width + 90;
		return node;
	});
	if (row.target === undefined || row.target === null) {
		if (!row.stepList.some((step) => step.op === 'abandon')) {
			nodeList.push(operatorNodeBuild(model, { op: 'abandon' }, { id: 'step:abandon', x, y: yOperator, width: ROW_WIDTH_OPERATOR.abandon }));
			x += ROW_WIDTH_OPERATOR.abandon + 90;
		}
	}
	nodes.push(...nodeList);
	for (let index = 0; index < nodeList.length - 1; index += 1) {
		connections.push(lineOf(`step-line:${index}`, [nodeList[index].id, 'right'], [nodeList[index + 1].id, 'left'], { style: lineStyle }));
	}
	if (source && row.source) {
		nodes.push(tableNodeBuild(source, { x: 0, y: 0, width: widthSource, handleList: handleSource, columnList: columnListAround(source, row.source) }));
		if (nodeList[0]) connections.push(lineOf('line:in', [tableNodeId(source.db, source.logical), 'out'], [nodeList[0].id, 'left'], { style: lineStyle }));
	}
	if (target && row.target) {
		nodes.push(tableNodeBuild(target, { x, y: 0, width: widthSource, handleList: handleTarget, columnList: columnListAround(target, row.target) }));
		const last = nodeList[nodeList.length - 1];
		if (last) connections.push(lineOf('line:out', [last.id, 'right'], [tableNodeId(target.db, target.logical), 'in'], { style: lineStyle }));
		else if (source && row.source) connections.push(lineOf('line:direct', [tableNodeId(source.db, source.logical), 'out'], [tableNodeId(target.db, target.logical), 'in'], { style: lineStyle, label: { text: row.label ?? '' } }));
	}
	return { nodes, connections };
}

function operatorNodeBuild(model, step, { id, x, y, width }) {
	const handles = [handleOf('left', 'in', 'left'), handleOf('right', 'out', 'right')];
	if (step.op === 'abandon') return { id, renderer: { type: 'operator-abandon' }, position: { x, y }, size: { width, height: 'auto' }, data: { name: step.name ?? labelOf(model, 'abandon') }, handles: [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right')] };
	if (step.op === 'choice' || step.op === 'mapping') {
		const mapping = step.op === 'choice' ? model.mappingChoiceByKey.get(step.mapping) : null;
		const rows = mapping ? mapping.optionList.map((option, index) => ({ id: `o${index}`, key: String(option.from), value: option.to === null || option.to === undefined ? '—' : String(option.to) })) : (step.rows ?? []).map((row, index) => ({ id: row.id ?? `r${index}`, key: String(row.key), value: String(row.value) }));
		const link = mapping ? `/overview/choice/${migrationChoicePairGet(model, mapping)}` : undefined;
		return { id, renderer: { type: 'operator-mapping' }, position: { x, y }, size: { width, height: 'auto' }, link, data: { name: step.name ?? mapping?.label ?? labelOf(model, 'choice'), rows }, handles };
	}
	return { id, renderer: { type: 'operator-text' }, position: { x, y }, size: { width, height: 'auto' }, data: { name: step.name ?? step.op, description: step.description ?? '' }, handles };
}

// an option set to another: each value a line
function viewMappingChoiceBuild(model, pair) {
	const mapping = [...model.mappingChoiceByKey.values()].find((item) => migrationChoicePairGet(model, item) === pair);
	if (!mapping) return null;
	const source = model.choiceByKey.get(mapping.source);
	const target = model.choiceByKey.get(mapping.target);
	if (!source || !target) return null;
	const fieldList = [{ id: 'value', label: labelOf(model, 'columnValue') }, { id: 'label', label: labelOf(model, 'columnLabel') }];
	const rowOf = (option) => ({ id: `o${option.value}`, value: String(option.value), label: option.label });
	const handleSource = [];
	const handleTarget = [];
	const connections = [];
	mapping.optionList.forEach((option, index) => {
		if (option.to === null || option.to === undefined) return;
		handleSource.push(handleOf(`o${option.from}`, 'out', 'right', `row/o${option.from}`));
		if (!handleTarget.some((handle) => handle.id === `o${option.to}`)) handleTarget.push(handleOf(`o${option.to}`, 'in', 'left', `row/o${option.to}`));
		connections.push(lineOf(`option:${index}`, [`option-source`, `o${option.from}`], [`option-target`, `o${option.to}`], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.5 }, label: { text: option.note ?? '' } }));
	});
	const nodes = [
		genericTableNodeBuild({ id: 'option-source', x: 0, y: 0, width: 300, name: source.name, subtitle: source.logical, tone: 'violet', fieldList, rowList: source.optionList.map(rowOf), handleList: handleSource, columnTemplate: '4.5rem 1fr', isCompact: false }),
		genericTableNodeBuild({ id: 'option-target', x: 480, y: 0, width: 300, name: target.name, subtitle: target.logical, tone: 'violet', fieldList, rowList: target.optionList.map(rowOf), handleList: handleTarget, columnTemplate: '4.5rem 1fr', isCompact: false }),
	];
	return { nodes, connections };
}

function viewChoiceAllBuild(model) {
	const list = [...model.mappingChoiceByKey.values()];
	const nodes = list.map((mapping, index) => {
		const pair = migrationChoicePairGet(model, mapping);
		return embedNodeBuild({ id: `embed:${pair}`, x: (index % 2) * 640, y: Math.floor(index / 2) * 420, width: 600, height: 380, view: `/overview/choice/${pair}`, title: mapping.label ?? pair, icon: 'list-checks', tone: 'violet' });
	});
	return { nodes, connections: [] };
}

// ---------- the reports ----------

const REPORT_WIDTH = 896;
const REPORT_HEIGHT = 620;

// a report: its sections stacked in a scrolling area, each as wide as the area, so none
// has to shrink for the others (card-diagram-flexible-switch.md#a-scrolling-stack)
function reportStackBuild(model, id, itemList) {
	return {
		nodes: [{ id: `report:${id}`, renderer: { type: 'view-stack' }, position: { x: 0, y: 0 }, size: { width: REPORT_WIDTH, height: REPORT_HEIGHT }, data: { focusPath: `/overview/${id}`, isFrameVisibleFocused: true, tone: { plan: 'violet', run: 'amber', verify: 'green' }[id], titleBar: { text: labelOf(model, id), isVisibleEmbedded: true, isVisibleFocused: true }, itemList }, handles: [] }],
		connections: [],
	};
}

function viewPlanBuild(model) {
	const itemList = [];
	for (const mapping of model.mappingTableByKey.values()) {
		const pair = migrationPairGet(model, mapping);
		const nameOf = (key) => model.tableByKey.get(key)?.name ?? key;
		itemList.push({ id: `mapping:${pair}`, view: `/overview/mapping/${pair}`, title: `${nameOf(mapping.source)} → ${nameOf(mapping.target)}`, subtitle: labelOf(model, 'mapping'), icon: 'arrow-right-left', tone: 'teal' });
	}
	for (const mapping of model.mappingChoiceByKey.values()) {
		const pair = migrationChoicePairGet(model, mapping);
		itemList.push({ id: `choice:${pair}`, view: `/overview/choice/${pair}`, title: mapping.label ?? pair, subtitle: labelOf(model, 'choice'), icon: 'list-checks', tone: 'violet' });
	}
	itemList.push({ id: 'order', view: '/overview/plan/order', title: labelOf(model, 'planOrder'), icon: 'layers', tone: 'blue' });
	if (model.plan) itemList.push({ id: 'batch', view: '/overview/plan/batch', title: labelOf(model, 'planBatch'), icon: 'split', tone: 'amber' });
	return reportStackBuild(model, 'plan', itemList);
}

// a list on a canvas wraps: at most this many in a row (a convention of the framework,
// card-diagram.md#drawing-conventions)
const RANK_COLUMN_MAX = 4;
const RANK_LABEL_WIDTH = 190;
const RANK_CELL_WIDTH = 240;
const RANK_CELL_HEIGHT = 96;

// how the order of loading comes about: the tables as labels, one line per pair where one
// looks up the other, in bands by their rank. what the order is is computed from the
// lookups of the target, where the rows are loaded
function viewPlanOrderBuild(model) {
	const dbId = dbIdOfRole(model, 'target');
	const { groupList, lineList } = migrationRankBuild(model, dbId);
	const nodes = [];
	const handleByNode = new Map();
	const nodeIdOf = (key) => `rank-table:${model.tableByKey.get(key).logical}`;
	const handleOfNode = (nodeId, handle) => {
		const list = handleByNode.get(nodeId) ?? [];
		if (!list.some((item) => item.id === handle.id)) list.push(handle);
		handleByNode.set(nodeId, list);
		return handle.id;
	};
	const connections = lineList.map((line, index) => ({
		id: `rank-line:${index}`,
		source: { nodeId: nodeIdOf(line.from), handleId: handleOfNode(nodeIdOf(line.from), handleOf('up', 'out', 'top')) },
		target: { nodeId: nodeIdOf(line.to), handleId: handleOfNode(nodeIdOf(line.to), handleOf('down', 'in', 'bottom')) },
		renderer: { type: 'bezier' },
		style: line.isCycle ? { stroke: '#d97706', strokeWidth: 1.5, strokeDasharray: '5 4' } : { stroke: COLOR_LOOKUP, strokeWidth: 1.5 },
		label: line.isCycle ? { text: labelOf(model, 'cycle') } : { text: '' },
	}));
	let y = 0;
	for (const { rank, tableList } of groupList) {
		nodes.push(noteNodeBuild({ id: `rank:${rank}`, x: 0, y, width: RANK_LABEL_WIDTH, tag: '', title: `${labelOf(model, 'rank')} ${rank}`, text: labelOf(model, rank === 1 ? 'rankRoot' : 'rankNext'), tone: 'blue' }));
		tableList.forEach((table, index) => {
			const id = nodeIdOf(table.key);
			nodes.push({
				id, renderer: { type: 'card-brief' },
				position: { x: RANK_LABEL_WIDTH + 70 + (index % RANK_COLUMN_MAX) * RANK_CELL_WIDTH, y: y + Math.floor(index / RANK_COLUMN_MAX) * RANK_CELL_HEIGHT },
				size: { width: RANK_CELL_WIDTH - 50, height: 'auto' },
				link: `/overview/${dbId}/${table.logical}`,
				data: { title: table.name, icon: 'table', tone: 'blue' },
				handles: handleByNode.get(id) ?? [],
			});
		});
		y += Math.ceil(Math.max(1, tableList.length) / RANK_COLUMN_MAX) * RANK_CELL_HEIGHT + 24;
	}
	const columnUsed = Math.min(RANK_COLUMN_MAX, Math.max(1, ...groupList.map((group) => group.tableList.length)));
	const widthAll = RANK_LABEL_WIDTH + 70 + columnUsed * RANK_CELL_WIDTH - 50;
	nodes.push(noteNodeBuild({ id: 'rank:rule', x: 0, y: y + 10, width: widthAll, title: labelOf(model, 'planOrder'), text: [labelOf(model, 'rankRule'), model.plan?.orderNote].filter(Boolean).join(' '), tone: 'slate' }));
	return { nodes, connections };
}

function viewPlanBatchBuild(model) {
	const batchList = model.plan?.batchList ?? [];
	const tableKeyList = [...new Set(batchList.map((batch) => batch.table))];
	const nodes = [];
	const connections = [];
	tableKeyList.forEach((key, index) => {
		const table = model.tableByKey.get(key);
		const y = index * 220;
		const id = `batch-table:${key}`;
		const list = batchList.filter((batch) => batch.table === key);
		nodes.push(noteNodeBuild({ id, x: 0, y: y + 30, width: 220, title: table?.name ?? key, text: table?.logical, tone: 'blue', metaList: [{ value: list.reduce((sum, batch) => sum + (batch.rowCount ?? 0), 0), label: labelOf(model, 'columnRows') }], handleList: [handleOf('out', 'out', 'right')] }));
		nodes.push(genericTableNodeBuild({
			id: `batch:${key}`, x: 320, y, width: 520, name: labelOf(model, 'planBatch'), tone: 'amber',
			fieldList: [{ id: 'file', label: labelOf(model, 'columnFile') }, { id: 'range', label: labelOf(model, 'columnRange') }, { id: 'rowCount', label: labelOf(model, 'columnRows') }],
			rowList: list.map((batch, position) => ({ id: `b${position}`, file: batch.file, range: batch.range, rowCount: String(batch.rowCount ?? '') })),
			columnTemplate: '1fr 8rem 4rem',
			handleList: [handleOf('in', 'in', 'left')],
		}));
		connections.push(lineOf(`batch:${key}`, [id, 'out'], [`batch:${key}`, 'in'], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.5 } }));
	});
	return { nodes, connections };
}

// a short card of figures that opens the table behind them: a table is a detail, one
// click away (card-diagram.md#drawing-conventions)
function reportSummaryItemBuild(model, { id, title, text, tone, link, metaList }) {
	return { id, link, node: { renderer: { type: 'card-note' }, size: { width: 'auto', height: 'auto' }, data: { title, text: text ? `${text} — ${labelOf(model, 'detailHint')}` : labelOf(model, 'detailHint'), tone, metaList } } };
}

const metaOf = (model, stat, itemList) => itemList.map(([key, label]) => ({ value: stat[key] ?? '—', label: labelOf(model, label) }));

function viewRunBuild(model) {
	const stat = model.reportRun?.stat ?? {};
	const dlqCount = model.reportRun?.dlqList?.length ?? 0;
	return reportStackBuild(model, 'run', [
		{ id: 'flow', view: '/overview/run/flow', title: labelOf(model, 'runFlow'), icon: 'send', tone: 'amber' },
		reportSummaryItemBuild(model, { id: 'result', title: labelOf(model, 'runResult'), text: `${model.reportRun?.batchList?.length ?? 0} ${labelOf(model, 'batchUnit')}`, tone: 'green', link: '/overview/run/batch', metaList: metaOf(model, stat, [['total', 'statTotal'], ['success', 'statSuccess'], ['dlq', 'statDlq']]) }),
		reportSummaryItemBuild(model, { id: 'dlq', title: labelOf(model, 'runDlq'), text: model.reportRun?.dlqList?.[0]?.reason, tone: dlqCount > 0 ? 'red' : 'slate', link: '/overview/run/dlq', metaList: [{ value: dlqCount, label: labelOf(model, 'statDlq') }] }),
	]);
}

const FLOW_TABLE_TONE_LIST = ['blue', 'teal', 'violet', 'amber'];
const FLOW_LINE = { stroke: '#94a3b8', strokeWidth: 1.25 };
const FLOW_ROW_HEIGHT = 58;

// the batches of the plan by table: a card per table with its rows taken together by
// brackets, a card per batch, one line per bracket. the rows are the plan's figures, in order
function batchTableListBuild(model) {
	const batchList = model.plan?.batchList ?? [];
	return [...new Set(batchList.map((batch) => batch.table))].map((key) => ({ key, table: model.tableByKey.get(key), batchList: batchList.filter((batch) => batch.table === key) }));
}

function batchFlowBuild(model, { xBatch, widthBatch, resultOf, link }) {
	const nodes = [];
	const connections = [];
	const batchIdList = [];
	const wordRow = labelOf(model, 'row');
	let y = 0;
	for (const [tableIndex, { key, table, batchList }] of batchTableListBuild(model).entries()) {
		// Color identifies the table: its header, row brackets and every batch share a tone, even with DLQ rows.
		const tone = FLOW_TABLE_TONE_LIST[tableIndex % FLOW_TABLE_TONE_LIST.length];
		const rows = [];
		const rowGroupList = [];
		const handles = [];
		let start = 1;
		batchList.forEach((batch, index) => {
			const end = start + Math.max(1, batch.rowCount ?? 1) - 1;
			const groupId = `g${index}`;
			rows.push({ id: `${groupId}-from`, name: `${wordRow} ${start}` }, { id: `${groupId}-gap`, isEllipsis: true }, { id: `${groupId}-to`, name: `${wordRow} ${end}` });
			rowGroupList.push({ id: groupId, rowFrom: `${groupId}-from`, rowTo: `${groupId}-to`, tone });
			handles.push(handleOf(groupId, 'out', 'right', `group/${groupId}`));
			start = end + 1;
		});
		const tableId = `flow-table:${key}`;
		nodes.push({ id: tableId, renderer: { type: 'table' }, position: { x: 0, y }, size: { width: 170, height: 'auto' }, data: { name: table?.name ?? key, nameLogical: labelOf(model, 'rowOrder'), isCompact: true, isFieldHeaderHidden: true, tone, fields: [{ id: 'name', label: '' }], rows, rowGroupList }, handles });
		batchList.forEach((batch, index) => {
			const id = `flow-batch:${batch.file}`;
			const result = resultOf?.(batch);
			nodes.push({
				id, renderer: { type: 'card-brief' }, position: { x: xBatch, y: y + index * FLOW_ROW_HEIGHT }, size: { width: widthBatch, height: 'auto' }, link,
				data: { title: batch.file, icon: 'file-spreadsheet', tone, statList: [`${batch.rowCount ?? ''} ${wordRow}`, result?.text ?? batch.range].filter(Boolean) },
				handles: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')],
			});
			connections.push(lineOf(`flow-split:${batch.file}`, [tableId, `g${index}`], [id, 'in'], { style: FLOW_LINE }));
			batchIdList.push(id);
		});
		y += Math.max(batchList.length * FLOW_ROW_HEIGHT, 44 + rows.length * 19) + 26;
	}
	return { nodes, connections, batchIdList, height: y };
}

const textOf = (group, key, fallback) => group?.[key] ?? fallback;

function flowBlocksBuild(model, { xTarget, top, bottom, split }) {
	const blockOf = (id, x, y, width, height, tone, itemList) => ({ id: `flow-area:${id}`, renderer: { type: 'color-block' }, position: { x, y }, size: { width, height }, data: { tone, itemList }, handles: [] });
	return [
		blockOf('source', -20, top, 210, bottom - top, 'blue', [{ id: 'source', icon: 'database', text: `${labelOf(model, 'sourceDatabase')} (${model.system.source.name})` }]),
		blockOf('server', 205, top, xTarget - 245, bottom - top, 'amber', [{ id: 'server', icon: 'server', text: labelOf(model, 'migrationServer') }]),
		blockOf('target', xTarget - 20, top, 210, split - top - 12, 'teal', [{ id: 'target', icon: 'database', text: `${labelOf(model, 'targetDatabase')} (${model.system.target.name})` }]),
		blockOf('artifacts', xTarget - 20, split, 210, bottom - split, 'green', [{ id: 'artifacts', icon: 'file', text: labelOf(model, 'artifacts') }]),
	];
}

// how a run goes, from the plan and the report: rows taken together into batches, batches
// sent, what fails retried, what keeps failing set aside, all of it recorded
function viewRunFlowBuild(model) {
	const flow = model.reportRun?.flow ?? {};
	const resultByFile = new Map((model.reportRun?.batchList ?? []).map((batch) => [batch.file, batch]));
	const wordSuccess = labelOf(model, 'statSuccess');
	const wordDlq = labelOf(model, 'statDlq');
	const { nodes, connections, batchIdList, height } = batchFlowBuild(model, {
		xBatch: 225,
		widthBatch: 170,
		link: '/overview/run/batch',
		resultOf: (batch) => {
			const result = resultByFile.get(batch.file);
			if (!result) return null;
			return { text: result.dlq ? `${result.success} ${wordSuccess} / ${result.dlq} ${wordDlq}` : `${result.success} ${wordSuccess}` };
		},
	});
	const yMiddle = Math.max(0, height / 2 - 60);
	const { target } = model.system;
	const stat = model.reportRun?.stat ?? {};
	nodes.push(
		noteNodeBuild({ id: 'flow-send', x: 460, y: yMiddle, width: 160, title: textOf(flow.send, 'title', 'Send'), tag: textOf(flow.send, 'tag', ''), text: textOf(flow.send, 'text', 'Batch by batch, what is looked up first'), tone: 'amber', handleList: [handleOf('in', 'in', 'left'), handleOf('ok', 'out', 'right'), { id: 'retry-out', direction: 'out', anchor: { side: 'bottom', offset: 0.3 } }, { id: 'retry-in', direction: 'in', anchor: { side: 'bottom', offset: 0.7 } }] }),
		{ id: 'flow-target', renderer: { type: 'card-brief' }, position: { x: 960, y: yMiddle + 6 }, size: { width: 170, height: 'auto' }, data: { title: target.name, icon: 'database', tone: 'green', statList: target.description ? [target.description] : [] }, handles: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'bottom')] },
		noteNodeBuild({ id: 'flow-retry', x: 460, y: yMiddle + 120, width: 160, title: textOf(flow.retry, 'title', 'Retry'), tag: textOf(flow.retry, 'tag', ''), text: textOf(flow.retry, 'text', 'Waits, then tries again, up to a limit'), tone: 'slate', handleList: [{ id: 'in', direction: 'in', anchor: { side: 'top', offset: 0.3 } }, { id: 'back', direction: 'out', anchor: { side: 'top', offset: 0.7 } }, handleOf('over', 'out', 'right')] }),
		noteNodeBuild({ id: 'flow-dlq', x: 680, y: yMiddle + 120, width: 170, title: textOf(flow.dlq, 'title', wordDlq), tag: textOf(flow.dlq, 'tag', ''), text: textOf(flow.dlq, 'text', 'Rows over the limit are kept apart'), tone: 'red', link: '/overview/run/dlq', handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')] }),
		noteNodeBuild({ id: 'flow-report', x: 960, y: yMiddle + 140, width: 130, title: labelOf(model, 'run'), tone: 'green', link: '/overview/run/batch', metaList: metaOf(model, stat, [['success', 'statSuccess'], ['dlq', 'statDlq']]), handleList: [handleOf('in', 'in', 'left'), handleOf('top', 'in', 'top')] }),
		...flowBlocksBuild(model, { xTarget: 960, top: -40, bottom: Math.max(height, yMiddle + 260) + 60, split: yMiddle + 110 }),
	);
	for (const id of batchIdList) connections.push(lineOf(`flow-send:${id}`, [id, 'out'], ['flow-send', 'in'], { style: FLOW_LINE }));
	connections.push(
		lineOf('flow-ok', ['flow-send', 'ok'], ['flow-target', 'in'], { style: FLOW_LINE }),
		lineOf('flow-fail', ['flow-send', 'retry-out'], ['flow-retry', 'in'], { style: { stroke: '#d97706', strokeWidth: 1.25 } }),
		lineOf('flow-back', ['flow-retry', 'back'], ['flow-send', 'retry-in'], { style: { stroke: '#64748b', strokeWidth: 1.25, strokeDasharray: '4 3' } }),
		lineOf('flow-over', ['flow-retry', 'over'], ['flow-dlq', 'in'], { style: { stroke: '#dc2626', strokeWidth: 1.25 } }),
		lineOf('flow-report-ok', ['flow-target', 'out'], ['flow-report', 'top'], { style: FLOW_LINE }),
		lineOf('flow-report-dlq', ['flow-dlq', 'out'], ['flow-report', 'in'], { style: FLOW_LINE }),
	);
	return { nodes, connections };
}

function viewRunBatchBuild(model) {
	const list = model.reportRun?.batchList ?? [];
	return {
		nodes: [genericTableNodeBuild({
			id: 'run-batch', x: 0, y: 0, width: 620, name: labelOf(model, 'runBatch'), tone: 'amber',
			fieldList: [{ id: 'file', label: labelOf(model, 'columnFile') }, { id: 'rowCount', label: labelOf(model, 'columnRows') }, { id: 'success', label: labelOf(model, 'statSuccess') }, { id: 'dlq', label: labelOf(model, 'statDlq') }],
			rowList: list.map((batch, index) => ({ id: `b${index}`, file: batch.file, rowCount: String(batch.rowCount ?? ''), success: String(batch.success ?? ''), dlq: String(batch.dlq ?? ''), tone: batch.dlq ? 'red' : undefined })),
			columnTemplate: '1fr 4rem 4rem 4rem',
		})],
		connections: [],
	};
}

function viewRunDlqBuild(model) {
	const list = model.reportRun?.dlqList ?? [];
	return {
		nodes: [genericTableNodeBuild({
			id: 'run-dlq', x: 0, y: 0, width: 620, name: labelOf(model, 'runDlq'), tone: 'red',
			fieldList: [{ id: 'key', label: labelOf(model, 'columnKey') }, { id: 'tryCount', label: labelOf(model, 'columnTry') }, { id: 'reason', label: labelOf(model, 'columnReason') }, { id: 'file', label: labelOf(model, 'columnFile') }],
			rowList: list.map((item, index) => ({ id: `d${index}`, key: item.key, tryCount: String(item.tryCount ?? ''), reason: item.reason, file: item.file })),
			columnTemplate: '6rem 3rem 1fr 8rem',
		})],
		connections: [],
	};
}

function viewVerifyBuild(model) {
	const stat = model.reportVerify?.stat ?? {};
	const exceptionCount = model.reportVerify?.exceptionList?.length ?? 0;
	return reportStackBuild(model, 'verify', [
		{ id: 'flow', view: '/overview/verify/flow', title: labelOf(model, 'verifyFlow'), icon: 'file-check', tone: 'green' },
		...(model.reportVerify?.sample ? [{ id: 'sample', view: '/overview/verify/sample', title: labelOf(model, 'verifySample'), subtitle: model.reportVerify.sample.key, icon: 'search', tone: 'blue' }] : []),
		reportSummaryItemBuild(model, { id: 'result', title: labelOf(model, 'verifyResult'), text: `${model.reportVerify?.checkList?.length ?? 0} ${labelOf(model, 'columnCheck')}`, tone: 'green', link: '/overview/verify/check', metaList: metaOf(model, stat, [['total', 'statTotal'], ['matched', 'statMatched'], ['exception', 'statException']]) }),
		reportSummaryItemBuild(model, { id: 'exception', title: labelOf(model, 'verifyException'), text: model.reportVerify?.exceptionList?.[0]?.status, tone: exceptionCount > 0 ? 'red' : 'slate', link: '/overview/verify/exception', metaList: [{ value: exceptionCount, label: labelOf(model, 'statException') }] }),
	]);
}

const VERIFY_CHECK_HEIGHT = 74;

// how a verification goes: the batches the run used are the reference; the set of their rows
// is compared first, then each row's expected values with what is read back from the target
function viewVerifyFlowBuild(model) {
	const flow = model.reportVerify?.flow ?? {};
	const stat = model.reportVerify?.stat ?? {};
	const { nodes, connections, batchIdList, height } = batchFlowBuild(model, { xBatch: 225, widthBatch: 170 });
	const checkList = model.reportVerify?.checkList ?? [];
	const heightChecks = Math.max(1, checkList.length) * VERIFY_CHECK_HEIGHT;
	const heightAll = Math.max(height, heightChecks);
	const yMiddle = Math.max(0, heightAll / 2 - 50);
	const { target } = model.system;
	nodes.push(
		noteNodeBuild({ id: 'verify-set', x: 450, y: yMiddle, width: 150, title: textOf(flow.set, 'title', 'Compare the set'), text: textOf(flow.set, 'text', 'The rows of the batches against the outcome of the run'), tone: 'blue', metaList: metaOf(model, stat, [['total', 'statTotal'], ['matched', 'statMatched'], ['exception', 'statException']]), handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right'), handleOf('down', 'out', 'bottom')] }),
		noteNodeBuild({ id: 'verify-compare', x: 650, y: yMiddle, width: 150, title: textOf(flow.compare, 'title', 'Compare the values'), text: textOf(flow.compare, 'text', 'The CSV through the mappings, against the target'), tone: 'teal', handleList: [handleOf('in', 'in', 'left'), handleOf('read', 'in', 'top'), handleOf('out', 'out', 'right')] }),
		{ id: 'verify-target', renderer: { type: 'card-brief' }, position: { x: 1110, y: -70 }, size: { width: 170, height: 'auto' }, data: { title: target.name, icon: 'database', tone: 'green', statList: target.description ? [target.description] : [] }, handles: [handleOf('out', 'out', 'left')] },
		noteNodeBuild({ id: 'verify-exception', x: 450, y: heightAll + 30, width: 350, title: textOf(flow.exception, 'title', labelOf(model, 'verifyException')), text: model.reportVerify?.exceptionList?.map((item) => `${item.key}: ${item.reason} / ${item.status}`).join('\n') || '—', tone: 'red', link: '/overview/verify/exception', handleList: [handleOf('in', 'in', 'top'), handleOf('out', 'out', 'right')] }),
		noteNodeBuild({ id: 'verify-report', x: 1110, y: Math.max(150, yMiddle) + 30, width: 130, title: labelOf(model, 'verify'), tone: 'green', link: '/overview/verify/check', metaList: metaOf(model, stat, [['matched', 'statMatched'], ['exception', 'statException']]), handleList: [handleOf('in', 'in', 'left'), handleOf('bottom', 'in', 'bottom')] }),
		...flowBlocksBuild(model, { xTarget: 1110, top: -100, bottom: heightAll + 200, split: 150 }),
	);
	for (const id of batchIdList) connections.push(lineOf(`verify-set:${id}`, [id, 'out'], ['verify-set', 'in'], { style: FLOW_LINE }));
	connections.push(
		lineOf('verify-go', ['verify-set', 'out'], ['verify-compare', 'in'], { style: { stroke: '#16a34a', strokeWidth: 1.25 }, label: { text: String(stat.matched ?? '') } }),
		lineOf('verify-read', ['verify-target', 'out'], ['verify-compare', 'read'], { style: FLOW_LINE, label: { text: textOf(flow.compare, 'readLabel', '') } }),
		lineOf('verify-out', ['verify-set', 'down'], ['verify-exception', 'in'], { style: { stroke: '#dc2626', strokeWidth: 1.25 }, label: { text: String(stat.exception ?? '') } }),
		lineOf('verify-report-exception', ['verify-exception', 'out'], ['verify-report', 'bottom'], { style: FLOW_LINE }),
	);
	const yStart = yMiddle + 40 - heightChecks / 2;
	checkList.forEach((check, index) => {
		const id = `verify-check:${index}`;
		nodes.push(noteNodeBuild({ id, x: 850, y: yStart + index * VERIFY_CHECK_HEIGHT, width: 190, title: check.check, tag: check.result, text: check.target, tone: check.isException ? 'amber' : 'green', link: '/overview/verify/check', handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')] }));
		connections.push(lineOf(`verify-to:${index}`, ['verify-compare', 'out'], [id, 'in'], { style: FLOW_LINE }), lineOf(`verify-from:${index}`, [id, 'out'], ['verify-report', 'in'], { style: FLOW_LINE }));
	});
	return { nodes, connections };
}

// one row, column by column: what the CSV holds, what the mappings make of it, what the target has
function viewVerifySampleBuild(model) {
	const sample = model.reportVerify?.sample;
	if (!sample) return null;
	return {
		nodes: [genericTableNodeBuild({
			id: 'verify-sample', x: 0, y: 0, width: 800, name: sample.key ?? '', subtitle: sample.note, tone: 'blue', isCompact: false,
			fieldList: [{ id: 'column', label: labelOf(model, 'columnColumn') }, { id: 'source', label: labelOf(model, 'columnSource') }, { id: 'expected', label: labelOf(model, 'columnExpected') }, { id: 'actual', label: labelOf(model, 'columnActual') }, { id: 'result', label: labelOf(model, 'columnResult') }],
			rowList: (sample.rowList ?? []).map((row, index) => ({ id: `s${index}`, column: row.column, source: String(row.source ?? ''), expected: String(row.expected ?? ''), actual: String(row.actual ?? ''), result: row.result ?? '', tone: row.isProblem ? 'red' : undefined })),
			columnTemplate: '1fr 1.2fr 1.2fr 1.2fr 5rem',
		})],
		connections: [],
	};
}

function viewVerifyCheckBuild(model) {
	const list = model.reportVerify?.checkList ?? [];
	return {
		nodes: [genericTableNodeBuild({
			id: 'verify-check', x: 0, y: 0, width: 620, name: labelOf(model, 'verifySet'), tone: 'green',
			fieldList: [{ id: 'check', label: labelOf(model, 'columnCheck') }, { id: 'target', label: labelOf(model, 'target') }, { id: 'result', label: labelOf(model, 'columnResult') }],
			rowList: list.map((item, index) => ({ id: `c${index}`, check: item.check, target: item.target, result: item.result, tone: item.isException ? 'amber' : undefined })),
			columnTemplate: '1fr 1fr 7rem',
		})],
		connections: [],
	};
}

function viewVerifyExceptionBuild(model) {
	const list = model.reportVerify?.exceptionList ?? [];
	return {
		nodes: [genericTableNodeBuild({
			id: 'verify-exception', x: 0, y: 0, width: 620, name: labelOf(model, 'verifyException'), tone: 'red',
			fieldList: [{ id: 'key', label: labelOf(model, 'columnKey') }, { id: 'reason', label: labelOf(model, 'columnReason') }, { id: 'status', label: labelOf(model, 'columnStatus') }],
			rowList: list.map((item, index) => ({ id: `e${index}`, key: item.key, reason: item.reason, status: item.status })),
			columnTemplate: '6rem 1fr 7rem',
		})],
		connections: [],
	};
}

// ---------- the overview ----------

const OVERVIEW_DB_WIDTH = 640;
const OVERVIEW_DB_HEIGHT = 440;
const OVERVIEW_TOOL_WIDTH = 340;
const OVERVIEW_TOOL_X = OVERVIEW_DB_WIDTH + 210;
const OVERVIEW_TARGET_X = OVERVIEW_TOOL_X + OVERVIEW_TOOL_WIDTH + 210;
const OVERVIEW_REPORT_Y = OVERVIEW_DB_HEIGHT + 200;
const OVERVIEW_REPORT_WIDTH = 560;
const OVERVIEW_REPORT_HEIGHT = 420;

function viewOverviewBuild(model) {
	const { source, target, tool } = model.system;
	const statOf = (dbId) => [`${migrationTableListOf(model, dbId).length} ${labelOf(model, 'tableUnit')}`, `${migrationChoiceListOf(model, dbId).length} ${labelOf(model, 'choiceUnit')}`];
	const reportX = (index) => index * (OVERVIEW_REPORT_WIDTH + (OVERVIEW_TARGET_X + OVERVIEW_DB_WIDTH - 3 * OVERVIEW_REPORT_WIDTH) / 2);
	const reportNodeOf = (id, index, handles) => ({ ...viewBuild(model, `/overview/${id}`).nodes[0], position: { x: reportX(index), y: OVERVIEW_REPORT_Y }, size: { width: OVERVIEW_REPORT_WIDTH, height: OVERVIEW_REPORT_HEIGHT }, link: `/overview/${id}`, handles });
	const stepList = tool.stepList?.length ? tool.stepList : [{ id: 'plan', name: labelOf(model, 'plan') }, { id: 'run', name: labelOf(model, 'run') }, { id: 'verify', name: labelOf(model, 'verify') }];
	const toolHandles = [handleOf('source', 'out', 'left'), handleOf('target', 'out', 'right'), ...stepList.map((step, index) => ({ id: `step-${step.id}`, direction: 'out', anchor: { target: 'body', side: 'bottom', offset: (index + 1) / (stepList.length + 1) } }))];
	const nodes = [
		embedNodeBuild({ id: 'db:source', x: 0, y: 0, width: OVERVIEW_DB_WIDTH, height: OVERVIEW_DB_HEIGHT, view: `/overview/${source.id}`, title: source.name, subtitle: source.description, icon: 'database', tone: 'blue', statList: statOf(source.id), handleList: [handleOf('in', 'in', 'right')] }),
		embedNodeBuild({ id: 'db:target', x: OVERVIEW_TARGET_X, y: 0, width: OVERVIEW_DB_WIDTH, height: OVERVIEW_DB_HEIGHT, view: `/overview/${target.id}`, title: target.name, subtitle: target.description, icon: 'cloud', tone: 'green', statList: statOf(target.id), handleList: [handleOf('in', 'in', 'left')] }),
		{
			id: 'tool', renderer: { type: 'table' }, position: { x: OVERVIEW_TOOL_X, y: 150 }, size: { width: OVERVIEW_TOOL_WIDTH, height: 'auto' },
			data: { name: tool.name, nameLogical: tool.description ?? '', tone: 'violet', isFieldHeaderHidden: true, fields: [{ id: 'tag', label: '' }, { id: 'name', label: '' }], columnTemplate: '2.6rem 1fr', rows: stepList.map((step, index) => ({ id: step.id, tag: String(index + 1).padStart(2, '0'), name: step.name })) },
			handles: toolHandles,
		},
		{ id: 'link:mapping', renderer: { type: 'card-brief' }, position: { x: OVERVIEW_TOOL_X + 20, y: 40 }, size: { width: OVERVIEW_TOOL_WIDTH - 40, height: 'auto' }, link: '/overview/mapping', data: { title: labelOf(model, 'mapping'), icon: 'arrow-right-left', tone: 'teal', statList: [`${model.mappingTableByKey.size} ${labelOf(model, 'tableUnit')}`] }, handles: [] },
		reportNodeOf('plan', 0, [handleOf('top', 'in', 'top'), handleOf('out', 'out', 'right')]),
		reportNodeOf('run', 1, [handleOf('top', 'in', 'top'), handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')]),
		reportNodeOf('verify', 2, [handleOf('top', 'in', 'top'), handleOf('in', 'in', 'left')]),
	];
	const reportIdOf = (step, index) => `report:${step.report ?? ['plan', 'run', 'verify'][index]}`;
	const labelStep = ['planMake', 'runMake', 'verifyMake'];
	const connections = [
		lineOf('read-source', ['tool', 'source'], ['db:source', 'in'], { style: { stroke: '#2563eb', strokeWidth: 1.5 }, label: { text: labelOf(model, 'readSource') } }),
		lineOf('write-target', ['tool', 'target'], ['db:target', 'in'], { style: { stroke: '#16a34a', strokeWidth: 1.5 }, label: { text: labelOf(model, 'write') } }),
		...stepList.map((step, index) => lineOf(`make:${step.id}`, ['tool', `step-${step.id}`], [reportIdOf(step, index), 'top'], { style: { stroke: '#7c3aed', strokeWidth: 1.5 }, label: { text: labelOf(model, labelStep[index]), position: 0.62 } })),
		lineOf('plan-run', ['report:plan', 'out'], ['report:run', 'in'], { style: { stroke: '#64748b', strokeWidth: 1.5 }, label: { text: labelOf(model, 'planToRun') } }),
		lineOf('run-verify', ['report:run', 'out'], ['report:verify', 'in'], { style: { stroke: '#64748b', strokeWidth: 1.5 }, label: { text: labelOf(model, 'runToVerify') } }),
	];
	return { nodes, connections };
}

const TAB_MEMBER_LIST = ['plan', 'run', 'verify'];
const TAB_WIDTH = 1120;
const TAB_HEIGHT = 810;

function viewOverviewTabsBuild(model, focus) {
	const diagram = viewOverviewBuild(model);
	const toneOf = { plan: 'violet', run: 'amber', verify: 'green' };
	const widthAll = OVERVIEW_TARGET_X + OVERVIEW_DB_WIDTH;
	return switchTabsApply(diagram, {
		id: 'tabs',
		memberList: TAB_MEMBER_LIST.map((id) => ({ id: `report:${id}`, label: labelOf(model, id), tone: toneOf[id], link: `/overview/tabs/${id}` })),
		position: { x: (widthAll - TAB_WIDTH) / 2, y: OVERVIEW_REPORT_Y },
		size: { width: TAB_WIDTH, height: TAB_HEIGHT },
	}, `report:${focus}`);
}

// ---------- the provider ----------

// what a path shows: a pure function of the model. null for a path that names nothing
function viewBuild(model, path) {
	const segmentList = path.split('/').filter(Boolean);
	if (segmentList[0] !== 'overview') return null;
	const [, first, second, third] = segmentList;
	const { source, target } = model.system;
	if (!first) return viewOverviewBuild(model);
	if (first === 'tabs') return viewOverviewTabsBuild(model, TAB_MEMBER_LIST.includes(second) ? second : 'plan');
	if (first === source.id || first === target.id) return second ? viewTableBuild(model, first, second) : viewErBuild(model, first);
	if (first === 'mapping') {
		if (third) return viewMappingRowBuild(model, second, third);
		return second ? viewMappingTableBuild(model, second) : viewMappingAllBuild(model);
	}
	if (first === 'choice') return second ? viewMappingChoiceBuild(model, second) : viewChoiceAllBuild(model);
	if (first === 'plan') return second === 'order' ? viewPlanOrderBuild(model) : second === 'batch' ? viewPlanBatchBuild(model) : second ? null : viewPlanBuild(model);
	if (first === 'run') return second === 'flow' ? viewRunFlowBuild(model) : second === 'batch' ? viewRunBatchBuild(model) : second === 'dlq' ? viewRunDlqBuild(model) : second ? null : viewRunBuild(model);
	if (first === 'verify') return second === 'flow' ? viewVerifyFlowBuild(model) : second === 'sample' ? viewVerifySampleBuild(model) : second === 'check' ? viewVerifyCheckBuild(model) : second === 'exception' ? viewVerifyExceptionBuild(model) : second ? null : viewVerifyBuild(model);
	return null;
}

function pathLabelGet(model, path) {
	const segmentList = path.split('/').filter(Boolean);
	const last = segmentList[segmentList.length - 1];
	const [, first, second, third] = segmentList;
	const { source, target } = model.system;
	if (!first) return labelOf(model, 'overview');
	if (first === 'tabs') return second ? labelOf(model, second) : labelOf(model, 'tabs');
	if (first === source.id) return second ? migrationTableListOf(model, first).find((table) => table.logical === second)?.name ?? second : source.name;
	if (first === target.id) return second ? migrationTableListOf(model, first).find((table) => table.logical === second)?.name ?? second : target.name;
	if (first === 'mapping') {
		if (third) {
			const mapping = migrationMappingTableOfPair(model, second);
			const row = mapping && migrationMappingRowListOf(model, mapping).find((item) => migrationRowSegmentOf(item) === third);
			return row?.name ?? third;
		}
		if (second) {
			const mapping = migrationMappingTableOfPair(model, second);
			const nameOf = (key) => model.tableByKey.get(key)?.name ?? key;
			return mapping ? `${nameOf(mapping.source)} → ${nameOf(mapping.target)}` : second;
		}
		return labelOf(model, 'mapping');
	}
	if (first === 'choice') {
		if (second) {
			const mapping = [...model.mappingChoiceByKey.values()].find((item) => migrationChoicePairGet(model, item) === second);
			return mapping?.label ?? second;
		}
		return labelOf(model, 'choice');
	}
	if (first === 'plan') return second === 'order' ? labelOf(model, 'planOrder') : second === 'batch' ? labelOf(model, 'planBatch') : labelOf(model, 'plan');
	if (first === 'run') return second === 'flow' ? labelOf(model, 'runFlow') : second === 'batch' ? labelOf(model, 'runBatch') : second === 'dlq' ? labelOf(model, 'runDlq') : labelOf(model, 'run');
	if (first === 'verify') return second === 'flow' ? labelOf(model, 'verifyFlow') : second === 'sample' ? labelOf(model, 'verifySample') : second === 'check' ? labelOf(model, 'verifySet') : second === 'exception' ? labelOf(model, 'verifyException') : labelOf(model, 'verify');
	return last;
}

function childPathListGet(model, path) {
	const { source, target } = model.system;
	if (path === '/overview') return [`/overview/tabs`, `/overview/${source.id}`, `/overview/${target.id}`, '/overview/mapping', '/overview/choice', '/overview/plan', '/overview/run', '/overview/verify'];
	if (path === '/overview/tabs') return TAB_MEMBER_LIST.map((id) => `/overview/tabs/${id}`);
	if (path === `/overview/${source.id}`) return migrationTableListOf(model, source.id).map((table) => `${path}/${table.logical}`);
	if (path === `/overview/${target.id}`) return migrationTableListOf(model, target.id).map((table) => `${path}/${table.logical}`);
	if (path === '/overview/mapping') return [...model.mappingTableByKey.values()].map((mapping) => `${path}/${migrationPairGet(model, mapping)}`);
	if (path.startsWith('/overview/mapping/') && switchPathParent(path) === '/overview/mapping') {
		const mapping = migrationMappingTableOfPair(model, switchPathLast(path));
		return mapping ? migrationMappingRowListOf(model, mapping).map((row) => `${path}/${migrationRowSegmentOf(row)}`) : [];
	}
	if (path === '/overview/choice') return [...model.mappingChoiceByKey.values()].map((mapping) => `${path}/${migrationChoicePairGet(model, mapping)}`);
	if (path === '/overview/plan') return ['/overview/plan/order', '/overview/plan/batch'];
	if (path === '/overview/run') return ['/overview/run/flow', '/overview/run/batch', '/overview/run/dlq'];
	if (path === '/overview/verify') return ['/overview/verify/flow', ...(model.reportVerify?.sample ? ['/overview/verify/sample'] : []), '/overview/verify/check', '/overview/verify/exception'];
	return [];
}

// the box a reader adjusted, kept in the layout item
function boxOf(model, path) {
	const box = model.layout.viewByPath?.[path]?.box;
	if (!box) return undefined;
	try {
		return switchRectRead(box, path);
	} catch {
		return undefined;
	}
}

export function migrationProviderBuild(model, { onBoxSave } = {}) {
	const provider = {
		root: '/overview',
		title: model.system.title ?? '',
		labelGet: (path) => pathLabelGet(model, path),
		childListGet: (path) => childPathListGet(model, path).map((child) => ({ path: child, label: pathLabelGet(model, child) })),
		viewGet: (path) => {
			const diagram = viewBuild(model, path);
			if (!diagram) return null;
			return {
				path,
				label: pathLabelGet(model, path),
				box: boxOf(model, path),
				diagram: {
					defaults: { connection: { renderer: { type: 'smoothstep' }, markerEnd: 'arrowClosed' } },
					...diagram,
				},
			};
		},
		boxSave: onBoxSave,
	};
	return provider;
}

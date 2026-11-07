import {
	migrationChoiceIsGlobal, migrationChoiceListOf, migrationChoicePairGet, migrationMappingColumnListOf, migrationMappingTableOfPair, migrationPairGet, migrationRankBuild, migrationColumnSegmentOf, migrationTableListOf, migrationBatchCountOf, migrationMasterReferListOf } from './MigrationData.js';
import { switchPathLast, switchPathParent, switchRectRead, switchTabsApply } from '../../card-diagram-switch/SwitchData.js';
import { diagramArrangeApply } from '../../card-diagram/DiagramArrange.js';
import { cardRowDisplayKeepBuild } from '../../card-diagram/TableCardData.js';
import { cardMatrixWidthGet } from '../../card-diagram/CardMatrixData.js';
import { erGeometryEstimateBuild } from '../er-arrange/ErGeometry.js';
import { erArrangerColumns, erArrangerLanes } from '../er-arrange/er-arranger-list.js';

// The scenes of a migration, generated from its data items (power-platform-migration.md):
// a provider of the switching layer. Every scene is a diagram of the card diagram format,
// a function of the model and nothing else; the same table keeps its node id in every
// scene drawing it, which is what lets a switch move it instead of replacing it.
//
//   /overview                         the databases, the tool, the three reports
//   /overview/tabs/{report}           the same, the reports in tabs
//   /overview/{db}                    a database, in three views: a cylinder on its card, its ER
//                                     diagram while a pointer rests there and focused, its lookup matrix
//   /overview/{db}/{table}            one table and what it refers to
//   /overview/{db}/{choice}           one option set and the columns using it
//   /overview/mapping                 both ER diagrams, the mappings of tables as lines
//   /overview/mapping/{pair}          two tables, the mappings of their columns as lines
//   /overview/mapping/{pair}/{column} one column through its operators
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
	runFlow: 'How the rows were sent', runResult: 'Result of each batch', post: 'After the migration', postMake: 'Fix references and system columns', verifyToPost: 'After verifying', postServer: 'Post-processing server', postTarget: 'Columns to update', labelJustLoaded: 'Just loaded', verifyFlow: 'How the result was checked', verifyMatch: 'Finding the row in the target', matchUnit: 'patterns', matchName: 'Pattern', matchTable: 'Tables', verifySample: 'One row compared', verifyResult: 'Result of the checks', detailHint: 'Click for the details',
	row: 'row', rowOrder: 'the rows in GUID order', batchUnit: 'batches', exceptionUnit: 'exceptions', columnColumn: 'Column', columnSource: 'In the CSV', columnExpected: 'Expected', columnActual: 'In the target',
	planOrder: 'Order of loading', rank: 'Rank', rankRoot: 'looks up nothing', rankNext: 'after what it looks up', rankRule: 'The rank of a table is one past the highest rank it looks up; a table looking up nothing has rank 1. Tables of one rank may load side by side.', cycle: 'a cycle: filled in by a later pass', planBatch: 'Batches', runBatch: 'Batches run', runDlq: 'Dead letters',
	verifySet: 'Sets compared', verifyValue: 'Values compared', verifyException: 'Open exceptions',
	readSource: 'read the structure and the data', readTarget: 'read the structure and the result', write: 'create and update',
	planMake: 'collect, design: save the plan', runMake: 'run, retry: save the result', verifyMake: 'read back, compare: save the verdict',
	planToRun: 'batches', runToVerify: 'success, dead letters', planToVerify: 'keys and expected values',
	abandon: 'Abandon', defaultValue: 'Default value', columnOrder: 'Order', columnTable: 'Table', columnFile: 'File', columnRange: 'Range', columnRows: 'Rows',
	columnStatus: 'Status', columnTry: 'Tries', columnReason: 'Reason', columnKey: 'Key', columnCheck: 'Check', columnResult: 'Result', columnNote: 'Note',
	viewDiagram: 'ER diagram', viewLookupMatrix: 'Lookup matrix', lookupFrom: 'Looks up', lookupTo: 'Is looked up',
	columnValue: 'Value', columnLabel: 'Label', columnUnit: 'columns', tableUnit: 'tables', choiceUnit: 'option sets', source: 'source', target: 'target', statSuccess: 'success', statDlq: 'dead letters', statTotal: 'total', statMatched: 'matched', statException: 'exceptions',
};

function labelOf(model, id) {
	return model.system.labels?.[id] ?? LABEL_DEFAULT[id] ?? id;
}

// a master table is told apart wherever it is drawn: a tone, and a badge, as a global choice has
const MASTER_TONE = 'amber';
const MASTER_BADGE = 'Master';
const numberText = (value) => (typeof value === 'number' ? value.toLocaleString('en-US') : value);

const tableNodeId = (dbId, logical) => `table:${dbId}:${logical}`;
const choiceNodeId = (dbId, logical) => `choice:${dbId}:${logical}`;
const dbIdOfRole = (model, role) => (role === 'source' ? model.system.source.id : model.system.target.id);

// ---------- nodes ----------

function tableNodeBuild(table, { x, y, handleList = [], link, width = TABLE_WIDTH, columnList, rowDisplay, idNode }) {
	return {
		id: idNode ?? tableNodeId(table.db, table.logical),
		renderer: { type: 'dataverse-table' },
		position: { x, y },
		size: { width, height: 'auto' },
		link,
		data: {
			name: table.name,
			nameLogical: table.logical,
			...(table.isMaster ? { tone: MASTER_TONE, badge: MASTER_BADGE, isMaster: true } : {}),
			columns: (columnList ?? table.columnList).map((column) => ({
				id: column.id, name: column.name, nameLogical: column.logical ?? column.id, type: column.type, key: column.key, isRequired: column.isRequired, description: column.description, tone: column.tone,
			})),
			...(rowDisplay ? { rowDisplay } : {}),
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
			...(choice.isGlobal === false ? { isGlobal: false } : {}),
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

function embedNodeBuild({ id, x, y, width, height, scene, title, subtitle, icon, tone, statList, handleList = [] }) {
	return { id, renderer: { type: 'scene-embed' }, position: { x, y }, size: { width, height }, data: { scene, title, subtitle, icon, tone, statList }, handles: handleList };
}

const handleOf = (id, direction, side, target = 'body') => ({ id, direction, anchor: { target, side } });
const lineOf = (id, source, target, extra = {}) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] }, ...extra });

const heightOfTable = (table) => TABLE_HEIGHT_HEAD + table.columnList.length * TABLE_HEIGHT_ROW;
const heightOfChoice = (choice) => TABLE_HEIGHT_HEAD + choice.optionList.length * TABLE_HEIGHT_ROW;

// ---------- an ER diagram ----------

// the tables and option sets of a database and the lines between them, arranged by the rule
// set of ER diagrams (card-diagram-arrange.md). returns nodes and lines, placed from a point
function erBuild(model, dbId, { x = 0, y = 0, linkOf } = {}) {
	const tableList = migrationTableListOf(model, dbId);
	// an option set of one column (isGlobal: false) belongs to its table, and is drawn with it
	const choiceList = migrationChoiceListOf(model, dbId).filter(migrationChoiceIsGlobal);
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
				const out = handleAdd(nodeId, handleOf(`lookup-${column.id}`, 'out', 'right', `column/${column.id}`));
				const into = handleAdd(referId, handleOf('pk', 'in', 'left', `column/${pk.id}`));
				connections.push(lineOf(`lookup:${dbId}:${table.logical}:${column.id}`, [nodeId, out], [referId, into], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.25 } }));
			}
			if (column.choice && choiceList.some((choice) => choice.key === column.choice)) {
				const choice = model.choiceByKey.get(column.choice);
				const choiceId = choiceNodeId(dbId, choice.logical);
				const out = handleAdd(nodeId, handleOf(`choice-${column.id}`, 'out', 'right', `column/${column.id}`));
				const into = handleAdd(choiceId, handleOf('in', 'in', 'top'));
				connections.push(lineOf(`choice:${dbId}:${table.logical}:${column.id}`, [nodeId, out], [choiceId, into], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
			}
		}
	}
	const nodes = [
		...tableList.map((table) => tableNodeBuild(table, { x, y, link: linkOf?.table(table), handleList: handleByNode.get(tableNodeId(dbId, table.logical)) ?? [] })),
		...choiceList.map((choice) => choiceNodeBuild(choice, { x, y, link: linkOf?.choice?.(choice), handleList: handleByNode.get(choiceNodeId(dbId, choice.logical)) ?? [] })),
	];
	const { diagram } = diagramArrangeApply({ nodes, connections }, erArrangerColumns, { origin: { x, y } });
	return { nodes: diagram.nodes, connections: diagram.connections, width: Math.max(0, ...diagram.nodes.map((node) => node.position.x + node.size.width)) - x };
}

const linkOfDb = (dbId) => ({ table: (table) => `/overview/${dbId}/${table.logical}`, choice: (choice) => `/overview/${dbId}/${choice.logical}` });

function sceneErBuild(model, dbId) {
	const er = erBuild(model, dbId, { linkOf: linkOfDb(dbId) });
	return { nodes: er.nodes, connections: er.connections };
}

// the lookups of a database as a matrix: a mark where the table of a row looks up the table
// of a column, with how many of its columns do when more than one
function sceneLookupMatrixBuild(model, dbId) {
	const { source, target } = model.system;
	const tableList = migrationTableListOf(model, dbId);
	const keySet = new Set(tableList.map((table) => table.key));
	const linkOf = linkOfDb(dbId).table;
	const axisOf = (table) => ({ id: table.logical, label: table.name, link: linkOf(table), ...(table.isMaster ? { tone: MASTER_TONE } : {}) });
	const cellList = tableList.flatMap((table) => {
		const nameListByKey = new Map();
		for (const column of table.columnList) {
			if (keySet.has(column.lookup)) nameListByKey.set(column.lookup, [...(nameListByKey.get(column.lookup) ?? []), column.name]);
		}
		return [...nameListByKey].map(([key, nameList]) => {
			const refer = model.tableByKey.get(key);
			return { row: table.logical, column: refer.logical, title: `${table.name} → ${refer.name}: ${nameList.join(', ')}`, ...(nameList.length > 1 ? { mark: `● ${nameList.length}` } : {}) };
		});
	});
	const data = {
		title: `${dbId === source.id ? source.name : target.name}: ${labelOf(model, 'viewLookupMatrix')}`,
		rowAxisLabel: labelOf(model, 'lookupFrom'),
		columnAxisLabel: labelOf(model, 'lookupTo'),
		rowList: tableList.map(axisOf),
		columnList: tableList.map(axisOf),
		cellList,
		isDiagonalMarked: true,
	};
	return { nodes: [{ id: `matrix:${dbId}`, renderer: { type: 'card-matrix' }, position: { x: 0, y: 0 }, size: { width: cardMatrixWidthGet(data), height: 'auto' }, data }], connections: [] };
}

const TABLE_LANE_MIN = 16;

// one table in the middle: what refers to it on the left, what it refers to on the right
function sceneTableBuild(model, dbId, logical) {
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
				nodes.push(choiceNodeBuild(choice, { x: xRight, y: yRight, link: `/overview/${dbId}/${choice.logical}`, handleList: [handleOf('in-side', 'in', 'left', 'header')] }));
				// a long name wraps, so leave room for its second line
				yRight += heightOfChoice(choice) + 70;
			}
			connections.push(lineOf(`choice:${dbId}:${logical}:${column.id}`, [nodeId, `choice-${column.id}`], [id, 'in-side'], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
		}
	}
	let yLeft = 0;
	const referList = migrationTableListOf(model, dbId).flatMap((item) => item.columnList.filter((column) => column.lookup === table.key).map((column) => ({ table: item, column })));
	const pk = table.columnList.find((column) => column.key === 'PK') ?? table.columnList[0];
	if (referList.length > 0) handleList.push(handleOf('pk-left', 'in', 'left', `column/${pk.id}`));
	const gapLeft = Math.max(80, TABLE_LANE_MIN * (referList.length + 1));
	for (const { table: from, column } of referList) {
		const id = `from:${from.logical}:${column.id}`;
		nodes.push(noteNodeBuild({ id, x: -240 - gapLeft, y: yLeft, width: 240, title: from.name, text: `${from.logical}.${column.logical ?? column.id}`, tone: 'slate', link: `/overview/${dbId}/${from.logical}`, handleList: [handleOf('out', 'out', 'right')] }));
		connections.push(lineOf(`from:${from.logical}:${column.id}`, [id, 'out'], [nodeId, 'pk-left'], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.25 } }));
		yLeft += 80;
	}
	nodes.push(tableNodeBuild(table, { x: 0, y: 0, handleList }));
	return diagramArrangeApply({ nodes, connections }, erArrangerLanes).diagram;
}

// one option set at the right; at the left each table using it, its rows cut down to its
// key and the columns using the option set, which point to it
function sceneChoiceBuild(model, dbId, logical) {
	const choice = migrationChoiceListOf(model, dbId).find((item) => item.logical === logical);
	if (!choice) return null;
	const choiceId = choiceNodeId(dbId, logical);
	const nodes = [];
	const connections = [];
	let y = 0;
	for (const table of migrationTableListOf(model, dbId)) {
		const columnList = table.columnList.filter((column) => column.choice === choice.key);
		if (columnList.length === 0) continue;
		const pk = table.columnList.find((column) => column.key === 'PK');
		const handleList = columnList.map((column) => handleOf(`choice-${column.id}`, 'out', 'right', `column/${column.id}`));
		const node = tableNodeBuild(table, {
			x: 0, y, link: `/overview/${dbId}/${table.logical}`, handleList,
			columnList: table.columnList.map((column) => (column.choice === choice.key ? { ...column, tone: 'violet' } : column)),
			rowDisplay: rowDisplayKeepOf(model, table, [pk?.id, ...columnList.map((column) => column.id)]),
		});
		nodes.push(node);
		for (const column of columnList) connections.push(lineOf(`choice:${dbId}:${table.logical}:${column.id}`, [node.id, `choice-${column.id}`], [choiceId, 'in-side'], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
		y += erGeometryEstimateBuild({ nodes: [node] }).rectOf(node.id).height + GAP_ROW;
	}
	nodes.push(choiceNodeBuild(choice, { x: nodes.length ? TABLE_WIDTH + GAP_COLUMN : 0, y: 0, handleList: nodes.length ? [handleOf('in-side', 'in', 'left', 'header')] : [] }));
	return diagramArrangeApply({ nodes, connections }, erArrangerLanes).diagram;
}

// what a break says for columns left out of a table: how many
const rowDisplayKeepOf = (model, table, idList) => cardRowDisplayKeepBuild(table.columnList.map((column) => column.id), idList, { textOf: (count) => `${count} ${labelOf(model, 'columnUnit')}` });

// the option sets of one column (isGlobal: false) a table's column mappings go through: a card
// under each table, a line from the column at the outer side of the table, and, when isPair,
// a line between the two cards that opens the mapping of their values
function localChoiceBuild(model, { columnMappingList, source, target, xTarget, y, isPair }) {
	const nodes = [];
	const connections = [];
	const handleBySide = { source: [], target: [] };
	const idList = [];
	const yBySide = { source: y, target: y };
	const cardAdd = (table, columnId, role) => {
		const column = table?.columnList.find((item) => item.id === columnId);
		const choice = model.choiceByKey.get(column?.choice);
		if (!choice || migrationChoiceIsGlobal(choice)) return null;
		const side = role === 'source' ? 'left' : 'right';
		const handleId = `choice-${column.id}`;
		const choiceId = choiceNodeId(choice.db, choice.logical);
		handleBySide[role].push(handleOf(handleId, 'out', side, `column/${column.id}`));
		nodes.push(choiceNodeBuild(choice, { x: role === 'source' ? 0 : xTarget, y: yBySide[role], link: `/overview/${choice.db}/${choice.logical}`, handleList: [handleOf('in-side', 'in', side, 'header'), ...(isPair ? [handleOf('pair', role === 'source' ? 'out' : 'in', role === 'source' ? 'right' : 'left', 'header')] : [])] }));
		yBySide[role] += heightOfChoice(choice) + 70;
		const lineId = `choice:${choice.db}:${table.logical}:${column.id}`;
		idList.push(lineId);
		connections.push(lineOf(lineId, [tableNodeId(table.db, table.logical), handleId], [choiceId, 'in-side'], { style: { stroke: COLOR_CHOICE, strokeWidth: 1.25, strokeDasharray: '5 4' } }));
		return choice;
	};
	for (const columnMapping of columnMappingList) {
		const from = columnMapping.source ? cardAdd(source, columnMapping.source, 'source') : null;
		const to = columnMapping.target ? cardAdd(target, columnMapping.target, 'target') : null;
		if (!isPair || !from || !to) continue;
		const mapping = [...model.mappingChoiceByKey.values()].find((item) => item.source === from.key && item.target === to.key);
		if (mapping) connections.push(lineOf(`map-choice:${mapping.key}`, [choiceNodeId(from.db, from.logical), 'pair'], [choiceNodeId(to.db, to.logical), 'pair'], { renderer: { type: 'bezier' }, style: { stroke: COLOR_CHOICE, strokeWidth: 1.5 }, label: { text: mapping.label ?? labelOf(model, 'choice'), position: 0.5 }, link: `/overview/choice/${migrationChoicePairGet(model, mapping)}` }));
	}
	return { nodes, connections, handleBySide, idList };
}

// ---------- mappings ----------

// both ER diagrams; a mapping of tables is a line between them, whose label opens it
function sceneMappingAllBuild(model) {
	const idSource = dbIdOfRole(model, 'source');
	const idTarget = dbIdOfRole(model, 'target');
	const erSource = erBuild(model, idSource, { linkOf: linkOfDb(idSource) });
	const offset = erSource.width + 420;
	const erTarget = erBuild(model, idTarget, { x: offset, linkOf: linkOfDb(idTarget) });
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
			label: { text: mapping.label ?? `${migrationMappingColumnListOf(model, mapping).length} ${labelOf(model, 'columnUnit')}`, position: 0.72 },
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

const OPERATOR_WIDTH = { abandon: 96, text: 210, mapping: 240, choice: 240, lookup: 210 };

// two tables, the column mappings between them as lines with a label. a column abandoned
// ends on the abandon card; a target column filled with a default starts from a card
function sceneMappingTableBuild(model, pair) {
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
	const columnMappingList = migrationMappingColumnListOf(model, mapping);
	const isAbandon = columnMappingList.some((columnMapping) => columnMapping.target === undefined || columnMapping.target === null);
	if (isAbandon) nodes.push({ id: abandonId, renderer: { type: 'operator-abandon' }, position: { x: TABLE_WIDTH + 70, y: heightMax + 70 }, size: { width: OPERATOR_WIDTH.abandon, height: 'auto' }, data: { name: labelOf(model, 'abandon') }, handles: [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right')] });
	let yDefault = heightMax + 70;
	const labelPositionOf = (index) => 0.34 + ((index % 3) * 0.16);
	columnMappingList.forEach((columnMapping, index) => {
		const link = `/overview/mapping/${pair}/${migrationColumnSegmentOf(columnMapping)}`;
		const style = { stroke: columnMapping.source && columnMapping.target ? COLOR_MAPPING : '#94a3b8', strokeWidth: 1.25 };
		const label = { text: columnMapping.label ?? columnMapping.kind ?? '', position: labelPositionOf(index) };
		if (columnMapping.source && columnMapping.target) {
			handleSource.push(handleOf(`column-${columnMapping.source}`, 'out', 'right', `column/${columnMapping.source}`));
			handleTarget.push(handleOf(`column-${columnMapping.target}`, 'in', 'left', `column/${columnMapping.target}`));
			connections.push(lineOf(`column:${columnMapping.key}`, [tableNodeId(source.db, source.logical), `column-${columnMapping.source}`], [tableNodeId(target.db, target.logical), `column-${columnMapping.target}`], { style, label, link }));
		} else if (columnMapping.source) {
			handleSource.push(handleOf(`column-${columnMapping.source}`, 'out', 'right', `column/${columnMapping.source}`));
			connections.push(lineOf(`column:${columnMapping.key}`, [tableNodeId(source.db, source.logical), `column-${columnMapping.source}`], [abandonId, 'left'], { style: { ...style, strokeDasharray: '4 4' }, label: { ...label, position: 0.55 }, link }));
		} else if (columnMapping.target) {
			const id = `operator:default:${columnMapping.target}`;
			nodes.push({ id, renderer: { type: 'operator-text' }, position: { x: xTarget - 280, y: yDefault }, size: { width: OPERATOR_WIDTH.text, height: 'auto' }, data: { name: labelOf(model, 'defaultValue'), description: columnMapping.label ?? '' }, handles: [handleOf('right', 'out', 'right')] });
			yDefault += 100;
			handleTarget.push(handleOf(`column-${columnMapping.target}`, 'in', 'left', `column/${columnMapping.target}`));
			connections.push(lineOf(`column:${columnMapping.key}`, [id, 'right'], [tableNodeId(target.db, target.logical), `column-${columnMapping.target}`], { style, label: { text: '', position: 0.5 }, link }));
		}
	});
	// a mapping of the table as a whole, with no mapping of its columns: one line between the tables
	if (columnMappingList.length === 0 && mapping.isTableLevel) {
		handleSource.push(handleOf('table', 'out', 'right'));
		handleTarget.push(handleOf('table', 'in', 'left'));
		connections.push(lineOf(`table:${mapping.key}`, [tableNodeId(source.db, source.logical), 'table'], [tableNodeId(target.db, target.logical), 'table'], { style: { stroke: COLOR_MAPPING, strokeWidth: 2 }, label: { text: mapping.label ?? '', position: 0.5 } }));
	}
	const local = localChoiceBuild(model, { columnMappingList, source, target, xTarget, y: Math.max(yDefault, heightMax + 70 + (isAbandon ? 90 : 0)), isPair: true });
	nodes.unshift(
		tableNodeBuild(source, { x: 0, y: 0, handleList: [...handleSource, ...local.handleBySide.source] }),
		tableNodeBuild(target, { x: xTarget, y: 0, handleList: [...handleTarget, ...local.handleBySide.target] }),
	);
	nodes.push(...local.nodes);
	connections.push(...local.connections);
	if (local.idList.length === 0) return { nodes, connections };
	return diagramArrangeApply({ nodes, connections }, erArrangerLanes, { connectionIdList: local.idList }).diagram;
}

// a table in the scene of one column: that column and its neighbours, a break for the others
function tableAroundOf(model, table, columnId) {
	const index = table.columnList.findIndex((column) => column.id === columnId);
	const keepList = index < 0 ? table.columnList.slice(0, 4) : table.columnList.slice(Math.max(0, index - 1), index + 2);
	return {
		columnList: table.columnList.map((column) => (column.id === columnId ? { ...column, tone: 'green' } : column)),
		rowDisplay: rowDisplayKeepOf(model, table, keepList.map((column) => column.id)),
	};
}

// one column: source -> operator -> ... -> target. each step is a node of its own
function sceneMappingColumnBuild(model, pair, columnSegment) {
	const mapping = migrationMappingTableOfPair(model, pair);
	if (!mapping) return null;
	const columnMapping = migrationMappingColumnListOf(model, mapping).find((item) => migrationColumnSegmentOf(item) === columnSegment);
	if (!columnMapping) return null;
	const source = model.tableByKey.get(mapping.source);
	const target = model.tableByKey.get(mapping.target);
	const operatorList = columnMapping.stepList.map((step, index) => ({ step, id: `step:${index}`, width: OPERATOR_WIDTH[step.op] ?? 210 }));
	const widthSource = TABLE_WIDTH;
	let x = widthSource + 110;
	const yOperator = 60;
	const nodes = [];
	const connections = [];
	const lineStyle = { stroke: COLOR_MAPPING, strokeWidth: 1.5 };
	const handleSource = columnMapping.source ? [handleOf('out', 'out', 'right', `column/${columnMapping.source}`)] : [];
	const handleTarget = columnMapping.target ? [handleOf('in', 'in', 'left', `column/${columnMapping.target}`)] : [];
	const nodeList = operatorList.map(({ step, id, width }) => {
		const node = operatorNodeBuild(model, step, { id, x, y: yOperator, width });
		x += width + 90;
		return node;
	});
	if (columnMapping.target === undefined || columnMapping.target === null) {
		if (!columnMapping.stepList.some((step) => step.op === 'abandon')) {
			nodeList.push(operatorNodeBuild(model, { op: 'abandon' }, { id: 'step:abandon', x, y: yOperator, width: OPERATOR_WIDTH.abandon }));
			x += OPERATOR_WIDTH.abandon + 90;
		}
	}
	nodes.push(...nodeList);
	const xTarget = x;
	const yBelow = Math.max(...[source, target].filter(Boolean).map((table) => {
		const around = tableAroundOf(model, table, table === source ? columnMapping.source : columnMapping.target);
		return erGeometryEstimateBuild({ nodes: [tableNodeBuild(table, { x: 0, y: 0, ...around })] }).rectOf(tableNodeId(table.db, table.logical)).height;
	})) + 80;
	const local = localChoiceBuild(model, { columnMappingList: [columnMapping], source, target, xTarget, y: yBelow, isPair: false });
	for (let index = 0; index < nodeList.length - 1; index += 1) {
		connections.push(lineOf(`step-line:${index}`, [nodeList[index].id, 'right'], [nodeList[index + 1].id, 'left'], { style: lineStyle }));
	}
	if (source && columnMapping.source) {
		nodes.push(tableNodeBuild(source, { x: 0, y: 0, width: widthSource, handleList: [...handleSource, ...local.handleBySide.source], ...tableAroundOf(model, source, columnMapping.source) }));
		if (nodeList[0]) connections.push(lineOf('line:in', [tableNodeId(source.db, source.logical), 'out'], [nodeList[0].id, 'left'], { style: lineStyle }));
	}
	if (target && columnMapping.target) {
		nodes.push(tableNodeBuild(target, { x, y: 0, width: widthSource, handleList: [...handleTarget, ...local.handleBySide.target], ...tableAroundOf(model, target, columnMapping.target) }));
		const last = nodeList[nodeList.length - 1];
		if (last) connections.push(lineOf('line:out', [last.id, 'right'], [tableNodeId(target.db, target.logical), 'in'], { style: lineStyle }));
		else if (source && columnMapping.source) connections.push(lineOf('line:direct', [tableNodeId(source.db, source.logical), 'out'], [tableNodeId(target.db, target.logical), 'in'], { style: lineStyle, label: { text: columnMapping.label ?? '' } }));
	}
	nodes.push(...local.nodes);
	connections.push(...local.connections);
	if (local.idList.length === 0) return { nodes, connections };
	return diagramArrangeApply({ nodes, connections }, erArrangerLanes, { connectionIdList: local.idList }).diagram;
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
function sceneMappingChoiceBuild(model, pair) {
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

function sceneChoiceAllBuild(model) {
	const list = [...model.mappingChoiceByKey.values()];
	const nodes = list.map((mapping, index) => {
		const pair = migrationChoicePairGet(model, mapping);
		return embedNodeBuild({ id: `embed:${pair}`, x: (index % 2) * 640, y: Math.floor(index / 2) * 420, width: 600, height: 380, scene: `/overview/choice/${pair}`, title: mapping.label ?? pair, icon: 'list-checks', tone: 'violet' });
	});
	return { nodes, connections: [] };
}

// ---------- the reports ----------

const REPORT_TONE_BY_ID = { plan: 'violet', run: 'amber', verify: 'green', post: 'teal' };
const REPORT_WIDTH = 896;
const REPORT_HEIGHT = 620;

// a report: its sections stacked in a scrolling area, each as wide as the area, so none
// has to shrink for the others (card-diagram-flexible-switch.md#a-scrolling-stack)
function reportStackBuild(model, id, itemList) {
	return {
		nodes: [{ id: `report:${id}`, renderer: { type: 'scene-stack' }, position: { x: 0, y: 0 }, size: { width: REPORT_WIDTH, height: REPORT_HEIGHT }, data: { focusPath: `/overview/${id}`, isFrameVisibleFocused: true, isHeightFullEmbedded: true, isHeightFullFocused: true, tone: REPORT_TONE_BY_ID[id], titleBar: { text: labelOf(model, id), isVisibleEmbedded: true, isVisibleFocused: true }, itemList }, handles: [] }],
		connections: [],
	};
}

function scenePlanBuild(model) {
	const itemList = [];
	for (const mapping of model.mappingTableByKey.values()) {
		const pair = migrationPairGet(model, mapping);
		const nameOf = (key) => model.tableByKey.get(key)?.name ?? key;
		itemList.push({ id: `mapping:${pair}`, scene: `/overview/mapping/${pair}`, title: `${nameOf(mapping.source)} → ${nameOf(mapping.target)}`, subtitle: labelOf(model, 'mapping'), icon: 'arrow-right-left', tone: 'teal' });
	}
	for (const mapping of model.mappingChoiceByKey.values()) {
		const pair = migrationChoicePairGet(model, mapping);
		itemList.push({ id: `choice:${pair}`, scene: `/overview/choice/${pair}`, title: mapping.label ?? pair, subtitle: labelOf(model, 'choice'), icon: 'list-checks', tone: 'violet' });
	}
	itemList.push({ id: 'order', scene: '/overview/plan/order', title: labelOf(model, 'planOrder'), icon: 'layers', tone: 'blue' });
	if (model.plan) itemList.push({ id: 'batch', scene: '/overview/plan/batch', title: labelOf(model, 'planBatch'), icon: 'split', tone: 'amber' });
	return reportStackBuild(model, 'plan', itemList);
}

// a list on a canvas wraps: at most this many in a row (a convention of the framework,
// card-diagram-usage.md#drawing-conventions)
const RANK_COLUMN_MAX = 4;
const RANK_LABEL_WIDTH = 190;
const RANK_CELL_WIDTH = 240;
const RANK_CELL_HEIGHT = 96;

// how the order of loading comes about: the tables as labels, one line per pair where one
// looks up the other, in bands by their rank. what the order is is computed from the
// lookups of the target, where the rows are loaded
function scenePlanOrderBuild(model) {
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
				data: { title: table.name, icon: 'table', tone: table.isMaster ? MASTER_TONE : 'blue' },
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

function scenePlanBatchBuild(model) {
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
			rowList: list.map((batch, position) => ({ id: `b${position}`, file: batch.isOmitted ? `⋮ ${numberText(batch.count)} ${labelOf(model, 'batchUnit')}` : batch.file, range: batch.range ?? '', rowCount: String(numberText(batch.rowCount) ?? '') })),
			columnTemplate: '1fr 8rem 4rem',
			handleList: [handleOf('in', 'in', 'left')],
		}));
		connections.push(lineOf(`batch:${key}`, [id, 'out'], [`batch:${key}`, 'in'], { style: { stroke: COLOR_LOOKUP, strokeWidth: 1.5 } }));
	});
	return { nodes, connections };
}

// a short card of figures that opens the table behind them: a table is a detail, one
// click away (card-diagram-usage.md#drawing-conventions)
function reportSummaryItemBuild(model, { id, title, text, tone, link, metaList }) {
	return { id, link, node: { renderer: { type: 'card-note' }, size: { width: 'auto', height: 'auto' }, data: { title, text: text ? `${text} — ${labelOf(model, 'detailHint')}` : labelOf(model, 'detailHint'), tone, metaList } } };
}

const metaOf = (model, stat, itemList) => itemList.map(([key, label]) => ({ value: numberText(stat[key]) ?? '—', label: labelOf(model, label) }));

function sceneRunBuild(model) {
	const stat = model.reportRun?.stat ?? {};
	const dlqCount = model.reportRun?.dlqList?.length ?? 0;
	return reportStackBuild(model, 'run', [
		{ id: 'flow', scene: '/overview/run/flow', title: labelOf(model, 'runFlow'), icon: 'send', tone: 'amber' },
		reportSummaryItemBuild(model, { id: 'result', title: labelOf(model, 'runResult'), text: `${numberText(migrationBatchCountOf(model.reportRun?.batchList))} ${labelOf(model, 'batchUnit')}`, tone: 'green', link: '/overview/run/batch', metaList: metaOf(model, stat, [['total', 'statTotal'], ['success', 'statSuccess'], ['dlq', 'statDlq']]) }),
		reportSummaryItemBuild(model, { id: 'dlq', title: labelOf(model, 'runDlq'), text: model.reportRun?.dlqList?.[0]?.reason, tone: dlqCount > 0 ? 'red' : 'slate', link: '/overview/run/dlq', metaList: [{ value: dlqCount, label: labelOf(model, 'statDlq') }] }),
	]);
}

const FLOW_X_TARGET = 960;
const VERIFY_X_TARGET = 1110;
const FLOW_TABLE_TONE_LIST = ['blue', 'teal', 'violet', 'amber'];
const FLOW_LINE = { stroke: '#94a3b8', strokeWidth: 1.25 };
const FLOW_ROW_HEIGHT = 58;
const FLOW_OMIT_HEIGHT = 44;
const FLOW_LINE_OMIT = { stroke: '#94a3b8', strokeWidth: 1.25, strokeDasharray: '3 3' };
const flowLineOf = (id) => (id.startsWith('flow-omit:') ? FLOW_LINE_OMIT : FLOW_LINE);

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
			// the batches left out: more dots in the rows, joined to the dots between the cards
			if (batch.isOmitted) {
				rows.push({ id: `omit${index}-a`, isEllipsis: true }, { id: `omit${index}-b`, isEllipsis: true }, { id: `omit${index}-c`, isEllipsis: true });
				handles.push(handleOf(`omit${index}`, 'out', 'right', `row/omit${index}-b`));
				start += Math.max(0, batch.rowCount ?? 0);
				return;
			}
			const end = start + Math.max(1, batch.rowCount ?? 1) - 1;
			const groupId = `g${index}`;
			rows.push({ id: `${groupId}-from`, name: `${wordRow} ${numberText(start)}` }, { id: `${groupId}-gap`, isEllipsis: true }, { id: `${groupId}-to`, name: `${wordRow} ${numberText(end)}` });
			rowGroupList.push({ id: groupId, rowFrom: `${groupId}-from`, rowTo: `${groupId}-to`, tone });
			handles.push(handleOf(groupId, 'out', 'right', `group/${groupId}`));
			start = end + 1;
		});
		const tableId = `flow-table:${key}`;
		nodes.push({ id: tableId, renderer: { type: 'table' }, position: { x: 0, y }, size: { width: 170, height: 'auto' }, data: { name: table?.name ?? key, nameLogical: labelOf(model, 'rowOrder'), isCompact: true, isFieldHeaderHidden: true, tone, fields: [{ id: 'name', label: '' }], rows, rowGroupList }, handles });
		batchList.forEach((batch, index) => {
			if (batch.isOmitted) {
				const id = `flow-omit:${key}:${index}`;
				nodes.push({ id, renderer: { type: 'card-three-dots' }, position: { x: xBatch, y: y + index * FLOW_ROW_HEIGHT }, size: { width: widthBatch, height: FLOW_OMIT_HEIGHT }, data: { text: `${numberText(batch.count)} ${labelOf(model, 'batchUnit')}`, tone }, handles: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')] });
				connections.push(lineOf(`flow-split:${id}`, [tableId, `omit${index}`], [id, 'in'], { style: FLOW_LINE_OMIT }));
				batchIdList.push(id);
				return;
			}
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

const FLOW_TARGET_WIDTH = 190;
const FLOW_TARGET_ROW_HEIGHT = 72;
const FLOW_BLOCK_TARGET_WIDTH = 240;
// the outputs block: as tall as the report in it and its label
const FLOW_BLOCK_ARTIFACTS_HEIGHT = 140;

function flowBlocksBuild(model, { xTarget, top, bottom }) {
	const split = bottom - FLOW_BLOCK_ARTIFACTS_HEIGHT;
	const blockOf = (id, x, y, width, height, tone, itemList) => ({ id: `flow-area:${id}`, renderer: { type: 'color-block' }, position: { x, y }, size: { width, height }, data: { tone, itemList }, handles: [] });
	return [
		blockOf('source', -20, top, 210, bottom - top, 'blue', [{ id: 'source', icon: 'database', text: `${labelOf(model, 'sourceDatabase')} (${model.system.source.name})` }]),
		blockOf('server', 205, top, xTarget - 245, bottom - top, 'amber', [{ id: 'server', icon: 'server', text: labelOf(model, 'migrationServer') }]),
		blockOf('target', xTarget - 20, top, FLOW_BLOCK_TARGET_WIDTH, split - top - 12, 'teal', [{ id: 'target', icon: 'database', text: `${labelOf(model, 'targetDatabase')} (${model.system.target.name})` }]),
		blockOf('artifacts', xTarget - 20, split, FLOW_BLOCK_TARGET_WIDTH, FLOW_BLOCK_ARTIFACTS_HEIGHT, 'green', [{ id: 'artifacts', icon: 'file', text: labelOf(model, 'artifacts') }]),
	];
}

// the tables of the target the batches end up in, each in the tone of the table it comes from,
// with the rows that reached it. a plan whose tables have no mapping yet shows the database itself
function flowTargetNodesBuild(model, { prefix, x, y, handles }) {
	const mappingList = [...model.mappingTableByKey.values()];
	const countByFile = new Map((model.reportRun?.batchList ?? []).map((batch) => [batch.file, batch.success]));
	const wordRow = labelOf(model, 'row');
	const targetByKey = new Map();
	batchTableListBuild(model).forEach(({ key, batchList }, tableIndex) => {
		const target = model.tableByKey.get(mappingList.find((mapping) => mapping.source === key)?.target);
		if (!target) return;
		const item = targetByKey.get(target.key) ?? { target, tone: FLOW_TABLE_TONE_LIST[tableIndex % FLOW_TABLE_TONE_LIST.length], count: 0 };
		for (const batch of batchList) item.count += countByFile.get(batch.file) ?? batch.rowCount ?? 0;
		targetByKey.set(target.key, item);
	});
	if (targetByKey.size === 0) {
		const { target } = model.system;
		return [{ id: prefix, renderer: { type: 'card-brief' }, position: { x, y }, size: { width: FLOW_TARGET_WIDTH, height: 'auto' }, data: { title: target.name, icon: 'database', tone: 'green', statList: target.description ? [target.description] : [] }, handles }];
	}
	return [...targetByKey.values()].map(({ target, tone, count }, index) => ({
		id: `${prefix}:${target.key}`,
		renderer: { type: 'table' },
		position: { x, y: y + index * FLOW_TARGET_ROW_HEIGHT },
		size: { width: FLOW_TARGET_WIDTH, height: 'auto' },
		data: { name: target.name ?? target.logical, nameLogical: target.logical, isCompact: true, isFieldHeaderHidden: true, tone, fields: [{ id: 'name', label: '' }], rows: [{ id: 'count', name: `${numberText(count)} ${wordRow}` }] },
		handles,
	}));
}

// how a run goes, from the plan and the report: rows taken together into batches, batches
// sent, what fails retried, what keeps failing set aside, all of it recorded
function sceneRunFlowBuild(model) {
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
	const stat = model.reportRun?.stat ?? {};
	const top = -40;
	const bottom = Math.max(height, yMiddle + 260) + 60;
	const targetList = flowTargetNodesBuild(model, { prefix: 'flow-target', x: FLOW_X_TARGET, y: Math.max(top + 20, yMiddle - 20), handles: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')] });
	nodes.push(
		noteNodeBuild({ id: 'flow-send', x: 460, y: yMiddle, width: 160, title: textOf(flow.send, 'title', 'Send'), tag: textOf(flow.send, 'tag', ''), text: textOf(flow.send, 'text', 'Batch by batch, what is looked up first'), tone: 'amber', handleList: [handleOf('in', 'in', 'left'), handleOf('ok', 'out', 'right'), { id: 'retry-out', direction: 'out', anchor: { side: 'bottom', offset: 0.3 } }, { id: 'retry-in', direction: 'in', anchor: { side: 'bottom', offset: 0.7 } }] }),
		...targetList,
		noteNodeBuild({ id: 'flow-retry', x: 460, y: yMiddle + 120, width: 160, title: textOf(flow.retry, 'title', 'Retry'), tag: textOf(flow.retry, 'tag', ''), text: textOf(flow.retry, 'text', 'Waits, then tries again, up to a limit'), tone: 'slate', handleList: [{ id: 'in', direction: 'in', anchor: { side: 'top', offset: 0.3 } }, { id: 'back', direction: 'out', anchor: { side: 'top', offset: 0.7 } }, handleOf('over', 'out', 'right')] }),
		noteNodeBuild({ id: 'flow-dlq', x: 680, y: yMiddle + 120, width: 170, title: textOf(flow.dlq, 'title', wordDlq), tag: textOf(flow.dlq, 'tag', ''), text: textOf(flow.dlq, 'text', 'Rows over the limit are kept apart'), tone: 'red', link: '/overview/run/dlq', handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')] }),
		noteNodeBuild({ id: 'flow-report', x: FLOW_X_TARGET, y: bottom - FLOW_BLOCK_ARTIFACTS_HEIGHT + 20, width: FLOW_TARGET_WIDTH, title: labelOf(model, 'run'), tone: 'green', link: '/overview/run/batch', metaList: metaOf(model, stat, [['success', 'statSuccess'], ['dlq', 'statDlq']]), handleList: [handleOf('in', 'in', 'left'), handleOf('right', 'in', 'right')] }),
		...flowBlocksBuild(model, { xTarget: FLOW_X_TARGET, top, bottom }),
	);
	for (const id of batchIdList) connections.push(lineOf(`flow-send:${id}`, [id, 'out'], ['flow-send', 'in'], { style: flowLineOf(id) }));
	connections.push(
		...targetList.map((node) => lineOf(`flow-ok:${node.id}`, ['flow-send', 'ok'], [node.id, 'in'], { style: FLOW_LINE })),
		...targetList.map((node) => lineOf(`flow-report-ok:${node.id}`, [node.id, 'out'], ['flow-report', 'right'], { style: FLOW_LINE })),
		lineOf('flow-fail', ['flow-send', 'retry-out'], ['flow-retry', 'in'], { style: { stroke: '#d97706', strokeWidth: 1.25 } }),
		lineOf('flow-back', ['flow-retry', 'back'], ['flow-send', 'retry-in'], { style: { stroke: '#64748b', strokeWidth: 1.25, strokeDasharray: '4 3' } }),
		lineOf('flow-over', ['flow-retry', 'over'], ['flow-dlq', 'in'], { style: { stroke: '#dc2626', strokeWidth: 1.25 } }),
		lineOf('flow-report-dlq', ['flow-dlq', 'out'], ['flow-report', 'in'], { style: FLOW_LINE }),
	);
	return { nodes, connections };
}

function sceneRunBatchBuild(model) {
	const list = model.reportRun?.batchList ?? [];
	return {
		nodes: [genericTableNodeBuild({
			id: 'run-batch', x: 0, y: 0, width: 620, name: labelOf(model, 'runBatch'), tone: 'amber',
			fieldList: [{ id: 'file', label: labelOf(model, 'columnFile') }, { id: 'rowCount', label: labelOf(model, 'columnRows') }, { id: 'success', label: labelOf(model, 'statSuccess') }, { id: 'dlq', label: labelOf(model, 'statDlq') }],
			rowList: list.map((batch, index) => ({ id: `b${index}`, file: batch.isOmitted ? `⋮ ${numberText(batch.count)} ${labelOf(model, 'batchUnit')}` : batch.file, rowCount: String(numberText(batch.rowCount) ?? ''), success: String(numberText(batch.success) ?? ''), dlq: String(batch.dlq ?? ''), tone: batch.dlq ? 'red' : undefined })),
			columnTemplate: '1fr 4rem 4rem 4rem',
		})],
		connections: [],
	};
}

function sceneRunDlqBuild(model) {
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

function sceneVerifyBuild(model) {
	const stat = model.reportVerify?.stat ?? {};
	const exceptionCount = model.reportVerify?.exceptionList?.length ?? 0;
	return reportStackBuild(model, 'verify', [
		{ id: 'flow', scene: '/overview/verify/flow', title: labelOf(model, 'verifyFlow'), icon: 'file-check', tone: 'green' },
		...(model.reportVerify?.matchList?.length ? [{ id: 'match', scene: '/overview/verify/match', title: labelOf(model, 'verifyMatch'), subtitle: `${model.reportVerify.matchList.length} ${labelOf(model, 'matchUnit')}`, icon: 'key', tone: 'teal' }] : []),
		...(model.reportVerify?.sample ? [{ id: 'sample', scene: '/overview/verify/sample', title: labelOf(model, 'verifySample'), subtitle: model.reportVerify.sample.key, icon: 'search', tone: 'blue' }] : []),
		reportSummaryItemBuild(model, { id: 'result', title: labelOf(model, 'verifyResult'), text: `${model.reportVerify?.checkList?.length ?? 0} ${labelOf(model, 'columnCheck')}`, tone: 'green', link: '/overview/verify/check', metaList: metaOf(model, stat, [['total', 'statTotal'], ['matched', 'statMatched'], ['exception', 'statException']]) }),
		reportSummaryItemBuild(model, { id: 'exception', title: labelOf(model, 'verifyException'), text: model.reportVerify?.exceptionList?.[0]?.status, tone: exceptionCount > 0 ? 'red' : 'slate', link: '/overview/verify/exception', metaList: [{ value: exceptionCount, label: labelOf(model, 'statException') }] }),
	]);
}

const VERIFY_CHECK_HEIGHT = 74;

// how a verification goes: the batches the run used are the reference; the set of their rows
// is compared first, then each row's expected values with what is read back from the target
function sceneVerifyFlowBuild(model) {
	const flow = model.reportVerify?.flow ?? {};
	const stat = model.reportVerify?.stat ?? {};
	const { nodes, connections, batchIdList, height } = batchFlowBuild(model, { xBatch: 225, widthBatch: 170 });
	const checkList = model.reportVerify?.checkList ?? [];
	const heightChecks = Math.max(1, checkList.length) * VERIFY_CHECK_HEIGHT;
	const heightAll = Math.max(height, heightChecks);
	const yMiddle = Math.max(0, heightAll / 2 - 50);
	// the lines reading the target tables pass above the checks
	const top = Math.min(-100, yMiddle + 40 - heightChecks / 2 - 30 - batchTableListBuild(model).length * FLOW_TARGET_ROW_HEIGHT);
	const bottom = heightAll + 150;
	const targetList = flowTargetNodesBuild(model, { prefix: 'verify-target', x: VERIFY_X_TARGET, y: top + 30, handles: [handleOf('out', 'out', 'left')] });
	nodes.push(
		noteNodeBuild({ id: 'verify-set', x: 450, y: yMiddle, width: 150, title: textOf(flow.set, 'title', 'Compare the set'), text: textOf(flow.set, 'text', 'The rows of the batches against the outcome of the run'), tone: 'blue', metaList: metaOf(model, stat, [['total', 'statTotal'], ['matched', 'statMatched'], ['exception', 'statException']]), handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right'), handleOf('down', 'out', 'bottom')] }),
		noteNodeBuild({ id: 'verify-compare', x: 650, y: yMiddle, width: 150, link: model.reportVerify?.matchList?.length ? '/overview/verify/match' : undefined, title: textOf(flow.compare, 'title', 'Compare the values'), text: textOf(flow.compare, 'text', 'The CSV through the mappings, against the target'), tone: 'teal', handleList: [handleOf('in', 'in', 'left'), handleOf('read', 'in', 'top'), handleOf('out', 'out', 'right')] }),
		...targetList,
		noteNodeBuild({ id: 'verify-exception', x: 450, y: heightAll + 30, width: 350, title: textOf(flow.exception, 'title', labelOf(model, 'verifyException')), text: model.reportVerify?.exceptionList?.map((item) => `${item.key}: ${item.reason} / ${item.status}`).join('\n') || '—', tone: 'red', link: '/overview/verify/exception', handleList: [handleOf('in', 'in', 'top'), handleOf('out', 'out', 'right')] }),
		noteNodeBuild({ id: 'verify-report', x: VERIFY_X_TARGET, y: bottom - FLOW_BLOCK_ARTIFACTS_HEIGHT + 20, width: FLOW_TARGET_WIDTH, title: labelOf(model, 'verify'), tone: 'green', link: '/overview/verify/check', metaList: metaOf(model, stat, [['matched', 'statMatched'], ['exception', 'statException']]), handleList: [handleOf('in', 'in', 'left')] }),
		...flowBlocksBuild(model, { xTarget: VERIFY_X_TARGET, top, bottom }),
	);
	for (const id of batchIdList) connections.push(lineOf(`verify-set:${id}`, [id, 'out'], ['verify-set', 'in'], { style: flowLineOf(id) }));
	connections.push(
		lineOf('verify-go', ['verify-set', 'out'], ['verify-compare', 'in'], { style: { stroke: '#16a34a', strokeWidth: 1.25 }, label: { text: String(numberText(stat.matched) ?? '') } }),
		...targetList.map((node, index) => lineOf(`verify-read:${node.id}`, [node.id, 'out'], ['verify-compare', 'read'], { style: FLOW_LINE, ...(index === 0 ? { label: { text: textOf(flow.compare, 'readLabel', '') } } : {}) })),
		lineOf('verify-out', ['verify-set', 'down'], ['verify-exception', 'in'], { style: { stroke: '#dc2626', strokeWidth: 1.25 }, label: { text: String(numberText(stat.exception) ?? '') } }),
		lineOf('verify-report-exception', ['verify-exception', 'out'], ['verify-report', 'in'], { style: FLOW_LINE }),
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
const MATCH_TONE_LIST = ['blue', 'green', 'violet', 'amber'];
// the columns of a lane, as in the flows: the source, the migration server, the target
const MATCH_TABLE_WIDTH = 370;
const MATCH_STEP_WIDTH = 240;
const MATCH_STEP_HEIGHT = 80;
const MATCH_X_DIVIDER_SERVER = 400;
const MATCH_X_STEP = 420;
const MATCH_X_DIVIDER_TARGET = 680;
const MATCH_X_TARGET = 700;
const MATCH_LANE_LEFT = -20;
const MATCH_LANE_WIDTH = MATCH_X_TARGET + MATCH_TABLE_WIDTH - MATCH_LANE_LEFT * 2;
// the title of a lane, the headings of its columns under it, what it holds, a margin below
const MATCH_COLUMN_TOP = 78;
const MATCH_LANE_HEAD = 112;
const MATCH_LANE_FOOT = 20;
const MATCH_LANE_GAP = 16;
const MATCH_INTRO_HEIGHT = 96;
const MATCH_ROW_HEIGHT = 20;

// the tables a pattern applies to: a mapping of tables says which (match), the first by default
function matchTableNameListOf(model, match) {
	const matchList = model.reportVerify?.matchList ?? [];
	return [...model.mappingTableByKey.values()]
		.filter((mapping) => (mapping.match ?? matchList[0]?.id) === match.id)
		.map((mapping) => model.tableByKey.get(mapping.target)?.name ?? mapping.target);
}

// some rows of one table: spec { table: key, label?, rowList: [{ column, value, isKey?, label?, tone? }] }
function rowTableNodeBuild(model, { id, spec, tone, x, y, width = MATCH_TABLE_WIDTH, handleList }) {
	const { table: key, rowList = [], label } = spec ?? {};
	const table = model.tableByKey.get(key);
	const columnOf = (columnId) => table?.columnList.find((column) => column.id === columnId);
	const node = genericTableNodeBuild({
		id, x, y, width, name: table?.name ?? key, subtitle: [label, table?.logical].filter(Boolean).join(' / '), tone: table?.isMaster ? MASTER_TONE : tone,
		fieldList: [{ id: 'name', label: labelOf(model, 'columnColumn') }, { id: 'value', label: labelOf(model, 'columnValue') }],
		// a column by its name and logical name, or the words of the row (a long logical name)
		rowList: rowList.map((row) => {
			const column = columnOf(row.column);
			const nameFull = column?.logical && column.logical !== column.name ? `${column.name} (${column.logical})` : column?.name ?? row.column;
			const toneRow = row.tone ?? (row.isKey ? tone : undefined);
			return { id: row.column, name: row.label ?? nameFull, value: String(row.value ?? ''), ...(toneRow ? { tone: toneRow } : {}) };
		}),
		columnTemplate: '1.15fr 1fr',
		handleList,
	});
	if (table?.isMaster) node.data.badge = MASTER_BADGE;
	return node;
}

function matchTableNodeBuild(model, match, side, tone, { x, y, handleList }) {
	return rowTableNodeBuild(model, { id: `match:${match.id}:${side}`, spec: match[side], tone, x, y, handleList });
}

// one pattern as one lane, in the columns of the flows: a row of the source, in the middle what
// the migration server does with its key and what comes of it, the row found in the target.
// isLinked: each step opens the pattern alone
function matchLaneBuild(model, match, index, { y, isLinked }) {
	const tone = MATCH_TONE_LIST[index % MATCH_TONE_LIST.length];
	const stepList = match.stepList ?? [];
	const rowCount = Math.max(match.source?.rowList?.length ?? 0, match.target?.rowList?.length ?? 0);
	const heightContent = Math.max(30 + rowCount * MATCH_ROW_HEIGHT, (stepList.length + (match.result ? 1 : 0) - 1) * MATCH_STEP_HEIGHT + 70);
	const height = MATCH_LANE_HEAD + heightContent + MATCH_LANE_FOOT;
	const yTop = y + MATCH_LANE_HEAD;
	const idOf = (part) => `match:${match.id}:${part}`;
	const line = { stroke: '#64748b', strokeWidth: 1.25 };
	const handleSourceList = stepList.map((step) => handleOf(`key-${step.id}`, 'out', 'right', `row/${step.from}`));
	const handleTargetList = [...stepList.map((step) => handleOf(`key-${step.id}`, 'in', 'left', `row/${step.to}`)), handleOf('out', 'out', 'bottom')];
	const nameList = matchTableNameListOf(model, match);
	const { source, target } = model.system;
	const nodes = [
		{
			id: idOf('lane'), renderer: { type: 'color-block' }, position: { x: MATCH_LANE_LEFT, y },
			size: { width: MATCH_LANE_WIDTH, height }, handles: [],
			data: { tone, labelSide: 'top', columnTop: MATCH_COLUMN_TOP, columnList: [
				{ id: 'source', x: 0, width: MATCH_X_DIVIDER_SERVER - MATCH_LANE_LEFT, icon: 'database', text: `${labelOf(model, 'sourceDatabase')} (${source.name})` },
				{ id: 'server', x: MATCH_X_DIVIDER_SERVER - MATCH_LANE_LEFT, width: MATCH_X_DIVIDER_TARGET - MATCH_X_DIVIDER_SERVER, icon: 'server', text: labelOf(model, 'migrationServer') },
				{ id: 'target', x: MATCH_X_DIVIDER_TARGET - MATCH_LANE_LEFT, width: MATCH_LANE_WIDTH - (MATCH_X_DIVIDER_TARGET - MATCH_LANE_LEFT), icon: 'database', text: `${labelOf(model, 'targetDatabase')} (${target.name})` },
			], itemList: [{ id: 'title', level: 2, icon: match.icon ?? 'key', text: `${labelOf(model, 'matchName')} ${index + 1}: ${match.title ?? match.id}` }, ...(nameList.length > 0 ? [{ id: 'table', text: `${labelOf(model, 'matchTable')}: ${nameList.join(', ')}` }] : [])] },
		},
		matchTableNodeBuild(model, match, 'source', tone, { x: 0, y: yTop, handleList: handleSourceList }),
		...stepList.map((step, indexStep) => noteNodeBuild({
			id: idOf(`step:${step.id}`), x: MATCH_X_STEP, y: yTop + indexStep * MATCH_STEP_HEIGHT, width: MATCH_STEP_WIDTH, title: step.title, tag: step.tag, text: step.text, tone,
			link: isLinked ? `/overview/verify/match/${match.id}` : undefined,
			handleList: [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')],
		})),
		matchTableNodeBuild(model, match, 'target', tone, { x: MATCH_X_TARGET, y: yTop, handleList: handleTargetList }),
		...(match.result ? [noteNodeBuild({ id: idOf('result'), x: MATCH_X_STEP, y: yTop + stepList.length * MATCH_STEP_HEIGHT, width: MATCH_STEP_WIDTH, title: match.result.title, tag: match.result.tag, text: match.result.text, tone: 'green', handleList: [handleOf('in', 'in', 'right')] })] : []),
	];
	const connections = [
		...stepList.flatMap((step) => [
			lineOf(idOf(`from:${step.id}`), [idOf('source'), `key-${step.id}`], [idOf(`step:${step.id}`), 'in'], { style: line }),
			lineOf(idOf(`to:${step.id}`), [idOf(`step:${step.id}`), 'out'], [idOf('target'), `key-${step.id}`], { style: line }),
		]),
		...(match.result ? [lineOf(idOf('found'), [idOf('target'), 'out'], [idOf('result'), 'in'], { style: line })] : []),
	];
	return { nodes, connections, height };
}

// how one row of the source is found in the target: what this is about at the top, then the
// patterns one under another
function sceneVerifyMatchBuild(model, matchId) {
	const matchList = model.reportVerify?.matchList ?? [];
	const isOne = matchId !== undefined;
	const shownList = isOne ? matchList.filter((match) => match.id === matchId) : matchList;
	if (shownList.length === 0) return null;
	const nodes = [];
	const connections = [];
	let y = 0;
	if (!isOne) {
		const textIntro = model.reportVerify?.matchIntro;
		nodes.push({
			id: 'match:intro', renderer: { type: 'color-block' }, position: { x: MATCH_LANE_LEFT, y }, size: { width: MATCH_LANE_WIDTH, height: MATCH_INTRO_HEIGHT }, handles: [],
			data: { tone: 'slate', labelSide: 'top', itemList: [{ id: 'title', level: 1, text: labelOf(model, 'verifyMatch') }, ...(textIntro ? [{ id: 'text', text: textIntro }] : [])] },
		});
		y += MATCH_INTRO_HEIGHT + MATCH_LANE_GAP;
	}
	for (const match of shownList) {
		const lane = matchLaneBuild(model, match, matchList.indexOf(match), { y, isLinked: !isOne });
		nodes.push(...lane.nodes);
		connections.push(...lane.connections);
		y += lane.height + MATCH_LANE_GAP;
	}
	return { nodes, connections };
}

// ---------- after the migration ----------

const POST_TONE = REPORT_TONE_BY_ID.post;
const POST_TABLE_WIDTH = 350;
const POST_STEP_WIDTH = 230;
const POST_HEAD = 118;
const POST_COLUMN_TOP = 84;
const POST_MARGIN = 20;
const POST_LINE_HEIGHT = 30;

function postBlockBuild(model, id, { title, text, width, height, columnList, columnTop = POST_COLUMN_TOP, itemList = [] }) {
	return {
		id: `${id}:block`, renderer: { type: 'color-block' }, position: { x: -POST_MARGIN, y: 0 }, size: { width, height }, handles: [],
		data: { tone: POST_TONE, labelSide: 'top', columnTop, columnList, itemList: [{ id: 'title', level: 2, text: title }, ...(text ? [{ id: 'text', text }] : []), ...itemList] },
	};
}

const postColumnOf = (model, role) => {
	const { source, target } = model.system;
	if (role === 'source') return { icon: 'database', text: `${labelOf(model, 'sourceDatabase')} (${source.name})` };
	if (role === 'target') return { icon: 'database', text: `${labelOf(model, 'targetDatabase')} (${target.name})` };
	if (role === 'server') return { icon: 'server', text: labelOf(model, 'migrationServer') };
	return { icon: 'server', text: labelOf(model, 'postServer') };
};

const postKeyColumnOf = (spec) => spec?.rowList?.find((row) => row.isKey)?.column;

// a master table loaded without its GUIDs: a table of GUIDs by another column, then the
// lookups of the tables referring to it, empty since the load, are set
function scenePostMasterBuild(model) {
	const master = model.planPost?.master;
	if (!master) return null;
	const idOf = (part) => `post-master:${part}`;
	const stepById = new Map((master.stepList ?? []).map((step) => [step.id, step]));
	const line = { stroke: '#64748b', strokeWidth: 1.25 };
	const xStep = POST_TABLE_WIDTH + 50;
	const xTarget = xStep + POST_STEP_WIDTH + 50;
	const width = xTarget + POST_TABLE_WIDTH + POST_MARGIN * 2;
	const referList = migrationMasterReferListOf(model, model.system.target.id);
	// a line more above the columns, for the columns to update
	const headExtra = referList.length ? POST_LINE_HEIGHT : 0;
	const yTop = POST_HEAD + headExtra;
	const yRefer = yTop + 124;
	const yOf = { map: yTop, find: yTop + 96, write: yTop + 192 };
	const height = yOf.write + 80 + POST_MARGIN;
	const stepNodeOf = (id, handleList) => noteNodeBuild({ id: idOf(`step:${id}`), x: xStep, y: yOf[id], width: POST_STEP_WIDTH, title: stepById.get(id)?.title, tag: stepById.get(id)?.tag, text: stepById.get(id)?.text, tone: POST_TONE, handleList });
	const nodes = [
		postBlockBuild(model, 'post-master', {
			title: master.title, text: master.text, width, height, columnTop: POST_COLUMN_TOP + headExtra,
			columnList: [
				{ id: 'source', x: 0, width: POST_TABLE_WIDTH + 25 + POST_MARGIN, ...postColumnOf(model, 'source') },
				{ id: 'post', x: POST_TABLE_WIDTH + 25 + POST_MARGIN, width: POST_STEP_WIDTH + 50, ...postColumnOf(model, 'post') },
				{ id: 'target', x: xTarget - 25 + POST_MARGIN, width: POST_TABLE_WIDTH + 25 + POST_MARGIN, ...postColumnOf(model, 'target') },
			],
			itemList: referList.length ? [{ id: 'refer', text: `${labelOf(model, 'postTarget')}: ${referList.map(({ table, column }) => `${table.name}.${column.name}`).join(', ')}` }] : [],
		}),
		rowTableNodeBuild(model, { id: idOf('source'), spec: master.source, tone: POST_TONE, x: 0, y: yTop, width: POST_TABLE_WIDTH, handleList: [handleOf('key', 'out', 'right', `row/${postKeyColumnOf(master.source)}`)] }),
		rowTableNodeBuild(model, { id: idOf('refer-source'), spec: master.referSource, tone: POST_TONE, x: 0, y: yRefer, width: POST_TABLE_WIDTH, handleList: [handleOf('key', 'out', 'right', `row/${postKeyColumnOf(master.referSource)}`)] }),
		rowTableNodeBuild(model, { id: idOf('target'), spec: master.target, tone: POST_TONE, x: xTarget, y: yTop, width: POST_TABLE_WIDTH, handleList: [handleOf('key', 'out', 'left', `row/${postKeyColumnOf(master.target)}`)] }),
		rowTableNodeBuild(model, { id: idOf('refer-target'), spec: master.referTarget, tone: POST_TONE, x: xTarget, y: yRefer, width: POST_TABLE_WIDTH, handleList: [handleOf('key', 'in', 'left', `row/${postKeyColumnOf(master.referTarget)}`)] }),
		stepNodeOf('map', [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right'), handleOf('down', 'out', 'bottom')]),
		stepNodeOf('find', [handleOf('left', 'in', 'left'), handleOf('up', 'in', 'top'), handleOf('down', 'out', 'bottom')]),
		stepNodeOf('write', [handleOf('up', 'in', 'top'), handleOf('out', 'out', 'right')]),
	];
	const connections = [
		lineOf(idOf('read-source'), [idOf('source'), 'key'], [idOf('step:map'), 'left'], { style: line }),
		lineOf(idOf('read-target'), [idOf('target'), 'key'], [idOf('step:map'), 'right'], { style: line }),
		lineOf(idOf('map-find'), [idOf('step:map'), 'down'], [idOf('step:find'), 'up'], { style: line }),
		lineOf(idOf('read-refer'), [idOf('refer-source'), 'key'], [idOf('step:find'), 'left'], { style: line }),
		lineOf(idOf('find-write'), [idOf('step:find'), 'down'], [idOf('step:write'), 'up'], { style: line }),
		lineOf(idOf('write'), [idOf('step:write'), 'out'], [idOf('refer-target'), 'key'], { style: { stroke: '#16a34a', strokeWidth: 1.5 } }),
	];
	return { nodes, connections };
}

// the columns the system sets: a row created by the migration has the values of that moment,
// which no write can avoid at creation; a script then writes those of the source
function scenePostAuditBuild(model) {
	const audit = model.planPost?.audit;
	if (!audit) return null;
	const idOf = (part) => `post-audit:${part}`;
	const line = { stroke: '#64748b', strokeWidth: 1.25 };
	const stepWidth = 210;
	const xRun = POST_TABLE_WIDTH + 44;
	const xPost = xRun + stepWidth + 44;
	const xTarget = xPost + stepWidth + 44;
	const width = xTarget + POST_TABLE_WIDTH + POST_MARGIN * 2;
	const yTop = POST_HEAD;
	const yTargetPost = yTop + 170;
	const height = yTargetPost + 150 + POST_MARGIN;
	const stepOf = (id, step, x, y, handleList) => noteNodeBuild({ id: idOf(id), x, y, width: stepWidth, title: step?.title, tag: step?.tag, text: step?.text, tone: id === 'step-run' ? 'amber' : POST_TONE, handleList });
	const nodes = [
		postBlockBuild(model, 'post-audit', {
			title: audit.title, text: audit.text, width, height,
			columnList: [
				{ id: 'source', x: 0, width: xRun - 22 + POST_MARGIN, ...postColumnOf(model, 'source') },
				{ id: 'server', x: xRun - 22 + POST_MARGIN, width: stepWidth + 44, ...postColumnOf(model, 'server') },
				{ id: 'post', x: xPost - 22 + POST_MARGIN, width: stepWidth + 44, ...postColumnOf(model, 'post') },
				{ id: 'target', x: xTarget - 22 + POST_MARGIN, width: POST_TABLE_WIDTH + 22 + POST_MARGIN, ...postColumnOf(model, 'target') },
			],
		}),
		rowTableNodeBuild(model, { id: idOf('source'), spec: audit.source, tone: POST_TONE, x: 0, y: yTop, width: POST_TABLE_WIDTH, handleList: [handleOf('out', 'out', 'right'), handleOf('down', 'out', 'bottom')] }),
		stepOf('step-run', audit.stepRun, xRun, yTop, [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')]),
		stepOf('step-post', audit.stepPost, xPost, yTargetPost, [handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')]),
		rowTableNodeBuild(model, { id: idOf('target-run'), spec: audit.targetRun, tone: POST_TONE, x: xTarget, y: yTop, width: POST_TABLE_WIDTH, handleList: [handleOf('in', 'in', 'left'), handleOf('down', 'out', 'bottom')] }),
		rowTableNodeBuild(model, { id: idOf('target-post'), spec: audit.targetPost, tone: POST_TONE, x: xTarget, y: yTargetPost, width: POST_TABLE_WIDTH, handleList: [handleOf('in', 'in', 'left'), handleOf('up', 'in', 'top')] }),
	];
	const connections = [
		lineOf(idOf('create'), [idOf('source'), 'out'], [idOf('step-run'), 'in'], { style: line }),
		lineOf(idOf('created'), [idOf('step-run'), 'out'], [idOf('target-run'), 'in'], { style: line }),
		lineOf(idOf('read'), [idOf('source'), 'down'], [idOf('step-post'), 'in'], { style: line }),
		lineOf(idOf('write'), [idOf('step-post'), 'out'], [idOf('target-post'), 'in'], { style: { stroke: '#16a34a', strokeWidth: 1.5 } }),
		lineOf(idOf('then'), [idOf('target-run'), 'down'], [idOf('target-post'), 'up'], { style: { stroke: '#94a3b8', strokeWidth: 1.25, strokeDasharray: '4 3' } }),
	];
	return { nodes, connections };
}

function scenePostBuild(model) {
	const post = model.planPost;
	if (!post) return null;
	return reportStackBuild(model, 'post', [
		...(post.intro ? [{ id: 'intro', node: { renderer: { type: 'card-note' }, size: { width: 'auto', height: 'auto' }, data: { title: labelOf(model, 'post'), text: post.intro, tone: POST_TONE } } }] : []),
		...(post.master ? [{ id: 'master', scene: '/overview/post/master', title: post.master.title, icon: 'key', tone: POST_TONE }] : []),
		...(post.audit ? [{ id: 'audit', scene: '/overview/post/audit', title: post.audit.title, icon: 'refresh', tone: POST_TONE }] : []),
	]);
}

function sceneVerifySampleBuild(model) {
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

function sceneVerifyCheckBuild(model) {
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

function sceneVerifyExceptionBuild(model) {
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
const OVERVIEW_REPORT_GAP_MIN = 120;
const OVERVIEW_LEVEL_GAP = 44;

function sceneOverviewBuild(model) {
	const { source, target, tool } = model.system;
	const statOf = (dbId) => [`${migrationTableListOf(model, dbId).length} ${labelOf(model, 'tableUnit')}`, `${migrationChoiceListOf(model, dbId).length} ${labelOf(model, 'choiceUnit')}`];
	// the reports under the databases, centered, as many as there are
	const reportIdList = reportIdListOf(model);
	const widthAll = OVERVIEW_TARGET_X + OVERVIEW_DB_WIDTH;
	const reportGap = Math.max(OVERVIEW_REPORT_GAP_MIN, (widthAll - reportIdList.length * OVERVIEW_REPORT_WIDTH) / (reportIdList.length - 1));
	const reportLeft = (widthAll - reportIdList.length * OVERVIEW_REPORT_WIDTH - (reportIdList.length - 1) * reportGap) / 2;
	const reportX = (index) => reportLeft + index * (OVERVIEW_REPORT_WIDTH + reportGap);
	const reportNodeOf = (id, index, handles) => ({ ...sceneBuild(model, `/overview/${id}`).nodes[0], position: { x: reportX(index), y: OVERVIEW_REPORT_Y }, size: { width: OVERVIEW_REPORT_WIDTH, height: OVERVIEW_REPORT_HEIGHT }, link: `/overview/${id}`, handles });
	const stepList = tool.stepList?.length ? tool.stepList : [{ id: 'plan', name: labelOf(model, 'plan') }, { id: 'run', name: labelOf(model, 'run') }, { id: 'verify', name: labelOf(model, 'verify') }];
	const toolHandles = [handleOf('source', 'out', 'left'), handleOf('target', 'out', 'right'), ...stepList.map((step, index) => ({ id: `step-${step.id}`, direction: 'out', anchor: { target: 'body', side: 'bottom', offset: (index + 1) / (stepList.length + 1) } }))];
	const nodes = [
		embedNodeBuild({ id: 'db:source', x: 0, y: 0, width: OVERVIEW_DB_WIDTH, height: OVERVIEW_DB_HEIGHT, scene: `/overview/${source.id}`, title: source.name, subtitle: source.description, icon: 'database', tone: 'blue', statList: statOf(source.id), handleList: [handleOf('in', 'in', 'right')] }),
		embedNodeBuild({ id: 'db:target', x: OVERVIEW_TARGET_X, y: 0, width: OVERVIEW_DB_WIDTH, height: OVERVIEW_DB_HEIGHT, scene: `/overview/${target.id}`, title: target.name, subtitle: target.description, icon: 'cloud', tone: 'green', statList: statOf(target.id), handleList: [handleOf('in', 'in', 'left')] }),
		{
			id: 'tool', renderer: { type: 'table' }, position: { x: OVERVIEW_TOOL_X, y: 150 }, size: { width: OVERVIEW_TOOL_WIDTH, height: 'auto' },
			data: { name: tool.name, nameLogical: tool.description ?? '', tone: 'violet', isFieldHeaderHidden: true, fields: [{ id: 'tag', label: '' }, { id: 'name', label: '' }], columnTemplate: '2.6rem 1fr', rows: stepList.map((step, index) => ({ id: step.id, tag: String(index + 1).padStart(2, '0'), name: step.name })) },
			handles: toolHandles,
		},
		{ id: 'link:mapping', renderer: { type: 'card-brief' }, position: { x: OVERVIEW_TOOL_X + 20, y: 40 }, size: { width: OVERVIEW_TOOL_WIDTH - 40, height: 'auto' }, link: '/overview/mapping', data: { title: labelOf(model, 'mapping'), icon: 'arrow-right-left', tone: 'teal', statList: [`${model.mappingTableByKey.size} ${labelOf(model, 'tableUnit')}`] }, handles: [] },
		reportNodeOf('plan', 0, [handleOf('top', 'in', 'top'), handleOf('out', 'out', 'right')]),
		reportNodeOf('run', 1, [handleOf('top', 'in', 'top'), handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')]),
		reportNodeOf('verify', 2, [handleOf('top', 'in', 'top'), handleOf('in', 'in', 'left'), handleOf('out', 'out', 'right')]),
		...(model.planPost ? [reportNodeOf('post', 3, [handleOf('top', 'in', 'top'), handleOf('in', 'in', 'left')])] : []),
	];
	const reportIdOf = (step, index) => `report:${step.report ?? ['plan', 'run', 'verify'][index]}`;
	const labelStep = ['planMake', 'runMake', 'verifyMake', 'postMake'];
	const stepShownList = stepList.filter((step, index) => reportIdList.includes(reportIdOf(step, index).slice('report:'.length)));
	// the reports fan out from the tool: lines going one way share the space under it, so
	// each has a level of its own, the one leaving farthest out the highest, so that they do
	// not cross (card-diagram-usage.md#no-lines-on-top-of-each-other)
	const toolX = (index) => OVERVIEW_TOOL_X + (OVERVIEW_TOOL_WIDTH * (index + 1)) / (stepList.length + 1);
	const reportCenterX = (step, index) => reportX(reportIdList.indexOf(reportIdOf(step, index).slice('report:'.length))) + OVERVIEW_REPORT_WIDTH / 2;
	const stepPlaceList = stepList.map((step, index) => ({ step, index, from: toolX(index), to: reportCenterX(step, index) })).filter(({ step, index }) => stepShownList.includes(step) && reportIdList.includes(reportIdOf(step, index).slice('report:'.length)));
	const routeOfStep = (step) => {
		const place = stepPlaceList.find((item) => item.step === step);
		const side = Math.sign(place.to - place.from);
		if (side === 0) return {};
		const siblingList = stepPlaceList.filter((item) => Math.sign(item.to - item.from) === side).sort((a, b) => (a.from - b.from) * -side);
		const level = siblingList.indexOf(place) - (siblingList.length - 1) / 2;
		return level === 0 ? {} : { route: { anchorList: [{ id: 'level', along: 0.5, x: 0, y: level * OVERVIEW_LEVEL_GAP }] } };
	};
	const connections = [
		lineOf('read-source', ['tool', 'source'], ['db:source', 'in'], { style: { stroke: '#2563eb', strokeWidth: 1.5 }, label: { text: labelOf(model, 'readSource') } }),
		lineOf('write-target', ['tool', 'target'], ['db:target', 'in'], { style: { stroke: '#16a34a', strokeWidth: 1.5 }, label: { text: labelOf(model, 'write') } }),
		...stepShownList.map((step, index) => lineOf(`make:${step.id}`, ['tool', `step-${step.id}`], [reportIdOf(step, index), 'top'], { style: { stroke: '#7c3aed', strokeWidth: 1.5 }, label: { text: labelOf(model, labelStep[index]), position: 0.62 }, ...routeOfStep(step) })),
		lineOf('plan-run', ['report:plan', 'out'], ['report:run', 'in'], { style: { stroke: '#64748b', strokeWidth: 1.5 }, label: { text: labelOf(model, 'planToRun') } }),
		lineOf('run-verify', ['report:run', 'out'], ['report:verify', 'in'], { style: { stroke: '#64748b', strokeWidth: 1.5 }, label: { text: labelOf(model, 'runToVerify') } }),
		...(model.planPost ? [lineOf('verify-post', ['report:verify', 'out'], ['report:post', 'in'], { style: { stroke: '#64748b', strokeWidth: 1.5 }, label: { text: labelOf(model, 'verifyToPost') } })] : []),
	];
	return { nodes, connections };
}

const reportIdListOf = (model) => ['plan', 'run', 'verify', ...(model.planPost ? ['post'] : [])];
const TAB_WIDTH = 1120;
const TAB_HEIGHT = 810;

function sceneOverviewTabsBuild(model, focus) {
	const diagram = sceneOverviewBuild(model);
	const widthAll = OVERVIEW_TARGET_X + OVERVIEW_DB_WIDTH;
	return switchTabsApply(diagram, {
		id: 'tabs',
		memberList: reportIdListOf(model).map((id) => ({ id: `report:${id}`, label: labelOf(model, id), tone: REPORT_TONE_BY_ID[id], link: `/overview/tabs/${id}` })),
		position: { x: (widthAll - TAB_WIDTH) / 2, y: OVERVIEW_REPORT_Y },
		size: { width: TAB_WIDTH, height: TAB_HEIGHT },
	}, `report:${focus}`);
}

// ---------- the provider ----------

// what a path shows: a pure function of the model. null for a path that names nothing
function sceneBuild(model, path) {
	const segmentList = path.split('/').filter(Boolean);
	if (segmentList[0] !== 'overview') return null;
	const [, first, second, third] = segmentList;
	const { source, target } = model.system;
	if (!first) return sceneOverviewBuild(model);
	if (first === 'tabs') return sceneOverviewTabsBuild(model, reportIdListOf(model).includes(second) ? second : 'plan');
	if (first === source.id || first === target.id) return second ? sceneTableBuild(model, first, second) ?? sceneChoiceBuild(model, first, second) : sceneErBuild(model, first);
	if (first === 'mapping') {
		if (third) return sceneMappingColumnBuild(model, second, third);
		return second ? sceneMappingTableBuild(model, second) : sceneMappingAllBuild(model);
	}
	if (first === 'choice') return second ? sceneMappingChoiceBuild(model, second) : sceneChoiceAllBuild(model);
	if (first === 'plan') return second === 'order' ? scenePlanOrderBuild(model) : second === 'batch' ? scenePlanBatchBuild(model) : second ? null : scenePlanBuild(model);
	if (first === 'run') return second === 'flow' ? sceneRunFlowBuild(model) : second === 'batch' ? sceneRunBatchBuild(model) : second === 'dlq' ? sceneRunDlqBuild(model) : second ? null : sceneRunBuild(model);
	if (first === 'post') return second === 'master' ? scenePostMasterBuild(model) : second === 'audit' ? scenePostAuditBuild(model) : second ? null : scenePostBuild(model);
	if (first === 'verify') return second === 'flow' ? sceneVerifyFlowBuild(model) : second === 'match' ? sceneVerifyMatchBuild(model, third) : second === 'sample' ? sceneVerifySampleBuild(model) : second === 'check' ? sceneVerifyCheckBuild(model) : second === 'exception' ? sceneVerifyExceptionBuild(model) : second ? null : sceneVerifyBuild(model);
	return null;
}

// a table or an option set of a database, by its logical name: migrationModelCheck says when one is both
const dbItemNameOf = (model, dbId, logical) => [...migrationTableListOf(model, dbId), ...migrationChoiceListOf(model, dbId)].find((item) => item.logical === logical)?.name ?? logical;

function pathLabelGet(model, path) {
	const segmentList = path.split('/').filter(Boolean);
	const last = segmentList[segmentList.length - 1];
	const [, first, second, third] = segmentList;
	const { source, target } = model.system;
	if (!first) return labelOf(model, 'overview');
	if (first === 'tabs') return second ? labelOf(model, second) : labelOf(model, 'tabs');
	if (first === source.id) return second ? dbItemNameOf(model, first, second) : source.name;
	if (first === target.id) return second ? dbItemNameOf(model, first, second) : target.name;
	if (first === 'mapping') {
		if (third) {
			const mapping = migrationMappingTableOfPair(model, second);
			const row = mapping && migrationMappingColumnListOf(model, mapping).find((item) => migrationColumnSegmentOf(item) === third);
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
	if (first === 'post') return second === 'master' ? model.planPost?.master?.title ?? second : second === 'audit' ? model.planPost?.audit?.title ?? second : labelOf(model, 'post');
	if (first === 'verify') return second === 'flow' ? labelOf(model, 'verifyFlow') : second === 'match' ? (third ? model.reportVerify?.matchList?.find((match) => match.id === third)?.title ?? third : labelOf(model, 'verifyMatch')) : second === 'sample' ? labelOf(model, 'verifySample') : second === 'check' ? labelOf(model, 'verifySet') : second === 'exception' ? labelOf(model, 'verifyException') : labelOf(model, 'verify');
	return last;
}

function childPathListGet(model, path) {
	const { source, target } = model.system;
	if (path === '/overview') return [`/overview/tabs`, `/overview/${source.id}`, `/overview/${target.id}`, '/overview/mapping', '/overview/choice', '/overview/plan', '/overview/run', '/overview/verify', ...(model.planPost ? ['/overview/post'] : [])];
	if (path === '/overview/tabs') return reportIdListOf(model).map((id) => `/overview/tabs/${id}`);
	if (path === '/overview/post') return [...(model.planPost?.master ? ['/overview/post/master'] : []), ...(model.planPost?.audit ? ['/overview/post/audit'] : [])];
	if (path === `/overview/${source.id}`) return [...migrationTableListOf(model, source.id), ...migrationChoiceListOf(model, source.id)].map((item) => `${path}/${item.logical}`);
	if (path === `/overview/${target.id}`) return [...migrationTableListOf(model, target.id), ...migrationChoiceListOf(model, target.id)].map((item) => `${path}/${item.logical}`);
	if (path === '/overview/mapping') return [...model.mappingTableByKey.values()].map((mapping) => `${path}/${migrationPairGet(model, mapping)}`);
	if (path.startsWith('/overview/mapping/') && switchPathParent(path) === '/overview/mapping') {
		const mapping = migrationMappingTableOfPair(model, switchPathLast(path));
		return mapping ? migrationMappingColumnListOf(model, mapping).map((row) => `${path}/${migrationColumnSegmentOf(row)}`) : [];
	}
	if (path === '/overview/choice') return [...model.mappingChoiceByKey.values()].map((mapping) => `${path}/${migrationChoicePairGet(model, mapping)}`);
	if (path === '/overview/plan') return ['/overview/plan/order', '/overview/plan/batch'];
	if (path === '/overview/run') return ['/overview/run/flow', '/overview/run/batch', '/overview/run/dlq'];
	if (path === '/overview/verify/match') return (model.reportVerify?.matchList ?? []).map((match) => `${path}/${match.id}`);
	if (path === '/overview/verify') return ['/overview/verify/flow', ...(model.reportVerify?.matchList?.length ? ['/overview/verify/match'] : []), ...(model.reportVerify?.sample ? ['/overview/verify/sample'] : []), '/overview/verify/check', '/overview/verify/exception'];
	return [];
}

// what a menu shows beside the words of a scene: a database, an option set among the tables
function labelItemListOf(model, path) {
	const { source, target } = model.system;
	const [, first, second] = path.split('/').filter(Boolean);
	const text = { type: 'text', text: pathLabelGet(model, path) };
	if ((first === source.id || first === target.id) && !second) return [{ type: 'icon', icon: 'database' }, text];
	if ((first === source.id || first === target.id) && migrationChoiceListOf(model, first).some((choice) => choice.logical === second)) return [{ type: 'icon', icon: 'list-checks' }, text];
	return undefined;
}

// the box a reader adjusted, kept in the layout item
const diagramOfScene = (diagram) => ({ defaults: { connection: { renderer: { type: 'smoothstep' }, markerEnd: 'arrowClosed' } }, ...diagram });

// the views of a database. embedded, a cylinder alone, filling the card so that the line
// arriving at the side of the card ends on its wall; and the diagram, in the frame of the card,
// while a pointer rests on it, which is also what a click opens. focused, the diagram or the
// matrix, which cannot be read at the size of a card
function sceneDbViewsBuild(model, dbId, path) {
	const { source, target } = model.system;
	const icon = { nodes: [{ id: `db-icon:${dbId}`, renderer: { type: 'card-database' }, position: { x: 0, y: 0 }, size: { width: OVERVIEW_DB_WIDTH, height: OVERVIEW_DB_HEIGHT }, data: { title: dbId === source.id ? source.name : target.name, tone: dbId === source.id ? 'blue' : 'green' } }], connections: [] };
	return {
		viewList: [
			{ id: 'diagram', label: labelOf(model, 'viewDiagram'), diagram: diagramOfScene(sceneErBuild(model, dbId)), box: boxOf(model, `${path}@diagram`) },
			{ id: 'matrix', label: labelOf(model, 'viewLookupMatrix'), isAvailableEmbedded: false, diagram: diagramOfScene(sceneLookupMatrixBuild(model, dbId)), box: boxOf(model, `${path}@matrix`) },
			{ id: 'icon', label: dbId === source.id ? source.name : target.name, isAvailableFocused: false, isFrameHiddenEmbedded: true, diagram: diagramOfScene(icon) },
		],
		viewDefault: [{ when: { isEmbedded: true }, view: 'icon' }, { view: 'diagram' }],
		viewHover: 'diagram',
		isViewSwitcherHiddenEmbedded: true,
	};
}

function boxOf(model, path) {
	const box = model.layout.sceneByPath?.[path]?.box;
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
		childListGet: (path) => childPathListGet(model, path).map((child) => ({ path: child, label: pathLabelGet(model, child), labelItemList: labelItemListOf(model, child) })),
		sceneGet: (path) => {
			const { source, target } = model.system;
			const dbId = [source.id, target.id].find((id) => path === `/overview/${id}`);
			if (dbId) return { path, label: pathLabelGet(model, path), ...sceneDbViewsBuild(model, dbId, path) };
			const diagram = sceneBuild(model, path);
			if (!diagram) return null;
			return { path, label: pathLabelGet(model, path), box: boxOf(model, path), diagram: diagramOfScene(diagram) };
		},
		boxSave: onBoxSave,
	};
	return provider;
}

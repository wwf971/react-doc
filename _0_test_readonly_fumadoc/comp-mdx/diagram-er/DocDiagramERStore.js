import { applyNodeChanges, MarkerType } from '@xyflow/react';
import { load as yamlLoad } from 'js-yaml';
import { makeAutoObservable, toJS } from 'mobx';

const sideList = ['left', 'right'];

class DocDiagramERStore {
	source = '';
	tableList = [];
	relationshipList = [];
	nodeList = [];
	edgeList = [];
	loadState = { status: 'idle', message: '' };
	graphVersion = 0;

	constructor(source = '') {
		makeAutoObservable(this, {}, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '') {
		this.source = String(source || '');
		if (!this.source.trim()) {
			this.tableList = [];
			this.relationshipList = [];
			this.nodeList = [];
			this.edgeList = [];
			this.loadState = { status: 'empty', message: 'ER diagram data is empty.' };
			this.graphVersion += 1;
			return;
		}

		try {
			const data = yamlLoad(this.source);
			const graphData = graphDataNormalize(data);
			this.tableList = graphData.tableList;
			this.relationshipList = graphData.relationshipList;
			this.nodeList = graphData.nodeList;
			this.edgeList = graphData.edgeList;
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.tableList = [];
			this.relationshipList = [];
			this.nodeList = [];
			this.edgeList = [];
			this.loadState = {
				status: 'error',
				message: String(error?.message || error),
			};
		}
		this.graphVersion += 1;
	}

	nodeListChange(changeList) {
		this.nodeList = applyNodeChanges(changeList, toJS(this.nodeList));
	}
}

function graphDataNormalize(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('The YAML root must be an object.');
	}
	if (!Array.isArray(data.tables) || data.tables.length === 0) {
		throw new Error('tables must be a non-empty list.');
	}
	if (data.relationships !== undefined && !Array.isArray(data.relationships)) {
		throw new Error('relationships must be a list.');
	}

	const tableList = data.tables.map(tableNormalize);
	const tableById = itemByIdBuild(tableList, 'table');
	const relationshipList = (data.relationships || []).map((relationship, index) => (
		relationshipNormalize(relationship, index, tableById)
	));
	itemByIdBuild(relationshipList, 'relationship');

	const handleListByTableColumn = relationshipHandleListBuild(relationshipList);
	const nodeList = tableList.map((table) => ({
		id: table.id,
		type: 'erTable',
		position: table.position,
		data: {
			table,
			handleListByColumnId: handleListByTableColumn[table.id] || {},
		},
	}));
	const edgeList = relationshipList.map((relationship) => ({
		id: relationship.id,
		source: relationship.source.tableId,
		sourceHandle: handleIdGet('source', relationship.source.columnId, relationship.source.side),
		target: relationship.target.tableId,
		targetHandle: handleIdGet('target', relationship.target.columnId, relationship.target.side),
		type: 'smoothstep',
		label: relationship.label,
		className: 'doc-er-diagram-edge',
		markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
		style: { strokeWidth: 1.5 },
		labelStyle: { fontSize: 11, fontWeight: 650 },
		labelShowBg: true,
		labelBgPadding: [6, 3],
		labelBgBorderRadius: 3,
	}));

	return { tableList, relationshipList, nodeList, edgeList };
}

function tableNormalize(table, index) {
	if (!table || typeof table !== 'object' || Array.isArray(table)) {
		throw new Error(`tables[${index}] must be an object.`);
	}
	const id = textRequired(table.id, `tables[${index}].id`);
	if (!Array.isArray(table.columns) || table.columns.length === 0) {
		throw new Error(`Table "${id}" must have a non-empty columns list.`);
	}
	const columnList = table.columns.map((column, columnIndex) => columnNormalize(column, id, columnIndex));
	itemByIdBuild(columnList, `column in table "${id}"`);
	const position = table.position && typeof table.position === 'object'
		? {
			x: numberGet(table.position.x, (index % 2) * 520),
			y: numberGet(table.position.y, Math.floor(index / 2) * 440),
		}
		: { x: (index % 2) * 520, y: Math.floor(index / 2) * 440 };
	return {
		id,
		name: String(table.name || id),
		nameLogical: String(table.nameLogical || ''),
		position,
		columnList,
	};
}

function columnNormalize(column, tableId, index) {
	if (!column || typeof column !== 'object' || Array.isArray(column)) {
		throw new Error(`columns[${index}] in table "${tableId}" must be an object.`);
	}
	const id = textRequired(column.id, `columns[${index}].id in table "${tableId}"`);
	return {
		id,
		name: String(column.name || id),
		nameLogical: String(column.nameLogical || ''),
		type: String(column.type || ''),
		key: String(column.key || ''),
	};
}

function relationshipNormalize(relationship, index, tableById) {
	if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship)) {
		throw new Error(`relationships[${index}] must be an object.`);
	}
	const id = textRequired(relationship.id, `relationships[${index}].id`);
	const source = endpointNormalize(relationship.source, `${id}.source`, tableById);
	const target = endpointNormalize(relationship.target, `${id}.target`, tableById);
	const sideDefault = relationshipSideDefaultGet(source, target, tableById);
	return {
		id,
		label: String(relationship.label || ''),
		source: { ...source, side: sideGet(source.side, sideDefault.source) },
		target: { ...target, side: sideGet(target.side, sideDefault.target) },
	};
}

function endpointNormalize(endpoint, path, tableById) {
	if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
		throw new Error(`${path} must be an object.`);
	}
	const tableId = textRequired(endpoint.tableId, `${path}.tableId`);
	const columnId = textRequired(endpoint.columnId, `${path}.columnId`);
	const table = tableById[tableId];
	if (!table) throw new Error(`${path} references unknown table "${tableId}".`);
	if (!table.columnList.some((column) => column.id === columnId)) {
		throw new Error(`${path} references unknown column "${tableId}.${columnId}".`);
	}
	return { tableId, columnId, side: endpoint.side };
}

function relationshipSideDefaultGet(source, target, tableById) {
	const xSource = tableById[source.tableId].position.x;
	const xTarget = tableById[target.tableId].position.x;
	return xSource <= xTarget
		? { source: 'right', target: 'left' }
		: { source: 'left', target: 'right' };
}

function relationshipHandleListBuild(relationshipList) {
	const result = {};
	const add = (endpoint, role) => {
		result[endpoint.tableId] ||= {};
		result[endpoint.tableId][endpoint.columnId] ||= [];
		const handleList = result[endpoint.tableId][endpoint.columnId];
		if (handleList.some((handle) => handle.role === role && handle.side === endpoint.side)) return;
		handleList.push({
			id: handleIdGet(role, endpoint.columnId, endpoint.side),
			role,
			side: endpoint.side,
		});
	};
	relationshipList.forEach((relationship) => {
		add(relationship.source, 'source');
		add(relationship.target, 'target');
	});
	return result;
}

function handleIdGet(role, columnId, side) {
	return `${role}|${columnId}|${side}`;
}

function sideGet(value, valueDefault) {
	const side = String(value || valueDefault).toLowerCase();
	if (!sideList.includes(side)) throw new Error(`Unsupported handle side "${side}". Use left or right.`);
	return side;
}

function itemByIdBuild(itemList, label) {
	const result = {};
	itemList.forEach((item) => {
		if (result[item.id]) throw new Error(`Duplicate ${label} id "${item.id}".`);
		result[item.id] = item;
	});
	return result;
}

function textRequired(value, path) {
	const text = String(value || '').trim();
	if (!text) throw new Error(`${path} is required.`);
	return text;
}

function numberGet(value, valueDefault) {
	const number = Number(value);
	return Number.isFinite(number) ? number : valueDefault;
}

export { DocDiagramERStore };

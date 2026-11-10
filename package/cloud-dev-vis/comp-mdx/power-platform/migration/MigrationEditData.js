import { yamlParse, yamlStringify } from '../../../../../main/frontend/src/lib/yaml.js';
import { nodeRegistryBuild } from '../../card-diagram/node-registry.js';
import { dataverseChoiceNodeKind, dataverseTableNodeKind, powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { operatorNodeKindList } from '../OperatorNodes.js';
import { migrationMappingColumnListOf, migrationPairGet, migrationPathBuild, migrationSegmentBuild, migrationTableListOf } from './MigrationData.js';

// How each kind of data item is edited (power-platform-migration.md#editing): an item
// becomes the YAML of a card or a diagram, the visual editor of the card diagram
// framework edits that draft, and the draft becomes the writes of the items again.
// Pure: what is written is a list the component hands to the object's api.
//
//   adapter
//     kind          'card' | 'diagram': what the editor edits
//     registryGet(model)                 the node registry of the editor
//     sourceBuild(item, model)           the draft: YAML text
//     writesBuild(raw, item, model)      { writeList, createList, removeList }
//
// a change the item cannot hold throws: the editor keeps the draft and shows why.
const numberOrText = (value) => {
	const text = String(value ?? '').trim();
	return text !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
};
const handleOf = (id, direction, side, target = 'body') => ({ id, direction, anchor: { target, side } });
const columnOfDraft = ({ nameLogical, ...column }) => ({ ...column, logical: nameLogical || column.id });
const columnToDraft = ({ logical, ...column }) => ({ ...column, nameLogical: logical ?? column.id });

// ---------- a table ----------

function schemaTableRegistryGet(model) {
	const tableKeyList = ['', ...model.tableByKey.keys()];
	const choiceKeyList = ['', ...model.choiceByKey.keys()];
	const labelOf = (map) => Object.fromEntries([...map.values()].map((item) => [item.key, `${item.db} / ${item.name} (${item.logical})`]));
	return nodeRegistryBuild({
		id: 'migration-schema-table',
		label: 'Migration table',
		kindList: [{
			...dataverseTableNodeKind,
			schema: {
				...dataverseTableNodeKind.schema,
				rowPropertyList: [
					...dataverseTableNodeKind.schema.rowPropertyList,
					{ id: 'lookup', label: 'Lookup to', kind: 'enum', values: tableKeyList, valueLabels: { '': 'None', ...labelOf(model.tableByKey) }, isSearchable: true },
					{ id: 'choice', label: 'Option set', kind: 'enum', values: choiceKeyList, valueLabels: { '': 'None', ...labelOf(model.choiceByKey) }, isSearchable: true },
				],
			},
		}],
	});
}

const adapterSchemaTable = {
	kind: 'card',
	registryGet: schemaTableRegistryGet,
	sourceBuild: (item) => yamlStringify({
		version: 1,
		node: { id: 'table', renderer: { type: 'dataverse-table' }, data: { name: item.name, nameLogical: item.logical, description: item.description ?? '', columns: item.columnList.map(columnToDraft) } },
	}),
	writesBuild: (raw, item) => {
		const { data } = yamlParse(raw).node;
		const { key, path, ...itemData } = item;
		return {
			writeList: [{
				ref: key,
				data: { ...itemData, name: data.name, logical: data.nameLogical || item.logical, description: data.description || undefined, columnList: data.columns.map(columnOfDraft) },
				note: `${item.logical}: edited`,
			}],
		};
	},
};

// ---------- an option set ----------

const choiceRegistry = nodeRegistryBuild({ id: 'migration-schema-choice', label: 'Migration option set', kindList: [dataverseChoiceNodeKind] });

const adapterSchemaChoice = {
	kind: 'card',
	registryGet: () => choiceRegistry,
	sourceBuild: (item) => yamlStringify({
		version: 1,
		node: {
			id: 'choice', renderer: { type: 'dataverse-choice' },
			data: { name: item.name, nameLogical: item.logical, description: item.description ?? '', columns: item.optionList.map((option, index) => ({ id: `option-${index}`, name: option.label, nameLogical: String(option.value), type: 'Option' })) },
		},
	}),
	writesBuild: (raw, item) => {
		const { data } = yamlParse(raw).node;
		const { key, path, ...itemData } = item;
		const optionList = data.columns.map((column) => {
			if (String(column.nameLogical ?? '').trim() === '') throw new Error(`The option "${column.name}" needs a value, in its logical name.`);
			return { value: numberOrText(column.nameLogical), label: column.name };
		});
		return { writeList: [{ ref: key, data: { ...itemData, name: data.name, logical: data.nameLogical || item.logical, optionList }, note: `${item.logical}: edited` }] };
	},
};

// ---------- a mapping of option sets ----------

const mappingKind = operatorNodeKindList.find((kind) => kind.type === 'operator-mapping');
const mappingChoiceRegistry = nodeRegistryBuild({ id: 'migration-mapping-choice', label: 'Migration option set mapping', kindList: [mappingKind] });

const adapterMappingChoice = {
	kind: 'card',
	registryGet: () => mappingChoiceRegistry,
	sourceBuild: (item) => yamlStringify({
		version: 1,
		node: {
			id: 'mapping', renderer: { type: 'operator-mapping' }, size: { width: 420, height: 'auto' },
			data: { name: item.label ?? '', rows: item.optionList.map((option, index) => ({ id: `row-${index}`, key: String(option.from), value: option.to === null || option.to === undefined ? '' : String(option.to) })) },
		},
	}),
	writesBuild: (raw, item) => {
		const { data } = yamlParse(raw).node;
		const { key, path, ...itemData } = item;
		// an empty value is a value not carried over
		const optionList = data.rows.map((row) => ({ from: numberOrText(row.key), to: String(row.value ?? '').trim() === '' ? null : numberOrText(row.value) }));
		return { writeList: [{ ref: key, data: { ...itemData, label: data.name, optionList }, note: 'option set mapping edited' }] };
	},
};

// ---------- a mapping of tables: the column mappings as lines ----------

const tableNodeOf = (table, id, x, side, handleExtra = []) => ({
	id,
	renderer: { type: 'dataverse-table' },
	position: { x, y: 0 },
	size: { width: 400, height: 'auto' },
	data: { name: table.name, nameLogical: table.logical, columns: table.columnList.map(columnToDraft) },
	handles: [...table.columnList.map((column) => handleOf(`col-${column.id}`, side === 'right' ? 'out' : 'in', side, `column/${column.id}`)), ...handleExtra],
});

const ABANDON_ID = 'operator-abandon';
const DEFAULT_PREFIX = 'operator-default-';
const COLUMN_LINE_PREFIX = 'column:';
const X_TARGET = 960;

const adapterMappingTable = {
	kind: 'diagram',
	registryGet: () => powerPlatformNodeRegistry,
	sourceBuild: (item, model) => {
		const source = model.tableByKey.get(item.source);
		const target = model.tableByKey.get(item.target);
		if (!source || !target) throw new Error('This mapping names a table that is not found.');
		const columnMappingList = migrationMappingColumnListOf(model, item);
		const yBelow = 70 + Math.max(source.columnList.length, target.columnList.length) * 33 + 62;
		const nodes = [
			tableNodeOf(source, 'source', 0, 'right'),
			tableNodeOf(target, 'target', X_TARGET, 'left'),
			{ id: ABANDON_ID, renderer: { type: 'operator-abandon' }, position: { x: 470, y: yBelow }, size: { width: 96, height: 'auto' }, data: { name: model.system.labels?.abandon ?? 'Abandon' }, handles: [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right')] },
		];
		const connections = [];
		let yDefault = yBelow;
		const lineLabel = (columnMapping) => ({ text: columnMapping.label ?? '', position: 0.5 });
		for (const columnMapping of columnMappingList) {
			const id = `${COLUMN_LINE_PREFIX}${columnMapping.key}`;
			if (columnMapping.source && columnMapping.target) connections.push({ id, source: { nodeId: 'source', handleId: `col-${columnMapping.source}` }, target: { nodeId: 'target', handleId: `col-${columnMapping.target}` }, label: lineLabel(columnMapping) });
			else if (columnMapping.source) connections.push({ id, source: { nodeId: 'source', handleId: `col-${columnMapping.source}` }, target: { nodeId: ABANDON_ID, handleId: 'left' }, label: lineLabel(columnMapping) });
			else if (columnMapping.target) {
				const nodeId = `${DEFAULT_PREFIX}${columnMapping.target}`;
				nodes.push({ id: nodeId, renderer: { type: 'operator-text' }, position: { x: 680, y: yDefault }, size: { width: 210, height: 'auto' }, data: { name: model.system.labels?.defaultValue ?? 'Default value', description: columnMapping.label ?? '' }, handles: [handleOf('right', 'out', 'right')] });
				yDefault += 100;
				connections.push({ id, source: { nodeId, handleId: 'right' }, target: { nodeId: 'target', handleId: `col-${columnMapping.target}` }, label: { text: '' } });
			}
		}
		return yamlStringify({
			version: 1,
			defaults: { connection: { renderer: { type: 'smoothstep' }, markerEnd: 'arrowClosed', style: { stroke: '#0d9488', strokeWidth: 1.25 } } },
			viewport: { size: { height: 620 } },
			nodes,
			connections,
		});
	},
	writesBuild: (raw, item, model) => {
		const doc = yamlParse(raw);
		const columnMappingList = migrationMappingColumnListOf(model, item);
		const columnMappingByKey = new Map(columnMappingList.map((columnMapping) => [columnMapping.key, columnMapping]));
		const source = model.tableByKey.get(item.source);
		const target = model.tableByKey.get(item.target);
		const pair = migrationPairGet(model, item);
		const prefix = item.key.replace(/map\.table\..*$/, '');
		const writeList = [];
		const createList = [];
		const columnKeyList = [];
		const columnOf = (endpoint) => String(endpoint?.handleId ?? '').replace(/^col-/, '');
		const seen = new Set();
		for (const connection of doc.connections ?? []) {
			const sourceColumn = connection.source?.nodeId === 'source' ? columnOf(connection.source) : null;
			const targetColumn = connection.target?.nodeId === 'target' ? columnOf(connection.target) : null;
			const isAbandon = connection.target?.nodeId === ABANDON_ID;
			const isDefault = String(connection.source?.nodeId ?? '').startsWith(DEFAULT_PREFIX);
			if (!(sourceColumn && targetColumn) && !(sourceColumn && isAbandon) && !(isDefault && targetColumn)) {
				throw new Error(`The line ${connection.id} must join a source column to a target column, or to Abandon.`);
			}
			const label = connection.label?.text ?? '';
			const key = String(connection.id).startsWith(COLUMN_LINE_PREFIX) ? String(connection.id).slice(COLUMN_LINE_PREFIX.length) : null;
			const existing = key ? columnMappingByKey.get(key) : null;
			if (existing) {
				seen.add(existing.key);
				columnKeyList.push(existing.key);
				const { key: _key, path: _path, ...columnMappingData } = existing;
				const next = { ...columnMappingData, source: isDefault ? existing.source : sourceColumn, target: isAbandon ? null : targetColumn, label: isDefault ? existing.label : label || existing.label };
				if (JSON.stringify(next) !== JSON.stringify(columnMappingData)) writeList.push({ ref: existing.key, data: next, note: 'column mapping edited' });
				continue;
			}
			const id = migrationSegmentBuild(targetColumn ?? sourceColumn);
			const keyNew = `${prefix}map.column.${pair}.${id}`;
			if (columnKeyList.includes(keyNew)) throw new Error(`Two lines would be the column mapping of ${id}.`);
			columnKeyList.push(keyNew);
			// a line drawn again where a line was removed is that column mapping, changed
			const columnMappingSame = columnMappingByKey.get(keyNew);
			if (columnMappingSame) {
				seen.add(keyNew);
				const { key: _key, path: _path, ...columnMappingData } = columnMappingSame;
				writeList.push({ ref: keyNew, data: { ...columnMappingData, source: sourceColumn, target: isAbandon ? null : targetColumn, label: label || columnMappingData.label }, note: 'column mapping edited' });
				continue;
			}
			const column = (target?.columnList ?? []).find((item2) => item2.id === targetColumn) ?? (source?.columnList ?? []).find((item2) => item2.id === sourceColumn);
			createList.push({
				key: keyNew,
				kind: 'mapping-column',
				name: column?.name ?? id,
				pathList: [migrationPathBuild(model.category, 'mapping-column', { source: source.logical, target: target.logical, id })],
				data: { id, name: column?.name ?? id, table: item.key, source: sourceColumn, target: isAbandon ? null : targetColumn, kind: isAbandon ? 'abandon' : 'copy', label: label || (isAbandon ? (model.system.labels?.abandon ?? 'Abandon') : ''), stepList: isAbandon ? [{ op: 'abandon' }] : [] },
			});
		}
		const removeList = columnMappingList.filter((columnMapping) => !seen.has(columnMapping.key)).map((columnMapping) => columnMapping.key);
		const { key, path, ...itemData } = item;
		if (JSON.stringify(columnKeyList) !== JSON.stringify(item.columnKeyList)) writeList.push({ ref: key, data: { ...itemData, columnKeyList }, note: 'column mappings changed' });
		return { writeList, createList, removeList };
	},
};

// ---------- one column ----------

const X_STEP_START = 500;
const adapterMappingColumn = {
	kind: 'diagram',
	registryGet: () => powerPlatformNodeRegistry,
	sourceBuild: (item, model) => {
		const mapping = model.mappingTableByKey.get(item.table);
		const source = model.tableByKey.get(mapping?.source);
		const target = model.tableByKey.get(mapping?.target);
		if (!source || !target) throw new Error('This column mapping names a mapping of tables that is not found.');
		const handles = [handleOf('left', 'in', 'left'), handleOf('right', 'out', 'right')];
		let x = X_STEP_START;
		const stepNodeList = item.stepList.map((step, index) => {
			const id = `step-${index}`;
			const position = { x, y: 80 };
			if (step.op === 'abandon') { x += 170; return { id, renderer: { type: 'operator-abandon' }, position, data: { name: step.name ?? 'Abandon' }, handles: [handleOf('left', 'in', 'left'), handleOf('right', 'in', 'right')] }; }
			if (step.op === 'mapping' || step.op === 'choice') {
				x += 310;
				const mappingChoice = step.op === 'choice' ? model.mappingChoiceByKey.get(step.mapping) : null;
				const rows = mappingChoice ? mappingChoice.optionList.map((option, position2) => ({ id: `o${position2}`, key: String(option.from), value: String(option.to ?? '') })) : (step.rows ?? []).map((row, position2) => ({ id: row.id ?? `r${position2}`, key: String(row.key ?? ''), value: String(row.value ?? '') }));
				return { id, renderer: { type: 'operator-mapping' }, position, data: { name: step.name ?? mappingChoice?.label ?? 'Mapping', rows, choiceMapping: step.mapping, ...(step.onMissing ? { onMissing: step.onMissing } : {}) }, handles };
			}
			x += 280;
			// an operator other than text (trim, digits, check-length ... of db-migration.project-real) is drawn
			// as a text operator and keeps the step it is, so a save writes it back with its parameters
			const stepKept = step.op && step.op !== 'text' ? step : undefined;
			return { id, renderer: { type: 'operator-text' }, position, data: { name: step.name ?? (stepKept ? step.op : ''), description: step.description ?? '', ...(stepKept ? { step: stepKept } : {}) }, handles };
		});
		const nodes = [
			tableNodeOf(source, 'source', 0, 'right'),
			...stepNodeList,
			tableNodeOf(target, 'target', Math.max(x, X_STEP_START + 240), 'left'),
		];
		const chain = stepNodeList.map((node) => [node.id, 'right', 'left']);
		const connections = [];
		let last = item.source ? { nodeId: 'source', handleId: `col-${item.source}` } : null;
		chain.forEach(([id], index) => {
			if (last) connections.push({ id: `line-${index}`, source: last, target: { nodeId: id, handleId: 'left' } });
			last = { nodeId: id, handleId: 'right' };
		});
		if (last && item.target) connections.push({ id: 'line-end', source: last, target: { nodeId: 'target', handleId: `col-${item.target}` } });
		return yamlStringify({
			version: 1,
			defaults: { connection: { renderer: { type: 'smoothstep' }, markerEnd: 'arrowClosed', style: { stroke: '#0d9488', strokeWidth: 1.5 } } },
			viewport: { size: { height: 560 } },
			nodes,
			connections,
		});
	},
	writesBuild: (raw, item) => {
		const doc = yamlParse(raw);
		const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
		const outOf = (nodeId, handleId) => (doc.connections ?? []).filter((connection) => connection.source?.nodeId === nodeId && (handleId === undefined || connection.source.handleId === handleId));
		const startList = (doc.connections ?? []).filter((connection) => connection.source?.nodeId === 'source');
		if (startList.length > 1) throw new Error('One column mapping starts from one source column.');
		const start = startList[0];
		const stepList = [];
		let target = null;
		let current = start ? start.target?.nodeId : (doc.connections ?? []).find((connection) => connection.target?.nodeId === 'target')?.source?.nodeId;
		let endpointEnd = start?.target;
		const visited = new Set();
		while (current && current !== 'target' && current !== 'source') {
			if (visited.has(current)) throw new Error('The operators of a column mapping cannot form a loop.');
			visited.add(current);
			const node = nodeById.get(current);
			if (!node) break;
			const type = node.renderer?.type;
			if (type === 'operator-abandon') { stepList.push({ op: 'abandon', name: node.data?.name }); current = null; endpointEnd = null; break; }
			if (type === 'operator-mapping') {
				const onMissing = node.data?.onMissing ? { onMissing: node.data.onMissing } : {};
				stepList.push(node.data?.choiceMapping ? { op: 'choice', mapping: node.data.choiceMapping, ...onMissing } : { op: 'mapping', name: node.data?.name, rows: (node.data?.rows ?? []).map(({ key, value }) => ({ key, value })), ...onMissing });
			} else if (type === 'operator-text') {
				const stepKept = node.data?.step;
				stepList.push(stepKept ? { ...stepKept, name: node.data?.name ?? stepKept.name, description: node.data?.description ?? stepKept.description ?? '' } : { op: 'text', name: node.data?.name ?? '', description: node.data?.description ?? '' });
			} else {
				throw new Error(`A column mapping cannot go through the node ${current}.`);
			}
			const outList = outOf(current);
			if (outList.length > 1) throw new Error(`The operator ${node.data?.name ?? current} has more than one way out: a column mapping is one chain.`);
			endpointEnd = outList[0]?.target ?? null;
			current = endpointEnd?.nodeId;
		}
		if (endpointEnd?.nodeId === 'target') target = String(endpointEnd.handleId ?? '').replace(/^col-/, '');
		const { key, path, ...itemData } = item;
		const next = {
			...itemData,
			source: start ? String(start.source.handleId ?? '').replace(/^col-/, '') : null,
			target,
			kind: target ? (stepList.length > 0 ? itemData.kind === 'copy' ? 'transform' : itemData.kind : 'copy') : 'abandon',
			stepList,
		};
		return { writeList: [{ ref: key, data: next, note: 'column mapping edited' }] };
	},
};

export const migrationEditAdapterByKind = {
	'schema-table': adapterSchemaTable,
	'schema-choice': adapterSchemaChoice,
	'mapping-table': adapterMappingTable,
	'mapping-column': adapterMappingColumn,
	'mapping-choice': adapterMappingChoice,
};

// the item of the model a key names, for its adapter
export function migrationItemOf(model, kind, key) {
	const map = { 'schema-table': model.tableByKey, 'schema-choice': model.choiceByKey, 'mapping-table': model.mappingTableByKey, 'mapping-column': model.mappingColumnByKey, 'mapping-choice': model.mappingChoiceByKey }[kind];
	return map?.get(key) ?? null;
}

// a new item of a kind, from what the form asked: { key, kind, name, pathList, data }.
// a key is built from the logical names, as the items of the seed are; it never changes after
export function migrationItemNewBuild(kind, model, form) {
	const prefix = model.category === 'example' ? 'ex' : model.category;
	const { db, logical, name, source, target } = form;
	if (kind === 'schema-table' || kind === 'schema-choice') {
		const segment = migrationSegmentBuild(logical);
		if (!segment) throw new Error('A logical name is needed.');
		const isTable = kind === 'schema-table';
		const key = `${prefix}.${db}.${isTable ? 'table' : 'choice'}.${segment}`;
		const data = isTable
			? { db, logical: segment, name: name || segment, columnList: [{ id: `${segment}id`, name: name || segment, logical: `${segment}id`, type: 'Unique identifier', key: 'PK', isRequired: true }] }
			: { db, logical: segment, name: name || segment, optionList: [{ value: 1, label: 'Option' }] };
		return { key, kind, name: name || segment, pathList: [migrationPathBuild(model.category, kind, { db, logical: segment })], data };
	}
	if (kind === 'mapping-table' || kind === 'mapping-choice') {
		const isTable = kind === 'mapping-table';
		const map = isTable ? model.tableByKey : model.choiceByKey;
		const itemSource = map.get(source);
		const itemTarget = map.get(target);
		if (!itemSource || !itemTarget) throw new Error('Choose the source and the target.');
		const pair = `${migrationSegmentBuild(itemSource.logical)}--${migrationSegmentBuild(itemTarget.logical)}`;
		const key = `${prefix}.map.${isTable ? 'table' : 'choice'}.${pair}`;
		const label = `${itemSource.name} → ${itemTarget.name}`;
		const data = isTable ? { source, target, columnKeyList: [] } : { source, target, label, optionList: itemSource.optionList.map((option) => ({ from: option.value, to: null })) };
		return { key, kind, name: label, pathList: [migrationPathBuild(model.category, kind, { source: itemSource.logical, target: itemTarget.logical })], data };
	}
	throw new Error(`An item of the kind ${kind} is not created here.`);
}

export function migrationDbListOf(model) {
	return [model.system.source, model.system.target];
}

export { migrationTableListOf };

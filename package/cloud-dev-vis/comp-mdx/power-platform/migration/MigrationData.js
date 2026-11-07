// The data items of a database migration (power-platform-migration.md): what each
// kind of item holds, how its paths are built, and the model all of them form once
// read. Pure: the items come from anywhere (the assets of a frontend object, a test).
//
//   /{category}/system                                the two databases, the tool, the words of the views
//   /{category}/schema/{db}/table/{logical}           one table
//   /{category}/schema/{db}/choice/{logical}          one option set; isGlobal: false when only one column uses it
//   /{category}/mapping/table/{source}--{target}      a pair of tables: the keys of its column mappings
//   /{category}/mapping/column/{source}--{target}/{id}  one column: how it is carried over, or abandoned
//   /{category}/mapping/choice/{source}--{target}     a pair of option sets: value to value
//   /{category}/plan                                  a note on the order of loading, batches
//   /{category}/plan-post                             what is done after the migration
//   /{category}/report/run                            what a run did
//   /{category}/report/verify                         what the check found
//   /{category}/layout                                the bounding boxes of the views
//
// the first folder is the category: `example` for small sanitized data the
// illustrations are drawn from, `real` for the data of the project. Both hold the same
// kinds; nothing reads a category by name except the block choosing it. An item names
// another by its key, which never changes, not by its path.

export const MIGRATION_KIND_LIST = ['system', 'schema-table', 'schema-choice', 'mapping-table', 'mapping-column', 'mapping-choice', 'plan', 'plan-post', 'report-run', 'report-verify', 'layout'];

export function migrationSegmentBuild(text) {
	return String(text ?? '').trim().replace(/[\s/]+/g, '-');
}

export function migrationPairBuild(source, target) {
	return `${migrationSegmentBuild(source)}--${migrationSegmentBuild(target)}`;
}

export function migrationPathBuild(category, kind, part = {}) {
	const root = `/${category}`;
	if (kind === 'system') return `${root}/system`;
	if (kind === 'schema-table') return `${root}/schema/${part.db}/table/${migrationSegmentBuild(part.logical)}`;
	if (kind === 'schema-choice') return `${root}/schema/${part.db}/choice/${migrationSegmentBuild(part.logical)}`;
	if (kind === 'mapping-table') return `${root}/mapping/table/${migrationPairBuild(part.source, part.target)}`;
	if (kind === 'mapping-column') return `${root}/mapping/column/${migrationPairBuild(part.source, part.target)}/${migrationSegmentBuild(part.id)}`;
	if (kind === 'mapping-choice') return `${root}/mapping/choice/${migrationPairBuild(part.source, part.target)}`;
	if (kind === 'plan') return `${root}/plan`;
	if (kind === 'plan-post') return `${root}/plan-post`;
	if (kind === 'report-run') return `${root}/report/run`;
	if (kind === 'report-verify') return `${root}/report/verify`;
	if (kind === 'layout') return `${root}/layout`;
	throw new Error(`No path is defined for the kind ${kind}.`);
}

export function migrationCategoryOf(path) {
	return String(path ?? '').split('/').filter(Boolean)[0] ?? '';
}

// the items of a category, from an object's asset list: an item belongs to the first
// folder of its first path. itemList: [{ key, kind, path, data }]
export function migrationModelBuild(category, itemList) {
	const model = {
		category,
		system: { source: { id: 'source', name: 'Source' }, target: { id: 'target', name: 'Target' }, tool: { name: 'Migration tool', stepList: [] }, labels: {} },
		tableByKey: new Map(),
		choiceByKey: new Map(),
		mappingTableByKey: new Map(),
		mappingColumnByKey: new Map(),
		mappingChoiceByKey: new Map(),
		plan: null,
		planPost: null,
		reportRun: null,
		reportVerify: null,
		layout: { viewByPath: {} },
		layoutKey: '',
		problemList: [],
		unverifiedList: [],
	};
	for (const item of itemList) {
		const data = item.data && typeof item.data === 'object' ? item.data : {};
		const record = { ...data, key: item.key, path: item.path };
		if (data.isUnverified) model.unverifiedList.push(item.path || item.key);
		if (item.kind === 'system') model.system = { ...model.system, ...data, key: item.key };
		else if (item.kind === 'schema-table') model.tableByKey.set(item.key, { ...record, columnList: columnListRead(record) });
		else if (item.kind === 'schema-choice') model.choiceByKey.set(item.key, { ...record, optionList: record.optionList ?? [] });
		else if (item.kind === 'mapping-table') model.mappingTableByKey.set(item.key, { ...record, columnKeyList: record.columnKeyList ?? [] });
		else if (item.kind === 'mapping-column') model.mappingColumnByKey.set(item.key, { ...record, stepList: record.stepList ?? [] });
		else if (item.kind === 'mapping-choice') model.mappingChoiceByKey.set(item.key, { ...record, optionList: record.optionList ?? [] });
		else if (item.kind === 'plan') model.plan = record;
		else if (item.kind === 'plan-post') model.planPost = record;
		else if (item.kind === 'report-run') model.reportRun = record;
		else if (item.kind === 'report-verify') model.reportVerify = record;
		else if (item.kind === 'layout') { model.layout = { viewByPath: {}, ...data }; model.layoutKey = item.key; }
	}
	migrationModelCheck(model);
	return model;
}

function columnListRead(record) {
	return (record.columnList ?? []).map((column) => ({ ...column, id: String(column.id ?? column.logical) }));
}

// what does not fit together is said, and what can be drawn is drawn
function migrationModelCheck(model) {
	const problem = (text) => model.problemList.push(text);
	for (const table of model.tableByKey.values()) {
		for (const column of table.columnList) {
			if (column.lookup && !model.tableByKey.has(column.lookup)) problem(`${table.logical}.${column.id}: the lookup names a table not found: ${column.lookup}.`);
			if (column.choice && !model.choiceByKey.has(column.choice)) problem(`${table.logical}.${column.id}: the column names an option set not found: ${column.choice}.`);
		}
	}
	for (const choice of model.choiceByKey.values()) {
		// a view of a database names both by their logical names
		if (migrationTableListOf(model, choice.db).some((table) => table.logical === choice.logical)) problem(`${choice.key}: a table of ${choice.db} has the same logical name, and its view is the one shown.`);
		if (!migrationChoiceIsGlobal(choice)) {
			const useCount = [...model.tableByKey.values()].reduce((sum, table) => sum + table.columnList.filter((column) => column.choice === choice.key).length, 0);
			if (useCount > 1) problem(`${choice.key}: isGlobal is false, but ${useCount} columns use it.`);
		}
	}
	for (const mapping of model.mappingTableByKey.values()) {
		if (!model.tableByKey.has(mapping.source)) problem(`${mapping.key}: the source table is not found: ${mapping.source}.`);
		if (!model.tableByKey.has(mapping.target)) problem(`${mapping.key}: the target table is not found: ${mapping.target}.`);
		for (const columnKey of mapping.columnKeyList) {
			if (!model.mappingColumnByKey.has(columnKey)) problem(`${mapping.key}: the column mapping is not found: ${columnKey}.`);
		}
	}
	for (const mapping of model.mappingChoiceByKey.values()) {
		if (!model.choiceByKey.has(mapping.source)) problem(`${mapping.key}: the source option set is not found: ${mapping.source}.`);
		if (!model.choiceByKey.has(mapping.target)) problem(`${mapping.key}: the target option set is not found: ${mapping.target}.`);
	}
}

export function migrationTableListOf(model, dbId) {
	return [...model.tableByKey.values()].filter((table) => table.db === dbId);
}

// an option set of its own, shared by columns, unless the item says it belongs to one column
export const migrationChoiceIsGlobal = (choice) => choice.isGlobal !== false;

export function migrationChoiceListOf(model, dbId) {
	return [...model.choiceByKey.values()].filter((choice) => choice.db === dbId);
}

// how many batches a list of them stands for: an entry may leave many out (isOmitted, count)
export function migrationBatchCountOf(batchList) {
	return (batchList ?? []).reduce((sum, batch) => sum + (batch.isOmitted ? batch.count ?? 0 : 1), 0);
}

// the columns looking up a master table: { table, column, master }, of one database
export function migrationMasterReferListOf(model, dbId) {
	return migrationTableListOf(model, dbId).flatMap((table) => table.columnList
		.filter((column) => model.tableByKey.get(column.lookup)?.isMaster)
		.map((column) => ({ table, column, master: model.tableByKey.get(column.lookup) })));
}

export function migrationMappingColumnListOf(model, mapping) {
	return mapping.columnKeyList.map((key) => model.mappingColumnByKey.get(key)).filter(Boolean);
}

export function migrationMappingTableOfPair(model, pair) {
	return [...model.mappingTableByKey.values()].find((mapping) => migrationPairGet(model, mapping) === pair);
}

export function migrationPairGet(model, mapping) {
	const source = model.tableByKey.get(mapping.source);
	const target = model.tableByKey.get(mapping.target);
	return migrationPairBuild(source?.logical ?? mapping.source, target?.logical ?? mapping.target);
}

export function migrationChoicePairGet(model, mapping) {
	const source = model.choiceByKey.get(mapping.source);
	const target = model.choiceByKey.get(mapping.target);
	return migrationPairBuild(source?.logical ?? mapping.source, target?.logical ?? mapping.target);
}

// The order of loading, from the lookups of a database: a table can load once what it
// looks up has loaded, so its rank is one past the highest rank it looks up, and a table
// looking up nothing has rank 1. Tables of one rank may load side by side. A lookup closing
// a cycle (or of a table to itself) cannot be honored by the order: it is not ranked, and
// says so (isCycle), to be filled in by a later pass.
//
//   -> { rankByKey, groupList: [{ rank, tableList }], lineList: [{ from, to, isCycle }] }
//      one line per pair of tables, however many columns look up.
export function migrationRankBuild(model, dbId) {
	const tableList = migrationTableListOf(model, dbId);
	const referOf = (table) => [...new Set(table.columnList.map((column) => column.lookup).filter((key) => key && model.tableByKey.has(key)))];
	const rankByKey = new Map();
	const cycleSet = new Set();
	const visit = (table, chain) => {
		if (rankByKey.has(table.key)) return rankByKey.get(table.key);
		let rank = 1;
		for (const key of referOf(table)) {
			if (key === table.key || chain.includes(key)) {
				cycleSet.add(`${table.key}|${key}`);
				continue;
			}
			rank = Math.max(rank, visit(model.tableByKey.get(key), [...chain, table.key]) + 1);
		}
		rankByKey.set(table.key, rank);
		return rank;
	};
	tableList.forEach((table) => visit(table, []));
	const rankMax = Math.max(0, ...rankByKey.values());
	const groupList = [];
	for (let rank = 1; rank <= rankMax; rank += 1) groupList.push({ rank, tableList: tableList.filter((table) => rankByKey.get(table.key) === rank) });
	const lineList = tableList.flatMap((table) => referOf(table).filter((key) => key !== table.key).map((key) => ({ from: table.key, to: key, isCycle: cycleSet.has(`${table.key}|${key}`) })));
	return { rankByKey, groupList, lineList };
}

// a column mapping by the segment of its path
export function migrationColumnSegmentOf(columnMapping) {
	return migrationSegmentBuild(columnMapping.id ?? String(columnMapping.path ?? '').split('/').pop());
}

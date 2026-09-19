import { load as yamlLoad } from 'js-yaml';
import { makeAutoObservable } from 'mobx';

class DiagramDataverseEntityStore {
	source = '';
	entity = null;
	loadState = { status: 'idle', message: '' };

	constructor(source = '') {
		makeAutoObservable(this, {}, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '') {
		this.source = String(source || '');
		if (!this.source.trim()) {
			this.entity = null;
			this.loadState = { status: 'empty', message: 'エンティティ定義が空です。' };
			return;
		}

		try {
			const data = yamlLoad(this.source);
			this.entity = entityNormalize(data?.entity ?? data);
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.entity = null;
			this.loadState = { status: 'error', message: String(error?.message || error) };
		}
	}
}

function entityNormalize(entity) {
	if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
		throw new Error('YAML の entity はオブジェクトで指定してください。');
	}
	const id = textRequired(entity.id, 'entity.id');
	const name = textRequired(entity.name, 'entity.name');
	const nameLogical = textRequired(entity.nameLogical, 'entity.nameLogical');
	if (!Array.isArray(entity.columns) || entity.columns.length === 0) {
		throw new Error(`entity "${id}" の columns は1件以上必要です。`);
	}
	const columnList = entity.columns.map((column, index) => columnNormalize(column, id, index));
	const idSet = new Set();
	for (const column of columnList) {
		if (idSet.has(column.id)) throw new Error(`entity "${id}" に重複した列 ID "${column.id}" があります。`);
		idSet.add(column.id);
	}
	return {
		id,
		name,
		nameLogical,
		description: String(entity.description || ''),
		columnList,
	};
}

function columnNormalize(column, entityId, index) {
	if (!column || typeof column !== 'object' || Array.isArray(column)) {
		throw new Error(`entity "${entityId}" の columns[${index}] はオブジェクトで指定してください。`);
	}
	const path = `entity "${entityId}" の columns[${index}]`;
	return {
		id: textRequired(column.id, `${path}.id`),
		name: textRequired(column.name, `${path}.name`),
		nameLogical: textRequired(column.nameLogical, `${path}.nameLogical`),
		type: textRequired(column.type, `${path}.type`),
		key: String(column.key || '').trim().toUpperCase(),
		isRequired: Boolean(column.isRequired),
		description: String(column.description || ''),
	};
}

function textRequired(value, path) {
	const text = String(value || '').trim();
	if (!text) throw new Error(`${path} は必須です。`);
	return text;
}

export { DiagramDataverseEntityStore };

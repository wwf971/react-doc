import { makeAutoObservable } from 'mobx';
import { parse as yamlParse } from 'yaml';

// ui/data store for one DocFileTree instance.
// semantic input is a "tree" node list; folder open/closed state is ui state
// owned by this store, keyed by a path-like node key.
class DocFileTreeStore {
	nodeList = [];
	isFolderOpenByKey = {};
	maxHeight = undefined;
	message = '';

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			const dataParsed = data.raw?.trim() ? yamlParse(data.raw) : data;
			if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
				throw new Error('The file tree data must be an object.');
			}
			if (!Array.isArray(dataParsed.tree)) {
				throw new Error('The file tree requires a "tree" list.');
			}
			this.nodeList = nodeListNormalize(dataParsed.tree, '');
			this.maxHeight = dataParsed.maxHeight;
			const isOpenByKey = {};
			folderOpenDefaultCollect(this.nodeList, isOpenByKey);
			this.isFolderOpenByKey = isOpenByKey;
			this.message = '';
		} catch (error) {
			this.nodeList = [];
			this.isFolderOpenByKey = {};
			this.maxHeight = undefined;
			this.message = String(error?.message ?? error);
		}
	}

	folderToggle(key) {
		this.isFolderOpenByKey[key] = !this.isFolderOpenByKey[key];
	}

	folderIsOpen(key) {
		return this.isFolderOpenByKey[key] === true;
	}
}

// node "type" is one of file / folder / project. when absent, a node with
// "children" defaults to folder and a node without "children" defaults to
// file. folder and project nodes may omit "children" (an empty folder);
// a file node cannot declare "children". key stays stable for a given tree
// shape. a "description" is either plain text (kept in descriptionText) or
// a { component, data, config } descriptor (kept in descriptionComponent).
function nodeListNormalize(nodeListRaw, keyParent) {
	return nodeListRaw.map((node, index) => {
		if (!node || typeof node !== 'object' || Array.isArray(node)) {
			throw new Error(`Node ${index + 1} under "${keyParent || 'tree'}" must be an object.`);
		}
		const name = String(node.name ?? '').trim();
		if (!name) {
			throw new Error(`Node ${index + 1} under "${keyParent || 'tree'}" requires a name.`);
		}
		const key = `${keyParent}/${index}:${name}`;
		const type = nodeTypeNormalize(node, name);
		const nodeBase = {
			name,
			key,
			type,
			...descriptionNormalize(node.description, name),
			descriptionIndent: descriptionIndentNormalize(node.descriptionIndent, name),
		};
		if (type === 'file') {
			return { ...nodeBase, isFolder: false };
		}
		if (node.children !== undefined && !Array.isArray(node.children)) {
			throw new Error(`"children" of "${name}" must be a list.`);
		}
		return {
			...nodeBase,
			isFolder: true,
			isOpenDefault: node.defaultOpen === true,
			children: nodeListNormalize(node.children ?? [], key),
		};
	});
}

function nodeTypeNormalize(node, name) {
	const type = node.type ?? (node.children === undefined ? 'file' : 'folder');
	if (type !== 'file' && type !== 'folder' && type !== 'project') {
		throw new Error(`"type" of "${name}" must be file, folder or project, got: ${String(node.type)}.`);
	}
	if (type === 'file' && node.children !== undefined) {
		throw new Error(`File node "${name}" cannot declare "children".`);
	}
	return type;
}

function descriptionNormalize(description, name) {
	if (description === undefined || description === null) {
		return { descriptionText: '', descriptionComponent: null };
	}
	if (typeof description === 'string') {
		return { descriptionText: description, descriptionComponent: null };
	}
	if (typeof description !== 'object' || Array.isArray(description)) {
		throw new Error(`"description" of "${name}" must be a string or a { component, data, config } mapping.`);
	}
	if (typeof description.component !== 'string' || !description.component.trim()) {
		throw new Error(`The component description of "${name}" requires a "component" name.`);
	}
	for (const fieldName of ['data', 'config']) {
		const fieldValue = description[fieldName];
		if (fieldValue === undefined) continue;
		if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) {
			throw new Error(`"${fieldName}" of the component description of "${name}" must be a mapping.`);
		}
	}
	return {
		descriptionText: '',
		descriptionComponent: {
			component: description.component.trim(),
			data: description.data ?? {},
			config: description.config ?? {},
		},
	};
}

function descriptionIndentNormalize(descriptionIndent, name) {
	if (descriptionIndent === undefined) return 0;
	if (!Number.isInteger(descriptionIndent) || descriptionIndent < 0) {
		throw new Error(`"descriptionIndent" of "${name}" must be a non-negative integer.`);
	}
	return descriptionIndent;
}

function folderOpenDefaultCollect(nodeList, isOpenByKey) {
	for (const node of nodeList) {
		if (!node.isFolder) continue;
		isOpenByKey[node.key] = node.isOpenDefault;
		folderOpenDefaultCollect(node.children, isOpenByKey);
	}
}

export { DocFileTreeStore };

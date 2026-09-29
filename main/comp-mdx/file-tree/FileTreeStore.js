import { makeAutoObservable } from 'mobx';
import { parse as yamlParse } from 'yaml';

// ui/data store for one FileTree instance.
// semantic input is a "tree" node list; folder open/closed state is ui state
// owned by this store, keyed by a path-like node key.
// "annotations" and "annotationStyle" are kept as authored; FileTreeOverlayStore
// interprets them, so this store never knows what an annotation means.
class FileTreeStore {
	nodeList = [];
	isFolderOpenByKey = {};
	maxHeight = undefined;
	annotationListRaw = [];
	annotationStyleRaw = {};
	message = '';

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			const dataParsed = fileTreeDataGet(data);
			if (!Array.isArray(dataParsed.tree)) {
				throw new Error('The file tree requires a "tree" list.');
			}
			const nodeList = nodeListNormalize(dataParsed.tree, '');
			nodeIdUniqueCheck(nodeList, new Set());
			this.nodeList = nodeList;
			this.maxHeight = dataParsed.maxHeight;
			this.annotationListRaw = dataParsed.annotations ?? [];
			this.annotationStyleRaw = dataParsed.annotationStyle ?? {};
			const isOpenByKey = {};
			folderOpenDefaultCollect(this.nodeList, isOpenByKey);
			this.isFolderOpenByKey = isOpenByKey;
			this.message = '';
		} catch (error) {
			this.nodeList = [];
			this.isFolderOpenByKey = {};
			this.maxHeight = undefined;
			this.annotationListRaw = [];
			this.annotationStyleRaw = {};
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

// local data comes from the yaml block (raw) or from MDX properties. with a
// component data reference, the referenced file tree is the base and local
// top-level keys override it. "tree" is replaced as a whole, never merged
// node by node, so local data usually only adjusts keys such as maxHeight.
function fileTreeDataGet(data) {
	const dataRefResolved = data.dataRefResolved;
	const dataLocal = fileTreeDataParse(data, dataRefResolved !== undefined);
	if (!dataRefResolved) return dataLocal;
	let dataReferenced;
	try {
		dataReferenced = fileTreeDataParse(dataRefResolved.data ?? {}, false);
	} catch (error) {
		throw new Error(`Referenced data ${dataRefResolved.target}: ${String(error?.message ?? error)}`);
	}
	return { ...dataReferenced, ...dataLocal };
}

function fileTreeDataParse(data, isEmptyAllowed) {
	if (!data.raw?.trim()) return data;
	const dataParsed = yamlParse(data.raw);
	if (dataParsed === null && isEmptyAllowed) return {};
	if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
		throw new Error('The file tree data must be an object.');
	}
	return dataParsed;
}

// node "type" is one of file / folder / project. when absent, a node with
// "children" defaults to folder and a node without "children" defaults to
// file. folder and project nodes may omit "children" (an empty folder);
// a file node cannot declare "children". key stays stable for a given tree
// shape. a "description" is either plain text (kept in descriptionText) or
// a { component, data, config } descriptor (kept in descriptionComponent).
// the optional "id" lets annotations refer to a node by a short stable name.
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
			id: nodeIdNormalize(node.id, name),
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

function nodeIdNormalize(id, name) {
	if (id === undefined || id === null) return '';
	if (typeof id !== 'string' || !id.trim()) {
		throw new Error(`"id" of "${name}" must be a non-empty string.`);
	}
	return id.trim();
}

function nodeIdUniqueCheck(nodeList, idSet) {
	for (const node of nodeList) {
		if (node.id) {
			if (idSet.has(node.id)) throw new Error(`Node id "${node.id}" is used more than once.`);
			idSet.add(node.id);
		}
		if (node.isFolder) nodeIdUniqueCheck(node.children, idSet);
	}
}

function folderOpenDefaultCollect(nodeList, isOpenByKey) {
	for (const node of nodeList) {
		if (!node.isFolder) continue;
		isOpenByKey[node.key] = node.isOpenDefault;
		folderOpenDefaultCollect(node.children, isOpenByKey);
	}
}

export { FileTreeStore };

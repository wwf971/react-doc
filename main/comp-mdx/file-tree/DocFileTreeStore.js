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

// a node is a folder when it declares "children" (may be an empty list);
// otherwise it is a file. key stays stable for a given tree shape.
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
		if (node.children === undefined) {
			return { name, key, isFolder: false };
		}
		if (!Array.isArray(node.children)) {
			throw new Error(`"children" of "${name}" must be a list.`);
		}
		return {
			name,
			key,
			isFolder: true,
			isOpenDefault: node.defaultOpen === true,
			children: nodeListNormalize(node.children, key),
		};
	});
}

function folderOpenDefaultCollect(nodeList, isOpenByKey) {
	for (const node of nodeList) {
		if (!node.isFolder) continue;
		isOpenByKey[node.key] = node.isOpenDefault;
		folderOpenDefaultCollect(node.children, isOpenByKey);
	}
}

export { DocFileTreeStore };

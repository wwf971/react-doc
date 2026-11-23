import { switchDocNormalize, switchPathIsWithin, switchPathLast, switchPathNormalize, switchPathParent, switchProviderFromDoc } from './SwitchData.js';
import { switchRefMap, switchRefSplit } from './SwitchRef.js';

// Sources of scenes (card-diagram-flexible-switch.md#sources-of-scenes): a viewport shows one
// namespace, a tree of paths, made of the scenes of its own document and of **mounts**, each the
// scenes of another source under a path. Every path that is a scene belongs to one source. A source
// writes paths in its own space; what it answers is translated into the viewport's (its paths, the
// menus of the path bar, every reference of its diagrams), and back when it is asked.
//
//   switchMountProviderBuild(mount, text) -> { provider, message }     a document of scenes held elsewhere
//   switchProviderCompose({ own, mountList, signature }) -> provider    own: the document's provider;
//                                                     mountList: [{ mount, provider?, message? }]
// A mount without a provider (being read, failed) is a scene at its path saying why, so the rest
// of the namespace works. Mounted scenes are read-only here: what a reader writes (a box adjusted)
// is refused with where the scene is held.
export const SWITCH_MOUNT_OUTSIDE = '~outside';

// the path of the source a path of the viewport stands for; null when it is not in the mount
export function switchMountPathToSource(mount, path) {
	const normalized = switchPathNormalize(path);
	if (!switchPathIsWithin(normalized, mount.path)) return null;
	return switchPathNormalize(`${mount.sourcePath}/${normalized.slice(mount.path.length)}`);
}

// the path of the viewport a path of the source is shown at; null when it is outside the part mounted
export function switchMountPathFromSource(mount, sourcePath) {
	const normalized = switchPathNormalize(sourcePath);
	if (!switchPathIsWithin(normalized, mount.sourcePath)) return null;
	const rest = mount.sourcePath === '/' ? normalized : normalized.slice(mount.sourcePath.length);
	return switchPathNormalize(`${mount.path}/${rest}`);
}

// the words of where a mount reads its scenes, for a reader
export function switchMountFromText(mount) {
	const asset = mount.from?.asset;
	return asset ? `${asset.store} / ${asset.name || asset.itemId}${asset.versionId && asset.versionId !== 'head' ? ` @${asset.versionId}` : ''}` : '';
}

// a document of scenes held elsewhere (the text of an asset item), as the source of a mount
export function switchMountProviderBuild(mount, text) {
	try {
		const spec = switchDocNormalize(text);
		if (spec.mountList.length) throw new Error('A document mounted here mounts other documents itself: that is not read (one level of mounts).');
		return { provider: switchProviderFromDoc(spec), spec, message: '' };
	} catch (error) {
		return { provider: null, spec: null, message: `The scenes of ${mount.path} (${switchMountFromText(mount)}) cannot be read: ${String(error?.message ?? error)}` };
	}
}

// a diagram of a mounted source, its references written in the viewport's paths
function diagramTranslate(diagram, mount) {
	return switchRefMap(diagram, (ref) => {
		const { path, suffix } = switchRefSplit(ref);
		const pathView = switchMountPathFromSource(mount, path);
		// a reference to a part of the source not mounted names nothing here, and says where it pointed
		return `${pathView ?? `${mount.path}/${SWITCH_MOUNT_OUTSIDE}${path}`}${suffix}`;
	});
}

function descTranslate(desc, mount, path) {
	if (!desc) return null;
	const next = { ...desc, path, mount: { path: mount.path, sourcePath: switchMountPathToSource(mount, path), fromText: switchMountFromText(mount) } };
	delete next.edit;
	if (desc.diagram) next.diagram = diagramTranslate(desc.diagram, mount);
	if (desc.viewList) {
		next.viewList = desc.viewList.map((view) => {
			const viewNext = { ...view };
			const descriptor = Object.getOwnPropertyDescriptor(view, 'diagram');
			// a view made when first shown stays so: translated when it is made
			if (descriptor?.get) Object.defineProperty(viewNext, 'diagram', { get: () => diagramTranslate(descriptor.get.call(view), mount), enumerable: true, configurable: true });
			else viewNext.diagram = diagramTranslate(view.diagram, mount);
			return viewNext;
		});
	}
	return next;
}

// the scene standing at a mount that has no provider (being read, failed): its words say why
function mountNoteScene(mount, message) {
	return {
		path: mount.path,
		label: mount.label || switchPathLast(mount.path),
		description: message,
		mount: { path: mount.path, sourcePath: mount.sourcePath, fromText: switchMountFromText(mount), message },
		diagram: { nodes: [{ id: 'mount-note', renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: 360, height: 'auto' }, data: { title: mount.label || mount.path, text: message, tone: 'amber' } }] },
	};
}

export function switchProviderCompose({ own, mountList = [], signature }) {
	const mountOf = path => mountList.find(entry => switchPathIsWithin(path, entry.mount.path)) ?? null;
	const ownSceneHas = path => Boolean(own.sceneGet(path));
	const provider = {
		...own,
		signature,
		mountList: mountList.map(entry => ({ ...entry.mount, message: entry.message ?? '', isRead: Boolean(entry.provider) })),
		// the mount a path of the viewport is in, with its source's path: for whoever lists scenes
		mountOf: (path) => {
			const entry = mountOf(switchPathNormalize(path));
			return entry ? { mount: entry.mount, provider: entry.provider, message: entry.message ?? '', sourcePath: switchMountPathToSource(entry.mount, path) } : null;
		},
		labelGet: (path) => {
			const entry = mountOf(path);
			if (!entry) return own.labelGet(path);
			if (entry.provider) {
				const sourcePath = switchMountPathToSource(entry.mount, path);
				if (entry.provider.sceneGet(sourcePath) || path !== entry.mount.path) return entry.provider.labelGet(sourcePath);
			}
			if (path === entry.mount.path && ownSceneHas(path)) return own.labelGet(path);
			return path === entry.mount.path ? entry.mount.label || switchPathLast(path) : switchPathLast(path);
		},
		// path '' asks for the top level, as the path bar does
		childListGet: (path) => {
			const key = path === '' ? '' : switchPathNormalize(path);
			const entry = key ? mountOf(key) : null;
			if (entry) {
				// the root of the source is its top level, which a provider is asked for with ''
				const sourceKey = switchMountPathToSource(entry.mount, key);
				const list = entry.provider ? entry.provider.childListGet(sourceKey === '/' ? '' : sourceKey).map((child) => {
					const childPath = switchMountPathFromSource(entry.mount, child.path);
					return childPath ? { ...child, path: childPath } : null;
				}).filter(Boolean) : [];
				// the own scene at the mount path (a cover of the mount) keeps its own children
				return key === entry.mount.path && ownSceneHas(key) ? [...own.childListGet(key), ...list] : list;
			}
			const list = own.childListGet(key).slice();
			// a mount right below: one more child, whether or not a scene stands at its path
			for (const item of mountList) {
				if (switchPathParent(item.mount.path) === key && !list.some(child => child.path === item.mount.path)) list.push({ path: item.mount.path, label: provider.labelGet(item.mount.path), description: item.mount.description || switchMountFromText(item.mount) });
			}
			return list;
		},
		sceneGet: (path) => {
			const normalized = switchPathNormalize(path);
			const entry = mountOf(normalized);
			if (!entry) return own.sceneGet(normalized);
			if (entry.provider) {
				const desc = entry.provider.sceneGet(switchMountPathToSource(entry.mount, normalized));
				if (desc) return descTranslate(desc, entry.mount, normalized);
			}
			// the mount path: an own scene standing there (its cover), else a note while it has no source
			if (normalized === entry.mount.path) return ownSceneHas(normalized) ? own.sceneGet(normalized) : (entry.provider ? null : mountNoteScene(entry.mount, entry.message || 'Its scenes are being read.'));
			return null;
		},
		// a box adjusted in a mounted scene is not written here: the scene is held elsewhere
		boxSave: (path, rect) => {
			const entry = mountOf(switchPathNormalize(String(path).split('@')[0]));
			if (entry && !(switchPathNormalize(path) === entry.mount.path && ownSceneHas(entry.mount.path))) return Promise.resolve({ code: -1, message: `This scene is held by ${switchMountFromText(entry.mount)}: its bounding box holds while the page is open; change it where the scene is held.` });
			return own.boxSave?.(path, rect);
		},
	};
	return provider;
}

import { makeAutoObservable, observable } from 'mobx';
import { yamlDocumentParse, yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { switchDocNormalize, switchPathNormalize } from './SwitchData.js';

// The visual edit mode of a block of scenes (card-diagram-flexible-switch.md#editing-a-block-of-scenes):
// the document of scenes is edited one diagram at a time, a scene or a view of a scene, in the
// visual editor of the framework. What is edited of each diagram is kept as a draft while another is
// opened, and the document is written again from the drafts: the scene or view a draft is of gets
// its diagram, everything else of the text stays as it was written, comments included. A scene made
// of tabs of another has no diagram of its own, and is edited through the scene it arranges.
//
//   target   { key, path, view, label, location }   key: the path, @view for a view; location: where
//                                                    its diagram is in the document
export class SwitchSceneEditStore {
	sourceInitial = '';
	targetList = [];
	targetKey = '';
	draftByKey = new Map();
	message = '';

	constructor(source) {
		makeAutoObservable(this, { sourceInitial: false, targetList: observable.ref }, { autoBind: true });
		this.sourceInitial = String(source ?? '');
		try {
			const spec = switchDocNormalize(this.sourceInitial);
			const value = yamlParse(this.sourceInitial);
			this.defaults = value.defaults;
			this.targetList = value.sceneList.flatMap((scene, sceneIndex) => {
				const path = switchPathNormalize(scene.path);
				const label = spec.sceneByPath.get(path)?.label ?? path;
				if (scene.diagram) return [{ key: path, path, view: null, label: `${path}`, title: label, diagram: scene.diagram, location: ['sceneList', sceneIndex, 'diagram'] }];
				return (scene.viewList ?? []).map((view, viewIndex) => ({ key: `${path}@${view.id}`, path, view: view.id, label: `${path} @${view.label ?? view.id}`, title: label, diagram: view.diagram, location: ['sceneList', sceneIndex, 'viewList', viewIndex, 'diagram'] }));
			});
			if (this.targetList.length === 0) this.message = 'This block has no scene with a diagram of its own to edit.';
			this.targetKey = this.targetList[0]?.key ?? '';
		} catch (error) {
			this.message = String(error?.message ?? error);
		}
	}

	get target() { return this.targetList.find((item) => item.key === this.targetKey) ?? null; }

	// the diagram of a target as the editor reads it: version 1, with the defaults of the document
	// where the diagram has none of its own (they are taken away again when it is written back)
	textOf(target) {
		if (this.draftByKey.has(target.key)) return this.draftByKey.get(target.key);
		const { diagram } = target;
		return yamlStringify({ version: 1, ...(this.defaults && !diagram.defaults ? { defaults: this.defaults } : {}), ...diagram });
	}

	targetSet(key) {
		if (this.targetList.some((item) => item.key === key)) this.targetKey = key;
	}

	draftSet(key, raw) {
		this.draftByKey.set(key, String(raw ?? ''));
	}

	// the whole document again, every draft written into the place of its diagram
	get sourceDraft() {
		if (this.draftByKey.size === 0) return this.sourceInitial;
		const document = yamlDocumentParse(this.sourceInitial);
		for (const [key, raw] of this.draftByKey) {
			const target = this.targetList.find((item) => item.key === key);
			if (!target) continue;
			const { version: _version, ...diagram } = yamlParse(raw) ?? {};
			if (!target.diagram.defaults && JSON.stringify(diagram.defaults) === JSON.stringify(this.defaults)) delete diagram.defaults;
			document.setIn(target.location, document.createNode(diagram));
		}
		return document.toString();
	}

	get isDirty() { return this.sourceDraft !== this.sourceInitial; }

	// what the page is told: the document, not the diagram of one scene
	reportOf(report) {
		return { ...report, raw: this.sourceDraft, lang: 'yaml', isDirty: this.isDirty };
	}
}

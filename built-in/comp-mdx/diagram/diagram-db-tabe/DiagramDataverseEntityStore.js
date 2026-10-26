import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { makeAutoObservable } from 'mobx';
import { dataverseStandaloneNormalize } from '../diagram-er/DiagramERData.js';

class DiagramDataverseEntityStore {
	source = '';
	entity = null;
	node = null;
	loadState = { status: 'idle', message: '' };

	constructor(source = '') {
		makeAutoObservable(this, {}, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '') {
		this.source = String(source || '');
		if (!this.source.trim()) {
			this.entity = null;
			this.node = null;
			this.loadState = { status: 'empty', message: 'エンティティ定義が空です。' };
			return;
		}

		try {
			this.node = dataverseStandaloneNormalize(yamlParse(this.source));
			this.entity = this.node.data;
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.entity = null;
			this.node = null;
			this.loadState = { status: 'error', message: String(error?.message || error) };
		}
	}
}

export { DiagramDataverseEntityStore };

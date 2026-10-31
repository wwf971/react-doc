import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { makeAutoObservable } from 'mobx';
import { cardStandaloneNormalize } from './DiagramERData.js';

// the read view of one card outside a canvas (CardStandalone.jsx): the
// authored text, normalized with the node registry of the component
class CardStandaloneStore {
	source = '';
	entity = null;
	node = null;
	loadState = { status: 'idle', message: '' };

	constructor(source = '', registry) {
		this.registry = registry;
		makeAutoObservable(this, { registry: false }, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '') {
		this.source = String(source || '');
		if (!this.source.trim()) {
			this.entity = null;
			this.node = null;
			this.loadState = { status: 'empty', message: 'The card definition is empty.' };
			return;
		}

		try {
			this.node = cardStandaloneNormalize(yamlParse(this.source), this.registry);
			this.entity = this.node.data;
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.entity = null;
			this.node = null;
			this.loadState = { status: 'error', message: String(error?.message || error) };
		}
	}
}

export { CardStandaloneStore };

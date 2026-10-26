import { makeAutoObservable } from 'mobx';
import { indexDataParse } from './IndexData.js';

class IndexStore {
	dataIndex = null;
	message = '';

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			this.dataIndex = indexDataParse(data);
			this.message = '';
		} catch (error) {
			this.dataIndex = null;
			this.message = String(error?.message ?? error);
		}
	}
}

export { IndexStore };

import { makeAutoObservable } from 'mobx';
import { docIndexDataParse } from './DocIndexData.js';

class DocIndexStore {
	dataIndex = null;
	message = '';

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			this.dataIndex = docIndexDataParse(data);
			this.message = '';
		} catch (error) {
			this.dataIndex = null;
			this.message = String(error?.message ?? error);
		}
	}
}

export { DocIndexStore };

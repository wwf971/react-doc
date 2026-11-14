import { makeAutoObservable, runInAction } from 'mobx';

// The state of one notebook block while it is on the page (doc/README.md#the-notebook): the
// partition shown, the note chosen, the note being written, the question open. It is the
// block's (useCompStateStore): it survives the popup and coming back to the document. Nothing
// here is saved; a note is written into the object through the api of the mode.
// a note is written while the document is in edit mode, whichever partition holds it
export const EDIT_MODE_MESSAGE = 'The doc must be in edit mode to add or change notes.';

export class AwsNotebookStore {
  partition = '';
  keySelected = '';
  // the dialog writing a note: a new one (key '') or the note of a key
  edit = { isOpen: false, key: '', name: '', text: '', isPending: false, message: '' };
  // the question open: 'remove:{key}', '' none
  confirm = '';
  action = { isPending: false, message: '', isError: false };

  constructor() {
    makeAutoObservable(this);
  }

  partitionSet(partition) {
    this.partition = partition;
    this.keySelected = '';
    this.confirm = '';
    this.action = { isPending: false, message: '', isError: false };
  }

  keySelect(key) {
    this.keySelected = key;
    this.confirm = '';
  }

  confirmSet(confirm) {
    this.confirm = confirm;
  }

  editOpen({ key = '', name = '', text = '' } = {}) {
    this.edit = { isOpen: true, key, name, text, isPending: false, message: '' };
  }

  editClose() {
    this.edit = { ...this.edit, isOpen: false };
  }

  editFieldSet(field, value) {
    this.edit = { ...this.edit, [field]: value };
  }

  // the note of the dialog written: a new asset of the partition shown, or the head of the note edited
  async editSubmit(service) {
    const { key, name, text } = this.edit;
    if (service.docState?.isEditing !== true) {
      this.edit = { ...this.edit, message: EDIT_MODE_MESSAGE };
      return;
    }
    if (!key && !name.trim()) {
      this.edit = { ...this.edit, message: 'Give the note a title.' };
      return;
    }
    this.edit = { ...this.edit, isPending: true, message: '' };
    const result = key
      ? await service.assetWrite(key, text)
      : await service.assetCreate({ kind: 'note', lang: 'md', name: name.trim(), text, partition: this.partition });
    runInAction(() => {
      if (result.code !== 0) {
        this.edit = { ...this.edit, isPending: false, message: result.message };
        return;
      }
      this.edit = { ...this.edit, isOpen: false, isPending: false };
      if (!key && result.data?.key) this.keySelected = result.data.key;
      this.action = { isPending: false, message: key ? 'The note was saved.' : 'The note was added.', isError: false };
    });
  }

  async remove(service, key) {
    this.confirm = '';
    if (service.docState?.isEditing !== true) {
      this.action = { isPending: false, message: EDIT_MODE_MESSAGE, isError: true };
      return;
    }
    this.action = { isPending: true, message: '', isError: false };
    const result = await service.assetRemove(key);
    runInAction(() => {
      this.action = { isPending: false, message: result.code === 0 ? 'The note was removed.' : result.message, isError: result.code !== 0 };
      if (result.code === 0 && this.keySelected === key) this.keySelected = '';
    });
  }
}

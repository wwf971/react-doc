import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable, runInAction } from 'mobx';
import { DocBlockPopupStore } from '../store/DocBlockPopupStore.ts';

// the block popup store (doc_page_impl_popup.md) against a stand-in of the
// edit layer: the popup's mode follows the edit session, changes of mode
// are serialized, and closing or navigating drops what is in flight.

const PATH = '~docs/page.md';
const SOURCE_LINE = 12;

function deferredCreate() {
  let resolve;
  const promise = new Promise((resolveOne) => {
    resolve = resolveOne;
  });
  return { promise, resolve };
}

function storesCreate({ modeList, isDocEditable = true } = {}) {
  const docStore = makeAutoObservable({ docCurrentPath: PATH });
  const editStore = makeAutoObservable({
    isAvailable: true,
    isEditMode: false,
    session: undefined,
    model: undefined,
    leaveDeferred: undefined,
    docEditGet(path) {
      return path === PATH && this.model ? { model: this.model } : undefined;
    },
    docIsEditable(path) {
      return isDocEditable && path === PATH;
    },
    blockEditModeListGet() {
      return modeList ?? [
        { id: 'cells', isDefault: true, isDisabled: false, disabledReason: '' },
        { id: 'source', isDefault: false, isDisabled: false, disabledReason: '' },
      ];
    },
    async editModeSet(isEditMode) {
      this.isEditMode = isEditMode;
      return true;
    },
    async docEditEnsure() {
      this.model = {
        blockList: [
          { index: 0, kind: 'heading' },
          { index: 1, kind: 'component', component: { compName: 'StockTable', markerLine: 4 } },
          { index: 2, kind: 'component', component: { compName: 'StockTable', markerLine: SOURCE_LINE } },
        ],
      };
    },
    async sessionBlockStart(path, blockIndex, { editModeId }) {
      this.session = { type: 'block', path, blockIndex, editModeId, status: 'editing', message: '' };
      return true;
    },
    sessionLeave() {
      this.leaveDeferred = deferredCreate();
      this.session.status = 'submitting';
      return this.leaveDeferred.promise.then((isSaved) => {
        this.leaveSettle(isSaved);
        return isSaved;
      });
    },
    leaveSettle(isSaved) {
      if (isSaved) this.session = undefined;
      else Object.assign(this.session, { status: 'error', message: 'disk full' });
    },
    async sessionCancel() {
      this.session = undefined;
      return true;
    },
  });
  const sourceStore = { configDoc: { compRegistry: { StockTable: 'specific/StockTable' } }, loadDocCount: 0, loadDocAction: null, async loadDoc() { this.loadDocCount += 1; this.loadDocAction?.(); } };
  const assetStore = { isWritable: false, writeUnavailableReason: 'The asset service layer of a built page is a read-only snapshot.' };
  const popupStore = new DocBlockPopupStore({ docStore, editStore, sourceStore, assetStore });
  popupStore.init();
  return { docStore, editStore, popupStore, sourceStore };
}

function popupOpen(popupStore, assetInfo) {
  popupStore.open({ path: PATH, sourceLine: SOURCE_LINE, compId: 'specific/StockTable', title: 'Stock', assetInfo });
}

test('Edit enters doc edit mode and opens the block the marker line names', async () => {
  const { editStore, popupStore } = storesCreate();
  popupOpen(popupStore);
  assert.equal(popupStore.mode, 'view');
  assert.equal(popupStore.editState.isEnabled, true);

  assert.equal(await popupStore.editEnter(), true);
  assert.equal(editStore.isEditMode, true);
  assert.equal(editStore.session.blockIndex, 2);
  assert.equal(editStore.session.editModeId, 'cells');
  assert.equal(popupStore.mode, 'edit');
});

test('View saves the session and stays in Edit with the failure', async () => {
  const { editStore, popupStore } = storesCreate();
  popupOpen(popupStore);
  await popupStore.editEnter();

  const leaveFailed = popupStore.viewEnter();
  assert.equal(popupStore.isBusy, true);
  assert.equal(popupStore.close(), false);
  assert.equal(await popupStore.editEnter(), false);
  editStore.leaveDeferred.resolve(false);
  assert.equal(await leaveFailed, false);
  assert.equal(popupStore.mode, 'edit');
  assert.equal(editStore.session.message, 'disk full');

  const leaveSaved = popupStore.viewEnter();
  editStore.leaveDeferred.resolve(true);
  assert.equal(await leaveSaved, true);
  assert.equal(popupStore.mode, 'view');
  assert.ok(popupStore.isOpen);
});

test('Cancel drops the session and returns to View; close keeps a session open', async () => {
  const { editStore, popupStore } = storesCreate();
  popupOpen(popupStore);
  await popupStore.editEnter();
  assert.equal(await popupStore.editCancel(), true);
  assert.equal(popupStore.mode, 'view');
  assert.equal(editStore.session, undefined);

  await popupStore.editEnter();
  assert.equal(popupStore.close(), true);
  assert.equal(popupStore.isOpen, false);
  assert.equal(editStore.session.blockIndex, 2);
});

test('navigation closes the popup and drops an Edit entry in flight', async () => {
  const { docStore, editStore, popupStore } = storesCreate();
  popupOpen(popupStore);
  const entering = popupStore.editEnter();
  runInAction(() => {
    docStore.docCurrentPath = '~docs/other.md';
  });
  assert.equal(popupStore.isOpen, false);
  assert.equal(await entering, false);
  assert.equal(editStore.session, undefined);
});

test('Edit is not offered without an edit api, and disabled where nothing can be written', async () => {
  const { editStore, popupStore } = storesCreate();
  runInAction(() => {
    editStore.isAvailable = false;
  });
  popupOpen(popupStore);
  assert.equal(popupStore.editState.isOffered, false);

  const readOnly = storesCreate();
  popupOpen(readOnly.popupStore, { isFromAsset: true, isHead: true });
  assert.deepEqual(readOnly.popupStore.editState, {
    isOffered: true,
    isEnabled: false,
    reason: 'The asset service layer of a built page is a read-only snapshot.',
  });
  assert.equal(await readOnly.popupStore.editEnter(), false);

  const locked = storesCreate({ modeList: [{ id: 'sheet', isDefault: true, isDisabled: true, disabledReason: 'the asset is locked' }] });
  popupOpen(locked.popupStore);
  await locked.editStore.docEditEnsure();
  assert.equal(locked.popupStore.editState.isEnabled, false);
  assert.equal(locked.popupStore.editState.reason, 'the asset is locked');

  const notEditable = storesCreate({ isDocEditable: false });
  popupOpen(notEditable.popupStore);
  assert.equal(notEditable.popupStore.editState.isEnabled, false);
});

test('the last surface registered under the popup key is the one shown', () => {
  const { popupStore } = storesCreate();
  const key = `${PATH}#${SOURCE_LINE}#specific/StockTable`;
  const tokenView = popupStore.surfaceRegister(key);
  const tokenOther = popupStore.surfaceRegister(`${PATH}#4#specific/StockTable`);
  popupOpen(popupStore);
  popupStore.slotElementSet({});
  assert.equal(popupStore.surfaceIsInPopup(tokenView), true);
  assert.equal(popupStore.surfaceIsInPopup(tokenOther), false);

  const tokenEdit = popupStore.surfaceRegister(key);
  assert.equal(popupStore.surfaceIsInPopup(tokenView), false);
  assert.equal(popupStore.surfaceIsInPopup(tokenEdit), true);
  popupStore.surfaceUnregister(tokenEdit);
  assert.equal(popupStore.surfaceIsInPopup(tokenView), true);
});

test('a dialog whose block is gone reloads the document and finds it again under another key', async () => {
  const { popupStore, sourceStore } = storesCreate();
  const info = { path: PATH, compId: 'specific/StockTable', title: 'Sales' };
  popupStore.open({ path: PATH, sourceLine: SOURCE_LINE, compId: info.compId, title: info.title });
  assert.equal(popupStore.surfaceActiveToken, undefined);
  // another block of that document and component, of another title, is not it
  popupStore.surfaceRegister(`${PATH}#40#specific/StockTable`, { ...info, title: 'Other', sourceLine: 40 });
  let token;
  // the document rendered anew brings the block back, a line further down, and one more far away
  sourceStore.loadDocAction = () => {
    popupStore.surfaceRegister(`${PATH}#90#specific/StockTable`, { ...info, sourceLine: 90 });
    token = popupStore.surfaceRegister(`${PATH}#13#specific/StockTable`, { ...info, sourceLine: 13 });
  };
  assert.equal(await popupStore.surfaceReload(), true);
  assert.equal(sourceStore.loadDocCount, 1);
  assert.equal(popupStore.surfaceActiveToken, token);
  assert.equal(popupStore.isSurfaceReloading, false);
  assert.equal(popupStore.popup.message, '');
  // with the surface there, it does nothing
  assert.equal(await popupStore.surfaceReload(), true);
  assert.equal(sourceStore.loadDocCount, 1);
});

test('a surface of the same block does not pull a dialog by itself, and a block not found is said', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { popupStore } = storesCreate();
  const info = { path: PATH, compId: 'specific/StockTable', title: 'Sales' };
  popupStore.open({ path: PATH, sourceLine: SOURCE_LINE, compId: info.compId, title: info.title });
  popupStore.surfaceRegister(`${PATH}#99#specific/StockTable`, { ...info, title: 'Other' });
  assert.equal(popupStore.surfaceActiveToken, undefined);
  const result = popupStore.surfaceReload();
  assert.equal(popupStore.isSurfaceReloading, true);
  await Promise.resolve(); await Promise.resolve();
  context.mock.timers.tick(5000);
  assert.equal(await result, false);
  assert.match(popupStore.popup.message, /could not be found/);
  assert.equal(popupStore.isSurfaceReloading, false);
});

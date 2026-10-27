import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocSourceFileStore } from '../store/DocSourceFileStore.ts';
import { StoreContext } from '../store/context.js';
import { SourceFilePrompt } from '../../../comp-doc/source/SourceFilePrompt.jsx';
import { EDIT_POPUP_CLASS } from '../../../comp-doc/edit/use-edit-outside-pointer.js';

// the file-creation service with its location prompt (DocSourceFileStore,
// doc_page_impl_source.md#creating-files), driven as the Image paste flow
// drives it: the request waits while the person chooses a folder, every
// write goes through the source store with the write fields only, and the
// prompt belongs to the editor of the requesting component.

function sourceStoreCreate({ fileCreate } = {}) {
  const writeList = [];
  return {
    writeList,
    isWritable: true,
    dirListWritable: [{ internalPath: '~docs:docs/image' }, { internalPath: '~docs:docs/asset' }],
    pathFullGet: (text, fromPath) => (text.startsWith('~') && !text.includes(':') ? `~docs:${text.slice(1)}` : text),
    fileNameUniqueGet: (dirPath, name) => name,
    fileCreate: fileCreate ?? (async (input) => {
      writeList.push(input);
      return { code: 0, data: { path: `${input.dirPath}/${input.name}`, entry: { internalPath: `${input.dirPath}/${input.name}` } } };
    }),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a chosen folder is normalized, and the write carries the blob and the name only', async () => {
  const sourceStore = sourceStoreCreate();
  const store = new DocSourceFileStore(sourceStore);
  const blob = new Blob(['png'], { type: 'image/png' });
  const anchorElement = { tag: 'figure' };
  const pending = store.fileCreateRequestHandle({ name: 'shot.png', blob, dirPath: '~docs/image', isLocationCustom: true, anchorElement }, { clientX: 10, clientY: 20 }, '~docs:docs/page.md');
  await tick();
  assert.equal(store.prompt?.status, 'open');
  assert.equal(store.prompt.dirPath, '~docs:docs/image');
  // the anchor the request gave is kept on the prompt, as given
  assert.equal(store.prompt.anchorElement, anchorElement);
  store.promptDirPathSet('~docs:docs/asset/');
  assert.equal(store.prompt.dirPath, '~docs:docs/asset');
  store.promptNameSet(' renamed.png ');
  store.promptConfirm();
  const result = await pending;
  assert.equal(result.code, 0);
  assert.equal(result.data.path, '~docs:docs/asset/renamed.png');
  assert.equal(store.prompt, undefined);
  assert.equal(sourceStore.writeList.length, 1);
  assert.deepEqual(Object.keys(sourceStore.writeList[0]).sort(), ['blob', 'dirPath', 'name', 'text']);
  assert.equal(sourceStore.writeList[0].blob, blob);
  assert.equal('anchorElement' in sourceStore.writeList[0], false);
});

test('a folder that is not one of the source is refused in the prompt and can be corrected', async () => {
  const sourceStore = sourceStoreCreate();
  const store = new DocSourceFileStore(sourceStore);
  const pending = store.fileCreateRequestHandle({ name: 'a.png', text: 'x', dirPath: '~docs/image', isLocationCustom: true });
  await tick();
  store.promptDirPathSet('~docs:docs/nowhere');
  store.promptConfirm();
  assert.equal(store.prompt.status, 'error');
  assert.match(store.prompt.message, /not a folder of the source/);
  assert.equal(sourceStore.writeList.length, 0);
  store.promptDirPathSet('~docs:docs/image');
  assert.equal(store.prompt.status, 'open');
  store.promptConfirm();
  assert.equal((await pending).code, 0);
  assert.equal(sourceStore.writeList[0].dirPath, '~docs:docs/image');
});

test('a failed write keeps the prompt open with the message, and the next confirmation tries again', async () => {
  let isFailing = true;
  const sourceStore = sourceStoreCreate({
    fileCreate: async (input) => {
      sourceStore.writeList.push(input);
      if (isFailing) return { code: -1, message: 'disk full' };
      return { code: 0, data: { path: `${input.dirPath}/${input.name}`, entry: {} } };
    },
  });
  const store = new DocSourceFileStore(sourceStore);
  const pending = store.fileCreateRequestHandle({ name: 'a.png', text: 'x', dirPath: '~docs/image', isLocationCustom: true });
  await tick();
  store.promptConfirm();
  await tick();
  assert.equal(store.prompt?.status, 'error');
  assert.equal(store.prompt.message, 'disk full');
  isFailing = false;
  store.promptConfirm();
  assert.equal((await pending).code, 0);
  assert.equal(sourceStore.writeList.length, 2);
  assert.equal(store.prompt, undefined);
});

test('dismissing the prompt answers the request with a failure and writes nothing', async () => {
  const sourceStore = sourceStoreCreate();
  const store = new DocSourceFileStore(sourceStore);
  const pending = store.fileCreateRequestHandle({ name: 'a.png', text: 'x', dirPath: '~docs/image', isLocationCustom: true });
  await tick();
  store.promptCancel();
  const result = await pending;
  assert.equal(result.code, -1);
  assert.match(result.message, /no folder was chosen/);
  assert.equal(sourceStore.writeList.length, 0);
});

test('a rooted folder without a custom location writes at once, without a prompt', async () => {
  const sourceStore = sourceStoreCreate();
  const store = new DocSourceFileStore(sourceStore);
  const result = await store.fileCreateRequestHandle({ name: 'a.png', text: 'x', dirPath: '~docs/image', anchorElement: { tag: 'figure' } });
  assert.equal(result.code, 0);
  assert.equal(store.prompt, undefined);
  assert.equal('anchorElement' in sourceStore.writeList[0], false);
});

test('the rendered prompt is marked as a popup of the editor that requested the file', async () => {
  const sourceStore = sourceStoreCreate();
  const sourceFileStore = new DocSourceFileStore(sourceStore);
  void sourceFileStore.fileCreateRequestHandle({ name: 'a.png', text: 'x', dirPath: '~docs/image', isLocationCustom: true });
  await tick();
  const stores = {
    sourceFileStore,
    sourceStore: { ...sourceStore, pathComplete: () => [], pathMissingWarningGet: () => '', dirTreeGet: () => [], folderTree: [] },
  };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: stores }, createElement(SourceFilePrompt)));
  assert.match(html, /role="dialog"/);
  assert.match(html, new RegExp(`class="[^"]*doc-source-prompt[^"]*${EDIT_POPUP_CLASS}`));
  sourceFileStore.promptCancel();
});

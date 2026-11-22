import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedPathBuild, embedPathParse, embedTextHashGet } from './doc-edit-embed.js';

test('the path of a document embedded in a block of another one', () => {
  const path = embedPathBuild('~docs:docs/a/guide.md', 14);
  assert.equal(path, '~docs:docs/a/guide.md::embed@14');
  assert.deepEqual(embedPathParse(path), { hostPath: '~docs:docs/a/guide.md', line: 14 });
  assert.equal(embedPathParse('~docs:docs/a/guide.md'), undefined);
  assert.equal(embedPathParse('x::embed@zero'), undefined);
  assert.notEqual(embedTextHashGet('a'), embedTextHashGet('b'));
  assert.equal(embedTextHashGet('abc'), embedTextHashGet('abc'));
});

test('the title of an MDX block: written on its marker, as a marker can hold it', async () => {
  const { codeMarkerPropsSet } = await import('./doc-edit-code.js');
  const { markerValueNormalize } = await import('./doc-edit-block.js');
  const block = '  <!--renderComp=Mdx,view=icon,title=Notes-->\n  ```md\n  text\n  ```';
  assert.deepEqual(codeMarkerPropsSet(block, { title: 'Steps' }), { code: 0, message: '', data: '  <!--renderComp=Mdx,view=icon,title=Steps-->\n  ```md\n  text\n  ```' });
  assert.equal(codeMarkerPropsSet(block, { title: '' }).data.split('\n')[0], '  <!--renderComp=Mdx,view=icon-->');
  assert.equal(codeMarkerPropsSet('<!--renderComp=Mdx-->\n```md\n```', { title: 'A' }).data.split('\n')[0], '<!--renderComp=Mdx,title=A-->');
  assert.equal(codeMarkerPropsSet('```md\n```', { title: 'A' }).code, -1);
  assert.equal(markerValueNormalize(' Weekly steps, in order --> now \n'), 'Weekly steps in order - now');
});

test('the popup of an MDX block: the page\'s, kept current by the block, in View or Edit', async () => {
  const { DocEmbedPopupStore } = await import('../store/DocEmbedPopupStore.ts');
  const written = [];
  const editStore = {
    isEditMode: false,
    isAvailable: true,
    docIsEditable: () => true,
    editModeSet: async (isOn) => { editStore.isEditMode = isOn; return true; },
    mdxEmbedTitleSet: async (path, line, title) => { written.push([path, line, title]); return { code: 0, message: '', data: { title } }; },
  };
  const store = new DocEmbedPopupStore({ editStore });
  store.open({ key: 'k1', hostPath: '~a:a.md', line: 4, title: 'Notes', raw: 'x', Renderer: undefined });
  assert.equal(store.popup.mode, 'view');
  assert.equal(store.path, '~a:a.md::embed@4');
  assert.equal(store.isOpenFor('k1'), true);
  // the block drew itself again: only the block that opened it updates it
  store.update('k2', { title: 'Other', raw: 'y', line: 4, Renderer: undefined });
  assert.equal(store.popup.title, 'Notes');
  store.update('k1', { title: 'Notes', raw: 'x2', line: 4, Renderer: undefined });
  assert.equal(store.popup.raw, 'x2');
  // Edit turns the page's edit mode on
  await store.modeSet('edit');
  assert.equal(editStore.isEditMode, true);
  assert.equal(store.isEditShown, true);
  await store.titleSave('Steps');
  assert.deepEqual(written, [['~a:a.md', 4, 'Steps']]);
  assert.equal(store.popup.title, 'Steps');
  store.close();
  assert.equal(store.popup, undefined);
  // opened while the page is edited: in Edit
  store.open({ key: 'k1', hostPath: '~a:a.md', line: 4, title: '', raw: '', Renderer: undefined });
  assert.equal(store.popup.mode, 'edit');
});

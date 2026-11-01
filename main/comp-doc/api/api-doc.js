import { FileText, ListIcon, SquarePen } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { assetRefLangIs, assetRefParse } from '../../frontend/src/lib/doc-asset-ref.js';

// The apis of the document and its blocks (doc_page_impl_api.md#the-apis-of-a-document):
// what the page knows of the current document, and the blocks of a
// document as the edit layer models them (doc_page_impl_edit.md#the-block-model),
// read and written. the writes are the writes of the edit layer (a
// session left, an insert, a delete, a data replacement through the event
// layer), so a change made through an api is a change the author could
// have made, recorded in the same history.
//
// locating a block ("block" param): its index in the document's root-level
// blocks, or the id of its component (the `id=` of its marker, the identity
// dataRef uses); without it, the block the author is at (the open session's,
// else the selection's first)

// the edit layer's model of a document: read with the edit api of the
// development server, compiled once per text. answers { path, model, hash }
// or { message }
export async function docModelEnsure(context, docParam) {
  const { stores } = context;
  const { editStore, envStore } = stores;
  const path = docPathResolve(context, docParam);
  if (!path) return { message: docParam ? `no document of the source matches ${docParam}` : 'no document is shown' };
  if (!editStore.isAvailable) return { message: `the blocks of a document are read through the edit api: ${envStore.reasonGet('edit')}` };
  await editStore.docEditEnsure(path);
  const state = editStore.docEditGet(path);
  if (!state) return { message: `${path} could not be read` };
  if (state.status === 'error') return { message: `${path} does not compile: ${state.message}` };
  if (!state.model) return { message: `${path} has no block model` };
  return { path, model: state.model, hash: state.hash };
}

// a document param (any link target form) to its source path; the current
// document without one
export function docPathResolve(context, docParam) {
  const { sourceStore } = context.stores;
  if (docParam === undefined || docParam === '') return context.doc?.path ?? '';
  return sourceStore.fileResolve(String(docParam), context.doc?.path ?? '')?.internalPath ?? '';
}

// the block a param names; answers { block, index } or { message }
export function blockLocate(model, blockParam) {
  const blockList = model.blockList;
  if (blockParam === undefined || blockParam === null || blockParam === '') return { message: 'no block is named, and the author is at none' };
  if (typeof blockParam === 'number' || /^\d+$/.test(String(blockParam))) {
    const index = Number(blockParam);
    const block = blockList[index];
    return block ? { block, index } : { message: `no block ${index} (the document has ${blockList.length})` };
  }
  const id = String(blockParam);
  const index = blockList.findIndex((block) => String(block.component?.props?.id ?? '') === id);
  if (index === -1) return { message: `no component block has the id ${id}` };
  return { block: blockList[index], index };
}

// a block as an api answers it
export function blockInfoBuild(block) {
  return {
    index: block.index,
    kind: block.kind,
    lineStart: block.lineStart,
    lineEnd: block.lineEnd,
    compName: block.component?.compName ?? '',
    id: block.component?.props?.id ?? '',
    props: block.component?.props ?? {},
    lang: block.component?.lang ?? '',
    isAssetRef: Boolean(block.component && assetRefLangIs(block.component.lang)),
    textPreview: block.text.split('\n')[0].slice(0, 120),
  };
}

// the data of a component block: the text of its fenced block, or, for an
// asset reference, the text of the referenced version (loaded now)
export async function blockDataGet(context, block) {
  const { assetStore } = context.stores;
  const component = block.component;
  if (!component) return { raw: undefined, asset: undefined };
  if (!assetRefLangIs(component.lang)) return { raw: component.raw, asset: undefined };
  const ref = assetRefParse(component.raw);
  if (ref.message) return { message: ref.message };
  await assetStore.refLoad(ref);
  const result = assetStore.refQuery(ref);
  if (result.status !== 'done') return { message: result.message || `the asset of the block is ${result.status}` };
  const asset = {
    store: ref.store,
    objectId: result.object?.objectId ?? ref.objectId,
    name: result.object?.name ?? ref.name,
    versionIdRef: ref.versionId,
    versionId: result.versionId,
    versionIdHead: result.object?.versionIdHead,
    hash: result.version?.hash ?? '',
    isHead: ref.versionId === 'head',
  };
  return { raw: result.version?.text, asset };
}

const docParam = { name: 'doc', type: 'sourcePath', pathSpec: { kind: 'file' }, description: 'the document, as a link target; the current one when absent' };
const blockParam = { name: 'block', type: 'any', description: 'the block: its index, or the id of its component; the block the author is at when absent' };

export const apiByIdDoc = {
  'doc/currentGet': apiDefine({
    label: 'Current document',
    description: 'The document shown now, its doc page and whether it is editable.',
    icon: FileText,
    palette: false,
    run: (context) => {
      const { docStore, editStore } = context.stores;
      if (!context.doc) return { code: -1, message: 'no document is shown' };
      return {
        ...context.doc,
        docPage: context.docPage,
        route: docStore.routeCurrentPath,
        itemId: docStore.itemCurrentId,
        isEditable: editStore.isAvailable && editStore.docIsEditable?.(context.doc.path) !== false,
        isEditMode: editStore.isEditMode,
      };
    },
  }),
  'doc/listGet': apiDefine({
    label: 'Documents of the workspace',
    description: 'Every md / mdx document of the source, with its title and whether the side panel reaches it.',
    icon: ListIcon,
    palette: false,
    paramList: [{ name: 'docPage', type: 'string', description: 'only the documents of this doc page (its alias)' }],
    run: ({ stores }, { docPage }) => {
      const { sourceStore, docStore } = stores;
      return sourceStore.fileManifest
        .filter((entry) => (entry.ext === 'md' || entry.ext === 'mdx') && (!docPage || entry.docPageAlias === docPage))
        .map((entry) => ({
          path: entry.internalPath,
          title: entry.title,
          docPageAlias: entry.docPageAlias,
          isInSidePanel: docStore.routeForDoc(entry.internalPath) !== '',
        }));
    },
  }),
  'doc/blockListGet': apiDefine({
    label: 'Blocks of a document',
    description: 'The root-level blocks of a document as the edit layer models them: kind, lines, component, id.',
    icon: ListIcon,
    palette: false,
    paramList: [docParam],
    run: async (context, { doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      return { path: ensured.path, hash: ensured.hash, blockList: ensured.model.blockList.map(blockInfoBuild) };
    },
  }),
  'doc/blockGet': apiDefine({
    label: 'A block of a document',
    description: 'One block with its text, and for a component block its data (the referenced asset read).',
    icon: FileText,
    palette: false,
    paramList: [blockParam, docParam],
    run: async (context, { block, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      const data = await blockDataGet(context, located.block);
      if (data.message) return { code: -1, message: data.message };
      return { path: ensured.path, hash: ensured.hash, ...blockInfoBuild(located.block), text: located.block.text, raw: data.raw, asset: data.asset };
    },
  }),
  'doc/blockDataSet': apiDefine({
    label: 'Replace the data of a component block',
    description: 'Writes the complete new data text of a component block: into the document when the data is inline, into the head of its asset object when the block is a reference (dataReplaceRequest).',
    icon: SquarePen,
    palette: false,
    paramList: [{ name: 'raw', type: 'string', isRequired: true, description: 'the new data text' }, blockParam, docParam],
    isAvailable: ({ stores }) => stores.editStore.isAvailable || stores.envStore.reasonGet('edit'),
    run: async (context, { raw, block, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      if (!located.block.component) return { code: -1, message: `block ${located.index} is not a component block` };
      const data = await blockDataGet(context, located.block);
      if (data.message) return { code: -1, message: data.message };
      return context.eventDispatch('dataReplaceRequest', { raw }, {
        sourcePath: ensured.path,
        blockIndex: located.index,
        compId: context.stores.sourceStore.configDoc.compRegistry?.[located.block.component.compName] ?? located.block.component.compName,
        asset: data.asset ? { isFromAsset: true, ...data.asset } : undefined,
      });
    },
  }),
  'doc/blockTextSet': apiDefine({
    label: 'Replace the text of a block',
    description: 'Rewrites the lines of one block, as an edit session typed and saved would.',
    icon: SquarePen,
    palette: false,
    paramList: [{ name: 'text', type: 'string', isRequired: true, description: 'the new source of the block' }, blockParam, docParam],
    isAvailable: ({ stores }) => {
      if (!stores.editStore.isAvailable) return stores.envStore.reasonGet('edit');
      return stores.editStore.isEditMode || 'the page is not in edit mode';
    },
    run: async (context, { text, block, doc }) => {
      const { editStore } = context.stores;
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      const isStarted = await editStore.sessionBlockStart(ensured.path, located.index, { editModeId: 'source' });
      if (!isStarted) return { code: -1, message: `block ${located.index} cannot be edited as source` };
      editStore.sessionTextSet(text);
      const isLeft = await editStore.sessionLeave();
      if (!isLeft) return { code: -1, message: editStore.session?.message || 'the text was not saved' };
      return { path: ensured.path, blockIndex: located.index };
    },
  }),
  'doc/blockInsert': apiDefine({
    label: 'Insert blocks',
    description: 'Inserts Markdown / MDX text as blocks at a border of the document (0: before the first block; the block count: at the end).',
    icon: SquarePen,
    palette: false,
    paramList: [
      { name: 'text', type: 'string', isRequired: true, description: 'the source of the blocks' },
      { name: 'borderIndex', type: 'number', description: 'where: before block n; at the end when absent' },
      docParam,
    ],
    isAvailable: ({ stores }) => stores.editStore.isAvailable || stores.envStore.reasonGet('edit'),
    run: async (context, { text, borderIndex, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const border = borderIndex ?? ensured.model.blockList.length;
      if (border < 0 || border > ensured.model.blockList.length) return { code: -1, message: `borderIndex must be 0..${ensured.model.blockList.length}` };
      return context.stores.editStore.blockListInsert(ensured.path, border, text);
    },
  }),
  'doc/blockDelete': apiDefine({
    label: 'Delete a block',
    description: 'Removes one block from the document (its asset object stays).',
    icon: SquarePen,
    palette: false,
    paramList: [blockParam, docParam],
    isAvailable: ({ stores }) => stores.editStore.isAvailable || stores.envStore.reasonGet('edit'),
    run: async (context, { block, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      return context.stores.editStore.blockListDelete(ensured.path, ensured.hash, [located.index]);
    },
  }),
};

import { observer } from 'mobx-react-lite';
import { itemBlockInfoIsText } from '../../frontend/src/lib/doc-edit-list.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../registry/comp-registry.js';
import { compDefinitionGet } from '../registry/comp-definition.js';
import { COMP_EDIT_MODE_SOURCE_ID, compBlockLabelGet, compMetaGet } from '../registry/comp-expose.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';
import { assetRefLangIs } from '../../frontend/src/lib/doc-asset-ref.js';

// The editor of the open session, chosen by the edit mode the session was
// opened in (session.editModeId, doc_page_impl_edit.md#component-edit-mode):
//
//   a component block in one of the modes its component exposes
//     -> the component itself, rendered as in the document (placement
//        commentBlock, same data) but with config.isEdit = true and
//        config.edit.modeId = the mode, so it renders its XxxEdit of that mode.
//        a block of an isAssetOnly component is a reference into the asset
//        store; rendered through it (CompAssetHost), the component edits
//        the asset's data, reported with event.source.asset and saved into
//        the asset (doc_page_impl_edit.md#asset-only-components)
//   a block in the built-in mode 'source' (the lines of the block as written;
//   the only mode of a block without a component, and of a component block
//   whose data is a reference into the asset service layer, which is changed through
//   the asset panel, doc_page_impl_asset.md#edit-mode)
//     -> the default editor of the block kind: the registered components
//        Heading / Paragraph / List, or BlockSource for every other kind
//   one item of a list block (session.type 'item')
//     -> the registered component ListItem: the own text of the item, in the
//        type of the list (doc_page_impl_edit_structure.md#editing-an-item)
//   the frontmatter, the whole document
//     -> BlockSource, with its surface in the floating panel (there is no
//        place in the body where they are displayed)
//
// the store has already checked that the mode is one the block has
// (DocEditStore.sessionBlockStart), so a component block in a mode other
// than 'source' always has a definition that exposes it.
//
// every editor edits the block in its place and floats its controls
// (doc_page_impl_edit.md#no-jitter-rule). it receives config.edit =
// { session, block, format, sourcePath, label, modeId, viewRendered,
// isSurfaceFloating, submitPrepareSet, receiverSet, slash } and reports through events (editDraftChange,
// editTextSetRequest, editSubmitRequest, editCancelRequest,
// editFocusShiftRequest); the event layer routes them to
// DocEditStore.eventHandle. the session draft is what a leave saves, so an
// editor reports every change of its draft: text editors as { text }, a
// component's own editor as { raw, props }, rebuilt into the block text by
// the store. an editor whose draft is not complete until it acts (an open
// cell editor) registers that act with submitPrepareSet(handler); every
// save awaits it first (DocEditStore.sessionSubmitPrepareSet). an editor
// that takes events from the page (a text pasted into it: pasteRequest)
// registers a receiver with receiverSet(handler, { typeList }) and answers
// each event { code: 0 } or { code: -1, message } (sessionReceiverSet).
//
// a block in the built-in mode 'source' gets config.edit.slash when it
// offers the slash mode (doc_page_impl_edit_slash.md#which-blocks-offer-it):
// the component of a component block decides, else the default editor of
// the block kind (Paragraph and List do); the frontmatter and the whole
// document never.
//
//   block         the block of a block session
//   viewRendered  the block as the body rendered it, for editors that keep a
//                 rendered part in the flow
export const DocEditBlockEditor = observer(function DocEditBlockEditor({ block, viewRendered }) {
  const stores = useDocStores();
  const { compById, editStore, objectStore, slashStore, sourceStore } = stores;
  const { path, format } = useDocEditDoc();
  const session = editStore.session;
  if (!session || session.path !== path) return null;

  const configEdit = {
    isEdit: true,
    sourcePath: path,
    edit: {
      session,
      block,
      format,
      sourcePath: path,
      label: sessionLabelGet(session, block, stores),
      modeId: session.editModeId,
      viewRendered,
      // the frontmatter and the whole file are not blocks of the body
      isSurfaceFloating: session.type === 'frontmatter' || session.type === 'document',
      submitPrepareSet: (handler) => editStore.sessionSubmitPrepareSet(session, handler),
      receiverSet: (handler, option) => editStore.sessionReceiverSet(session, handler, option),
      slash: undefined,
      // the kind of the surface, when it is not the kind of the block
      kindSurface: undefined,
    },
  };

  const component = session.type === 'block' ? block?.component : undefined;
  if (component && session.editModeId !== COMP_EDIT_MODE_SOURCE_ID) {
    const compId = compIdResolve(sourceStore.configDoc, component.compName);
    const definition = compDefinitionNormalize(compDefinitionGet(compById, compId));
    if (definition) {
      return (
        <RegisteredComp
          compDefinition={definition}
          compId={compId}
          compName={component.compName}
          configRuntime={{
            ...configEdit,
            instanceId: `edit:${path}:${block.index}`,
            blockIndex: block.index,
            sourceLine: component.markerLine,
          }}
          input={{ lang: component.lang, propsAuthored: component.props ?? {}, raw: component.raw }}
          placement="commentBlock"
        />
      );
    }
  }

  const isItem = session.type === 'item';
  // an item that is a text block is edited as its lines, in the type of the block
  if (isItem) configEdit.edit.kindSurface = session.itemFormat === 'block' ? 'listItemBlock' : 'listItem';
  const compName = isItem
    ? 'ListItem'
    : session.type === 'block' ? compNameByBlockKind[block?.kind] ?? 'BlockSource' : 'BlockSource';
  if (slashStore && (session.type === 'block' || isItem) && slashIsEnabled(compById, sourceStore.configDoc, component?.compName ?? compName)) {
    configEdit.edit.slash = {
      store: slashStore,
      // what the slash actions are given (slash-define.js)
      context: { sourcePath: path, docPageAlias: sourceStore.docPageAliasOfPath(path), source: sourceStore.sourceService, object: objectStore },
    };
  }
  return (
    <RegisteredComp
      compName={compName}
      configRuntime={{ ...configEdit, instanceId: `edit:${path}:${session.type}:${session.blockIndex}:${session.itemPath ?? ''}`, blockIndex: session.blockIndex }}
      input={{ data: { text: session.textInitial } }}
      placement="edit"
    />
  );
});

// the block offers the slash mode in its source surface: the component
// named (the block's own component, or the default editor of its kind)
// declares meta.isEditSlashEnabled
function slashIsEnabled(compById, configDoc, compName) {
  const definition = compDefinitionNormalize(compDefinitionGet(compById, compIdResolve(configDoc, compName)));
  return definition ? compMetaGet(definition).isEditSlashEnabled === true : false;
}

// default editor (built-in component name) of each block kind
const compNameByBlockKind = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
};

const labelByBlockKind = {
  blockquote: 'Quote',
  code: 'Code block',
  component: 'Component',
  definition: 'Link definition',
  esm: 'Import / export',
  expression: 'Expression',
  footnoteDefinition: 'Footnote',
  heading: 'Heading',
  html: 'HTML / comment',
  jsx: 'JSX element',
  list: 'List',
  marker: 'Component markers',
  math: 'Math block',
  paragraph: 'Paragraph',
  table: 'Table',
  thematicBreak: 'Horizontal rule',
};

function sessionLabelGet(session, block, stores) {
  if (session.type === 'item') {
    if (session.itemFormat !== 'block') return 'List item';
    const isText = itemBlockInfoIsText(session.itemBlockInfo);
    // the lines of one code block among the text of the item
    if (session.itemPart) return isText ? 'List item · its text block' : 'List item · its code block';
    return isText ? 'List item · text block' : 'List item · code block';
  }
  if (session.type === 'frontmatter') return 'Frontmatter';
  if (session.type === 'document') return 'Document source';
  return blockLabelGet(block, stores);
}

// what a block is called in its toolbar and editor bar: { text, title }. a component block is
// called by its tag name, or by what its component says of it (expose.blockLabelGet: ObjectFrontend
// names the type of its object), which needs the page's stores
export function blockLabelInfoGet(block, stores) {
  if (block?.component) {
    const isAsset = assetRefLangIs(block.component.lang);
    const name = String(block.component.compName ?? '');
    const definition = stores?.docStore && stores?.sourceStore && !isAsset
      ? compDefinitionNormalize(compDefinitionGet(stores.docStore.compById, compIdResolve(stores.sourceStore.configDoc, name)))
      : undefined;
    const own = definition ? compBlockLabelGet(definition, block.component, { stores }) : null;
    if (own) return own;
    return { text: isAsset ? `${name} (asset)` : name, title: '' };
  }
  return { text: labelByBlockKind[block?.kind] ?? 'Block', title: '' };
}

export function blockLabelGet(block, stores) {
  return blockLabelInfoGet(block, stores).text;
}

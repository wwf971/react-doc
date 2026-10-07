import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../registry/comp-registry.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';
import { assetRefLangIs } from '../../frontend/src/lib/doc-asset-ref.js';

// The editor of the open session, chosen by what is edited
// (doc_page_impl_edit.md#component-edit-mode):
//
//   a component block whose component declares isEditSupported
//     -> the component itself, rendered as in the document (placement
//        commentBlock, same data) but with config.isEdit = true, so it
//        renders its XxxEdit
//   a component block whose data is a reference into the asset store
//     -> BlockSource: the block holds the reference, the data is changed
//        through the asset panel (doc_page_impl_asset.md#edit-mode)
//   any other block
//     -> the default editor of the block kind: the registered components
//        Heading / Paragraph / List, or BlockSource for every other kind
//   the frontmatter, the whole document
//     -> BlockSource, with its surface in the floating panel (there is no
//        place in the body where they are displayed)
//
// every editor edits the block in its place and floats its controls
// (doc_page_impl_edit.md#no-jitter-rule). it receives config.edit =
// { session, block, format, sourcePath, label, viewRendered,
// isSurfaceFloating } and reports through events (editDraftChange,
// editTextSetRequest, editSubmitRequest, editCancelRequest,
// editFocusShiftRequest); the event layer routes them to
// DocEditStore.eventHandle. the session draft is what a leave saves, so an
// editor reports every change of its draft: text editors as { text }, a
// component's own editor as { raw, props }, rebuilt into the block text by
// the store.
//
//   block         the block of a block session
//   viewRendered  the block as the body rendered it, for editors that keep a
//                 rendered part in the flow
export const DocEditBlockEditor = observer(function DocEditBlockEditor({ block, viewRendered }) {
  const { compById, editStore, sourceStore } = useDocStores();
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
      label: sessionLabelGet(session, block),
      viewRendered,
      // the frontmatter and the whole file are not blocks of the body
      isSurfaceFloating: session.type === 'frontmatter' || session.type === 'document',
    },
  };

  const component = session.type === 'block' ? block?.component : undefined;
  if (component && !assetRefLangIs(component.lang)) {
    const compId = compIdResolve(sourceStore.configDoc, component.compName);
    const definition = compDefinitionNormalize(compById[compId]);
    if (definition?.isEditSupported) {
      return (
        <RegisteredComp
          compDefinition={definition}
          compId={compId}
          compName={component.compName}
          configRuntime={{ ...configEdit, instanceId: `edit:${path}:${block.index}`, blockIndex: block.index }}
          input={{ lang: component.lang, propsAuthored: component.props ?? {}, raw: component.raw }}
          placement="commentBlock"
        />
      );
    }
  }

  const compName = session.type === 'block' ? compNameByBlockKind[block?.kind] ?? 'BlockSource' : 'BlockSource';
  return (
    <RegisteredComp
      compName={compName}
      configRuntime={{ ...configEdit, instanceId: `edit:${path}:${session.type}:${session.blockIndex}`, blockIndex: session.blockIndex }}
      input={{ data: { text: session.textInitial } }}
      placement="edit"
    />
  );
});

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

function sessionLabelGet(session, block) {
  if (session.type === 'frontmatter') return 'Frontmatter';
  if (session.type === 'document') return 'Document source';
  return blockLabelGet(block);
}

// what a block is called in its toolbar and editor bar
export function blockLabelGet(block) {
  if (block?.component) {
    return assetRefLangIs(block.component.lang) ? `${block.component.compName} (asset)` : block.component.compName;
  }
  return labelByBlockKind[block?.kind] ?? 'Block';
}

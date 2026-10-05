import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { componentBlockTextBuild } from '../../frontend/src/lib/doc-edit-block.js';
import { compDefinitionNormalize, compIdResolve } from '../registry/comp-registry.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';

// The editor of the open session, chosen by what is edited
// (doc_page_impl_edit.md#component-edit-mode):
//
//   a component block whose component declares isEditSupported
//     -> the component itself, rendered as in the document (placement
//        commentBlock, same data) but with config.isEdit = true, so it
//        renders its XxxEdit
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
// isSurfaceFloating } and reports through events; editEventHandlerCreate
// turns them into store calls. the session draft is what a leave saves, so
// an editor reports every change of its draft: text editors as { text }, a
// component's own editor as { raw, props }, rebuilt into the block text here.
//
//   block         the block of a block session
//   viewRendered  the block as the body rendered it, for editors that keep a
//                 rendered part in the flow
export const DocEditBlockEditor = observer(function DocEditBlockEditor({ block, viewRendered }) {
  const { compById, editStore, sourceStore } = useDocStores();
  const { path, format } = useDocEditDoc();
  const session = editStore.session;
  if (!session || session.path !== path) return null;

  const onEventRuntime = editEventHandlerCreate(editStore, block);
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
  if (component) {
    const compId = compIdResolve(sourceStore.configDoc, component.compName);
    const definition = compDefinitionNormalize(compById[compId]);
    if (definition?.isEditSupported) {
      return (
        <RegisteredComp
          compDefinition={definition}
          compId={compId}
          compName={component.compName}
          configRuntime={{ ...configEdit, instanceId: `edit:${path}:${block.index}` }}
          input={{ lang: component.lang, propsAuthored: component.props ?? {}, raw: component.raw }}
          onEventRuntime={onEventRuntime}
          placement="commentBlock"
        />
      );
    }
  }

  const compName = session.type === 'block' ? compNameByBlockKind[block?.kind] ?? 'BlockSource' : 'BlockSource';
  return (
    <RegisteredComp
      compName={compName}
      configRuntime={{ ...configEdit, instanceId: `edit:${path}:${session.type}:${session.blockIndex}` }}
      input={{ data: { text: session.textInitial } }}
      onEventRuntime={onEventRuntime}
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
  if (block?.component) return block.component.compName;
  return labelByBlockKind[block?.kind] ?? 'Block';
}

// the block text an editor's event describes: { text } as is, { raw, props }
// of a component editor rebuilt into the block (submitted props replace the
// authored props of the same name only)
function eventBlockTextGet(eventData, block) {
  if (typeof eventData.text === 'string') return eventData.text;
  if (block?.component && (eventData.raw !== undefined || eventData.props !== undefined)) {
    const props = eventData.props ? { ...block.component.props, ...eventData.props } : undefined;
    return componentBlockTextBuild(block, { raw: eventData.raw, props });
  }
  return undefined;
}

export function editEventHandlerCreate(editStore, block) {
  return async (eventType, eventData = {}) => {
    if (eventType === 'editDraftChange') {
      const text = eventBlockTextGet(eventData, block);
      if (text !== undefined) editStore.sessionDraftSet(text);
      return { isHandled: true };
    }
    if (eventType === 'editTextSetRequest') {
      editStore.sessionTextSet(String(eventData.text ?? ''));
      return { isHandled: true };
    }
    if (eventType === 'editCancelRequest') {
      const isCanceled = await editStore.sessionCancel();
      return { isHandled: true, isCanceled };
    }
    if (eventType === 'editSubmitRequest') {
      // Save: the explicit leave. an editor may hand over its final draft here.
      const text = eventBlockTextGet(eventData, block);
      if (text !== undefined) editStore.sessionDraftSet(text);
      const isSubmitted = await editStore.sessionLeave();
      return { isHandled: true, isSubmitted };
    }
    return undefined;
  };
}

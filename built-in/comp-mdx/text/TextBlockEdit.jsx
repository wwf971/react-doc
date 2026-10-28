import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { EditActions } from '../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { EditSourceSurface } from '../../../main/comp-doc/edit/EditSourceSurface.jsx';
import { EditSlashToggle } from '../../../main/comp-doc/slash/EditSlashToggle.jsx';
import { headingLevelGet } from './HeadingData.js';
import { listLineSpaceListGet } from './ListData.js';
import './text-block.css';

// The editor shared by the default text components (Heading, Paragraph,
// List, BlockSource). The block is edited where it is displayed: its source
// replaces the rendered block in the same place, in the block's own element
// and typography (a paragraph as a <p>, a heading as its <h2>, a list or a
// code block as a surface of their kind), so the author types into the page
// itself. The only thing added is the floating bar above the block: the
// label, the controls a kind-specific editor passes as children (HeadingEdit:
// level, ListEdit: list type), and Save / Cancel.
//
// the frontmatter and the whole document have no place in the body; their
// surface is inside the floating panel instead (config.edit.isSurfaceFloating).
//
//   data.text                      source of the block when editing started
//   config.edit.session            { textDraft, draftVersion, selectionInitial, status, message }
//   config.edit.block              the block model entry (kind decides the surface)
//   config.edit.label              what is being edited, e.g. "Paragraph"
//   config.edit.isSurfaceFloating  the surface goes into the panel (frontmatter, document)
//   config.edit.slash              present when the block offers the slash mode
//                                  (doc_page_impl_edit_slash.md): handed to the
//                                  surface, and its switch is shown in the bar
//
// events (handled by the edit layer):
//   editDraftChange { text }      typed text; what a leave saves
//   editTextSetRequest { text }   text set by a control; the surface is rewritten
//   editSubmitRequest             Save
//   editCancelRequest             Cancel
//   editFocusShiftRequest { direction: 'previous' | 'next' }
//                                 ArrowUp on the first line / ArrowDown on
//                                 the last line: go on to the neighbor block.
//                                 reported with the caret position as the
//                                 event point, so the neighbor keeps the x
export const TextBlockEdit = observer(function TextBlockEdit({ data = {}, config = {}, onEvent, children }) {
  const edit = config.edit ?? {};
  const session = edit.session ?? {};
  const textDraft = typeof session.textDraft === 'string' ? session.textDraft : String(data.text ?? '');
  const draftVersion = session.draftVersion ?? 0;
  const isLocked = session.status === 'submitting';
  const label = edit.label ?? 'Block';
  const kind = edit.block?.kind ?? 'other';
  // the element of the surface follows the text set by a control (a heading
  // level), not the text being typed, so the caret is never lost mid-word
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tag = useMemo(() => surfaceTagGet(kind, textDraft), [kind, draftVersion]);

  const submitRequest = () => {
    if (isLocked) return;
    void onEvent?.('editSubmitRequest');
  };
  const cancelRequest = () => {
    if (isLocked) return;
    void onEvent?.('editCancelRequest');
  };

  const surface = (
    <EditSourceSurface
      tag={tag}
      kind={kind}
      text={textDraft}
      textVersion={draftVersion}
      selectionInitial={session.selectionInitial ?? 'end'}
      // a list keeps the gaps between its items while its source is edited
      lineSpaceListGet={kind === 'list' && !edit.isSurfaceFloating ? listLineSpaceListGet : undefined}
      slash={edit.slash}
      isLocked={isLocked}
      ariaLabel={`${label} source`}
      onTextChange={(text) => void onEvent?.('editDraftChange', { text })}
      onSubmitRequest={submitRequest}
      onCancelRequest={cancelRequest}
      onFocusShiftRequest={edit.isSurfaceFloating
        ? undefined
        : (direction, { point } = {}) => void onEvent?.('editFocusShiftRequest', { direction }, { point })}
    />
  );
  // the controls of the kind (children) and the switch of the slash mode
  const head = edit.slash
    ? (
        <>
          {children}
          <EditSlashToggle slash={edit.slash} isDisabled={isLocked} />
        </>
      )
    : children;
  const actions = (
    <EditActions status={session.status} message={session.message} onSubmit={submitRequest} onCancel={cancelRequest} />
  );

  if (edit.isSurfaceFloating) {
    return (
      <EditFloatingPanel label={label} head={head} actions={actions} placement="below">
        {surface}
      </EditFloatingPanel>
    );
  }
  return (
    <>
      {surface}
      <EditFloatingPanel label={label} head={head} actions={actions} />
    </>
  );
});

// the element the source is edited in: the one the block renders as
function surfaceTagGet(kind, text) {
  if (kind === 'paragraph') return 'p';
  if (kind === 'heading') {
    const level = headingLevelGet(text);
    return level > 0 ? `h${level}` : 'div';
  }
  return 'div';
}

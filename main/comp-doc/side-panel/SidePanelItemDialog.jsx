import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import { SourcePathPicker } from '../source/SourcePathPicker.jsx';
import '../edit/DocEdit.css';
import '../source/DocSource.css';
import './SidePanelItem.css';

// The dialog of a structure change of the side panel
// (doc_page_impl_side_panel.md#changing-the-structure). Open state lives in
// DocSidePanelStore.dialog; it floats where the pointer was, styled like the
// move picker (a .doc-popover-form with the same head), and is one of:
//
//   folderNew   the label of a new folder, then Create
//   bind        the document or the source folder the item is bound to,
//               chosen with the path picker of the source layer among the
//               files (or folders) of the item's doc page; or, for a
//               detach, what the item becomes, then Detach
//   remove      what goes with the item: nothing for an empty folder, the
//               generated items of a source folder (the files stay), or for
//               a document item the choice to delete its document, unchosen,
//               with the documents that link to it and the other items that
//               show it
//
// the change is written while the dialog stays, which shows its failure.
// the close button, Escape, or a pointer going down outside closes it, not
// while the change is written. Cmd/Ctrl+Enter confirms.
export const SidePanelItemDialog = observer(function SidePanelItemDialog() {
  const { sidePanelStore } = useDocStores();
  const elementRef = useRef(null);
  const dialog = sidePanelStore.dialog;
  const isOpen = dialog !== undefined;
  // the dialog stays inside the window: after it renders (and whenever its
  // content grows), it is moved up by what it would stick out below
  const [shiftUp, shiftUpSet] = useState(0);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const fit = () => {
      const rect = element.getBoundingClientRect();
      const overflow = rect.bottom + shiftUp - (window.innerHeight - 8);
      const shiftUpNext = Math.max(0, Math.min(overflow, rect.top + shiftUp - 8));
      if (shiftUpNext !== shiftUp) shiftUpSet(shiftUpNext);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) sidePanelStore.dialogClose();
    };
    const pointerDownHandle = (event) => {
      if (!elementRef.current || elementRef.current.contains(event.target)) return;
      // the path suggestions are rendered into the body, outside the dialog
      if (event.target instanceof Element && event.target.closest('.doc-source-path-list')) return;
      sidePanelStore.dialogClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    window.addEventListener('pointerdown', pointerDownHandle, true);
    return () => {
      window.removeEventListener('keydown', keyDownHandle);
      window.removeEventListener('pointerdown', pointerDownHandle, true);
    };
  }, [isOpen, sidePanelStore]);

  if (!isOpen) return null;
  const isSubmitting = dialog.status === 'submitting';
  const label = sidePanelStore.itemTextGet(dialog.itemId);
  const content = dialogContentGet(dialog, sidePanelStore);
  const style = dialog.point
    ? {
        left: `${Math.max(8, Math.min(dialog.point.clientX, window.innerWidth - 360))}px`,
        top: `${Math.max(8, dialog.point.clientY - shiftUp)}px`,
      }
    : { left: '50%', top: '4rem', transform: 'translateX(-50%)' };

  return (
    <div
      ref={elementRef}
      className={`doc-popover-form doc-side-panel-move-picker doc-side-panel-node-dialog not-prose ${EDIT_POPUP_CLASS}`}
      role="dialog"
      aria-label={`${content.title} ${label}`}
      data-kind={dialog.kind}
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void sidePanelStore.dialogConfirm();
        }
      }}
    >
      <div className="doc-side-panel-move-picker-head">
        <p className="doc-side-panel-move-picker-title">
          <span className="doc-side-panel-move-picker-title-text">{content.title}</span>
          <span className="doc-side-panel-move-picker-item">{label}</span>
        </p>
        <button
          type="button"
          className="doc-button-icon doc-side-panel-move-picker-close"
          title={isSubmitting ? 'the change is being written' : 'Close'}
          aria-label="Close"
          disabled={isSubmitting}
          onClick={() => sidePanelStore.dialogClose()}
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
        </button>
      </div>
      {content.body}
      <div className="doc-side-panel-move-picker-actions">
        <button
          type="button"
          className="doc-button-dialog"
          data-danger={content.isDanger ? '' : undefined}
          disabled={isSubmitting}
          onClick={() => void sidePanelStore.dialogConfirm()}
        >
          {content.actionText}
        </button>
        <button type="button" className="doc-button-dialog" disabled={isSubmitting} onClick={() => sidePanelStore.dialogClose()}>
          {dialog.kind === 'remove' ? 'Keep' : 'Cancel'}
        </button>
        {isSubmitting ? (
          <span className="doc-status" role="status">
            <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
            <span>Writing…</span>
          </span>
        ) : null}
      </div>
      {dialog.status === 'error' && dialog.message ? <p className="doc-error" role="alert">{dialog.message}</p> : null}
    </div>
  );
});

// { title, body, actionText, isDanger } of the dialog's kind
function dialogContentGet(dialog, sidePanelStore) {
  const isSubmitting = dialog.status === 'submitting';
  if (dialog.kind === 'folderNew') {
    return {
      title: `New folder ${positionLabelGet(dialog.position)}`,
      actionText: 'Create',
      body: (
        <label className="doc-source-prompt-row">
          <span className="doc-source-prompt-label">label</span>
          <EditValueInline
            value={dialog.text}
            placeholder="folder label"
            isLocked={isSubmitting}
            onCommit={(text) => sidePanelStore.dialogTextSet(text)}
            onInput={(text) => sidePanelStore.dialogTextSet(text)}
          />
        </label>
      ),
    };
  }
  if (dialog.kind === 'bind') return bindContentGet(dialog, sidePanelStore, isSubmitting);
  return removeContentGet(dialog, sidePanelStore, isSubmitting);
}

function bindContentGet(dialog, sidePanelStore, isSubmitting) {
  const place = sidePanelStore.placeById.get(dialog.itemId);
  if (dialog.bindKind === 'none') {
    const isSourceFolder = place?.nodeForm === 'sourceFolder';
    return {
      title: isSourceFolder ? 'Detach the folder of' : 'Detach the document of',
      actionText: 'Detach',
      body: (
        <p className="doc-note">
          {isSourceFolder
            ? `The item becomes an empty folder: the items mirroring ${place.bindPath} go, the files stay.`
            : `The item stays a folder with its items, and opens nothing when clicked; ${place?.bindPath ?? 'the document'} stays in the source.`}
        </p>
      ),
    };
  }
  const isDoc = dialog.bindKind === 'doc';
  const isChange = isDoc ? place?.nodeForm === 'doc' : place?.nodeForm === 'sourceFolder';
  const spec = sidePanelStore.bindSpecGet(dialog.itemId, dialog.bindKind);
  return {
    title: isChange ? `Change the ${isDoc ? 'document' : 'folder'} of` : `Bind a ${isDoc ? 'document' : 'folder'} to`,
    actionText: isChange ? 'Change' : 'Bind',
    body: (
      <>
        <SourcePathPicker
          value={dialog.bindPath}
          spec={spec}
          label={isDoc ? 'document' : 'folder'}
          placeholder={isDoc ? '~root/folder/document.mdx' : '~root/folder'}
          isDisabled={isSubmitting}
          onChange={(text) => sidePanelStore.dialogBindPathSet(text)}
          onSelect={(path) => sidePanelStore.dialogBindPathSet(path)}
          onActivate={(path) => {
            sidePanelStore.dialogBindPathSet(path);
            void sidePanelStore.dialogConfirm();
          }}
        />
        <p className="doc-note">
          {isDoc
            ? 'A document of this doc page; the item opens it when clicked.'
            : 'A folder of this doc page: its files and folders become the items, follow the files, and are not edited in the side panel.'}
        </p>
      </>
    ),
  };
}

function removeContentGet(dialog, sidePanelStore, isSubmitting) {
  const resolved = sidePanelStore.removeResolve(dialog.itemId);
  const data = resolved.code === 0 ? resolved.data : { filePath: '', isSourceFolder: false, generatedCount: 0 };
  const place = sidePanelStore.placeById.get(dialog.itemId);
  let body;
  if (data.isSourceFolder) {
    body = (
      <p className="doc-note">
        {`Its ${data.generatedCount} generated item${data.generatedCount === 1 ? '' : 's'} go with it; the files of ${place?.bindPath ?? 'the folder'} stay.`}
      </p>
    );
  } else if (data.filePath) {
    const itemSameDocCount = sidePanelStore.itemSameDocIdListGet(dialog.itemId).length;
    body = (
      <div className="doc-edit-file-delete" role="group" aria-label="Document to delete">
        <div className="doc-edit-file-delete-list">
          <button
            type="button"
            role="checkbox"
            className="doc-edit-file-option"
            aria-checked={dialog.isFileDeleted}
            aria-label={`Also delete ${data.filePath}`}
            disabled={isSubmitting}
            onClick={() => sidePanelStore.dialogFileDeletedSet(!dialog.isFileDeleted)}
          >
            <span className="doc-edit-file-check" aria-hidden="true">
              {dialog.isFileDeleted ? <Check size={11} strokeWidth={2.4} /> : null}
            </span>
            <span className="doc-edit-file-option-text">
              <span>Also delete the document</span>
              <span className="doc-edit-file-option-path">{data.filePath}</span>
            </span>
          </button>
        </div>
        <ReferrerNote filePath={data.filePath} itemSameDocCount={itemSameDocCount} />
        {dialog.isFileDeleted ? (
          <span className="doc-edit-file-delete-note">The document is moved to a hidden backup beside it, not erased.</span>
        ) : null}
      </div>
    );
  } else {
    body = <p className="doc-note">The item holds no items; only its line in the side panel file goes.</p>;
  }
  return {
    title: 'Remove',
    actionText: dialog.isFileDeleted && data.filePath ? 'Remove item and document' : 'Remove item',
    isDanger: true,
    body,
  };
}

// who would be left with a broken link or a missing document: the other
// items showing it, and the documents the link index says reference it
// (doc_page_impl_nav_backlink.md#the-link-index)
const ReferrerNote = observer(function ReferrerNote({ filePath, itemSameDocCount }) {
  const { linkStore } = useDocStores();
  const lineList = [];
  if (itemSameDocCount > 0) {
    lineList.push(`${itemSameDocCount} other item${itemSameDocCount === 1 ? ' shows' : 's show'} this document; ${itemSameDocCount === 1 ? 'it' : 'they'} would show it missing.`);
  }
  const referrerList = linkStore.isIndexAvailable ? linkStore.referrerListGet(filePath) : [];
  if (!linkStore.isIndexAvailable) lineList.push('The documents linking to it are not known here.');
  else if (referrerList.length === 0) lineList.push('No document links to it.');
  return (
    <div className="doc-side-panel-node-referrer">
      {lineList.map((line) => <span key={line} className="doc-edit-file-delete-note">{line}</span>)}
      {referrerList.length > 0 ? (
        <>
          <span className="doc-edit-file-delete-note">
            {`Linked from ${referrerList.length} document${referrerList.length === 1 ? '' : 's'}; ${referrerList.length === 1 ? 'its links' : 'their links'} would break:`}
          </span>
          <div className="doc-side-panel-node-referrer-list">
            {referrerList.slice(0, 6).map((referrer) => (
              <span key={referrer.docPath} className="doc-side-panel-node-referrer-path">
                {referrer.docPath}
                {referrer.count > 1 ? <small>{` ×${referrer.count}`}</small> : null}
              </span>
            ))}
            {referrerList.length > 6 ? <span className="doc-side-panel-node-referrer-path">{`and ${referrerList.length - 6} more`}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
});

function positionLabelGet(position) {
  if (position === 'before') return 'above';
  if (position === 'after') return 'below';
  return 'inside';
}

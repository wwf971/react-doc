import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FolderTreeIcon, LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { SourcePathInput } from './SourcePathInput.jsx';
import { SourceTreeSelect } from './SourceTreeSelect.jsx';
import './DocSource.css';

// The location prompt of file creation (doc_page_impl_source.md
// #creating-files): where a file a component holds (a pasted image) is
// written. Open state lives in DocSourceFileStore.prompt; the prompt
// floats where the pointer was when the file was requested (or at the top
// center of the page), with the folder (SourcePathInput, completed from
// the folders of the source), the file name, Create and Cancel. the folder
// can also be picked from the folders of the source as a tree
// (SourceTreeSelect), shown by the browse button next to it. Escape
// cancels; a pointer going down outside it cancels too.
export const SourceFilePrompt = observer(function SourceFilePrompt() {
  const { sourceFileStore, sourceStore } = useDocStores();
  const elementRef = useRef(null);
  const [isTreeShown, isTreeShownSet] = useState(false);
  const prompt = sourceFileStore.prompt;
  const isOpen = prompt !== undefined;

  useEffect(() => {
    if (!isOpen) isTreeShownSet(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') sourceFileStore.promptCancel();
    };
    const pointerDownHandle = (event) => {
      if (elementRef.current && !elementRef.current.contains(event.target)) sourceFileStore.promptCancel();
    };
    window.addEventListener('keydown', keyDownHandle);
    window.addEventListener('pointerdown', pointerDownHandle, true);
    return () => {
      window.removeEventListener('keydown', keyDownHandle);
      window.removeEventListener('pointerdown', pointerDownHandle, true);
    };
  }, [isOpen, sourceFileStore]);

  if (!isOpen) return null;
  const isSubmitting = prompt.status === 'submitting';
  const style = prompt.point
    ? { left: `${Math.min(prompt.point.clientX, window.innerWidth - 360)}px`, top: `${Math.min(prompt.point.clientY, window.innerHeight - 160)}px` }
    : { left: '50%', top: '4rem', transform: 'translateX(-50%)' };

  return (
    <div
      ref={elementRef}
      className="doc-source-prompt not-prose"
      role="dialog"
      aria-label="Save the file to a folder of the source"
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          sourceFileStore.promptConfirm();
        }
      }}
    >
      <p className="doc-source-prompt-title">Save file to</p>
      <div className="doc-source-prompt-row">
        <span className="doc-source-prompt-label">folder</span>
        <SourcePathInput
          value={prompt.dirPath}
          spec={{ kind: 'dir' }}
          placeholder="~rootId/folder"
          isDisabled={isSubmitting}
          onChange={(text) => sourceFileStore.promptDirPathSet(text)}
          onCommit={(text) => sourceFileStore.promptDirPathSet(text)}
        />
        <button
          type="button"
          className="doc-source-prompt-browse"
          title="Browse the folders of the source"
          aria-label="Browse the folders of the source"
          aria-pressed={isTreeShown}
          disabled={isSubmitting}
          onClick={() => isTreeShownSet(!isTreeShown)}
        >
          <FolderTreeIcon aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      </div>
      {isTreeShown ? (
        <SourceTreeSelect
          className="doc-source-prompt-tree"
          nodeList={sourceStore.pathTreeGet({ kind: 'dir' })}
          valueId={prompt.dirPath}
          idExpandedInitialList={sourcePathAncestorListGet(prompt.dirPath)}
          onSelect={(id) => sourceFileStore.promptDirPathSet(id)}
        />
      ) : null}
      <label className="doc-source-prompt-row">
        <span className="doc-source-prompt-label">name</span>
        <EditValueInline
          value={prompt.name}
          placeholder="file name"
          isLocked={isSubmitting}
          onCommit={(text) => sourceFileStore.promptNameSet(text)}
        />
      </label>
      <div className="doc-source-prompt-actions">
        <button type="button" className="doc-source-prompt-button" disabled={isSubmitting} onClick={() => sourceFileStore.promptConfirm()}>Create</button>
        <button type="button" className="doc-source-prompt-button" disabled={isSubmitting} onClick={() => sourceFileStore.promptCancel()}>Cancel</button>
        {isSubmitting ? (
          <span className="doc-source-prompt-status" role="status">
            <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
            <span>Creating the file…</span>
          </span>
        ) : null}
      </div>
      {prompt.status === 'error' && prompt.message ? (
        <p className="doc-source-prompt-message" role="alert">{prompt.message}</p>
      ) : null}
    </div>
  );
});

// '~a', '~a/b' for '~a/b/c': the folders a path is inside
function sourcePathAncestorListGet(path) {
  const segList = String(path ?? '').split('/').filter(Boolean);
  return segList.slice(0, -1).map((_, index) => segList.slice(0, index + 1).join('/'));
}

import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { SourcePathPicker } from './SourcePathPicker.jsx';
import './DocSource.css';

// The location prompt of file creation (doc_page_impl_source.md
// #creating-files): where a file a component holds (a pasted image) is
// written. Open state lives in DocSourceFileStore.prompt; the prompt
// floats where the pointer was when the file was requested (or at the top
// center of the page), with the folder (SourcePathPicker: typed with
// completion from the folders of the source, or picked from them as a tree
// behind its browse button), the file name, Create and Cancel. Escape
// cancels; a pointer going down outside it cancels too.
export const SourceFilePrompt = observer(function SourceFilePrompt() {
  const { sourceFileStore } = useDocStores();
  const elementRef = useRef(null);
  const prompt = sourceFileStore.prompt;
  const isOpen = prompt !== undefined;

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) sourceFileStore.promptCancel();
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
      className="doc-popover-form doc-source-prompt not-prose"
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
      <SourcePathPicker
        value={prompt.dirPath}
        spec={{ kind: 'dir' }}
        label="folder"
        placeholder="~rootId/folder"
        isDisabled={isSubmitting}
        isTreeCollapsible
        onChange={(text) => sourceFileStore.promptDirPathSet(text)}
        onSelect={(path) => sourceFileStore.promptDirPathSet(path)}
      />
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
        <button type="button" className="doc-button-dialog doc-source-prompt-button" disabled={isSubmitting} onClick={() => sourceFileStore.promptConfirm()}>Create</button>
        <button type="button" className="doc-button-dialog doc-source-prompt-button" disabled={isSubmitting} onClick={() => sourceFileStore.promptCancel()}>Cancel</button>
        {isSubmitting ? (
          <span className="doc-status" role="status">
            <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
            <span>Creating the file…</span>
          </span>
        ) : null}
      </div>
      {prompt.status === 'error' && prompt.message ? (
        <p className="doc-error" role="alert">{prompt.message}</p>
      ) : null}
    </div>
  );
});

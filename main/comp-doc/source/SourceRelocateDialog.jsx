import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowRight, ChevronRight, FileBox, FileText, LoaderCircle, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import { SourcePathPicker } from './SourcePathPicker.jsx';
import './DocSource.css';

// The dialog of a move or a rename with its references (design:
// doc_page_impl_nav_backlink.md#relocation): the target is chosen, and what
// the move changes is shown before anything is written, as the development
// server plans it. Open state lives in DocRelocateStore.dialog.
//
//   Move document  b.md                                            [×]
//   folder  [~demo:notes/guide ▾]                (move only; virtual roots marked)
//   name    [b.md]
//   ┌ what changes ─────────────────────────────────────────────────┐
//   │ ▣ ~demo:demo/b.md → ~demo:notes/guide/b.md  [managed]          │  the document; the badge when it
//   │ 2 references in 2 documents spelled anew                ▸     │  becomes (or stays) managed
//   │   a.md  3  ./b.md → ~notes/guide/b.md                         │  the details, unfolded
//   │ 1 binding of a side panel or entry                             │
//   │ left as it is (1): b.md 4 resolves to 2 files                  │
//   └────────────────────────────────────────────────────────────────┘
//   [Move] [Cancel]  writing…
//
// the plan is read again a moment after the target changes; Move writes the plan shown
// (a source changed since answers the new plan, shown in its place). Escape, the close
// button, or a pointer going down outside closes it, not while it writes.
export const SourceRelocateDialog = observer(function SourceRelocateDialog() {
  const { relocateStore } = useDocStores();
  const elementRef = useRef(null);
  const dialog = relocateStore?.dialog;
  const isOpen = dialog !== undefined;
  const [shiftUp, shiftUpSet] = useState(0);

  // the dialog stays inside the window as its plan grows
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
      if (event.key === 'Escape' && !event.defaultPrevented) relocateStore.dialogClose();
    };
    const pointerDownHandle = (event) => {
      if (!elementRef.current || elementRef.current.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.doc-source-path-list')) return;
      relocateStore.dialogClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    window.addEventListener('pointerdown', pointerDownHandle, true);
    return () => {
      window.removeEventListener('keydown', keyDownHandle);
      window.removeEventListener('pointerdown', pointerDownHandle, true);
    };
  }, [isOpen, relocateStore]);

  if (!isOpen) return null;
  const isSubmitting = dialog.apply.status === 'submitting';
  const isRename = dialog.mode === 'rename';
  const plan = dialog.plan;
  const isPlanCurrent = plan.status === 'done' && plan.pathTo === relocateStore.pathTo;
  const nameFrom = dialog.from.split('/').at(-1);
  const style = dialog.point
    ? {
        left: `${Math.max(8, Math.min(dialog.point.clientX, window.innerWidth - 440))}px`,
        top: `${Math.max(8, dialog.point.clientY - shiftUp)}px`,
      }
    : { left: '50%', top: '4rem', transform: 'translateX(-50%)' };

  return (
    <div
      ref={elementRef}
      className={`doc-popover-form doc-source-relocate not-prose ${EDIT_POPUP_CLASS}`}
      role="dialog"
      aria-label={`${isRename ? 'Rename' : 'Move'} ${nameFrom}`}
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (isPlanCurrent) void relocateStore.applySubmit();
        }
      }}
    >
      <div className="doc-source-relocate-head">
        <p className="doc-source-prompt-title">
          {isRename ? 'Rename document' : 'Move document'}
          <span className="doc-source-relocate-item">{nameFrom}</span>
        </p>
        <button
          type="button"
          className="doc-button-icon"
          title={isSubmitting ? 'the move is being written' : 'Close'}
          aria-label="Close"
          disabled={isSubmitting}
          onClick={() => relocateStore.dialogClose()}
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
        </button>
      </div>
      {isRename ? null : (
        <SourcePathPicker
          value={dialog.dirPath}
          spec={{ kind: 'dir' }}
          label="folder"
          placeholder="~page:root/folder"
          isDisabled={isSubmitting}
          isTreeCollapsible
          onSelect={(path) => relocateStore.targetSet({ dirPath: path })}
        />
      )}
      <label className="doc-source-prompt-row">
        <span className="doc-source-prompt-label">name</span>
        <EditValueInline
          value={dialog.name}
          placeholder="file name"
          isLocked={isSubmitting}
          onCommit={(text) => relocateStore.targetSet({ name: text })}
        />
      </label>
      <RelocatePlanView />
      <div className="doc-source-prompt-actions">
        <button
          type="button"
          className="doc-button-dialog doc-source-prompt-button"
          data-primary=""
          disabled={isSubmitting || !isPlanCurrent}
          title={isPlanCurrent ? 'Write the move and every change listed' : 'Wait for the plan of this target'}
          onClick={() => void relocateStore.applySubmit()}
        >
          {isRename ? 'Rename' : 'Move'}
        </button>
        <button type="button" className="doc-button-dialog doc-source-prompt-button" disabled={isSubmitting} onClick={() => relocateStore.dialogClose()}>Cancel</button>
        {isSubmitting ? (
          <span className="doc-status" role="status">
            <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
            <span>Writing…</span>
          </span>
        ) : null}
      </div>
      {dialog.apply.status === 'error' && dialog.apply.message ? <p className="doc-error" role="alert">{dialog.apply.message}</p> : null}
    </div>
  );
});

// what the move changes, as the server plans it
const RelocatePlanView = observer(function RelocatePlanView() {
  const { relocateStore, sourceStore } = useDocStores();
  const dialog = relocateStore.dialog;
  const plan = dialog.plan;
  if (plan.status === 'idle') {
    return <div className="doc-source-relocate-plan">{plan.message ? <p className="doc-status">{plan.message}</p> : null}</div>;
  }
  if (plan.status === 'error') {
    return <div className="doc-source-relocate-plan"><p className="doc-error" role="alert">{plan.message}</p></div>;
  }
  if (plan.status === 'loading' || !plan.data) {
    return (
      <div className="doc-source-relocate-plan">
        <p className="doc-status" role="status">
          <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
          <span>Reading what the move changes…</span>
        </p>
      </div>
    );
  }
  const { moveList, docList, configList, problemList, summary } = plan.data;
  const move = moveList[0];
  const labelOf = (docPath) => sourceStore.entryByInternalPath.get(docPath)?.name ?? docPath.split('/').at(-1);
  return (
    <div className="doc-source-relocate-plan">
      <p className="doc-source-relocate-heading">what changes</p>
      <div className="doc-source-relocate-line">
        {move.kindTo === 'managed'
          ? <FileBox aria-hidden="true" size={12} strokeWidth={1.8} className="doc-source-relocate-glyph doc-managed-glyph" />
          : <FileText aria-hidden="true" size={12} strokeWidth={1.8} className="doc-source-relocate-glyph" />}
        <span className="doc-source-relocate-path">{move.from}</span>
        <ArrowRight aria-hidden="true" size={11} strokeWidth={2} className="doc-source-relocate-arrow" />
        <span className="doc-source-relocate-path">{move.to}</span>
        {move.kindTo === 'managed' ? <span className="doc-badge" data-kind="managed" title="kept by the page in a virtual root">managed</span> : null}
      </div>
      {move.kindFrom !== move.kindTo ? (
        <p className="doc-source-relocate-note">
          {move.kindTo === 'managed'
            ? 'It becomes a managed document: the page keeps it in .doc-page/doc-managed/; the file is kept as a hidden backup beside where it was.'
            : 'It becomes a file of its folder again; its managed copy is kept as a hidden backup in its root.'}
        </p>
      ) : null}
      <button
        type="button"
        className="doc-source-relocate-toggle"
        aria-expanded={dialog.isDetailOpen}
        disabled={summary.referenceCount === 0}
        onClick={() => relocateStore.detailToggle()}
      >
        <ChevronRight aria-hidden="true" size={12} strokeWidth={2} className={`doc-source-tree-chevron${dialog.isDetailOpen ? ' is-expanded' : ''}`} />
        <span>
          {summary.referenceCount === 0
            ? 'no reference needs another spelling'
            : `${summary.referenceCount} reference${summary.referenceCount === 1 ? '' : 's'} in ${summary.docCount} document${summary.docCount === 1 ? '' : 's'} spelled anew`}
        </span>
      </button>
      {dialog.isDetailOpen && summary.referenceCount > 0 ? (
        <ul className="doc-source-relocate-list">
          {docList.flatMap((doc) => doc.rewriteList.map((rewrite, index) => (
            <li key={`${doc.docPath}:${index}`} title={`${doc.docPath} line ${rewrite.line} (${rewrite.construct})`}>
              <span className="doc-source-relocate-doc">{labelOf(doc.docPath)}</span>
              <span className="doc-source-relocate-muted">{rewrite.line}</span>
              <span className="doc-source-relocate-path">{rewrite.before}</span>
              <ArrowRight aria-hidden="true" size={10} strokeWidth={2} className="doc-source-relocate-arrow" />
              <span className="doc-source-relocate-path">{rewrite.after}</span>
            </li>
          )))}
        </ul>
      ) : null}
      {configList.length > 0 ? (
        <ul className="doc-source-relocate-list">
          {configList.flatMap((config) => config.rewriteList.map((rewrite, index) => (
            <li key={`${config.file}:${index}`} title={`${config.docPageAlias} ${config.file}: ${rewrite.keyPath.join('.')}`}>
              <span className="doc-source-relocate-doc">{config.kind === 'sidePanel' ? 'side panel' : config.kind}</span>
              <span className="doc-source-relocate-muted">{config.file}</span>
              <span className="doc-source-relocate-path">{rewrite.before}</span>
              <ArrowRight aria-hidden="true" size={10} strokeWidth={2} className="doc-source-relocate-arrow" />
              <span className="doc-source-relocate-path">{rewrite.after}</span>
            </li>
          )))}
        </ul>
      ) : null}
      {problemList.length > 0 ? (
        <div className="doc-source-relocate-problem">
          <p>left as it is ({problemList.length})</p>
          <ul className="doc-source-relocate-list">
            {problemList.map((problem, index) => (
              <li key={index}>
                <span className="doc-source-relocate-doc">{problem.docPath ? labelOf(problem.docPath) : problem.file}</span>
                {problem.line ? <span className="doc-source-relocate-muted">{problem.line}</span> : null}
                <span className="doc-source-relocate-path">{problem.target}</span>
                <span className="doc-source-relocate-muted">{problem.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

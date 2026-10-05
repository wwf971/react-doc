import { observer } from 'mobx-react-lite';
import { FileCode, LoaderCircle, Pencil, RotateCw } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocEdit.css';

// Document-level edit controls, shown in the toolbar next to the edit toggle
// while edit mode is on for an editable document: edit the frontmatter, edit
// the whole source, read the file again, and the "updating" mark while a
// newer source compiles. They live in the toolbar so that the body gains no
// extra row when edit mode is toggled.
export const DocEditDocControls = observer(function DocEditDocControls() {
  const { docStore, editStore } = useDocStores();
  const path = docStore.docCurrentPath;
  if (!editStore.isEditMode || !editStore.docIsEditable(path)) return null;
  const docEdit = editStore.docEditGet(path);
  const isFrontmatter = Boolean(docEdit?.model?.frontmatter);
  const isSubmitting = editStore.isSubmitting;

  return (
    <div className="doc-edit-doc-controls" role="group" aria-label="Document edit actions">
      <button
        type="button"
        disabled={isSubmitting || !isFrontmatter}
        aria-pressed={editStore.sessionIs(path, 'frontmatter')}
        title={isFrontmatter ? 'Edit the frontmatter' : 'This document has no frontmatter'}
        onClick={() => void editStore.sessionFrontmatterStart(path)}
      >
        <Pencil aria-hidden="true" size={13} strokeWidth={2} />
        <span>Frontmatter</span>
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        aria-pressed={editStore.sessionIs(path, 'document')}
        title="Edit the whole source"
        onClick={() => void editStore.sessionDocumentStart(path)}
      >
        <FileCode aria-hidden="true" size={13} strokeWidth={2} />
        <span>Source</span>
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        title="Read the file again"
        aria-label="Read the file again"
        onClick={() => void editStore.sourceReload(path)}
      >
        <RotateCw aria-hidden="true" size={13} strokeWidth={2} />
      </button>
      {editStore.docEditIsStale(path) ? (
        <span className="doc-edit-stale" role="status" title="A newer source is being compiled">
          <LoaderCircle aria-hidden="true" size={13} strokeWidth={2.2} className="doc-edit-spin" />
        </span>
      ) : null}
    </div>
  );
});

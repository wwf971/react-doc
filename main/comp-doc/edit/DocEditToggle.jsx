import { observer } from 'mobx-react-lite';
import { FilePenLine } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocBlockSelectToggle } from '../block-select/DocBlockSelectToggle.jsx';
import './DocEdit.css';

// The global edit-mode switch, and next to it the switch of block selection
// mode (DocBlockSelectToggle). It exists only while a development server
// answers the edit api (DocEditStore.isAvailable); built pages never show it.
// Switching edit mode off leaves the open session, which saves its draft.
export const DocEditToggle = observer(function DocEditToggle({ isCompact = false }) {
  const { docStore, editStore } = useDocStores();
  if (!editStore.isAvailable) return null;
  const isEditMode = editStore.isEditMode;
  const isDocEditable = editStore.docIsEditable(docStore.docCurrentPath);
  const title = isEditMode
    ? 'Leave edit mode'
    : isDocEditable
      ? 'Edit this document in place'
      : 'Edit mode (this page has no editable source file)';

  return (
    <div className="doc-edit-toggle">
      <button
        type="button"
        aria-pressed={isEditMode}
        title={title}
        aria-label={title}
        onClick={() => void editStore.editModeToggle()}
      >
        <FilePenLine aria-hidden="true" size={15} strokeWidth={2} />
        {isCompact ? null : <span>{isEditMode ? 'Editing' : 'Edit'}</span>}
      </button>
      <DocBlockSelectToggle isCompact={isCompact} />
    </div>
  );
});

import { observer } from 'mobx-react-lite';
import { FilePenLine, LoaderCircle, Unplug } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocBlockSelectToggle } from '../block-select/DocBlockSelectToggle.jsx';
import './DocEdit.css';

// The global edit-mode switch, and next to it the switch of block selection
// mode (DocBlockSelectToggle). It exists only while a development server
// answers the edit api (DocEditStore.isAvailable); built pages never show it.
// Switching edit mode off leaves the open session, which saves its draft.
// When the server that offered editing is gone (DocEnvStore.serverStatus
// 'lost': the IDE running vite was closed), the two switches give way to the
// view-only mark (DocEditOfflineMark), and the page reads as a built page
// would until the server answers again.
export const DocEditToggle = observer(function DocEditToggle({ isCompact = false }) {
  const { docStore, editStore, envStore } = useDocStores();
  if (!editStore.isAvailable) {
    const reason = envStore.editSuspendReasonGet();
    return reason ? <DocEditOfflineMark reason={reason} isCompact={isCompact} /> : null;
  }
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

// a button in the place of the switches: says the page is view-only and why
// (its title), and asks the server again when clicked; the environment also
// asks by itself every few seconds and on returning to the tab
const DocEditOfflineMark = observer(function DocEditOfflineMark({ reason, isCompact }) {
  const { envStore } = useDocStores();
  const isChecking = envStore.isServerChecking;
  const title = `${reason}\nClick to check again.`;
  const Icon = isChecking ? LoaderCircle : Unplug;

  return (
    <div className="doc-edit-toggle">
      <button
        type="button"
        className="doc-edit-offline"
        title={title}
        aria-label={`View only. ${reason}`}
        aria-busy={isChecking}
        onClick={() => void envStore.serverCheck()}
      >
        <Icon aria-hidden="true" size={15} strokeWidth={2} className={isChecking ? 'doc-spin' : undefined} />
        {isCompact ? null : <span>View only</span>}
      </button>
    </div>
  );
});

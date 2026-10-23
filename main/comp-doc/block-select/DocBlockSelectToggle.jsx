import { observer } from 'mobx-react-lite';
import { ListChecks } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';

// The switch of block selection mode (doc_page_impl_block_ops.md#selecting-blocks),
// a button next to the edit-mode switch, inside DocEditToggle. The two modes
// are never on together: switching one on switches the other off.
export const DocBlockSelectToggle = observer(function DocBlockSelectToggle({ isCompact = false }) {
  const { docStore, blockSelectStore } = useDocStores();
  if (!blockSelectStore) return null;
  const isMode = blockSelectStore.isMode;
  const isDocEditable = blockSelectStore.editStore.docIsEditable(docStore.docCurrentPath);
  const title = isMode
    ? 'Leave block selection'
    : isDocEditable
      ? 'Select blocks to copy or move them'
      : 'Block selection (this page has no editable source file)';

  return (
    <button
      type="button"
      aria-pressed={isMode}
      title={title}
      aria-label={title}
      onClick={() => void blockSelectStore.modeToggle()}
    >
      <ListChecks aria-hidden="true" size={15} strokeWidth={2} />
      {isCompact ? null : <span>{isMode ? 'Selecting' : 'Select'}</span>}
    </button>
  );
});

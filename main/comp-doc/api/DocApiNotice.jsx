import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocApi.css';

// One line the api layer shows for a few seconds at the top of the window
// (DocApiStore.notice): the message of an api run from a hotkey or the
// palette that failed, or the message a successful one answered. a click
// dismisses it. nothing of the page moves: the notice floats.
export const DocApiNotice = observer(function DocApiNotice() {
  const { apiStore } = useDocStores();
  const notice = apiStore.notice;
  if (!notice) return null;
  return createPortal(
    <div
      className="doc-api-notice doc-popover not-prose"
      role="status"
      data-error={notice.isError ? '' : undefined}
      onClick={() => apiStore.noticeClear()}
    >
      {notice.text}
    </div>,
    document.body,
  );
});

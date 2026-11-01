import { useEffect } from 'react';
import { useSearchContext } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';

// The keyboard of the page (design: doc_page_impl_api_hotkey.md): every
// keydown of the window is offered to DocHotkeyStore after the handlers of
// the place it happened in (the bubbling phase), so a key an editor or a
// dialog took (defaultPrevented) is never a hotkey. The listener renders
// nothing.
//
// it also hands the api layer what only a React context offers: opening
// the search dialog of fumadocs (uiHandle searchOpen, read by search/open).
export function DocHotkeyListener() {
  const { apiStore, hotkeyStore } = useDocStores();
  const search = useSearchContext();

  useEffect(() => {
    const keyDownHandle = (event) => {
      hotkeyStore.keyDownHandle(event);
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [hotkeyStore]);

  const searchOpenSet = search?.setOpenSearch;
  useEffect(() => {
    apiStore.uiHandleSet('searchOpen', searchOpenSet ? (isOpen) => searchOpenSet(isOpen !== false) : undefined);
    return () => apiStore.uiHandleSet('searchOpen', undefined);
  }, [apiStore, searchOpenSet]);

  return null;
}

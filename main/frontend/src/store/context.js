import { createContext, useContext } from 'react';

// one context carrying all stores: { sourceStore, docStore, tagStore, compStateStore, editStore, assetStore, ... }
// (DocPageMdx builds it; compStateStore is the component state service layer, doc_page_impl_mdx_comp_state.md)
export const StoreContext = createContext(null);

export function useDocStores() {
  const stores = useContext(StoreContext);
  if (!stores) throw new Error('useDocStores must be used inside <DocPageMdx/>');
  return stores;
}

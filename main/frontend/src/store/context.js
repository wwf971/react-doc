import { createContext, useContext } from 'react';

// one context carrying all stores: { sourceStore, docStore, compStateStore }
export const StoreContext = createContext(null);

export function useDocStores() {
  const stores = useContext(StoreContext);
  if (!stores) throw new Error('useDocStores must be used inside <DocPageMdx/>');
  return stores;
}

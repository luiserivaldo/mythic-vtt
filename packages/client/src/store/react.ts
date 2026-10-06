import { useStore } from 'zustand';
import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { ClientStore } from './store.js';

export const ClientStoreContext = createContext<StoreApi<ClientStore> | null>(null);

export function useClientStore<T>(selector: (s: ClientStore) => T): T {
  const store = useContext(ClientStoreContext);
  if (!store) throw new Error('useClientStore outside ClientStoreContext.Provider');
  return useStore(store, selector);
}

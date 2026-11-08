import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';

// The state object of the block a component is rendered for, from the
// component state service layer (doc_page_impl_mdx_comp_state.md). Held for
// the whole mount, found again by the next mount of the same block, and
// shared with every other mount of it:
//
//   const state = useCompState(config, { count: 0 });   // in an observer
//   state.value.count                                   // observable
//   state.patch({ count: 1 });  state.set({ ... })
//   state.key                                           // what the page keyed it by
//
//   config    the component's config: stateKey (chosen by RegisteredComp),
//             instanceId, compId
//   initial   the value a new state starts with (a mapping, or a factory of
//             one); ignored when the state exists
//
// the state is looked up by key on every render (without tracking the
// lookup), so a component follows its key when the page moves it: the
// edit layer re-keys the states of the lines it moves before the new body
// renders, and the hook then releases the state under its old key and
// holds the same object under the new one. a component that needs more
// than one state asks the store itself (useDocStores().compStateStore)
// with keys of its own under its stateKey.
export function useCompState(config = {}, initial = {}) {
  const { compStateStore } = useDocStores();
  const key = config.stateKey ?? `instance:${config.instanceId ?? ''}`;
  const compId = config.compId ?? '';
  const state = compStateStore.stateEnsure(key, { initial, compId });
  useEffect(() => {
    const stateHeld = compStateStore.stateHold(key, { initial, compId });
    return () => compStateStore.stateRelease(stateHeld);
    // initial is read once, when the state is created
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compStateStore, key, compId]);
  return state;
}

// A store of the block (a class instance holding what a component makes of its data:
// measured sizes, a camera, where the reader is) kept by the layer under the block's key
// and a name of the component's (`${config.stateKey}|${name}`), so the next mount of the
// block finds it as the last one left it, and paints what it painted in its first frame:
// the document entering or leaving edit mode renders another body, and every block of it
// is mounted again (doc_page_impl_mdx_comp_state.md#stores-kept-across-mounts).
//
//   const store = useCompStateStore(config, 'switch', () => new SwitchStore(...));
//
// a store serves one mount at a time: a second mount shown while the first one still is
// (two blocks reading one asset item) gets a store of its own, which is not kept. when
// the key changes under a mount (its block moved), the mount's store goes with it
const mountCountByStore = new WeakMap();

export function useCompStateStore(config = {}, name, create) {
  const { compStateStore } = useDocStores();
  const key = compStateStore && config.stateKey ? `${config.stateKey}|${name}` : '';
  const compId = config.compId ?? '';
  const storeRef = useRef(null);
  const [storeOwn, storeOwnSet] = useState(() => (key ? null : create()));
  const initial = () => storeRef.current ?? create();
  const store = storeOwn ?? compStateStore.stateEnsure(key, { initial, compId }).value;
  storeRef.current = store;
  useLayoutEffect(() => {
    if (!key || storeOwn) return undefined;
    const held = compStateStore.stateHold(key, { initial, compId });
    return () => compStateStore.stateRelease(held);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compStateStore, key, compId, storeOwn]);
  useLayoutEffect(() => {
    // the mount that showed it before has left by now (its layout effects are cleaned up
    // first, in the same commit); one still there is another place showing the block
    const count = mountCountByStore.get(store) ?? 0;
    if (count > 0 && !storeOwn) {
      storeOwnSet(create());
      return undefined;
    }
    mountCountByStore.set(store, count + 1);
    return () => mountCountByStore.set(store, (mountCountByStore.get(store) ?? 1) - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return store;
}

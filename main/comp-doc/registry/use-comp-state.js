import { useEffect } from 'react';
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

import { comparer, computed } from 'mobx';

// A computed value per key, made the first time the key is asked for and kept.
// An observer that reads it is drawn again only when the value changes (as
// its equals says), not whenever one of the observables it is derived from
// changes: the answers a block of the edit body draws from ("is this block
// being edited", "is its menu open") change for one block, while what they
// read (the session, the open menu) changes for the whole page.
// (doc_page_impl_edit.md#a-write-draws-only-what-changed)
//
//   const keyedGet = keyedComputedCreate();
//   keyedGet(key, derive, equals?)   the value of derive() for that key; derive
//                                    is the one given the first time, so it
//                                    may depend only on what the key names
//
// read outside an observer, the value is derived again at each read, as a
// computed value is that nothing observes.
export function keyedComputedCreate() {
  const computedByKey = new Map();
  return (key, derive, equals = comparer.default) => {
    let value = computedByKey.get(key);
    if (!value) {
      value = computed(derive, { equals });
      computedByKey.set(key, value);
    }
    return value.get();
  };
}

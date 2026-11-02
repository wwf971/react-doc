import { useEffect, useRef } from 'react';

// An event the page delivers to a component at its place in a document
// (doc_page_impl_event.md#events-delivered-to-components), subscribed for
// the whole mount:
//
//   useDocEventSubscribe(config, 'placeReveal', (data) => {
//     // data: what the page asks, with data.subject { sourcePath, blockLine, type }
//     return { code: 0 };     // taken; undefined: not this component's
//   });
//
//   config    the component's config: eventSubscribe, bound by RegisteredComp
//             to the component's document and block; a component rendered
//             without the boundary (no eventSubscribe) receives nothing
//   listener  called with the event's data; the latest one given is used,
//             so it may close over the component's current state
export function useDocEventSubscribe(config, type, listener) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  const subscribe = config?.eventSubscribe;
  useEffect(() => {
    if (typeof subscribe !== 'function' || !type) return undefined;
    return subscribe(type, (data) => listenerRef.current?.(data));
  }, [subscribe, type]);
}

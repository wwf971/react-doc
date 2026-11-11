import { createContext } from 'react';

// Two things a place of the page tells the links and the blocks rendered in it
// (doc_page_impl_nav.md#routing-a-navigation).

// The place answers navigation itself: a component showing documents of its own (an
// instance of a frontend object's mode) provides { handle(request) } around what it renders,
// and a link activated inside it asks this handler first, as the local stage of the event
// layer does. handle answers { code: 0 } when it showed the target, anything else to pass
// the request on to the routes.
export const DocNavScopeContext = createContext(null);

// The place was opened for a reader going somewhere else: the popup showing the home document
// of an object provides { target, hash, key, ref, version } (where the reader was going: the
// document, the place in it, its key in its object, the object), and what is rendered in it
// takes the reader there. null everywhere else.
export const DocNavArrivalContext = createContext(null);

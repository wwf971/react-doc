import { oaEventKindCreate } from '../oa-card/oa-card-data.js';

// An event (doc/event.md): the kind every event of the package is made from, as it is. Every value but
// what it is (its title) is optional:
//   title          what it is                            Team dinner
//   time           when, a span with its zone            2026-11-28 19:00~21:00 +09
//   people         who: a list                           [Sato, Tanaka]
//   place          where                                 Shibuya, Hachiko exit
//   description    a cell text (doc_page_impl_edit_cell.md): links and views of objects
//   statusHistory  the changes of its status, each at a moment with its zone (doc/event.md#its-status)
//   timeFormat, timeClock   optional: how its time is written (else the package's preferences)
// A Zoom reservation and a class of a course are events of special types (oaEventKindCreate)
export const EVENT_GENERAL = oaEventKindCreate({
	name: 'event',
	label: 'Event',
	sourceRaw: 'title: Event\ntime: ',
});

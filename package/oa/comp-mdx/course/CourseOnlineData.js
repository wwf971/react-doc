import { oaEventKindCreate } from '../oa-card/oa-card-data.js';

// A reservation of an online course (doc/course-online.md): one class of a course at a time, an event of
// a special type (doc/event.md): the fields of an event, its teacher after its time, the link of the
// class in the place of a place. Every value but the title is optional:
//   title        the name of the course                 Japanese for beginners
//   time         when the class is, a span with its zone   2026-11-26 19:00~20:30 +09
//   teacher      who gives it                           Ms. Sato
//   people       who else takes it                      [Tanaka]
//   url          the link of the class (Join)           https://meet.example.com/abc-defg
//   description  a cell text (doc_page_impl_edit_cell.md): links and views of objects
//   statusHistory   the changes of its status (doc/event.md#its-status)
//   timeFormat, timeClock   optional: how its time is written (else the package's preferences)
export const COURSE_ONLINE_RESERVATION = oaEventKindCreate({
	name: 'course',
	label: 'Online course reservation',
	fieldById: {
		title: { label: 'Course', placeholder: 'the name of the course' },
		time: { placeholder: 'e.g. 1126 1900 2030' },
		people: { placeholder: 'who else takes it: Tanaka' },
		place: null,
	},
	fieldAfterById: {
		time: [{ id: 'teacher', label: 'Teacher', placeholder: 'who gives it' }],
		people: [{ id: 'url', label: 'Link', placeholder: 'e.g. https://meet.example.com/abc-defg' }],
	},
	sourceRaw: 'title: Online course\ntime: ',
});

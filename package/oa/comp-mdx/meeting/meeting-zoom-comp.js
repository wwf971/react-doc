import { CalendarClock, TextCursorInput, Video } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { MeetingZoomInstance } from './MeetingZoomInstance.jsx';
import { MeetingZoomReservation } from './MeetingZoomReservation.jsx';
import { MEETING_ZOOM_INSTANCE, MEETING_ZOOM_RESERVATION, meetingSourceDefaultCreate } from './MeetingZoomData.js';

// The two Zoom cards in the component registry (main/doc_page_impl_mdx_comp.md#what-a-component-exposes):
// blocks of a document, offered by the insert menu and by the slash menu (meta.slashName: both are
// listed by /meeting-zoom), each with one edit mode of its own; a card of a card diagram may hold
// them (card-comp)
const editModeList = [
	{ id: 'fields', label: 'Fields', description: 'every value typed where it stands; the ones not written yet in the floating bar', icon: TextCursorInput, isDefault: true },
];

export const meetingZoomReservationDefine = compDefine(MeetingZoomReservation, {
	expose: {
		meta: {
			label: MEETING_ZOOM_RESERVATION.label,
			description: 'A Zoom meeting at a time: what, when, how long, the link joining it, a description.',
			isInsertCommon: true,
			slashName: 'meeting-zoom-reservation',
			slashAliasList: ['zoom-reservation'],
		},
		icon: CalendarClock,
		editModeList,
		sourceDefaultCreate: meetingSourceDefaultCreate(MEETING_ZOOM_RESERVATION),
	},
});

export const meetingZoomInstanceDefine = compDefine(MeetingZoomInstance, {
	expose: {
		meta: {
			label: MEETING_ZOOM_INSTANCE.label,
			description: 'A Zoom meeting joined at any time: its number and passcode, each copied by a button, a description.',
			isInsertCommon: true,
			slashName: 'meeting-zoom-instance',
			slashAliasList: ['zoom-instance'],
		},
		icon: Video,
		editModeList,
		sourceDefaultCreate: meetingSourceDefaultCreate(MEETING_ZOOM_INSTANCE),
	},
});

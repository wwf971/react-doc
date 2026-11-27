import { CalendarClock, Video } from '../../../../main/frontend/UICommon.js';
import { oaCardDefine } from '../oa-card/oa-card-define.js';
import { MeetingZoomInstance } from './MeetingZoomInstance.jsx';
import { MeetingZoomReservation } from './MeetingZoomReservation.jsx';
import { MEETING_ZOOM_INSTANCE, MEETING_ZOOM_RESERVATION } from './MeetingZoomData.js';

// The two Zoom cards in the component registry, as every card of the package (oa-card-define.js): both
// listed by /meeting-zoom in the slash menu. A reservation is at a time (a weekly timetable takes it)
export const meetingZoomReservationDefine = oaCardDefine(MeetingZoomReservation, MEETING_ZOOM_RESERVATION, {
	Icon: CalendarClock,
	meta: {
		description: 'A Zoom meeting at a time: what, when, the link joining it, a description.',
		slashName: 'meeting-zoom-reservation',
		slashAliasList: ['zoom-reservation'],
	},
});

export const meetingZoomInstanceDefine = oaCardDefine(MeetingZoomInstance, MEETING_ZOOM_INSTANCE, {
	Icon: Video,
	meta: {
		description: 'A Zoom meeting joined at any time: its number and passcode, each copied by a button, a description.',
		slashName: 'meeting-zoom-instance',
		slashAliasList: ['zoom-instance'],
	},
});

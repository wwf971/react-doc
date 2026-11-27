import { GraduationCap } from '../../../../main/frontend/UICommon.js';
import { oaCardDefine } from '../oa-card/oa-card-define.js';
import { CourseOnlineReservation } from './CourseOnlineReservation.jsx';
import { COURSE_ONLINE_RESERVATION } from './CourseOnlineData.js';

// The online course card in the component registry, as every card of the package (oa-card-define.js).
// It is at a time: a weekly timetable takes it
export const courseOnlineReservationDefine = oaCardDefine(CourseOnlineReservation, COURSE_ONLINE_RESERVATION, {
	Icon: GraduationCap,
	meta: {
		description: 'A class of an online course at a time: the course, when, who gives it, the link of the class, a description.',
		slashName: 'course-online-reservation',
		slashAliasList: ['course-reservation', 'online-course'],
	},
});

import { CalendarDays } from '../../../../main/frontend/UICommon.js';
import { oaCardDefine } from '../oa-card/oa-card-define.js';
import { EventGeneral } from './EventGeneral.jsx';
import { EVENT_GENERAL } from './EventGeneralData.js';

// The event card in the component registry, as every card of the package (oa-card-define.js): at a
// time (a weekly timetable takes it), with a status kept as its history (expose.statusItem)
export const eventGeneralDefine = oaCardDefine(EventGeneral, EVENT_GENERAL, {
	Icon: CalendarDays,
	meta: {
		description: 'An event: what it is, when, who, where, and its status, every change of it kept with its moment.',
		slashName: 'event',
		slashAliasList: ['event-general'],
	},
});

import { CalendarRange, TextCursorInput } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { oaConfigPackage } from '../time/oa-config.js';
import { TimetableWeek } from './TimetableWeek.jsx';
import { TIMETABLE_WEEK_EVERY, timetableHold, timetableRawBuild, timetableRead, timetableSourceDefaultCreate } from './TimetableWeekData.js';
import { oaDateIsValid, oaZoneParse, oaZoneText } from '../time/oa-time.js';

// The weekly timetable in the component registry (main/doc_page_impl_mdx_comp.md#what-a-component-exposes):
// a block of a document (the insert menu, /timetable-week), a card a card diagram may hold, and a
// component holding others (expose.hold, main/doc_page_impl_mdx_comp.md#a-component-holding-others): it
// takes a block of a component at a time (expose.timeItem) whose day is in its week, binds itself to the
// week of the first one when it has none, and lets an entry go. Its mode Fields is offered in place (a
// card of a diagram being edited draws it so: its entries moved, added, opened and removed on the
// table); its values (title, week, hours, zone) are offered one by one to the edit card of such a card.
// It reads the preferences of the package (the first day of a week, the clock: config.packageConfig)
const timetableFieldList = [
	{ id: 'title', label: 'Title', placeholder: 'Week' },
	{ id: 'week', label: 'Week', placeholder: 'its first day (2026-11-23), "every", or empty' },
	{ id: 'hours', label: 'Hours shown', placeholder: '08:00~20:00' },
	{ id: 'zone', label: 'Zone', placeholder: 'e.g. +09; empty: its first card\'s' },
];

export const timetableWeekDefine = compDefine(TimetableWeek, {
	expose: {
		meta: {
			label: 'Weekly timetable',
			description: 'Seven days of hours holding cards at a time (meetings, courses), each where its own time is; bound to a week, or to every week.',
			isInsertCommon: true,
			slashName: 'timetable-week',
			slashAliasList: ['timetable'],
			configPackage: oaConfigPackage,
		},
		icon: CalendarRange,
		editModeList: [
			{ id: 'fields', label: 'Fields', description: 'its entries moved, added, opened and removed on the table; its title and week typed where they stand', icon: TextCursorInput, isDefault: true, isInPlace: true },
		],
		hold: timetableHold,
		dataFields: {
			fieldList: timetableFieldList,
			valueListGet: (data) => {
				const table = timetableRead(data);
				return {
					title: table.title,
					week: table.week.mode === 'bound' ? table.week.start : table.week.mode === 'every' ? TIMETABLE_WEEK_EVERY : '',
					hours: table.hoursWritten,
					zone: Number.isFinite(table.zone) ? oaZoneText(table.zone) : '',
				};
			},
			rawWithValue: (data, id, text) => {
				const table = timetableRead(data);
				const value = String(text ?? '').trim();
				if (id === 'title') return timetableRawBuild({ ...table, title: String(text ?? '') });
				if (id === 'week') return timetableRawBuild({ ...table, week: value === TIMETABLE_WEEK_EVERY ? { mode: 'every', start: '' } : oaDateIsValid(value) ? { mode: 'bound', start: value } : { mode: 'open', start: '' } });
				if (id === 'hours') return timetableRawBuild({ ...table, hoursWritten: value });
				if (id === 'zone') return timetableRawBuild({ ...table, zone: oaZoneParse(value) });
				return data.raw ?? '';
			},
		},
		nodeSizeDefault: { width: 560 },
		sourceDefaultCreate: () => timetableSourceDefaultCreate(),
	},
});

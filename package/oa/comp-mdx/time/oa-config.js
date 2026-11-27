import {
	OA_TIME_CLOCK_LIST, OA_TIME_LAYOUT_LIST, OA_TIME_PERIOD_MAP_DEFAULT, OA_TIME_PERIOD_PATTERN_TEXT, OA_TIME_PERIOD_WORD_MAP_DEFAULT, OA_WEEKDAY_LIST,
	oaDateToday, oaTimePeriodsBuild, oaZoneLocal,
} from './oa-time.js';

// The preferences of the package (doc/time.md#preferences): the config group of the package "oa"
// (main/doc_page_impl_config.md#package-level-config), declared once here and carried by every
// component of the package that writes a time (expose.meta.configPackage), so the page lists the
// group once and hands its values, resolved for the document, as config.packageConfig. Set them in
// any declaration of the page:
//
//   config:
//     packageConfig:
//       oa:
//         TimeClock: 12h
//         TimeWeekStart: sunday
//         TimePeriodMap:              # parts of a day, a month, a year: added, changed, or taken away (null)
//           lunch: day 11:30~14:00
//           fy: year 04-01~03-31
//         TimePeriodWordMap:          # other words typed for them
//           昼休み: lunch
//
// The two maps are stringMaps: every level adds to them entry by entry (the package's parts stay unless
// a level takes one away), so a doc page registers its own parts without repeating the package's.
// Another package reads them through the config service (configService.packageConfigGet('oa', path)),
// or carries this group on its own components to be handed them too.
export const oaConfigPackage = Object.freeze({
	name: 'oa',
	label: 'oa',
	description: 'How the cards of oa write a time, where a week starts, and the parts of a day, a month, a year a time may be said in.',
	configDefineList: Object.freeze([
		{
			key: 'TimeClock', type: 'enum', valueList: OA_TIME_CLOCK_LIST.map((one) => one.id), valueDefault: '24h',
			description: 'How a time of day is written in the cards of oa: 14:30 (24h) or 2:30 PM (12h). A card may name its own.',
		},
		{
			key: 'TimeFormat', type: 'enum', valueList: OA_TIME_LAYOUT_LIST.map((one) => one.id), valueDefault: 'full',
			description: 'How a card writes its time when it names no format of its own: full (Wed 2026-11-25 10:00), short (Wed 11-25 10:00), long (Wednesday, November 25, 2026), clock (10:00).',
		},
		{
			key: 'TimeWeekStart', type: 'enum', valueList: [...OA_WEEKDAY_LIST], valueDefault: 'monday',
			description: 'The first day of a week: the first column of a weekly timetable, where the week a first card binds it to starts, and what "week" typed in a time covers.',
		},
		{
			key: 'TimePeriodMap', type: 'stringMap', valueDefault: { ...OA_TIME_PERIOD_MAP_DEFAULT }, valuePattern: OA_TIME_PERIOD_PATTERN_TEXT,
			description: 'The parts a time may be said in: a name (one word), and its place in its unit, read conservatively: "day 17:00~22:00" (a part of a day; an end before the start is on the next day), "month 21~" (days of a month; no end: to the last), "year 12-01~02-29" (a part of a year; an end before the start is in the next year). null takes one away.',
		},
		{
			key: 'TimePeriodWordMap', type: 'stringMap', valueDefault: { ...OA_TIME_PERIOD_WORD_MAP_DEFAULT }, valuePattern: '^\\S+$',
			description: 'Other words typed for a part, and the part they stand for: 夕方: evening, 上旬: early. A time is written with the part\'s name.',
		},
	]),
});

const PREFERENCE_DEFAULT = Object.freeze(Object.fromEntries(oaConfigPackage.configDefineList.map((define) => [define.key, define.valueDefault])));

const mappingIs = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// the preferences a component of the package is handed (config.packageConfig), each one the default
// when the page says nothing (an app drawing the cards without the page's config). A map given is the
// page's, already merged over the package's by the levels of the config
export function oaPreferenceGet(config = {}) {
	const given = config?.packageConfig ?? {};
	const result = { ...PREFERENCE_DEFAULT };
	for (const define of oaConfigPackage.configDefineList) {
		const value = given[define.key];
		if (define.type === 'stringMap' ? mappingIs(value) : define.valueList.includes(value)) result[define.key] = value;
	}
	return result;
}

// the parts a time is said in, as the preferences give them (oaTimePeriodsBuild), for typing (strict:
// an unknown word is refused) and for placing a time
export function oaTimePeriodsOf(preference = PREFERENCE_DEFAULT) {
	return oaTimePeriodsBuild(preference?.TimePeriodMap ?? PREFERENCE_DEFAULT.TimePeriodMap, preference?.TimePeriodWordMap ?? PREFERENCE_DEFAULT.TimePeriodWordMap);
}

// what a time typed in a card is read with: the zone and the day of the browser for what is not
// typed and not kept, the first day of the week for a weekday typed over a day and for "week", the
// parts of the page
export function oaTimeParseOptionsOf(preference, base = null) {
	const zone = base?.zone ?? oaZoneLocal();
	return { base, zoneDefault: zone, today: oaDateToday(zone), weekStart: preference?.TimeWeekStart ?? 'monday', periods: oaTimePeriodsOf(preference) };
}

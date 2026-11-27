import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { OA_TIME_CLOCK_LIST, OA_TIME_LAYOUT_LIST, oaTimeFormat, oaTimeLengthText, oaTimeParse, oaTimeRangeText, oaTimeSpanIsSet, oaTimeTextOf } from '../time/oa-time.js';
import { oaTimeParseOptionsOf, oaTimePeriodsOf } from '../time/oa-config.js';
import { OA_EVENT_STATUS_LIST, oaStatusChangeAdd, oaStatusHistoryRead, oaStatusItemOf, oaStatusLatest } from '../status/oa-status.js';

// The data of every card of the package (doc/README.md#how-a-card-is-made): one mapping of yaml, the
// fields of a card given by its **kind**. What a card draws, what its edit mode types and what it
// exposes to the page are read and written here, so both directions stay in one place. A kind:
//   name, label     what it is ('reservation', 'Zoom meeting reservation')
//   typeList        what it is a special type of: ['event'] (oaEventKindCreate, doc/event.md)
//   fieldList       [{ id, label, placeholder, kind? }] in the order written, kind:
//                     text       (default) typed plain, no token, no slash (a link is full of "/")
//                     cellText   a text of the cell editing kit: its tokens (a link, a view of an object)
//                     time       a time span of oa-time.js: typed loosely, kept in one form, shown in a format
//                     list       names (people): typed as one text, "Sato, Tanaka"; kept as a list
//                     status     the history of its status (oa-status.js: statusList), never the status
//                                alone: a list of changes, each at a moment
//                     choice     a property, not a value: how the card is drawn (its time format), one of
//                                valueList, '' the package's preference; never drawn as a value
//   sourceRaw       the yaml of a new block
//   readMore(parsed, card)   optional: what an older form of its data says (a Zoom duration)
// In the card read, every field is a text but a status, which is its history (an array).
//
// The time of a card is written in the stored form ("2026-11-25 10:00~10:45 +09", oa-time.js) and
// shown in its format: its own (timeFormat, timeClock) or the package's preferences (oa-config.js).

export const OA_CARD_TIME_FORMAT_FIELD_LIST = Object.freeze([
	{
		id: 'timeFormat', label: 'Time format', kind: 'choice',
		valueList: OA_TIME_LAYOUT_LIST.map((one) => one.id), valueLabelById: Object.fromEntries(OA_TIME_LAYOUT_LIST.map((one) => [one.id, `${one.label}: ${one.example}`])),
		defaultLabel: 'The package\'s (TimeFormat)',
	},
	{
		id: 'timeClock', label: 'Clock', kind: 'choice',
		valueList: OA_TIME_CLOCK_LIST.map((one) => one.id), valueLabelById: Object.fromEntries(OA_TIME_CLOCK_LIST.map((one) => [one.id, `${one.label}: ${one.example}`])),
		defaultLabel: 'The package\'s (TimeClock)',
	},
]);

export const OA_CARD_DESCRIPTION_FIELD = Object.freeze({ id: 'description', label: 'Description', placeholder: 'what it is about', kind: 'cellText' });

// the fields of a kind that are values: drawn on the card, added and removed there
export function oaCardValueFieldList(kind) {
	return kind.fieldList.filter((field) => field.kind !== 'choice');
}

// the card a block holds: its yaml (data.raw), or fields given as props; every field a text
export function oaCardRead(kind, data = {}) {
	let value = {};
	if (typeof data.raw === 'string' && data.raw.trim()) {
		const parsed = yamlParse(data.raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
	}
	const card = {};
	for (const { id, kind: fieldKind } of kind.fieldList) {
		const one = value[id] ?? data[id];
		if (fieldKind === 'status') card[id] = oaStatusHistoryRead(one);
		else if (fieldKind === 'list') card[id] = Array.isArray(one) ? one.map(String).filter(Boolean).join(', ') : one === undefined || one === null ? '' : String(one);
		else card[id] = one === undefined || one === null ? '' : String(one);
	}
	kind.readMore?.(value, card);
	return card;
}

// the yaml of a card: the fields written, in their order; an empty one left out. isTrimmed false: a
// value written as it is (a field being typed elsewhere keeps the space typed last)
export function oaCardRawBuild(kind, card, { isTrimmed = true } = {}) {
	const value = {};
	for (const { id, kind: fieldKind } of kind.fieldList) {
		if (fieldKind === 'status') {
			const history = Array.isArray(card[id]) ? card[id] : [];
			if (history.length) value[id] = history.map((entry) => ({ status: entry.status, time: entry.time, ...(entry.by ? { by: entry.by } : {}) }));
			continue;
		}
		const written = String(card[id] ?? '');
		const text = written.trim();
		if (!text) continue;
		if (fieldKind === 'list') value[id] = oaCardListOf(written);
		else value[id] = isTrimmed ? text : written;
	}
	return Object.keys(value).length ? yamlStringify(value) : '';
}

// the names of a list typed as one text: "Sato, Tanaka" (a Japanese comma too)
export function oaCardListOf(text) {
	return String(text ?? '').split(/[,、，]/).map((one) => one.trim()).filter(Boolean);
}

// whether a value is written: a text not empty, a history with a change
export function oaCardValueIsSet(value) {
	return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? '').trim());
}

// the time of a card as a span, null when it has none or what is written is no time
export function oaCardSpanOf(card) {
	if (!card?.time) return null;
	const { span } = oaTimeParse(card.time);
	return oaTimeSpanIsSet(span) ? span : null;
}

// what the card shows for its time: { text, lengthText, rangeText, message }. text in the card's format
// (its own, else the package's preference); rangeText: the range a time not exact refers to (evening:
// 17:00–22:00, the page's parts); a time that cannot be read is shown as written, with why
export function oaCardTimeShownOf(card, preference = {}) {
	const written = String(card?.time ?? '').trim();
	if (!written) return { text: '', lengthText: '', rangeText: '', message: '' };
	const { span, message } = oaTimeParse(written);
	if (!span) return { text: written, lengthText: '', rangeText: '', message: message ?? '' };
	const format = oaCardFormatOf(card, preference);
	return { text: oaTimeFormat(span, format), lengthText: oaTimeLengthText(span), rangeText: oaTimeRangeText(span, oaTimePeriodsOf(preference), { clock: format.clock }), message: '' };
}

// the format a card writes its time in: { layout, clock }
export function oaCardFormatOf(card, preference = {}) {
	const layout = OA_TIME_LAYOUT_LIST.some((one) => one.id === card?.timeFormat) ? card.timeFormat : preference.TimeFormat ?? 'full';
	const clock = OA_TIME_CLOCK_LIST.some((one) => one.id === card?.timeClock) ? card.timeClock : preference.TimeClock ?? '24h';
	return { layout, clock };
}

// a value as the card keeps it, so what is typed is what is read: a time read loosely and kept in the
// stored form (what is not typed kept from the time it had); a description keeps its lines; anything
// else as typed, trimmed. preference: the package's (the first day of the week). A value that is not
// read is kept as typed
export function oaCardFieldNormalize(kind, id, text, { card = {}, preference = {} } = {}) {
	const field = kind.fieldList.find((one) => one.id === id);
	const value = String(text ?? '').trim();
	if (field?.kind === 'time') {
		const { span, message } = oaTimeParse(value, oaTimeParseOptionsOf(preference, oaCardSpanOf(card)));
		return message ? value : span ? oaTimeTextOf(span) : '';
	}
	if (field?.kind === 'cellText') return String(text ?? '').replace(/\s+$/, '');
	if (field?.kind === 'status') return Array.isArray(text) ? oaStatusHistoryRead(text) : [];
	if (field?.kind === 'list') return oaCardListOf(value).join(', ');
	if (field?.kind === 'choice') return field.valueList.includes(value) ? value : '';
	return kind.normalizeMore?.(id, value) ?? value;
}

// the fields of a kind as a component offers them to whoever edits its data value by value without
// drawing it (expose.dataFields, main/doc_page_impl_mdx_comp.md#what-a-component-exposes: the edit card
// of a card of a card diagram holding it)
//   fieldList                  [{ id, label, placeholder, isMultiline?, kind?: 'enum', valueList?,
//                              valueLabels?, isProperty? }]: the values, then the properties (a choice)
//   valueListGet(data)         { id: text }: what each holds, as the card reads it
//   rawWithValue(data, id, text)   the yaml with one value changed, written as typed (a time read)
//   a status is offered as a choice of the status it is at: one chosen is a change made now, never the
//   history written over
export function oaCardDataFieldsOf(kind) {
	const valueFieldList = oaCardValueFieldList(kind).map(({ id, label, placeholder, kind: fieldKind, statusList }) => (fieldKind === 'status'
		? { id, label, kind: 'enum', valueList: ['', ...statusList.map((one) => one.id)], valueLabels: { '': 'None yet', ...Object.fromEntries(statusList.map((one) => [one.id, one.label])) } }
		: { id, label, placeholder, ...(fieldKind === 'cellText' ? { isMultiline: true } : {}) }));
	const propertyFieldList = kind.fieldList.filter((field) => field.kind === 'choice').map((field) => ({
		id: field.id, label: field.label, kind: 'enum', isProperty: true,
		valueList: ['', ...field.valueList], valueLabels: { '': field.defaultLabel, ...field.valueLabelById },
	}));
	return {
		fieldList: [...valueFieldList, ...propertyFieldList],
		valueListGet: (data) => {
			const card = oaCardRead(kind, data);
			for (const field of kind.fieldList) if (field.kind === 'status') card[field.id] = oaStatusLatest(card[field.id])?.status ?? '';
			return card;
		},
		rawWithValue: (data, id, text) => {
			const card = oaCardRead(kind, data);
			const field = kind.fieldList.find((one) => one.id === id);
			if (field?.kind === 'status') {
				const status = String(text ?? '');
				if (!status || status === oaStatusLatest(card[id])?.status) return oaCardRawBuild(kind, card);
				return oaCardRawBuild(kind, { ...card, [id]: oaStatusChangeAdd(card[id], status) });
			}
			// a time is read as it is typed in the card; anything else is written as typed
			const value = field?.kind === 'time' || field?.kind === 'choice' ? oaCardFieldNormalize(kind, id, text, { card }) : String(text ?? '');
			return oaCardRawBuild(kind, { ...card, [id]: value }, { isTrimmed: false });
		},
	};
}

// what a card at a time tells whoever collects times (expose.timeItem, doc/time.md#a-card-at-a-time):
//   spanGet(data)          its span (oa-time.js), null when it says no time
//   spanSet(data, span)    its yaml with the span changed (a timetable moving it), the format kept
//   titleGet(data)         what it is called in a list of times
export function oaTimeItemOf(kind) {
	return Object.freeze({
		spanGet: (data) => oaCardSpanOf(oaCardRead(kind, data)),
		spanSet: (data, span) => oaCardRawBuild(kind, { ...oaCardRead(kind, data), time: span ? oaTimeTextOf(span) : '' }),
		titleGet: (data) => oaCardRead(kind, data).title || kind.label,
	});
}

// what a card at a status tells whoever reads it (expose.statusItem: oa-status.js), null for a kind without
export function oaCardStatusItemOf(kind) {
	const field = kind.fieldList.find((one) => one.kind === 'status');
	return field ? oaStatusItemOf({ read: (data) => oaCardRead(kind, data), fieldId: field.id, statusList: field.statusList }) : null;
}

// ---------- events (doc/event.md) ----------

// the fields every event has, in their order: what it is, when, who, where, a description, its status;
// how its time is written. A special type of event (a Zoom reservation, a class of a course) is made
// from them (oaEventKindCreate), so whatever reads an event reads it in any of them
export const OA_EVENT_FIELD = Object.freeze({
	title: { id: 'title', label: 'Event', placeholder: 'what it is' },
	time: { id: 'time', label: 'Time', placeholder: 'e.g. 1128 1900 2100', kind: 'time' },
	people: { id: 'people', label: 'People', placeholder: 'who: Sato, Tanaka', kind: 'list' },
	place: { id: 'place', label: 'Place', placeholder: 'where' },
	description: OA_CARD_DESCRIPTION_FIELD,
	statusHistory: { id: 'statusHistory', label: 'Status', kind: 'status', statusList: OA_EVENT_STATUS_LIST },
});

// a kind of event: the fields of an event, some of them changed or left out, others added where they go
//   fieldById     { id: field | null }: a field of the event changed (its label: Course), or left out (null)
//   fieldAfterById   { id: [field] }: fields of its own after a field of the event (a link after the people)
export function oaEventKindCreate({ name, label, fieldById = {}, fieldAfterById = {}, sourceRaw, readMore, normalizeMore }) {
	const fieldList = [];
	for (const [id, field] of Object.entries(OA_EVENT_FIELD)) {
		const own = id in fieldById ? fieldById[id] : field;
		if (own) fieldList.push(own === field ? field : { ...field, ...own });
		fieldList.push(...(fieldAfterById[id] ?? []));
	}
	fieldList.push(...OA_CARD_TIME_FORMAT_FIELD_LIST);
	return Object.freeze({ name, label, typeList: ['event'], fieldList, sourceRaw, ...(readMore ? { readMore } : {}), ...(normalizeMore ? { normalizeMore } : {}) });
}

// the source of a new block (expose.sourceDefaultCreate): the fields to fill, the title written
export function oaCardSourceDefaultCreate(kind) {
	return () => ({ lang: 'yaml', raw: kind.sourceRaw });
}

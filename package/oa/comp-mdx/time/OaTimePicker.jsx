import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { makeAutoObservable } from 'mobx';
import { DateView, SegmentedControl } from '@wwf971/react-comp-misc';
import { ChevronLeft, ChevronRight, Repeat, Trash2 } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { useEditOutsidePointer } from '../../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { ValueMenu } from '../../../cloud-dev-vis/comp-mdx/card-diagram/DiagramValueControls.jsx';
import {
	OA_WEEKDAY_LIST, oaDateAdd, oaDateDiff, oaDateToday, oaTimeClockRangeText, oaTimeFormat, oaTimeLengthText, oaTimeParse, oaTimeRangeText, oaTimeSpanCreate,
	oaTimeTextOf, oaWeekStartOf, oaWeekdayOf, oaZoneLocal, oaZoneParse, oaZoneText,
} from './oa-time.js';
import './OaTimePicker.css';

// The picker of a time (doc/time.md#choosing-a-time): what a card's time is set with, never a text to
// type alone. It floats under the time it sets; nothing of the card moves.
//
//   granularity   a segmented control: a time of day, a part of a day, days, a month, a year
//   a day         the calendar (DateView of react-comp-misc), its weeks from the first day of the week of
//                 the preferences; several days: a range on the same calendar
//   a time of day its start and its end chosen from the times of the day (ValueMenu of the card diagrams,
//                 searchable: type 19 to find 19:00), or a length of a few common ones
//   a part        the parts of the page (the preferences TimePeriodMap), each with the range it refers to
//   a month       its year stepped, its month in a grid of twelve; a part of it (early, mid, late, …)
//   a year        its year stepped; a part of it (spring, …, q4)
//   every week    a time of day or a part of a day on the day of the week of the day chosen, every week
//   its zone      chosen among the zones (whole hours, and the half hours in use)
//   typing        a short way only: what is typed is read as the time (oa-time.js) and shown in the
//                 picker, which stays the place it is set
//   Save, Cancel  Save (or Enter in the typed line, or a pointer going down outside) keeps it; Cancel
//                 or Escape leaves the time as it was; Remove takes the time away
//
//   anchorRef   what it floats under (the time on the card)
//   span        the time it starts from (null: none yet), preference: the package's (oa-config.js)
//   periods     the parts of the page (oaTimePeriodsOf)
//   onSave(span | null), onClose()
const TAB_LIST = Object.freeze([
	{ value: 'minute', label: 'Time of day' },
	{ value: 'part', label: 'Part of a day' },
	{ value: 'days', label: 'Days' },
	{ value: 'month', label: 'Month' },
	{ value: 'year', label: 'Year' },
]);
const LENGTH_LIST = Object.freeze([15, 30, 45, 60, 90, 120]);
const MONTH_SHORT_LIST = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value) => String(value).padStart(2, '0');
const clockKey = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const minuteOfKey = (key) => Number(key.slice(0, 2)) * 60 + Number(key.slice(3, 5));
// the times of a day at five minutes
const CLOCK_KEY_LIST = Array.from({ length: 288 }, (_, index) => clockKey(index * 5));
// the zones offered: whole hours, and the half and quarter hours in use
const ZONE_LIST = [...Array.from({ length: 27 }, (_, index) => (index - 12) * 60), -210, 210, 270, 330, 345, 390, 570, 630].sort((a, b) => a - b);

// the draft of the picker: what is chosen so far, of every granularity, so switching back and forth
// loses nothing
class OaTimePickerDraft {
	tab = 'minute';
	date = '';
	dateEnd = '';
	start = 600;
	end = 660;
	dayPeriod = '';
	monthDate = '';
	monthPeriod = '';
	year = 0;
	yearPeriod = '';
	zone = 0;
	isWeekly = false;
	visibleYear = 0;
	visibleMonth = 0;
	typed = '';
	typedMessage = '';

	constructor(span, { zoneDefault, weekStart }) {
		this.zone = span?.zone ?? zoneDefault;
		const today = oaDateToday(this.zone);
		this.date = span?.date || (Number.isInteger(span?.weekday) ? oaDateAdd(oaWeekStartOf(today, 0), span.weekday) : today);
		this.isWeekly = Boolean(span && !span.date && Number.isInteger(span.weekday));
		this.dateEnd = span?.dateEnd || '';
		if (Number.isFinite(span?.start)) {
			this.start = span.start;
			this.end = Number.isFinite(span.end) ? span.end : null;
		}
		this.monthDate = `${this.date.slice(0, 7)}-01`;
		this.year = Number(this.date.slice(0, 4));
		this.tab = !span ? 'minute' : span.granularity === 'minute' ? 'minute' : span.granularity === 'day' ? (span.period ? 'part' : 'days') : span.granularity;
		if (span?.granularity === 'day' && span.period) this.dayPeriod = span.period;
		if (span?.granularity === 'month') this.monthPeriod = span.period;
		if (span?.granularity === 'year') this.yearPeriod = span.period;
		this.visibleYear = Number(this.date.slice(0, 4));
		this.visibleMonth = Number(this.date.slice(5, 7));
		this.weekStart = weekStart;
		makeAutoObservable(this);
	}

	// the time chosen, as a span; null while a part of a day is to be chosen
	spanGet() {
		const at = this.isWeekly ? { weekday: oaWeekdayOf(this.date) } : { date: this.date };
		if (this.tab === 'minute') return oaTimeSpanCreate({ ...at, start: this.start, end: this.end, zone: this.zone });
		if (this.tab === 'part') return this.dayPeriod ? oaTimeSpanCreate({ granularity: 'day', ...at, period: this.dayPeriod, zone: this.zone }) : null;
		if (this.tab === 'days') return oaTimeSpanCreate({ granularity: 'day', date: this.date, dateEnd: this.dateEnd, zone: this.zone });
		if (this.tab === 'month') return oaTimeSpanCreate({ granularity: 'month', date: this.monthDate, period: this.monthPeriod, zone: this.zone });
		return oaTimeSpanCreate({ granularity: 'year', date: `${this.year}-01-01`, period: this.yearPeriod, zone: this.zone });
	}

	tabSet(tab) { this.tab = tab; if (tab === 'days' || tab === 'month' || tab === 'year') this.isWeekly = false; }
	daySet(date) { this.date = date; this.monthDate = `${date.slice(0, 7)}-01`; this.year = Number(date.slice(0, 4)); }
	rangeSet(date, dateEnd) { this.daySet(date); this.dateEnd = dateEnd && dateEnd > date ? dateEnd : ''; }
	monthMove(delta) {
		const index = this.visibleYear * 12 + this.visibleMonth - 1 + delta;
		this.visibleYear = Math.floor(index / 12);
		this.visibleMonth = (index % 12) + 1;
	}
	startSet(start) {
		const length = Number.isFinite(this.end) ? this.end - this.start : null;
		this.start = start;
		if (length !== null) this.end = start + length;
	}
	endSet(end) { this.end = end; }
	lengthSet(minute) { this.end = this.start + minute; }
	dayPeriodSet(name) { this.dayPeriod = name; }
	monthDateSet(monthDate) { this.monthDate = monthDate; }
	monthPeriodSet(name) { this.monthPeriod = name; }
	yearSet(year) { this.year = year; this.monthDate = `${year}-${this.monthDate.slice(5)}`; }
	yearPeriodSet(name) { this.yearPeriod = name; }
	zoneSet(zone) { this.zone = zone; }
	isWeeklySet(isWeekly) { this.isWeekly = isWeekly; }
	typedSet(text) { this.typed = text; this.typedMessage = ''; }
	typedMessageSet(message) { this.typedMessage = message; }

	// a time typed, read, and its parts put in the picker
	spanPut(span) {
		this.zone = span.zone;
		this.isWeekly = !span.date && Number.isInteger(span.weekday);
		if (span.date) this.daySet(span.date);
		else if (this.isWeekly) this.date = oaDateAdd(oaWeekStartOf(this.date, 0), span.weekday);
		this.dateEnd = span.dateEnd || '';
		if (span.granularity === 'minute') { this.tab = 'minute'; this.start = span.start; this.end = span.end; }
		else if (span.granularity === 'day') { this.tab = span.period ? 'part' : 'days'; this.dayPeriod = span.period; }
		else if (span.granularity === 'month') { this.tab = 'month'; this.monthDate = span.date; this.monthPeriod = span.period; }
		else { this.tab = 'year'; this.year = Number(span.date.slice(0, 4)); this.yearPeriod = span.period; }
		this.visibleYear = Number(this.date.slice(0, 4));
		this.visibleMonth = Number(this.date.slice(5, 7));
	}
}

const dateObjOf = (date) => (date ? { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) } : null);
const dateOfObj = (dateObj) => `${dateObj.year}-${pad(dateObj.month)}-${pad(dateObj.day)}`;

export const OaTimePicker = observer(function OaTimePicker({ anchorRef, span, preference, periods, onSave, onClose }) {
	const rootRef = useRef(null);
	const clock = preference?.TimeClock ?? '24h';
	const weekStart = preference?.TimeWeekStart ?? 'monday';
	const [draft] = useState(() => new OaTimePickerDraft(span, { zoneDefault: oaZoneLocal(), weekStart }));
	const spanChosen = draft.spanGet();
	const textBefore = span ? oaTimeTextOf(span) : '';
	const save = () => {
		const chosen = draft.spanGet();
		if (chosen && oaTimeTextOf(chosen) !== textBefore) onSave(chosen);
		onClose();
	};
	// a pointer going down elsewhere keeps what is chosen, as a value typed in the card is kept
	useEditOutsidePointer(rootRef, true, save);
	// Escape: the time as it was; first, before the editor of a diagram takes the key
	useEffect(() => {
		const keyDown = (event) => {
			if (event.key !== 'Escape' || event.target?.closest?.('.doc-edit-popup:not(.oa-time-picker)')) return;
			event.stopPropagation();
			event.preventDefault();
			onClose();
		};
		document.addEventListener('keydown', keyDown, true);
		return () => document.removeEventListener('keydown', keyDown, true);
	}, [onClose]);

	const clockLabelOf = (key) => oaTimeClockRangeText({ start: minuteOfKey(key) }, { clock });
	const clockLabels = Object.fromEntries(CLOCK_KEY_LIST.map((key) => [key, clockLabelOf(key)]));
	const endKeyList = CLOCK_KEY_LIST.filter((key) => minuteOfKey(key) > draft.start % 1440);
	const endKey = Number.isFinite(draft.end) ? clockKey(draft.end % 1440) : '';
	const partListOf = (unit) => [...periods.byName.values()].filter((one) => one.unit === unit);
	const rangeOf = (granularity, name) => {
		const at = granularity === 'day' ? { date: draft.date } : granularity === 'month' ? { date: draft.monthDate } : { date: `${draft.year}-01-01` };
		return oaTimeRangeText(oaTimeSpanCreate({ granularity, ...at, period: name, zone: draft.zone }), periods, { clock });
	};
	const chip = (key, label, isPressed, onPress, title = '') => (
		<button key={key} type="button" className="oa-time-chip" aria-pressed={isPressed} title={title || undefined} onClick={onPress}>{label}</button>
	);
	const calendar = (selectionMode) => (
		<DateView
			data={{
				visibleYear: draft.visibleYear, visibleMonth: draft.visibleMonth, selectionMode, firstDayOfWeek: weekStart === 'sunday' ? 'sunday' : 'monday',
				selectedDates: selectionMode === 'single' && draft.date ? [dateObjOf(draft.date)] : [],
				rangeBeginDate: selectionMode === 'range' ? dateObjOf(draft.date) : null,
				rangeEndDate: selectionMode === 'range' ? dateObjOf(draft.dateEnd || draft.date) : null,
				rangeAnchorDate: selectionMode === 'range' ? dateObjOf(draft.date) : null,
			}}
			onDataChangeRequest={(type, params) => {
				if (type === 'navigate-month') draft.monthMove(params.monthDelta);
				if (type !== 'selection-change') return;
				if (selectionMode === 'range' && params.nextRangeBeginDate) draft.rangeSet(dateOfObj(params.nextRangeBeginDate), params.nextRangeEndDate ? dateOfObj(params.nextRangeEndDate) : '');
				else if (params.clickedDate) draft.daySet(dateOfObj(params.clickedDate));
			}} />
	);
	const typedTake = () => {
		const { span: read, message } = oaTimeParse(draft.typed, { base: spanChosen, zoneDefault: draft.zone, today: oaDateToday(draft.zone), weekStart, periods });
		if (message) { draft.typedMessageSet(message); return; }
		if (read) { draft.spanPut(read); draft.typedSet(''); }
	};
	const summary = spanChosen ? [oaTimeFormat(spanChosen, { layout: 'full', clock }), oaTimeLengthText(spanChosen), oaTimeRangeText(spanChosen, periods, { clock })].filter(Boolean).join(' · ') : 'Choose a part of the day';
	const weeklyToggle = (
		<label className="oa-time-weekly" title="The same day of the week, every week: no date">
			<input type="checkbox" checked={draft.isWeekly} onChange={(event) => draft.isWeeklySet(event.target.checked)} />
			<Repeat aria-hidden="true" />Every {OA_WEEKDAY_LIST[oaWeekdayOf(draft.date)].replace(/^./, (letter) => letter.toUpperCase())}
		</label>
	);

	return (
		<AnchoredPopover anchorRef={anchorRef} isTracked className="oa-time-picker doc-edit-popup nodrag nopan">
			<div ref={rootRef} className="oa-time-picker-body" role="dialog" aria-label="Choose a time">
				<SegmentedControl data={{ valueSelected: draft.tab, segList: TAB_LIST }} config={{ widthModeSegment: 'auto' }}
					onEvent={(type, payload) => { const value = payload?.value ?? payload?.valueSelected ?? payload; if (TAB_LIST.some((one) => one.value === value)) draft.tabSet(value); }} />
				{draft.tab === 'minute' || draft.tab === 'part' || draft.tab === 'days' ? (
					<div className="oa-time-picker-main">
						{calendar(draft.tab === 'days' ? 'range' : 'single')}
						<div className="oa-time-picker-side">
							{draft.tab === 'minute' ? (
								<>
									<span className="oa-time-label">Start</span>
									<ValueMenu label="The start" value={clockKey(draft.start % 1440)} values={CLOCK_KEY_LIST} valueLabels={clockLabels} isSearchable onChange={(key) => draft.startSet(minuteOfKey(key))} />
									<span className="oa-time-label">End</span>
									<ValueMenu label="The end" value={endKey} values={['', ...endKeyList]} valueLabels={{ '': 'No end', ...clockLabels }} isSearchable onChange={(key) => draft.endSet(key ? minuteOfKey(key) : null)} />
									<span className="oa-time-label">Length</span>
									<span className="oa-time-chip-list">
										{LENGTH_LIST.map((minute) => chip(`length-${minute}`, minute < 60 ? `${minute} min` : `${minute / 60} h`, Number.isFinite(draft.end) && draft.end - draft.start === minute, () => draft.lengthSet(minute)))}
									</span>
									{weeklyToggle}
								</>
							) : draft.tab === 'part' ? (
								<>
									<span className="oa-time-label">Part of the day</span>
									<span className="oa-time-chip-list is-column">
										{partListOf('day').map((one) => chip(one.name, <><strong>{one.name}</strong><small>{rangeOf('day', one.name)}</small></>, draft.dayPeriod === one.name, () => draft.dayPeriodSet(one.name)))}
									</span>
									{weeklyToggle}
								</>
							) : (
								<>
									<span className="oa-time-label">Days</span>
									<span className="oa-time-note">Click a first day, then a last one.</span>
									<span className="oa-time-chip-list">
										{chip('one', 'One day', !draft.dateEnd, () => draft.rangeSet(draft.date, ''))}
										{chip('week', 'Its week', draft.dateEnd !== '' && oaDateDiff(draft.date, draft.dateEnd) === 6 && draft.date === oaWeekStartOf(draft.date, weekStart), () => { const first = oaWeekStartOf(draft.date, weekStart); draft.rangeSet(first, oaDateAdd(first, 6)); })}
									</span>
								</>
							)}
						</div>
					</div>
				) : (
					<div className="oa-time-picker-coarse">
						<span className="oa-time-year">
							<button type="button" className="doc-button-icon" aria-label="The year before" onClick={() => draft.yearSet(draft.year - 1)}><ChevronLeft size={14} /></button>
							<strong>{draft.year}</strong>
							<button type="button" className="doc-button-icon" aria-label="The year after" onClick={() => draft.yearSet(draft.year + 1)}><ChevronRight size={14} /></button>
						</span>
						{draft.tab === 'month' ? (
							<>
								<span className="oa-time-month-grid">
									{MONTH_SHORT_LIST.map((label, index) => chip(label, label, draft.monthDate === `${draft.year}-${pad(index + 1)}-01`, () => draft.monthDateSet(`${draft.year}-${pad(index + 1)}-01`)))}
								</span>
								<span className="oa-time-label">Part of the month</span>
								<span className="oa-time-chip-list">
									{chip('whole', 'The whole month', !draft.monthPeriod, () => draft.monthPeriodSet(''))}
									{partListOf('month').map((one) => chip(one.name, <><strong>{one.name}</strong><small>{rangeOf('month', one.name)}</small></>, draft.monthPeriod === one.name, () => draft.monthPeriodSet(one.name)))}
								</span>
							</>
						) : (
							<>
								<span className="oa-time-label">Part of the year</span>
								<span className="oa-time-chip-list">
									{chip('whole', 'The whole year', !draft.yearPeriod, () => draft.yearPeriodSet(''))}
									{partListOf('year').map((one) => chip(one.name, <><strong>{one.name}</strong><small>{rangeOf('year', one.name)}</small></>, draft.yearPeriod === one.name, () => draft.yearPeriodSet(one.name)))}
								</span>
							</>
						)}
					</div>
				)}
				<div className="oa-time-picker-line">
					<span className="oa-time-label">Zone</span>
					<ValueMenu label="The zone" value={oaZoneText(draft.zone)} values={ZONE_LIST.map(oaZoneText)} isSearchable onChange={(text) => draft.zoneSet(oaZoneParse(text) ?? draft.zone)} />
					<input className="oa-time-typed" value={draft.typed} placeholder="or type it: 1128 1900 2100, sat evening, nov late"
						aria-label="Type the time" onChange={(event) => draft.typedSet(event.target.value)}
						onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (draft.typed.trim()) typedTake(); else save(); } }} />
				</div>
				{draft.typedMessage ? <div className="oa-time-message" role="alert">{draft.typedMessage}</div> : null}
				<div className="oa-time-picker-foot">
					<span className="oa-time-summary" role="status">{summary}</span>
					{span ? <button type="button" className="doc-button" data-danger="" onClick={() => { onSave(null); onClose(); }}><Trash2 size={13} aria-hidden="true" />Remove</button> : null}
					<button type="button" className="doc-button" onClick={onClose}>Cancel</button>
					<button type="button" className="doc-button" data-primary="" disabled={!spanChosen} onClick={save}>Save</button>
				</div>
			</div>
		</AnchoredPopover>
	);
});

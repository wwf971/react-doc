import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { makeAutoObservable } from 'mobx';
import { CalendarDays, CalendarRange, Check, Eye, Repeat, Trash2, TriangleAlert } from '../../../../main/frontend/UICommon.js';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { compEditModeListGet, compIconGet, compSourceDefaultGet } from '../../../../main/comp-doc/registry/comp-expose.js';
import { DocEditBlockContext, DocEditBlockFloatContext } from '../../../../main/comp-doc/edit/DocEditDocContext.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { DocMenu, docMenuEntryBuild, docMenuSeparatorBuild } from '../../../../main/comp-doc/edit/DocMenu.jsx';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { useEditOutsidePointer } from '../../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { DateView } from '@wwf971/react-comp-misc';
import { oaDateAdd, oaTimeClockRangeText, oaTimeRangeText, oaTimeSpanDaysShift, oaTimeSpanInZone, oaWeekStartOf, oaZoneText, OA_WEEKDAY_LIST } from '../time/oa-time.js';
import { oaPreferenceGet, oaTimeParseOptionsOf, oaTimePeriodsOf } from '../time/oa-config.js';
import {
	TIMETABLE_STEP_MINUTE, timetableAllDayRowMapOf, timetableDayListOf, timetableEntryDataOf, timetableHoursOf, timetableLaneMapOf, timetablePlaceOf, timetableRawBuild, timetableRead,
	timetableSpanOfPlace, timetableWeekText, timetableZoneOf,
} from './TimetableWeekData.js';
import '../time/OaTimePicker.css';
import './TimetableWeek.css';

// A weekly timetable (doc/timetable-week.md): seven days of hours, the cards it holds placed by their
// own time at a precision of five minutes. It is a component holding others
// (main/doc_page_impl_mdx_comp.md#a-component-holding-others): each entry is a block of a component at
// a time (expose.timeItem: a Zoom reservation, an online course), kept whole in its data; the table
// draws it as a box of its day, and draws the component itself, as a document would, in a card
// floating over the box when it is clicked. In a card diagram the table and what it holds are one node.
//
// Read: a click on an entry shows its card (Join works there). Edited (the mode Fields: kept open in
// place in a card of a diagram being edited, a session with Save and Cancel in a document), everything
// is done on the table itself:
//   an entry     dragged in the table: moved to another day and time (five minutes); its bottom edge:
//                its end. Dragged out of the table (in a card diagram, whose card gives config.hold):
//                let go, a card of its own where it is dropped, or taken by what takes it there.
//                A click: its card, edited in place (its own values typed where they stand, written into
//                the table). A right click: Open, Delete
//   a free time  a click: the components at a time the page has, one added there for an hour
//   the title    typed where it stands
//   the week     typed where it stands (any day: its week); the head's right click: bound to dates,
//                every week (never bound), not bound yet (the first card at a day binds it)
// A card of the diagram dropped on the table is taken by the diagram (expose.hold of timetable-comp.js).
//
// What the table holds that it cannot place (no time of day, a day out of its week, a component the
// page lacks) is listed under the hours, never hidden.

const HOUR_EM = 2.6;
const DRAG_THRESHOLD_PX = 4;

class TimetableWeekUi {
	draftRaw = null;
	gesture = null;
	preview = null;
	outside = null;
	entryOpenKey = '';
	// the entry whose card a pointer going down on it just closed: the click ending there does not open it again
	entryClosedKey = '';
	menu = null;
	message = '';

	constructor() {
		makeAutoObservable(this, { gesture: false });
	}

	draftRawSet(raw) { this.draftRaw = raw; }
	previewSet(preview) { this.preview = preview; }
	outsideSet(outside) { this.outside = outside; }
	entryOpenSet(key) { this.entryOpenKey = key; }
	entryClosedKeySet(key) { this.entryClosedKey = key; }
	// a click on an entry: its card, or, open, closed
	entryClick(key) {
		if (this.entryClosedKey === key) { this.entryClosedKey = ''; return; }
		this.entryClosedKey = '';
		this.entryOpenKey = this.entryOpenKey === key ? '' : key;
	}
	menuSet(menu) { this.menu = menu; }
	messageSet(message) { this.message = message; }
}

const pad = (value) => String(value).padStart(2, '0');
const hourLabelOf = (hour, clock) => (clock === '12h' ? `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 || hour === 24 ? 'AM' : 'PM'}` : `${pad(hour)}:00`);
const weekdayShortOf = (weekday) => OA_WEEKDAY_LIST[weekday].slice(0, 1).toUpperCase() + OA_WEEKDAY_LIST[weekday].slice(1, 3);

export const TimetableWeek = observer(function TimetableWeek({ data = {}, config = {}, onEvent }) {
	const stores = useContext(StoreContext);
	const isEditing = config.isEdit === true;
	const isInPlace = config.edit?.isInPlace === true;
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const [ui] = useState(() => {
		const one = new TimetableWeekUi();
		one.draftRawSet(String(data.raw ?? ''));
		return one;
	});
	const rootRef = useRef(null);
	const daysRef = useRef(null);
	const entryElementByKey = useRef(new Map());
	const cellPlain = useCell({ config, tokenIdList: [], isStyled: false });
	// the table as it is now: the draft of a session, else the data (in place, the owner writes each change)
	const raw = isEditing && !isInPlace ? ui.draftRaw : String(data.raw ?? '');
	const isWritable = isEditing && !isLocked;
	const write = (rawNext) => {
		if (!isWritable || rawNext === raw) return;
		ui.messageSet('');
		if (!isInPlace) ui.draftRawSet(rawNext);
		void onEvent?.('editDraftChange', { raw: rawNext });
	};
	const preference = oaPreferenceGet(config);
	const weekStart = preference.TimeWeekStart;
	const clock = preference.TimeClock;
	// the parts of a day, a month, a year of the page (an entry at "evening" stands over its range)
	const periods = oaTimePeriodsOf(preference);
	const configDoc = stores?.sourceStore?.configDoc;
	const definitionGet = (name) => (name ? compDefinitionNormalize(compDefinitionGet(stores?.compById ?? {}, compIdResolve(configDoc, name))) ?? null : null);

	const table = timetableRead({ raw });
	const entryInfoList = table.entryList.map((entry, index) => {
		const definition = definitionGet(entry.comp);
		const timeItem = definition?.expose?.timeItem ?? null;
		const entryData = timetableEntryDataOf(entry);
		let span = null;
		try { span = timeItem?.spanGet(entryData) ?? null; } catch { span = null; }
		// its status, when it has one (expose.statusItem: the latest change of its history)
		let status = null;
		try { status = definition?.expose?.statusItem?.statusGet(entryData) ?? null; } catch { status = null; }
		return {
			key: String(index), index, entry, entryData, definition, timeItem, span, status,
			title: (timeItem?.titleGet?.(entryData)) || definition?.expose?.meta?.label || entry.comp,
			Icon: definition ? compIconGet(definition) : TriangleAlert,
		};
	});
	const spanByEntry = new Map(entryInfoList.map((info) => [info.entry, info.span]));
	const zone = timetableZoneOf(table, (entry) => spanByEntry.get(entry) ?? null);
	const dayList = timetableDayListOf(table, weekStart);
	const placeInfoList = entryInfoList.map((info) => {
		const place = !info.definition ? { reason: `no component ${info.entry.comp} on this page` } : !info.timeItem ? { reason: `${info.definition.expose?.meta?.label ?? info.entry.comp} is not at a time` } : timetablePlaceOf(table, info.span, { zone, weekStart, periods });
		return { ...info, place };
	});
	// in the hours (a time of day, a part of a day), in the row of whole days, nowhere (listed under)
	const placedList = placeInfoList.filter((info) => info.place.kind === 'box');
	const allDayList = placeInfoList.filter((info) => info.place.kind === 'allDay');
	const unplacedList = placeInfoList.filter((info) => !info.place.kind);
	const hours = timetableHoursOf(table, placedList.map((info) => info.place));
	const laneMap = timetableLaneMapOf(placedList.map((info) => ({ key: info.key, dayIndex: info.place.dayIndex, start: info.place.start, end: info.place.end })));
	const allDayRowMap = timetableAllDayRowMapOf(allDayList.map((info) => ({ key: info.key, dayIndex: info.place.dayIndex, dayIndexEnd: info.place.dayIndexEnd })));
	// a place in the hours as a share of their height: an entry and a label have a size of their own,
	// so an em of theirs is not an em of the hours
	const shareOf = (minute) => `${((minute - hours.start) / (hours.end - hours.start)) * 100}%`;
	const weekText = timetableWeekText(table, { zone, weekStart });

	// ---------- writing ----------

	const entryRawSet = (index, entryRaw) => write(timetableRawBuild({ ...table, entryList: table.entryList.map((entry, one) => (one === index ? { ...entry, raw: entryRaw } : entry)) }));
	const entryRemove = (index) => {
		if (ui.entryOpenKey === String(index)) ui.entryOpenSet('');
		write(timetableRawBuild({ ...table, entryList: table.entryList.filter((_, one) => one !== index) }));
	};
	// an entry moved to a place (a day column and minutes), its time written in its own zone
	const entryMove = (info, place) => {
		if (!info.timeItem || !info.span) return;
		let span = timetableSpanOfPlace(table, place, { zone, weekStart, spanBefore: info.span });
		span = oaTimeSpanInZone(span, info.span.zone);
		if (!info.place.isEndWritten && place.isEndKept !== true) span = { ...span, end: null };
		entryRawSet(info.index, info.timeItem.spanSet(info.entryData, span));
	};
	// an entry not at a time of day (whole days, a part of a day) moved by whole days, all else kept
	const entryShift = (info, dayCount) => {
		if (!info.timeItem || !info.span || !dayCount) return;
		entryRawSet(info.index, info.timeItem.spanSet(info.entryData, oaTimeSpanDaysShift(info.span, dayCount)));
	};
	// a component at a time added at a place, for an hour; its card opened
	const entryAdd = (compName, place) => {
		const definition = definitionGet(compName);
		const source = definition ? compSourceDefaultGet(definition, { compName }) : null;
		if (!definition?.expose?.timeItem || !source || source.text !== undefined) return;
		const span = timetableSpanOfPlace(table, place, { zone, weekStart });
		const entryRaw = definition.expose.timeItem.spanSet({ raw: source.raw ?? '', lang: source.lang ?? 'yaml' }, span);
		const next = { ...table, entryList: [...table.entryList, { comp: compName, lang: source.lang ?? 'yaml', raw: entryRaw, ...(source.props && Object.keys(source.props).length ? { props: source.props } : {}) }] };
		if (!Number.isFinite(table.zone) && !table.entryList.length) next.zone = zone;
		write(timetableRawBuild(next));
		ui.entryOpenSet(String(table.entryList.length));
	};
	const weekModeSet = (mode) => {
		if (mode === 'every') write(timetableRawBuild({ ...table, week: { mode: 'every', start: '' } }));
		else if (mode === 'open') write(timetableRawBuild({ ...table, week: { mode: 'open', start: '' } }));
		else if (mode === 'bound') {
			const dated = placeInfoList.find((info) => info.span?.date);
			const day = dated ? oaTimeSpanInZone(dated.span, zone).date : oaTimeParseOptionsOf(preference, { zone }).today;
			write(timetableRawBuild({ ...table, week: { mode: 'bound', start: oaWeekStartOf(day, weekStart) } }));
		}
	};
	// the week chosen: any day of it (a calendar); refused, with why, while it holds a card at a day outside
	// that week. -> '' when bound, else the reason
	const weekBind = (day) => {
		const start = oaWeekStartOf(day, weekStart);
		const next = { ...table, week: { mode: 'bound', start } };
		const outside = placeInfoList.find((info) => info.span?.date && timetablePlaceOf(next, info.span, { zone, weekStart, periods }).reason);
		if (outside) return `"${outside.title}" is not in the week of ${start.slice(5)}: move it out first`;
		write(timetableRawBuild(next));
		return '';
	};

	// ---------- an entry dragged ----------

	const placeAtPointer = (event, gesture) => {
		const rect = daysRef.current?.getBoundingClientRect();
		if (!rect) return null;
		const pxPerMinute = rect.height / (hours.end - hours.start);
		const minuteAt = hours.start + (event.clientY - rect.top) / pxPerMinute;
		const snap = (minute) => Math.round(minute / TIMETABLE_STEP_MINUTE) * TIMETABLE_STEP_MINUTE;
		const dayIndex = Math.min(6, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 7)));
		// not at a time of day: moved by whole days only, kept inside the week
		if (gesture.kind === 'shift') {
			const width = gesture.dayIndexEnd - gesture.dayIndex;
			const from = Math.min(6 - width, Math.max(0, gesture.dayIndex + dayIndex - gesture.grabDayIndex));
			return { dayIndex: from, dayIndexEnd: from + width, start: gesture.start, end: gesture.end, shift: from - gesture.dayIndex };
		}
		if (gesture.kind === 'resize') {
			const end = Math.min(24 * 60, Math.max(gesture.start + TIMETABLE_STEP_MINUTE, snap(minuteAt)));
			return { dayIndex: gesture.dayIndex, start: gesture.start, end, isEndKept: true };
		}
		const start = Math.min(24 * 60 - gesture.length, Math.max(0, snap(minuteAt - gesture.grab)));
		return { dayIndex, start, end: start + gesture.length };
	};
	const pointerDown = (event, info, kind) => {
		if (!isWritable || event.button !== 0) return;
		// the canvas around does not take it: no node dragged, no pan
		event.stopPropagation();
		const rect = daysRef.current?.getBoundingClientRect();
		const place = info.place;
		const pxPerMinute = rect ? rect.height / (hours.end - hours.start) : 1;
		// an entry not at a time of day (whole days, a part of a day) is moved by whole days
		const kindMoved = kind === 'move' && (place.kind === 'allDay' || place.isApproximate) ? 'shift' : kind;
		ui.gesture = {
			key: info.key, kind: kindMoved, pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, isDragging: false,
			grab: place.kind === 'box' && rect ? hours.start + (event.clientY - rect.top) / pxPerMinute - place.start : 0,
			length: place.kind === 'box' ? place.end - place.start : 60,
			start: place.start, end: place.end, dayIndex: place.dayIndex, dayIndexEnd: place.dayIndexEnd ?? place.dayIndex,
			grabDayIndex: rect ? Math.min(6, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 7))) : place.dayIndex,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
		// Escape gives the drag up, wherever the focus is
		const keyDown = (keyEvent) => {
			if (keyEvent.key !== 'Escape' || !ui.gesture) return;
			keyEvent.stopPropagation();
			ui.gesture = null;
			ui.previewSet(null);
			ui.outsideSet(null);
			config.hold?.dragEnd?.();
		};
		window.addEventListener('keydown', keyDown, true);
		const release = () => { window.removeEventListener('keydown', keyDown, true); window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true); };
		window.addEventListener('pointerup', release, true);
		window.addEventListener('pointercancel', release, true);
	};
	const pointerMove = (event) => {
		const gesture = ui.gesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		if (!gesture.isDragging) {
			if (Math.hypot(event.clientX - gesture.x0, event.clientY - gesture.y0) < DRAG_THRESHOLD_PX) return;
			gesture.isDragging = true;
			ui.entryOpenSet('');
			ui.menuSet(null);
		}
		const rootRect = rootRef.current?.getBoundingClientRect();
		const isOutside = gesture.kind !== 'resize' && rootRect && (event.clientX < rootRect.left || event.clientX > rootRect.right || event.clientY < rootRect.top || event.clientY > rootRect.bottom);
		if (isOutside) {
			ui.previewSet(null);
			const answer = config.hold?.dragMove?.(gesture.key, { clientX: event.clientX, clientY: event.clientY });
			ui.outsideSet({ x: event.clientX, y: event.clientY, text: config.hold ? answer?.text ?? 'Let go: a card of its own here' : 'Taken out only in a card diagram', isRefused: !config.hold || answer?.isRefused === true });
			return;
		}
		if (ui.outside) { ui.outsideSet(null); config.hold?.dragMove?.(gesture.key, null); }
		ui.previewSet(Number.isInteger(gesture.dayIndex) ? { key: gesture.key, kind: gesture.kind, ...placeAtPointer(event, gesture) } : null);
	};
	const pointerEnd = (event, isCancelled = false) => {
		const gesture = ui.gesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		ui.gesture = null;
		const preview = ui.preview;
		const outside = ui.outside;
		ui.previewSet(null);
		ui.outsideSet(null);
		const info = placeInfoList.find((one) => one.key === gesture.key);
		if (!gesture.isDragging) {
			// a click: its card
			if (!isCancelled && info) ui.entryClick(info.key);
			return;
		}
		config.hold?.dragEnd?.();
		if (isCancelled || !info) return;
		if (outside) {
			if (!config.hold) { ui.messageSet('An entry is taken out of the timetable in a card diagram; here, delete it from its right-click menu.'); return; }
			void Promise.resolve(config.hold.release(gesture.key, { clientX: event.clientX, clientY: event.clientY })).then((result) => {
				if (result && result.code !== 0) ui.messageSet(result.message ?? 'It was not let go.');
			});
			return;
		}
		if (preview?.kind === 'shift') entryShift(info, preview.shift);
		else if (preview && (preview.dayIndex !== info.place.dayIndex || preview.start !== info.place.start || preview.end !== info.place.end)) entryMove(info, preview);
	};
	const gestureHandlers = (info, kind) => ({
		onPointerDown: (event) => pointerDown(event, info, kind),
		onPointerMove: pointerMove,
		onPointerUp: (event) => pointerEnd(event),
		onPointerCancel: (event) => pointerEnd(event, true),
	});

	// ---------- menus ----------

	const addableList = useMemo(() => {
		const result = [];
		const compRegistry = configDoc?.compRegistry ?? {};
		for (const [tagName] of Object.entries(compRegistry)) {
			const definition = definitionGet(tagName);
			if (definition?.expose?.timeItem && definition.expose.sourceDefaultCreate && !result.some((one) => one.definition === definition)) result.push({ tagName, definition });
		}
		return result;
	}, [configDoc, stores?.compById]); // eslint-disable-line react-hooks/exhaustive-deps
	const slotClick = (event, dayIndex) => {
		if (!isWritable || event.target.closest('.oa-timetable-entry')) return;
		const rect = daysRef.current?.getBoundingClientRect();
		if (!rect) return;
		const minuteAt = hours.start + ((event.clientY - rect.top) / rect.height) * (hours.end - hours.start);
		const start = Math.min(23 * 60, Math.floor(minuteAt / 30) * 30);
		ui.entryOpenSet('');
		ui.menuSet({ kind: 'slot', point: { x: event.clientX, y: event.clientY }, place: { dayIndex, start, end: start + 60 } });
	};
	const contextMenuOf = (kind, info = null) => (event) => {
		if (!isWritable) return;
		event.preventDefault();
		event.stopPropagation();
		ui.menuSet({ kind, point: { x: event.clientX, y: event.clientY }, key: info?.key ?? '' });
	};
	const menu = ui.menu;
	const menuInfo = menu?.key ? placeInfoList.find((info) => info.key === menu.key) : null;
	const hasDatedEntry = placeInfoList.some((info) => info.span?.date);
	const menuItemList = !menu ? [] : menu.kind === 'slot' ? (addableList.length
		? addableList.map(({ tagName, definition }) => docMenuEntryBuild(`add:${tagName}`, compIconGet(definition), `${definition.expose?.meta?.label ?? tagName}, ${oaTimeClockRangeText({ start: menu.place.start, end: menu.place.end }, { clock })}`, { title: 'Added here, its card open' }))
		: [docMenuEntryBuild('none', null, 'No component at a time on this page', { reason: 'a component tells its time through expose.timeItem' })])
		: menu.kind === 'entry' && menuInfo ? [
			docMenuEntryBuild('open', Eye, 'Open its card'),
			docMenuSeparatorBuild('rule'),
			docMenuEntryBuild('delete', Trash2, `Delete ${menuInfo.title}`, { isDanger: true }),
		] : menu.kind === 'week' ? [
			docMenuEntryBuild('week:bound', table.week.mode === 'bound' ? Check : CalendarDays, 'Bound to the dates of a week'),
			docMenuEntryBuild('week:every', table.week.mode === 'every' ? Check : Repeat, 'Every week: never bound to dates'),
			docMenuEntryBuild('week:open', table.week.mode === 'open' ? Check : null, 'Not bound yet: the first card at a day binds it', { reason: table.week.mode !== 'open' && hasDatedEntry ? 'it holds cards at days: they would bind it at once' : '' }),
		] : [];
	const menuChoose = (choice) => {
		const current = ui.menu;
		ui.menuSet(null);
		const [action, value] = String(choice).split(':');
		if (action === 'add' && current?.place) entryAdd(value, current.place);
		else if (action === 'open') ui.entryOpenSet(current.key);
		else if (action === 'delete' && menuInfo) entryRemove(menuInfo.index);
		else if (action === 'week') weekModeSet(value);
	};

	// ---------- drawing ----------

	// what an entry says of its time: a time of day, a part of a day (its range on hover), whole days
	const entryTimeText = (info, place, isPreview) => {
		if (place.kind === 'allDay' || info.place.kind === 'allDay') return info.span?.dateEnd ? `${info.span.date.slice(5)} – ${info.span.dateEnd.slice(5)}` : 'all day';
		if (info.place.isApproximate) return info.span.period;
		return oaTimeClockRangeText({ start: place.start, end: place.isEndWritten === false && !isPreview ? null : place.end }, { clock });
	};
	const entryTitle = (info) => {
		const rangeText = info.span ? oaTimeRangeText(info.span, periods, { clock }) : '';
		const timeText = info.place.kind === 'box' && !info.place.isApproximate ? oaTimeClockRangeText(info.place, { clock }) : `${entryTimeText(info, info.place)}${rangeText ? ` (${rangeText})` : ''}`;
		return `${info.title}: ${timeText} ${oaZoneText(zone)}${info.status ? `, ${info.status.label}` : ''}`;
	};
	// the head of an entry: its status, its mark, its title
	const entryHead = (info) => {
		const Icon = info.Icon;
		return (
			<span className="oa-timetable-entry-head">
				{info.status ? <span className="oa-timetable-entry-status" aria-label={info.status.label} /> : null}
				<Icon aria-hidden="true" />
				<span className="oa-timetable-entry-title">{info.title}</span>
			</span>
		);
	};
	const entryHandlers = (info) => ({
		...gestureHandlers(info, 'move'), onContextMenu: contextMenuOf('entry', info),
		onClick: (event) => { event.stopPropagation(); if (!isWritable) ui.entryClick(info.key); },
		onKeyUp: (event) => { if (event.key === 'Enter') ui.entryOpenSet(info.key); },
	});
	const entryRef = (info) => (element) => { if (element) entryElementByKey.current.set(info.key, element); else entryElementByKey.current.delete(info.key); };
	// an entry of whole days, in their row: across its days
	const entryAllDay = (info, { isPreview = false, place = info.place } = {}) => (
		<div key={isPreview ? `preview-${info.key}` : info.key} ref={isPreview ? undefined : entryRef(info)}
			className={`oa-timetable-entry is-all-day${isPreview ? ' is-preview' : ''}${ui.preview?.key === info.key && !isPreview ? ' is-dragged' : ''}${ui.entryOpenKey === info.key ? ' is-open' : ''}${isWritable ? ' nodrag nopan' : ''}`}
			style={{ gridColumn: `${place.dayIndex + 1} / ${place.dayIndexEnd + 2}`, gridRow: isPreview ? `${(allDayRowMap.get(info.key) ?? 0) + 1}` : `${(allDayRowMap.get(info.key) ?? 0) + 1}` }}
			title={entryTitle(info)} data-status={info.status?.id} data-tone={info.status?.tone}
			role={isPreview ? undefined : 'button'} tabIndex={isPreview ? undefined : 0} {...(isPreview ? {} : entryHandlers(info))}>
			{entryHead(info)}
			{info.span?.dateEnd ? <span className="oa-timetable-entry-time">{entryTimeText(info, place)}</span> : null}
		</div>
	);
	const entryBox = (info, { isPreview = false, place = info.place } = {}) => {
		const lane = laneMap.get(info.key) ?? { lane: 0, laneCount: 1 };
		const isDragged = ui.preview?.key === info.key || (ui.outside && ui.gesture?.key === info.key);
		const length = place.end - place.start;
		return (
			<div key={isPreview ? `preview-${info.key}` : info.key}
				ref={isPreview ? undefined : entryRef(info)}
				className={`oa-timetable-entry${isPreview ? ' is-preview' : ''}${isDragged && !isPreview ? ' is-dragged' : ''}${ui.entryOpenKey === info.key ? ' is-open' : ''}${isWritable ? ' nodrag nopan' : ''}${length < 40 ? ' is-short' : ''}${!isPreview && lane.laneCount > 1 ? ' is-narrow' : ''}${info.place.isApproximate ? ' is-approximate' : ''}`}
				style={{
					top: shareOf(place.start), height: `${(length / (hours.end - hours.start)) * 100}%`,
					left: isPreview ? '0%' : `${(lane.lane / lane.laneCount) * 100}%`, width: isPreview ? '100%' : `${100 / lane.laneCount}%`,
				}}
				title={entryTitle(info)}
				data-status={info.status?.id} data-tone={info.status?.tone}
				role={isPreview ? undefined : 'button'} tabIndex={isPreview ? undefined : 0}
				{...(isPreview ? {} : entryHandlers(info))}>
				{entryHead(info)}
				<span className="oa-timetable-entry-time">{entryTimeText(info, place, isPreview)}</span>
				{isWritable && !isPreview && !info.place.isApproximate ? <span className="oa-timetable-entry-resize" aria-label="Drag: its end" {...gestureHandlers(info, 'resize')} /> : null}
			</div>
		);
	};
	const previewInfo = ui.preview ? placeInfoList.find((info) => info.key === ui.preview.key) : null;
	const entryOpen = ui.entryOpenKey ? placeInfoList.find((info) => info.key === ui.entryOpenKey) : null;
	const hourList = [];
	for (let hour = hours.start / 60; hour <= hours.end / 60; hour += 1) hourList.push(hour);

	return (
		<div ref={rootRef} className="oa-timetable not-prose" data-editing={isEditing ? '' : undefined} data-week={table.week.mode}>
			<div className="oa-timetable-head" onContextMenu={contextMenuOf('week')}>
				<span className="oa-timetable-tile" aria-hidden="true"><CalendarRange /></span>
				<div className="oa-timetable-head-main">
					<span className="oa-timetable-title">
						{isWritable
							? <CellField cell={cellPlain} value={table.title} isEditable placeholder="the title of the timetable" fieldKey={`${config.instanceId ?? 'timetable'}:title`} ariaLabel="Title" className={`oa-timetable-field is-title${stores?.cellStore?.fieldIsOpen(`${config.instanceId ?? 'timetable'}:title`) ? ' nodrag nopan' : ''}`}
								onCommit={(text) => write(timetableRawBuild({ ...table, title: String(text ?? '') }))} />
							: table.title || 'Week'}
					</span>
					<span className="oa-timetable-week">
						{table.week.mode === 'every' ? <Repeat aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
						{isWritable
							? <TimetableWeekValue text={weekText} table={table} weekStart={weekStart} hasDatedEntry={placeInfoList.some((info) => info.span?.date)}
								today={oaTimeParseOptionsOf(preference, { zone }).today} onBind={weekBind} onModeSet={weekModeSet} />
							: weekText}
					</span>
				</div>
			</div>
			{table.message ? <div className="oa-timetable-message" role="alert"><TriangleAlert aria-hidden="true" />{table.message}</div> : null}
			{ui.message ? <div className="oa-timetable-message" role="alert" onClick={() => ui.messageSet('')}><TriangleAlert aria-hidden="true" />{ui.message}</div> : null}
			<div className="oa-timetable-grid">
				<div className="oa-timetable-corner" />
				{dayList.map((day) => (
					<div key={day.index} className="oa-timetable-day-head" data-weekend={day.weekday === 0 || day.weekday === 6 ? '' : undefined}>
						<span className="oa-timetable-day-name">{weekdayShortOf(day.weekday)}</span>
						{day.date ? <span className="oa-timetable-day-date">{day.date.slice(5)}</span> : null}
					</div>
				))}
				{allDayList.length || previewInfo?.place.kind === 'allDay' ? (
					<>
						<div className="oa-timetable-all-day-name">all day</div>
						<div className="oa-timetable-all-day">
							{allDayList.map((info) => entryAllDay(info))}
							{previewInfo && ui.preview.kind === 'shift' && previewInfo.place.kind === 'allDay' ? entryAllDay(previewInfo, { isPreview: true, place: ui.preview }) : null}
						</div>
					</>
				) : null}
				<div className="oa-timetable-axis" style={{ height: `${((hours.end - hours.start) / 60) * HOUR_EM}em` }}>
					{hourList.map((hour) => <span key={hour} className="oa-timetable-hour" style={{ top: shareOf(hour * 60) }}>{hourLabelOf(hour, clock)}</span>)}
				</div>
				<div ref={daysRef} className="oa-timetable-days" style={{ height: `${((hours.end - hours.start) / 60) * HOUR_EM}em`, '--oa-timetable-hour': `${HOUR_EM}em` }}>
					{dayList.map((day) => (
						<div key={day.index} className={`oa-timetable-day${isWritable ? ' is-writable' : ''}`} data-weekend={day.weekday === 0 || day.weekday === 6 ? '' : undefined}
							onClick={(event) => slotClick(event, day.index)}>
							{placedList.filter((info) => info.place.dayIndex === day.index).map((info) => entryBox(info))}
							{previewInfo && previewInfo.place.kind === 'box' && ui.preview.dayIndex === day.index ? entryBox(previewInfo, { isPreview: true, place: { ...ui.preview, isEndWritten: true } }) : null}
						</div>
					))}
				</div>
			</div>
			{unplacedList.length ? (
				<div className="oa-timetable-unplaced">
					<span className="oa-timetable-unplaced-name">Not in the hours</span>
					{unplacedList.map((info) => {
						const Icon = info.Icon;
						return (
							<span key={info.key} ref={(element) => { if (element) entryElementByKey.current.set(info.key, element); }}
								className={`oa-timetable-unplaced-item${isWritable ? ' nodrag nopan' : ''}`} role="button" tabIndex={0} title={info.place.reason}
								{...gestureHandlers(info, 'move')} onContextMenu={contextMenuOf('entry', info)}
								onClick={(event) => { event.stopPropagation(); if (!isWritable) ui.entryClick(info.key); }}>
								<Icon aria-hidden="true" />{info.title}<span className="oa-timetable-unplaced-reason">{info.place.reason}</span>
							</span>
						);
					})}
				</div>
			) : null}
			{entryOpen && entryOpen.definition ? (
				<TimetableEntryCard key={entryOpen.key} info={entryOpen} anchorGet={() => entryElementByKey.current.get(entryOpen.key) ?? null} config={config} isWritable={isWritable}
					onRawChange={(entryRaw) => entryRawSet(entryOpen.index, entryRaw)} onClose={() => { ui.entryClosedKeySet(ui.entryOpenKey); ui.entryOpenSet(''); }} />
			) : null}
			{menu && menuItemList.length ? <DocMenu itemList={menuItemList} point={menu.point} onChoose={menuChoose} onClose={() => ui.menuSet(null)} /> : null}
			{ui.outside ? createPortal(
				<div className="oa-timetable-drag-chip" data-refused={ui.outside.isRefused ? '' : undefined} style={{ left: ui.outside.x + 14, top: ui.outside.y + 14 }}>
					{placeInfoList.find((info) => info.key === ui.gesture?.key)?.title ?? ''}
					<span className="oa-timetable-drag-chip-text">{ui.outside.text}</span>
				</div>, document.body) : null}
			{isEditing && !isInPlace ? (
				<EditFloatingPanel label="Weekly timetable"
					actions={<EditActions status={session.status} message={session.message} onSubmit={() => { if (!isLocked) void onEvent?.('editSubmitRequest', { raw: ui.draftRaw }); }} onCancel={() => { if (!isLocked) void onEvent?.('editCancelRequest'); }} />} />
			) : null}
		</div>
	);
});

// the card of an entry, floating over its box: the held component drawn as a document draws it (the
// page's RegisteredComp), in its mode offered in place while the table is edited, so its values are
// typed where they stand and written into the table (editDraftChange of the held component: its raw).
// The block context is cut: the held component is no block of the document the table is in
const TimetableEntryCard = observer(function TimetableEntryCard({ info, anchorGet, config, isWritable, onRawChange, onClose }) {
	const ref = useRef(null);
	// the box of the entry, once it is drawn (an entry just added has none at the first drawing)
	const [anchorElement, anchorElementSet] = useState(null);
	useLayoutEffect(() => { const element = anchorGet(); if (element !== anchorElement) anchorElementSet(element); });
	const anchorRef = useMemo(() => ({ current: anchorElement ?? null }), [anchorElement]);
	useEditOutsidePointer(ref, true, () => onClose());
	const modeInPlace = isWritable ? compEditModeListGet(info.definition).find((mode) => mode.isInPlace === true) ?? null : null;
	const configRuntime = {
		instanceId: `${config.instanceId ?? 'timetable'}:entry:${info.key}`,
		...(config.sourcePath !== undefined ? { sourcePath: config.sourcePath } : {}),
		...(config.docState ? { docState: config.docState } : {}),
		...(modeInPlace ? {
			isEdit: true,
			edit: {
				modeId: modeInPlace.id, label: info.definition.expose?.meta?.label ?? info.entry.comp, format: 'md', block: undefined, isSurfaceFloating: false, isInPlace: true,
				session: { status: 'editing', message: '', textDraft: info.entry.raw },
				submitPrepareSet: () => () => {},
				receiverSet: () => () => {},
			},
		} : {}),
	};
	const onEventRuntime = async (type, payload = {}) => {
		if ((type === 'editDraftChange' || type === 'dataReplaceRequest') && payload.raw !== undefined) {
			if (!isWritable) return { code: -1, message: 'The timetable is read: edit it to change the cards it holds.' };
			onRawChange(String(payload.raw));
			return { code: 0 };
		}
		if ((type === 'editSubmitRequest' || type === 'editCancelRequest') && modeInPlace) return { code: 0 };
		if (/^edit[A-Z]/.test(type) || type === 'blockPropSetRequest') return { code: -1, message: 'Not taken by a timetable.' };
		return undefined;
	};
	if (!anchorElement) return null;
	return (
		<AnchoredPopover anchorRef={anchorRef} isTracked className="oa-timetable-entry-popover nodrag nopan">
			<div ref={ref} className="oa-timetable-entry-card">
				<DocEditBlockContext.Provider value={null}>
					<DocEditBlockFloatContext.Provider value={null}>
						<RegisteredComp compName={info.entry.comp} placement="commentBlock"
							input={{ raw: info.entry.raw ?? '', lang: info.entry.lang ?? 'yaml', propsAuthored: info.entry.props ?? {} }}
							configRuntime={configRuntime} onEventRuntime={onEventRuntime} />
					</DocEditBlockFloatContext.Provider>
				</DocEditBlockContext.Provider>
			</div>
		</AnchoredPopover>
	);
});

// the week of a table while it is edited: a button with its words as read; a click opens what it is
// chosen with: a calendar (any day: its week) and the three ways a table stands to dates
const TimetableWeekValue = observer(function TimetableWeekValue({ text, table, weekStart, hasDatedEntry, today, onBind, onModeSet }) {
	const anchorRef = useRef(null);
	const rootRef = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	const [visible, visibleSet] = useState(() => (table.week.start || today).slice(0, 7));
	const [message, messageSet] = useState('');
	useEditOutsidePointer(rootRef, isOpen, () => isOpenSet(false));
	const weekDateList = table.week.mode === 'bound' ? Array.from({ length: 7 }, (_, index) => oaDateAdd(table.week.start, index)) : [];
	const dateObjOf = (date) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });
	const modeChip = (mode, label, title, reason = '') => (
		<button type="button" className="oa-time-chip" aria-pressed={table.week.mode === mode} disabled={Boolean(reason)} title={reason || title}
			onClick={() => { onModeSet(mode); if (mode !== 'bound') isOpenSet(false); }}>{label}</button>
	);
	return (
		<span ref={anchorRef} className="oa-timetable-week-value">
			<button type="button" className="oa-card-time-button nodrag nopan" aria-haspopup="dialog" aria-expanded={isOpen} title="Choose its week, or every week"
				onClick={(event) => { event.stopPropagation(); messageSet(''); isOpenSet(!isOpen); }}>{text}</button>
			{isOpen ? (
				<AnchoredPopover anchorRef={anchorRef} isTracked className="oa-time-picker oa-timetable-week-picker doc-edit-popup nodrag nopan">
					<div ref={rootRef} className="oa-time-picker-body" role="dialog" aria-label="Choose the week">
						<span className="oa-time-chip-list">
							{modeChip('bound', 'A week of dates', 'Bound to the week of a day: click a day')}
							{modeChip('every', 'Every week', 'Never bound to dates: the days of the week')}
							{modeChip('open', 'Not bound yet', 'The first card at a day binds it', table.week.mode !== 'open' && hasDatedEntry ? 'it holds cards at days: they would bind it at once' : '')}
						</span>
						<DateView
							data={{
								visibleYear: Number(visible.slice(0, 4)), visibleMonth: Number(visible.slice(5, 7)), selectionMode: 'multiple',
								firstDayOfWeek: weekStart === 'sunday' ? 'sunday' : 'monday', selectedDates: weekDateList.map(dateObjOf),
							}}
							onDataChangeRequest={(type, params) => {
								if (type === 'navigate-month') {
									const index = Number(visible.slice(0, 4)) * 12 + Number(visible.slice(5, 7)) - 1 + params.monthDelta;
									visibleSet(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
								}
								if (type === 'selection-change' && params.clickedDate) {
									const { year, month, day } = params.clickedDate;
									const reason = onBind(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
									messageSet(reason);
									if (!reason) isOpenSet(false);
								}
							}} />
						{message ? <div className="oa-time-message" role="alert">{message}</div> : <span className="oa-time-note">A click on a day binds the table to its week.</span>}
					</div>
				</AnchoredPopover>
			) : null}
		</span>
	);
});

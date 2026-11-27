import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, MapPin, Plus, TriangleAlert, Users } from '../../../../main/frontend/UICommon.js';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { DocEditBlockFloatContext } from '../../../../main/comp-doc/edit/DocEditDocContext.js';
import { OaStatus } from '../status/OaStatus.jsx';
import { oaCardListOf, oaCardValueIsSet } from './oa-card-data.js';
import './OaCard.css';

// The look every card of the package shares (doc/README.md#how-a-card-is-made): a tile with the mark
// of the kind, beside it the title with the button joining it, under the title the lines of the kind;
// the description, when written, under them across the card. One face, the sans-serif of the page,
// for every value (a time, a number, a passcode): figures in tabular digits, never a monospace face.
// Sized in em: in a document at the size of its text, in a card of a card diagram at the size of the
// cards around it (--doc-card-font-size, given by the card holding it).
//
//   kind         its data-kind (reservation, instance, course, event): what its css may tell apart
//   tone         the accent of the mark and of Join: zoom (the blue of Zoom), course, event
//   Icon         the mark of the kind
//   title        what stands as the title: a text, or the field typing it
//   joinUrl      the link of Join; none, no button. It does nothing while the card is edited
//   status       what stands beside the title as its status (OaStatus), or nothing
//   description  what stands as the description, or nothing
//   children     the lines of the kind
//   edit         while it is edited (OaCardEdit.jsx), what only editing draws, floating: nothing moves
//                  add    { title, open(event), isMenuOpen, isAlways }: the + of a card edited in place
//                         (a card of a diagram, of a timetable), the values not written yet. Outside the
//                         card, never over its words: in the row over the top edge of a card of a diagram
//                         (where the card holding it floats what is its component's, after the group of
//                         the card), else over its top edge at its right end. Shown the whole
//                         time (isAlways: the card alone, or the card selected in a diagram), else while
//                         the card is worked with (the pointer on it, something in it focused) or its
//                         menu is open. (A card edited in a block of a document has it in the bar of the
//                         block: OaCardEdit.jsx)
//                  link   { isOpen, open(), field }: Join a button typing the link, in a field floating
//                         under it (under the title when there is no Join yet)
export function OaCard({ kind, tone = 'zoom', Icon, title, joinUrl = '', isEditing = false, status = null, description = null, children, edit = null }) {
	const cardRef = useRef(null);
	const joinRef = useRef(null);
	const titleRowRef = useRef(null);
	const link = edit?.link;
	const worked = useCardWorked(Boolean(edit?.add));
	const floatElement = useContext(DocEditBlockFloatContext);
	const addGroup = edit?.add ? <EditButtonGroup actionList={[{ id: 'add', Icon: Plus, title: edit.add.title, act: edit.add.open }]} ariaLabel="Add a value" /> : null;
	const isAddShown = Boolean(edit?.add) && (edit.add.isAlways || worked.isWorked || edit.add.isMenuOpen);
	return (
		<div ref={cardRef} className="oa-card not-prose" data-kind={kind} data-tone={tone} data-editing={isEditing ? '' : undefined} {...worked.handlers}>
			<div className="oa-card-head">
				<span className="oa-card-tile" aria-hidden="true"><Icon /></span>
				<div className="oa-card-main">
					<div ref={titleRowRef} className="oa-card-title-row">
						<span className="oa-card-title">{title}</span>
						{status}
						{joinUrl && link ? (
							<button ref={joinRef} type="button" className="oa-card-join nodrag" title={`The link: ${joinUrl}. A click types it`}
								onClick={(event) => { event.stopPropagation(); link.open(); }}>
								Join<ExternalLink aria-hidden="true" />
							</button>
						) : joinUrl ? (
							<a className="oa-card-join" href={joinUrl} target="_blank" rel="noopener noreferrer" title={joinUrl}
								tabIndex={isEditing ? -1 : undefined} aria-disabled={isEditing || undefined}>
								Join<ExternalLink aria-hidden="true" />
							</a>
						) : null}
					</div>
					{children}
				</div>
			</div>
			{description ? <div className="oa-card-description">{description}</div> : null}
			{link?.isOpen ? (
				<AnchoredPopover anchorRef={joinUrl ? joinRef : titleRowRef} isTracked isShownFirst className="oa-card-link-popover nodrag nopan">
					<span className="oa-card-link-name">Link</span>
					{link.field}
				</AnchoredPopover>
			) : null}
			{isAddShown && floatElement ? createPortal(<span className="oa-card-add doc-edit-popup">{addGroup}</span>, floatElement) : null}
			{isAddShown && !floatElement ? (
				<AnchoredPopover anchorRef={cardRef} placement="over-end" isTracked className="oa-card-add doc-edit-popup nodrag nopan">
					{addGroup}
				</AnchoredPopover>
			) : null}
		</div>
	);
}

// whether a card is worked with: the pointer on it (kept a moment after it leaves, so it can reach
// what floats outside the card), or something in it focused
function useCardWorked(isWatched) {
	const [isHovered, isHoveredSet] = useState(false);
	const [isFocused, isFocusedSet] = useState(false);
	const timerRef = useRef(0);
	useEffect(() => () => clearTimeout(timerRef.current), []);
	if (!isWatched) return { isWorked: false, handlers: {} };
	return {
		isWorked: isHovered || isFocused,
		handlers: {
			onPointerEnter: () => { clearTimeout(timerRef.current); isHoveredSet(true); },
			onPointerLeave: () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(() => isHoveredSet(false), 400); },
			onFocus: () => isFocusedSet(true),
			onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) isFocusedSet(false); },
		},
	};
}

// the line of a card's time: the time in its format (or the field typing it), how long it is, and,
// for a time that cannot be read, a mark saying why (it is shown as written)
//   shown        { text, lengthText, message } (oa-card-data.js: oaCardTimeShownOf)
//   field        what stands in the place of the time while it is edited, else nothing
//   isShown      whether the time stands at all (written, or just added)
export function OaCardTime({ shown, field = null, isShown = true, children = null }) {
	if (!isShown && !children) return null;
	return (
		<div className="oa-card-line">
			{isShown ? (
				<span className="oa-card-when" title={shown.rangeText && !field ? `${shown.text}: ${shown.rangeText}` : undefined}>
					{shown.message && !field ? <span className="oa-card-warning" title={`Not read as a time: ${shown.message}`}><TriangleAlert aria-hidden="true" /></span> : null}
					{field ?? shown.text}
				</span>
			) : null}
			{isShown && shown.lengthText ? <span className="oa-card-length">{shown.lengthText}</span> : null}
			{children}
		</div>
	);
}

// a line of a value with its mark: who (people), where (place). isShown: whether it stands (written, or
// just added); field: what stands in its place while it is edited, else the text
export function OaCardValueLine({ Icon, text, field = null, isShown = true, className = '' }) {
	if (!isShown) return null;
	return (
		<div className={`oa-card-line${className ? ` ${className}` : ''}`}>
			<span className="oa-card-person"><Icon aria-hidden="true" />{field ?? text}</span>
		</div>
	);
}

// the entries of a list as read (people): one chip each, as they are edited (OaCardEdit.jsx: listRender)
export function OaCardChipList({ nameList }) {
	return (
		<span className="oa-card-chip-list">
			{nameList.map((name, index) => <span key={`${index}-${name}`} className="oa-card-chip">{name}</span>)}
		</span>
	);
}

export const OaCardPeopleIcon = Users;
export const OaCardPlaceIcon = MapPin;

// which values of a card stand: those written (edit.isShown while it is edited: just added too)
export function oaCardIsShownOf(card, edit) {
	return edit?.isShown ?? ((id) => oaCardValueIsSet(card[id]));
}

// what stands beside the title for the status of a card of a kind with one: the pill, editable while
// the card is (valueRender), else read; nothing when it has no change yet
export function oaCardStatusDrawn({ kind, card, valueRender, isShown }) {
	const field = kind.fieldList.find((one) => one.kind === 'status');
	if (!field || !isShown(field.id)) return null;
	return valueRender ? valueRender(field.id) : <OaStatus history={card[field.id]} statusList={field.statusList} />;
}

// the lines of the people and the place of an event, as they stand
export function OaCardEventLines({ kind, card, valueRender, isShown }) {
	const has = (id) => kind.fieldList.some((field) => field.id === id);
	return (
		<>
			{has('people') ? <OaCardValueLine Icon={Users} text={<OaCardChipList nameList={oaCardListOf(card.people)} />} isShown={isShown('people')} field={valueRender ? valueRender('people') : null} /> : null}
			{has('place') ? <OaCardValueLine Icon={MapPin} text={card.place} isShown={isShown('place')} field={valueRender ? valueRender('place') : null} /> : null}
		</>
	);
}

// a value to type in the app, with the button copying it
export function OaCardCopy({ text, label }) {
	const [isCopied, isCopiedSet] = useState(false);
	const copy = async (event) => {
		event.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			isCopiedSet(true);
			setTimeout(() => isCopiedSet(false), 1200);
		} catch {
			// a page without the clipboard: nothing to say, the value is there to select
		}
	};
	return (
		<button type="button" className="oa-card-copy nodrag" title={label} aria-label={label} onClick={copy}>
			{isCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
		</button>
	);
}

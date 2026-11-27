import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { computed, observable, toJS } from 'mobx';
import { ArrowLeftToLine, ArrowRightToLine, Check, Plus, Trash2 } from '../../../../main/frontend/UICommon.js';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { DocMenu, docMenuEntryBuild, docMenuSeparatorBuild } from '../../../../main/comp-doc/edit/DocMenu.jsx';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { oaTimeFormat, oaTimeTextOf } from '../time/oa-time.js';
import { oaPreferenceGet, oaTimePeriodsOf } from '../time/oa-config.js';
import { OaTimePicker } from '../time/OaTimePicker.jsx';
import { oaCardFieldNormalize, oaCardFormatOf, oaCardListOf, oaCardRawBuild, oaCardRead, oaCardSpanOf, oaCardTimeShownOf, oaCardValueFieldList, oaCardValueIsSet } from './oa-card-data.js';
import { OaStatus, oaStatusMenuEntryList } from '../status/OaStatus.jsx';
import { oaStatusChangeAdd } from '../status/oa-status.js';

// The edit mode Fields of every card of the package (main/doc_page_impl_edit.md#component-edit-mode), by
// the rules of editability (main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)
// and of the components a card diagram holds (main/diagram-design-design.md): the same card the reader sees
// (Render), every value of it created, changed and removed on the card, each with the control its kind
// of value calls for, never a text to type where a value is chosen.
//
//   a text     a click types it where it stands (a field of the cell editing kit: Enter or a click
//              elsewhere keeps it, Escape gives it up); while it is typed, a floating group over its end
//              removes it (Delete), and a drag in it selects its words (nodrag nopan: never the card)
//   a time     a click opens the time picker (OaTimePicker: a calendar, the times of a day, the parts of
//              a day, a month, a year): chosen, never typed alone. Its format: its right-click menu, and
//              the edit card of a card of a diagram (expose.dataFields)
//   people     one entry each: a click types it, its group inserts one before or after it, or removes it
//   a status   the pill beside the title (OaStatus): a click sets another status, a change made now and
//              kept in its history; History… shows and edits the changes
//   add        the +: the values not written yet; one chosen stands in its place at once, its control
//              open. In a block of a document, in the bar of the block (the card edited is that block);
//              in place, outside the card over its top right corner while the card is worked with (the
//              pointer on it, a value of it open): a diagram shows no control on every card at once
//   remove     the floating group of a value open (Delete), its right-click menu, or kept empty
//   the link   no place of its own in the card (Join): a click on Join types it in a field under Join
//
// Nothing moves as the mode opens: what exists only for editing floats (the +, the groups of a value,
// the picker, the menus); a value added takes its room as it is set. Every change is reported as the
// yaml the block is saved as (editDraftChange).
//
// The description is a cell text (doc_page_impl_edit_cell.md): the token kinds of the page (a link,
// a view of an object), typed with its slash mode. The other texts are plain (a link is full of "/").
//
// It is the same in a block of a document and in a card of a card diagram holding it (card-comp).
// In a block, a session of the edit layer: the draft is kept here, Save and Cancel in the floating bar
// of the block. In place (config.edit.isInPlace: an owner keeping the mode open while its document is
// edited, the card of a card diagram, a timetable holding it): no draft, no bar; it reads its data at
// every drawing (the owner writes each value reported at once, and an undo of the owner changes the
// data under it).
export const OaCardEdit = observer(function OaCardEdit({ kind, Render, data = {}, config = {}, onEvent }) {
	const isInPlace = config.edit?.isInPlace === true;
	const preference = oaPreferenceGet(config);
	const periods = oaTimePeriodsOf(preference);
	// the values in the form the card reads them, so the controls show what the card showed
	const readNormalized = () => {
		const card = oaCardRead(kind, data);
		for (const id of Object.keys(card)) card[id] = oaCardFieldNormalize(kind, id, card[id], { card, preference });
		return card;
	};
	const [draft] = useState(() => observable(readNormalized()));
	const [menu, menuSet] = useState(null);
	// the picker of a value open (the time), and an entry of a list being added ({ id, index })
	const [pickerId, pickerIdSet] = useState('');
	const [entryNew, entryNewSet] = useState(null);
	const cellStore = useContext(StoreContext)?.cellStore;
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const cellPlain = useCell({ config, tokenIdList: [], isStyled: false });
	const cellText = useCell({ config });
	const fieldById = Object.fromEntries(kind.fieldList.map((field) => [field.id, field]));
	const card = isInPlace ? readNormalized() : toJS(draft);
	const keyOf = (id) => `${config.instanceId ?? 'oa-card'}:${id}`;
	// the field open on the page, read here (not in Render, where valueRender runs and nothing observes
	// it): the card is drawn again when a field opens or closes, not at every key typed into it
	const keyOpenComputed = useMemo(() => computed(() => cellStore?.field?.key), [cellStore]);
	const keyOpen = keyOpenComputed.get();
	const isOpen = (id) => keyOpen === keyOf(id);
	// a value stands in the card while it is written, or while its control is open (just added)
	const isShown = (id) => oaCardValueIsSet(card[id]) || isOpen(id) || pickerId === id || entryNew?.id === id;
	const addList = oaCardValueFieldList(kind).filter((field) => field.id !== 'title' && !isShown(field.id));
	const fieldSet = (id, value) => {
		const valueKept = oaCardFieldNormalize(kind, id, value, { card, preference });
		if (isInPlace) {
			if (JSON.stringify(valueKept) !== JSON.stringify(card[id])) void onEvent?.('editDraftChange', { raw: oaCardRawBuild(kind, { ...card, [id]: valueKept }) });
			return;
		}
		draft[id] = valueKept;
		void onEvent?.('editDraftChange', { raw: oaCardRawBuild(kind, draft) });
	};
	// a value added: it stands in its place, its control open (a text empty, the picker, a first entry)
	const valueAdd = (id) => {
		if (isLocked) return;
		const fieldKind = fieldById[id]?.kind;
		if (fieldKind === 'time') pickerIdSet(id);
		else if (fieldKind === 'list') entryNewAt(id, 0);
		else cellStore?.fieldOpen(keyOf(id), '');
	};
	const entryNewAt = (id, index) => {
		entryNewSet({ id, index });
		cellStore?.fieldOpen(keyOf(`${id}:new`), '');
	};
	const timeShown = oaCardTimeShownOf(card, preference);
	const contextMenuOf = (id, more = {}) => (id === 'title' || isLocked ? undefined : (event) => {
		// the value as one thing: its own menu, not the menu of what holds the card
		event.preventDefault();
		event.stopPropagation();
		menuSet({ point: { x: event.clientX, y: event.clientY }, valueId: id, ...more });
	});
	const labelOf = (id) => fieldById[id].label.toLowerCase();

	// a text typed in place, and, while it is typed, the group removing it (not the title: a card is
	// called something)
	const textRender = (id) => {
		const field = fieldById[id];
		const isOpenNow = isOpen(id);
		return (
			<span className={`oa-card-value is-${id}`}>
				<CellField cell={field.kind === 'cellText' ? cellText : cellPlain} value={card[id]} isEditable={!isLocked} isMultiline={field.kind === 'cellText'}
					placeholder={field.placeholder || field.label} className={`oa-card-field is-${id}${isOpenNow ? ' nodrag nopan' : ''}`}
					fieldKey={keyOf(id)} ariaLabel={field.label} onCommit={(text) => fieldSet(id, text)} onContextMenu={contextMenuOf(id)} />
				{isOpenNow && id !== 'title' && !isLocked ? (
					<OaCardValueTools actionList={[{ id: 'delete', Icon: Trash2, title: `Delete ${labelOf(id)}`, isDanger: true, act: () => { cellStore?.fieldClose(keyOf(id)); fieldSet(id, ''); } }]} />
				) : null}
			</span>
		);
	};

	// the entries of a list (people): one each, typed where it stands; its group inserts one before or
	// after it, or removes it. A name typed with commas is several entries
	const listRender = (id) => {
		const entryList = oaCardListOf(card[id]);
		const listSet = (list) => fieldSet(id, list.join(', '));
		const isNewHere = entryNew?.id === id;
		const shownList = isNewHere ? [...entryList.slice(0, entryNew.index), null, ...entryList.slice(entryNew.index)] : entryList;
		return (
			<span className="oa-card-chip-list">
				{shownList.map((name, shownIndex) => {
					const isNew = name === null;
					const index = isNewHere && shownIndex > entryNew.index ? shownIndex - 1 : shownIndex;
					const fieldKey = keyOf(isNew ? `${id}:new` : `${id}:${index}`);
					const isOpenNow = keyOpen === fieldKey;
					// the list with this entry as typed (a name with commas: several entries)
					const listWithTyped = (text) => [...entryList.slice(0, index), ...oaCardListOf(text), ...entryList.slice(index + 1)];
					const commit = (text) => {
						const typedList = oaCardListOf(text);
						if (isNew) {
							entryNewSet(null);
							if (typedList.length) listSet([...entryList.slice(0, index), ...typedList, ...entryList.slice(index)]);
							return;
						}
						listSet(listWithTyped(text));
					};
					// an action of its group: what was typed so far kept, the field closed, then the action
					const toolAct = (act) => () => {
						const typed = cellStore?.field?.draft ?? name;
						cellStore?.fieldClose(fieldKey);
						const list = listWithTyped(typed);
						const typedCount = oaCardListOf(typed).length;
						act(list, typedCount);
					};
					return (
						<span key={isNew ? 'new' : `entry-${index}`} className="oa-card-chip oa-card-value">
							<CellField cell={cellPlain} value={isNew ? '' : name} isEditable={!isLocked} placeholder="a name" className={`oa-card-chip-field${isOpenNow ? ' nodrag nopan' : ''}`}
								fieldKey={fieldKey} ariaLabel={`${fieldById[id].label}: an entry`} onCommit={commit}
								onContextMenu={isNew ? undefined : contextMenuOf(id, { entryIndex: index })} />
							{isOpenNow && !isNew && !isLocked ? (
								<OaCardValueTools actionList={[
									{ id: 'before', Icon: ArrowLeftToLine, title: 'Add one before', act: toolAct((list) => { listSet(list); entryNewAt(id, index); }) },
									{ id: 'after', Icon: ArrowRightToLine, title: 'Add one after', act: toolAct((list, typedCount) => { listSet(list); entryNewAt(id, index + Math.max(1, typedCount)); }) },
									{ id: 'delete', Icon: Trash2, title: `Delete ${name}`, isDanger: true, act: toolAct(() => listSet(entryList.filter((_, one) => one !== index))) },
								]} />
							) : null}
						</span>
					);
				})}
			</span>
		);
	};

	// the time: a button showing it as the card does; a click opens the picker
	const timeRender = (id) => (
		<OaCardTimeValue text={timeShown.text} lengthText="" isLocked={isLocked} isPickerOpen={pickerId === id}
			onOpen={() => pickerIdSet(id)} onContextMenu={contextMenuOf(id)}
			picker={(anchorRef) => (
				<OaTimePicker anchorRef={anchorRef} span={oaCardSpanOf(card)} preference={preference} periods={periods}
					onSave={(span) => fieldSet(id, span ? oaTimeTextOf(span) : '')} onClose={() => pickerIdSet('')} />
			)} />
	);

	const valueRender = (id) => {
		const field = fieldById[id];
		if (field.kind === 'status') {
			return <OaStatus history={card[id]} statusList={field.statusList} isEditable={!isLocked} cell={cellPlain} fieldKeyBase={keyOf(id)}
				onHistoryChange={(history) => fieldSet(id, history)} onContextMenu={contextMenuOf(id)} />;
		}
		if (field.kind === 'time') return timeRender(id);
		if (field.kind === 'list') return listRender(id);
		return textRender(id);
	};

	const format = oaCardFormatOf(card, preference);
	// a format chosen in the menu of the time: its name, and this card's time written so
	const spanShown = oaCardSpanOf(card);
	const formatChoiceLabel = (field, value) => {
		if (!spanShown) return field.valueLabelById[value] ?? value;
		const label = (field.valueLabelById[value] ?? value).split(':')[0];
		const formatOne = field.id === 'timeClock' ? { ...format, clock: value } : { ...format, layout: value };
		return `${label}: ${oaTimeFormat(spanShown, formatOne)}`;
	};
	const menuValueField = menu?.valueId ? fieldById[menu.valueId] : null;
	const menuItemList = menu ? [
		// an entry of a list right-clicked: around it, and it
		...(Number.isInteger(menu.entryIndex) ? [
			docMenuEntryBuild('entryBefore', ArrowLeftToLine, 'Add one before'),
			docMenuEntryBuild('entryAfter', ArrowRightToLine, 'Add one after'),
			docMenuSeparatorBuild('rule-entry'),
		] : []),
		...(menuValueField?.kind === 'time' ? [docMenuEntryBuild('pick', null, 'Choose the time…')] : []),
		...addList.map((field) => docMenuEntryBuild(`add:${field.id}`, Plus, `Add ${field.label.toLowerCase()}`)),
		// a time: how it is written, the card's own or the package's
		...(menuValueField?.kind === 'time' ? kind.fieldList.filter((field) => field.kind === 'choice').flatMap((field) => [
			docMenuSeparatorBuild(`rule-${field.id}`),
			docMenuEntryBuild(`set:${field.id}:`, card[field.id] ? null : Check, field.defaultLabel),
			...field.valueList.map((value) => docMenuEntryBuild(`set:${field.id}:${value}`, card[field.id] === value ? Check : null, formatChoiceLabel(field, value))),
		]) : []),
		...(menuValueField ? [
			docMenuSeparatorBuild('rule'),
			Number.isInteger(menu.entryIndex)
				? docMenuEntryBuild('entryDelete', Trash2, `Delete ${oaCardListOf(card[menu.valueId])[menu.entryIndex] ?? 'it'}`, { isDanger: true })
				: docMenuEntryBuild(`delete:${menu.valueId}`, Trash2, menuValueField.kind === 'status' ? 'Delete the status and its history' : menuValueField.kind === 'list' ? `Delete all ${labelOf(menu.valueId)}` : `Delete ${labelOf(menu.valueId)}`, { isDanger: true }),
		] : []),
	] : [];
	// a status added from the +: its first change, chosen at once
	const menuStatusItemList = menu?.statusFieldId ? oaStatusMenuEntryList(fieldById[menu.statusFieldId].statusList, `status:${menu.statusFieldId}`) : null;
	const menuChoose = (choice) => {
		const menuBefore = menu;
		menuSet(null);
		const [action, id, value = ''] = String(choice).split(':');
		const entryList = menuBefore?.valueId ? oaCardListOf(card[menuBefore.valueId]) : [];
		if (action === 'add' && fieldById[id]?.kind === 'status') menuSet({ point: menuBefore?.point, statusFieldId: id });
		else if (action === 'status') fieldSet(id, oaStatusChangeAdd(card[id] ?? [], value));
		else if (action === 'add') valueAdd(id);
		else if (action === 'pick') pickerIdSet(menuBefore.valueId);
		else if (action === 'entryBefore') entryNewAt(menuBefore.valueId, menuBefore.entryIndex);
		else if (action === 'entryAfter') entryNewAt(menuBefore.valueId, menuBefore.entryIndex + 1);
		else if (action === 'entryDelete') fieldSet(menuBefore.valueId, entryList.filter((_, one) => one !== menuBefore.entryIndex).join(', '));
		else if (action === 'delete') fieldSet(id, '');
		else if (action === 'set') fieldSet(id, value);
	};
	// the +: the values not written yet, in a menu at the button
	const add = addList.length && !isLocked ? {
		title: `Add a value: ${addList.map((field) => field.label.toLowerCase()).join(', ')}`,
		open: (event) => {
			const rect = event.currentTarget.getBoundingClientRect();
			menuSet({ point: { x: rect.left, y: rect.bottom + 4 }, isAdd: true });
		},
		isMenuOpen: menu?.isAdd === true,
		// shown the whole time, unless the owner selects one of several cards (a card diagram): then on
		// the card selected, and on another while it is worked with
		isAlways: config.edit?.isSelected !== false,
	} : null;
	const edit = {
		isShown,
		add: isInPlace ? add : null,
		// the link: no place of its own in the card, typed in a field floating under Join
		...(fieldById.url ? { link: { isOpen: isOpen('url'), open: () => valueAdd('url'), field: textRender('url') } } : {}),
		format,
	};
	const cardDrawn = <Render card={card} valueRender={valueRender} cellText={cellText} preference={preference} isEditing edit={edit} />;
	const menuItemShown = menuStatusItemList ?? menuItemList;
	const menuDrawn = menu && menuItemShown.length ? <DocMenu itemList={menuItemShown} point={menu.point} onChoose={menuChoose} onClose={() => menuSet(null)} /> : null;
	if (isInPlace) return <>{cardDrawn}{menuDrawn}</>;
	return (
		<>
			{cardDrawn}
			{menuDrawn}
			<EditFloatingPanel label={kind.label}
				head={add ? <EditButtonGroup actionList={[{ id: 'add', Icon: Plus, title: add.title, act: add.open }]} ariaLabel="Add a value" /> : null}
				actions={<EditActions status={session.status} message={session.message} onSubmit={() => { if (!isLocked) void onEvent?.('editSubmitRequest', { raw: oaCardRawBuild(kind, draft) }); }} onCancel={() => { if (!isLocked) void onEvent?.('editCancelRequest'); }} />} />
		</>
	);
});

// the group of a value open: what is done to the value (remove it; insert an entry beside it). It
// floats outside the card, at its left edge, level with the value, as the toolbar of a row of a card
// of a diagram does: never over the words of the card. In the top layer (AnchoredPopover, placement
// beside): a card of a diagram cuts what is beyond its box, and at the size of the screen whatever the
// zoom. It belongs to the field it stands for (its node stays under the value): a pointer going down on
// it is no leaving of the field (doc-edit-popup), so its click is not lost to the field closing under
// it; each action closes the field itself
function OaCardValueTools({ actionList }) {
	const markRef = useRef(null);
	const valueRef = useRef(null);
	const cardRef = useRef(null);
	const [isFound, isFoundSet] = useState(false);
	// the value it stands for (what holds it), and the card it stands beside
	useLayoutEffect(() => {
		valueRef.current = markRef.current?.parentElement ?? null;
		cardRef.current = markRef.current?.closest('.oa-card') ?? null;
		isFoundSet(Boolean(valueRef.current));
	}, []);
	return (
		<span ref={markRef} className="oa-card-value-tools-mark">
			{isFound ? (
				<AnchoredPopover anchorRef={valueRef} besideRef={cardRef} placement="beside" isTracked className="oa-card-value-tools doc-edit-popup nodrag nopan">
					<EditButtonGroup actionList={actionList} ariaLabel="The value" />
				</AnchoredPopover>
			) : null}
		</span>
	);
}

// the time of a card while it is edited: a button showing it as read (its box as read: nothing moves),
// a click opening the picker under it
function OaCardTimeValue({ text, isLocked, isPickerOpen, onOpen, onContextMenu, picker }) {
	const ref = useRef(null);
	return (
		<span ref={ref} className="oa-card-time-value">
			<button type="button" className="oa-card-time-button nodrag nopan" disabled={isLocked} aria-haspopup="dialog" aria-expanded={isPickerOpen}
				title="Choose the time: a day, a time of day, a part of a day, a month, a year"
				onClick={(event) => { event.stopPropagation(); onOpen(); }} onContextMenu={onContextMenu}>
				{text || <span className="oa-card-placeholder">Choose a time</span>}
			</button>
			{isPickerOpen ? picker(ref) : null}
		</span>
	);
}

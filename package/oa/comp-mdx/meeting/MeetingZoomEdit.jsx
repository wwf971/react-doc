import { useContext, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { observable, toJS } from 'mobx';
import { Plus, Trash2 } from '../../../../main/frontend/UICommon.js';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { DocMenu, docMenuEntryBuild, docMenuSeparatorBuild } from '../../../../main/comp-doc/edit/DocMenu.jsx';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { meetingFieldNormalize, meetingRawBuild, meetingRead } from './MeetingZoomData.js';

// The edit mode Fields of both Zoom cards (main/doc_page_impl_edit.md#component-edit-mode), by the rules
// of editability (main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands):
// the same card the reader sees (Render), every value of it created, changed and removed on the card.
//
//   change   a click on a value types it where it stands (a field of the cell editing kit: Enter or a
//            click elsewhere keeps it, Escape gives it up)
//   add      the + of the card (a floating button group in its corner, seen the whole time the card is
//            edited, faint until the pointer is on it): the values not written yet; one chosen stands
//            in its place at once, its field open and empty, and stays when something is typed in it
//   remove   a value kept empty goes; a right click on a value: Delete (and the values to add)
//   the link it has no place of its own in the card (Join): a click on Join, or Link added, types it
//            in a field floating under Join (MeetingZoomCard: linkEdit)
//
// Nothing moves as the mode opens: what exists only for editing floats (the +, the field of the link,
// the menu); a value added takes its room as it is typed. Every change is reported as the yaml the
// block is saved as (editDraftChange).
//
// The description is a cell text (doc_page_impl_edit_cell.md): the token kinds of the page (a link,
// a view of an object), typed with its slash mode. The other values are plain: no token, no slash
// (a link is full of "/").
//
// It is the same in a block of a document and in a card of a card diagram holding it (card-comp).
// In a block, a session of the edit layer: the draft is kept here, Save and Cancel in the floating bar
// of the block. In place (config.edit.isInPlace: an owner keeping the mode open while its document is
// edited, the card of a card diagram): no draft, no bar; it reads its data at every drawing (the owner
// writes each value reported at once, and an undo of the owner changes the data under it).
export const MeetingZoomEdit = observer(function MeetingZoomEdit({ kind, Render, data = {}, config = {}, onEvent }) {
	const isInPlace = config.edit?.isInPlace === true;
	// the values in the form the card reads them, so the fields show what the card showed
	const readNormalized = () => {
		const meeting = meetingRead(kind, data);
		for (const id of Object.keys(meeting)) meeting[id] = meetingFieldNormalize(id, meeting[id]);
		return meeting;
	};
	const [draft] = useState(() => observable(readNormalized()));
	const [menu, menuSet] = useState(null);
	const cellStore = useContext(StoreContext)?.cellStore;
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const cellPlain = useCell({ config, tokenIdList: [], isStyled: false });
	const cellText = useCell({ config });
	const fieldById = Object.fromEntries(kind.fieldList.map((field) => [field.id, field]));
	const meeting = isInPlace ? readNormalized() : toJS(draft);
	const keyOf = (id) => `${config.instanceId ?? 'meeting'}:${id}`;
	const isOpen = (id) => cellStore?.fieldIsOpen(keyOf(id)) === true;
	// a value stands in the card while it is written, or while its field is open (just added)
	const isShown = (id) => Boolean(meeting[id]) || isOpen(id);
	const addList = kind.fieldList.filter((field) => field.id !== 'title' && !isShown(field.id));
	const fieldSet = (id, text) => {
		const value = meetingFieldNormalize(id, text);
		if (isInPlace) {
			if (value !== meeting[id]) void onEvent?.('editDraftChange', { raw: meetingRawBuild(kind, { ...meeting, [id]: value }) });
			return;
		}
		draft[id] = value;
		void onEvent?.('editDraftChange', { raw: meetingRawBuild(kind, draft) });
	};
	// a value added: it stands in its place, its field open and empty
	const valueAdd = (id) => {
		if (!isLocked) cellStore?.fieldOpen(keyOf(id), meeting[id] ?? '');
	};
	const valueRender = (id) => {
		const field = fieldById[id];
		return (
			<CellField cell={field.isCellText ? cellText : cellPlain} value={meeting[id]} isEditable={!isLocked} isMultiline={field.isMultiline === true}
				placeholder={field.placeholder || field.label} className={`oa-meeting-zoom-field is-${id}`}
				fieldKey={keyOf(id)} ariaLabel={field.label} onCommit={(text) => fieldSet(id, text)}
				onContextMenu={id === 'title' || isLocked ? undefined : (event) => {
					// the value as one thing: its own menu, not the menu of what holds the card
					event.preventDefault();
					event.stopPropagation();
					menuSet({ point: { x: event.clientX, y: event.clientY }, valueId: id });
				}} />
		);
	};
	const menuItemList = menu ? [
		...addList.map((field) => docMenuEntryBuild(`add:${field.id}`, Plus, `Add ${field.label.toLowerCase()}`)),
		...(menu.valueId ? [
			...(addList.length ? [docMenuSeparatorBuild('rule')] : []),
			docMenuEntryBuild(`delete:${menu.valueId}`, Trash2, `Delete ${fieldById[menu.valueId].label.toLowerCase()}`, { isDanger: true }),
		] : []),
	] : [];
	const menuChoose = (choice) => {
		menuSet(null);
		const [action, id] = String(choice).split(':');
		if (action === 'add') valueAdd(id);
		else if (action === 'delete') fieldSet(id, '');
	};
	const edit = {
		isShown,
		// the + of the card: the values not written yet, in a menu at the button
		add: addList.length && !isLocked ? {
			title: `Add a value: ${addList.map((field) => field.label.toLowerCase()).join(', ')}`,
			open: (event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				menuSet({ point: { x: rect.left, y: rect.bottom + 4 } });
			},
		} : null,
		// the link: no place of its own in the card, typed in a field floating under Join
		link: { isOpen: isOpen('url'), open: () => valueAdd('url'), field: valueRender('url') },
	};
	const card = <Render meeting={meeting} valueRender={valueRender} cellText={cellText} isEditing edit={edit} />;
	const menuDrawn = menu && menuItemList.length ? <DocMenu itemList={menuItemList} point={menu.point} onChoose={menuChoose} onClose={() => menuSet(null)} /> : null;
	if (isInPlace) return <>{card}{menuDrawn}</>;
	return (
		<>
			{card}
			{menuDrawn}
			<EditFloatingPanel label={kind.label}
				actions={<EditActions status={session.status} message={session.message} onSubmit={() => { if (!isLocked) void onEvent?.('editSubmitRequest', { raw: meetingRawBuild(kind, draft) }); }} onCancel={() => { if (!isLocked) void onEvent?.('editCancelRequest'); }} />} />
		</>
	);
});

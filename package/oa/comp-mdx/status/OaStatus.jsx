import { useRef, useState } from 'react';
import { Check, History, Trash2 } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { DocMenu, docMenuEntryBuild, docMenuSeparatorBuild } from '../../../../main/comp-doc/edit/DocMenu.jsx';
import { useEditOutsidePointer } from '../../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import {
	oaMomentOfTyped, oaMomentShown, oaStatusChangeAdd, oaStatusChangeRemove, oaStatusChangeSet, oaStatusHistoryOrdered, oaStatusLatest, oaStatusOf,
} from './oa-status.js';
import './OaStatus.css';

// The status of a card (doc/event.md#its-status): a pill saying the status of its latest change, beside
// the title. What the card keeps is the history of its changes (oa-status.js); the pill opens it.
//
// Read: a click on the pill shows the history, the latest change first, each with its moment and zone.
// Edited (isEditable), everything is done here:
//   a click on the pill      the statuses: one chosen is a change made now; History… shows the changes
//   in the history           a change's status: a click on it, another chosen; its moment: a click, typed
//                            loosely (1125 1830, as shown); a right click: Delete this change
//   a right click on the pill   the card's own menu (onContextMenu: deleting the status, adding values)
// Every change of the history is handed whole to onHistoryChange (the card writes it as its data).
//   history       [{ status, time, by? }] as the data holds it
//   statusList    the statuses of the kind ({ id, label, tone })
//   cell          the cell of the card's plain values, to type a moment (useCell)
//   fieldKeyBase  what the fields of its moments are keyed by
export function OaStatus({ history = [], statusList, isEditable = false, cell = null, fieldKeyBase = 'oa-status', onHistoryChange, onContextMenu }) {
	const rootRef = useRef(null);
	const pillRef = useRef(null);
	const [menu, menuSet] = useState(null);
	const [isHistoryOpen, isHistoryOpenSet] = useState(false);
	// the pill and its history are one place: a pointer going down elsewhere closes the history
	useEditOutsidePointer(rootRef, isHistoryOpen, () => isHistoryOpenSet(false));
	const latest = oaStatusLatest(history);
	const status = oaStatusOf(latest?.status, statusList);
	if (!status && !isEditable) return null;
	const historyChange = (next) => onHistoryChange?.(next);
	const pointBelow = (element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.left, y: rect.bottom + 4 };
	};
	const statusEntryList = (prefix, current) => statusList.map((one) => docMenuEntryBuild(`${prefix}:${one.id}`, current === one.id ? Check : null, one.label));
	const menuItemList = !menu ? [] : menu.kind === 'set' ? [
		...statusEntryList('set', latest?.status),
		docMenuSeparatorBuild('rule'),
		docMenuEntryBuild('history', History, `History (${history.length})`, { title: 'Every change of its status, with its moment' }),
	] : menu.kind === 'change' ? statusEntryList('change', history[menu.index]?.status)
		: menu.kind === 'changeRow' ? [docMenuEntryBuild('remove', Trash2, 'Delete this change', { isDanger: true })] : [];
	const menuChoose = (choice) => {
		const current = menu;
		menuSet(null);
		const [action, value] = String(choice).split(':');
		if (action === 'set' && value !== latest?.status) historyChange(oaStatusChangeAdd(history, value));
		else if (action === 'history') isHistoryOpenSet(true);
		else if (action === 'change') historyChange(oaStatusChangeSet(history, current.index, { status: value }));
		else if (action === 'remove') historyChange(oaStatusChangeRemove(history, current.index));
	};
	// the changes, the latest first
	const changeList = oaStatusHistoryOrdered(history).reverse();
	return (
		<span ref={rootRef} className="oa-status-root">
			{status ? (
				<button ref={pillRef} type="button" className="oa-status nodrag" data-tone={status.tone}
					title={isEditable ? `${status.label}: a click sets another status, its history kept` : `${status.label}${latest?.time ? `, since ${oaMomentShown(latest.time)}` : ''}: a click shows its history`}
					onClick={(event) => {
						event.stopPropagation();
						if (isEditable) menuSet({ kind: 'set', point: pointBelow(event.currentTarget) });
						else isHistoryOpenSet((isOpen) => !isOpen);
					}}
					onContextMenu={onContextMenu}>
					{status.label}
				</button>
			) : null}
			{isHistoryOpen && status ? (
				<AnchoredPopover anchorRef={pillRef} isTracked className="oa-status-history nodrag nopan">
					<span className="oa-status-history-head">Status history</span>
					{changeList.length ? (
						<span className="oa-status-history-list" role="list">
							{changeList.map((change) => {
								const one = oaStatusOf(change.status, statusList);
								return (
									<span key={change.index} className="oa-status-history-row" role="listitem"
										onContextMenu={isEditable ? (event) => { event.preventDefault(); event.stopPropagation(); menuSet({ kind: 'changeRow', point: { x: event.clientX, y: event.clientY }, index: change.index }); } : undefined}>
										<span className="oa-status-history-time">
											{isEditable && cell
												? <CellField cell={cell} value={oaMomentShown(change.time)} isEditable placeholder="when" ariaLabel="The moment of the change" fieldKey={`${fieldKeyBase}:change:${change.index}`}
													onCommit={(text) => {
														const read = oaMomentOfTyped(text, change.time);
														if (read.message) return { code: -1, message: read.message };
														if (read.moment !== change.time) historyChange(oaStatusChangeSet(history, change.index, { time: read.moment }));
														return undefined;
													}} />
												: oaMomentShown(change.time) || 'no moment'}
										</span>
										{isEditable ? (
											<button type="button" className="oa-status is-small" data-tone={one.tone} title="A click sets the status of this change"
												onClick={(event) => { event.stopPropagation(); menuSet({ kind: 'change', point: pointBelow(event.currentTarget), index: change.index }); }}>
												{one.label}
											</button>
										) : <span className="oa-status is-small" data-tone={one.tone}>{one.label}</span>}
										{/* always a cell, so every change is a row of the grid */}
										<span className="oa-status-history-by">{change.by ? `by ${change.by}` : ''}</span>
									</span>
								);
							})}
						</span>
					) : <span className="oa-status-history-empty">No change yet</span>}
				</AnchoredPopover>
			) : null}
			{menu && menuItemList.length ? <DocMenu itemList={menuItemList} point={menu.point} onChoose={menuChoose} onClose={() => menuSet(null)} /> : null}
		</span>
	);
}

// the statuses of a kind as the entries of a menu choosing one (the + of a card adding a status)
export function oaStatusMenuEntryList(statusList, prefix = 'status') {
	return statusList.map((one) => docMenuEntryBuild(`${prefix}:${one.id}`, null, one.label));
}

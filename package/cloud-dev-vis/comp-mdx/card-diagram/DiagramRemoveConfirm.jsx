import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Trash2 } from '../../../../main/frontend/UICommon.js';
import { usePopupCornerOffset, windowRectGet } from './DiagramPopupPlace.js';

// The question Delete asks before it takes away something other things depend on
// (card-diagram-impl.md#removing-what-is-selected): what goes, what depends on it and what becomes
// of each, and two buttons. It stands beside the thing (a corner of it at the top right of the
// thing's box, turned about that point at the edge of the window), as a popup of the edit layer, so a
// click in it is not a click outside the editor.
//
//   Enter, or Delete (the button focused)   takes it away: one step of the history
//   Escape, Cancel, a pointer going down elsewhere   nothing happens
//
// removal: the state of the editor (DiagramEditStore.removal: DiagramRemove.js, with rect, the box
// of the thing on the screen when it was asked); editor: removeConfirm(), removeCancel()
export const DiagramRemoveConfirm = observer(function DiagramRemoveConfirm({ editor, removal }) {
	const rootRef = useRef(null);
	const offset = usePopupCornerOffset(rootRef, windowRectGet, removal.key);
	const rect = removal.rect;
	const point = rect ? { x: rect.right + 8, y: rect.top } : { x: innerWidth / 2 - 150, y: innerHeight / 3 };
	// a pointer going down anywhere else gives it up, and does what it does there
	useEffect(() => {
		const pointerDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) editor.removeCancel({ isFocusKept: true }); };
		document.addEventListener('pointerdown', pointerDown, true);
		return () => document.removeEventListener('pointerdown', pointerDown, true);
	}, [editor]);
	const keyDown = (event) => {
		// its keys are its own: none reaches the editor (a portal passes them up the tree of React)
		if (event.key !== 'Tab') event.stopPropagation();
		if (event.key === 'Escape') { event.preventDefault(); editor.removeCancel(); }
	};
	return createPortal(
		<section ref={rootRef} className="doc-edit-popup doc-vis-remove-confirm not-prose" role="alertdialog" aria-label={`Delete ${removal.what}?`} onKeyDown={keyDown}
			style={{ left: point.x, top: point.y, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
			<div className="doc-vis-remove-confirm-question"><Trash2 size={13} aria-hidden="true" /><span>Delete {removal.what}?</span></div>
			<ul className="doc-vis-remove-confirm-list">
				{removal.dependentList.map(dependent => <li key={dependent.id}><strong>{dependent.label}</strong> {dependent.effect}</li>)}
			</ul>
			<div className="doc-vis-card-actions">
				<button type="button" className="doc-button is-danger" autoFocus onClick={() => editor.removeConfirm()}>Delete</button>
				<button type="button" className="doc-button" onClick={() => editor.removeCancel()}>Cancel</button>
				<span className="doc-note doc-vis-remove-confirm-hint">{removal.undoHint ?? 'Ctrl/⌘ + Z takes it back'}</span>
			</div>
		</section>,
		document.body,
	);
});

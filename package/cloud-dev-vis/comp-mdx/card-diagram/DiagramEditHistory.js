import { makeAutoObservable, observable } from 'mobx';

// The history of a draft while its edit session is open (card-diagram-impl.md#history):
// the states the draft went through, recorded at the one place every change
// of the draft passes (DiagramEditStore.changeApply), so undo and redo cover
// every command the engine has and every command a series adds, without the
// series doing anything for it. The class knows nothing of diagrams: a state
// is whatever its owner hands it (the diagram store hands its YAML document,
// its value and its text, which it later puts back as they were), and
// `isSame` says when two states are the same draft.
//
// What is a step:
//   - one command (a row inserted, a line drawn, a node dragged and dropped)
//   - except typing: changes recorded under one group key (the keystrokes in
//     a cell, in a text field of the edit card, the drags of a color picker)
//     stay one step until the group is closed, by the owner (the cell ended,
//     the path moved elsewhere) or by any step of another key, or by an undo
//   - a step that changed nothing is not recorded, and a grouped step that
//     ends where it started (a cell typed and restored with Escape) is
//     dropped, so an undo always undoes something
//
// What is not in it: the selection (the path of the edit card), the cell
// being typed, a gesture in progress, the camera: they are the state of the
// editor, not of the draft, and an undo re-resolves the path against the
// restored draft instead of restoring the path.
//
// The history lives in the browser with the session: it starts empty when
// the session opens with the data as saved, is dropped with the session when
// a save closes it, and is never written with the data.
export class EditHistory {
	past = [];        // [{ stateBefore, groupKey }], oldest first: the state before each step
	future = [];      // the states after the steps undone, the nearest last
	groupKey = null;  // the open group: the key the last step takes more changes under

	constructor({ limit = 200, isSame = (a, b) => a === b } = {}) {
		this.limit = limit;
		this.isSame = isSame;
		makeAutoObservable(this, { past: observable.shallow, future: observable.shallow, limit: false, isSame: false }, { autoBind: true });
	}

	get isUndoAvailable() { return this.past.length > 0; }
	get isRedoAvailable() { return this.future.length > 0; }
	get length() { return this.past.length; }

	// a change applied to the draft: the state before it, the state after it,
	// and the group the change belongs to (null for a step of its own)
	record(stateBefore, stateAfter, groupKey = null) {
		this.future = [];
		if (groupKey && groupKey === this.groupKey && this.past.length) {
			// the change joins the open step; a step back where it started goes
			if (this.isSame(this.past[this.past.length - 1].stateBefore, stateAfter)) {
				this.past.pop();
				this.groupKey = null;
			}
			return;
		}
		this.groupKey = null;
		if (this.isSame(stateBefore, stateAfter)) return;
		this.past.push({ stateBefore, groupKey });
		if (this.past.length > this.limit) this.past.shift();
		this.groupKey = groupKey;
	}

	// the open step takes no more changes: the next change of the same key
	// is a step of its own
	groupClose() { this.groupKey = null; }

	// the state to put back for an undo, given the current one (kept for a
	// redo); null when there is nothing to undo
	undo(stateCurrent) {
		const entry = this.past.pop();
		if (!entry) return null;
		this.future.push(stateCurrent);
		this.groupKey = null;
		return entry.stateBefore;
	}

	// the state to put back for a redo, given the current one; null when
	// there is nothing to redo
	redo(stateCurrent) {
		if (!this.future.length) return null;
		const state = this.future.pop();
		this.past.push({ stateBefore: stateCurrent, groupKey: null });
		this.groupKey = null;
		return state;
	}

	clear() {
		this.past = [];
		this.future = [];
		this.groupKey = null;
	}
}

// A node holding others (card-diagram-impl.md#a-node-holding-others): a node dragged onto another one
// that takes it becomes part of that one's data (one node: a meeting in a weekly timetable), and what a
// node holds can be let go again, a node of its own where it is dropped, or taken by another holder.
//
// The engine knows no kind that holds: a kind says so in its contract, and the engine asks it.
//   contract.nodeTakeReasonGet({ holder, dropped, editor })
//              undefined   it takes nothing of the sort (no mark, the drop is a move)
//              ''          it takes the dropped node
//              a text      it would, but not this one: why (marked as refused, the drop is a move)
//   contract.nodeTake({ holder, dropped, editor })
//              the holder's data with the dropped node in it; throws what it refuses
// What a node lets go is asked by whoever draws it (the card of the kind: it knows what it holds and
// where it is dragged): editor.nodeRelease answers the release. The kind card-comp is the one that
// holds today, through the component registry of the page (CardCompHold.js: expose.hold of the
// component it holds); a kind of a series may hold its own way.
//
// While something is dragged (a node, or a thing a node lets go), the node under the pointer that
// answers is marked on its box (DiagramRender.jsx: the mark of the store, nodeTakeMarkGet): it takes
// it, or it does not and why. Dropped there, the change is one step of the history: the holder's data
// and the node dropped removed (its lines detached, their ends free where they were: standard 7).

// the node under a point of the canvas that answers for a dropped node, topmost first: { nodeId,
// reason } (reason '' when it takes it), or null when none answers
//   idListAt     the ids of the nodes whose box holds the point, topmost first (canvas.nodeIdListAt)
//   exceptIdList what is not asked (the node dropped, the node letting go)
export function nodeTakeTargetGet({ store, registry, editor, dropped, idListAt, exceptIdList = [] }) {
	for (const nodeId of idListAt) {
		if (exceptIdList.includes(nodeId)) continue;
		const holder = store.nodeGet(nodeId);
		const contract = holder ? registry?.kindByType[holder.renderer?.type]?.contract : null;
		if (!contract?.nodeTakeReasonGet) continue;
		const reason = reasonCachedGet({ holder, dropped, editor, contract });
		if (reason === undefined) continue;
		return { nodeId, reason };
	}
	return null;
}

// the holder's data with the dropped node in it, or { message } when it refuses
export function nodeTakeDataGet({ store, registry, editor, holderId, dropped }) {
	const holder = store.nodeGet(holderId);
	const contract = holder ? registry?.kindByType[holder.renderer?.type]?.contract : null;
	if (!contract?.nodeTake) return { message: `${holderId} takes nothing.` };
	try {
		return { data: contract.nodeTake({ holder, dropped, editor }) };
	} catch (error) {
		return { message: String(error?.message ?? error) };
	}
}

// asked on every move of the pointer: the answer is kept for the same holder and the same data of
// both, so a drag asks a holder once per thing it passes over
let reasonLast = { key: '', reason: undefined };
function reasonCachedGet({ holder, dropped, editor, contract }) {
	const key = JSON.stringify([holder.id, holder.renderer, holder.data, dropped.renderer, dropped.data]);
	if (reasonLast.key === key) return reasonLast.reason;
	let reason;
	try {
		reason = contract.nodeTakeReasonGet({ holder, dropped, editor });
	} catch (error) {
		reason = `it could not tell: ${error?.message ?? error}`;
	}
	reasonLast = { key, reason };
	return reason;
}

// what a mark over a node says
export function nodeTakeMarkText(mark) {
	return mark.reason ? `Not taken here: ${mark.reason}` : 'Let go: it takes it';
}

import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronRight, Trash2 } from '../../../../main/frontend/UICommon.js';
import {
	zettelChainOf, zettelGet, zettelKnowledgeChildListOf, zettelLabelOf, zettelPathOf, zettelPathRead, zettelProgressCount, zettelProgressOf, zettelQuestionChildListOf, zettelQuestionIsDoubtful,
} from './ZettelData.js';
import { zettelDocPlain, zettelTextClip } from './ZettelDoc.js';
import { ZettelProgressDot } from './ZettelReader.jsx';

// What the left side of the explorer shows beside the map (doc/README.md#the-modes): the
// cards as an outline, the questions as a list, the notes of the reader. Each row opens its card.

// every knowledge card by the hierarchy, a branch folded or not
export const ZettelOutlinePanel = observer(function ZettelOutlinePanel({ model, store, path }) {
	const keyCurrent = zettelPathRead(model, path)?.key ?? '';
	const chainSet = new Set(zettelChainOf(model, keyCurrent).map((zettel) => zettel.key));
	return (
		<div className="zettel-panel" role="tree" aria-label="Outline">
			<ZettelOutlineItem model={model} store={store} zettelKey={model.rootKey} depth={0} keyCurrent={keyCurrent} chainSet={chainSet} />
		</div>
	);
});

const ZettelOutlineItem = observer(function ZettelOutlineItem({ model, store, zettelKey, depth, keyCurrent, chainSet }) {
	const zettel = zettelGet(model, zettelKey);
	if (!zettel) return null;
	const childList = zettelKnowledgeChildListOf(model, zettelKey);
	const questionCount = zettelQuestionChildListOf(model, zettelKey).length;
	// a branch is open at the root and along the way to the card read, unless the reader folded it;
	// below a hub it is folded until opened
	const isOpenDefault = depth === 0 || chainSet.has(zettelKey);
	const isToggled = store.outlineClosedSet.has(zettelKey);
	const isOpen = childList.length > 0 && (isOpenDefault ? !isToggled : isToggled);
	return (
		<>
			<div className="zettel-outline-row" role="treeitem" aria-expanded={childList.length > 0 ? isOpen : undefined} aria-current={zettelKey === keyCurrent ? 'true' : undefined} style={{ '--zettel-depth': depth }}>
				{childList.length > 0 ? (
					<button type="button" className="zettel-outline-fold" aria-label={isOpen ? 'Fold' : 'Unfold'} onClick={() => store.outlineToggle(zettelKey)}>{isOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}</button>
				) : <span className="zettel-outline-fold" aria-hidden="true" />}
				<button type="button" className="zettel-outline-name" title={zettel.summary} onClick={() => store.zettelOpen(model, zettelKey)}>
					<span>{zettel.title}</span>
					{zettel.level === 'fact' ? <em>fact</em> : null}
				</button>
				{questionCount > 0 ? <button type="button" className="zettel-outline-count" title={`${questionCount} questions of this area`} onClick={() => store.go(`${zettelPathOf(model, zettelKey)}/question`)}>{questionCount} Q</button> : null}
			</div>
			{isOpen ? childList.map((child) => <ZettelOutlineItem key={child.key} model={model} store={store} zettelKey={child.key} depth={depth + 1} keyCurrent={keyCurrent} chainSet={chainSet} />) : null}
		</>
	);
});

const STATUS_FILTER_LIST = [
	{ id: '', label: 'All' }, { id: 'none', label: 'Not tried' }, { id: 'wrong', label: 'Missed' }, { id: 'review', label: 'To review' }, { id: 'right', label: 'Right' }, { id: 'doubtful', label: 'Answer in doubt' },
];

// every question, filtered by its area and by how it went
export const ZettelQuestionPanel = observer(function ZettelQuestionPanel({ model, store, path }) {
	const keyCurrent = zettelPathRead(model, path)?.key ?? '';
	const questionAllList = model.zettelList.filter((zettel) => zettel.kind === 'question').sort((a, b) => a.number - b.number);
	const hubList = zettelKnowledgeChildListOf(model, model.rootKey).filter((hub) => questionAllList.some((question) => question.parentKey === hub.key));
	const filter = store.questionFilter;
	const questionList = questionAllList.filter((question) => {
		if (filter.hub && question.parentKey !== filter.hub) return false;
		if (filter.status === 'doubtful') return zettelQuestionIsDoubtful(question);
		if (filter.status) return (zettelProgressOf(model, question.key) || 'none') === filter.status;
		return true;
	});
	const count = zettelProgressCount(model, questionAllList);
	return (
		<div className="zettel-panel">
			<div className="zettel-panel-head">
				<p className="doc-note">{questionAllList.length} questions · {count.right} right · {count.wrong} missed · {count.review} to review · {count.none} not tried</p>
				<div className="zettel-filter" role="group" aria-label="Area">
					<button type="button" className="zettel-filter-chip" aria-pressed={filter.hub === ''} onClick={() => store.questionFilterSet({ hub: '' })}>All areas</button>
					{hubList.map((hub) => <button key={hub.key} type="button" className="zettel-filter-chip" aria-pressed={filter.hub === hub.key} title={hub.title} onClick={() => store.questionFilterSet({ hub: hub.key })}>{zettelLabelOf(hub)}</button>)}
				</div>
				<div className="zettel-filter" role="group" aria-label="How it went">
					{STATUS_FILTER_LIST.map((one) => <button key={one.id || 'all'} type="button" className="zettel-filter-chip" aria-pressed={filter.status === one.id} onClick={() => store.questionFilterSet({ status: one.id })}>{one.label}</button>)}
				</div>
			</div>
			<div className="zettel-row-list is-panel">
				{questionList.length === 0 ? <p className="doc-note">No question fits.</p> : null}
				{questionList.map((question) => (
					<button key={question.key} type="button" className="zettel-row is-question" aria-current={question.key === keyCurrent ? 'true' : undefined} onClick={() => store.zettelOpen(model, question.key)}>
						<span className="zettel-row-title">
							<ZettelProgressDot status={zettelProgressOf(model, question.key)} />
							<span className="zettel-row-number">Q{question.number}</span>
							<span className="zettel-row-name">{question.title}</span>
						</span>
						<span className="zettel-row-count">{zettelLabelOf(zettelGet(model, question.parentKey))}</span>
					</button>
				))}
			</div>
		</div>
	);
});

// the notes of the reader, the newest first: where each was taken, and its words
export const ZettelNotePanel = observer(function ZettelNotePanel({ model, store, service }) {
	const noteList = model.noteList;
	return (
		<div className="zettel-panel">
			<div className="zettel-panel-head">
				<p className="doc-note">{noteList.length === 0 ? 'No note yet. Notes are taken on a card while the document is in edit mode.' : `${noteList.length} notes, the newest first`}</p>
			</div>
			<div className="zettel-row-list is-panel">
				{noteList.map((note) => (
					<div key={note.key} className="zettel-row is-note">
						<span className="zettel-row-title">
							<a href={`#${note.target}`} role="button" className="zettel-link" onClick={(event) => { event.preventDefault(); store.zettelOpen(model, note.target, note.place); }}>{noteTargetLabelOf(model, note)}</a>
							<span className="zettel-row-count">{noteTimeText(note.timeCreate)}</span>
							{service?.docState?.isEditing ? <button type="button" className="zettel-note-button" title={service.isEditable ? 'Remove the note' : service.editUnavailableReason} aria-label="Remove the note" disabled={!service.isEditable} onClick={() => void store.noteRemove(service, note.key)}><Trash2 size={11} aria-hidden="true" /></button> : null}
						</span>
						<span className="zettel-row-text">{zettelTextClip(zettelDocPlain(note.text), 220)}</span>
					</div>
				))}
			</div>
		</div>
	);
});

// the card a note is on, and the place when it names one
function noteTargetLabelOf(model, note) {
	const zettel = zettelGet(model, note.target);
	if (!zettel) return note.target;
	const name = zettel.kind === 'question' ? `Q${zettel.number}` : zettel.title;
	const section = zettel.sectionList.find((one) => one.id === note.place);
	return note.place ? `${name} › ${section?.title || note.place}` : name;
}

// 20261109_23250530+09 -> 2026-11-09 23:25
function noteTimeText(time) {
	const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(String(time ?? ''));
	return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : '';
}

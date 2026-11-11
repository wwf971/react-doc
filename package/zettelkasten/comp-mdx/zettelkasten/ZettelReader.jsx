import { useEffect, useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, ChevronRight, DocsBody, Eye, EyeOff, LoaderCircle, Plus, StickyNote, Trash2, TriangleAlert, X } from '../../../../main/frontend/UICommon.js';
import { DocEditBody } from '../../../../main/comp-doc/edit/DocEditBody.jsx';
import { EditValueInline } from '../../../../main/comp-doc/edit/EditValueInline.jsx';
import { DocNavScopeContext } from '../../../../main/comp-doc/link/DocNavScope.js';
import { buildMdxComps } from '../../../../main/frontend/src/lib/mdx-comps.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { objectFrontendPartitionPlaceText } from '../../../../main/frontend/src/lib/doc-object-frontend.js';
import { DocLanguageProvider } from '../../../../built-in/comp-mdx/multi-lang/MultiLangContext.jsx';
import {
	zettelBacklinkListOf, zettelChainOf, zettelCountOf, zettelGet, zettelKnowledgeChildListOf, zettelLabelOf, zettelPathOf, zettelPathRead, zettelProgressCount, zettelProgressOf,
	zettelQuestionChildListOf, zettelQuestionIsDisputed, zettelQuestionRefListOf,
} from './ZettelData.js';
import { zettelOptionAnchorOf } from './ZettelDoc.js';
import { notePartitionOf } from './ZettelStore.js';

// The card being read (doc/README.md#the-card). A card is a document of the object: its
// text is compiled and rendered by the page as any document (ZettelDocBody), so its links,
// components and anchors are the page's; around it stands what the model knows of the card:
// where it is in the hierarchy, what lies below it, the questions using it, the cards
// pointing at it, the notes taken on it. A link to another card followed in here is answered
// here (DocNavScopeContext): the block shows that card, at the place the link names.
//
// In reading mode nothing changes the object. While the document of the block is edited
// (service.isEditable), the text of the card and of its notes is the edit body of the page's
// edit layer: edited block by block, as every document is; how a question went is the
// reader's own and is kept in either mode.
//
//   model, store     the cards; the state of the block (ZettelStore)
//   service          the api of the object's mode
//   path             the scene path read
export const ZettelReader = observer(function ZettelReader({ model, store, service, path }) {
	const rootRef = useRef(null);
	const { sourceStore } = useDocStores();
	const place = zettelPathRead(model, path);
	const zettel = place ? zettelGet(model, place.key) : null;
	const target = store.placeTarget;
	const placeAsked = target.path === path ? target.place : '';
	const docPath = zettel && !place.isQuestionList ? service.docPathGet(zettel.key) : '';
	const bodyStatus = docPath ? sourceStore.compiledByPath[docPath]?.status ?? 'loading' : 'none';
	const isRevealed = zettel?.kind === 'question' ? store.isRevealed(zettel.key) : true;
	// a place asked for is brought into view and marked, once the body that holds it is
	// there; a card opened as a whole starts at its top
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		for (const element of root.querySelectorAll('.doc-navigation-target')) element.classList.remove('doc-navigation-target');
		if (!placeAsked) {
			root.scrollTo({ top: 0 });
			return undefined;
		}
		let frameId = 0;
		let countTry = 0;
		const find = () => {
			const element = root.querySelector(`[data-place="${CSS.escape(placeAsked)}"]`) ?? root.querySelector(`[id="${CSS.escape(placeAsked)}"]`) ?? headingFind(root, placeAsked);
			if (!element) {
				countTry += 1;
				if (countTry < 40) frameId = requestAnimationFrame(find);
				return;
			}
			const mark = element.matches('span, a') && element.textContent.trim() === '' ? element.nextElementSibling ?? element : element;
			mark.classList.add('doc-navigation-target');
			const top = mark.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
			root.scrollTo({ top: Math.max(0, top - root.clientHeight * 0.2) });
		};
		find();
		return () => cancelAnimationFrame(frameId);
	}, [path, target.version, placeAsked, bodyStatus, isRevealed]);
	const navScope = useMemo(() => ({ handle: (request) => zettelNavHandle(model, store, service, request) }), [model, store, service]);
	const context = { model, store, service, path, onOpen: (key, placeTo) => store.zettelOpen(model, key, placeTo) };
	return (
		<DocNavScopeContext.Provider value={navScope}>
			<div ref={rootRef} className="zettel-reader">
				{store.message ? <p className="doc-error zettel-reader-message" role="status">{store.message}</p> : null}
				{!zettel ? <p className="doc-note">No card is open.</p> : null}
				{zettel ? <ZettelCrumb context={context} zettel={zettel} isQuestionList={place.isQuestionList} /> : null}
				{zettel && place.isQuestionList ? <ZettelQuestionListCard context={context} zettel={zettel} /> : null}
				{zettel && !place.isQuestionList && zettel.kind === 'question' ? <ZettelQuestionCard context={context} question={zettel} docPath={docPath} /> : null}
				{zettel && !place.isQuestionList && zettel.kind === 'zettel' ? <ZettelKnowledgeCard context={context} zettel={zettel} docPath={docPath} /> : null}
			</div>
		</DocNavScopeContext.Provider>
	);
});

// a heading of the body by its title, as a fragment names one (main/doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)
function headingFind(root, fragment) {
	const wanted = fragment.toLowerCase().replace(/[-\s]+/g, ' ').trim();
	return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((heading) => heading.textContent.toLowerCase().replace(/[-\s]+/g, ' ').trim() === wanted) ?? null;
}

// a link followed where the cards of this object are shown: a card is opened here, a note
// opens the card it is on. anything else is passed on
export function zettelNavHandle(model, store, service, request) {
	const owner = request.owner;
	if (!owner || owner.ref !== service.ref) return undefined;
	const note = model.noteList.find((one) => one.key === owner.key);
	if (note) {
		store.zettelOpen(model, note.target, note.place);
		return { code: 0, message: '' };
	}
	if (!zettelGet(model, owner.key)) return undefined;
	store.zettelOpen(model, owner.key, request.hash ?? '');
	return { code: 0, message: '' };
}

// the text of a card: the document the object registered, compiled and rendered by the page.
// while the document of the block is edited (isEditing) and the card can be written, it is
// the edit body of the page's edit layer instead: the same blocks, each edited in place with
// the toolbar, the insert menu and the editors every document has
// (main/doc_page_impl_edit.md#documents-that-are-not-files)
export const ZettelDocBody = observer(function ZettelDocBody({ path, className = '', isEditing = false }) {
	const { compById, docStore, sourceStore, editStore } = useDocStores();
	const isEdit = isEditing && Boolean(path) && editStore?.docIsEditable(path) === true;
	useEffect(() => { if (path) void sourceStore.loadDoc(path); }, [path, sourceStore]);
	useEffect(() => { if (isEdit) void editStore.docEditEnsure(path); }, [isEdit, path, editStore]);
	const compiled = path ? sourceStore.compiledByPath[path] : undefined;
	const mdxComps = useMemo(() => buildMdxComps(sourceStore.configDoc, compById, { sourcePath: path }), [compById, path, sourceStore.configDoc]);
	if (!path) return <p className="doc-note not-prose">This card is not registered as a document (its item is not Markdown, or its kind is not declared a document).</p>;
	const docEdit = isEdit ? editStore.docEditActiveGet(path) : undefined;
	if (docEdit) {
		return (
			<DocLanguageProvider language={docStore.languageSelected || compiled?.language}>
				<DocsBody className={`zettel-doc is-edit${className ? ` ${className}` : ''}`} data-doc-content=""><DocEditBody path={path} docEdit={docEdit} mdxComps={mdxComps} /></DocsBody>
			</DocLanguageProvider>
		);
	}
	if (!compiled || compiled.status === 'loading') return <p className="doc-status not-prose"><LoaderCircle size={12} aria-hidden="true" className="doc-spin" /><span>Reading the card</span></p>;
	if (compiled.status === 'error') return <p className="doc-error not-prose">{compiled.message}</p>;
	if (compiled.isContentEmpty) return null;
	const Body = compiled.Body;
	return (
		<DocLanguageProvider language={docStore.languageSelected || compiled.language}>
			<DocsBody className={`zettel-doc${className ? ` ${className}` : ''}`} data-doc-content=""><Body components={mdxComps} /></DocsBody>
		</DocLanguageProvider>
	);
});

// where the card is in the hierarchy: the cards above it, each a way up
const ZettelCrumb = observer(function ZettelCrumb({ context, zettel, isQuestionList }) {
	const chain = zettelChainOf(context.model, zettel.key);
	const upList = isQuestionList ? chain : chain.slice(0, -1);
	if (upList.length === 0) return null;
	return (
		<nav className="zettel-crumb not-prose" aria-label="The cards above this one">
			{upList.map((one, index) => (
				<span key={one.key} className="zettel-crumb-item">
					{index > 0 ? <ChevronRight size={11} aria-hidden="true" /> : null}
					<button type="button" className="zettel-crumb-button" onClick={() => context.onOpen(one.key, '')}>{zettelLabelOf(one)}</button>
				</span>
			))}
		</nav>
	);
});

const LEVEL_LABEL = { root: 'map', hub: 'area', topic: 'topic', fact: 'fact' };

// a link to a card drawn by the block itself (a row, a chip): the same look as a link of a text
function ZettelCardLink({ context, zettelKey, place = '', label = '', className = '' }) {
	const zettel = zettelGet(context.model, zettelKey);
	if (!zettel) return <span className="zettel-link is-missing" title={`There is no card "${zettelKey}"`}>{label || zettelKey}</span>;
	return (
		<a href={`#${zettelKey}`} role="button" className={`zettel-link${className ? ` ${className}` : ''}`} data-kind={zettel.kind} title={zettel.kind === 'question' ? `Question ${zettel.number}: ${zettel.title}` : zettel.summary} onClick={(event) => { event.preventDefault(); context.onOpen(zettelKey, place); }}>
			{label || (zettel.kind === 'question' ? `Q${zettel.number}` : zettel.title)}
		</a>
	);
}

const ZettelKnowledgeCard = observer(function ZettelKnowledgeCard({ context, zettel, docPath }) {
	const { model, store } = context;
	const childList = zettelKnowledgeChildListOf(model, zettel.key);
	const questionChildList = zettelQuestionChildListOf(model, zettel.key);
	const questionRefList = zettelQuestionRefListOf(model, zettel.key);
	const backlinkList = zettelBacklinkListOf(model, zettel.key);
	return (
		<article className="zettel-card" data-level={zettel.level}>
			<header className="zettel-card-head not-prose">
				<h2 className="zettel-card-title">{zettel.title}</h2>
				<p className="zettel-card-meta">
					<span className="doc-badge">{LEVEL_LABEL[zettel.level] ?? zettel.level}</span>
					<span className="zettel-card-key">{zettel.key}</span>
					{zettel.isUnverified ? <span className="doc-badge-outline" data-error="" title="Not checked against the documentation">not verified</span> : null}
				</p>
				{zettel.summary ? <p className="zettel-card-summary">{zettel.summary}</p> : null}
			</header>
			<ZettelCardText context={context} docPath={docPath} />
			<div className="not-prose">
				{childList.length > 0 ? (
					<section className="zettel-section">
						<h3 className="zettel-section-title"><span>Inside this card</span><em>{childList.length}</em></h3>
						<div className="zettel-row-list">
							{childList.map((child) => {
								const count = zettelCountOf(model, child.key);
								return (
									<button key={child.key} type="button" className="zettel-row" onClick={() => context.onOpen(child.key, '')}>
										<span className="zettel-row-title">{child.title}</span>
										<span className="zettel-row-text">{child.summary}</span>
										{count.zettel + count.question > 0 ? <span className="zettel-row-count">{count.zettel > 0 ? `${count.zettel} cards` : ''}{count.zettel > 0 && count.question > 0 ? ' · ' : ''}{count.question > 0 ? `${count.question} questions` : ''}</span> : null}
									</button>
								);
							})}
						</div>
					</section>
				) : null}
				{questionChildList.length > 0 ? (
					<section className="zettel-section">
						<h3 className="zettel-section-title"><span>Questions of this area</span><em>{questionChildList.length}</em></h3>
						<p className="zettel-section-action">
							<button type="button" className="doc-button" onClick={() => store.go(`${zettelPathOf(model, zettel.key)}/question`)}>Open the list</button>
							<ZettelProgressLine model={model} questionList={questionChildList} />
						</p>
					</section>
				) : null}
				{questionRefList.length > 0 ? (
					<section className="zettel-section">
						<h3 className="zettel-section-title"><span>Questions using this card</span><em>{questionRefList.length}</em></h3>
						<div className="zettel-row-list">
							{questionRefList.map((entry) => {
								const isRevealed = store.isRevealed(entry.question.key);
								return (
									<div key={entry.question.key} className="zettel-row is-question">
										<span className="zettel-row-title">
											<ZettelCardLink context={context} zettelKey={entry.question.key} />
											{entry.optionList.map((option) => (
												<button key={option.id} type="button" className="zettel-option-chip" data-verdict={isRevealed ? (option.isCorrect ? 'correct' : 'wrong') : undefined} title={`Option ${option.id} of question ${entry.question.number}`} onClick={() => context.onOpen(entry.question.key, zettelOptionAnchorOf(option.id))}>{option.id}</button>
											))}
											<span className="zettel-row-name">{entry.question.title}</span>
										</span>
										{isRevealed ? entry.textList.map((text, index) => <span key={index} className="zettel-row-text">{text}</span>) : null}
									</div>
								);
							})}
						</div>
					</section>
				) : null}
				{backlinkList.length > 0 ? (
					<section className="zettel-section">
						<h3 className="zettel-section-title"><span>Pointed at by</span><em>{backlinkList.length}</em></h3>
						<div className="zettel-row-list">
							{backlinkList.map((entry) => (
								<div key={entry.zettel.key} className="zettel-row">
									<span className="zettel-row-title"><ZettelCardLink context={context} zettelKey={entry.zettel.key} place={entry.linkList[0].fromPlace} /></span>
									{entry.linkList.slice(0, 2).map((link, index) => <span key={index} className="zettel-row-text">{link.text}</span>)}
								</div>
							))}
						</div>
					</section>
				) : null}
				<ZettelSourceList sourceList={zettel.sourceList} />
				<ZettelNoteSection context={context} zettel={zettel} />
				{/* at the foot: the toolbar floating over a block being edited never covers it */}
				<ZettelCardManage context={context} zettel={zettel} childCount={childList.length + questionChildList.length} />
			</div>
		</article>
	);
});

// what is done to a card as a whole while the document of the block is edited: a new card
// below it (its title asked in place), and the card removed (asked once, in place)
const ZettelCardManage = observer(function ZettelCardManage({ context, zettel, childCount }) {
	const { model, store, service } = context;
	useEffect(() => { store.cardOpenPendingTake(model); }, [store, model]);
	if (service.docState?.isEditing !== true) return null;
	const cardNew = store.cardNew;
	const cardRemove = store.cardRemove;
	const isNewHere = cardNew.parent === zettel.key;
	const isRemoveHere = cardRemove.key === zettel.key;
	const isRoot = zettel.key === model.rootKey;
	const removeReason = !service.isEditable ? service.editUnavailableReason : isRoot ? 'The root card of a box is not removed' : childCount > 0 ? 'Remove or move the cards and questions below it first' : '';
	return (
		<section className="zettel-section zettel-manage">
			<h3 className="zettel-section-title"><span>This card</span></h3>
			<p className="zettel-edit-line">
				<button type="button" className="doc-button" disabled={!service.isEditable} title={service.isEditable ? 'A new card below this one' : service.editUnavailableReason} onClick={() => store.cardNewOpen(zettel.key)}><Plus size={11} aria-hidden="true" /><span>New card below</span></button>
				<button type="button" className="doc-button" data-danger="" disabled={removeReason !== ''} title={removeReason || 'Remove this card from the box'} onClick={() => store.cardRemoveAsk(zettel.key)}><Trash2 size={11} aria-hidden="true" /><span>Remove card</span></button>
			</p>
			{isNewHere ? (
				<p className="zettel-edit-line">
					<span className="doc-note">title</span>
					<EditValueInline value={cardNew.title} placeholder="(the title of the new card)" isLocked={cardNew.isBusy} onCommit={(text) => store.cardNewTitleSet(text)} />
					<button type="button" className="doc-button" data-primary="" disabled={cardNew.isBusy || !cardNew.title.trim()} onClick={() => void store.cardNewRun(service, model)}>Create</button>
					<button type="button" className="doc-button" disabled={cardNew.isBusy} onClick={store.cardNewClose}>Cancel</button>
					{cardNew.message ? <span className="doc-error">{cardNew.message}</span> : null}
				</p>
			) : null}
			{isRemoveHere ? (
				<p className="zettel-edit-line">
					<span className="doc-note">Remove “{zettel.title}”? Links to it will show as missing.</span>
					<button type="button" className="doc-button" data-danger="" disabled={cardRemove.isBusy} onClick={() => void store.cardRemoveRun(service, model)}>Remove</button>
					<button type="button" className="doc-button" disabled={cardRemove.isBusy} onClick={store.cardRemoveClose}>Keep</button>
					{cardRemove.message ? <span className="doc-error">{cardRemove.message}</span> : null}
				</p>
			) : null}
		</section>
	);
});

// the text of a card: read, or edited block by block while the document of the block is edited
const ZettelCardText = observer(function ZettelCardText({ context, docPath }) {
	return <ZettelDocBody path={docPath} isEditing={context.service.isEditable} />;
});

function ZettelSourceList({ sourceList }) {
	if (sourceList.length === 0) return null;
	return (
		<section className="zettel-section">
			<h3 className="zettel-section-title"><span>Sources</span></h3>
			<div className="zettel-source-list">
				{sourceList.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a>)}
			</div>
		</section>
	);
}

const ZettelProgressLine = observer(function ZettelProgressLine({ model, questionList }) {
	const count = zettelProgressCount(model, questionList);
	return <span className="doc-note">{count.right} right · {count.wrong} missed · {count.review} to review · {count.none} not tried</span>;
});

// the questions below a card, one row each
const ZettelQuestionListCard = observer(function ZettelQuestionListCard({ context, zettel }) {
	const { model } = context;
	const questionList = zettelQuestionChildListOf(model, zettel.key);
	return (
		<article className="zettel-card not-prose">
			<header className="zettel-card-head">
				<h2 className="zettel-card-title">Questions — {zettel.title}</h2>
				<p className="zettel-card-meta"><ZettelProgressLine model={model} questionList={questionList} /></p>
			</header>
			<div className="zettel-row-list">
				{questionList.map((question) => (
					<button key={question.key} type="button" className="zettel-row is-question" onClick={() => context.onOpen(question.key, '')}>
						<span className="zettel-row-title"><ZettelProgressDot status={zettelProgressOf(model, question.key)} /><span className="zettel-row-number">Q{question.number}</span><span className="zettel-row-name">{question.title}</span></span>
						<span className="zettel-row-text">{question.summary && context.store.isRevealed(question.key) ? question.summary : ''}</span>
					</button>
				))}
			</div>
		</article>
	);
});

export function ZettelProgressDot({ status }) {
	const label = { right: 'answered right', wrong: 'missed', review: 'to review' }[status] ?? 'not tried';
	return <span className="zettel-progress-dot" data-status={status || 'none'} title={label} aria-label={label} />;
}

const PROGRESS_BUTTON_LIST = [{ id: 'right', label: 'Got it' }, { id: 'wrong', label: 'Missed' }, { id: 'review', label: 'Review later' }];

// a question: its stem and options from its data, to choose among; once the answer is
// shown, the verdict of each option, the answer, the clues, and its text: the analysis,
// with a section per option that a link names as {key}.md#option-b
const ZettelQuestionCard = observer(function ZettelQuestionCard({ context, question, docPath }) {
	const { model, store, service } = context;
	const isRevealed = store.isRevealed(question.key);
	const choiceList = store.choiceListOf(question.key);
	const status = zettelProgressOf(model, question.key);
	const isDisputed = zettelQuestionIsDisputed(question);
	const answerCount = question.answer.length;
	const zettelKeyList = question.zettelList.filter((key) => zettelGet(model, key));
	return (
		<article className="zettel-card" data-level="question">
			<div className="not-prose">
				<header className="zettel-card-head">
					<h2 className="zettel-card-title">Question {question.number} — {question.title}</h2>
					<p className="zettel-card-meta">
						<span className="doc-badge">question</span>
						<ZettelProgressDot status={status} />
						{isRevealed && isDisputed ? <span className="doc-badge-outline" data-error="" title="The answer of this card differs from the one the source of the questions gives">answer disputed</span> : null}
						{isRevealed && !isDisputed && question.answerConfidence !== 'high' ? <span className="doc-badge-outline" data-primary="" title="The answer is not certain">confidence {question.answerConfidence}</span> : null}
						{!question.isAnalysed ? <span className="doc-badge-outline" title="Only the answer of the source of the questions is known">not analysed</span> : null}
					</p>
				</header>
				<div className="zettel-question-stem">{question.stem.split(/\n{2,}|\n(?=[A-Z])/).map((part, index) => <p key={index}>{part}</p>)}</div>
				{!isRevealed && answerCount > 1 ? <p className="doc-note">Choose {answerCount}.</p> : null}
				<div className="zettel-option-list">
					{question.optionList.map((option) => {
						const isChosen = choiceList.includes(option.id);
						const verdict = isRevealed ? (option.isCorrect ? 'correct' : 'wrong') : undefined;
						return (
							<div key={option.id} className="zettel-option" data-place={isRevealed ? undefined : zettelOptionAnchorOf(option.id)} data-verdict={verdict} data-chosen={isChosen ? '' : undefined}>
								<button type="button" className="zettel-option-main" aria-pressed={isChosen} disabled={isRevealed} title={isRevealed ? undefined : 'Choose this option'} onClick={() => store.choiceToggle(question, option.id)}>
									<span className="zettel-option-id">{option.id}</span>
									<span className="zettel-option-text">{option.text}</span>
									{isRevealed ? <span className="zettel-option-verdict">{option.isCorrect ? <Check size={14} aria-label="correct" /> : <X size={14} aria-label="wrong" />}</span> : null}
								</button>
								{isRevealed && (isChosen || option.zettelList.length > 0) ? (
									<p className="zettel-chip-line zettel-option-foot">
										{isChosen ? <span className="zettel-option-chosen">{option.isCorrect ? 'You chose this: right.' : 'You chose this.'}</span> : null}
										{option.zettelList.map((key) => <ZettelCardLink key={key} context={context} zettelKey={key} className="is-chip" />)}
										{question.isAnalysed ? <a href={`#${zettelOptionAnchorOf(option.id)}`} role="button" className="zettel-link" onClick={(event) => { event.preventDefault(); context.onOpen(question.key, zettelOptionAnchorOf(option.id)); }}>why</a> : null}
									</p>
								) : null}
							</div>
						);
					})}
				</div>
				<div className="zettel-question-action">
					{isRevealed ? (
						<>
							{store.isPractice ? <button type="button" className="doc-button" onClick={() => store.hide(question.key)}><EyeOff size={12} aria-hidden="true" /><span>Hide the answer</span></button> : null}
							<span className="doc-button-group" role="group" aria-label="How it went">
								{PROGRESS_BUTTON_LIST.map((one) => (
									<button key={one.id} type="button" aria-pressed={status === one.id} disabled={!service?.isWritable} title={service?.isWritable ? 'Your own record of this question, kept in the progress item of the object' : service?.writeUnavailableReason} onClick={() => void store.progressSet(service, model, question.key, status === one.id ? '' : one.id)}>{one.label}</button>
								))}
							</span>
						</>
					) : (
						<button type="button" className="doc-button" data-primary="" onClick={() => void store.reveal(service, model, question)}>
							<Eye size={12} aria-hidden="true" />
							<span>{choiceList.length > 0 ? 'Check the answer' : 'Show the answer'}</span>
						</button>
					)}
				</div>
			</div>
			{isRevealed ? (
				<>
					<div className="not-prose">
						<section className="zettel-section">
							<h3 className="zettel-section-title"><span>Answer</span></h3>
							<p className="zettel-answer-line">
								<strong className="zettel-answer-letter">{question.answer}</strong>
								{question.answerDump ? <span className="doc-note">{isDisputed ? `the source of the questions says ${question.answerDump}` : 'as the source of the questions says'}</span> : null}
								{question.voteList.length > 0 ? <span className="doc-note">community vote: {question.voteList.map((vote) => `${vote.answer} ${vote.percent}%`).join(', ')}</span> : null}
							</p>
							{!question.isAnalysed ? <p className="zettel-answer-note"><TriangleAlert size={13} aria-hidden="true" /><span>This question is not analysed yet: the answer shown is the one the source of the questions gives, which is sometimes wrong.</span></p> : null}
						</section>
						{question.clueList.length > 0 ? (
							<section className="zettel-section">
								<h3 className="zettel-section-title"><span>Clues in the question</span></h3>
								<div className="zettel-clue-list">
									{question.clueList.map((clue, index) => (
										<div key={index} className="zettel-clue">
											<span className="zettel-clue-text">“{clue.text}”</span>
											<span className="zettel-clue-implies">{clue.implies}</span>
										</div>
									))}
								</div>
							</section>
						) : null}
					</div>
					<div className="zettel-section zettel-section-doc"><ZettelCardText context={context} docPath={docPath} /></div>
					<div className="not-prose">
						{zettelKeyList.length > 0 ? (
							<section className="zettel-section">
								<h3 className="zettel-section-title"><span>Cards needed</span><em>{zettelKeyList.length}</em></h3>
								<p className="zettel-chip-line">{zettelKeyList.map((key) => <ZettelCardLink key={key} context={context} zettelKey={key} className="is-chip" />)}</p>
							</section>
						) : null}
						<ZettelSourceList sourceList={question.sourceList} />
						<ZettelNoteSection context={context} zettel={question} />
					</div>
				</>
			) : null}
		</article>
	);
});

// the notes taken on a card, each a document of the object. while the document of the block
// is edited, a note is added (on the card, or on one of its places) and removed here, and its
// text is edited block by block as any document; in reading mode they are read
const ZettelNoteSection = observer(function ZettelNoteSection({ context, zettel }) {
	const { model, store, service } = context;
	const noteList = model.noteListByTarget.get(zettel.key) ?? [];
	const isEditing = service.docState?.isEditing === true;
	if (noteList.length === 0 && !isEditing) return null;
	const placeList = zettel.kind === 'question'
		? zettel.optionList.map((option) => ({ id: zettelOptionAnchorOf(option.id), label: `Option ${option.id}` }))
		: zettel.sectionList.filter((section) => section.id && section.title).map((section) => ({ id: section.id, label: section.title }));
	const placeLabelOf = (placeId) => placeList.find((one) => one.id === placeId)?.label ?? placeId;
	const partition = (service?.partitionList ?? []).find((one) => one.id === notePartitionOf(service));
	const add = store.noteAdd;
	return (
		<section className="zettel-section">
			<h3 className="zettel-section-title"><StickyNote size={13} aria-hidden="true" /><span>Notes</span><em>{noteList.length}</em></h3>
			<div className="zettel-note-area">
				{noteList.map((note) => (
					<div key={note.key} className="zettel-note">
						<div className="zettel-note-body">
							{note.place ? <a href={`#${note.place}`} role="button" className="zettel-note-place" onClick={(event) => { event.preventDefault(); context.onOpen(zettel.key, note.place); }}>on {placeLabelOf(note.place)}</a> : null}
							<ZettelDocBody path={service.docPathGet(note.key)} className="zettel-note-text" isEditing={service.isEditable} />
						</div>
						{isEditing ? (
							<span className="zettel-note-action">
								<button type="button" className="zettel-note-button" title={service.isEditable ? 'Remove the note' : service.editUnavailableReason} aria-label="Remove the note" disabled={!service.isEditable} onClick={() => void store.noteRemove(service, note.key)}><Trash2 size={11} aria-hidden="true" /></button>
							</span>
						) : null}
					</div>
				))}
				{isEditing ? (
					<div className="zettel-note-add">
						<span className="doc-note">A new note, on</span>
						<div className="zettel-filter" role="group" aria-label="The place the note is on">
							<button type="button" className="zettel-filter-chip" aria-pressed={add.target !== zettel.key || add.place === ''} onClick={() => store.noteAddPlaceSet(zettel.key, '')}>the whole card</button>
							{placeList.map((one) => <button key={one.id} type="button" className="zettel-filter-chip" aria-pressed={add.target === zettel.key && add.place === one.id} onClick={() => store.noteAddPlaceSet(zettel.key, one.id)}>{one.label}</button>)}
						</div>
						<p className="zettel-edit-line">
							<button type="button" className="doc-button" disabled={!service.isEditable || add.isBusy} title={service.isEditable ? 'Add a note, then write it as a document' : service.editUnavailableReason} onClick={() => void store.noteAddRun(service, zettel.key)}><Plus size={11} aria-hidden="true" /><span>Add a note</span></button>
							<span className="doc-note">goes to {objectFrontendPartitionPlaceText(partition, 'note')}</span>
							{add.message ? <span className="doc-error">{add.message}</span> : null}
						</p>
					</div>
				) : null}
			</div>
		</section>
	);
});

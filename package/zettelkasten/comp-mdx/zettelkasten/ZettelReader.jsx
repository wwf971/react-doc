import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, ChevronRight, DocsBody, Eye, EyeOff, LoaderCircle, Network, Plus, StickyNote, Trash2, TriangleAlert, X } from '../../../../main/frontend/UICommon.js';
import { DocEditBody } from '../../../../main/comp-doc/edit/DocEditBody.jsx';
import { DocNavScopeContext } from '../../../../main/comp-doc/link/DocNavScope.js';
import { buildMdxComps } from '../../../../main/frontend/src/lib/mdx-comps.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { objectFrontendPartitionPlaceText } from '../../../../main/frontend/src/lib/doc-object-frontend.js';
import { DocLanguageProvider } from '../../../../built-in/comp-mdx/multi-lang/MultiLangContext.jsx';
import { zettelChainOf, zettelGet, zettelLabelOf, zettelProgressOf, zettelQuestionIsDisputed, zettelRoleBuild } from './ZettelData.js';
import { zettelOptionAnchorOf } from './ZettelDoc.js';
import { ZETTEL_PLACE_LIST } from './ZettelScenes.js';
import { notePartitionOf } from './ZettelStore.js';

// The text of a zettel (doc/README.md#a-zettel-is-a-card): the body of the card while it shows
// its text. A zettel is a document of the object: its text is compiled and rendered by the page
// as any document (ZettelDocBody), so its links, components and anchors are the page's; around
// it stands what the model knows of it: where it is (the zettels holding it), how many
// connections it has (a strip opening the connection view at them), its sources, the notes taken
// on it. A link to another zettel followed in here is answered here (DocNavScopeContext): the
// zettel shows that one, at the place the link names.
//
// In reading mode nothing changes the object. While the document of the block is edited
// (service.isEditable), the text of the zettel and of its notes is the edit body of the page's
// edit layer: edited block by block, as every document is; how a question went is the reader's
// own and is kept in either mode.
//
//   model, store     the zettels; the state of the block (ZettelStore)
//   service          the api of the object's mode
//   rootRef          the element that scrolls: the text layer of the zettel (ZettelMotion.js moves it)
export const ZettelText = observer(function ZettelText({ model, store, service, rootRef, isHidden = false }) {
	const { sourceStore } = useDocStores();
	const zettel = zettelGet(model, store.zettelKey);
	const target = store.placeTarget;
	const placeAsked = target.key === store.zettelKey ? target.place : '';
	const docPath = zettel ? service.docPathGet(zettel.key) : '';
	const bodyStatus = docPath ? sourceStore.compiledByPath[docPath]?.status ?? 'loading' : 'none';
	const isRevealed = zettel?.kind === 'question' ? store.isRevealed(zettel.key) : true;
	// a place asked for is brought into view and marked, once the body that holds it is there;
	// a zettel opened as a whole starts at its top
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
	}, [store.zettelKey, target.version, placeAsked, bodyStatus, isRevealed]);
	const navScope = useMemo(() => ({ handle: (request) => zettelNavHandle(model, store, service, request) }), [model, store, service]);
	const context = { model, store, service, onOpen: (key, placeTo) => store.zettelOpen(model, key, placeTo) };
	return (
		<DocNavScopeContext.Provider value={navScope}>
			<div ref={rootRef} className="zettel-layer zettel-layer-text" aria-hidden={isHidden ? 'true' : undefined}>
				{store.message ? <p className="doc-error zettel-text-message" role="status">{store.message}</p> : null}
				{!zettel ? <p className="doc-note">No zettel is open.</p> : null}
				{zettel ? <ZettelCrumb context={context} zettel={zettel} /> : null}
				{zettel?.kind === 'question' ? <ZettelQuestionText context={context} question={zettel} docPath={docPath} /> : null}
				{zettel?.kind === 'zettel' ? <ZettelKnowledgeText context={context} zettel={zettel} docPath={docPath} /> : null}
			</div>
		</DocNavScopeContext.Provider>
	);
});

// a heading of the body by its title, as a fragment names one (main/doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)
function headingFind(root, fragment) {
	const wanted = fragment.toLowerCase().replace(/[-\s]+/g, ' ').trim();
	return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((heading) => heading.textContent.toLowerCase().replace(/[-\s]+/g, ' ').trim() === wanted) ?? null;
}

// a link followed where the zettels of this object are shown: a zettel is opened here with its
// text, a note opens the zettel it is on. anything else is passed on
export function zettelNavHandle(model, store, service, request) {
	const owner = request.owner;
	if (!owner || owner.ref !== service.ref) return undefined;
	const note = model.noteList.find((one) => one.key === owner.key);
	if (note) {
		store.zettelRead(model, note.target, note.place);
		return { code: 0, message: '' };
	}
	if (!zettelGet(model, owner.key)) return undefined;
	store.zettelRead(model, owner.key, request.hash ?? '');
	return { code: 0, message: '' };
}

// the text of a zettel: the document the object registered, compiled and rendered by the page.
// while the document of the block is edited (isEditing) and the zettel can be written, it is the
// edit body of the page's edit layer instead: the same blocks, each edited in place with the
// toolbar, the insert menu and the editors every document has
// (main/doc_page_impl_edit.md#documents-that-are-not-files)
export const ZettelDocBody = observer(function ZettelDocBody({ path, className = '', isEditing = false }) {
	const { compById, docStore, sourceStore, editStore } = useDocStores();
	const isEdit = isEditing && Boolean(path) && editStore?.docIsEditable(path) === true;
	useEffect(() => { if (path) void sourceStore.loadDoc(path); }, [path, sourceStore]);
	useEffect(() => { if (isEdit) void editStore.docEditEnsure(path); }, [isEdit, path, editStore]);
	const compiled = path ? sourceStore.compiledByPath[path] : undefined;
	const mdxComps = useMemo(() => buildMdxComps(sourceStore.configDoc, compById, { sourcePath: path }), [compById, path, sourceStore.configDoc]);
	if (!path) return <p className="doc-note not-prose">This zettel is not registered as a document (its item is not Markdown, or its kind is not declared a document).</p>;
	const docEdit = isEdit ? editStore.docEditActiveGet(path) : undefined;
	if (docEdit) {
		return (
			<DocLanguageProvider language={docStore.languageSelected || compiled?.language}>
				<DocsBody className={`zettel-doc is-edit${className ? ` ${className}` : ''}`} data-doc-content=""><DocEditBody path={path} docEdit={docEdit} mdxComps={mdxComps} /></DocsBody>
			</DocLanguageProvider>
		);
	}
	if (!compiled || compiled.status === 'loading') return <p className="doc-status not-prose"><LoaderCircle size={12} aria-hidden="true" className="doc-spin" /><span>Reading the zettel</span></p>;
	if (compiled.status === 'error') return <p className="doc-error not-prose">{compiled.message}</p>;
	if (compiled.isContentEmpty) return null;
	const Body = compiled.Body;
	return (
		<DocLanguageProvider language={docStore.languageSelected || compiled.language}>
			<DocsBody className={`zettel-doc${className ? ` ${className}` : ''}`} data-doc-content=""><Body components={mdxComps} /></DocsBody>
		</DocLanguageProvider>
	);
});

// where the zettel is: the zettels holding it, through the first container of each, each a way up
const ZettelCrumb = observer(function ZettelCrumb({ context, zettel }) {
	const upList = zettelChainOf(context.model, zettel.key).slice(0, -1);
	if (upList.length === 0) return null;
	return (
		<nav className="zettel-crumb not-prose" aria-label="The zettels holding this one">
			{upList.map((one, index) => (
				<span key={one.key} className="zettel-crumb-item">
					{index > 0 ? <ChevronRight size={11} aria-hidden="true" /> : null}
					<button type="button" className="zettel-crumb-button" onClick={() => context.onOpen(one.key, '')}>{zettelLabelOf(one)}</button>
				</span>
			))}
		</nav>
	);
});

// a link to a zettel drawn by the block itself (a chip): the same look as a link of a text
function ZettelCardLink({ context, zettelKey, place = '', label = '', className = '' }) {
	const zettel = zettelGet(context.model, zettelKey);
	if (!zettel) return <span className="zettel-link is-missing" title={`There is no zettel "${zettelKey}"`}>{label || zettelKey}</span>;
	return (
		<a href={`#${zettelKey}`} role="button" className={`zettel-link${className ? ` ${className}` : ''}`} data-kind={zettel.kind} title={zettel.kind === 'question' ? `Question ${zettel.number}: ${zettel.title}` : zettel.summary} onClick={(event) => { event.preventDefault(); context.onOpen(zettelKey, place); }}>
			{label || (zettel.kind === 'question' ? `Q${zettel.number}` : zettel.title)}
		</a>
	);
}

const ZettelKnowledgeText = observer(function ZettelKnowledgeText({ context, zettel, docPath }) {
	return (
		<article className="zettel-text" data-level={zettel.level}>
			{zettel.summary ? <p className="zettel-text-summary not-prose">{zettel.summary}</p> : null}
			{zettel.isUnverified ? <p className="zettel-text-meta not-prose"><span className="doc-badge-outline" data-error="" title="Not checked against the documentation">not verified</span></p> : null}
			<ZettelDocBody path={docPath} isEditing={context.service.isEditable} />
			<div className="not-prose">
				<ZettelConnectionStrip context={context} zettel={zettel} />
				<ZettelSourceList sourceList={zettel.sourceList} />
				<ZettelNoteSection context={context} zettel={zettel} />
			</div>
		</article>
	);
});

// how many connections the zettel has, by place: each opens the connection view at that place alone
const ZettelConnectionStrip = observer(function ZettelConnectionStrip({ context, zettel }) {
	const { model, store } = context;
	const role = zettelRoleBuild(model, zettel.key);
	const countByPlace = { c: role.containerList.length, h: role.childList.length, b: role.inList.length, f: role.outList.length + role.groupList.reduce((sum, group) => sum + group.itemList.length, 0), q: role.questionList.length };
	const placeList = ZETTEL_PLACE_LIST.filter((place) => countByPlace[place.id] > 0);
	if (placeList.length === 0) return null;
	const open = (code) => {
		store.placeCodeSet(code);
		store.viewSet('link');
	};
	return (
		<section className="zettel-section zettel-strip" aria-label="Connections">
			<button type="button" className="zettel-strip-all" title="Show every connection of this zettel" onClick={() => open(ZETTEL_PLACE_LIST.map((place) => place.id).join(''))}><Network size={12} aria-hidden="true" /><span>Connections</span></button>
			{placeList.map((place) => <button key={place.id} type="button" className="zettel-filter-chip" title={`${place.title}: show them alone`} onClick={() => open(place.id)}>{place.label}<em>{countByPlace[place.id]}</em></button>)}
		</section>
	);
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

export function ZettelProgressDot({ status }) {
	const label = { right: 'answered right', wrong: 'missed', review: 'to review' }[status] ?? 'not tried';
	return <span className="zettel-progress-dot" data-status={status || 'none'} title={label} aria-label={label} />;
}

const PROGRESS_BUTTON_LIST = [{ id: 'right', label: 'Got it' }, { id: 'wrong', label: 'Missed' }, { id: 'review', label: 'Review later' }];

// a question: its stem and options from its data, to choose among; once the answer is shown,
// the verdict of each option, the answer, the clues, and its text: the analysis, with a section
// per option that a link names as {key}.md#option-b
const ZettelQuestionText = observer(function ZettelQuestionText({ context, question, docPath }) {
	const { model, store, service } = context;
	const isRevealed = store.isRevealed(question.key);
	const choiceList = store.choiceListOf(question.key);
	const status = zettelProgressOf(model, question.key);
	const isDisputed = zettelQuestionIsDisputed(question);
	const answerCount = question.answer.length;
	return (
		<article className="zettel-text" data-level="question">
			<div className="not-prose">
				<p className="zettel-text-meta">
					<ZettelProgressDot status={status} />
					<span className="doc-note">{{ right: 'answered right', wrong: 'missed', review: 'to review' }[status] ?? 'not tried yet'}</span>
					{isRevealed && isDisputed ? <span className="doc-badge-outline" data-error="" title="The answer of this question differs from the one the source of the questions gives">answer disputed</span> : null}
					{isRevealed && !isDisputed && question.answerConfidence !== 'high' ? <span className="doc-badge-outline" data-primary="" title="The answer is not certain">confidence {question.answerConfidence}</span> : null}
					{!question.isAnalysed ? <span className="doc-badge-outline" title="Only the answer of the source of the questions is known">not analysed</span> : null}
				</p>
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
					<div className="zettel-section zettel-section-doc"><ZettelDocBody path={docPath} isEditing={service.isEditable} /></div>
					<div className="not-prose">
						<ZettelConnectionStrip context={context} zettel={question} />
						<ZettelSourceList sourceList={question.sourceList} />
						<ZettelNoteSection context={context} zettel={question} />
					</div>
				</>
			) : null}
		</article>
	);
});

// the notes taken on a zettel, each a document of the object. while the document of the block is
// edited, a note is added (on the zettel, or on one of its places) and removed here, and its text
// is edited block by block as any document; in reading mode they are read
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
							<button type="button" className="zettel-filter-chip" aria-pressed={add.target !== zettel.key || add.place === ''} onClick={() => store.noteAddPlaceSet(zettel.key, '')}>the whole zettel</button>
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

// what the reader sees while a body is not drawn yet: as tall as it will be
export function ZettelReading({ text = 'Reading the zettels' }) {
	return <p className="doc-status not-prose"><LoaderCircle aria-hidden="true" size={12} className="doc-spin" /><span>{text}</span></p>;
}


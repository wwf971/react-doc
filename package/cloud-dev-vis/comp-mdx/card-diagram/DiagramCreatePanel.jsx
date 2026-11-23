import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, LoaderCircle, Plus, Search, Type, X, Zap } from '../../../../main/frontend/UICommon.js';
import { ObjectIcon } from '../../../../main/comp-doc/object/object-icon.jsx';
import { textHighlight } from '../../../../main/comp-doc/object/ObjectSearchPanel.jsx';
import { EditSourceSurface } from '../../../../main/comp-doc/edit/EditSourceSurface.jsx';
import { useEditSlashConfig } from '../../../../main/comp-doc/slash/use-edit-slash-config.js';
import { slashActionDefine } from '../../../../main/comp-doc/slash/slash-define.js';
import { slashEffect } from '../../../../main/frontend/src/lib/doc-slash.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { nodeRegistrySearch } from './node-registry.js';

// The panel of a double-click on empty canvas: what can be added there
// (the create entries of the node registry of the component, node-registry.js),
// searched by typing, like the insert menu of a
// block. ArrowDown / ArrowUp move in the list, Enter takes the highlighted
// entry (the first when none is), Escape closes, and so does a pointer going
// down outside the panel. The chosen node is created at the panel's position
// and selected; a connection is created with two free ends.
//
// Below the kinds, the **objects** the text finds in the page's object
// service layer (doc_page_impl_obj_search.md), when the page offers its
// search (config.object): each one is added as a node drawn by ObjectView,
// a card of the object whatever its type, with an in and an out handle. The
// search keeps its state in a session of the layer (sessionKey), runs only
// once something is typed, and never lists a host that has too many objects:
// such a host is a line with its count and a way to load its first ones.
// The diagram narrows the search with its option objectSearch:
//   objectSearch: { typeList: [core.task], isEnabled: true }
// the engine knows no type: it adds a registered component by name
// (DiagramEditStore.nodeComponentAdd)
//
// A host may offer **sources** of its own (config.createSourceList): things to add that
// are neither kinds nor objects of the page, found by the text typed (the tables of a
// database, read from where the host knows). The engine knows nothing of what they are:
//   { id, label,                   the heading of its entries
//     placeholder?,                what the field says while empty (the first source's)
//     isBeforeKinds?,              its entries stand above the kinds of the registry
//     search(text) → { entryList: [{ id, label, description?, icon? }], note?, actionList?: [{ id, label, run() }] }
//                                  or a promise of it. note: a line under its entries (why there are
//                                  none, how old they are); actionList: buttons beside the note (read
//                                  the names again), after which the search runs again
//     choose(entry, position, editor)   adds it, with the commands of editor.store through
//                                  editor.change, at once or when a promise ends }
//
// A host may also offer **actions** (config.createActionList): entries of the list that do
// something rather than add one thing, under the heading Actions:
//   { id, label, description?, icon?, keywordList?,
//     isDisabled?, reason?,         greyed out, the reason said in the place of the description:
//                                   what cannot be done here is shown, not hidden
//     kind?: 'danger',              it takes something away: its words and its icon in red
//     start({ position, editor }) → a state, or nothing }
// An action that answers a **state** puts the panel into it: the panel then asks for what the
// action needs, one state at a time (a state machine the host runs: each state says what the
// next is). While it is in a state the panel says so: a line over the field names the states
// entered, with a button leaving the last (Escape does the same, after emptying the field).
//   state: { id, label,               what the panel is doing now: the word of the line
//     placeholder?,                   what the field says while empty
//     search?(text) → { entryList, note?, actionList? }   what is offered, as a source answers
//     isMulti?,                       entries are ticked, and committed together
//     commitLabel?(count),            what the button committing them says
//     isText?,                        the text typed is the value: Enter takes it (no list)
//     choose?(entry | { text }, api)  an entry taken (not isMulti), or the text
//     commit?(entryList, api) }       the ticked entries taken (isMulti)
//   choose and commit answer, at once or as a promise: another state (the next thing to ask),
//   'back' (the state before), or nothing (done: the panel closes). api: { position, editor }.
//   What they throw is said in the panel, which stays as it is.
// A host opens the panel in the state of an action with editor.createOpen(position, { actionId }).
//
// The field is a text of the page (EditSourceSurface, plain) with the **slash mode** of the page
// (doc_page_impl_edit_slash.md#beyond-the-document-editors): `/` lists what the panel offers by name
// (the actions, then the kinds: /note, /table, /shape) in the page's slash menu, and the panel's own
// list steps aside while it does; Enter on one takes it. Without the slash mode (switched off, or
// outside a page) a `/` typed is ignored by the search. Words typed otherwise search the list.
//
// textTake: { label, take(text, position) } (a feature of the editor: editor.createTextGet): words
// typed are also a thing of their own, a text at that place. The panel then lists them first,
// highlighted, so Enter makes the text; the arrows reach what the words found.
//
// The panel serves a scene of scenes too (card-diagram-switch: the commands of a scene, opened by a
// double-click on its canvas or a right-click on a card or a line): there is no diagram being edited,
// so the editor given has no store (no kinds of the registry, no objects), only createClose; the
// actions are the commands, under the heading given (heading), the field saying placeholder.
const SOURCE_LIST_NONE = [];
const ACTION_LIST_NONE = [];

export const DiagramCreatePanel = observer(function DiagramCreatePanel({ position, editor, objectService, sessionKey, sourceList = SOURCE_LIST_NONE, actionList = ACTION_LIST_NONE, actionIdInitial, heading = 'Actions', placeholder: placeholderGiven, ariaLabel = 'Add to the diagram', isActionOnly = false, textTake }) {
	const [query, querySet] = useState('');
	const slashStore = useDocStores()?.slashStore;
	// the states entered, the last the one the panel is in; opened in the state of an action when asked to
	// opened at an action: in its state, or, an action asking nothing, done at once and closed
	const isStartedAtOnce = useRef(false);
	const [stateStack, stateStackSet] = useState(() => {
		const action = actionIdInitial ? actionList.find(one => one.id === actionIdInitial && !one.isDisabled) : null;
		if (!action) return [];
		const state = action.start({ position, editor });
		if (!state) isStartedAtOnce.current = true;
		return state ? [state] : [];
	});
	useEffect(() => { if (isStartedAtOnce.current) editor.createClose(); }, [editor]);
	const [isStateOnly] = useState(() => stateStack.length > 0);
	const stateCurrent = stateStack[stateStack.length - 1];
	const [indexActive, indexActiveSet] = useState(0);
	const root = useRef(null);
	const source = useCreateSourceSearch(sourceList, query);
	// a draft whose structure is given takes no node of the registry: what the host offers alone
	// isActionOnly: the panel of a thing (a right-click on a node or a line), which offers what
	// can be done with it and nothing to add
	// a `/` at the start names what to take (the slash mode lists it); the search reads the words after it
	const isSlashQuery = query.startsWith('/');
	const isSlashMenu = isSlashQuery && Boolean(slashStore?.isOn);
	const queryWords = (isSlashQuery ? query.slice(1) : query).replace(/\s+/g, ' ');
	const kindAllList = editor.store && !editor.store.isStructureFixed && !isActionOnly ? nodeRegistrySearch(editor.store.registry, '').map(({ entry }) => entry) : [];
	const kindEntryList = editor.store && !editor.store.isStructureFixed && !isActionOnly ? nodeRegistrySearch(editor.store.registry, queryWords).map(({ entry }) => entry) : [];
	const sourceEntryListOf = isBefore => source.groupList.filter(group => Boolean(group.source.isBeforeKinds) === isBefore).flatMap(group => group.entryList);
	const entryList = kindEntryList;
	const option = editor.store && !editor.store.isStructureFixed && !isActionOnly ? objectSearchOptionGet(editor.store) : { isEnabled: false, typeList: [] };
	const session = objectService?.searchSessionGet && option.isEnabled ? objectService.searchSessionGet(sessionKey, { typeList: option.typeList, fetchMax: 20 }) : undefined;
	const hitList = session && queryWords.trim() ? session.hitList : [];
	const objectEntryList = hitList.map(hit => ({
		id: `object:${hit.descriptor.ref}`,
		hit,
		nodeComponent: { compName: 'ObjectView', data: { object: hit.descriptor.ref }, idPrefix: 'object' },
	}));
	const wordListAction = queryWords.toLowerCase().split(/\s+/).filter(Boolean);
	const actionEntryList = actionList.filter(action => wordListAction.every(word => [action.label, action.description ?? '', ...(action.keywordList ?? [])].join(' ').toLowerCase().includes(word)))
		.map(action => ({ ...action, id: `action:${action.id}`, action }));
	const sourceBeforeList = [...actionEntryList, ...sourceEntryListOf(true)];
	const sourceAfterList = sourceEntryListOf(false);
	// the words typed, as a text of their own (textTake): first, so Enter makes it
	const textEntryList = textTake && !isSlashQuery && query.trim() ? [{ id: 'text-take', label: query.trim(), isTextTake: true }] : [];
	const resultList = [...textEntryList, ...sourceBeforeList, ...entryList, ...objectEntryList, ...sourceAfterList];
	const indexBase = textEntryList.length;
	// what `/` names in the slash mode: the actions, then the kinds, one word each (an action of a
	// name taken already is left out); taking one takes the entry of the list
	const slashActionList = useMemo(() => {
		const nameSet = new Set();
		const list = [];
		const entryAllList = [...actionList.filter(action => !action.isDisabled).map(action => ({ ...action, id: `action:${action.id}`, action })), ...kindAllList];
		for (const entry of entryAllList) {
			const name = String(entry.action ? entry.action.id : entry.id).replace(/^tool:/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '');
			if (!name || nameSet.has(name)) continue;
			nameSet.add(name);
			list.push(slashActionDefine({ name, label: entry.label, description: entry.description ?? '', icon: entry.icon, run: () => { setTimeout(() => chooseRef.current(entry)); return slashEffect.replace(''); } }));
		}
		return list;
	}, [actionList, kindAllList.map(entry => entry.id).join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
	const slash = useEditSlashConfig({ actionList: slashActionList, context: {} });
	const highlightList = (session?.result?.tokenList ?? []).map(token => token.valueLower).filter(Boolean);
	const wordList = queryWords.toLowerCase().split(/\s+/).filter(Boolean);
	const placeholder = placeholderGiven ?? sourceList.find(item => item.placeholder)?.placeholder ?? (session ? 'Add a node, a connection, or an object' : 'Add a node or a connection');
	// the entries of a source, under its heading, with what it says of them and what can be done
	const sourceRender = (group, indexStart) => (
		<div key={group.source.id} className="doc-vis-create-source">
			<span className="doc-vis-create-group">{group.source.label}{group.status === 'searching' ? <LoaderCircle size={11} className="doc-spin" aria-label="searching" /> : null}</span>
			{group.entryList.map((entry, index) => optionRender(entry, indexStart + index, <>
				{entry.icon ? <entry.icon size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
				<span className="doc-vis-create-label">{textHighlight(entry.label, wordList)}</span>
				<span className="doc-vis-create-description">{textHighlight(entry.description ?? '', wordList)}</span>
			</>))}
			{group.note || group.actionList.length ? (
				<span className="doc-note doc-vis-create-summary">
					{group.note}
					{group.actionList.map(action => <button key={action.id} type="button" className="doc-button" disabled={group.status === 'searching'} onPointerDown={event => event.preventDefault()} onClick={() => source.actionRun(group, action)}>{action.label}</button>)}
				</span>
			) : null}
		</div>
	);
	const sourceGroupListOf = isBefore => source.groupList.filter(group => Boolean(group.source.isBeforeKinds) === isBefore);
	const summaryNotListedList = queryWords.trim() ? (session?.result?.providerList ?? []).filter(summary => summary.status !== 'fetched' || summary.isTruncated) : [];
	useEffect(() => {
		// a popup of the edit layer (the slash menu of the field) is the panel's own
		const pointerDownHandle = (event) => {
			if (root.current && !root.current.contains(event.target) && !event.target.closest?.('.doc-edit-popup')) editor.createClose();
		};
		document.addEventListener('pointerdown', pointerDownHandle, true);
		return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
	}, [editor]);
	// a session of an earlier panel starts empty
	useEffect(() => { session?.clear(); }, [session]);
	const choose = (entry) => {
		if (entry.isTextTake) { textTake.take(entry.label, position); editor.createClose(); return undefined; }
		if (!entry.action) return editor.createChoose(entry, position);
		if (entry.action.isDisabled) return undefined;
		// an action: into its state when it has one, else it did what it does and the panel closes
		const state = entry.action.start({ position, editor });
		if (state) { stateStackSet([state]); queryChange(''); } else editor.createClose();
		return undefined;
	};
	// out of the last state: to the one before, to the list, or (opened in a state) closed
	const stateLeave = () => {
		if (stateStack.length <= 1 && isStateOnly) editor.createClose();
		else stateStackSet(stateStack.slice(0, -1));
	};
	const stateResult = (next) => {
		if (next === 'back') stateLeave();
		else if (next && typeof next === 'object') stateStackSet([...stateStack, next]);
		else editor.createClose();
	};
	const chooseRef = useRef(choose);
	chooseRef.current = choose;
	const [textVersion, textVersionSet] = useState(0);
	const queryChange = (text, isWritten = false) => {
		querySet(text);
		indexActiveSet(0);
		session?.textSet((text.startsWith('/') ? text.slice(1) : text).replace(/\s+/g, ' '));
		if (isWritten) textVersionSet(version => version + 1);
	};
	// the keys of the field, after the slash mode had its turn: the list is walked by the arrows,
	// Enter takes what is highlighted, Escape empties the field, then closes the panel
	const keyDownHandle = (event) => {
		if (event.nativeEvent?.isComposing || stateCurrent || event.defaultPrevented) return false;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (query) queryChange('', true); else editor.createClose();
			return true;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (resultList.length) indexActiveSet((indexActive + (event.key === 'ArrowDown' ? 1 : -1) + resultList.length) % resultList.length);
			return true;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			const result = isSlashMenu ? null : resultList[indexActive] ?? resultList[0];
			if (result) choose(result);
			return true;
		}
		return false;
	};
	const optionRender = (entry, index, content) => (
		<button key={entry.id} type="button" role="option" aria-selected={index === indexActive} aria-disabled={entry.action?.isDisabled || undefined} className={`doc-vis-create-option${entry.action?.isDisabled ? ' is-disabled' : ''}${entry.action?.kind === 'danger' ? ' is-danger' : ''}`} title={entry.action?.isDisabled ? entry.action.reason ?? '' : entry.hit?.descriptor.ref ?? entry.description}
			onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexActiveSet(index)} onClick={() => choose(entry)}>
			{content}
		</button>
	);
	return (
		<div ref={root} className="doc-vis-create-panel not-prose" role="dialog" aria-label={ariaLabel} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
			{stateCurrent ? <DiagramCreateState key={`${stateStack.length}:${stateCurrent.id}`} stateStack={stateStack} api={{ position, editor }} onLeave={stateLeave} onResult={stateResult} /> : null}
			{stateCurrent ? null : <div className="doc-vis-create-search">
				<Search size={12} aria-hidden="true" />
				<span className="doc-vis-create-field-box">
					<EditSourceSurface kind="plain" className="doc-vis-create-field" text={query} textVersion={textVersion} slash={slash} isTabInserted={false} ariaLabel="Search what to add"
						onTextChange={text => queryChange(text.replace(/\n/g, ' '))} onKeyDownFirst={keyDownHandle} onCancelRequest={() => { if (query) queryChange('', true); else editor.createClose(); }} />
					{query ? null : <span className="doc-vis-create-placeholder" aria-hidden="true">{placeholder}</span>}
				</span>
				{session?.status === 'searching' ? <LoaderCircle size={12} className="doc-spin" aria-label="searching the objects" /> : null}
			</div>}
			{stateCurrent || isSlashMenu ? null : <div className="doc-vis-create-list" role="listbox" aria-label="What can be added">
				{textEntryList.map(entry => optionRender(entry, 0, <>
					<Type size={13} aria-hidden="true" />
					<span className="doc-vis-create-label">{textTake.label}</span>
					<span className="doc-vis-create-description doc-vis-create-text">“{entry.label}”</span>
				</>))}
				{actionEntryList.length > 0 && heading ? <span className="doc-vis-create-group">{heading}</span> : null}
				{actionEntryList.map((entry, indexAction) => optionRender(entry, indexBase + indexAction, <>
					{entry.icon ? <entry.icon size={13} aria-hidden="true" /> : <Zap size={13} aria-hidden="true" />}
					<span className="doc-vis-create-label">{entry.label}</span>
					<span className="doc-vis-create-description">{entry.isDisabled ? entry.reason ?? entry.description : entry.description}</span>
				</>))}
				{resultList.length === 0 && session?.status !== 'searching' && source.groupList.length === 0 ? <span className="doc-note">nothing matches “{queryWords.trim()}”</span> : null}
				{sourceGroupListOf(true).reduce((out, group) => ({ list: [...out.list, sourceRender(group, out.index)], index: out.index + group.entryList.length }), { list: [], index: indexBase + actionEntryList.length }).list}
				{(sourceBeforeList.length > 0 || textEntryList.length > 0) && entryList.length > 0 ? <span className="doc-vis-create-group">Nodes</span> : null}
				{entryList.map((entry, indexKind) => optionRender(entry, indexBase + sourceBeforeList.length + indexKind, <>
					<entry.icon size={13} aria-hidden="true" />
					<span className="doc-vis-create-label">{entry.label}</span>
					<span className="doc-vis-create-description">{entry.description}</span>
				</>))}
				{objectEntryList.length > 0 ? <span className="doc-vis-create-group">Objects</span> : null}
				{objectEntryList.map((entry, indexObject) => optionRender(entry, indexBase + sourceBeforeList.length + entryList.length + indexObject, <>
					<ObjectIcon descriptor={entry.hit.descriptor} objectStore={objectService} size={13} />
					<span className="doc-vis-create-label">{textHighlight(entry.hit.descriptor.label, highlightList)}</span>
					<span className="doc-vis-create-description">{objectService.typeLabelGet(entry.hit.descriptor.typeList[0] ?? 'core.object')} · {textHighlight(entry.hit.path, highlightList)}</span>
				</>))}
				{sourceGroupListOf(false).reduce((out, group) => ({ list: [...out.list, sourceRender(group, out.index)], index: out.index + group.entryList.length }), { list: [], index: indexBase + sourceBeforeList.length + entryList.length + objectEntryList.length }).list}
				{summaryNotListedList.map(summary => (
					<span key={summary.providerId} className="doc-note doc-vis-create-summary">
						{summary.label}: {summary.count === null ? 'how many is not known' : `${summary.count} objects`}, not all listed
						{summary.isExpandable ? <button type="button" className="doc-button" onPointerDown={event => event.preventDefault()} onClick={() => session.providerExpand(summary.providerId)}>Load the first {session.fetchMax}</button> : null}
					</span>
				))}
			</div>}
		</div>
	);
});

// The panel in a state of an action: the line saying so, the field, what the state offers, and for
// a state of several the button taking what is ticked. The host runs the machine: this draws it
const DiagramCreateState = observer(function DiagramCreateState({ stateStack, api, onLeave, onResult }) {
	const state = stateStack[stateStack.length - 1];
	const [query, querySet] = useState('');
	const [indexActive, indexActiveSet] = useState(0);
	const [tickedById, tickedByIdSet] = useState(() => new Map());
	const [run, runSet] = useState({ status: 'idle', message: '' });
	const sourceList = useMemo(() => (state.search ? [{ id: `state:${state.id}`, label: '', search: state.search }] : SOURCE_LIST_NONE), [state]);
	const source = useCreateSourceSearch(sourceList, query);
	const group = source.groupList[0];
	const entryList = group?.entryList ?? [];
	const wordList = query.toLowerCase().split(/\s+/).filter(Boolean);
	const isBusy = run.status === 'running';
	// what the host answers: the next state, the one before, or done; what it throws is said here
	const take = (work) => {
		runSet({ status: 'running', message: '' });
		Promise.resolve().then(work).then(
			(next) => { runSet({ status: 'idle', message: '' }); onResult(next); },
			error => runSet({ status: 'failed', message: String(error?.message ?? error) }),
		);
	};
	const tick = (entry) => {
		const next = new Map(tickedById);
		if (next.has(entry.entryId)) next.delete(entry.entryId); else next.set(entry.entryId, entry);
		tickedByIdSet(next);
	};
	const entryTake = (entry) => {
		if (isBusy) return;
		if (state.isMulti) tick(entry);
		else take(() => state.choose?.({ ...entry, id: entry.entryId }, api));
	};
	const commit = () => { if (!isBusy && tickedById.size > 0) take(() => state.commit?.([...tickedById.values()].map(entry => ({ ...entry, id: entry.entryId })), api)); };
	const keyDownHandle = (event) => {
		if (event.nativeEvent?.isComposing) return;
		const isMod = (event.ctrlKey || event.metaKey) && !event.altKey;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (query) { querySet(''); indexActiveSet(0); } else onLeave();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (entryList.length) indexActiveSet((indexActive + (event.key === 'ArrowDown' ? 1 : -1) + entryList.length) % entryList.length);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			if (state.isText) { if (query.trim() && !isBusy) take(() => state.choose?.({ text: query.trim() }, api)); }
			else if (state.isMulti && isMod) commit();
			else if (entryList[indexActive]) entryTake(entryList[indexActive]);
		}
	};
	return (
		<div className="doc-vis-create-state" onKeyDown={keyDownHandle}>
			<div className="doc-vis-create-state-line" role="status">
				<Zap size={11} aria-hidden="true" />
				<span className="doc-vis-create-state-path">{stateStack.map((item, index) => <span key={index} className={index === stateStack.length - 1 ? 'is-current' : undefined}>{item.label}</span>)}</span>
				<button type="button" className="doc-button-icon" title="Leave (Escape)" aria-label="Leave" onPointerDown={event => event.preventDefault()} onClick={onLeave}><X size={12} /></button>
			</div>
			<div className="doc-vis-create-search">
				<Search size={12} aria-hidden="true" />
				<input type="text" value={query} placeholder={state.placeholder ?? ''} aria-label={state.label} autoFocus spellCheck={false} onChange={(event) => { querySet(event.target.value); indexActiveSet(0); }} />
				{group?.status === 'searching' || isBusy ? <LoaderCircle size={12} className="doc-spin" aria-label="working" /> : null}
			</div>
			{state.isText ? null : (
				<div className="doc-vis-create-list" role="listbox" aria-label={state.label} aria-multiselectable={state.isMulti || undefined}>
					{entryList.map((entry, index) => {
						const isTicked = tickedById.has(entry.entryId);
						return (
							<button key={entry.id} type="button" role="option" aria-selected={index === indexActive} aria-checked={state.isMulti ? isTicked : undefined} className="doc-vis-create-option" title={entry.description}
								onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexActiveSet(index)} onClick={() => entryTake(entry)}>
								{state.isMulti ? <span className={`doc-vis-create-tick${isTicked ? ' is-ticked' : ''}`}>{isTicked ? <Check size={10} aria-hidden="true" /> : null}</span> : entry.icon ? <entry.icon size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
								<span className="doc-vis-create-label">{textHighlight(entry.label, wordList)}</span>
								<span className="doc-vis-create-description">{textHighlight(entry.description ?? '', wordList)}</span>
							</button>
						);
					})}
					{group && (group.note || group.actionList.length) ? (
						<span className="doc-note doc-vis-create-summary">
							{group.note}
							{group.actionList.map(action => <button key={action.id} type="button" className="doc-button" disabled={group.status === 'searching'} onPointerDown={event => event.preventDefault()} onClick={() => source.actionRun(group, action)}>{action.label}</button>)}
						</span>
					) : null}
				</div>
			)}
			{run.message ? <span className="doc-error doc-vis-create-summary" role="alert">{run.message}</span> : null}
			{state.isMulti ? (
				<div className="doc-vis-create-foot">
					<span className="doc-note">{tickedById.size} ticked</span>
					{tickedById.size > 0 ? <button type="button" className="doc-button" onPointerDown={event => event.preventDefault()} onClick={() => tickedByIdSet(new Map())}>Untick all</button> : null}
					<button type="button" className="doc-button" data-primary="" disabled={isBusy || tickedById.size === 0} title="Ctrl/⌘ + Enter" onPointerDown={event => event.preventDefault()} onClick={commit}>{state.commitLabel?.(tickedById.size) ?? `Take ${tickedById.size}`}</button>
				</div>
			) : null}
		</div>
	);
});

// the sources of the host searched by the text typed: one group per source, searched again a
// moment after the typing stops; an answer that comes after a later search began is dropped
const SOURCE_SEARCH_DELAY = 140;

function useCreateSourceSearch(sourceList, query) {
	const [stateById, stateByIdSet] = useState({});
	const [refreshCount, refreshCountSet] = useState(0);
	const turn = useRef(0);
	useEffect(() => {
		if (sourceList.length === 0) return undefined;
		turn.current += 1;
		const turnMine = turn.current;
		const timer = setTimeout(() => {
			for (const item of sourceList) {
				stateByIdSet(old => ({ ...old, [item.id]: { ...old[item.id], status: 'searching' } }));
				Promise.resolve().then(() => item.search(query.trim())).then(
					result => { if (turn.current === turnMine) stateByIdSet(old => ({ ...old, [item.id]: { status: 'done', result: result ?? {} } })); },
					error => { if (turn.current === turnMine) stateByIdSet(old => ({ ...old, [item.id]: { status: 'failed', result: { note: String(error?.message ?? error) } } })); },
				);
			}
		}, refreshCount === 0 && !query ? 0 : SOURCE_SEARCH_DELAY);
		return () => clearTimeout(timer);
	}, [sourceList, query, refreshCount]);
	const groupList = sourceList.map(item => {
		const state = stateById[item.id] ?? { status: 'searching' };
		return {
			source: item, status: state.status,
			entryList: (state.result?.entryList ?? []).map(entry => ({ ...entry, id: `source:${item.id}:${entry.id}`, entryId: entry.id, source: item })),
			note: state.result?.note ?? '', actionList: state.result?.actionList ?? [],
		};
	});
	const actionRun = (group, action) => {
		stateByIdSet(old => ({ ...old, [group.source.id]: { ...old[group.source.id], status: 'searching' } }));
		Promise.resolve().then(() => action.run()).then(
			() => refreshCountSet(count => count + 1),
			error => stateByIdSet(old => ({ ...old, [group.source.id]: { status: 'failed', result: { ...old[group.source.id]?.result, note: String(error?.message ?? error) } } })),
		);
	};
	return { groupList, actionRun };
}

// the diagram's option of the object search: objectSearch of its data
function objectSearchOptionGet(store) {
	let value;
	try {
		value = store.value?.objectSearch;
	} catch {
		value = undefined;
	}
	const option = value && typeof value === 'object' ? value : {};
	return {
		isEnabled: option.isEnabled !== false,
		typeList: Array.isArray(option.typeList) ? option.typeList.map(String) : (typeof option.typeList === 'string' ? [option.typeList] : []),
	};
}

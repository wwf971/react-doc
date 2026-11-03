import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, Search } from '../../../../main/frontend/UICommon.js';
import { ObjectIcon } from '../../../../main/comp-doc/object/object-icon.jsx';
import { textHighlight } from '../../../../main/comp-doc/object/ObjectSearchPanel.jsx';
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
// a card of the object whatever its Type, with an in and an out handle. The
// search keeps its state in a session of the layer (sessionKey), runs only
// once something is typed, and never lists a host that has too many objects:
// such a host is a line with its count and a way to load its first ones.
// The diagram narrows the search with its option objectSearch:
//   objectSearch: { typeList: [core.task], isEnabled: true }
// the engine knows no Type: it adds a registered component by name
// (DiagramEditStore.nodeComponentAdd)
export const DiagramCreatePanel = observer(function DiagramCreatePanel({ position, editor, objectService, sessionKey }) {
	const [query, querySet] = useState('');
	const [indexActive, indexActiveSet] = useState(0);
	const root = useRef(null);
	const entryList = nodeRegistrySearch(editor.store.registry, query).map(({ entry }) => entry);
	const option = objectSearchOptionGet(editor.store);
	const session = objectService?.searchSessionGet && option.isEnabled ? objectService.searchSessionGet(sessionKey, { typeList: option.typeList, fetchMax: 20 }) : undefined;
	const hitList = session && query.trim() ? session.hitList : [];
	const objectEntryList = hitList.map(hit => ({
		id: `object:${hit.descriptor.ref}`,
		hit,
		nodeComponent: { compName: 'ObjectView', data: { object: hit.descriptor.ref }, idPrefix: 'object' },
	}));
	const resultList = [...entryList, ...objectEntryList];
	const highlightList = (session?.result?.tokenList ?? []).map(token => token.valueLower).filter(Boolean);
	const summaryNotListedList = query.trim() ? (session?.result?.providerList ?? []).filter(summary => summary.status !== 'fetched' || summary.isTruncated) : [];
	useEffect(() => {
		const pointerDownHandle = (event) => {
			if (root.current && !root.current.contains(event.target)) editor.createClose();
		};
		document.addEventListener('pointerdown', pointerDownHandle, true);
		return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
	}, [editor]);
	// a session of an earlier panel starts empty
	useEffect(() => { session?.clear(); }, [session]);
	const choose = entry => editor.createChoose(entry, position);
	const queryChange = (text) => {
		querySet(text);
		indexActiveSet(0);
		session?.textSet(text);
	};
	const keyDownHandle = (event) => {
		if (event.nativeEvent?.isComposing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (query) queryChange(''); else editor.createClose();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (resultList.length) indexActiveSet((indexActive + (event.key === 'ArrowDown' ? 1 : -1) + resultList.length) % resultList.length);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			const result = resultList[indexActive] ?? resultList[0];
			if (result) choose(result);
		}
	};
	const optionRender = (entry, index, content) => (
		<button key={entry.id} type="button" role="option" aria-selected={index === indexActive} className="doc-vis-create-option" title={entry.hit?.descriptor.ref ?? entry.description}
			onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexActiveSet(index)} onClick={() => choose(entry)}>
			{content}
		</button>
	);
	return (
		<div ref={root} className="doc-vis-create-panel not-prose" role="dialog" aria-label="Add to the diagram" onKeyDown={keyDownHandle} onDoubleClick={event => event.stopPropagation()}>
			<div className="doc-vis-create-search">
				<Search size={12} aria-hidden="true" />
				<input type="text" value={query} placeholder={session ? 'Add a node, a connection, or an object' : 'Add a node or a connection'} aria-label="Search what to add" autoFocus spellCheck={false}
					onChange={event => queryChange(event.target.value)} />
				{session?.status === 'searching' ? <LoaderCircle size={12} className="doc-spin" aria-label="searching the objects" /> : null}
			</div>
			<div className="doc-vis-create-list" role="listbox" aria-label="What can be added">
				{resultList.length === 0 && session?.status !== 'searching' ? <span className="doc-note">nothing matches “{query.trim()}”</span> : null}
				{entryList.map((entry, index) => optionRender(entry, index, <>
					<entry.icon size={13} aria-hidden="true" />
					<span className="doc-vis-create-label">{entry.label}</span>
					<span className="doc-vis-create-description">{entry.description}</span>
				</>))}
				{objectEntryList.length > 0 ? <span className="doc-vis-create-group">Objects</span> : null}
				{objectEntryList.map((entry, index) => optionRender(entry, entryList.length + index, <>
					<ObjectIcon descriptor={entry.hit.descriptor} objectStore={objectService} size={13} />
					<span className="doc-vis-create-label">{textHighlight(entry.hit.descriptor.label, highlightList)}</span>
					<span className="doc-vis-create-description">{objectService.typeLabelGet(entry.hit.descriptor.typeList[0] ?? 'core.object')} · {textHighlight(entry.hit.path, highlightList)}</span>
				</>))}
				{summaryNotListedList.map(summary => (
					<span key={summary.providerId} className="doc-note doc-vis-create-summary">
						{summary.label}: {summary.count === null ? 'how many is not known' : `${summary.count} objects`}, not all listed
						{summary.isExpandable ? <button type="button" className="doc-button" onPointerDown={event => event.preventDefault()} onClick={() => session.providerExpand(summary.providerId)}>Load the first {session.fetchMax}</button> : null}
					</span>
				))}
			</div>
		</div>
	);
});

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

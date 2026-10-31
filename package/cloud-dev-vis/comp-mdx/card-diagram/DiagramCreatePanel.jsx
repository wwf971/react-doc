import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Search } from '../../../../main/frontend/UICommon.js';
import { nodeRegistrySearch } from './node-registry.js';

// The panel of a double-click on empty canvas: what can be added there
// (the create entries of the node registry of the component, node-registry.js),
// searched by typing, like the insert menu of a
// block. ArrowDown / ArrowUp move in the list, Enter takes the highlighted
// entry (the first when none is), Escape closes, and so does a pointer going
// down outside the panel. The chosen node is created at the panel's position
// and selected; a connection is created with two free ends.
export const DiagramCreatePanel = observer(function DiagramCreatePanel({ position, editor }) {
	const [query, querySet] = useState('');
	const [indexActive, indexActiveSet] = useState(0);
	const root = useRef(null);
	const resultList = nodeRegistrySearch(editor.store.registry, query);
	useEffect(() => {
		const pointerDownHandle = (event) => {
			if (root.current && !root.current.contains(event.target)) editor.createClose();
		};
		document.addEventListener('pointerdown', pointerDownHandle, true);
		return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
	}, [editor]);
	const choose = entry => editor.createChoose(entry, position);
	const keyDownHandle = (event) => {
		if (event.nativeEvent?.isComposing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (query) { querySet(''); indexActiveSet(0); } else editor.createClose();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (resultList.length) indexActiveSet((indexActive + (event.key === 'ArrowDown' ? 1 : -1) + resultList.length) % resultList.length);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			const result = resultList[indexActive] ?? resultList[0];
			if (result) choose(result.entry);
		}
	};
	return (
		<div ref={root} className="doc-vis-create-panel not-prose" role="dialog" aria-label="Add to the diagram" onKeyDown={keyDownHandle} onDoubleClick={event => event.stopPropagation()}>
			<div className="doc-vis-create-search">
				<Search size={12} aria-hidden="true" />
				<input type="text" value={query} placeholder="Add a node or a connection" aria-label="Search what to add" autoFocus spellCheck={false}
					onChange={event => { querySet(event.target.value); indexActiveSet(0); }} />
			</div>
			<div className="doc-vis-create-list" role="listbox" aria-label="What can be added">
				{resultList.length === 0 ? <span className="doc-note">nothing matches “{query.trim()}”</span> : resultList.map(({ entry }, index) => (
					<button key={entry.id} type="button" role="option" aria-selected={index === indexActive} className="doc-vis-create-option" title={entry.description}
						onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexActiveSet(index)} onClick={() => choose(entry)}>
						<entry.icon size={13} aria-hidden="true" />
						<span className="doc-vis-create-label">{entry.label}</span>
						<span className="doc-vis-create-description">{entry.description}</span>
					</button>
				))}
			</div>
		</div>
	);
});

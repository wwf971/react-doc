import { useEffect, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { ArrowDown, ArrowUp, CaseSensitive, Layers, WholeWord, X } from '../../../../main/frontend/UICommon.js';
import { useFindScope } from '../../../../main/comp-doc/find/use-find-scope.js';
import { diagramSearchCurrentElementList, diagramSearchHighlightClear, diagramSearchHighlightSet } from './DiagramSearchHighlight.js';

// What the search of a canvas looks like (card-diagram-impl.md#search): the marks a card and a
// line carry, the bar, and what a host does to bring the current item into view.

const DEPTH_CHOICE_LIST = [0, 1, 2, 3, 4, 5];

// the bar, at the top right of the viewport, as a code editor has it: the text, whole case and
// whole word, how deep scenes inside scenes are searched (where there are), how many were found
// and which is current, the way to the previous and the next, and closing. Enter is the next,
// Shift+Enter the previous, Escape closes; F3 / Shift+F3 too
export const DiagramSearchBar = observer(function DiagramSearchBar({ search }) {
	const inputRef = useRef(null);
	useEffect(() => {
		if (!search.isOpen) return;
		inputRef.current?.focus({ preventScroll: true });
		inputRef.current?.select();
	}, [search, search.isOpen, search.focusToken]);
	if (!search.isOpen) return null;
	const count = search.itemList.length;
	const countText = !search.text ? '' : count === 0 ? 'No results' : `${search.indexCurrent + 1} of ${count}`;
	const keyDown = (event) => {
		if (event.key === 'Enter' || event.key === 'F3') {
			event.preventDefault();
			if (event.shiftKey) search.previous(); else search.next();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			search.close();
		}
	};
	const stop = (event) => event.stopPropagation();
	return (
		<div className="doc-diagram-search-bar nodrag nopan nowheel" role="search" onPointerDown={stop} onClick={stop} onWheel={stop}>
			<input
				ref={inputRef}
				className="doc-diagram-search-input"
				type="text"
				value={search.text}
				placeholder="Find"
				aria-label="Find in the diagram"
				spellCheck={false}
				onChange={(event) => search.textSet(event.target.value)}
				onKeyDown={keyDown}
			/>
			<button type="button" className="doc-diagram-search-toggle" title="Match case" aria-label="Match case" aria-pressed={search.isCaseSensitive} onClick={() => search.optionToggle('isCaseSensitive')}><CaseSensitive size={16} aria-hidden="true" /></button>
			<button type="button" className="doc-diagram-search-toggle" title="Match whole word" aria-label="Match whole word" aria-pressed={search.isWholeWord} onClick={() => search.optionToggle('isWholeWord')}><WholeWord size={16} aria-hidden="true" /></button>
			{search.isDepthOffered ? (
				<label className="doc-diagram-search-depth" title="How deep the scenes inside cards are searched: 0, the scene shown alone">
					<Layers size={14} aria-hidden="true" />
					<select value={search.depthMax} aria-label="Search depth" onChange={(event) => search.depthMaxSet(event.target.value)}>
						{DEPTH_CHOICE_LIST.map((depth) => <option key={depth} value={depth}>{depth}</option>)}
					</select>
				</label>
			) : null}
			<span className={`doc-diagram-search-count${search.text && count === 0 ? ' is-none' : ''}`} aria-live="polite">{countText}</span>
			<button type="button" className="doc-button-icon doc-diagram-search-button" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={count === 0} onClick={search.previous}><ArrowUp size={16} aria-hidden="true" /></button>
			<button type="button" className="doc-button-icon doc-diagram-search-button" title="Next match (Enter)" aria-label="Next match" disabled={count === 0} onClick={search.next}><ArrowDown size={16} aria-hidden="true" /></button>
			<button type="button" className="doc-button-icon doc-diagram-search-button" title="Close (Escape)" aria-label="Close the search" onClick={search.close}><X size={16} aria-hidden="true" /></button>
		</div>
	);
});

// the camera that brings an element into view: moved so the element stands in the middle,
// zoomed in only as far as it takes to read it (an element drawn smaller than a line of text
// grows to one); none when it is in view and readable already (out of the way of the bar)
export function diagramSearchCameraReveal(host, element, camera, { marginTop = 52, margin = 24, heightReadable = 14, heightTarget = 26 } = {}) {
	if (!host || !element || !camera) return null;
	const hostRect = host.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return null;
	const isInView = rect.left >= hostRect.left + margin && rect.right <= hostRect.right - margin && rect.top >= hostRect.top + marginTop && rect.bottom <= hostRect.bottom - margin;
	const isReadable = rect.height >= heightReadable;
	if (isInView && isReadable) return null;
	// a host drawn scaled (a transform around it) moves its world by its own pixels
	const scale = hostRect.width / (host.offsetWidth || hostRect.width) || 1;
	// the zoom: as it is, or as much more as reading takes, while the element still fits
	const fit = Math.min((hostRect.width - 2 * margin) / rect.width, (hostRect.height - marginTop - margin) / rect.height);
	const factor = isReadable ? 1 : Math.max(1, Math.min(heightTarget / rect.height, fit));
	// where the element's middle is in the host, and where it goes
	const xNow = (rect.left + rect.width / 2 - hostRect.left) / scale;
	const yNow = (rect.top + rect.height / 2 - hostRect.top) / scale;
	const heightGrown = (rect.height * factor) / scale;
	const heightView = (hostRect.height - marginTop - margin) / scale;
	const xTo = hostRect.width / scale / 2;
	// an element taller than the view shows its top
	const yTo = heightGrown > heightView ? (marginTop / scale) + heightGrown / 2 : (marginTop / scale) + heightView / 2;
	// the world point under the element's middle stays under it as the zoom changes
	return { zoom: camera.zoom * factor, x: xTo - (xNow - camera.x) * factor, y: yTo - (yNow - camera.y) * factor };
}

// what a canvas does for its search: it is a find scope of the page (mod+f opens this search
// while the pointer is over it), it keeps the highlights of the words found up to date as it
// draws, and it brings the current item into view when asked (revealToken).
//   hostRef          the viewport element (the bar stands in it, the marks are looked for in it)
//   cameraGet/Set    the camera of the canvas; cameraSet(camera) glides there
//   revealPrepare    optional: (item) before the camera moves, a frame given to draw (a stack
//                    scrolled to an item holding the current one)
//   versionGet       what the result depends on beside the request (the graph, the scene shown):
//                    read in a reaction, so a change of it searches again
export function useDiagramSearchHost({ hostRef, search, label = 'Diagram', cameraGet, cameraSet, revealPrepare, versionGet }) {
	const ownerId = `diagram-search:${useId()}`;
	const optionRef = useRef({});
	optionRef.current = { cameraGet, cameraSet, revealPrepare, versionGet };
	useFindScope(hostRef, { label, open: search.open, close: search.close, isOpenGet: () => search.isOpen });
	// what is found: searched again when the request or what the canvas shows changes
	useEffect(() => reaction(() => [search.isOpen, search.request, optionRef.current.versionGet?.()], () => search.refresh(), { fireImmediately: true }), [search]);
	// the highlights: when what is found changes, and when the canvas draws anew
	useEffect(() => {
		let frameId = 0;
		const refresh = () => {
			cancelAnimationFrame(frameId);
			frameId = requestAnimationFrame(() => {
				if (search.isOpen && search.text) diagramSearchHighlightSet(ownerId, hostRef.current, search.request);
				else diagramSearchHighlightClear(ownerId);
			});
		};
		const dispose = reaction(() => [search.isOpen, search.request, search.stateByKey], refresh, { fireImmediately: true });
		const observer = new MutationObserver(() => { if (search.isOpen) refresh(); });
		if (hostRef.current) observer.observe(hostRef.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-search'] });
		return () => {
			dispose();
			observer.disconnect();
			cancelAnimationFrame(frameId);
			diagramSearchHighlightClear(ownerId);
		};
	}, [search, hostRef, ownerId]);
	// the current item into view: after its marks are drawn
	useEffect(() => reaction(() => search.revealToken, () => {
		const item = search.itemCurrent;
		if (!item) return;
		requestAnimationFrame(() => {
			optionRef.current.revealPrepare?.(item);
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const host = hostRef.current;
				const element = host ? diagramSearchCurrentElementList(host).pop() : null;
				const camera = diagramSearchCameraReveal(host, element, optionRef.current.cameraGet?.());
				if (camera) optionRef.current.cameraSet?.(camera);
			}));
		});
	}), [search, hostRef]);
}

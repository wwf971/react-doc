import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Boxes, Expand, FoldVertical, Layers, UnfoldVertical } from '../../../../main/frontend/UICommon.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { diagramNormalize } from '../card-diagram/DiagramERData.js';
import { DiagramNodeContent, DiagramRenderContext, useDiagramSearchMark } from '../card-diagram/DiagramRender.jsx';
import { SwitchContext, SwitchStaticScene } from './SwitchStatic.jsx';
import { SwitchViewSwitcher, SwitchViewTabs } from './SwitchViewSwitcher.jsx';
import { SWITCH_EMBED_CHROME_HEIGHT, SWITCH_TITLE_FONT_SIZE, SWITCH_TITLE_HEIGHT, switchBoxClipBuild, switchEmbedCardRectOf, switchEmbedMapBuild, switchPathViewBuild, switchPathViewRead, switchPresentationBuild, switchPresentationChildIsDrawn, switchStackFrameIsVisible, switchStackItemLayout, switchStackPresentationBuild, switchStackTitleBarNormalize, switchStackTitleBarRead } from './SwitchData.js';
import { CARD_ICON_BY_NAME, CardBrief } from '../card-diagram/CompactCard.jsx';

// The two node kinds of the switching layer (card-diagram-flexible-switch.md):
//
//   scene-embed   a card showing another scene inside it: a title, and the world of
//                that scene scaled to fit the card. data: scene (a path), view? (the view
//                asked for, of a scene with views), viewHover? (the view shown while a
//                pointer rests on the card; false: none), box? (a
//                region of that scene: the id of its bounding box node, or a rect),
//                padding? (the margin inside the card, a part of its size),
//                title?, subtitle?, icon?, tone?, statList?, isChromeHidden?
//   scene-stack   a scrolling area of items stacked vertically: each an embedded scene
//                as wide as the area, or a card. data: itemList: [{ id, scene?, view?, box?,
//                padding?, node?, link?, title?, subtitle?, icon?, tone? }], title?,
//                subtitle?, icon?, tone?, statList?, isChromeHidden?, isHeightFullEmbedded?,
//                isHeightFullFocused? (as tall as its items, no scrollbar; a button of its
//                title bar and SwitchStore.stackHeightFullSet change it)
//   scene-link   a way to another scene, and nothing else: a pill as wide as its words. the path
//                is `link` of the node, as on any node. data: title, icon?, tone?, statList?
//   scene-tabs    the header of scenes arranged in tabs. data: tabList, focus. written by
//                switchTabsApply, never by hand
//
// A registry of a series becomes the registry of its switching component with
// switchRegistryBuild, as a diagram component is bound to its registry.
const sideAllList = ['left', 'right', 'top', 'bottom'];
const WHEEL_GESTURE_MS = 180;

export const SceneEmbedCard = observer(function SceneEmbedCard({ node, nodeId }) {
	const context = useContext(SwitchContext);
	const bodyRef = useRef(null);
	const [body, bodySet] = useState(null);
	const { data } = node;
	const store = context?.store;
	const scene = switchPathViewRead(data.scene).path;
	const pathOwner = pathOwnerOf(context);
	// which view of the scene this card shows: it depends on the scene holding the card
	const pathRest = store ? store.embedPathOf(pathOwner, data.scene, data.view) : scene;
	// the pointer rests on a card on the canvas; a card inside an embedded scene takes none
	const isOnCanvas = Boolean(store) && !context?.isStatic;
	const pathHover = isOnCanvas ? store.embedHoverPathOf(pathOwner, data.scene, data.viewHover) : '';
	const pathHeld = isOnCanvas ? store.embedHeldPathOf(pathOwner, nodeId) : '';
	const [isPointerOver, isPointerOverSet] = useState(false);
	const pathShown = pathHeld || (isPointerOver && pathHover) || pathRest;
	// both drawn, so a hover swaps at once with nothing to measure: a portal needs either
	const pathLayerList = [...new Set([pathRest, pathHover, pathHeld].filter(Boolean))];
	const pointerProps = pathHover ? { onPointerEnter: (event) => { if (event.pointerType !== 'touch') isPointerOverSet(true); }, onPointerLeave: () => isPointerOverSet(false) } : {};
	useLayoutEffect(() => {
		const element = bodyRef.current;
		if (!element) return undefined;
		const measure = () => {
			const next = { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
			if (next.width === 0) return;
			bodySet((previous) => (previous && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next));
			store?.embedBodySet(nodeId, scene, next);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [store, nodeId, scene]);
	const Icon = CARD_ICON_BY_NAME[data.icon] ?? Boxes;
	const isCycle = context?.pathChain?.includes(pathShown);
	// one view of the scene as it stands in the card. a view alone in its card fills the card
	// and stands outside the body; the title line keeps its room, so nothing else moves
	const layerRender = (pathLayer) => {
		const isFrameHidden = store.viewFrameIsHidden(pathLayer);
		const box = store.sceneBoxGet(pathLayer, data.box);
		const map = switchEmbedMapBuild(isFrameHidden ? switchEmbedCardRectOf(body) : body, box, isFrameHidden ? 0 : data.padding);
		return (
			<div key={pathLayer} className={`doc-switch-embed-world${pathLayer === pathShown ? '' : ' is-layer-hidden'}`} style={{ transform: `translate(${map.tx}px, ${map.ty}px) scale(${map.scale})`, clipPath: store.sceneBoxIsChosen(pathLayer, data.box) ? switchBoxClipBuild(box) : undefined }}>
				<SwitchStaticScene store={store} path={pathLayer} depth={(context?.depth ?? 0) + 1} isEmbedded pathEmbedder={pathOwner} />
			</div>
		);
	};
	// a scene inside a card is drawn while it is not deeper than the block draws (depthMax of the
	// presentation): past it the card says the scene opens on a click
	const isDepthDrawn = switchPresentationChildIsDrawn(context?.presentation);
	const isDrawable = Boolean(store && body) && !isCycle && isDepthDrawn;
	const isFrameShownHidden = Boolean(store) && !isCycle && store.viewFrameIsHidden(pathShown);
	return (
		<div className={`doc-switch-embed${data.isChromeHidden ? ' is-chrome-hidden' : ''}${pathLayerList.length > 1 ? ' has-layers' : ''}${isFrameShownHidden ? ' is-frame-hidden' : ''}`} data-tone={data.tone || 'slate'} {...pointerProps}>
			{data.isChromeHidden ? null : (
				<div className="doc-switch-embed-chrome" style={{ height: SWITCH_EMBED_CHROME_HEIGHT }}>
					<span className="doc-switch-embed-icon"><Icon size={13} aria-hidden="true" /></span>
					<span className="doc-switch-embed-title">{data.title ?? store?.labelGet(scene) ?? scene}</span>
					{data.subtitle ? <span className="doc-switch-embed-subtitle">{data.subtitle}</span> : null}
					{data.statList?.length ? <span className="doc-switch-embed-stat">{data.statList.map((stat, index) => <span key={index}>{stat}</span>)}</span> : null}
					{store && !context?.isStatic ? <SwitchViewSwitcher store={store} presentation={switchPresentationBuild(scene, true, pathOwner)} viewAsked={data.view} viewShown={switchPathViewRead(pathShown).view} /> : null}
				</div>
			)}
			<div ref={bodyRef} className="doc-switch-embed-body">
				{!store ? <span className="doc-switch-embed-note">{scene}</span>
					: isCycle ? <span className="doc-switch-embed-note">{scene} embeds itself</span>
					: !isDepthDrawn ? <span className="doc-switch-embed-note">Deeper than this block draws: opens on a click</span>
					: isDrawable ? pathLayerList.filter((pathLayer) => !store.viewFrameIsHidden(pathLayer)).map(layerRender) : null}
			</div>
			{isDrawable ? pathLayerList.filter((pathLayer) => store.viewFrameIsHidden(pathLayer)).map(layerRender) : null}
		</div>
	);
});

// the scene a card belongs to: the one drawn statically around it, or the one on the canvas
function pathOwnerOf(context) {
	return context?.isStatic ? context.pathChain[context.pathChain.length - 1] : context?.store.pathFlow;
}

// an item of a stack: its title line, and a scene as wide as the item, or a card
const SceneStackItem = observer(function SceneStackItem({ item, index, isWheelTaken = false, searchState = null, store, stackKey, scrollRef, widthBody, anchorRef, isStatic, depth, pathOwner }) {
	const rootRef = useRef(null);
	const bodyRef = useRef(null);
	const { registry, config } = useContext(DiagramRenderContext);
	const Icon = CARD_ICON_BY_NAME[item.icon] ?? Boxes;
	const scene = item.scene ? switchPathViewRead(item.scene).path : '';
	const pathShown = scene && store ? store.embedPathOf(pathOwner, item.scene, item.view) : scene;
	const box = scene && store ? store.sceneBoxGet(pathShown, item.box) : null;
	const layout = box && widthBody ? switchStackItemLayout(widthBody, box, item.padding) : null;
	// a scene whose views are tabs (viewSwitcherLayout: tabs): the tabs under the title line, and
	// the body as tall as its tallest view, so choosing a tab moves nothing below the item. every
	// view is measured once for that; until then what is known of them counts
	const presentation = scene ? switchPresentationBuild(scene, true, pathOwner) : null;
	const switcher = scene && store ? store.viewSwitcherGet(presentation, item.view) : null;
	const isTabs = switcher?.isShown && switcher.layout === 'tabs';
	const viewPathList = isTabs ? switcher.viewList.map((view) => switchPathViewBuild(scene, view.id)) : [];
	const viewPathKey = viewPathList.join('|');
	useEffect(() => {
		if (!isStatic && viewPathList.length > 0) void store.scenesMeasured(viewPathList);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [store, isStatic, viewPathKey]);
	const heightBody = layout && isTabs ? Math.max(layout.height, ...viewPathList.map((path) => switchStackItemLayout(widthBody, store.sceneBoxGet(path), item.padding).height)) : layout?.height;
	const nodeCard = useMemo(() => (item.node ? diagramNormalize({ version: 1, nodes: [{ id: item.id, handles: [], ...item.node }] }, registry).nodes[0] : null), [item.id, item.node, registry]);
	const anchorRefNone = useMemo(() => () => undefined, []);
	const visualization = useMemo(() => ({ nodeId: item.id, size: nodeCard?.size, isEdit: false, anchorRef: anchorRefNone }), [item.id, nodeCard, anchorRefNone]);
	const link = item.link ?? item.scene;
	useLayoutEffect(() => {
		const element = bodyRef.current;
		const scroll = scrollRef.current;
		if (!element || !scroll || !store) return undefined;
		const measure = () => {
			// a scene whose width is not known yet has no place to report
			if (scene && !layout) return;
			const scrollRect = scroll.getBoundingClientRect();
			const scale = scrollRect.width / scroll.offsetWidth || 1;
			const rect = element.getBoundingClientRect();
			const rootRect = rootRef.current.getBoundingClientRect();
			store.stackItemSet(stackKey, item.id, {
				x: (rect.left - scrollRect.left) / scale,
				y: (rect.top - scrollRect.top) / scale + scroll.scrollTop,
				width: element.offsetWidth,
				height: element.offsetHeight,
				top: (rootRect.top - scrollRect.top) / scale + scroll.scrollTop,
				fullHeight: rootRef.current.offsetHeight,
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	// widthBody: the area this reads gets its ref after this item, on the first commit
	}, [store, stackKey, item.id, scrollRef, heightBody, widthBody]);
	return (
		<section ref={rootRef} className={`doc-switch-stack-item${link && !isStatic ? ' is-linked' : ''}`} data-stack-item={item.id} data-search-part={`item/${item.id}`} data-search={searchState ?? undefined} data-tone={item.tone || 'slate'} onClick={link && !isStatic ? (event) => { event.stopPropagation(); void store.pathSet(link); } : undefined}>
			<span ref={anchorRef?.(`item/${item.id}`)} className="doc-switch-stack-item-anchor" />
			{item.title ? (
				<div className="doc-switch-stack-item-chrome">
					<span className="doc-switch-stack-item-tag">{String(index + 1).padStart(2, '0')}</span>
					<span className="doc-switch-embed-icon"><Icon size={13} aria-hidden="true" /></span>
					<span className="doc-switch-embed-title">{item.title}</span>
					{item.subtitle ? <span className="doc-switch-embed-subtitle">{item.subtitle}</span> : null}
					{scene && !isStatic && !isTabs ? <SwitchViewSwitcher store={store} presentation={presentation} viewAsked={item.view} /> : null}
				</div>
			) : null}
			{/* drawn in a static copy too, inert, so a mask or a picture has the same rows */}
			{isTabs ? <SwitchViewTabs store={store} presentation={presentation} viewAsked={item.view} isInert={isStatic} isWheelTaken={isWheelTaken} /> : null}
			<div ref={bodyRef} className="doc-switch-stack-item-body" style={heightBody ? { height: heightBody } : undefined}>
				{nodeCard ? <DiagramNodeContent id={item.id} node={nodeCard} config={config} registry={registry} anchorRef={anchorRefNone} visualization={visualization} /> : null}
				{layout ? (
					<div className="doc-switch-embed-world" style={{ transform: `translate(${layout.map.tx}px, ${layout.map.ty}px) scale(${layout.map.scale})`, clipPath: store.sceneBoxIsChosen(pathShown, item.box) ? switchBoxClipBuild(box) : undefined }}>
						{depth + 1 <= store.depthRenderMax ? <SwitchStaticScene store={store} path={pathShown} depth={depth + 1} isEmbedded pathEmbedder={pathOwner} /> : null}
					</div>
				) : null}
			</div>
		</section>
	);
});

// a scrolling area of items stacked vertically (card-diagram-flexible-switch.md#a-scrolling-stack):
// nothing has to shrink for everything to be visible. its scroll position is the store's,
// so every drawing of it agrees and a program can set it (SwitchStore.scrollTo)
export const SceneStackTitleBar = observer(function SceneStackTitleBar({ data, nodeId, anchorRef, presentation, onFocus, isHeightFull, onHeightToggle }) {
	const { config = {} } = useContext(DiagramRenderContext);
	const title = switchStackTitleBarRead(data, presentation);
	if (!title) return null;
	const Icon = CARD_ICON_BY_NAME[data.icon] ?? Boxes;
	return (
		<div className={`doc-switch-embed-chrome doc-switch-stack-chrome nopan nodrag${onFocus ? ' is-focusable' : ''}`} onClick={(event) => { event.stopPropagation(); if (!event.target.closest('button, a, input, [contenteditable], .is-component')) onFocus?.(); }}>
			{title.isLegacy ? <span className="doc-switch-embed-icon"><Icon size={13} aria-hidden="true" /></span> : null}
			{title.itemList ? title.itemList.map((item) => (
				<div key={item.id} className={`doc-switch-stack-title-item is-${item.type}`}>
					{item.type === 'text' ? <span className="doc-switch-stack-title-text">{item.text}</span> : (
						<RegisteredComp compName={item.comp} placement="visualizationTitle" input={{ data: item.data ?? {} }} configRuntime={{ ...config, instanceId: `${config.instanceId ?? 'diagram'}:node:${nodeId}:title:${item.id}`, isEdit: false, visualization: { nodeId, titleItemId: item.id, anchorRef, presentation } }} />
					)}
				</div>
			)) : <span className="doc-switch-stack-title-text">{title.text}</span>}
			{title.isLegacy && data.subtitle ? <span className="doc-switch-embed-subtitle">{data.subtitle}</span> : null}
			{title.isLegacy && data.statList?.length ? <span className="doc-switch-embed-stat">{data.statList.map((stat, index) => <span key={index}>{stat}</span>)}</span> : null}
			{onFocus || onHeightToggle ? (
				<span className="doc-switch-stack-action-list">
					{onFocus ? <button type="button" className="doc-switch-stack-focus" title="Focus this container" aria-label="Focus this container" onClick={onFocus}><Expand size={13} aria-hidden="true" /></button> : null}
					{onHeightToggle ? <button type="button" className="doc-switch-stack-focus doc-switch-stack-height" title={isHeightFull ? 'Scroll in a fixed height' : 'Show at full height'} aria-label={isHeightFull ? 'Scroll in a fixed height' : 'Show at full height'} aria-pressed={isHeightFull} onClick={onHeightToggle}>{isHeightFull ? <FoldVertical size={13} aria-hidden="true" /> : <UnfoldVertical size={13} aria-hidden="true" />}</button> : null}
				</span>
			) : null}
		</div>
	);
});

export const SceneStackCard = observer(function SceneStackCard({ node, nodeId, anchorRef }) {
	const context = useContext(SwitchContext);
	const store = context?.store;
	const { data } = node;
	const scrollRef = useRef(null);
	const [widthBody, widthBodySet] = useState(0);
	const searchMark = useDiagramSearchMark(nodeId);
	const stackKey = store ? store.stackKey(pathOwnerOf(context), nodeId) : '';
	const presentation = switchStackPresentationBuild(data, context?.presentation ?? switchPresentationBuild(pathOwnerOf(context)));
	const isEmbedded = presentation.isEmbedded;
	const isStatic = Boolean(context?.isStatic);
	const isTitleVisible = Boolean(switchStackTitleBarRead(data, presentation));
	const isFrameVisible = switchStackFrameIsVisible(data, presentation);
	const onFocus = store && data.focusPath && isEmbedded && !isStatic && !store.isBoxAdjust && !store.plan ? () => { void store.pathSet(data.focusPath); } : undefined;
	const isHeightFull = node.size?.height === 'auto';
	const onHeightToggle = store && !isStatic && !store.isBoxAdjust && !store.plan ? () => { store.stackHeightFullSet({ path: pathOwnerOf(context), nodeId, isFull: !isHeightFull }); } : undefined;
	// the wheel: over a stack embedded in a card it is the canvas's, as over any card (its
	// scrollbar still works). in a stack's own scene it scrolls the stack while the stack
	// can scroll, and the end of that gesture stops here; then it is the canvas's again.
	// a pinch is always the canvas's. never the page's (card-diagram.md#the-wheel-over-a-canvas)
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element || isStatic || isEmbedded) return undefined;
		let timeScrolled = 0;
		const onWheel = (event) => {
			if (event.ctrlKey) return;
			const isScrollable = event.deltaY > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0;
			const now = performance.now();
			if (isScrollable) {
				timeScrolled = now;
				event.stopPropagation();
			} else if (now - timeScrolled < WHEEL_GESTURE_MS) {
				timeScrolled = now;
				event.preventDefault();
				event.stopPropagation();
			}
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [isStatic, isEmbedded]);
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element || !store) return undefined;
		store.stackElementAdd(stackKey, element);
		const measure = () => {
			const rootRect = element.parentElement.parentElement.getBoundingClientRect();
			const rect = element.getBoundingClientRect();
			const scale = rect.width / element.offsetWidth || 1;
			const style = getComputedStyle(element);
			widthBodySet(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
			store.stackAreaSet(stackKey, { x: (rect.left - rootRect.left) / scale, y: (rect.top - rootRect.top) / scale, width: element.clientWidth, height: element.clientHeight, contentHeight: element.scrollHeight });
			// a position set before the items had their height was cut to what fitted then
			store.stackElementSync(stackKey, element);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => {
			observer.disconnect();
			store.stackElementRemove(stackKey, element);
		};
	}, [store, stackKey, isTitleVisible]);
	return (
		<div className={`doc-switch-stack${isTitleVisible ? '' : ' is-chrome-hidden'}${isFrameVisible ? '' : ' is-frame-hidden'}${isHeightFull ? ' is-height-full' : ''}`} data-tone={data.tone || 'slate'} data-presentation={isEmbedded ? 'embedded' : 'focused'}>
			<SceneStackTitleBar data={data} nodeId={nodeId} anchorRef={anchorRef} presentation={presentation} onFocus={onFocus} isHeightFull={isHeightFull} onHeightToggle={onHeightToggle} />
			<div className="doc-switch-stack-frame">
				<div ref={scrollRef} className="doc-switch-stack-scroll nopan nodrag" onScroll={store ? (event) => store.stackScrollReport(stackKey, event.currentTarget) : undefined}>
					<div className="doc-switch-stack-list">
						{(data.itemList ?? []).map((item, index, list) => (
							<SceneStackItem key={item.id} isWheelTaken={!isEmbedded && !isStatic} searchState={searchMark.partStateOf(`item/${item.id}`)} item={item} index={list.slice(0, index).filter((other) => other.title).length} store={store} stackKey={stackKey} scrollRef={scrollRef} widthBody={widthBody} anchorRef={anchorRef} isStatic={isStatic || isEmbedded} depth={context?.depth ?? 0} pathOwner={pathOwnerOf(context)} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
});

// the standard form of a link in a scene (card-diagram-usage.md#drawing-conventions)
export const SceneLinkCard = observer(function SceneLinkCard({ node, nodeId }) {
	return <div className="doc-switch-link"><CardBrief node={node} nodeId={nodeId} /></div>;
});

// one tab per member: its anchor is the line a rewired connection ends on
export const SceneTabsCard = observer(function SceneTabsCard({ node, anchorRef }) {
	const context = useContext(SwitchContext);
	const { tabList, focus } = node.data;
	return (
		<div className="doc-switch-tabs" role="tablist">
			{tabList.map((tab) => (
				<button
					key={tab.id}
					ref={anchorRef?.(`tab/${tab.id}`)}
					type="button"
					role="tab"
					className="doc-switch-tab nodrag nopan"
					data-tone={tab.tone || undefined}
					aria-selected={tab.id === focus}
					onClick={(event) => {
						event.stopPropagation();
						if (tab.link && !context?.isStatic) void context?.store.pathSet(tab.link);
					}}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
});

// search (card-diagram-impl.md#search): what a card holding scenes answers. its own words are a
// part of it; a scene inside it is searched one level deeper, through helper.childSearch, which
// stops at the depth of the request
function sceneEmbedSearchMatch(node, helper) {
	const data = node.data ?? {};
	const partList = helper.textListOf([data.title, data.subtitle, data.statList]).some(helper.test) ? [{ id: 'title' }] : [];
	const result = helper.childSearch(data.scene, data.view);
	return { partList, childList: result ? [{ partId: 'scene', result }] : [] };
}

function sceneStackSearchMatch(node, helper) {
	const data = node.data ?? {};
	const titleBar = typeof data.titleBar === 'string' ? data.titleBar : data.titleBar?.text;
	const partList = helper.textListOf([titleBar, data.title, data.subtitle, data.statList]).some(helper.test) ? [{ id: 'title' }] : [];
	const childList = [];
	for (const item of data.itemList ?? []) {
		const textList = helper.textListOf([item.title, item.subtitle, item.node?.data]);
		if (textList.some(helper.test)) partList.push({ id: `item/${item.id}` });
		const result = item.scene ? helper.childSearch(item.scene, item.view) : null;
		if (result) childList.push({ partId: `item/${item.id}`, result });
	}
	return { partList, childList };
}

function sceneTabsSearchMatch(node, helper) {
	const partList = (node.data?.tabList ?? []).filter((tab) => helper.test(tab.label)).map((tab) => ({ id: `tab/${tab.id}` }));
	return { partList, childList: [] };
}

export const sceneEmbedNodeKind = {
	type: 'scene-embed',
	label: 'Embedded scene',
	contract: {
		searchMatch: sceneEmbedSearchMatch,
		dataNormalize: (data) => {
			if (typeof data.scene !== 'string' || !data.scene.trim()) throw new Error('An embedded scene needs data.scene, the path of a scene.');
			return data;
		},
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 480, height: 340 },
	},
	schema: null,
	Card: SceneEmbedCard,
	create: {
		description: 'Another scene of this block, shown inside a card.', icon: Layers, keywordList: ['embed', 'scene', 'zoom'],
		nodeCreate: (idNext) => ({ id: idNext('embed'), renderer: { type: 'scene-embed' }, size: { width: 480, height: 340 }, data: { scene: '/' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

export const sceneStackNodeKind = {
	type: 'scene-stack',
	label: 'Scrolling stack of scenes',
	contract: {
		searchMatch: sceneStackSearchMatch,
		dataNormalize: (data) => {
			if (!Array.isArray(data.itemList)) throw new Error('A stack needs data.itemList: its items, each a scene or a card.');
			switchStackTitleBarNormalize(data.titleBar);
			if (data.focusPath !== undefined && (typeof data.focusPath !== 'string' || !data.focusPath.trim())) throw new Error('A stack focusPath must be a nonempty scene path.');
			if (data.isFrameVisibleFocused !== undefined && typeof data.isFrameVisibleFocused !== 'boolean') throw new Error('A stack isFrameVisibleFocused must be a boolean.');
			for (const key of ['isHeightFullEmbedded', 'isHeightFullFocused']) {
				if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`A stack ${key} must be a boolean.`);
			}
			const idSet = new Set();
			for (const item of data.itemList) {
				if (!item?.id) throw new Error('Every item of a stack needs an id.');
				if (idSet.has(item.id)) throw new Error(`A stack has two items of the id "${item.id}".`);
				if (!item.scene && !item.node) throw new Error(`The item "${item.id}" of a stack needs a scene, or a node.`);
				idSet.add(item.id);
			}
			return data;
		},
		anchorListGet: (data) => [{ id: 'body', sideList: sideAllList }, ...(data.itemList ?? []).map((item) => ({ id: `item/${item.id}`, sideList: ['left', 'right'] }))],
		sizeDefault: { width: 900, height: 700 },
	},
	schema: null,
	Card: SceneStackCard,
	create: {
		description: 'Scenes and cards stacked vertically in a scrolling area.', icon: Layers, keywordList: ['stack', 'scroll', 'list', 'embed'],
		nodeCreate: (idNext) => ({ id: idNext('stack'), renderer: { type: 'scene-stack' }, size: { width: 900, height: 700 }, data: { itemList: [] }, handles: [] }),
	},
};

export const sceneLinkNodeKind = {
	type: 'scene-link',
	label: 'Link to a scene',
	contract: {
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 170, height: 40 },
		isWidthFit: true,
	},
	schema: null,
	Card: SceneLinkCard,
	create: {
		description: 'A way to another scene: a pill as wide as its words.', icon: Layers, keywordList: ['link', 'open', 'navigate', 'go'],
		nodeCreate: (idNext) => ({ id: idNext('link'), renderer: { type: 'scene-link' }, link: '/', data: { title: 'Open', icon: 'link', tone: 'teal' }, handles: [] }),
	},
};

export const sceneTabsNodeKind = {
	type: 'scene-tabs',
	label: 'Tabs of scenes',
	contract: {
		searchMatch: sceneTabsSearchMatch,
		anchorListGet: (data) => [{ id: 'body', sideList: sideAllList }, ...(data.tabList ?? []).map((tab) => ({ id: `tab/${tab.id}`, sideList: sideAllList }))],
		sizeDefault: { width: 800, height: 40 },
		// a tab chosen in place: the header stays, its lines move
		morphKeyGet: (data) => (data.tabList ?? []).map((tab) => tab.id),
	},
	schema: null,
	Card: SceneTabsCard,
};

// the title of a scene focused (card-diagram-flexible-switch.md#the-title-of-a-scene): a node
// the layer puts above what the scene draws, in its world, so it zooms and pans with the cards.
// it is never written in a scene, and offered by no panel
export const SceneTitleCard = observer(function SceneTitleCard({ node }) {
	const scale = node.data.scale ?? 1;
	// what decides its height is set here, inline: its node is SWITCH_TITLE_HEIGHT * scale high,
	// and its one line is as high, so the heading rules of a page (a margin, a font size, a line
	// height of its h2) cannot make it overflow its node. not-prose: out of the page's typography
	return <h2 className="doc-switch-scene-title not-prose" style={{ margin: 0, fontSize: SWITCH_TITLE_FONT_SIZE * scale, lineHeight: `${SWITCH_TITLE_HEIGHT * scale}px` }}>{node.data.text}</h2>;
});

export const sceneTitleNodeKind = {
	type: 'scene-title',
	label: 'Title of a scene',
	contract: {
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 400, height: SWITCH_TITLE_HEIGHT },
		isWidthFit: true,
		// found by its words, as a whole (SwitchStore.searchRun searches it with the scene shown);
		// not by the rest of its data, a scale
		searchMatch: (node, helper) => (helper.test(node.data.text) ? { isWhole: true } : null),
	},
	schema: null,
	Card: SceneTitleCard,
};

export const switchNodeKindList = [sceneEmbedNodeKind, sceneStackNodeKind, sceneLinkNodeKind, sceneTabsNodeKind, sceneTitleNodeKind];

// the registry of a series with the kinds of the layer
export function switchRegistryBuild(registry) {
	return nodeRegistryBuild({ id: `${registry.id}-switch`, label: registry.label, kindList: [...registry.kindList, ...switchNodeKindList], cardLegacyConvert: registry.cardLegacyConvert });
}

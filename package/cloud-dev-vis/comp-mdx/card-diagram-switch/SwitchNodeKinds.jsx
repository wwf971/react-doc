import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Boxes, Expand, Layers } from '../../../../main/frontend/UICommon.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { diagramNormalize } from '../card-diagram/DiagramERData.js';
import { DiagramNodeContent, DiagramRenderContext } from '../card-diagram/DiagramRender.jsx';
import { SwitchContext, SwitchStaticView } from './SwitchStatic.jsx';
import { SWITCH_EMBED_CHROME_HEIGHT, switchBoxClipBuild, switchEmbedMapBuild, switchPathNormalize, switchPresentationBuild, switchStackFrameIsVisible, switchStackItemLayout, switchStackPresentationBuild, switchStackTitleBarNormalize, switchStackTitleBarRead } from './SwitchData.js';
import { CARD_ICON_BY_NAME } from '../card-diagram/CompactCard.jsx';

// The two node kinds of the switching layer (card-diagram-flexible-switch.md):
//
//   view-embed   a card showing another view inside it: a title, and the world of
//                that view scaled to fit the card. data: view (a path), box? (a
//                region of that view: the id of its bounding box node, or a rect),
//                padding? (the margin inside the card, a part of its size),
//                title?, subtitle?, icon?, tone?, statList?, isChromeHidden?
//   view-stack   a scrolling area of items stacked vertically: each an embedded view
//                as wide as the area, or a card. data: itemList: [{ id, view?, box?,
//                padding?, node?, link?, title?, subtitle?, icon?, tone? }], title?,
//                subtitle?, icon?, tone?, statList?, isChromeHidden?
//   view-tabs    the header of views arranged in tabs. data: tabList, focus. written by
//                switchTabsApply, never by hand
//
// A registry of a series becomes the registry of its switching component with
// switchRegistryBuild, as a diagram component is bound to its registry.
const sideAllList = ['left', 'right', 'top', 'bottom'];
const WHEEL_GESTURE_MS = 180;

export const ViewEmbedCard = observer(function ViewEmbedCard({ node, nodeId }) {
	const context = useContext(SwitchContext);
	const bodyRef = useRef(null);
	const [body, bodySet] = useState(null);
	const { data } = node;
	const store = context?.store;
	const view = switchPathNormalize(data.view);
	useLayoutEffect(() => {
		const element = bodyRef.current;
		if (!element) return undefined;
		const measure = () => {
			const next = { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
			if (next.width === 0) return;
			bodySet((previous) => (previous && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next));
			store?.embedBodySet(nodeId, view, next);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [store, nodeId, view]);
	const Icon = CARD_ICON_BY_NAME[data.icon] ?? Boxes;
	const isCycle = context?.pathChain?.includes(view);
	const box = store && !isCycle ? store.viewBoxGet(view, data.box) : null;
	const map = body && box ? switchEmbedMapBuild(body, box, data.padding) : null;
	return (
		<div className={`doc-switch-embed${data.isChromeHidden ? ' is-chrome-hidden' : ''}`} data-tone={data.tone || 'slate'}>
			{data.isChromeHidden ? null : (
				<div className="doc-switch-embed-chrome" style={{ height: SWITCH_EMBED_CHROME_HEIGHT }}>
					<span className="doc-switch-embed-icon"><Icon size={13} aria-hidden="true" /></span>
					<span className="doc-switch-embed-title">{data.title ?? store?.labelGet(view) ?? view}</span>
					{data.subtitle ? <span className="doc-switch-embed-subtitle">{data.subtitle}</span> : null}
					{data.statList?.length ? <span className="doc-switch-embed-stat">{data.statList.map((stat, index) => <span key={index}>{stat}</span>)}</span> : null}
				</div>
			)}
			<div ref={bodyRef} className="doc-switch-embed-body">
				{!store ? <span className="doc-switch-embed-note">{view}</span>
					: isCycle ? <span className="doc-switch-embed-note">{view} embeds itself</span>
					: map ? (
						<div className="doc-switch-embed-world" style={{ transform: `translate(${map.tx}px, ${map.ty}px) scale(${map.scale})`, clipPath: store.viewBoxIsChosen(view, data.box) ? switchBoxClipBuild(box) : undefined }}>
							<SwitchStaticView store={store} path={view} depth={(context?.depth ?? 0) + (context?.isStatic ? 1 : 0)} isEmbedded />
						</div>
					) : null}
			</div>
		</div>
	);
});

// the view a card belongs to: the one drawn statically around it, or the one on the canvas
function pathOwnerOf(context) {
	return context?.isStatic ? context.pathChain[context.pathChain.length - 1] : context?.store.pathFlow;
}

// an item of a stack: its title line, and a view as wide as the item, or a card
const ViewStackItem = observer(function ViewStackItem({ item, index, store, stackKey, scrollRef, widthBody, anchorRef, isStatic, depth }) {
	const rootRef = useRef(null);
	const bodyRef = useRef(null);
	const { registry, config } = useContext(DiagramRenderContext);
	const Icon = CARD_ICON_BY_NAME[item.icon] ?? Boxes;
	const view = item.view ? switchPathNormalize(item.view) : '';
	const box = view && store ? store.viewBoxGet(view, item.box) : null;
	const layout = box && widthBody ? switchStackItemLayout(widthBody, box, item.padding) : null;
	const nodeCard = useMemo(() => (item.node ? diagramNormalize({ version: 1, nodes: [{ id: item.id, handles: [], ...item.node }] }, registry).nodes[0] : null), [item.id, item.node, registry]);
	const anchorRefNone = useMemo(() => () => undefined, []);
	const visualization = useMemo(() => ({ nodeId: item.id, size: nodeCard?.size, isEdit: false, anchorRef: anchorRefNone }), [item.id, nodeCard, anchorRefNone]);
	const link = item.link ?? item.view;
	useLayoutEffect(() => {
		const element = bodyRef.current;
		const scroll = scrollRef.current;
		if (!element || !scroll || !store) return undefined;
		const measure = () => {
			// a view whose width is not known yet has no place to report
			if (view && !layout) return;
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
	}, [store, stackKey, item.id, scrollRef, layout?.height, widthBody]);
	return (
		<section ref={rootRef} className={`doc-switch-stack-item${link && !isStatic ? ' is-linked' : ''}`} data-stack-item={item.id} data-tone={item.tone || 'slate'} onClick={link && !isStatic ? (event) => { event.stopPropagation(); void store.pathSet(link); } : undefined}>
			<span ref={anchorRef?.(`item/${item.id}`)} className="doc-switch-stack-item-anchor" />
			{item.title ? (
				<div className="doc-switch-stack-item-chrome">
					<span className="doc-switch-stack-item-tag">{String(index + 1).padStart(2, '0')}</span>
					<span className="doc-switch-embed-icon"><Icon size={13} aria-hidden="true" /></span>
					<span className="doc-switch-embed-title">{item.title}</span>
					{item.subtitle ? <span className="doc-switch-embed-subtitle">{item.subtitle}</span> : null}
				</div>
			) : null}
			<div ref={bodyRef} className="doc-switch-stack-item-body" style={layout ? { height: layout.height } : undefined}>
				{nodeCard ? <DiagramNodeContent id={item.id} node={nodeCard} config={config} registry={registry} anchorRef={anchorRefNone} visualization={visualization} /> : null}
				{layout ? (
					<div className="doc-switch-embed-world" style={{ transform: `translate(${layout.map.tx}px, ${layout.map.ty}px) scale(${layout.map.scale})`, clipPath: store.viewBoxIsChosen(view, item.box) ? switchBoxClipBuild(box) : undefined }}>
						<SwitchStaticView store={store} path={view} depth={depth + 1} isEmbedded />
					</div>
				) : null}
			</div>
		</section>
	);
});

// a scrolling area of items stacked vertically (card-diagram-flexible-switch.md#a-scrolling-stack):
// nothing has to shrink for everything to be visible. its scroll position is the store's,
// so every drawing of it agrees and a program can set it (SwitchStore.scrollTo)
export const ViewStackTitleBar = observer(function ViewStackTitleBar({ data, nodeId, anchorRef, presentation, onFocus }) {
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
			{onFocus ? <button type="button" className="doc-switch-stack-focus" title="Focus this container" aria-label="Focus this container" onClick={onFocus}><Expand size={13} aria-hidden="true" /></button> : null}
		</div>
	);
});

export const ViewStackCard = observer(function ViewStackCard({ node, nodeId, anchorRef }) {
	const context = useContext(SwitchContext);
	const store = context?.store;
	const { data } = node;
	const scrollRef = useRef(null);
	const [widthBody, widthBodySet] = useState(0);
	const stackKey = store ? store.stackKey(pathOwnerOf(context), nodeId) : '';
	const presentation = switchStackPresentationBuild(data, context?.presentation ?? switchPresentationBuild(pathOwnerOf(context)));
	const isEmbedded = presentation.isEmbedded;
	const isStatic = Boolean(context?.isStatic);
	const isTitleVisible = Boolean(switchStackTitleBarRead(data, presentation));
	const isFrameVisible = switchStackFrameIsVisible(data, presentation);
	const onFocus = store && data.focusPath && isEmbedded && !isStatic && !store.isBoxAdjust && !store.plan ? () => { void store.pathSet(data.focusPath); } : undefined;
	// the wheel: over a stack embedded in a card it is the canvas's, as over any card (its
	// scrollbar still works). in a stack's own view it scrolls the stack while the stack
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
		<div className={`doc-switch-stack${isTitleVisible ? '' : ' is-chrome-hidden'}${isFrameVisible ? '' : ' is-frame-hidden'}`} data-tone={data.tone || 'slate'} data-presentation={isEmbedded ? 'embedded' : 'focused'}>
			<ViewStackTitleBar data={data} nodeId={nodeId} anchorRef={anchorRef} presentation={presentation} onFocus={onFocus} />
			<div className="doc-switch-stack-frame">
				<div ref={scrollRef} className="doc-switch-stack-scroll nopan nodrag" onScroll={store ? (event) => store.stackScrollReport(stackKey, event.currentTarget) : undefined}>
					<div className="doc-switch-stack-list">
						{(data.itemList ?? []).map((item, index, list) => (
							<ViewStackItem key={item.id} item={item} index={list.slice(0, index).filter((other) => other.title).length} store={store} stackKey={stackKey} scrollRef={scrollRef} widthBody={widthBody} anchorRef={anchorRef} isStatic={isStatic || isEmbedded} depth={context?.depth ?? 0} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
});

// one tab per member: its anchor is the line a rewired connection ends on
export const ViewTabsCard = observer(function ViewTabsCard({ node, anchorRef }) {
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

export const viewEmbedNodeKind = {
	type: 'view-embed',
	label: 'Embedded view',
	contract: {
		dataNormalize: (data) => {
			if (typeof data.view !== 'string' || !data.view.trim()) throw new Error('An embedded view needs data.view, the path of a view.');
			return data;
		},
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 480, height: 340 },
	},
	schema: null,
	Card: ViewEmbedCard,
	create: {
		description: 'Another view of this block, shown inside a card.', icon: Layers, keywordList: ['embed', 'view', 'zoom'],
		nodeCreate: (idNext) => ({ id: idNext('embed'), renderer: { type: 'view-embed' }, size: { width: 480, height: 340 }, data: { view: '/' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

export const viewStackNodeKind = {
	type: 'view-stack',
	label: 'Scrolling stack of views',
	contract: {
		dataNormalize: (data) => {
			if (!Array.isArray(data.itemList)) throw new Error('A stack needs data.itemList: its items, each a view or a card.');
			switchStackTitleBarNormalize(data.titleBar);
			if (data.focusPath !== undefined && (typeof data.focusPath !== 'string' || !data.focusPath.trim())) throw new Error('A stack focusPath must be a nonempty view path.');
			if (data.isFrameVisibleFocused !== undefined && typeof data.isFrameVisibleFocused !== 'boolean') throw new Error('A stack isFrameVisibleFocused must be a boolean.');
			const idSet = new Set();
			for (const item of data.itemList) {
				if (!item?.id) throw new Error('Every item of a stack needs an id.');
				if (idSet.has(item.id)) throw new Error(`A stack has two items of the id "${item.id}".`);
				if (!item.view && !item.node) throw new Error(`The item "${item.id}" of a stack needs a view, or a node.`);
				idSet.add(item.id);
			}
			return data;
		},
		anchorListGet: (data) => [{ id: 'body', sideList: sideAllList }, ...(data.itemList ?? []).map((item) => ({ id: `item/${item.id}`, sideList: ['left', 'right'] }))],
		sizeDefault: { width: 900, height: 700 },
	},
	schema: null,
	Card: ViewStackCard,
	create: {
		description: 'Views and cards stacked vertically in a scrolling area.', icon: Layers, keywordList: ['stack', 'scroll', 'list', 'embed'],
		nodeCreate: (idNext) => ({ id: idNext('stack'), renderer: { type: 'view-stack' }, size: { width: 900, height: 700 }, data: { itemList: [] }, handles: [] }),
	},
};

export const viewTabsNodeKind = {
	type: 'view-tabs',
	label: 'Tabs of views',
	contract: {
		anchorListGet: (data) => [{ id: 'body', sideList: sideAllList }, ...(data.tabList ?? []).map((tab) => ({ id: `tab/${tab.id}`, sideList: sideAllList }))],
		sizeDefault: { width: 800, height: 40 },
		// a tab chosen in place: the header stays, its lines move
		morphKeyGet: (data) => (data.tabList ?? []).map((tab) => tab.id),
	},
	schema: null,
	Card: ViewTabsCard,
};

export const switchNodeKindList = [viewEmbedNodeKind, viewStackNodeKind, viewTabsNodeKind];

// the registry of a series with the kinds of the layer
export function switchRegistryBuild(registry) {
	return nodeRegistryBuild({ id: `${registry.id}-switch`, label: registry.label, kindList: [...registry.kindList, ...switchNodeKindList], cardLegacyConvert: registry.cardLegacyConvert });
}

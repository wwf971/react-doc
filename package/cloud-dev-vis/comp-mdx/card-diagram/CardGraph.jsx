import { useId, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDiagramSearchMark } from './DiagramRender.jsx';
import { CARD_GRAPH_PAD, cardGraphEdgePoint, cardGraphItemSizeOf } from './CardGraphData.js';

// A graph in one card (CardGraphData.js): its lines in one svg, its items as plain elements over
// them. Thousands of lines are not thousands of elements: the lines of one look (color, width,
// dashes, opacity) are one path, their arrowheads one more, so the browser lays out a handful of
// shapes. A pointer resting on an item dims them (a rule written into the style of the card) and
// draws its own lines again, lit, one element each with its words
const COLOR_DEFAULT = '#64748b';
const ARROW_LENGTH = 7;
const ARROW_HALF = 3.5;
const round = (value) => Math.round(value * 10) / 10;

function arrowPathOf(start, end) {
	const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
	const ux = (end.x - start.x) / length;
	const uy = (end.y - start.y) / length;
	const bx = end.x - ux * ARROW_LENGTH;
	const by = end.y - uy * ARROW_LENGTH;
	return `M${round(end.x)} ${round(end.y)}L${round(bx - uy * ARROW_HALF)} ${round(by + ux * ARROW_HALF)}L${round(bx + uy * ARROW_HALF)} ${round(by - ux * ARROW_HALF)}Z`;
}

// the lines of the item under the pointer, drawn over the others: the one part drawn again on a hover
function CardGraphLit({ litRef, geometry }) {
	const [index, setIndex] = useState(null);
	litRef.current = setIndex;
	if (index === null) return null;
	return (geometry.lineIndexListByItem[index] ?? []).map((lineIndex) => {
		const { line, start, end } = geometry.lineList[lineIndex];
		const color = line.color ?? COLOR_DEFAULT;
		return (
			<g key={lineIndex} className="doc-card-graph-lit">
				<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={Math.max(2.4, line.width ?? 1)} strokeDasharray={line.dash || undefined}>
					{line.title ? <title>{line.title}</title> : null}
				</line>
				{line.isArrow === false ? null : <path d={arrowPathOf(start, end)} fill={color} />}
			</g>
		);
	});
}

export const CardGraph = observer(function CardGraph({ node, nodeId }) {
	const { data } = node;
	const searchMark = useDiagramSearchMark(nodeId);
	const uid = `doc-graph-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const styleRef = useRef(null);
	const litRef = useRef(null);
	const geometry = useMemo(() => {
		const boxById = new Map(data.itemList.map((item, index) => [item.id, { ...cardGraphItemSizeOf(data, item), x: item.x + CARD_GRAPH_PAD, y: item.y + CARD_GRAPH_PAD, index }]));
		const lineIndexListByItem = data.itemList.map(() => []);
		const groupByLook = new Map();
		const lineList = (data.lineList ?? []).map((line, lineIndex) => {
			const from = boxById.get(line.from);
			const to = boxById.get(line.to);
			const start = cardGraphEdgePoint(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
			const end = cardGraphEdgePoint(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
			lineIndexListByItem[from.index].push(lineIndex);
			if (to.index !== from.index) lineIndexListByItem[to.index].push(lineIndex);
			const color = line.color ?? COLOR_DEFAULT;
			const look = `${color}|${line.width ?? 1}|${line.dash ?? ''}|${line.opacity ?? 1}`;
			if (!groupByLook.has(look)) groupByLook.set(look, { look, color, width: line.width ?? 1, dash: line.dash, opacity: line.opacity, lineText: [], arrowText: [] });
			const group = groupByLook.get(look);
			group.lineText.push(`M${round(start.x)} ${round(start.y)}L${round(end.x)} ${round(end.y)}`);
			if (line.isArrow !== false) group.arrowText.push(arrowPathOf(start, end));
			return { line, start, end };
		});
		const groupList = [...groupByLook.values()].map((group) => ({ ...group, lineText: group.lineText.join(''), arrowText: group.arrowText.join('') }));
		let width = 0;
		let height = 0;
		for (const box of boxById.values()) { width = Math.max(width, box.x + box.width); height = Math.max(height, box.y + box.height); }
		return { boxById, lineList, lineIndexListByItem, groupList, width: width + CARD_GRAPH_PAD, height: height + CARD_GRAPH_PAD };
	}, [data]);
	const light = (index) => {
		if (styleRef.current) styleRef.current.textContent = index === null || !geometry.lineIndexListByItem[index]?.length ? '' : `#${uid} .doc-card-graph-base{opacity:.12}`;
		litRef.current?.(index);
	};
	return (
		<div id={uid} data-node-id={nodeId} className="doc-card-graph" style={{ width: geometry.width, height: geometry.height }} onPointerLeave={() => light(null)}>
			<style ref={styleRef} />
			<svg className="doc-card-graph-lines" width={geometry.width} height={geometry.height} aria-hidden="true">
				<g className="doc-card-graph-base">
					{geometry.groupList.map((group) => (
						<g key={group.look} opacity={group.opacity ?? undefined}>
							<path className="doc-card-graph-line" d={group.lineText} fill="none" stroke={group.color} strokeWidth={group.width} strokeDasharray={group.dash || undefined} />
							{group.arrowText ? <path d={group.arrowText} fill={group.color} /> : null}
						</g>
					))}
				</g>
				<CardGraphLit litRef={litRef} geometry={geometry} />
			</svg>
			{data.itemList.map((item) => {
				const box = geometry.boxById.get(item.id);
				const partId = `item/${item.id}`;
				return (
					<div key={item.id} className={`doc-card-graph-item is-${item.shape}${item.link ? ' is-link' : ''}`} data-tone={item.tone || 'slate'} data-variant={item.variant || undefined}
						data-search-part={partId} data-search={searchMark.partStateOf(partId) ?? undefined} title={item.text ? `${item.title} (${item.text})` : item.title}
						style={{ left: box.x, top: box.y, width: box.width, height: box.height }} onPointerEnter={() => light(box.index)} {...(item.link ? { 'data-switch-link': item.link } : {})}>
						<span className="doc-card-graph-name">{item.title}</span>
						{item.shape === 'square' && item.text && item.text !== item.title ? <span className="doc-card-graph-name-second">{item.text}</span> : null}
					</div>
				);
			})}
		</div>
	);
});

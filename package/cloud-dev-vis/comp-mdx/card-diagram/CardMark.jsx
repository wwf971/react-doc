import { observer } from 'mobx-react-lite';
import { Boxes } from '../../../../main/frontend/UICommon.js';
import { ANCHOR_CYLINDER_CAP } from './DiagramERData.js';
import { CARD_MARK_ANCHOR, CARD_MARK_ANCHOR_FOOT, cardMarkContractBuild, cardMarkOutlineOf, cardMarkSizeOf } from './CardMarkData.js';
import './CardMark.css';

// A mark (card-diagram-impl.md#marks): a shape with its name under it, for a picture of a system at
// the level of an overview. What it shows is the kind's to say (contentGet); how it looks is the
// same for every kind built on it, so an overview reads as one vocabulary of shapes.
//
//      ▢        the mark: the shape of the kind (a tile, a circle, a cylinder), its icon inside,
//    Title      the accent of its family or its tone. It is the anchor `mark`, on which the
//    a line     handles of the node are drawn, on its outline (CardMarkData.js); a handle at the
//     ‾‾‾       bottom stands under the words, on the anchor `foot`, as wide as the mark
//
// The mark is as large as the node leaves it: its own size with a height left to the content,
// as large as fits above the words in a node drawn to a size.
export const CardMark = observer(function CardMark({ node, nodeId, anchorRef, content, shape }) {
	const size = cardMarkSizeOf(node.size);
	const Icon = content.Icon ?? Boxes;
	// an image is its own tile, unless it is a glyph to draw inside the shape (isIconFramed)
	const isImageTile = Boolean(content.iconUrl) && !content.isIconFramed;
	return (
		<div data-node-id={nodeId} data-tone={content.tone || undefined} data-shape={shape} title={[content.title, content.text].filter(Boolean).join(' — ')}
			className={`doc-card-mark${content.family ? ` is-${content.family}` : ''}${node.link ? ' is-link' : ''}`}>
			<span ref={anchorRef?.(CARD_MARK_ANCHOR)} className={`doc-card-mark-shape${isImageTile ? ' is-image' : ''}`} data-anchor-outline={isImageTile ? 'rect' : cardMarkOutlineOf(shape)} style={{ width: size, height: size }}>
				{isImageTile ? <img src={content.iconUrl} alt="" draggable={false} /> : <>
					{shape === 'cylinder' ? <CardMarkCylinder size={size} /> : null}
					{content.iconUrl
						? <img className="doc-card-mark-glyph" src={content.iconUrl} alt="" draggable={false} style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56) }} />
						: <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} aria-hidden="true" />}
				</>}
			</span>
			<span className="doc-card-mark-text">
				<span className="doc-card-mark-title">{content.title}</span>
				{content.text ? <span className="doc-card-mark-note">{content.text}</span> : null}
			</span>
			<span ref={anchorRef?.(CARD_MARK_ANCHOR_FOOT)} className="doc-card-mark-foot" style={{ width: size }} aria-hidden="true" />
		</div>
	);
});

// a cylinder filling a square mark: the walls at its sides, its caps ellipses as high as
// ANCHOR_CYLINDER_CAP of it, which is where a handle on its top or bottom is drawn
function CardMarkCylinder({ size }) {
	const inset = 1;
	const radiusX = size / 2 - inset;
	const radiusY = (size * ANCHOR_CYLINDER_CAP) / 2 - inset / 2;
	const top = radiusY + inset;
	const bottom = size - radiusY - inset;
	return (
		<svg className="doc-card-mark-cylinder" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
			<path className="doc-card-mark-cylinder-body" d={`M ${inset} ${top} V ${bottom} A ${radiusX} ${radiusY} 0 0 0 ${size - inset} ${bottom} V ${top}`} />
			<ellipse className="doc-card-mark-cylinder-top" cx={size / 2} cy={top} rx={radiusX} ry={radiusY} />
		</svg>
	);
}

// a kind drawn as a mark, for a series: its type and label, its shape, what a mark shows from the
// data of its node (contentGet, kept as contract.markContentGet), and what a kind has besides
// (propertyList, dataNormalize, searchMatch: the contract; create: the entry of the create panel)
export function cardMarkKindBuild({ type, label, shape, width, contentGet, create, ...contractExtra }) {
	const contract = cardMarkContractBuild({ shape, width, markContentGet: contentGet, ...contractExtra });
	const Card = observer(function CardMarkOfKind({ node, nodeId, anchorRef }) {
		return <CardMark node={node} nodeId={nodeId} anchorRef={anchorRef} content={contract.markContentGet(node.data ?? {}) ?? {}} shape={contract.markShape} />;
	});
	return { type, label, contract, schema: null, Card, ...(create ? { create } : {}) };
}

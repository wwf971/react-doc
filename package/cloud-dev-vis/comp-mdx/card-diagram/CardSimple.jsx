import { observer } from 'mobx-react-lite';
import { Boxes } from '../../../../main/frontend/UICommon.js';
import { CARD_SIMPLE_ANCHOR, CARD_SIMPLE_ANCHOR_FOOT, CARD_SIMPLE_CYLINDER_CAP, cardSimpleMarkSizeOf, cardSimpleOutlineOf, cardSimpleShapeOf } from './CardSimpleData.js';
import './CardSimple.css';

// A node drawn simple (card-diagram-impl.md#the-display-of-a-node): a mark with its name under it,
// whatever its kind, for a picture of a system at the level of an overview. What it shows is the
// kind's to say (contract.simple.contentGet); how it looks is the same for every kind, so a
// diagram drawn simple reads as one vocabulary of shapes.
//
//      ▢        the mark: the shape of the kind (a tile, a circle, a cylinder), its icon inside,
//    Title      the accent of its family or its tone. It is the anchor `mark`, on which every
//    a line     handle of the node is drawn, on its outline (CardSimpleData.js); a handle at the
//     ‾‾‾       bottom stands under the words, on the anchor `foot`, as wide as the mark
//
// The mark is as large as the node leaves it: its own size with a height left to the content,
// as large as fits above the words in a node drawn to a size.
export const CardSimple = observer(function CardSimple({ node, contract, anchorRef, nodeId, editor }) {
	const content = contract.simple.contentGet(node.data ?? {}) ?? {};
	const isSelected = Boolean(editor) && editor.store.selection?.nodeId === nodeId && !editor.store.selection.connectionId;
	const shape = cardSimpleShapeOf(contract);
	const size = cardSimpleMarkSizeOf(node.size);
	const Icon = content.Icon ?? Boxes;
	// an image is its own tile, unless it is a glyph to draw inside the shape (isIconFramed)
	const isImageTile = Boolean(content.iconUrl) && !content.isIconFramed;
	return (
		<div data-node-id={nodeId} data-tone={content.tone || undefined} data-shape={shape} title={[content.title, content.text].filter(Boolean).join(' — ')}
			className={`doc-card-simple${content.family ? ` is-${content.family}` : ''}${node.link ? ' is-link' : ''}${isSelected ? ' is-selected' : ''}`}>
			<span ref={anchorRef?.(CARD_SIMPLE_ANCHOR)} className={`doc-card-simple-mark${isImageTile ? ' is-image' : ''}`} data-anchor-outline={isImageTile ? 'rect' : cardSimpleOutlineOf(shape)} style={{ width: size, height: size }}>
				{isImageTile ? <img src={content.iconUrl} alt="" draggable={false} /> : <>
					{shape === 'cylinder' ? <CardSimpleCylinder size={size} /> : null}
					{content.iconUrl
						? <img className="doc-card-simple-glyph" src={content.iconUrl} alt="" draggable={false} style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56) }} />
						: <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} aria-hidden="true" />}
				</>}
			</span>
			<span className="doc-card-simple-text">
				<span className="doc-card-simple-title">{content.title}</span>
				{content.text ? <span className="doc-card-simple-note">{content.text}</span> : null}
			</span>
			<span ref={anchorRef?.(CARD_SIMPLE_ANCHOR_FOOT)} className="doc-card-simple-foot" style={{ width: size }} aria-hidden="true" />
		</div>
	);
});

// a cylinder filling a square mark: the walls at its sides, its caps ellipses as high as
// CARD_SIMPLE_CYLINDER_CAP of it, which is where a handle on its top or bottom is drawn
function CardSimpleCylinder({ size }) {
	const inset = 1;
	const radiusX = size / 2 - inset;
	const radiusY = (size * CARD_SIMPLE_CYLINDER_CAP) / 2 - inset / 2;
	const top = radiusY + inset;
	const bottom = size - radiusY - inset;
	return (
		<svg className="doc-card-simple-cylinder" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
			<path className="doc-card-simple-cylinder-body" d={`M ${inset} ${top} V ${bottom} A ${radiusX} ${radiusY} 0 0 0 ${size - inset} ${bottom} V ${top}`} />
			<ellipse className="doc-card-simple-cylinder-top" cx={size / 2} cy={top} rx={radiusX} ry={radiusY} />
		</svg>
	);
}

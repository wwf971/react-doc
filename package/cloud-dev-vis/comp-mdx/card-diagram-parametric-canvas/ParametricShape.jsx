import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { Shapes, Type } from '../../../../main/frontend/UICommon.js';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { DiagramRenderContext } from '../card-diagram/DiagramRender.jsx';
import { cardIconToken } from '../card-diagram/CardIconToken.jsx';
import { nodeSizeModeOf } from '../card-diagram/DiagramNodeResize.js';
import { shapeNormalize, shapePointListOf, shapePropertyList, shapeTextSearchMatch, textNodeNormalize, textNodePropertyList } from './ParametricShapeData.js';

// The kinds the parametric canvas brings to every registry listing it (node-registry.js: a feature's
// kindList; ParametricShapeData.js for their data): a shape, drawn to the size of its node, and a
// text, as wide as its words or wrapped at a width (its size mode). Their colors are the style of the node (DiagramNodeStyle.js), their
// words a cell of the cell editing kit, typed where they stand while the diagram is edited (a click
// on them; Enter or a click elsewhere keeps them, Escape puts them back), each a step of the history.

// the words of a shape or a text node: typed in place while edited, read otherwise. A text typed
// empty goes (a text node without words is nothing); a shape keeps its outline
function useWordsOf(node, editor, nodeId, isRemovedWhenEmpty) {
	const { config } = useContext(DiagramRenderContext);
	const cell = useCell({ tokenList: [cardIconToken], tokenIdList: [], config });
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	const isEditable = Boolean(editor) && !editor.isLocked && !editor.store.isStructureFixed && !node.isDerived;
	const commit = (text) => {
		if (!text.trim() && isRemovedWhenEmpty) editor.change(() => editor.store.nodeRemove(nodeId, editor.handlePositionGet));
		else editor.change(() => editor.store.nodeDataSet(nodeId, ['text'], text.trim() ? text : undefined));
	};
	const render = (className, placeholder) => (isEditable
		? <CellField as="span" className={`${className} nodrag nopan`} cell={cell} value={content.text ?? ''} isEditable onCommit={commit} fieldKey={`diagram-words:${nodeId}`} ariaLabel="The words" placeholder={placeholder} />
		: <span className={className}><CellValue cell={cell} text={content.text ?? ''} /></span>);
	return { content, isEditable, render };
}

export const ShapeCard = observer(function ShapeCard({ node, editor, nodeId }) {
	const { content, render } = useWordsOf(node, editor, nodeId, false);
	const pointList = shapePointListOf(content.shape);
	const strokeWidth = content.strokeWidth ?? 1.5;
	const outlineProps = { className: 'doc-param-shape-outline', vectorEffect: 'non-scaling-stroke', strokeWidth, strokeDasharray: content.isDashed ? `${Math.max(4, strokeWidth * 3)} ${Math.max(3, strokeWidth * 2)}` : undefined };
	return (
		<div data-node-id={nodeId} className="doc-param-shape" data-shape={content.shape} data-text-size={content.textSize ?? 'm'} onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<svg className="doc-param-shape-drawing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
				{pointList ? <polygon points={pointList.map(point => point.join(',')).join(' ')} {...outlineProps} />
					: content.shape === 'ellipse' ? <ellipse cx="50" cy="50" rx={50} ry={50} {...outlineProps} />
						: null}
			</svg>
			{/* a rectangle is a box of css: its corners keep their radius whatever its size */}
			{pointList || content.shape === 'ellipse' ? null : <span className="doc-param-shape-box" style={{ borderWidth: strokeWidth, borderStyle: content.isDashed ? "dashed" : "solid" }} />}
			<span className="doc-param-shape-words">{render('doc-param-shape-text', editor ? 'Words' : '')}</span>
</div>
	);
});

export const TextNodeCard = observer(function TextNodeCard({ node, editor, nodeId }) {
	const { content, render } = useWordsOf(node, editor, nodeId, true);
	return (
		<div data-node-id={nodeId} className="doc-param-text" data-size-mode={nodeSizeModeOf(node)} data-text-size={content.textSize ?? 'm'} data-weight={content.weight ?? 'normal'} data-align={content.align ?? 'left'} data-tone={content.tone || undefined} onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			{render('doc-param-text-words', 'Text')}
		</div>
	);
});

const sideAllList = ['left', 'right', 'top', 'bottom'];

export const shapeNodeKind = {
	type: 'shape',
	label: 'Shape',
	contract: {
		dataNormalize: shapeNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 160, height: 100 }, sizeMin: { width: 12, height: 12 },
		styleList: ['fill', 'stroke'], propertyList: shapePropertyList, searchMatch: shapeTextSearchMatch,
	},
	schema: null,
	Card: ShapeCard,
	create: {
		description: 'A rectangle, an ellipse, a diamond …, drawn to a size, with words inside.', icon: Shapes, keywordList: ['shape', 'rectangle', 'ellipse', 'circle', 'diamond', 'draw'],
		nodeCreate: idNext => ({ id: idNext('shape'), renderer: { type: 'shape' }, size: { width: 160, height: 100 }, data: { shape: 'rounded' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

export const textNodeKind = {
	type: 'text',
	label: 'Text',
	contract: {
		dataNormalize: textNodeNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		// its box (DiagramNodeResize.js: size modes): fits its words (no size, nothing to resize), or
		// a width they wrap at (its width resized, its height following); the edit card switches
		sizeDefault: { width: 120, height: 24 }, isWidthFit: true, sizeModeList: ['fit', 'wrap'],
		styleList: ['fill'], propertyList: textNodePropertyList, searchMatch: shapeTextSearchMatch,
	},
	schema: null,
	Card: TextNodeCard,
	create: {
		description: 'Words standing by themselves: a title, a remark.', icon: Type, keywordList: ['text', 'words', 'title', 'annotation', 'remark'],
		nodeCreate: idNext => ({ id: idNext('text'), renderer: { type: 'text' }, data: { text: 'Text' }, handles: [] }),
	},
};

export const parametricKindList = [shapeNodeKind, textNodeKind];

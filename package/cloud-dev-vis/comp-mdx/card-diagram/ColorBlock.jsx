import { useContext, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { GripVertical, Plus, Trash2 } from '../../../../main/frontend/UICommon.js';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { DiagramRenderContext } from './DiagramRender.jsx';
import { cardIconToken } from './CardIconToken.jsx';
import { cardIconTextStrip } from './CardIconTokenData.js';

const toneList = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];

// A color block (card-diagram-usage.md#background-color-blocks): a light rectangle behind cards,
// with labels at its bottom or its top, and columns inside it. The words of a label and of a column
// are a text of the cell editing kit (doc_page_impl_edit_cell.md): an icon is a token among them,
// `{{icon:database}} Source database` (CardIconToken.jsx), typed with /icon where the words are.
//
//   itemList?    [{ id, text, level?: 1 | 2 }]           the labels (none: a block without words);
//                                                       level: a title, on a line of its own
//   columnList   [{ id, x, width, text? }], columnTop      columns inside the block, in its own pixels
//
// What it is filled with and its edge are the style of the node (DiagramNodeStyle.js: style.fill,
// style.stroke): by default the tint and the edge of its tone; `style: { fill: none }` draws a frame
// around a group. The forms written before (the icon apart, `icon: database`; the fill in the data,
// `fill: none`) are refused, with what to write instead.
export function colorBlockNormalize(data) {
	if (data.tone !== undefined && !toneList.includes(data.tone)) throw new Error('A color block needs a supported tone.');
	if (data.itemList !== undefined && !Array.isArray(data.itemList)) throw new Error('A color block writes its labels as a list, itemList (none: no labels).');
	if (data.labelSide !== undefined && !['top', 'bottom'].includes(data.labelSide)) throw new Error('A color block places its labels at the top or the bottom.');
	if (data.fill !== undefined) throw new Error(`A color block writes its fill in the style of its node: style: { fill: ${data.fill === 'tint' ? 'blue' : String(data.fill)} } (beside data, not in it; no fill: the tint of its tone).`);
	const iconApartRefuse = (item, what) => {
		if (item.icon !== undefined) throw new Error(`A color block ${what} writes its icon in its text: text: '{{icon:${item.icon}}}${item.text ? ` ${item.text}` : ''}'.`);
	};
	if (data.columnList !== undefined) {
		if (!Array.isArray(data.columnList)) throw new Error('A color block needs columnList to be a list.');
		if (!Number.isFinite(data.columnTop)) throw new Error('A color block with columns needs columnTop: where they start.');
		const idColumnSet = new Set();
		for (const column of data.columnList) {
			if (!column || typeof column.id !== 'string' || !column.id.trim() || idColumnSet.has(column.id)) throw new Error('Every color block column needs a unique nonempty id.');
			if (!Number.isFinite(column.x) || !Number.isFinite(column.width)) throw new Error('A color block column needs x and width, inside the block.');
			iconApartRefuse(column, 'column');
			if (column.text !== undefined && typeof column.text !== 'string') throw new Error('Color block column text must be a string.');
			idColumnSet.add(column.id);
		}
	}
	const ids = new Set();
	for (const item of data.itemList ?? []) {
		if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Every color block label needs a unique nonempty id.');
		iconApartRefuse(item, 'label');
		if (typeof item.text !== 'string' || !item.text.trim()) throw new Error('A color block label needs a text (an icon is written in it: {{icon:database}}).');
		if (item.level !== undefined && ![1, 2].includes(item.level)) throw new Error('A color block label is a title of level 1 or 2, or has no level.');
		ids.add(item.id);
	}
	return data;
}

// what a search finds in a block: the words of its labels and its columns, never its icons
export function colorBlockSearchMatch(node, helper) {
	const textList = [...(node.data?.itemList ?? []), ...(node.data?.columnList ?? [])].map(item => cardIconTextStrip(item.text));
	return textList.some(text => helper.test(text)) ? { partList: [], childList: [], isWhole: true } : null;
}

// While the diagram is edited, the words of a label or a column are typed where they stand (a
// click on them; Enter or a click elsewhere keeps them, Escape puts them back): a label typed
// empty goes, a column keeps its place without words. The block selected shows a + at its corner,
// which opens a new label at the end of its labels, and a label under the pointer the floating
// button group of the edit layer (EditButtonGroup) above it: a grip dragging it to another place
// among the labels, and a button taking it away. A block may keep no label at all. Each is one step
// of the history; nothing of the group takes room, so the labels never move for it.
export const ColorBlock = observer(function ColorBlock({ node, editor, nodeId }) {
	const { config } = useContext(DiagramRenderContext);
	const cellStore = useContext(StoreContext)?.cellStore;
	// the cell of its words: icons are its own kind; the page's kinds (a link, an object) are not
	// offered, since a block takes no pointer while it is read
	const cell = useCell({ tokenList: [cardIconToken], tokenIdList: [], config });
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	const itemList = content.itemList ?? [];
	// while a label is dragged: where it would land among the labels (before that index)
	const [dropAt, dropAtSet] = useState(null);
	const labelsRef = useRef(null);
	// not typed where the draft keeps its structure (a scene made from data), nor in a copy of a block
	const isEditable = Boolean(editor) && !editor.isLocked && !editor.store.isStructureFixed && !node.isDerived;
	const isSelected = isEditable && editor.store.selection?.nodeId === nodeId && !editor.store.selection.connectionId;
	const keyOf = what => `color-block:${nodeId}:${what}`;
	const keyAdd = keyOf('label-add');
	const isAdding = Boolean(cellStore?.fieldIsOpen(keyAdd));
	const write = (keyPath, value) => editor.change(() => editor.store.nodeDataSet(nodeId, keyPath, value));
	const labelCommit = index => text => write(['itemList', index], text.trim() ? { ...itemList[index], text } : undefined);
	const labelMove = (indexFrom, indexTo) => {
		const list = [...itemList];
		const [item] = list.splice(indexFrom, 1);
		list.splice(indexTo, 0, item);
		write(['itemList'], list);
	};
	const labelRectListGet = () => Array.from(labelsRef.current?.querySelectorAll(':scope > .doc-color-block-label:not(.is-new)') ?? []).map(element => element.getBoundingClientRect());
	// the floating group of a label of the block selected: reorder, take away
	const labelBarOf = index => (isSelected ? (
		<EditButtonGroup className="doc-color-block-label-bar nodrag nopan" ariaLabel="Label"
			grip={{ Icon: GripVertical, axis: 'xy', title: 'Drag to reorder the label', isDisabled: itemList.length <= 1, reason: 'One label has no order.', indexFrom: index, rectListGet: labelRectListGet,
				onPreview: dropAtSet, onDrop: (indexTo) => { dropAtSet(null); if (indexTo !== index) labelMove(index, indexTo); } }}
			actionList={[{ id: 'remove', Icon: Trash2, title: 'Remove the label', isDanger: true, act: () => write(['itemList', index], undefined) }]} />
	) : null);
	const dropClassOf = index => (dropAt === index ? ' is-drop-before' : dropAt === itemList.length && index === itemList.length - 1 ? ' is-drop-after' : '');
	const columnCommit = index => (text) => {
		const { text: _text, ...column } = content.columnList[index];
		write(['columnList', index], text.trim() ? { ...column, text } : column);
	};
	const labelAdd = (text) => {
		if (!text.trim()) return;
		const idTakenSet = new Set(itemList.map(item => item.id));
		let id;
		do id = Math.random().toString(36).slice(2, 8); while (idTakenSet.has(id));
		write(['itemList'], [...itemList, { id, text }]);
	};
	// a click on the words of a label edits them, and the block is what is selected
	const select = isEditable ? () => editor.select(nodeId) : undefined;
	const textOf = (value, commit, key, ariaLabel) => (isEditable
		? <CellField as="span" className="doc-color-block-text nodrag nopan" cell={cell} value={value ?? ''} isEditable onCommit={commit} fieldKey={key} ariaLabel={ariaLabel} />
		: <span className="doc-color-block-text"><CellValue cell={cell} text={value ?? ''} /></span>);
	return (
		<div className={`doc-color-block${editor ? ' is-editable' : ''}`} data-tone={node.data.tone ?? 'slate'} data-label-side={node.data.labelSide ?? 'bottom'} data-fill={node.style?.fill === 'none' ? 'none' : undefined} onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<div ref={labelsRef} className={`doc-color-block-labels${dropAt !== null ? ' is-dragging' : ''}`}>
				{itemList.map((item, index) => (
					<span key={item.id} className={`doc-color-block-label${dropClassOf(index)}`} data-level={item.level} onClickCapture={select}>
						{textOf(item.text, labelCommit(index), keyOf(`label:${item.id}`), 'The words of the label')}
						{labelBarOf(index)}
					</span>
				))}
				{isAdding ? <span className="doc-color-block-label is-new">{textOf('', labelAdd, keyAdd, 'The words of a new label')}</span> : null}
			</div>
			{isSelected && !isAdding && cellStore ? (
				<button type="button" className="doc-button-icon doc-color-block-add nodrag nopan" title="Add a label (an icon among its words: /icon)" aria-label="Add a label" onClick={(event) => { event.stopPropagation(); cellStore.fieldOpen(keyAdd, ''); }}><Plus size={13} /></button>
			) : null}
			{(content.columnList ?? []).map((column, index) => (
				<div key={column.id} className={`doc-color-block-column${index > 0 ? ' has-divider' : ''}`} style={{ left: column.x, width: column.width, top: node.data.columnTop }}>
					<span className="doc-color-block-label" onClickCapture={select}>{textOf(column.text, columnCommit(index), keyOf(`column:${column.id}`), 'The words of the column')}</span>
				</div>
			))}
</div>
	);
});

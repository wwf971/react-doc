import { observer } from 'mobx-react-lite';
import { CARD_ICON_BY_NAME } from './CompactCard.jsx';

const toneList = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];

export function colorBlockNormalize(data) {
	if (data.tone !== undefined && !toneList.includes(data.tone)) throw new Error('A color block needs a supported tone.');
	if (!Array.isArray(data.itemList)) throw new Error('A color block needs itemList for its labels.');
	if (data.labelSide !== undefined && !['top', 'bottom'].includes(data.labelSide)) throw new Error('A color block places its labels at the top or the bottom.');
	if (data.fill !== undefined && !['tint', 'none'].includes(data.fill)) throw new Error('A color block is filled with its tint, or with none (fill: none, a frame).');
	if (data.columnList !== undefined) {
		if (!Array.isArray(data.columnList)) throw new Error('A color block needs columnList to be a list.');
		if (!Number.isFinite(data.columnTop)) throw new Error('A color block with columns needs columnTop: where they start.');
		const idColumnSet = new Set();
		for (const column of data.columnList) {
			if (!column || typeof column.id !== 'string' || !column.id.trim() || idColumnSet.has(column.id)) throw new Error('Every color block column needs a unique nonempty id.');
			if (!Number.isFinite(column.x) || !Number.isFinite(column.width)) throw new Error('A color block column needs x and width, inside the block.');
			if (column.text !== undefined && typeof column.text !== 'string') throw new Error('Color block column text must be a string.');
			if (column.icon !== undefined && !Object.hasOwn(CARD_ICON_BY_NAME, column.icon)) throw new Error('A color block column needs a supported icon.');
			idColumnSet.add(column.id);
		}
	}
	const ids = new Set();
	for (const item of data.itemList) {
		if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Every color block label needs a unique nonempty id.');
		if (item.text !== undefined && typeof item.text !== 'string') throw new Error('Color block label text must be a string.');
		if (item.icon !== undefined && !Object.hasOwn(CARD_ICON_BY_NAME, item.icon)) throw new Error('A color block label needs a supported icon.');
		if (!item.text && !item.icon) throw new Error('A color block label needs text or an icon.');
		if (item.level !== undefined && ![1, 2].includes(item.level)) throw new Error('A color block label is a title of level 1 or 2, or has no level.');
		ids.add(item.id);
	}
	return data;
}

export const ColorBlock = observer(function ColorBlock({ node, editor, nodeId }) {
	return (
		<div className={`doc-color-block${editor ? ' is-editable' : ''}`} data-tone={node.data.tone ?? 'slate'} data-label-side={node.data.labelSide ?? 'bottom'} data-fill={node.data.fill ?? 'tint'} onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<div className="doc-color-block-labels">
				{node.data.itemList.map((item) => {
					const Icon = CARD_ICON_BY_NAME[item.icon];
					return <span key={item.id} className="doc-color-block-label" data-level={item.level}>{Icon ? <Icon size={16} aria-hidden={item.text ? true : undefined} aria-label={item.text ? undefined : item.icon} /> : null}{item.text ? <span>{item.text}</span> : null}</span>;
				})}
			</div>
			{(node.data.columnList ?? []).map((column, index) => {
				const Icon = CARD_ICON_BY_NAME[column.icon];
				return (
					<div key={column.id} className={`doc-color-block-column${index > 0 ? ' has-divider' : ''}`} style={{ left: column.x, width: column.width, top: node.data.columnTop }}>
						<span className="doc-color-block-label">{Icon ? <Icon size={16} aria-hidden="true" /> : null}{column.text ? <span>{column.text}</span> : null}</span>
					</div>
				);
			})}
		</div>
	);
});
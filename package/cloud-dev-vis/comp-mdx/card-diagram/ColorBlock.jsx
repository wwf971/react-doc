import { observer } from 'mobx-react-lite';
import { CARD_ICON_BY_NAME } from './CompactCard.jsx';

const toneList = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];

export function colorBlockNormalize(data) {
	if (data.tone !== undefined && !toneList.includes(data.tone)) throw new Error('A color block needs a supported tone.');
	if (!Array.isArray(data.itemList)) throw new Error('A color block needs itemList for its bottom labels.');
	const ids = new Set();
	for (const item of data.itemList) {
		if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Every color block label needs a unique nonempty id.');
		if (item.text !== undefined && typeof item.text !== 'string') throw new Error('Color block label text must be a string.');
		if (item.icon !== undefined && !Object.hasOwn(CARD_ICON_BY_NAME, item.icon)) throw new Error('A color block label needs a supported icon.');
		if (!item.text && !item.icon) throw new Error('A color block label needs text or an icon.');
		ids.add(item.id);
	}
	return data;
}

export const ColorBlock = observer(function ColorBlock({ node, editor, nodeId }) {
	return (
		<div className={`doc-color-block${editor ? ' is-editable' : ''}`} data-tone={node.data.tone ?? 'slate'} onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<div className="doc-color-block-labels">
				{node.data.itemList.map((item) => {
					const Icon = CARD_ICON_BY_NAME[item.icon];
					return <span key={item.id} className="doc-color-block-label">{Icon ? <Icon size={16} aria-hidden={item.text ? true : undefined} aria-label={item.text ? undefined : item.icon} /> : null}{item.text ? <span>{item.text}</span> : null}</span>;
				})}
			</div>
		</div>
	);
});
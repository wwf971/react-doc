import { observer } from 'mobx-react-lite';
import { useDiagramSearchMark } from './DiagramRender.jsx';
import { CARD_INDEX_GAP, CARD_INDEX_ITEM_HEIGHT, CARD_INDEX_ITEM_WIDTH, cardIndexItemOf } from './CardIndexData.js';

// An index (CardIndexData.js): groups of small cards of two names, each opening what it stands
// for on a canvas that switches (data-switch-link). Plain elements, not nodes: thousands are drawn
// at the cost of one card
export const CardIndex = observer(function CardIndex({ node, nodeId }) {
	const { data } = node;
	const searchMark = useDiagramSearchMark(nodeId);
	const itemWidth = data.itemWidth ?? CARD_INDEX_ITEM_WIDTH;
	const gridStyle = { gridTemplateColumns: `repeat(${data.columnCount}, ${itemWidth}px)`, gridAutoRows: CARD_INDEX_ITEM_HEIGHT, gap: CARD_INDEX_GAP };
	return (
		<div data-node-id={nodeId} className="doc-card-index">
			{data.title ? <div className="doc-card-index-title">{data.title}</div> : null}
			{data.groupList.map((group) => (
				<section key={group.id} className="doc-card-index-group">
					{group.title || group.note ? (
						<div className="doc-card-index-head">
							{group.title ? <span className="doc-card-index-head-title">{group.title}</span> : null}
							{group.note ? <span className="doc-card-index-head-note">{group.note}</span> : null}
						</div>
					) : null}
					<div className="doc-card-index-grid" style={gridStyle}>
						{group.itemList.map((one) => {
							const item = cardIndexItemOf(group, one);
							return (
								<div key={item.id} className={`doc-card-note doc-card-index-item${item.link ? ' is-link' : ''}`} data-tone={item.tone || 'slate'} data-variant={item.variant || undefined}
									data-search-part={`item/${group.id}/${item.id}`} data-search={searchMark.partStateOf(`item/${group.id}/${item.id}`) ?? undefined} title={item.text ? `${item.title} (${item.text})` : item.title} {...(item.link ? { 'data-switch-link': item.link } : {})}>
									<span className="doc-card-note-title">{item.title}</span>
									{item.text ? <span className="doc-card-index-text">{item.text}</span> : null}
								</div>
							);
						})}
					</div>
				</section>
			))}
		</div>
	);
});

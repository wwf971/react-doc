import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { CardStandaloneStore } from './CardStandaloneStore.js';
import { DiagramVisualEdit } from './DiagramVisualEdit.jsx';
import { cardSchemaGet } from './TableCardSchema.js';

// One card in the flow of the document, without a canvas
// (card-diagram-impl.md#standalone-cards): the card of a kind of the node registry
// of its component type, read and edited like a node of a diagram. A series
// makes its standalone card component with cardStandaloneCompCreate(registry,
// title). Both modes render inside BlockPopupSurface: the card opens in the
// block popup and is edited there; the surface's outer box carries the
// block's margins (doc_page_impl_mdx_comp_block.md).
function CardStandaloneBase({ data = {}, config = {}, onEvent, registry, titleDefault }) {
	return (
		<BlockPopupSurface config={config} title={data.title || titleDefault} className="doc-vis-card-shell not-prose">
			{({ isInPopup }) => (config.isEdit && config.edit?.modeId === 'visual'
				? <DiagramVisualEdit data={data} config={config} onEvent={onEvent} kind="card" registry={registry} isInPopup={isInPopup} renderContent={props => <CardStandaloneView {...props} registry={registry} isInPopup={isInPopup} />} />
				: <CardStandaloneView data={data} registry={registry} isInPopup={isInPopup} />)}
		</BlockPopupSurface>
	);
}

// the standalone card component of a node registry; titleDefault names the
// block in its popup when the data has no title
export function cardStandaloneCompCreate(registry, name, titleDefault = 'Card') {
	const CompRender = props => <CardStandaloneBase {...props} registry={registry} titleDefault={titleDefault} />;
	CompRender.displayName = name;
	return CompRender;
}

const CardStandaloneView = observer(function CardStandaloneView({ data = {}, registry, editor, isInPopup = false }) {
	const source = data.source || data.raw || '';
	const [store] = useState(() => new CardStandaloneStore(source, registry));

	useEffect(() => {
		if (store.source !== source) store.sourceLoad(source);
	}, [source, store]);

	if (store.loadState.status === 'error') {
		return (
			<div className="doc-er-diagram-message is-error" role="alert">
				<strong>The card definition could not be read.</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done' || !store.entity) {
		return <div className="doc-er-diagram-message">The card definition is empty.</div>;
	}

	const node = store.node;
	const { Card } = registry.kindByType[node.renderer.type];
	const width = node.size.width === 'auto' ? node.sizeDefault.width : node.size.width;
	return (
		<figure className={`doc-vis-card-static${isInPopup ? ' is-popup' : ''}`} aria-label={`Card ${node.data.name ?? node.id}`}
			style={{ width, height: node.size.height === 'auto' ? 'auto' : node.size.height }}>
			<div style={{ width }}>
				<Card node={node} schema={cardSchemaGet(node, registry)} editor={editor} nodeId={node.id} />
			</div>
		</figure>
	);
});

export { CardStandaloneBase };

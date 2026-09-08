import { yamlParse } from '../../frontend/src/lib/yaml.js';
import { CardLink } from './CardLink.jsx';
import './ref-card.css';

function CardGrid({ data = {}, config = {}, onEvent }) {
	const raw = data.raw ?? '';
	if (!raw.trim()) return <div className="doc-mdx-card-grid">{data.content}</div>;

	try {
		const dataGrid = yamlParse(raw);
		const cards = Array.isArray(dataGrid) ? dataGrid : dataGrid?.cards;
		const type = Array.isArray(dataGrid) ? data.type : dataGrid?.type ?? data.type;
		if (!Array.isArray(cards)) throw new Error('Expected a cards list.');

		return (
			<div className="doc-mdx-card-grid">
				{cards.map((card, index) => (
					<CardLink
						key={`${card.target ?? card.title ?? 'card'}-${index}`}
						data={{ ...card, type: card.type ?? type }}
						config={{ ...config, instanceId: `${config.instanceId}:card:${index}` }}
						onEvent={onEvent}
					/>
				))}
			</div>
		);
	} catch (error) {
		return (
			<div className="doc-mdx-card-grid-error" role="alert">
				Failed to read card data: {String(error?.message ?? error)}
			</div>
		);
	}
}

export { CardGrid };

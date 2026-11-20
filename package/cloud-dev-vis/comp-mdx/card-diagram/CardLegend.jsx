import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { CARD_LEGEND_TRANSLUCENT_DEFAULT, cardLegendTranslucentRead, cardLegendTranslucentWrite } from './CardLegendData.js';

// A legend (CardLegendData.js): a card or a line as the diagram draws it, and what it stands for
function LegendLine({ line }) {
	const width = line.width ?? 1.5;
	return (
		<svg className="doc-card-legend-line" width="40" height="12" viewBox="0 0 40 12" aria-hidden="true" opacity={line.opacity ?? undefined}>
			<line x1="2" y1="6" x2={line.isArrow ? 31 : 38} y2="6" stroke={line.color} strokeWidth={width} strokeDasharray={line.dash || undefined} />
			{line.isArrow ? <path d="M30 2 L38 6 L30 10 Z" fill={line.color} /> : null}
		</svg>
	);
}

// a legend folds to its title line, so one pinned over a canvas (node.pin) leaves the canvas free;
// it may let the diagram show through (data.opacity, else the reader's choice: the button beside
// the fold, remembered for every legend)
export const CardLegend = observer(function CardLegend({ node, nodeId }) {
	const { data } = node;
	const [isFolded, isFoldedSet] = useState(Boolean(data.isFolded));
	const [chosen, chosenSet] = useState(cardLegendTranslucentRead);
	const isTranslucent = chosen ?? (data.opacity ?? 1) < 1;
	const opacity = isTranslucent ? (data.opacity !== undefined && data.opacity < 1 ? data.opacity : CARD_LEGEND_TRANSLUCENT_DEFAULT) : 1;
	const translucentToggle = (event) => {
		event.stopPropagation();
		cardLegendTranslucentWrite(!isTranslucent);
		chosenSet(!isTranslucent);
	};
	return (
		<div data-node-id={nodeId} className={`doc-card-legend${isFolded ? ' is-folded' : ''}${opacity < 1 ? ' is-translucent' : ''}`} style={opacity < 1 ? { '--doc-card-legend-opacity': opacity } : undefined}>
			<div className="doc-card-legend-title">
				<span>{data.title ?? 'Legend'}</span>
				<span className="doc-card-legend-tool">
					<button type="button" className="doc-card-legend-fold nodrag nopan" aria-pressed={isTranslucent} title={isTranslucent ? 'Make the legend opaque' : 'Let the diagram show through the legend'} onClick={translucentToggle}>{isTranslucent ? '◐' : '●'}</button>
					<button type="button" className="doc-card-legend-fold nodrag nopan" aria-expanded={!isFolded} title={isFolded ? 'Show the legend' : 'Fold the legend'} onClick={(event) => { event.stopPropagation(); isFoldedSet(!isFolded); }}>{isFolded ? '▸' : '▾'}</button>
				</span>
			</div>
			{isFolded ? null : data.groupList.map((group) => (
				<section key={group.id} className="doc-card-legend-group">
					{group.title ? <div className="doc-card-legend-head">{group.title}</div> : null}
					{group.itemList.map((item) => (
						<div key={item.id} className="doc-card-legend-item">
							{item.swatch ? <span className="doc-card-note doc-card-legend-swatch" data-tone={item.swatch.tone} data-variant={item.swatch.variant || undefined} aria-hidden="true" /> : <LegendLine line={item.line} />}
							<span className="doc-card-legend-label">{item.label}</span>
						</div>
					))}
				</section>
			))}
		</div>
	);
});

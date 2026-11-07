import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { CARD_MATRIX_CELL_SIZE, CARD_MATRIX_ROW_HEAD_WIDTH, cardMatrixCellOf } from './CardMatrixData.js';

// data-switch-link: what a click on this part of a card opens, on a canvas that switches
// scenes (card-diagram-flexible-switch.md). this card knows nothing of that layer.
const linkPropsOf = (item) => (item.link ? { 'data-switch-link': item.link } : {});

export const CardMatrix = observer(function CardMatrix({ node, nodeId }) {
	const { data } = node;
	const rowList = data.rowList ?? [];
	const columnList = data.columnList ?? [];
	const cellOf = useMemo(() => cardMatrixCellOf(data), [data]);
	const cellSize = data.cellSize ?? CARD_MATRIX_CELL_SIZE;
	const style = { '--doc-card-matrix-cell': `${cellSize}px`, '--doc-card-matrix-row-head': `${data.rowHeadWidth ?? CARD_MATRIX_ROW_HEAD_WIDTH}px` };
	return (
		<div data-node-id={nodeId} data-tone={data.tone || 'blue'} className={`doc-er-table doc-card-matrix is-head-${data.columnHeadDirection ?? 'vertical'}`} style={style}>
			{data.title ? (
				<div className="doc-er-table-title">
					<span className="doc-er-table-title-name">{data.title}</span>
					{data.subtitle ? <span className="doc-er-table-title-logical">{data.subtitle}</span> : null}
				</div>
			) : null}
			<div className="doc-card-matrix-body">
			<table className="doc-card-matrix-table">
				<colgroup>
					<col className="doc-card-matrix-col-head" />
					{columnList.map((column) => <col key={column.id} className="doc-card-matrix-col" />)}
				</colgroup>
				<thead>
					<tr>
						<th scope="col" className="doc-card-matrix-corner">
							{data.columnAxisLabel ? <span className="doc-card-matrix-axis is-column">{data.columnAxisLabel} →</span> : null}
							{data.rowAxisLabel ? <span className="doc-card-matrix-axis is-row">{data.rowAxisLabel} ↓</span> : null}
						</th>
						{columnList.map((column) => (
							<th key={column.id} scope="col" data-tone={column.tone || undefined} title={column.label} className={`doc-card-matrix-column${column.link ? ' is-link' : ''}`} {...linkPropsOf(column)}>
								<span>{column.label}</span>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rowList.map((row) => (
						<tr key={row.id}>
							<th scope="row" data-tone={row.tone || undefined} title={row.label} className={`doc-card-matrix-row${row.link ? ' is-link' : ''}`} {...linkPropsOf(row)}>{row.label}</th>
							{columnList.map((column) => {
								const cell = cellOf(row.id, column.id);
								return (
									<td key={column.id} title={cell?.title} className={`doc-card-matrix-cell${data.isDiagonalMarked && row.id === column.id ? ' is-diagonal' : ''}${cell?.link ? ' is-link' : ''}`} {...(cell ? linkPropsOf(cell) : {})}>
										{cell ? <span className="doc-card-matrix-dot" /> : null}
										{cell?.mark !== undefined ? <span className="doc-card-matrix-mark">{cell.mark}</span> : null}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
			</div>
		</div>
	);
});

import { observer } from 'mobx-react-lite';
import {
	Archive, ArrowRightLeft, Ellipsis, EllipsisVertical, Boxes, Check, CircleAlert, Cloud, Database, FileCheck, FileSpreadsheet, FileText, Filter, Hash, Key, Layers, Link, ListChecks, RefreshCw, Search, Send, Server, ShieldCheck, Split, Table2, TriangleAlert, Waypoints, Workflow, Zap,
} from '../../../../main/frontend/UICommon.js';
import { CardCell } from './TableCard.jsx';

// The compact cards of the base series (card-diagram-impl.md#compact-cards), for
// diagrams of many cards read at a glance:
//
//   card-note    [ T4 L hard          ]   data: title, tag?, isTagHard?, text?, tone?,
//                [ text               ]         metaList?: [{ value, label }]
//                [ 8h 02m   2         ]
//   card-brief   ( ◉ Title            )   data: title, icon?, tone?, statList?: [text]
//                (   a figure  a figure)
//
//   card-database  a cylinder with its name inside: the drawing someone makes of a database.
//                data: title, text?, tone?
//
// an icon is named by a word of ICON_BY_NAME; tone: blue, teal, green, amber, red,
// violet, slate. a value is typed through CardCell, as in every card
export const CARD_ICON_BY_NAME = {
	archive: Archive, 'arrow-right-left': ArrowRightLeft, boxes: Boxes, check: Check, alert: CircleAlert, cloud: Cloud, database: Database, 'file-check': FileCheck,
	'file-spreadsheet': FileSpreadsheet, file: FileText, filter: Filter, hash: Hash, key: Key, layers: Layers, link: Link, 'list-checks': ListChecks, refresh: RefreshCw,
	search: Search, send: Send, server: Server, shield: ShieldCheck, split: Split, table: Table2, warning: TriangleAlert, waypoints: Waypoints, workflow: Workflow, zap: Zap,
};

export const CardNote = observer(function CardNote({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	return (
		<div data-node-id={nodeId} data-tone={node.data.tone || 'slate'} className="doc-card-note" onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<div className="doc-card-note-head">
				<span className="doc-card-note-title"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'title', kind: 'text', label: 'Title' }} value={content.title ?? ''}>{node.data.title}</CardCell></span>
				{node.data.tag ? <span className={`doc-card-note-tag${node.data.isTagHard ? ' is-hard' : ''}`}>{node.data.tag}</span> : null}
			</div>
			{node.data.text || editor ? <div className="nodrag nopan"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'text', kind: 'text', label: 'Text' }} value={content.text ?? ''}>{node.data.text}</CardCell></div> : null}
			{node.data.metaList?.length ? (
				<div className="doc-card-note-meta">
					{node.data.metaList.map((meta, index) => <span key={index}><strong>{meta.value}</strong><em>{meta.label}</em></span>)}
				</div>
			) : null}
		</div>
	);
});

export const CardBrief = observer(function CardBrief({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	const Icon = CARD_ICON_BY_NAME[node.data.icon] ?? Boxes;
	return (
		<div data-node-id={nodeId} data-tone={node.data.tone || 'teal'} className="doc-card-brief" onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<span className="doc-card-brief-icon"><Icon size={14} aria-hidden="true" /></span>
			<span className="doc-card-brief-text">
				<span className="doc-card-brief-title"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'title', kind: 'text', label: 'Title' }} value={content.title ?? ''}>{node.data.title}</CardCell></span>
				{node.data.statList?.length ? <span className="doc-card-brief-stat">{node.data.statList.map((stat, index) => <span key={index}>{stat}</span>)}</span> : null}
			</span>
		</div>
	);
});

const CARD_DATABASE_WIDTH = 320;
const CARD_DATABASE_HEIGHT = 260;
const numberOr = (value, fallback) => (typeof value === 'number' ? value : fallback);

// as large as fits the width of the cylinder, wide letters counting more than narrow ones
export function cardDatabaseFontSizeOf(title, width, height) {
	const length = [...String(title ?? '')].reduce((sum, letter) => sum + (letter.charCodeAt(0) > 0x2e7f ? 1 : 0.62), 0);
	return Math.max(12, Math.min(height * 0.2, (width * 0.78) / Math.max(1, length)));
}

// drawn at the size of its node, so the ends of the cylinder stay ellipses at any proportion
export const CardDatabase = observer(function CardDatabase({ node, nodeId }) {
	const width = numberOr(node.size?.width, CARD_DATABASE_WIDTH);
	const height = numberOr(node.size?.height, CARD_DATABASE_HEIGHT);
	const inset = 1.5;
	const radiusX = width / 2 - inset;
	const radiusY = Math.min(height * 0.13, width * 0.16);
	const left = inset;
	const right = width - inset;
	const top = radiusY + inset;
	const bottom = height - radiusY - inset;
	const arc = (y) => `M ${left} ${y} A ${radiusX} ${radiusY} 0 0 0 ${right} ${y}`;
	return (
		<div data-node-id={nodeId} data-tone={node.data.tone || 'slate'} className="doc-card-database" style={{ height }}>
			<svg className="doc-card-database-drawing" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
				<path className="doc-card-database-body" d={`M ${left} ${top} V ${bottom} A ${radiusX} ${radiusY} 0 0 0 ${right} ${bottom} V ${top}`} />
				<path className="doc-card-database-band" d={arc(top + (bottom - top) * 0.16)} />
				<path className="doc-card-database-band" d={arc(top + (bottom - top) * 0.84)} />
				<ellipse className="doc-card-database-top" cx={width / 2} cy={top} rx={radiusX} ry={radiusY} />
			</svg>
			<div className="doc-card-database-text" style={{ top: top + radiusY, bottom: height - bottom - radiusY * 0.2 }}>
				<span className="doc-card-database-title" style={{ fontSize: cardDatabaseFontSizeOf(node.data.title, width, height) }}>{node.data.title}</span>
				{node.data.text ? <span className="doc-card-database-note">{node.data.text}</span> : null}
			</div>
		</div>
	);
});

// what is left out between two cards of a long series: three dots, up to down or left
// to right (data.direction), and how many
export const CardThreeDots = observer(function CardThreeDots({ node, nodeId }) {
	const Icon = node.data.direction === 'horizontal' ? Ellipsis : EllipsisVertical;
	return (
		<div data-node-id={nodeId} data-tone={node.data.tone || 'slate'} className="doc-card-three-dots">
			<Icon size={22} aria-hidden="true" />
			{node.data.text ? <span className="doc-card-three-dots-text">{node.data.text}</span> : null}
		</div>
	);
});

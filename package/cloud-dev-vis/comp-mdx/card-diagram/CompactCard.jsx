import { observer } from 'mobx-react-lite';
import {
	Archive, ArrowRightLeft, Boxes, Check, CircleAlert, Cloud, Database, FileCheck, FileSpreadsheet, FileText, Filter, Hash, Key, Layers, Link, ListChecks, RefreshCw, Search, Send, Server, ShieldCheck, Split, Table2, TriangleAlert, Waypoints, Workflow, Zap,
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
// an icon is named by a word of ICON_BY_NAME; tone: blue, teal, green, amber, red,
// violet, slate. a value is typed through CardCell, as in every card
const ICON_BY_NAME = {
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
	const Icon = ICON_BY_NAME[node.data.icon] ?? Boxes;
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

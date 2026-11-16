import { observer } from 'mobx-react-lite';
import { Book, ListChecks, StickyNote } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild } from '../../../cloud-dev-vis/comp-mdx/card-diagram/node-registry.js';
import { cardDiagramNodeRegistry } from '../../../cloud-dev-vis/comp-mdx/card-diagram/card-diagram-node-registry.js';
import { switchRegistryBuild } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchNodeKinds.jsx';
import { zettelArrangerConnection, zettelArrangerFlow, zettelMiniHeightEstimate } from './ZettelArrange.js';

// The node kinds a zettelkasten draws its scenes with (doc/README.md#the-connection-view), in the
// registry of the package cloud-dev-vis (card-diagram.md#adding-a-kind):
//
//   zettel-card    a zettel as a small card: the same title bar as the zettel itself (its icon,
//                  its title), its summary under it, a key on the left of the bar when it is a
//                  member of a list, an array or a map. three sizes: compact (the bar alone),
//                  normal (the bar and two or three lines), center (the zettel the view is about)
//   zettel-frame   what a place of the view holds (contained by, contains, back links, a group):
//                  a frame around those cards, named in its corner, that a line may end on
//
// ZettelMiniCard is the card alone, also drawn by ZettelNode, a zettel on any card diagram.

const KIND_ICON = { zettel: Book, question: ListChecks, note: StickyNote };

// size: compact | normal | center. keyList: [{ text, tone }], the keys or indexes a member stands
// at in its group (tone green or red: the verdict of an option once shown). statList:
// [{ value, label }] at the foot
export function ZettelMiniCard({ title, kind = 'zettel', tag = '', tone = 'slate', text = '', size = 'normal', keyList = [], statList = [], isMissing = false, nodeId, onClick, role, titleHover }) {
	const Icon = KIND_ICON[kind] ?? Book;
	return (
		<div className="zettel-mini" data-node-id={nodeId} data-kind={kind} data-tone={tone} data-size={size} data-missing={isMissing ? '' : undefined} role={role} title={titleHover} onClick={onClick}>
			<div className="zettel-mini-bar">
				{keyList.length > 0 ? <span className="zettel-mini-key-list">{keyList.map((one, index) => <span key={index} className="zettel-mini-key" data-tone={one.tone || undefined}>{one.text}</span>)}</span> : null}
				<Icon className="zettel-mini-icon" size={size === 'center' ? 14 : 12} aria-hidden="true" />
				<span className="zettel-mini-title">{title}</span>
				{tag ? <span className="zettel-mini-tag">{tag}</span> : null}
			</div>
			{text && size !== 'compact' ? <div className="zettel-mini-text">{text}</div> : null}
			{statList.length > 0 && size !== 'compact' ? (
				<div className="zettel-mini-stat">{statList.map((stat, index) => <span key={index}><strong>{stat.value}</strong> {stat.label}</span>)}</div>
			) : null}
		</div>
	);
}

const ZettelCardNode = observer(function ZettelCardNode({ node, nodeId }) {
	const data = node.data;
	return <ZettelMiniCard nodeId={nodeId} title={data.title} kind={data.kind} tag={data.tag} tone={data.tone} text={data.text} size={data.size} keyList={data.keyList ?? []} statList={data.statList ?? []} isMissing={data.isMissing === true} titleHover={data.hover || undefined} />;
});

// the frame of a place: its name, how many it holds, and the form of a group (list, array, map)
const ZettelFrameNode = observer(function ZettelFrameNode({ node }) {
	const data = node.data;
	return (
		<div className="zettel-frame" data-tone={data.tone || 'slate'} data-place={data.place}>
			<span className="zettel-frame-label">
				<span>{data.label}</span>
				{data.count ? <em>{data.count}</em> : null}
				{data.form ? <span className="zettel-frame-form">{data.form}</span> : null}
			</span>
		</div>
	);
});

const sideAllList = ['left', 'right', 'top', 'bottom'];

const zettelDataNormalize = (data) => {
	if (typeof data.title !== 'string') throw new Error('A zettel card needs a title.');
	if (data.size !== undefined && !['compact', 'normal', 'center'].includes(data.size)) throw new Error('A zettel card is compact, normal or center.');
	return data;
};

export const zettelCardNodeKind = {
	type: 'zettel-card',
	label: 'Zettel',
	contract: {
		dataNormalize: zettelDataNormalize,
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 220, height: 34 },
		sizeEstimate: (node) => ({ height: zettelMiniHeightEstimate(node) }),
		searchMatch: (node, helper) => (helper.test(`${node.data.title} ${node.data.text ?? ''}`) ? { isWhole: true } : null),
	},
	schema: null,
	Card: ZettelCardNode,
};

export const zettelFrameNodeKind = {
	type: 'zettel-frame',
	label: 'Zettel frame',
	contract: { isBackground: true, anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault: { width: 300, height: 200 }, searchMatch: () => null },
	schema: null,
	Card: ZettelFrameNode,
};

// the base kinds, the kinds of the switching layer, and these two, with the arrangers the scenes
// of a zettelkasten are laid out by
const zettelBaseRegistry = nodeRegistryBuild({
	id: 'zettelkasten',
	label: 'Zettelkasten',
	kindList: [...cardDiagramNodeRegistry.kindList, zettelCardNodeKind, zettelFrameNodeKind],
	arrangerList: [...cardDiagramNodeRegistry.arrangerList, zettelArrangerConnection, zettelArrangerFlow],
});
export const zettelSwitchRegistry = switchRegistryBuild(zettelBaseRegistry);

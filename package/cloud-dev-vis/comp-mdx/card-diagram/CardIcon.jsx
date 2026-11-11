import { observer } from 'mobx-react-lite';
import { Boxes } from '../../../../main/frontend/UICommon.js';
import { CARD_ICON_BY_NAME } from './CompactCard.jsx';
import { CARD_ICON_MARK_SIZE, CARD_ICON_MARK_SIZE_FOCUS } from './CardIconData.js';
import './CardIcon.css';

// The icon node of the base series (card-diagram-impl.md#icon-nodes): something among many, drawn
// as a small round mark with its words beside it, for a graph of things rather than of contents.
// It says what a thing is and how it stands; what the thing holds is another scene.
//
//   card-icon     ( ◉ ) Title          data: title, text?, icon?, tone?, statusTone?,
//                       a line of text       labelSide?: right (default) | bottom,
//                                            isFocus?, isGhost?, isLabelHidden?, badge?, isBadgeUnder?
//   card-caption  WORDS OVER A GROUP   data: text
//
// icon: a word of CARD_ICON_BY_NAME. tone: the colors of the compact cards. statusTone: a dot on
// the mark, the state of the thing (green, amber, red, blue, slate). isFocus: the one the graph is
// about, larger and filled. isGhost: a thing that is not there yet (a dashed mark: add one).
// badge: a word marking what sort of thing it is (EXAMPLE), small capitals after the title; with
// isBadgeUnder, before the line of text instead, so a narrow node keeps its width for its title.
// Two anchors: `icon`, the mark, where the lines of a graph end; `body`, the whole node.
export const CardIcon = observer(function CardIcon({ node, nodeId, anchorRef }) {
	const { title, text, icon, tone, statusTone, labelSide, isFocus, isGhost, isLabelHidden, badge, isBadgeUnder } = node.data;
	const Icon = CARD_ICON_BY_NAME[icon] ?? Boxes;
	const size = isFocus ? CARD_ICON_MARK_SIZE_FOCUS : CARD_ICON_MARK_SIZE;
	return (
		<div data-node-id={nodeId} data-tone={tone || 'slate'} title={[title, text].filter(Boolean).join(' — ')}
			className={`doc-card-icon is-label-${labelSide === 'bottom' ? 'bottom' : 'right'}${isFocus ? ' is-focus' : ''}${isGhost ? ' is-ghost' : ''}${node.link ? ' is-link' : ''}`}>
			<span ref={anchorRef?.('icon')} className="doc-card-icon-mark" style={{ width: size, height: size }}>
				<Icon size={Math.round(size * 0.54)} aria-hidden="true" />
				{statusTone ? <i className="doc-card-icon-status" data-tone={statusTone} /> : null}
			</span>
			{isLabelHidden ? null : (
				<span className="doc-card-icon-text">
					<span className="doc-card-icon-head"><span className="doc-card-icon-title">{title}</span>{badge && !isBadgeUnder ? <span className="doc-card-icon-badge">{badge}</span> : null}</span>
					{text || (badge && isBadgeUnder) ? <span className="doc-card-icon-under">{badge && isBadgeUnder ? <span className="doc-card-icon-badge">{badge}</span> : null}{text ? <span className="doc-card-icon-note">{text}</span> : null}</span> : null}
				</span>
			)}
		</div>
	);
});

export const CardCaption = observer(function CardCaption({ node, nodeId }) {
	return <div data-node-id={nodeId} className="doc-card-caption">{node.data.text}</div>;
});

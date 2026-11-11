// What a diagram may assume about an icon node (CardIcon.jsx), apart from how it is drawn: the
// size of its mark, and where its anchors are in a node of a known size, for an arranger with
// nothing drawn to ask (card-diagram-arrange.md#the-contract).
export const CARD_ICON_MARK_SIZE = 26;
export const CARD_ICON_MARK_SIZE_FOCUS = 32;

const sideAllList = ['left', 'right', 'top', 'bottom'];
const toneList = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];

export function cardIconNormalize(data) {
	if (data.labelSide !== undefined && !['right', 'bottom'].includes(data.labelSide)) throw new Error('card-icon: labelSide is right or bottom.');
	for (const key of ['tone', 'statusTone']) {
		if (data[key] !== undefined && data[key] !== '' && !toneList.includes(data[key])) throw new Error(`card-icon: ${key} is one of ${toneList.join(', ')}.`);
	}
	return data;
}

export const cardIconAnchorListGet = () => [{ id: 'body', sideList: sideAllList }, { id: 'icon', sideList: sideAllList }];

// the rectangle of an anchor in the rectangle of its node
export function cardIconAnchorRectEstimate(node, anchorId, rect) {
	if (anchorId !== 'icon') return rect;
	const size = node.data?.isFocus ? CARD_ICON_MARK_SIZE_FOCUS : CARD_ICON_MARK_SIZE;
	if (node.data?.labelSide === 'bottom') return { x: rect.x + (rect.width - size) / 2, y: rect.y, width: size, height: size };
	return { x: rect.x, y: rect.y + (rect.height - size) / 2, width: size, height: size };
}

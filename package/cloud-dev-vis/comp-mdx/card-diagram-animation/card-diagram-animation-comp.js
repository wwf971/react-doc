import { Film } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { CardDiagramAnimation } from './CardDiagramAnimation.jsx';
import { animationSourceDefaultCreate } from './AnimationSource.js';

// What an animation exposes (compDefine expose): a block that opens in the popup,
// asset-backed like a diagram, edited as its source. A click in the viewport pans,
// so only the Edit button opens the editor.
export function cardDiagramAnimationDefineOptionsBuild({ label, description, sourceDefaultCreate = animationSourceDefaultCreate }) {
	return {
		placementList: ['mdx', 'commentBlock'],
		isAssetAware: true,
		expose: {
			meta: { isEditAssetAccepted: true, isEditEnterButtonOnly: true, label, description },
			icon: Film,
			sourceDefaultCreate,
		},
	};
}

export const cardDiagramAnimationDefine = compDefine(CardDiagramAnimation, cardDiagramAnimationDefineOptionsBuild({
	label: 'Card diagram animation',
	description: 'A card diagram moving between named states: click a state, or play between two.',
}));

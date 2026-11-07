import { Layers } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { CardDiagramSwitch } from './CardDiagramSwitch.jsx';
import { switchSourceDefaultCreate } from './SwitchSource.js';

// What a switching block exposes (compDefine expose): a block that opens in the
// popup, asset-backed like a diagram, edited as its source. A click in the viewport
// pans or follows a link, so only the Edit button opens the editor.
export function cardDiagramSwitchDefineOptionsBuild({ label, description, sourceDefaultCreate = switchSourceDefaultCreate }) {
	return {
		placementList: ['mdx', 'commentBlock'],
		isAssetAware: true,
		expose: {
			meta: { isEditAssetAccepted: true, isEditEnterButtonOnly: true, label, description },
			icon: Layers,
			sourceDefaultCreate,
		},
	};
}

export const cardDiagramSwitchDefine = compDefine(CardDiagramSwitch, cardDiagramSwitchDefineOptionsBuild({
	label: 'Card diagram scenes',
	description: 'Many card diagrams in one viewport: a path, embedded scenes, smooth switching between them.',
}));

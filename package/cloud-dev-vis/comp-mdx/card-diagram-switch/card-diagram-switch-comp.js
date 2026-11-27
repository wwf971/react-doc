import { Layers, MousePointer2 } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { CardDiagramSwitch } from './CardDiagramSwitch.jsx';
import { switchSourceDefaultCreate } from './SwitchSource.js';
import { switchConfigDefineList } from './SwitchData.js';
import { diagramResizeCornerDefine } from '../card-diagram/card-diagram-comp.js';

// the visual edit mode of a block of scenes: one scene at a time in the editor of the framework
// (SwitchSceneEdit.jsx), beside the source mode every block has
export const switchEditModeList = [{ id: 'visual', label: 'Visual', description: 'Edit the diagram of one scene at a time on the canvas', isDefault: true, icon: MousePointer2 }];

// What a switching block exposes (compDefine expose): a block that opens in the
// popup, asset-backed like a diagram, edited visually one scene at a time and as its
// source. A click in the viewport pans or follows a link, so only the Edit button opens
// the editor. isSceneEditable: false for a block whose scenes are generated from its data,
// which is edited as its source alone
export function cardDiagramSwitchDefineOptionsBuild({ label, description, sourceDefaultCreate = switchSourceDefaultCreate, isSceneEditable = true }) {
	return {
		placementList: ['mdx', 'commentBlock'],
		isAssetAware: true,
		expose: {
			meta: { isEditAssetAccepted: true, isEditEnterButtonOnly: true, isFlowCanvas: true, label, description, configDefineList: [...switchConfigDefineList, diagramResizeCornerDefine] },
			icon: Layers,
			sourceDefaultCreate,
			...(isSceneEditable ? { editModeList: switchEditModeList } : {}),
		},
	};
}

export const cardDiagramSwitchDefine = compDefine(CardDiagramSwitch, cardDiagramSwitchDefineOptionsBuild({
	label: 'Card diagram scenes',
	description: 'Many card diagrams in one viewport: a path, embedded scenes, smooth switching between them.',
}));

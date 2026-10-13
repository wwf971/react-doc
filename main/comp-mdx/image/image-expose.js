import { ImageIcon, TextCursorInput } from '../../frontend/UICommon.js';
import { imageConfigDefineList } from './image-paste.js';

// What Image exposes through its registry definition (compDefine expose,
// doc_page_impl_mdx_comp.md#what-a-component-exposes): one way of display,
// one edit mode of its own beside the built-in source mode, the shape of
// its component-level config, its icon, and the source of a new block
// (empty: the placeholder takes a pasted image).
export const imageExpose = {
	meta: {
		label: 'Image',
		description: 'One image of the source, with a caption.',
		isInsertCommon: true,
		configDefineList: imageConfigDefineList,
	},
	icon: ImageIcon,
	editModeList: [
		{
			id: 'fields',
			label: 'Fields',
			description: 'the caption in its place, the other fields in a floating panel; a pasted image becomes the source',
			icon: TextCursorInput,
			isDefault: true,
		},
	],
	sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'src: \nalt: \ncaption: \n' }),
};

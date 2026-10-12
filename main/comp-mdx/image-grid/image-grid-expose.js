import { ImagesIcon, ClipboardPaste } from '../../frontend/UICommon.js';
import { imageConfigDefineList } from '../image/image-paste.js';

// What ImageGrid exposes through its registry definition (compDefine
// expose, doc_page_impl_mdx_comp.md#what-a-component-exposes). Its edit
// mode 'images' is the one a click in edit mode opens: pasting into slots,
// adding and removing them; the yaml of the block is the built-in source
// mode, chosen from the mode menu. The grid shares the component-level
// config of the paste flow with Image.
export const imageGridExpose = {
	meta: {
		label: 'Image grid',
		description: 'Several images of the source in a wrapping row.',
		configDefineList: imageConfigDefineList,
	},
	icon: ImagesIcon,
	editModeList: [
		{
			id: 'images',
			label: 'Images',
			description: 'paste into a slot, add and remove slots; the layout fields in the bar',
			icon: ClipboardPaste,
			isDefault: true,
		},
	],
	editTemplate: { lang: 'yaml', raw: 'images:\n  - src: \n  - src: \n' },
};

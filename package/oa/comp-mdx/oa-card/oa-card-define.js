import { TextCursorInput } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { oaConfigPackage } from '../time/oa-config.js';
import { oaCardDataFieldsOf, oaCardSourceDefaultCreate, oaCardStatusItemOf, oaTimeItemOf } from './oa-card-data.js';

// A card of the package in the component registry (main/doc_page_impl_mdx_comp.md#what-a-component-exposes),
// every card the same way: a block of a document, offered by the insert menu and by the slash menu
// (meta.slashName), with the one edit mode Fields (OaCardEdit.jsx); a card of a card diagram may hold
// it (card-comp). Fields is offered in place (isInPlace: an owner keeping it open while its document
// is edited, a card of a diagram, a timetable holding it), and its values one by one (dataFields: the
// edit card of a card of a diagram). A card at a time (a kind with a time field) carries the
// preferences of the package (meta.configPackage: config.packageConfig, doc/time.md#preferences) and
// tells whoever collects times when it is (timeItem, doc/time.md#a-card-at-a-time). A card with a status
// tells what it is at and its history (statusItem, doc/event.md#its-status); an event, or a special type
// of one, says so (oaTypeList: ['event'], doc/event.md)
//   meta     label, description, slashName, slashAliasList, ... of the card
export const oaCardEditModeList = Object.freeze([
	{ id: 'fields', label: 'Fields', description: 'every value typed where it stands; the ones not written yet by the + of the card', icon: TextCursorInput, isDefault: true, isInPlace: true },
]);

export function oaCardDefine(Comp, kind, { Icon, meta }) {
	const isAtTime = kind.fieldList.some((field) => field.kind === 'time');
	const statusItem = oaCardStatusItemOf(kind);
	return compDefine(Comp, {
		expose: {
			meta: { label: kind.label, isInsertCommon: true, ...meta, ...(isAtTime ? { configPackage: oaConfigPackage } : {}) },
			icon: Icon,
			editModeList: oaCardEditModeList,
			dataFields: oaCardDataFieldsOf(kind),
			...(isAtTime ? { timeItem: oaTimeItemOf(kind) } : {}),
			...(statusItem ? { statusItem } : {}),
			...(kind.typeList ? { oaTypeList: kind.typeList } : {}),
			sourceDefaultCreate: oaCardSourceDefaultCreate(kind),
		},
	});
}

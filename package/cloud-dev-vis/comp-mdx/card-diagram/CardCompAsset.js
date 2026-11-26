import { ASSET_REF_LANG, ASSET_STORE_ID_LOCAL, assetRefParse, assetRefTextBuild } from '../../../../main/frontend/src/lib/doc-asset-ref.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { compMetaGet } from '../../../../main/comp-doc/registry/comp-expose.js';

// A card whose component keeps its data in the asset service layer (card-diagram-impl.md#a-component-in-a-card):
// a component declared isAssetOnly (a spreadsheet, ExcelUniver) never has its data written inline, in
// a document or in a card. As the insert menu of a document does (DocEditStore.blockCreateAsAsset),
// the starting data of a new card becomes a new item of the local store first, and the card holds
// the reference:
//
//   data:
//     comp: ExcelUniver
//     lang: asset
//     raw: |
//       store: local
//       itemId: w6hiawfxu6m
//
// The page draws the component with the item's data (CompAssetHost). What the component writes (Save
// of its edit mode, a data replaced) goes into the item in the item's save mode: the reference is
// never written over, and the diagram's Save has nothing more to write for it. An undo of the card
// leaves the item in the store, as a block deleted from a document does: the usage index says what
// uses it.

// a new card holding an asset-only component (entry of CardCompEntry.js, isAssetOnly): its item made,
// the entry the card is made of, holding the reference
//   -> { code: 0, data: { itemId, entry } } | { code: -1, message }
export async function cardCompAssetEntryCreate({ assetStore, entry, compById, configDoc, docPath = '' }) {
	const label = entry?.label ?? entry?.compName ?? 'This component';
	if (!assetStore) return { code: -1, message: `${label} keeps its data in the asset service layer, which this page does not have.` };
	if (!assetStore.isWritable) return { code: -1, message: `${label} keeps its data in the asset service layer, which cannot be written: ${assetStore.writeUnavailableReason}` };
	const definition = compDefinitionNormalize(compDefinitionGet(compById ?? {}, compIdResolve(configDoc, entry.compName)));
	const result = await assetStore.itemCreate({
		store: ASSET_STORE_ID_LOCAL,
		lang: entry.source?.lang,
		text: String(entry.source?.raw ?? ''),
		note: `${entry.compName} card created in a diagram${docPath ? ` of ${docPath}` : ''}`,
		...(docPath ? { docPath } : {}),
		saveMode: definition ? compMetaGet(definition).assetSaveMode : undefined,
		component: { name: entry.compName },
	});
	const itemId = result.data?.item?.itemId ?? '';
	if (result.code !== 0 || !itemId) return { code: -1, message: result.message || `The asset item of the new ${label} card was not created.` };
	const props = entry.source?.props;
	return {
		code: 0,
		data: {
			itemId,
			entry: { ...entry, isAssetOnly: false, source: { lang: ASSET_REF_LANG, raw: `${assetRefTextBuild({ store: ASSET_STORE_ID_LOCAL, itemId })}\n`, ...(props ? { props } : {}) } },
		},
	};
}

// what the component of a card holding a reference writes ({ raw, lang?, versionMetadata? }), into the
// item the reference names, in the item's save mode -> { code, message }
export async function cardCompAssetWrite({ assetStore, reference: referenceRaw, compName, raw, lang, versionMetadata }) {
	const reference = assetRefParse(referenceRaw);
	if (reference.message) return { code: -1, message: reference.message };
	if (!assetStore?.isWritable) return { code: -1, message: assetStore ? assetStore.writeUnavailableReason : 'The page has no asset service layer.' };
	const itemId = reference.itemId || assetStore.refQuery(reference)?.item?.itemId || '';
	if (!itemId) return { code: -1, message: `The asset item ${reference.name || ''} is not loaded.` };
	if (lang !== undefined && lang !== assetStore.itemGet(reference.store, itemId)?.lang) {
		const resultLang = await assetStore.itemMetaSet(reference.store, itemId, { lang });
		if (resultLang.code !== 0) return resultLang;
	}
	const result = await assetStore.itemUpdate(reference.store, itemId, { text: String(raw ?? '') }, undefined, `${compName} edited in a card of a diagram`, undefined, versionMetadata);
	return { code: result.code, message: result.message ?? '' };
}

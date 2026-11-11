import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Book, ListChecks, Plus, StickyNote } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { sourcePathBuild, sourceRootObjectBuild } from '../../../../main/frontend/src/lib/doc-source-path.js';
import { objectFrontendDocRelPathBuild } from '../../../../main/frontend/src/lib/doc-object-frontend.js';
import { CardDiagram } from '../../../cloud-dev-vis/comp-mdx/card-diagram/CardDiagram.jsx';
import { zettelDocParse, zettelDocTextBuild, zettelTextClip } from './ZettelDoc.js';
import './Zettelkasten.css';

// Cards of a zettelkasten on a card diagram (doc/README.md#cards-on-a-card-diagram).
//
//   ZettelNode      a node of any card diagram that is a card of a box: a registered renderer
//                   (placement visualizationNode), named by the source path of the card
//                       renderer: { component: ZettelNode }
//                       data: { zettel: "~${frontend.name:Tea}/card/green-tea.md" }
//   ZettelDiagram   a card diagram (the format and the editor of CardDiagram) whose create panel,
//                   opened by a double-click on the empty canvas while it is edited, also offers
//                   the cards of the boxes of the page (a source) and New card (an action, which
//                   asks for a title, makes the card in its box and places it)
//
// both work through the stores of the page, never a mode's api: a diagram is a block of any
// document, outside the instances of the box.
export const ZETTEL_BOX_TYPE_ID = 'zettelkasten.box';
const ZETTEL_NODE_COMP = 'ZettelNode';
const KIND_ICON = { zettel: Book, question: ListChecks };

// the boxes of the page: the frontend objects of the type zettelkasten.box (or below it),
// narrowed to one by its id or its name
function zettelBoxListGet(stores, boxAsked = '') {
	const { objectFrontendStore } = stores;
	const list = [];
	for (const decl of objectFrontendStore?.declList ?? []) {
		const state = objectFrontendStore.objectGet(decl.id);
		if (state.status !== 'found') continue;
		// the type itself, or one below it: it has the explorer among its modes
		const isBox = state.typeId === ZETTEL_BOX_TYPE_ID || (objectFrontendStore.modeListGet?.(state.typeId) ?? []).some((mode) => mode.comp === 'ZettelExplorer');
		if (!isBox) continue;
		if (boxAsked && boxAsked !== state.id && boxAsked !== state.ref && boxAsked !== state.name) continue;
		list.push(state);
	}
	return list;
}

// the source path of the document of an asset of a box, as its type places it
function zettelDocPathBuild(objectFrontendStore, state, asset, lang = 'md') {
	const kind = (objectFrontendStore.assetKindListGet(state.ref) ?? []).find((one) => one.id === asset.kind);
	const relPath = objectFrontendDocRelPathBuild(asset, kind, lang);
	return relPath ? sourcePathBuild(sourceRootObjectBuild('frontend', state.id), relPath) : '';
}

// a node that is a card: its title and summary, read from the card. a click opens the card as a
// link to it would (the home document of its box, in the popup). while the diagram is edited
// a click is the editor's
export const ZettelNode = observer(function ZettelNode({ data = {}, config = {} }) {
	const { sourceStore, objectFrontendStore, navStore } = useDocStores();
	const target = String(data.zettel ?? '');
	const { targets } = sourceStore.resolveLink(target, config.sourcePath ?? '');
	const entry = targets[0];
	const owner = entry?.owner;
	const read = owner ? objectFrontendStore.assetTextGet(owner.ref, owner.key) : undefined;
	const meta = read?.status === 'done' ? zettelDocParse(read.text).meta : {};
	const asset = owner ? objectFrontendStore.assetResolve(owner.ref, owner.key).asset : undefined;
	const isQuestion = asset?.kind === 'question';
	const Icon = isQuestion ? ListChecks : asset?.kind === 'note' ? StickyNote : Book;
	const isEdit = config.visualization?.isEdit === true;
	const open = () => {
		if (isEdit || !entry) return;
		void navStore?.request({ target: entry.internalPath, hash: '', fromPath: config.sourcePath ?? '', param: {}, owner });
	};
	if (!target) return <div className="zettel-node is-missing">A card node needs data.zettel: the source path of a card.</div>;
	if (!entry || !owner) return <div className="zettel-node is-missing" title={target}>No card answers to {target}</div>;
	return (
		<div className="zettel-node" data-kind={asset?.kind} role={isEdit ? undefined : 'button'} title={isEdit ? target : 'Open the card'} onClick={open}>
			<span className="zettel-node-head">
				<Icon size={12} aria-hidden="true" />
				<strong>{isQuestion && meta.number ? `Q${meta.number} · ` : ''}{meta.title || entry.title}</strong>
			</span>
			{meta.summary ? <span className="zettel-node-text">{zettelTextClip(meta.summary, 130)}</span> : read?.status === 'loading' ? <span className="zettel-node-text">…</span> : null}
		</div>
	);
});

export const zettelNodeDefineOptions = {
	placementList: ['visualizationNode'],
	expose: {
		meta: { label: 'Zettel card', description: 'A card of a zettelkasten as a node of a card diagram: data.zettel is the source path of the card.', isNotInDoc: true },
		icon: Book,
		visualizationNode: { anchorListGet: () => [], sizeDefault: { width: 230, height: 70 } },
	},
};

const keyOfTitle = (title) => String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// a new card of a box: a topic below its root, with the title given and a first line to write
// over. answers { code, message, path }: the source path of the new card
export async function zettelCardCreate(objectFrontendStore, state, { title, parent = '', level = 'topic' }) {
	const reason = objectFrontendStore.writeUnavailableReasonOf?.(state.ref) ?? '';
	if (reason) return { code: -1, message: reason };
	const keyBase = keyOfTitle(title) || 'card';
	const keyUsedSet = new Set(state.assetList.map((asset) => asset.key));
	let key = keyBase;
	for (let index = 2; keyUsedSet.has(key); index += 1) key = `${keyBase}-${index}`;
	const parentKey = parent || String(state.metadata?.rootKey ?? '');
	const pathParent = parentKey ? String(state.assetList.find((asset) => asset.key === parentKey)?.pathList?.[0] ?? '') : '';
	const pathAsset = `${pathParent && parentKey !== state.metadata?.rootKey ? pathParent : '/zettel'}/${key}`;
	const text = zettelDocTextBuild({ level, ...(parentKey ? { parent: parentKey } : {}), title, summary: '' }, 'A new card: write what it says.');
	const result = await objectFrontendStore.assetCreate(state.id, { key, kind: 'zettel', name: title, pathList: [pathAsset], lang: 'md', text, note: 'a new card' });
	if (result?.code !== 0) return { code: result?.code ?? -1, message: result?.message || 'The card could not be made.' };
	return { code: 0, message: '', key, path: zettelDocPathBuild(objectFrontendStore, state, { key, kind: 'zettel', pathList: [pathAsset] }) };
}

// what the create panel of a diagram offers beside its kinds (package cloud-dev-vis,
// card-diagram-impl.md#sources-of-the-create-panel): the cards of the boxes, found by the words
// typed, and the action New card
function zettelCreateConfigBuild(stores, boxAsked) {
	const boxListGet = () => zettelBoxListGet(stores, boxAsked);
	const nodeAdd = (editor, position, path) => editor.change(() => editor.store.nodeComponentAdd(ZETTEL_NODE_COMP, { zettel: path }, position, 'zettel'));
	const createSourceList = [{
		id: 'zettel',
		label: 'Cards',
		placeholder: 'a card of a box: words of its title',
		isBeforeKinds: true,
		search: (text) => {
			const boxList = boxListGet();
			if (boxList.length === 0) return { entryList: [], note: boxAsked ? `No zettelkasten "${boxAsked}" on this page.` : 'No zettelkasten on this page.' };
			const entryList = [];
			for (const state of boxList) {
				const { objectFrontendStore } = stores;
				const hitList = String(text ?? '').trim()
					? objectFrontendStore.assetSearch(state.ref, text, { kindList: ['zettel', 'question'], limit: 20 }).hitList ?? []
					: state.assetList.filter((asset) => asset.kind === 'zettel').slice(0, 20).map((asset) => ({ asset }));
				for (const hit of hitList) {
					const path = zettelDocPathBuild(objectFrontendStore, state, hit.asset, hit.asset.item?.lang ?? 'md');
					if (path) entryList.push({ id: path, label: hit.asset.name || hit.asset.key, description: boxList.length > 1 ? state.name : hit.asset.key, icon: KIND_ICON[hit.asset.kind] ?? Book });
				}
			}
			return { entryList: entryList.slice(0, 30), note: entryList.length === 0 ? 'No card has these words in its title.' : '' };
		},
		choose: (entry, position, editor) => nodeAdd(editor, position, entry.id),
	}];
	// New card: the title is asked; with several boxes, the box first
	const titleStateBuild = (state) => ({
		id: 'title',
		label: `New card in ${state.name || state.id}`,
		placeholder: 'the title of the new card, then Enter',
		isText: true,
		choose: async ({ text }, { position, editor }) => {
			const title = String(text ?? '').trim();
			if (!title) throw new Error('A card needs a title.');
			const result = await zettelCardCreate(stores.objectFrontendStore, state, { title });
			if (result.code !== 0) throw new Error(result.message);
			nodeAdd(editor, position, result.path);
		},
	});
	const createActionList = [{
		id: 'zettel-new',
		label: 'New card',
		description: 'Make a card in a zettelkasten and place it here',
		icon: Plus,
		keywordList: ['zettel', 'card', 'new', 'create'],
		start: () => {
			const boxList = boxListGet();
			if (boxList.length === 0) throw new Error(boxAsked ? `No zettelkasten "${boxAsked}" on this page.` : 'No zettelkasten on this page.');
			if (boxList.length === 1) return titleStateBuild(boxList[0]);
			return {
				id: 'box',
				label: 'New card: in which zettelkasten',
				placeholder: 'the zettelkasten the card goes to',
				search: (text) => ({ entryList: boxList.filter((state) => state.name.toLowerCase().includes(String(text ?? '').toLowerCase())).map((state) => ({ id: state.id, label: state.name || state.id, description: `${state.assetList.length} items`, icon: Book })) }),
				choose: (entry) => titleStateBuild(boxList.find((state) => state.id === entry.id)),
			};
		},
	}];
	return { createSourceList, createActionList };
}

// A card diagram holding cards of a zettelkasten: CardDiagram with its create panel extended.
//   data.box   optional (a prop of the marker): the id or the name of one box; absent, every
//              zettelkasten of the page is offered
export const ZettelDiagram = observer(function ZettelDiagram({ data = {}, config = {}, onEvent }) {
	const stores = useDocStores();
	const boxAsked = String(data.box ?? '');
	// kept the same across renders, as the create panel asks
	const createConfig = useMemo(() => zettelCreateConfigBuild(stores, boxAsked), [stores, boxAsked]);
	const configDiagram = useMemo(() => ({ ...config, ...createConfig }), [config, createConfig]);
	return <CardDiagram data={data} config={configDiagram} onEvent={onEvent} />;
});

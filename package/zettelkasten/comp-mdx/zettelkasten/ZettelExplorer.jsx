import { useEffect, useId, useMemo, useRef } from 'react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight, Columns3, FileText, ListChecks, ListTree, LoaderCircle, Network, Search, StickyNote } from '../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { useCompStateStore } from '../../../../main/comp-doc/registry/use-comp-state.js';
import { useObjectFrontendDrawTurn } from '../../../../main/comp-doc/object-frontend/use-object-frontend-draw-turn.js';
import { SwitchViewport, SwitchBarMenu, switchCaptureActionBuild, useSwitchStore } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/CardDiagramSwitch.jsx';
import { switchRegistryBuild } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchNodeKinds.jsx';
import { switchPathViewRead } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchData.js';
import { cardDiagramNodeRegistry } from '../../../cloud-dev-vis/comp-mdx/card-diagram/card-diagram-node-registry.js';
import { ZETTEL_KIND_LIST, zettelGet, zettelModelBuild, zettelPathOf, zettelPathRead } from './ZettelData.js';
import { zettelProviderBuild } from './ZettelScenes.js';
import { ZettelStore } from './ZettelStore.js';
import { ZettelReader, zettelNavHandle } from './ZettelReader.jsx';
import { ZettelNotePanel, ZettelOutlinePanel, ZettelQuestionPanel } from './ZettelPanel.jsx';
import './Zettelkasten.css';

export const zettelSwitchRegistry = switchRegistryBuild(cardDiagramNodeRegistry);

// the items of the object as its assets say now: what is still being read, what is read.
// signatureScene: the text of what the scenes are drawn from (the cards and the progress, not
// the notes), which a provider of scenes is known by
export function zettelItemListRead(service) {
	const assetList = service.assetList().filter((asset) => ZETTEL_KIND_LIST.includes(asset.kind));
	const itemList = [];
	const problemList = [];
	const textList = [];
	const textSceneList = [];
	let countLoading = 0;
	for (const asset of assetList) {
		// a card is a document (Markdown with a frontmatter, ZettelDoc.js); the progress is yaml
		const isDoc = asset.kind !== 'progress';
		const result = isDoc ? service.assetTextGet(asset.key) : service.assetDataGet(asset.key);
		if (result.status === 'loading') { countLoading += 1; continue; }
		if (result.status === 'error') { problemList.push(`${asset.pathList?.[0] ?? asset.key}: ${result.message}`); continue; }
		textList.push(asset.key, result.text);
		if (asset.kind !== 'note') textSceneList.push(asset.key, result.text);
		itemList.push({ key: asset.key, kind: asset.kind, name: asset.name, path: asset.pathList?.[0] ?? '', partition: asset.partition ?? '', text: isDoc ? result.text : '', data: isDoc ? undefined : result.data });
	}
	return { itemList, problemList, countLoading, countAll: assetList.length, signature: textList.join('\u0000'), signatureScene: textSceneList.join('\u0000') };
}

// the model of the object, built when its data changes and given once this block's turn to
// draw has come; until then the block shows what is read so far
export function useZettelModel(service) {
	const read = zettelItemListRead(service);
	const isLoading = read.countLoading > 0;
	const rootKey = String(service.object?.metadata?.rootKey ?? '');
	const built = useMemo(() => (isLoading ? null : { model: zettelModelBuild(read.itemList, { rootKey }), signatureScene: read.signatureScene }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[read.signature, isLoading, rootKey]);
	// an item written is read again: what was drawn stays until it is
	const builtLast = useRef(null);
	if (built) builtLast.current = built;
	const isDrawTurn = useObjectFrontendDrawTurn(service, Boolean(builtLast.current));
	return { read, model: isDrawTurn ? builtLast.current?.model ?? null : null, signatureScene: builtLast.current?.signatureScene ?? '' };
}

export const zettelHeightOf = (param, fallback = 720) => {
	const written = Number(param?.height);
	return Number.isFinite(written) && written > 0 ? Math.max(320, Math.min(1600, written)) : fallback;
};

// as tall as the block will be, so what is below does not jump when it is drawn
export function ZettelLoading({ read, height }) {
	return (
		<div style={{ minHeight: height }}>
			<p className="doc-status doc-object-frontend-line">
				<LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
				<span>Reading the cards ({read.countAll - read.countLoading} of {read.countAll})</span>
			</p>
		</div>
	);
}

// The mode "explorer" of a zettelkasten (doc/README.md#the-modes): the map of the cards and
// the card being read, side by side.
//
//   param.zettel       the card shown first (a key); the root without one
//   param.height       the height of the block
//   param.layout       split (default) | map | card: what the block starts with
//   param.panel        map (default) | outline | question | note: what the left side starts with
//   param.isPractice   true: questions hide their answers until asked
export const ZettelExplorer = observer(function ZettelExplorer({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">ZettelExplorer is a mode of a zettelkasten (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const { read, model } = useZettelModel(service);
	if (!model) return <ZettelLoading read={read} height={zettelHeightOf(param)} />;
	if (!model.rootKey) return <p className="doc-note">This zettelkasten has no card yet{read.countAll > 0 ? ' that is its root (a card of level root, or metadata.rootKey of the object)' : ''}.</p>;
	return <ZettelExplorerBody service={service} model={model} read={read} param={param} config={config} />;
});

const PANEL_LIST = [
	{ id: 'map', label: 'Map', Icon: Network, title: 'The cards as diagrams: what a card contains, points at and is pointed at by' },
	{ id: 'outline', label: 'Outline', Icon: ListTree, title: 'Every card, by the hierarchy' },
	{ id: 'question', label: 'Questions', Icon: ListChecks, title: 'Every question, by area and by how it went' },
	{ id: 'note', label: 'Notes', Icon: StickyNote, title: 'The notes you took' },
];
const LAYOUT_LIST = [
	{ id: 'split', label: 'Both', Icon: Columns3, title: 'The map and the card side by side' },
	{ id: 'map', label: 'Map', Icon: Network, title: 'The left side alone' },
	{ id: 'card', label: 'Card', Icon: FileText, title: 'The card alone' },
];

const ZettelExplorerBody = observer(function ZettelExplorerBody({ service, model, read, param, config }) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const rootRef = useRef(null);
	const store = useCompStateStore(config, 'zettel', () => new ZettelStore({ isPractice: param.isPractice === true, layout: param.layout, panel: param.panel }));
	// the card read: the store's once it has one, else the one the block names
	const pathStart = zettelPathOf(model, param.zettel && zettelGet(model, param.zettel) ? param.zettel : model.rootKey);
	const path = zettelPathRead(model, store.path) ? store.path : pathStart;
	useEffect(() => { store.pathEnsure(model, param.zettel); }, [store, model, param.zettel]);
	// in practice the scenes of the questions show the verdicts only of those answered
	const revealText = store.isPractice ? [...store.revealKeySet].sort().join(',') : '*';
	const provider = useMemo(() => zettelProviderBuild(model, {
		signature: `${read.signatureScene}\u0000${revealText}`,
		labels: service.object?.metadata?.labels,
		revealKeySet: revealText === '*' ? null : new Set(revealText ? revealText.split(',') : []),
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}), [model, read.signatureScene, revealText]);
	const switchStore = useSwitchStore({ provider, registry: zettelSwitchRegistry, pathInitial: path, scope: `.doc-switch-${instanceId}`, config, depthMax: param.depthMax ?? 2 });
	const isMapShown = store.layout !== 'card' && store.panel === 'map';
	// the map and the card follow each other: a click in the map opens its card, a link in a
	// card moves the map (ZettelStore.mapPathAccept)
	useEffect(() => reaction(() => switchStore.pathCurrent, (pathMap) => store.mapPathAccept(switchPathViewRead(pathMap).path)), [switchStore, store]);
	useEffect(() => {
		if (!isMapShown || !path) return;
		if (switchPathViewRead(switchStore.pathCurrent).path !== path) void switchStore.pathSet(path);
		else store.mapPathAccept(path);
	}, [isMapShown, path, switchStore, store]);
	// a reader sent here from a link outside the box (this block stands in the home document
	// of the object, opened for them) is taken to the card they were going to
	// (main/doc_page_impl_obj_frontend.md#the-home-document)
	const arrival = service.navArrival;
	useEffect(() => { if (arrival) zettelNavHandle(model, store, service, { owner: { ref: arrival.ref, key: arrival.key }, hash: arrival.hash }); }, [arrival?.version, arrival?.key, arrival?.hash, model.rootKey]);
	const title = zettelGet(model, model.rootKey)?.title || service.object?.name || 'Zettelkasten';
	const capture = switchCaptureActionBuild({ store: switchStore, rootRef, titleGet: () => title });
	const problemList = [...read.problemList, ...model.problemList];
	const height = zettelHeightOf(param);
	return (
		<BlockPopupSurface config={config} title={title} popupKey={`zettel:${config.instanceId ?? instanceId}`} className="zettel-shell">
			{({ isInPopup }) => (
				<div className={`zettel-explorer${isInPopup ? ' is-popup' : ''}`} data-layout={store.layout} style={{ '--zettel-height': `${height}px` }}>
					<ZettelToolbar model={model} store={store} />
					<div className="zettel-body">
						{store.layout !== 'card' ? (
							<div className="zettel-side not-prose" ref={rootRef}>
								{store.panel === 'map' ? <SwitchViewport store={switchStore} config={config} registry={zettelSwitchRegistry} height={height} isInPopup rootRef={null} barTrailing={<SwitchBarMenu action={capture} />} /> : null}
								{store.panel === 'outline' ? <ZettelOutlinePanel model={model} store={store} path={path} /> : null}
								{store.panel === 'question' ? <ZettelQuestionPanel model={model} store={store} path={path} /> : null}
								{store.panel === 'note' ? <ZettelNotePanel model={model} store={store} service={service} /> : null}
							</div>
						) : null}
						{store.layout !== 'map' ? <ZettelReader model={model} store={store} service={service} path={path} /> : null}
					</div>
					{problemList.length > 0 ? (
						<details className="zettel-problem not-prose">
							<summary>{problemList.length} things in the data do not fit</summary>
							<ul>{problemList.slice(0, 40).map((problem, index) => <li key={index}>{problem}</li>)}</ul>
						</details>
					) : null}
				</div>
			)}
		</BlockPopupSurface>
	);
});

// the bar of the block: the way back and forth, the search, what the left side shows, how the
// block is laid out, practice
const ZettelToolbar = observer(function ZettelToolbar({ model, store }) {
	const searchRef = useRef(null);
	const resultList = store.isSearchOpen ? store.searchResultListGet(model) : [];
	const searchKeyDown = (event) => {
		if (event.nativeEvent?.isComposing) return;
		if (event.key === 'ArrowDown') { event.preventDefault(); store.searchMove(model, 1); }
		else if (event.key === 'ArrowUp') { event.preventDefault(); store.searchMove(model, -1); }
		else if (event.key === 'Enter') { event.preventDefault(); store.searchChoose(model); }
		else if (event.key === 'Escape') { event.preventDefault(); store.searchClose(); }
	};
	return (
		<div className="zettel-toolbar not-prose">
			<span className="doc-button-group" role="group" aria-label="History">
				<button type="button" disabled={store.historyList.length === 0} title="Back to the card before" aria-label="Back" onClick={store.back}><ArrowLeft size={13} aria-hidden="true" /></button>
				<button type="button" disabled={store.forwardList.length === 0} title="Forward again" aria-label="Forward" onClick={store.forward}><ArrowRight size={13} aria-hidden="true" /></button>
			</span>
			<span ref={searchRef} className="zettel-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) store.searchClose(); }}>
				<label className="doc-search-field">
					<Search size={12} aria-hidden="true" className="doc-search-field-icon" />
					<input className="doc-search-field-input" type="text" value={store.searchText} placeholder="Find a card: words, q12, kind:question, hub:rag" aria-label="Find a card" spellCheck={false} onChange={(event) => store.searchTextSet(event.target.value)} onFocus={store.searchOpen} onKeyDown={searchKeyDown} />
				</label>
				{store.isSearchOpen ? (
					<span className="doc-search-result-list zettel-search-result-list" role="listbox">
						{resultList.length === 0 ? <span className="doc-search-none">No card holds these words.</span> : resultList.map((hit, index) => (
							<button key={hit.zettel.key} type="button" role="option" aria-selected={index === store.searchIndexActive} className="doc-search-result" data-active={index === store.searchIndexActive ? '' : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => store.searchChoose(model, index)}>
								<span className="doc-search-result-name">{hit.zettel.kind === 'question' ? `Q${hit.zettel.number} · ${hit.zettel.title}` : hit.zettel.title}</span>
								<span className="doc-search-result-label">{hit.zettel.level}</span>
								<span className="doc-search-result-description">{hit.zettel.summary}</span>
							</button>
						))}
					</span>
				) : null}
			</span>
			<span className="doc-button-group" role="group" aria-label="The left side">
				{PANEL_LIST.map(({ id, label, Icon, title }) => (
					<button key={id} type="button" aria-pressed={store.panel === id} title={title} onClick={() => { store.panelSet(id); if (store.layout === 'card') store.layoutSet('split'); }}><Icon size={12} aria-hidden="true" /><span>{label}</span></button>
				))}
			</span>
			<span className="doc-button-group" role="group" aria-label="Layout">
				{LAYOUT_LIST.map(({ id, label, Icon, title }) => (
					<button key={id} type="button" aria-pressed={store.layout === id} title={title} aria-label={label} onClick={() => store.layoutSet(id)}><Icon size={12} aria-hidden="true" /></button>
				))}
			</span>
			<button type="button" className="doc-button" aria-pressed={store.isPractice} data-primary={store.isPractice ? '' : undefined} title="Practice: a question hides its answer until you ask for it" onClick={() => store.practiceSet(!store.isPractice)}>Practice</button>
		</div>
	);
});

// The mode "card" of a zettelkasten: one card alone, in the flow of the document, with its
// links working in place (param.zettel: the card; param.height: 0 or absent for its own height).
export const ZettelCard = observer(function ZettelCard({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">ZettelCard is a mode of a zettelkasten (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const { read, model } = useZettelModel(service);
	if (!model) return <ZettelLoading read={read} height={zettelHeightOf(param, 160)} />;
	return <ZettelCardBody service={service} model={model} param={param} config={config} />;
});

const ZettelCardBody = observer(function ZettelCardBody({ service, model, param, config }) {
	const store = useCompStateStore(config, 'zettel', () => new ZettelStore({ isPractice: param.isPractice === true }));
	const pathStart = zettelPathOf(model, param.zettel && zettelGet(model, param.zettel) ? param.zettel : model.rootKey);
	const path = zettelPathRead(model, store.path) ? store.path : pathStart;
	useEffect(() => { store.pathEnsure(model, param.zettel); }, [store, model, param.zettel]);
	if (!path) return <p className="doc-note">There is no card {param.zettel ? `"${param.zettel}"` : ''} in this zettelkasten.</p>;
	const height = Number(param.height) > 0 ? zettelHeightOf(param) : 0;
	return (
		<div className="zettel-shell">
			<div className="zettel-explorer is-card" data-layout="card" style={height ? { '--zettel-height': `${height}px` } : { '--zettel-height': 'auto' }}>
				<div className="zettel-toolbar not-prose">
					<span className="doc-button-group" role="group" aria-label="History">
						<button type="button" disabled={store.historyList.length === 0} title="Back to the card before" aria-label="Back" onClick={store.back}><ArrowLeft size={13} aria-hidden="true" /></button>
						<button type="button" disabled={store.forwardList.length === 0} title="Forward again" aria-label="Forward" onClick={store.forward}><ArrowRight size={13} aria-hidden="true" /></button>
					</span>
					<button type="button" className="doc-button" disabled={path === pathStart} title="Back to the card this block names" onClick={() => store.go(pathStart)}>Start</button>
				</div>
				<div className="zettel-body"><ZettelReader model={model} store={store} service={service} path={path} /></div>
			</div>
		</div>
	);
});

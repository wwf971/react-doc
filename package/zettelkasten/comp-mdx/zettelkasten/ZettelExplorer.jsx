import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ListChecks, ListTree, LoaderCircle, Search, StickyNote } from '../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { useCompStateStore } from '../../../../main/comp-doc/registry/use-comp-state.js';
import { useObjectFrontendDrawTurn } from '../../../../main/comp-doc/object-frontend/use-object-frontend-draw-turn.js';
import { ZETTEL_KIND_LIST, zettelGet, zettelModelBuild, zettelTitleOf } from './ZettelData.js';
import { ZettelStore } from './ZettelStore.js';
import { zettelNavHandle } from './ZettelReader.jsx';
import { ZettelCardFrame } from './ZettelCard.jsx';
import { ZettelNotePanel, ZettelOutlinePanel, ZettelQuestionPanel } from './ZettelPanel.jsx';
import './Zettelkasten.css';

// the items of the object as its assets say now: what is still being read, what is read.
// signatureScene: the text of what the scenes are drawn from (the zettels and the progress, not
// the notes), which a provider of scenes is known by
export function zettelItemListRead(service) {
	const assetList = service.assetList().filter((asset) => ZETTEL_KIND_LIST.includes(asset.kind));
	const itemList = [];
	const problemList = [];
	const textList = [];
	const textSceneList = [];
	let countLoading = 0;
	for (const asset of assetList) {
		// a zettel is a document (Markdown with a frontmatter, ZettelDoc.js); the progress is yaml
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

// the height of a zettel that is not expanded: written (param.height), else from the width it
// has, as a card is wider than tall (param.aspect, the width over the height)
export function zettelCardHeightOf(param, width) {
	const written = Number(param?.height);
	if (Number.isFinite(written) && written > 0) return Math.max(300, Math.min(1600, written));
	const aspectWritten = Number(param?.aspect);
	const aspect = Number.isFinite(aspectWritten) && aspectWritten > 0.5 ? aspectWritten : 1.55;
	return Math.round(Math.max(380, Math.min(760, (width || 900) / aspect)));
}

// as tall as the block will be, so what is below does not jump when it is drawn
export function ZettelLoading({ read, height }) {
	return (
		<div style={{ minHeight: height }}>
			<p className="doc-status doc-object-frontend-line">
				<LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
				<span>Reading the zettels ({read.countAll - read.countLoading} of {read.countAll})</span>
			</p>
		</div>
	);
}

// the zettel a block names, as its key: param.zettel is an inner path of the box (react-doc:
// main/doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths), so a key, a path of
// the zettel (/zettel/…) or name:… all name it; what names no asset is left as written
function zettelKeyOfParam(service, zettelParam) {
	if (!zettelParam) return '';
	return service.assetGet(String(zettelParam))?.key ?? String(zettelParam);
}

// the width a block has, kept in its store, which the height of its zettel follows
function useWidth(store, ref) {
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return undefined;
		const observer = new ResizeObserver(() => store.deskWidthSet(element.clientWidth));
		observer.observe(element);
		store.deskWidthSet(element.clientWidth);
		return () => observer.disconnect();
	}, [store, ref]);
}

// The mode "explorer" of a zettelkasten (doc/README.md#the-modes): a zettel lying on a desk. Over
// it a bar to find a zettel and to open a side panel (the outline, the questions, the notes) and
// practice; the zettel itself is a card, shown with its text, its connections or its flow.
//
//   param.zettel       the zettel shown first (a key, or any asset reference: a path, name:…); the root without one
//   param.view         text (default) | link | flow: how it is shown first
//   param.height       the height of the zettel; param.aspect its width over its height, when no height is written
//   param.panel        outline | question | note: a side panel open from the start
//   param.isPractice   true: questions hide their answers until asked
export const ZettelExplorer = observer(function ZettelExplorer({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">ZettelExplorer is a mode of a zettelkasten (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const { read, model, signatureScene } = useZettelModel(service);
	if (!model) return <ZettelLoading read={read} height={zettelCardHeightOf(param, 900) + 60} />;
	if (!model.rootKey) return <p className="doc-note">This zettelkasten has no zettel yet{read.countAll > 0 ? ' that is its root (a zettel of level root, or metadata.rootKey of the object)' : ''}.</p>;
	return <ZettelExplorerBody service={service} model={model} read={read} param={param} config={config} signatureScene={signatureScene} />;
});

const PANEL_LIST = [
	{ id: 'outline', label: 'Outline', Icon: ListTree, title: 'Every zettel, by what holds it' },
	{ id: 'question', label: 'Questions', Icon: ListChecks, title: 'Every question, by area and by how it went' },
	{ id: 'note', label: 'Notes', Icon: StickyNote, title: 'The notes you took' },
];

const ZettelExplorerBody = observer(function ZettelExplorerBody({ service, model, read, param, config, signatureScene }) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const deskRef = useRef(null);
	const store = useCompStateStore(config, 'zettel', () => new ZettelStore({ isPractice: param.isPractice === true, panel: param.panel, view: param.view }));
	const zettelKey = zettelKeyOfParam(service, param.zettel);
	useEffect(() => { store.zettelEnsure(model, zettelKey); }, [store, model, zettelKey]);
	useWidth(store, deskRef);
	// a reader sent here from a link outside the box (this block stands in the home document of
	// the object, opened for them) is taken to the zettel they were going to
	// (main/doc_page_impl_obj_frontend.md#the-home-document)
	const arrival = service.navArrival;
	useEffect(() => { if (arrival) zettelNavHandle(model, store, service, { owner: { ref: arrival.ref, key: arrival.key }, hash: arrival.hash }); }, [arrival?.version, arrival?.key, arrival?.hash, model.rootKey]);
	const title = zettelGet(model, model.rootKey)?.title || service.object?.name || 'Zettelkasten';
	const problemList = [...read.problemList, ...model.problemList];
	return (
		<BlockPopupSurface config={config} title={title} popupKey={`zettel:${config.instanceId ?? instanceId}`} className="zettel-shell">
			{({ isInPopup }) => (
				<div ref={deskRef} className={`zettel-desk${isInPopup ? ' is-popup' : ''}`} data-panel={store.panel || undefined}>
					<ZettelDeskBar model={model} store={store} />
					<div className="zettel-desk-body">
						{store.panel ? (
							<aside className="zettel-desk-panel not-prose" aria-label={PANEL_LIST.find((panel) => panel.id === store.panel)?.label}>
								{store.panel === 'outline' ? <ZettelOutlinePanel model={model} store={store} /> : null}
								{store.panel === 'question' ? <ZettelQuestionPanel model={model} store={store} /> : null}
								{store.panel === 'note' ? <ZettelNotePanel model={model} store={store} service={service} /> : null}
							</aside>
						) : null}
						{store.zettelKey ? <ZettelCardFrame model={model} store={store} service={service} config={config} signatureScene={signatureScene} height={isInPopup ? 'fill' : zettelCardHeightOf(param, store.deskWidth - 28)} /> : null}
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

// the bar of the desk: the search, the side panel, practice. the way back and forth is the
// zettel's own, in its title bar
const ZettelDeskBar = observer(function ZettelDeskBar({ model, store }) {
	const resultList = store.isSearchOpen ? store.searchResultListGet(model) : [];
	const searchKeyDown = (event) => {
		if (event.nativeEvent?.isComposing) return;
		if (event.key === 'ArrowDown') { event.preventDefault(); store.searchMove(model, 1); }
		else if (event.key === 'ArrowUp') { event.preventDefault(); store.searchMove(model, -1); }
		else if (event.key === 'Enter') { event.preventDefault(); store.searchChoose(model); }
		else if (event.key === 'Escape') { event.preventDefault(); store.searchClose(); }
	};
	return (
		<div className="zettel-desk-bar not-prose">
			<span className="zettel-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) store.searchClose(); }}>
				<label className="doc-search-field">
					<Search size={12} aria-hidden="true" className="doc-search-field-icon" />
					<input className="doc-search-field-input" type="text" value={store.searchText} placeholder="Find a zettel: words, q12, kind:question, hub:rag" aria-label="Find a zettel" spellCheck={false} onChange={(event) => store.searchTextSet(event.target.value)} onFocus={store.searchOpen} onKeyDown={searchKeyDown} />
				</label>
				{store.isSearchOpen ? (
					<span className="doc-search-result-list zettel-search-result-list" role="listbox">
						{resultList.length === 0 ? <span className="doc-search-none">No zettel holds these words.</span> : resultList.map((hit, index) => (
							<button key={hit.zettel.key} type="button" role="option" aria-selected={index === store.searchIndexActive} className="doc-search-result" data-active={index === store.searchIndexActive ? '' : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => store.searchChoose(model, index)}>
								<span className="doc-search-result-name">{zettelTitleOf(hit.zettel)}</span>
								<span className="doc-search-result-label">{hit.zettel.level}</span>
								<span className="doc-search-result-description">{hit.zettel.summary}</span>
							</button>
						))}
					</span>
				) : null}
			</span>
			<span className="doc-button-group" role="group" aria-label="Side panel">
				{PANEL_LIST.map(({ id, label, Icon, title }) => (
					<button key={id} type="button" aria-pressed={store.panel === id} title={title} onClick={() => store.panelSet(id)}><Icon size={12} aria-hidden="true" /><span>{label}</span></button>
				))}
			</span>
			<button type="button" className="doc-button" aria-pressed={store.isPractice} data-primary={store.isPractice ? '' : undefined} title="Practice: a question hides its answer until you ask for it" onClick={() => store.practiceSet(!store.isPractice)}>Practice</button>
		</div>
	);
});

// The mode "card" of a zettelkasten: one zettel alone, in the flow of the document, with its
// links, its views and its way back working in place (param.zettel: the zettel; param.view,
// param.height, param.aspect as for the explorer).
export const ZettelCard = observer(function ZettelCard({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">ZettelCard is a mode of a zettelkasten (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const { read, model, signatureScene } = useZettelModel(service);
	if (!model) return <ZettelLoading read={read} height={zettelCardHeightOf(param, 760)} />;
	return <ZettelCardBody service={service} model={model} param={param} config={config} signatureScene={signatureScene} />;
});

const ZettelCardBody = observer(function ZettelCardBody({ service, model, param, config, signatureScene }) {
	const shellRef = useRef(null);
	const store = useCompStateStore(config, 'zettel', () => new ZettelStore({ isPractice: param.isPractice === true, view: param.view }));
	const zettelKey = zettelKeyOfParam(service, param.zettel);
	useEffect(() => { store.zettelEnsure(model, zettelKey); }, [store, model, zettelKey]);
	useWidth(store, shellRef);
	if (param.zettel && !zettelGet(model, zettelKey)) return <p className="doc-note">There is no zettel "{param.zettel}" in this zettelkasten.</p>;
	return (
		<div ref={shellRef} className="zettel-shell is-card">
			{store.zettelKey ? <ZettelCardFrame model={model} store={store} service={service} config={config} signatureScene={signatureScene} height={zettelCardHeightOf(param, store.deskWidth)} /> : null}
		</div>
	);
});

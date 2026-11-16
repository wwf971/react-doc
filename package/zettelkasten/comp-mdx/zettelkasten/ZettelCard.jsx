import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { reaction, when } from 'mobx';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight, Book, ChevronsDownUp, ChevronsUpDown, Ellipsis, FileText, ListChecks, Network, Plus, Scan, Search, Trash2, Waypoints, Workflow, X } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { SwitchCanvas } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchCanvas.jsx';
import { useSwitchStore } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/CardDiagramSwitch.jsx';
import { switchCameraFit } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchData.js';
import { zettelGet, zettelLabelOf, zettelRoleBuild, zettelSearch, zettelTitleOf } from './ZettelData.js';
import { zettelConnectionWrittenListOf } from './ZettelConnect.js';
import { zettelSwitchRegistry } from './ZettelKinds.jsx';
import { zettelMotionClear, zettelMotionClose, zettelMotionFade, zettelMotionOpen } from './ZettelMotion.js';
import { ZETTEL_PLACE_ALL, ZETTEL_PLACE_LIST, zettelProviderBuild, zettelSceneExtentGet, zettelScenePathBuild, zettelScenePathRead, zettelToneOfBuild } from './ZettelScenes.js';
import { ZettelText } from './ZettelReader.jsx';

// A zettel (doc/README.md#a-zettel-is-a-card): a card with a title bar, its body scrolling when it
// says more than fits, or expanded to all of it. The body shows one view at a time, chosen at the
// right of the title bar:
//
//   text          the text of the zettel (ZettelText)
//   connections   the zettels connected to it, in a viewport whose edge is the frame of the
//                 zettel: the zettel itself is the card in the middle (ZettelScenes.js). the
//                 frame of the zettel shrinks onto that card as the view opens (ZettelMotion.js)
//   flow          the process it describes, when it has one
//
// the viewport is one canvas of the package cloud-dev-vis, drawn once it is first asked for and
// kept: going from a zettel to another in it, from a filter to another, or between the
// connections and the flow, is a switch of its scenes (shared zettels move).
//
//   model, store, service   the zettels, the state of the block (ZettelStore), the api of the mode
//   config                  the config of the block
//   height                  the height of the card when it is not expanded
//   isNavShown              the way back and forth in its title bar
export const ZettelCardFrame = observer(function ZettelCardFrame({ model, store, service, config, signatureScene, height, isNavShown = true }) {
	const { objectStore, objectFrontendStore, editStore } = useDocStores();
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const cardRef = useRef(null);
	const bodyRef = useRef(null);
	const textRef = useRef(null);
	const ghostRef = useRef(null);
	const sceneRef = useRef(null);
	const zettel = zettelGet(model, store.zettelKey);
	// in practice the scenes of the questions show their verdicts only once answered
	const revealText = store.isPractice ? [...store.revealKeySet].sort().join(',') : '*';
	const handlerRef = useRef({});
	handlerRef.current = {
		zettelOpen: (key) => store.zettelRead(model, key),
		objectOpen: (ref) => void objectStore?.open?.(ref),
		objectLabelGet: (ref) => objectLabelOf(objectStore, objectFrontendStore, ref),
	};
	const provider = useMemo(() => zettelProviderBuild(model, {
		signature: `${signatureScene}\u0000${revealText}`,
		labels: service.object?.metadata?.labels,
		revealKeySet: revealText === '*' ? null : new Set(revealText ? revealText.split(',') : []),
		onZettelOpen: (key) => handlerRef.current.zettelOpen(key),
		onObjectOpen: (ref) => handlerRef.current.objectOpen(ref),
		objectLabelGet: (ref) => handlerRef.current.objectLabelGet(ref),
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}), [model, signatureScene, revealText]);
	const pathOf = (view, key = store.zettelKey) => (view === 'flow' ? zettelScenePathBuild(key, 'flow') : zettelScenePathBuild(key, 'link', store.placeCode));
	const switchStore = useSwitchStore({ provider, registry: zettelSwitchRegistry, pathInitial: pathOf(store.viewShown === 'flow' && hasFlowInitial(zettel) ? 'flow' : 'link'), scope: `.doc-switch-${instanceId}`, config, depthMax: 1 });
	const hasFlow = Boolean(zettel?.flow);
	const toneOf = useMemo(() => zettelToneOfBuild(model), [model]);

	// the width of the card, which an expanded view of the connections is drawn at
	useLayoutEffect(() => {
		const element = cardRef.current;
		if (!element) return undefined;
		const observer = new ResizeObserver(() => store.cardWidthSet(element.clientWidth));
		observer.observe(element);
		store.cardWidthSet(element.clientWidth);
		return () => observer.disconnect();
	}, [store]);

	// a view asked: drawn, then the change played from what is shown to it
	const tokenRef = useRef(0);
	useEffect(() => {
		const from = store.viewShown;
		const to = store.view === 'flow' && !hasFlow ? 'link' : store.view;
		if (to !== store.view) store.viewSet(to);
		if (from === to) return undefined;
		const token = ++tokenRef.current;
		const bodyEl = bodyRef.current;
		const elementSet = () => ({ bodyEl, ghostEl: ghostRef.current, textEl: textRef.current, sceneEl: sceneRef.current, centerId: `z:${store.zettelKey}` });
		const isCurrent = () => token === tokenRef.current;
		void (async () => {
			if (to !== 'text') {
				store.sceneMount();
				await when(() => switchStore.isCameraReady && Boolean(sceneRef.current));
				if (!isCurrent()) return;
			}
			bodyEl.dataset.motion = '';
			let cleanup = () => {};
			if (from !== 'text' && to !== 'text') {
				// the connections and the flow: a switch of the scenes, shared zettels moving
				await switchStore.pathSet(pathOf(to));
			} else if (to !== 'text') {
				await switchStore.showAt(pathOf(to));
				await frameNext(2);
				if (!isCurrent()) return;
				cameraFix();
				await frameNext(1);
				if (!isCurrent()) return;
				cleanup = to === 'link' ? await zettelMotionOpen(elementSet()) : await zettelMotionFade({ fromEl: textRef.current, toEl: sceneRef.current });
			} else {
				cleanup = from === 'link' ? await zettelMotionClose(elementSet()) : await zettelMotionFade({ fromEl: sceneRef.current, toEl: textRef.current });
			}
			if (!isCurrent()) { cleanup(); return; }
			store.viewShownSet(to);
			await frameNext(1);
			delete bodyEl.dataset.motion;
			cleanup();
		})();
		return () => {
			if (tokenRef.current === token) return;
			delete bodyEl.dataset.motion;
			zettelMotionClear(elementSet());
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [store.view, hasFlow]);

	// the camera of an expanded view shows all of it; otherwise what the scene says to show first
	const cameraFix = () => {
		const path = switchStore.pathCurrent;
		const desc = provider.sceneGet(path.split('@')[0]);
		if (!store.isExpanded || !desc || !switchStore.box) return;
		const extent = zettelSceneExtentGet(desc);
		if (extent) switchStore.cameraApply(switchCameraFit(extent, switchStore.box));
	};
	useEffect(() => reaction(() => [store.isExpanded, switchStore.box?.width, switchStore.box?.height, switchStore.pathCurrent, switchStore.plan], ([isExpanded, , , path, plan]) => {
		if (plan || store.viewShown === 'text') return;
		if (isExpanded) cameraFix();
		else switchStore.cameraApply(switchStore.cameraOf(path));
	}), [switchStore, store, provider]);

	// the zettel or the places changed while a scene is shown (the search, the outline, the way
	// back): the scene follows, by a switch
	useEffect(() => {
		if (store.viewShown === 'text' || store.view !== store.viewShown || bodyRef.current?.dataset.motion !== undefined) return;
		const path = pathOf(store.viewShown);
		if (switchStore.pathCurrent !== path && switchStore.plan?.pathTo !== path) void switchStore.pathSet(path);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [store.zettelKey, store.placeCode, store.viewShown]);
	// and the other way: a zettel clicked in a scene, or a card of a place cut short, is the zettel
	// shown and the places shown
	useEffect(() => reaction(() => switchStore.pathCurrent, (path) => {
		const place = zettelScenePathRead(path);
		if (!place || store.viewShown === 'text') return;
		if (place.view === 'link') {
			const code = [...place.placeSet].sort().join('');
			if (code !== store.placeCode) store.placeCodeSet(code);
		}
		if (place.key !== store.zettelKey && zettelGet(model, place.key)) store.go(place.key);
	}), [switchStore, store, model]);

	// the height: written, else all of the text, or all of the scene at a readable scale
	const desc = store.isExpanded && store.viewShown !== 'text' ? provider.sceneGet(switchStore.pathCurrent.split('@')[0]) : null;
	const extent = desc ? zettelSceneExtentGet(desc) : null;
	const isFill = height === 'fill';
	const heightBody = extent ? Math.round(Math.min(2400, Math.max((isFill ? 600 : height) - ZETTEL_BAR_HEIGHT, extent.height * Math.min(1, Math.max(1, store.cardWidth - 40) / extent.width) + 40 + ZETTEL_STRIP_HEIGHT))) : 0;
	// in the popup it fills the popup, expanded or not
	const styleCard = isFill ? { flex: '1 1 0', minHeight: 0 } : !store.isExpanded ? { height } : extent ? { height: heightBody + ZETTEL_BAR_HEIGHT } : {};
	const isTextFlowing = store.isExpanded && store.viewShown === 'text' && !isFill;
	if (!zettel) return <p className="doc-note">There is no zettel "{store.zettelKey}" in this zettelkasten.</p>;
	return (
		<article ref={cardRef} className="zettel-card" data-tone={toneOf(zettel)} data-expanded={store.isExpanded ? '' : undefined} style={styleCard}>
			<ZettelTitleBar model={model} store={store} service={service} zettel={zettel} hasFlow={hasFlow} isNavShown={isNavShown} />
			<div ref={bodyRef} className="zettel-card-body" data-shown={store.viewShown} data-flowing={isTextFlowing ? '' : undefined}>
				{store.isSceneMounted ? (
					<div className="zettel-layer zettel-layer-scene not-prose" aria-hidden={store.viewShown === 'text' ? 'true' : undefined}>
						<ZettelSceneStrip model={model} store={store} zettel={zettel} onFit={() => (store.isExpanded ? cameraFix() : void switchStore.cameraReset())} />
						<figure ref={sceneRef} className={`doc-switch doc-switch-${instanceId} zettel-viewport`}>
							<SwitchCanvas store={switchStore} config={config} registry={zettelSwitchRegistry} />
						</figure>
					</div>
				) : null}
				<ZettelText model={model} store={store} service={service} rootRef={textRef} isHidden={store.viewShown !== 'text'} />
				<div ref={ghostRef} className="zettel-motion-ghost" hidden aria-hidden="true"><div className="zettel-motion-ghost-fill"><span className="zettel-motion-ghost-bar" /></div></div>
				{store.dialog ? <ZettelDialog model={model} store={store} service={service} editStore={editStore} zettel={zettel} /> : null}
			</div>
		</article>
	);
});

export const ZETTEL_BAR_HEIGHT = 42;
export const ZETTEL_STRIP_HEIGHT = 36;
const KIND_ICON = { zettel: Book, question: ListChecks };
const VIEW_LIST = [
	{ id: 'text', label: 'Text', Icon: FileText, title: 'The text of this zettel' },
	{ id: 'link', label: 'Connections', Icon: Network, title: 'The zettels connected to this one: what holds it, what it holds, its links' },
	{ id: 'flow', label: 'Flow', Icon: Workflow, title: 'The process this zettel describes' },
];

const hasFlowInitial = (zettel) => Boolean(zettel?.flow);

const frameNext = (count = 1) => new Promise((resolve) => {
	const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
	step(count);
});

// the words of an object a line is labelled by: its name as the page knows it
function objectLabelOf(objectStore, objectFrontendStore, ref) {
	if (ref.startsWith('frontend:')) {
		const id = ref.slice('frontend:'.length).split('#')[0];
		const name = objectFrontendStore?.objectGet?.(id)?.name;
		if (name) return ref.includes('#') ? `${name} › ${ref.split('#')[1]}` : name;
	}
	const descriptor = objectStore?.resolveStateGet?.(ref)?.descriptor;
	return descriptor?.label && descriptor.label !== ref ? descriptor.label : ref;
}

// the title bar: the way back and forth, what the zettel is, then at the right how it is shown,
// expanded or not, and (while the document is edited) the menu of what changes it
const ZettelTitleBar = observer(function ZettelTitleBar({ model, store, service, zettel, hasFlow, isNavShown }) {
	const Icon = KIND_ICON[zettel.kind] ?? Book;
	const isEditing = service.docState?.isEditing === true;
	const menuRef = useRef(null);
	useEffect(() => {
		if (!store.isMenuOpen) return undefined;
		const pointerDown = (event) => { if (!menuRef.current?.contains(event.target)) store.menuClose(); };
		document.addEventListener('pointerdown', pointerDown, true);
		return () => document.removeEventListener('pointerdown', pointerDown, true);
	}, [store.isMenuOpen, store]);
	const levelText = { root: 'map', hub: 'area', topic: 'topic', fact: 'fact', question: 'question' }[zettel.level] ?? '';
	return (
		<header className="zettel-card-bar not-prose">
			{isNavShown ? (
				<span className="zettel-card-bar-nav">
					<button type="button" className="zettel-bar-button" disabled={store.historyList.length === 0} title="Back to the zettel before" aria-label="Back" onClick={store.back}><ArrowLeft size={14} aria-hidden="true" /></button>
					<button type="button" className="zettel-bar-button" disabled={store.forwardList.length === 0} title="Forward again" aria-label="Forward" onClick={store.forward}><ArrowRight size={14} aria-hidden="true" /></button>
				</span>
			) : null}
			<span className="zettel-card-bar-title" title={zettel.summary || zettelTitleOf(zettel)}>
				<Icon className="zettel-card-bar-icon" size={15} aria-hidden="true" />
				<h3>{zettelTitleOf(zettel)}</h3>
				{levelText ? <span className="zettel-card-bar-level">{levelText}</span> : null}
			</span>
			<span className="doc-button-group zettel-card-bar-view" role="group" aria-label="How the zettel is shown">
				{VIEW_LIST.filter((view) => view.id !== 'flow' || hasFlow).map(({ id, label, Icon: ViewIcon, title }) => (
					<button key={id} type="button" aria-pressed={store.view === id} title={title} onClick={() => store.viewSet(id)}><ViewIcon size={13} aria-hidden="true" /><span>{label}</span></button>
				))}
			</span>
			<button type="button" className="zettel-bar-button" aria-pressed={store.isExpanded} title={store.isExpanded ? 'Back to the size of a card' : 'Expand: the whole zettel, without scrolling'} aria-label={store.isExpanded ? 'Collapse' : 'Expand'} onClick={store.expandToggle}>
				{store.isExpanded ? <ChevronsDownUp size={14} aria-hidden="true" /> : <ChevronsUpDown size={14} aria-hidden="true" />}
			</button>
			{isEditing ? (
				<span ref={menuRef} className="zettel-card-bar-menu">
					<button type="button" className="zettel-bar-button" aria-expanded={store.isMenuOpen} aria-haspopup="menu" title="Change this zettel" aria-label="Change this zettel" onClick={store.menuToggle}><Ellipsis size={14} aria-hidden="true" /></button>
					{store.isMenuOpen ? (
						<span className="zettel-menu" role="menu">
							<button type="button" role="menuitem" disabled={!service.isEditable} title={service.editUnavailableReason || undefined} onClick={() => store.dialogOpen('connect')}><Waypoints size={13} aria-hidden="true" /><span>Connect to a zettel…</span></button>
							<button type="button" role="menuitem" disabled={!service.isEditable} title={service.editUnavailableReason || undefined} onClick={() => store.dialogOpen('cardNew')}><Plus size={13} aria-hidden="true" /><span>New zettel inside this one…</span></button>
							<button type="button" role="menuitem" data-danger="" disabled={!service.isEditable || zettel.key === model.rootKey} title={zettel.key === model.rootKey ? 'The root of a box is not removed' : service.editUnavailableReason || undefined} onClick={() => store.dialogOpen('cardRemove')}><Trash2 size={13} aria-hidden="true" /><span>Remove this zettel…</span></button>
						</span>
					) : null}
				</span>
			) : null}
		</header>
	);
});

// the strip over the viewport: which places of the connections are shown, each with how many it
// holds (in the flow: its title), and the camera back to what is shown first
const ZettelSceneStrip = observer(function ZettelSceneStrip({ model, store, zettel, onFit }) {
	const isFlow = store.view === 'flow';
	const role = zettelRoleBuild(model, zettel.key);
	const countByPlace = { c: role.containerList.length, h: role.childList.length, b: role.inList.length, f: role.outList.length + role.groupList.reduce((sum, group) => sum + group.itemList.length, 0), q: role.questionList.length };
	return (
		<div className="zettel-scene-strip">
			{isFlow ? <span className="zettel-scene-strip-title">{zettel.flow?.title || 'Flow'}</span> : (
				<span className="zettel-scene-strip-filter" role="group" aria-label="Places shown">
					<span className="zettel-scene-strip-label">Show</span>
					{ZETTEL_PLACE_LIST.map((place) => (
						<button key={place.id} type="button" className="zettel-filter-chip" aria-pressed={store.placeCode.includes(place.id)} disabled={countByPlace[place.id] === 0} title={place.title} onClick={() => store.placeToggle(place.id)}>
							{place.label}<em>{countByPlace[place.id]}</em>
						</button>
					))}
					{store.placeCode !== ZETTEL_PLACE_ALL ? <button type="button" className="zettel-strip-reset" onClick={() => store.placeCodeSet(ZETTEL_PLACE_ALL)}>all</button> : null}
				</span>
			)}
			<button type="button" className="zettel-bar-button" title={store.isExpanded ? 'Show the whole view' : 'Back to what is shown first'} aria-label="Fit" onClick={onFit}><Scan size={14} aria-hidden="true" /></button>
		</div>
	);
});

// a dialog over the zettel (edit mode): a new zettel inside it, the zettel removed, a connection
// made or taken away. Escape and a click beside it close it
const ZettelDialog = observer(function ZettelDialog({ model, store, service, editStore, zettel }) {
	const dialog = store.dialog;
	const keyDown = (event) => { if (event.key === 'Escape') { event.stopPropagation(); store.dialogClose(); } };
	return (
		<div className="zettel-dialog-scrim not-prose" onPointerDown={(event) => { if (event.target === event.currentTarget) store.dialogClose(); }} onKeyDown={keyDown}>
			<section className="zettel-dialog" role="dialog" aria-modal="true" aria-label={dialog.kind === 'connect' ? 'Connect to a zettel' : dialog.kind === 'cardNew' ? 'New zettel' : 'Remove the zettel'}>
				<header className="zettel-dialog-head">
					<h4>{dialog.kind === 'connect' ? `Connections of “${zettelLabelOf(zettel)}”` : dialog.kind === 'cardNew' ? `A new zettel inside “${zettelLabelOf(zettel)}”` : `Remove “${zettelLabelOf(zettel)}”`}</h4>
					<button type="button" className="zettel-bar-button" aria-label="Close" onClick={store.dialogClose}><X size={14} aria-hidden="true" /></button>
				</header>
				{dialog.kind === 'cardNew' ? <ZettelDialogNew model={model} store={store} service={service} /> : null}
				{dialog.kind === 'cardRemove' ? <ZettelDialogRemove model={model} store={store} service={service} zettel={zettel} /> : null}
				{dialog.kind === 'connect' ? <ZettelDialogConnect model={model} store={store} service={service} editStore={editStore} zettel={zettel} /> : null}
				{dialog.message ? <p className="doc-error zettel-dialog-message" role="alert">{dialog.message}</p> : null}
			</section>
		</div>
	);
});

const ZettelDialogNew = observer(function ZettelDialogNew({ model, store, service }) {
	const dialog = store.dialog;
	useEffect(() => { store.cardOpenPendingTake(model); }, [store, model]);
	return (
		<form className="zettel-dialog-body" onSubmit={(event) => { event.preventDefault(); void store.cardNewRun(service, model); }}>
			<label className="zettel-dialog-field"><span>Title</span><input className="zettel-dialog-input" autoFocus value={dialog.title} placeholder="what the zettel says" onChange={(event) => store.dialogChange({ title: event.target.value })} /></label>
			<p className="doc-note">It is held by this zettel, one level down, and opened once it is made.</p>
			<p className="zettel-dialog-action">
				<button type="submit" className="doc-button" data-primary="" disabled={dialog.isBusy || !dialog.title.trim()}>Create</button>
				<button type="button" className="doc-button" disabled={dialog.isBusy} onClick={store.dialogClose}>Cancel</button>
			</p>
		</form>
	);
});

const ZettelDialogRemove = observer(function ZettelDialogRemove({ model, store, service, zettel }) {
	const dialog = store.dialog;
	const childCount = (model.containListByKey.get(zettel.key) ?? []).length;
	return (
		<div className="zettel-dialog-body">
			<p>{childCount > 0 ? `It holds ${childCount} zettels: remove them or give them another container first.` : 'Links to it will show as missing. It is deleted softly, as every item of an object is.'}</p>
			<p className="zettel-dialog-action">
				<button type="button" className="doc-button" data-danger="" disabled={dialog.isBusy || childCount > 0} onClick={() => void store.cardRemoveRun(service, model)}>Remove</button>
				<button type="button" className="doc-button" disabled={dialog.isBusy} onClick={store.dialogClose}>Keep</button>
			</p>
		</div>
	);
});

const CONNECT_TYPE_LIST = [
	{ id: 'link', label: 'Points at', title: 'This zettel points at the other one (a link)' },
	{ id: 'contain', label: 'Contains', title: 'This zettel holds the other one' },
	{ id: 'containedBy', label: 'Contained by', title: 'The other zettel holds this one' },
];
const LABEL_KIND_LIST = [
	{ id: 'none', label: 'None' }, { id: 'text', label: 'Text' }, { id: 'zettel', label: 'A zettel' }, { id: 'object', label: 'An object' },
];

// the connection made: its kind, the other zettel (found by words), for a link its direction and
// its label; what would close a cycle of containment is said before anything is written. under it
// the connections this zettel writes itself, each taken away by its button
const ZettelDialogConnect = observer(function ZettelDialogConnect({ model, store, service, editStore, zettel }) {
	const dialog = store.dialog;
	const reason = store.connectCheck(model);
	const text = service.assetTextGet(zettel.key);
	const writtenList = text.status === 'done' ? zettelConnectionWrittenListOf(text.text) : [];
	return (
		<form className="zettel-dialog-body" onSubmit={(event) => { event.preventDefault(); void store.connectRun(service, model, { editStore }); }}>
			<div className="zettel-dialog-field"><span>Connection</span>
				<span className="doc-button-group" role="group" aria-label="Connection">
					{CONNECT_TYPE_LIST.map((type) => <button key={type.id} type="button" aria-pressed={dialog.type === type.id} title={type.title} onClick={() => store.dialogChange({ type: type.id })}>{type.label}</button>)}
				</span>
			</div>
			<ZettelPick model={model} label="To" text={dialog.targetText} keyChosen={dialog.targetKey} onText={(value) => store.dialogChange({ targetText: value, targetKey: '' })} onChoose={(key) => store.dialogChange({ targetKey: key, targetText: '' })} />
			{dialog.type === 'link' ? (
				<>
					<div className="zettel-dialog-field"><span>Direction</span>
						<span className="doc-button-group" role="group" aria-label="Direction">
							<button type="button" aria-pressed={dialog.isDirected} title="An arrow from this zettel to the other" onClick={() => store.dialogChange({ isDirected: true })}>Directed</button>
							<button type="button" aria-pressed={!dialog.isDirected} title="A line without an arrow: the two are related" onClick={() => store.dialogChange({ isDirected: false })}>Without direction</button>
						</span>
					</div>
					<div className="zettel-dialog-field"><span>Label</span>
						<span className="doc-button-group" role="group" aria-label="Label">
							{LABEL_KIND_LIST.map((kind) => <button key={kind.id} type="button" aria-pressed={dialog.labelKind === kind.id} onClick={() => store.dialogChange({ labelKind: kind.id })}>{kind.label}</button>)}
						</span>
					</div>
					{dialog.labelKind === 'text' ? <label className="zettel-dialog-field"><span /><input className="zettel-dialog-input" value={dialog.labelText} placeholder="the words on the line: explains, needs, contradicts" onChange={(event) => store.dialogChange({ labelText: event.target.value })} /></label> : null}
					{dialog.labelKind === 'zettel' ? <ZettelPick model={model} label="" text={dialog.labelTextZettel ?? ''} keyChosen={dialog.labelKey} onText={(value) => store.dialogChange({ labelTextZettel: value, labelKey: '' })} onChoose={(key) => store.dialogChange({ labelKey: key, labelTextZettel: '' })} /> : null}
					{dialog.labelKind === 'object' ? <label className="zettel-dialog-field"><span /><input className="zettel-dialog-input" value={dialog.labelRef} placeholder="frontend:… or any reference of the page" spellCheck={false} onChange={(event) => store.dialogChange({ labelRef: event.target.value })} /></label> : null}
				</>
			) : null}
			{reason && dialog.targetKey ? <p className="zettel-dialog-reason" role="status">{reason}</p> : null}
			<p className="zettel-dialog-action">
				<button type="submit" className="doc-button" data-primary="" disabled={dialog.isBusy || reason !== ''}>Connect</button>
				<button type="button" className="doc-button" disabled={dialog.isBusy} onClick={store.dialogClose}>Close</button>
			</p>
			{writtenList.length > 0 ? (
				<div className="zettel-dialog-written">
					<h5>Written by this zettel</h5>
					{writtenList.map((connection, index) => {
						const other = zettelGet(model, connection.to);
						return (
							<p key={`${connection.type}:${connection.to}:${index}`} className="zettel-dialog-written-row">
								<span className="zettel-dialog-written-type">{CONNECT_TYPE_LIST.find((type) => type.id === connection.type)?.label}</span>
								<span className="zettel-dialog-written-to">{other ? zettelTitleOf(other) : connection.to}</span>
								<button type="button" className="zettel-bar-button" disabled={dialog.isBusy} title="Take this connection away" aria-label="Take this connection away" onClick={() => void store.connectionRemoveRun(service, connection, { editStore })}><Trash2 size={12} aria-hidden="true" /></button>
							</p>
						);
					})}
				</div>
			) : null}
		</form>
	);
});

// a zettel chosen by words: the field, the zettels holding them, the one chosen
const ZettelPick = observer(function ZettelPick({ model, label, text, keyChosen, onText, onChoose }) {
	const chosen = zettelGet(model, keyChosen);
	const hitList = text.trim() ? zettelSearch(model, text, { limit: 8 }) : [];
	return (
		<div className="zettel-dialog-field"><span>{label}</span>
			<span className="zettel-pick">
				{chosen ? (
					<span className="zettel-pick-chosen"><span>{zettelTitleOf(chosen)}</span><button type="button" className="zettel-bar-button" aria-label="Choose another" onClick={() => onText('')}><X size={12} aria-hidden="true" /></button></span>
				) : (
					<label className="doc-search-field">
						<Search size={12} aria-hidden="true" className="doc-search-field-icon" />
						<input className="doc-search-field-input" type="text" value={text} placeholder="words of its title, q12" spellCheck={false} onChange={(event) => onText(event.target.value)} />
					</label>
				)}
				{!chosen && hitList.length > 0 ? (
					<span className="zettel-pick-list" role="listbox">
						{hitList.map((hit) => <button key={hit.zettel.key} type="button" role="option" aria-selected="false" onClick={() => onChoose(hit.zettel.key)}><span>{zettelTitleOf(hit.zettel)}</span><em>{hit.zettel.key}</em></button>)}
					</span>
				) : null}
			</span>
		</div>
	);
});

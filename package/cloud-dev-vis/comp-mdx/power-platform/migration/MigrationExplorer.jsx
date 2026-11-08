import { useId, useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { useObjectFrontendDrawTurn } from '../../../../../main/comp-doc/object-frontend/use-object-frontend-draw-turn.js';
import { SwitchViewport, switchCaptureActionBuild, SwitchBarMenu, useSwitchStore } from '../../card-diagram-switch/CardDiagramSwitch.jsx';
import { switchRegistryBuild } from '../../card-diagram-switch/SwitchNodeKinds.jsx';
import { SwitchAnimation } from '../../card-diagram-switch/SwitchAnimation.jsx';
import { switchAnimationNormalize } from '../../card-diagram-switch/SwitchAnimationStore.js';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { MIGRATION_KIND_LIST, migrationCategoryOf, migrationModelBuild, migrationPartitionOf, migrationPathBuild } from './MigrationData.js';
import { migrationProviderBuild } from './MigrationScenes.js';
import './Migration.css';

export const migrationSwitchRegistry = switchRegistryBuild(powerPlatformNodeRegistry);

// the data items of one category, as the object's assets say now: what is still being
// read, and what is read. signature: their text, what the scenes depend on
export function migrationItemListRead(service, category) {
	const assetList = service.assetList().filter((asset) => MIGRATION_KIND_LIST.includes(asset.kind) && migrationCategoryOf(asset.pathList?.[0]) === category);
	const itemList = [];
	const problemList = [];
	const textList = [];
	let countLoading = 0;
	for (const asset of assetList) {
		const result = service.assetDataGet(asset.key);
		if (result.status === 'loading') { countLoading += 1; continue; }
		if (result.status === 'error') { problemList.push(`${asset.pathList?.[0] ?? asset.key}: ${result.message}`); continue; }
		textList.push(asset.key, result.text);
		itemList.push({ key: asset.key, kind: asset.kind, name: asset.name, path: asset.pathList?.[0] ?? '', data: result.data });
	}
	return { itemList, problemList, countLoading, countAll: assetList.length, signature: textList.join('\u0000') };
}

// the model of a category, built when its data changes, and given once this block's turn to
// draw has come (what is drawn from it is what takes long to mount). until then the block
// shows what is read so far (MigrationLoading). signature: the data the model was built
// from, which a provider of its scenes is known by (useSwitchStore)
export function useMigrationModel(service, category) {
	const read = migrationItemListRead(service, category);
	const isLoading = read.countLoading > 0;
	const built = useMemo(() => (isLoading ? null : { model: migrationModelBuild(category, read.itemList), signature: `${category}\u0000${read.signature}` }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[category, read.signature, isLoading]);
	// an item written is read again: what was drawn stays until it is
	const builtLast = useRef(null);
	if (built) builtLast.current = built;
	const isDrawTurn = useObjectFrontendDrawTurn(service, Boolean(builtLast.current));
	const isShown = isDrawTurn && builtLast.current?.model.category === category;
	return { read, model: isShown ? builtLast.current.model : null, signature: isShown ? builtLast.current.signature : '' };
}

// a mode of a migration: the scenes of its data, the category chosen by the block.
//
//   param.category   example (default), or real: the first folder of the items
//   param.path       the scene shown first
//   param.height     the height of the block
export const MigrationExplorer = observer(function MigrationExplorer({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">MigrationExplorer is a mode of a migration (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const category = param.category ?? 'example';
	const { read, model, signature } = useMigrationModel(service, category);
	if (!model) return <MigrationLoading read={read} param={param} />;
	if (read.countAll === 0) return <p className="doc-note">There are no items under /{category}.</p>;
	return <MigrationExplorerBody service={service} model={model} signature={signature} read={read} param={param} config={config} category={category} />;
});

// as tall as the block will be, so what is below does not jump when it is drawn
export function MigrationLoading({ read, param = {} }) {
	return (
		<div style={{ minHeight: Number(param.height) || undefined }}>
			<p className="doc-status doc-object-frontend-line">
				<LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
				<span>Reading the data items ({read.countAll - read.countLoading} of {read.countAll})</span>
			</p>
		</div>
	);
}

// a box adjusted by the reader: written in the layout item of the category
export function migrationBoxSaveBuild(service, model, category) {
	return async (path, rect) => {
		if (!service.isEditable) return { code: -1, message: service.editUnavailableReason };
		const layout = { ...model.layout, sceneByPath: { ...model.layout.sceneByPath, [path]: { ...model.layout.sceneByPath?.[path], box: rect } } };
		if (model.layoutKey) return service.assetWrite(model.layoutKey, layout, `the bounding box of ${path}`);
		const partition = migrationPartitionOf(service.assetList(), category);
		return service.assetCreate({ key: `${category}.layout`, kind: 'layout', name: 'Layout', pathList: [migrationPathBuild(category, 'layout')], ...(partition ? { partition } : {}), data: layout });
	};
}

const MigrationExplorerBody = observer(function MigrationExplorerBody({ service, model, signature, read, param, config, category }) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const rootRef = useRef(null);
	const provider = useMemo(() => migrationProviderBuild(model, { onBoxSave: migrationBoxSaveBuild(service, model, category), signature }), [model, service, category, signature]);
	const store = useSwitchStore({ provider, registry: migrationSwitchRegistry, pathInitial: param.path, scope: `.doc-switch-${instanceId}`, config });
	const title = model.system.title || 'Migration';
	const capture = switchCaptureActionBuild({ store, rootRef, titleGet: () => title });
	const problemList = [...read.problemList, ...model.problemList];
	const heightWritten = Number(param.height);
	const height = Number.isFinite(heightWritten) ? Math.max(240, Math.min(1400, heightWritten)) : 640;
	return (
		<BlockPopupSurface config={config} title={title} popupKey={`migration:${config.instanceId ?? instanceId}`} className="doc-switch-shell not-prose">
			{({ isInPopup }) => (
				<>
					<SwitchViewport store={store} config={config} registry={migrationSwitchRegistry} height={height} isInPopup={isInPopup} rootRef={rootRef} barTrailing={<SwitchBarMenu action={capture} />} />
					{problemList.length > 0 ? (
						<ul className="doc-migration-problem" role="status">
							{problemList.map((problem) => <li key={problem}>{problem}</li>)}
						</ul>
					) : null}
					{model.unverifiedList.length > 0 ? <p className="doc-migration-unverified" role="status">{model.unverifiedList.length} items are marked unverified (isUnverified): {model.unverifiedList.join(', ')}</p> : null}
				</>
			)}
		</BlockPopupSurface>
	);
});

// a mode of a migration: a tour of its scenes under the animation layer. the states are
// written in the block; every scene they name comes from the data.
//
//   param.category, param.height    as in MigrationExplorer
//   param.stateList                 [{ id, name, description?, scene: a path, box?: a region }]
//   param.transitionList, param.fps as in an animation
export const MigrationTour = observer(function MigrationTour({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">MigrationTour is a mode of a migration (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const category = param.category ?? 'example';
	const { read, model, signature } = useMigrationModel(service, category);
	if (!model) return <MigrationLoading read={read} param={param} />;
	return <MigrationTourBody service={service} model={model} signature={signature} param={param} config={config} category={category} />;
});

const MigrationTourBody = observer(function MigrationTourBody({ service, model, signature, param, config, category }) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const rootRef = useRef(null);
	const load = useMemo(() => {
		try {
			return { spec: switchAnimationNormalize({ ...param, title: param.title ?? model.system.title }) };
		} catch (error) {
			return { message: String(error?.message ?? error) };
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(param), model]);
	const provider = useMemo(() => migrationProviderBuild(model, { onBoxSave: migrationBoxSaveBuild(service, model, category), signature }), [model, service, category, signature]);
	const store = useSwitchStore({ provider, registry: migrationSwitchRegistry, pathInitial: load.spec?.stateList.find((state) => state.id === load.spec.stateIdInitial)?.path, scope: `.doc-switch-${instanceId}`, config });
	const capture = switchCaptureActionBuild({ store, rootRef, titleGet: () => load.spec?.title || 'Migration' });
	if (load.message) return <p className="doc-error">{load.message}</p>;
	const heightWritten = Number(param.height);
	const height = Number.isFinite(heightWritten) ? Math.max(240, Math.min(1400, heightWritten)) : 640;
	return (
		<BlockPopupSurface config={config} title={load.spec.title || 'Migration'} popupKey={`migration-tour:${instanceId}`} className="doc-switch-shell not-prose">
			{({ isInPopup }) => <SwitchAnimation spec={load.spec} switchStore={store} config={config} registry={migrationSwitchRegistry} height={height} isInPopup={isInPopup} rootRef={rootRef} barTrailing={<SwitchBarMenu action={capture} />} />}
		</BlockPopupSurface>
	);
});

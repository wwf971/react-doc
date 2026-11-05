import { useId, useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { SwitchViewport, switchCaptureActionBuild, SwitchBarMenu, useSwitchStore } from '../../card-diagram-switch/CardDiagramSwitch.jsx';
import { switchRegistryBuild } from '../../card-diagram-switch/SwitchNodeKinds.jsx';
import { SwitchAnimation } from '../../card-diagram-switch/SwitchAnimation.jsx';
import { switchAnimationNormalize } from '../../card-diagram-switch/SwitchAnimationStore.js';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { MIGRATION_KIND_LIST, migrationCategoryOf, migrationModelBuild, migrationPathBuild } from './MigrationData.js';
import { migrationProviderBuild } from './MigrationViews.js';
import './Migration.css';

export const migrationSwitchRegistry = switchRegistryBuild(powerPlatformNodeRegistry);

// the data items of one category, as the object's assets say now: what is still being
// read, and what is read. signature: their text, what the views depend on
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

// the model of a category, built when its data changes
export function useMigrationModel(service, category) {
	const read = migrationItemListRead(service, category);
	const isLoading = read.countLoading > 0;
	const modelBuilt = useMemo(() => (isLoading ? null : migrationModelBuild(category, read.itemList)),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[category, read.signature, isLoading]);
	// an item written is read again: what was drawn stays until it is
	const modelLast = useRef(null);
	if (modelBuilt) modelLast.current = modelBuilt;
	return { read, model: modelLast.current?.category === category ? modelLast.current : null };
}

// a mode of a migration: the views of its data, the category chosen by the block.
//
//   param.category   example (default), or real: the first folder of the items
//   param.path       the view shown first
//   param.height     the height of the block
export const MigrationExplorer = observer(function MigrationExplorer({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">MigrationExplorer is a mode of a migration (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const category = param.category ?? 'example';
	const { read, model } = useMigrationModel(service, category);
	if (!model) return <MigrationLoading read={read} />;
	if (read.countAll === 0) return <p className="doc-note">There are no items under /{category}.</p>;
	return <MigrationExplorerBody service={service} model={model} read={read} param={param} config={config} category={category} />;
});

export function MigrationLoading({ read }) {
	return (
		<p className="doc-status doc-object-frontend-line">
			<LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
			<span>Reading the data items ({read.countAll - read.countLoading} of {read.countAll})</span>
		</p>
	);
}

// a box adjusted by the reader: written in the layout item of the category
export function migrationBoxSaveBuild(service, model, category) {
	return async (path, rect) => {
		if (!service.isWritable) return { code: -1, message: service.writeUnavailableReason };
		const layout = { ...model.layout, viewByPath: { ...model.layout.viewByPath, [path]: { ...model.layout.viewByPath?.[path], box: rect } } };
		if (model.layoutKey) return service.assetWrite(model.layoutKey, layout, `the bounding box of ${path}`);
		return service.assetCreate({ key: `${category}.layout`, kind: 'layout', name: 'Layout', pathList: [migrationPathBuild(category, 'layout')], data: layout });
	};
}

const MigrationExplorerBody = observer(function MigrationExplorerBody({ service, model, read, param, config, category }) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const rootRef = useRef(null);
	const provider = useMemo(() => migrationProviderBuild(model, { onBoxSave: migrationBoxSaveBuild(service, model, category) }), [model, service, category]);
	const store = useSwitchStore({ provider, registry: migrationSwitchRegistry, pathInitial: param.path, scope: `.doc-switch-${instanceId}` });
	const title = model.system.title || 'Migration';
	const capture = switchCaptureActionBuild({ store, rootRef, titleGet: () => title });
	const problemList = [...read.problemList, ...model.problemList];
	const heightWritten = Number(param.height);
	const height = Number.isFinite(heightWritten) ? Math.max(240, Math.min(1400, heightWritten)) : 640;
	return (
		<BlockPopupSurface config={config} title={title} popupKey={`migration:${instanceId}`} className="doc-switch-shell not-prose">
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

// a mode of a migration: a tour of its views under the animation layer. the states are
// written in the block; every view they name comes from the data.
//
//   param.category, param.height    as in MigrationExplorer
//   param.stateList                 [{ id, name, description?, view: a path, box?: a region }]
//   param.transitionList, param.fps as in an animation
export const MigrationTour = observer(function MigrationTour({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">MigrationTour is a mode of a migration (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const category = param.category ?? 'example';
	const { read, model } = useMigrationModel(service, category);
	if (!model) return <MigrationLoading read={read} />;
	return <MigrationTourBody service={service} model={model} param={param} config={config} category={category} />;
});

const MigrationTourBody = observer(function MigrationTourBody({ service, model, param, config, category }) {
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
	const provider = useMemo(() => migrationProviderBuild(model, { onBoxSave: migrationBoxSaveBuild(service, model, category) }), [model, service, category]);
	const store = useSwitchStore({ provider, registry: migrationSwitchRegistry, pathInitial: load.spec?.stateList.find((state) => state.id === load.spec.stateIdInitial)?.path, scope: `.doc-switch-${instanceId}` });
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

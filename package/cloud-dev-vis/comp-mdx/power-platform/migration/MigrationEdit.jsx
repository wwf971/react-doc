import { useMemo, useState } from 'react';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Pencil, Plus, Trash2 } from '../../../../../main/frontend/UICommon.js';
import { DocEditBlockFloatContext } from '../../../../../main/comp-doc/edit/DocEditDocContext.js';
import { useCompState } from '../../../../../main/comp-doc/registry/use-comp-state.js';
import { ObjectFrontendAssetPathInput } from '../../../../../main/comp-doc/object-frontend/ObjectFrontendAssetPathInput.jsx';
import { DiagramERView } from '../../card-diagram/CardDiagram.jsx';
import { CardStandaloneView } from '../../card-diagram/CardStandalone.jsx';
import { DiagramVisualEdit } from '../../card-diagram/DiagramVisualEdit.jsx';
import { MigrationLoading, useMigrationModel } from './MigrationExplorer.jsx';
import { MIGRATION_KIND_LIST, migrationCategoryOf, migrationPartitionOf } from './MigrationData.js';
import { objectFrontendPartitionPlaceText } from '../../../../../main/frontend/src/lib/doc-object-frontend.js';
import { migrationDbListOf, migrationEditAdapterByKind, migrationItemNewBuild, migrationItemOf } from './MigrationEditData.js';
import './Migration.css';

// The editors of the data items of a migration (power-platform-migration.md#editing):
// one mode per kind of item, one host. The item chosen is drawn by the card or diagram
// the framework draws; its Edit button opens the framework's visual editor on it, with
// undo and redo; Save hands the draft to the item's adapter, whose writes go through
// the object's api.
//
//   param.category   example (default), or real
//   param.item       the item shown first: a path, a key, name:…
class MigrationEditStore {
	itemRef = '';
	isEditing = false;
	status = 'editing';
	message = '';
	token = 0;
	formValue = {};
	formMessage = '';
	isFormOpen = false;
	floatElement = null;

	// onItemRefChange: the item chosen, told to whoever keeps it beyond this mount
	constructor(itemRef, onItemRefChange) {
		this.itemRef = itemRef ?? '';
		this.onItemRefChange = onItemRefChange;
		makeAutoObservable(this, { floatElement: observable.ref, onItemRefChange: false }, { autoBind: true });
	}

	floatElementSet(element) {
		this.floatElement = element;
	}

	itemRefSet(itemRef) {
		this.itemRef = itemRef;
		this.onItemRefChange?.(itemRef);
		this.isEditing = false;
		this.status = 'editing';
		this.message = '';
	}

	editStart() {
		this.isEditing = true;
		this.status = 'editing';
		this.message = '';
		this.token += 1;
	}

	editEnd() {
		this.isEditing = false;
		this.status = 'editing';
		this.message = '';
	}

	formToggle() {
		this.isFormOpen = !this.isFormOpen;
		this.formMessage = '';
	}

	formSet(change) {
		this.formValue = { ...this.formValue, ...change };
	}

	// a refused or failed write keeps the session open with its reason
	async save(run) {
		this.status = 'submitting';
		this.message = '';
		try {
			await run();
			runInAction(() => this.editEnd());
		} catch (error) {
			runInAction(() => {
				this.status = 'error';
				this.message = String(error?.message ?? error);
			});
		}
	}

	async formCreate(run) {
		try {
			const path = await run();
			runInAction(() => {
				this.isFormOpen = false;
				this.formValue = {};
				this.formMessage = '';
				this.itemRefSet(path);
			});
		} catch (error) {
			runInAction(() => { this.formMessage = String(error?.message ?? error); });
		}
	}
}

async function resultCheck(promise) {
	const result = await promise;
	if (result && result.code !== undefined && result.code !== 0) throw new Error(result.message);
	return result;
}

// the writes of a draft, in an order leaving nothing half done: what is new first, the
// lists naming it next, what left last. what is new goes to the partition of its category
async function writesRun(service, { createList = [], writeList = [], removeList = [] }, partition) {
	for (const item of createList) await resultCheck(service.assetCreate({ ...item, ...(partition ? { partition } : {}) }));
	for (const item of writeList) await resultCheck(service.assetWrite(item.ref, item.data, item.note));
	for (const ref of removeList) await resultCheck(service.assetRemove(ref));
}

const MigrationEditView = observer(function MigrationEditView({ store, service, kind, item, model, adapter, blockConfig }) {
	const load = useMemo(() => {
		try {
			return { source: adapter.sourceBuild(item, model), registry: adapter.registryGet(model) };
		} catch (error) {
			return { message: String(error?.message ?? error) };
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adapter, item, model]);
	if (load.message) return <p className="doc-error">{load.message}</p>;
	// the diagram is the block's, per item: what it keeps across its mounts is found again
	// (the document entering or leaving edit mode mounts it again, card-diagram CanvasStill)
	const config = { isEdit: store.isEditing, edit: { modeId: 'visual', session: { status: store.status, message: store.message } }, instanceId: `migration-edit-${item.key}`, ...(blockConfig.stateKey ? { stateKey: `${blockConfig.stateKey}|item:${item.key}`, compId: blockConfig.compId } : {}) };
	const onEvent = (eventType, payload) => {
		if (eventType === 'editCancelRequest') store.editEnd();
		else if (eventType === 'editSubmitRequest') {
			void store.save(async () => {
				if (!payload.isDirty) return;
				await writesRun(service, adapter.writesBuild(payload.raw, item, model), migrationPartitionOf(service.assetList(), model.category));
			});
		}
		return Promise.resolve({ code: 0 });
	};
	const contentOf = (props) => (adapter.kind === 'diagram'
		? <DiagramERView {...props} config={config} onEvent={onEvent} registry={load.registry} />
		: <CardStandaloneView {...props} registry={load.registry} />);
	return (
		<div className="doc-migration-edit-body">
			<DocEditBlockFloatContext.Provider value={store.floatElement}>
				{store.isEditing
					? <DiagramVisualEdit key={`${item.key}:${store.token}`} data={{ raw: load.source }} config={config} onEvent={onEvent} kind={adapter.kind} registry={load.registry} renderContent={contentOf} />
					: contentOf({ data: { raw: load.source, source: load.source } })}
			</DocEditBlockFloatContext.Provider>
		</div>
	);
});

const MigrationNewForm = observer(function MigrationNewForm({ store, service, kind, model }) {
	const form = store.formValue;
	const isSchema = kind.startsWith('schema');
	const isTable = kind === 'mapping-table';
	const map = isTable ? model.tableByKey : model.choiceByKey;
	const listOf = (dbId) => [...map.values()].filter((item) => item.db === dbId);
	const { source, target } = model.system;
	// where the new item goes: the partition of its category, said beside the button
	const partitionId = migrationPartitionOf(service.assetList(), model.category);
	const partition = (service.partitionList ?? []).find((one) => one.id === partitionId);
	const create = () => store.formCreate(async () => {
		const item = migrationItemNewBuild(kind, model, { db: source.id, ...form });
		await resultCheck(service.assetCreate({ ...item, ...(partitionId ? { partition: partitionId } : {}) }));
		return item.pathList[0];
	});
	return (
		<div className="doc-migration-new">
			{isSchema ? <>
				<select aria-label="Database" value={form.db ?? source.id} onChange={(event) => store.formSet({ db: event.target.value })}>
					{migrationDbListOf(model).map((db) => <option key={db.id} value={db.id}>{db.name}</option>)}
				</select>
				<input aria-label="Logical name" placeholder="logical_name" value={form.logical ?? ''} onChange={(event) => store.formSet({ logical: event.target.value })} />
				<input aria-label="Name" placeholder="Name" value={form.name ?? ''} onChange={(event) => store.formSet({ name: event.target.value })} />
			</> : <>
				<select aria-label="Source" value={form.source ?? ''} onChange={(event) => store.formSet({ source: event.target.value })}>
					<option value="">{source.name}…</option>
					{listOf(source.id).map((item) => <option key={item.key} value={item.key}>{item.name} ({item.logical})</option>)}
				</select>
				<select aria-label="Target" value={form.target ?? ''} onChange={(event) => store.formSet({ target: event.target.value })}>
					<option value="">{target.name}…</option>
					{listOf(target.id).map((item) => <option key={item.key} value={item.key}>{item.name} ({item.logical})</option>)}
				</select>
			</>}
			<button type="button" className="doc-button" onClick={create}>Create</button>
			<span className="doc-migration-new-place">goes to {objectFrontendPartitionPlaceText(partition)}</span>
			{store.formMessage ? <span className="doc-migration-new-message" role="alert">{store.formMessage}</span> : null}
		</div>
	);
});

// the host of a kind: the item chosen by its path, its editor, a new one
function migrationItemEditCreate(kind, name, isCreateOffered = true) {
	const Comp = observer(function MigrationItemEdit({ data = {}, config = {} }) {
		const service = config.objectFrontend;
		const param = data.param ?? {};
		const category = param.category ?? 'example';
		// the item the reader chose is the block's: kept while the block is mounted again (the
		// document entering or leaving edit mode), for as long as the block names the same one
		const blockState = useCompState(config, { itemRef: '', itemParam: '' });
		const [store] = useState(() => new MigrationEditStore(
			blockState.value.itemParam === (param.item ?? '') && blockState.value.itemRef ? blockState.value.itemRef : param.item,
			(itemRef) => blockState.patch({ itemRef, itemParam: param.item ?? '' }),
		));
		if (!service) return <p className="doc-error">{name} is a mode of a migration (ObjectFrontend).</p>;
		const { read, model } = useMigrationModel(service, category);
		if (!model) return <MigrationLoading read={read} />;
		const adapter = migrationEditAdapterByKind[kind];
		const assetListKind = service.assetList(kind).filter((asset) => migrationCategoryOf(asset.pathList?.[0]) === category);
		const resolved = store.itemRef ? service.assetResolve(store.itemRef) : { asset: assetListKind[0] };
		const asset = resolved.asset;
		const item = asset ? migrationItemOf(model, kind, asset.key) : null;
		const path = asset?.pathList?.[0] ?? store.itemRef;
		return (
			<div className="doc-migration-edit not-prose">
				<div className="doc-migration-edit-head">
					<ObjectFrontendAssetPathInput object={service.ref} value={path} kindList={[kind]} base={`/${category}/`} isMissingWarned onChoose={(pathChosen) => store.itemRefSet(typeof pathChosen === 'string' ? pathChosen : pathChosen?.path ?? '')} />
					{/* the controls that change data show while the document is edited (react-doc:
					    main/doc_page_impl_obj_frontend.md#reading-and-editing) */}
					{item && service.docState?.isEditing ? (
						<button type="button" className={`doc-button${store.isEditing ? ' is-room-kept' : ''}`} disabled={!service.isEditable} title={service.isEditable ? 'Edit this item' : service.editUnavailableReason} onClick={store.editStart}>
							<Pencil size={12} aria-hidden="true" /><span>Edit</span>
						</button>
					) : null}
					{isCreateOffered && service.docState?.isEditing ? (
						<button type="button" className={`doc-button${store.isEditing ? ' is-room-kept' : ''}`} disabled={!service.isEditable} title={service.isEditable ? 'A new item' : service.editUnavailableReason} aria-expanded={store.isFormOpen} onClick={store.formToggle}>
							<Plus size={12} aria-hidden="true" /><span>New</span>
						</button>
					) : null}
					{/* the bar of the editor stands over this line, so entering moves nothing */}
					<div ref={store.floatElementSet} className="doc-migration-edit-float" />
				</div>
				{store.isFormOpen && service.docState?.isEditing ? <MigrationNewForm store={store} service={service} kind={kind} model={model} /> : null}
				{item ? <MigrationEditView key={item.key} store={store} service={service} kind={kind} item={item} model={model} adapter={adapter} blockConfig={config} />
					: <p className="doc-note">{store.itemRef ? `There is no ${kind} at ${store.itemRef}.` : `There is no ${kind} under /${category} yet.`}</p>}
			</div>
		);
	});
	Comp.displayName = name;
	return Comp;
}

export const MigrationSchemaTableEdit = migrationItemEditCreate('schema-table', 'MigrationSchemaTableEdit');
export const MigrationSchemaChoiceEdit = migrationItemEditCreate('schema-choice', 'MigrationSchemaChoiceEdit');
export const MigrationMappingTableEdit = migrationItemEditCreate('mapping-table', 'MigrationMappingTableEdit');
export const MigrationMappingColumnEdit = migrationItemEditCreate('mapping-column', 'MigrationMappingColumnEdit', false);
export const MigrationMappingChoiceEdit = migrationItemEditCreate('mapping-choice', 'MigrationMappingChoiceEdit');

// every item of the object, by category and kind, with its path; removing one
export const MigrationItemList = observer(function MigrationItemList({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	if (!service) return <p className="doc-error">MigrationItemList is a mode of a migration (ObjectFrontend).</p>;
	const param = data.param ?? {};
	const categoryList = param.category ? [param.category] : [...new Set(service.assetList().map((asset) => migrationCategoryOf(asset.pathList?.[0])).filter(Boolean))];
	return (
		<div className="doc-migration-list not-prose">
			{categoryList.map((category) => (
				<section key={category} className="doc-migration-list-category">
					<h4>/{category}</h4>
					{MIGRATION_KIND_LIST.map((kind) => {
						const assetList = service.assetList(kind).filter((asset) => migrationCategoryOf(asset.pathList?.[0]) === category);
						if (assetList.length === 0) return null;
						return (
							<details key={kind} className="doc-migration-list-kind">
								<summary><span>{kind}</span><em>{assetList.length}</em></summary>
								<ul>
									{assetList.map((asset) => (
										<li key={asset.key}>
											<span className="doc-migration-list-name">{asset.name || asset.key}</span>
											<span className="doc-migration-list-path">{asset.pathList?.[0]}</span>
											<span className={`doc-migration-list-state${asset.status === 'found' ? '' : ' is-problem'}`}>{asset.status === 'found' ? '' : asset.status}</span>
											{service.docState?.isEditing ? <button type="button" className="doc-button-icon" title={service.isEditable ? 'Remove this item' : service.editUnavailableReason} aria-label={`Remove ${asset.key}`} disabled={!service.isEditable} onClick={() => void service.assetRemove(asset.key)}><Trash2 size={12} aria-hidden="true" /></button> : null}
										</li>
									))}
								</ul>
							</details>
						);
					})}
				</section>
			))}
		</div>
	);
});

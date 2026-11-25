import { observer } from 'mobx-react-lite';
import { Eye, EyeOff, Layers, Plus, Settings, TriangleAlert, X } from '../../../../main/frontend/UICommon.js';
import { useCompState } from '../../../../main/comp-doc/registry/use-comp-state.js';
import { EditValueInline } from '../../../../main/comp-doc/edit/EditValueInline.jsx';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { objectFrontendPartitionPlaceText } from '../../../../main/frontend/src/lib/doc-object-frontend.js';
import {
	APP_CONFIG_KIND_DECLARE, APP_CONFIG_KIND_LAYER, APP_CONFIG_LAYER_FIRST,
	appConfigDeclareListMerge, appConfigDeclareParse, appConfigLayerKeyBuild, appConfigLayerNameBuild, appConfigLayerParse,
	appConfigLayerPathBuild, appConfigLayerWriteTarget, appConfigStack, appConfigValueAt, appConfigValueFromText, appConfigValueSet,
	appConfigValueText,
} from './AppConfigData.js';
import './AppConfig.css';

// The mode of a config object (doc/README.md#the-mode): modes final (param.section: final) and
// layers (section: layers) of the type app-config.config, one component.
//
//   final    every declared key: its label, its final value, the layer it came from (or the
//            default); the problems of the layers; the layers in stack order, in short
//   layers   the layers in stack order, each with what it sets
//
// In reading mode it only shows. While the document is edited (service.docState.isEditing; enabled
// by service.isEditable) a value is changed in the layer chosen ("writes into"), a layer is made in
// a partition (the form says where it goes), and one is disabled or enabled. Every write goes
// through config.objectFrontend (assetWrite, assetCreate): the layer is the asset, its text yaml.

const ENUM_BUTTON_MAX = 6;

export const AppConfigView = observer(function AppConfigView({ data = {}, config = {} }) {
	const service = config.objectFrontend;
	const draft = useCompState(config, { writeLayer: '', label: '', order: '', partition: '', message: '', isBusy: false });
	// a value of a config is no prose: nothing of it is read as a style
	const cell = useCell({ tokenIdList: [], isStyled: false, config });
	if (!service) return <p className="doc-error">AppConfigView is a mode of a config object (ObjectFrontend).</p>;
	const section = data.param?.section === 'layers' ? 'layers' : 'final';
	const model = appConfigModelRead(service);
	const isEditing = service.docState?.isEditing === true;
	const value = draft.value;
	const writeTarget = writeTargetOf(model, value.writeLayer);
	return (
		<div className="app-config not-prose">
			<div className="app-config-head">
				<Settings size={15} aria-hidden="true" />
				<span className="app-config-title">{service.object.name || 'App config'}</span>
				<span className="doc-note">{model.declareList.length ? `${model.declareList.length} keys` : 'no declaration: every value as set'} · {model.layerList.length} {model.layerList.length === 1 ? 'layer' : 'layers'}</span>
				<span className="doc-button-group app-config-section" role="group" aria-label="What is shown">
					<button type="button" aria-pressed={section === 'final'} onClick={() => void service.modeSet('final', { isSaved: false })}>Final config</button>
					<button type="button" aria-pressed={section === 'layers'} onClick={() => void service.modeSet('layers', { isSaved: false })}>Layers</button>
				</span>
			</div>
			{model.readProblemList.map((text) => <p key={text} className="doc-error">{text}</p>)}
			{section === 'final' ? (
				<>
					{isEditing ? <WriteTargetLine service={service} model={model} writeTarget={writeTarget} draft={draft} /> : null}
					<FinalTable service={service} model={model} cell={cell} isEditing={isEditing} writeTarget={writeTarget} draft={draft} />
					<ProblemList model={model} />
					<LayerList service={service} model={model} isEditing={isEditing} isShort draft={draft} />
				</>
			) : (
				<>
					<LayerList service={service} model={model} isEditing={isEditing} draft={draft} />
					<ProblemList model={model} />
				</>
			)}
			{value.message ? <p className="doc-note app-config-message">{value.message}</p> : null}
		</div>
	);
});

// the object read into what the stack needs: the declared keys, the layers (with their assets), the
// order of the partitions, and the stack itself
export function appConfigModelRead(service) {
	const readProblemList = [];
	const declareKeyListList = [];
	for (const asset of service.assetList(APP_CONFIG_KIND_DECLARE)) {
		const read = service.assetDataGet(asset.key);
		if (read.status === 'error') readProblemList.push(`${asset.key}: ${read.message}`);
		const parsed = appConfigDeclareParse(read.data ?? {});
		if (parsed.message) readProblemList.push(`${asset.key}: ${parsed.message}`);
		declareKeyListList.push(parsed.keyList);
	}
	const layerList = service.assetList(APP_CONFIG_KIND_LAYER).map((asset) => {
		const read = service.assetDataGet(asset.key);
		const parsed = appConfigLayerParse(read.data ?? {});
		if (read.status === 'error') readProblemList.push(`${asset.key}: ${read.message}`);
		else if (parsed.message) readProblemList.push(`${asset.key}: ${parsed.message}`);
		return { key: asset.key, partition: asset.partition ?? '', asset, data: read.data ?? {}, ...parsed };
	});
	const partitionList = service.partitionList ?? [];
	const partitionDeclaredList = partitionList.filter((one) => one.isDeclared !== false).map((one) => one.id);
	const stack = appConfigStack({
		declareList: appConfigDeclareListMerge(declareKeyListList),
		layerList,
		partitionOrder: Array.isArray(service.object.metadata?.partitionOrder) ? service.object.metadata.partitionOrder : null,
		partitionDeclaredList,
	});
	const partitionById = Object.fromEntries(partitionList.map((one) => [one.id, one]));
	return { ...stack, partitionList, partitionById, partitionDefault: service.partitionDefault?.id ?? APP_CONFIG_LAYER_FIRST.partition, readProblemList };
}

// the layer a change goes to: the one chosen, else the top-most of the default partition; null:
// none yet, the first change makes local.main
function writeTargetOf(model, layerKey) {
	const chosen = model.layerList.find((layer) => layer.key === layerKey && !layer.isDisabled);
	return chosen ?? appConfigLayerWriteTarget({ layerOrder: model.layerOrder, layerList: model.layerList, partitionDefault: model.partitionDefault });
}

const layerNameOf = (layer, model) => `${model.partitionById[layer.partition]?.label ?? layer.partition} · ${layer.label || layer.key}`;

// a key changed in a layer: the layer written whole (its other keys as they are), or the first layer
// made with it
async function valueWrite(service, model, writeTarget, key, nextValue) {
	if (writeTarget) {
		const next = { ...writeTarget.data, label: writeTarget.label || writeTarget.key, order: writeTarget.order, value: appConfigValueSet(writeTarget.value, key, nextValue) };
		if (!writeTarget.isDisabled) delete next.isDisabled;
		return service.assetWrite(writeTarget.key, next, `${key}: ${appConfigValueText(nextValue)}`);
	}
	if (nextValue === null) return { code: 0 };
	const first = APP_CONFIG_LAYER_FIRST;
	return service.assetCreate({
		key: appConfigLayerKeyBuild(first.partition, first.name),
		kind: APP_CONFIG_KIND_LAYER,
		name: first.label,
		pathList: [appConfigLayerPathBuild(first.partition, first.name)],
		partition: first.partition,
		data: { label: first.label, order: first.order, value: appConfigValueSet({}, key, nextValue) },
		note: `${key}: ${appConfigValueText(nextValue)}`,
	});
}

const WriteTargetLine = observer(function WriteTargetLine({ service, model, writeTarget, draft }) {
	const enabledList = model.layerList.filter((layer) => !layer.isDisabled).reverse();
	const firstPartition = model.partitionById[APP_CONFIG_LAYER_FIRST.partition];
	const reason = service.partitionWriteUnavailableReasonGet?.(writeTarget?.partition ?? APP_CONFIG_LAYER_FIRST.partition) ?? '';
	return (
		<div className="app-config-target">
			<span className="doc-note">writes into</span>
			{enabledList.length > 0 ? (
				<select aria-label="The layer a change is written into" value={writeTarget?.key ?? ''} disabled={!service.isEditable} onChange={(event) => draft.patch({ writeLayer: event.target.value })}>
					{writeTarget ? null : <option value="">a new layer {APP_CONFIG_LAYER_FIRST.label}</option>}
					{enabledList.map((layer) => <option key={layer.key} value={layer.key}>{layerNameOf(layer, model)}</option>)}
				</select>
			) : <span>a new layer, {APP_CONFIG_LAYER_FIRST.label}</span>}
			<span className="doc-note">
				{writeTarget
					? `item/${writeTarget.partition}/layer, ${model.partitionById[writeTarget.partition]?.isGitIgnored ? 'kept out of git' : 'tracked by git'}`
					: `made by the first change: ${objectFrontendPartitionPlaceText(firstPartition ?? { id: APP_CONFIG_LAYER_FIRST.partition }, 'layer')}`}
			</span>
			{reason ? <span className="doc-error">{reason}</span> : null}
		</div>
	);
});

const FinalTable = observer(function FinalTable({ service, model, cell, isEditing, writeTarget, draft }) {
	const keyList = model.declareList.length ? model.declareList : Object.keys(model.value).map((key) => ({ key, type: '' }));
	if (keyList.length === 0) return <p className="doc-note">Nothing is declared, and no layer sets anything.</p>;
	const rankOf = (layerKey) => model.layerOrder.indexOf(layerKey);
	const run = async (promise) => {
		draft.patch({ isBusy: true, message: '' });
		const result = await promise;
		draft.patch({ isBusy: false, message: result?.code && result.code !== 0 ? result.message : '' });
		return result;
	};
	return (
		<table className="app-config-table">
			<thead><tr><th>key</th><th>value</th><th>from</th></tr></thead>
			<tbody>
				{keyList.map((declare) => {
					const source = model.sourceByKey[declare.key] ?? { isDefault: true };
					const finalValue = model.value[declare.key];
					const sourceLayer = model.layerList.find((layer) => layer.key === source.layer);
					const inTarget = writeTarget ? appConfigValueAt(writeTarget.value, declare.key) : undefined;
					// a value set in a layer above the one written into: a change there does not show
					const isHiddenAbove = Boolean(writeTarget && sourceLayer && rankOf(sourceLayer.key) > rankOf(writeTarget.key));
					const isEditable = isEditing && service.isEditable && !draft.value.isBusy && declare.type !== '';
					return (
						<tr key={declare.key}>
							<td>
								<span className="app-config-key-label">{declare.label || declare.key}</span>
								{declare.label ? <span className="doc-note app-config-key">{declare.key}</span> : null}
								{declare.description ? <span className="doc-note app-config-key-description">{declare.description}</span> : null}
							</td>
							<td className="app-config-value">
								{isEditing && declare.type ? (
									<ValueEdit declare={declare} value={finalValue} cell={cell} isEditable={isEditable} editUnavailableReason={service.editUnavailableReason}
										onWrite={(next) => run(valueWrite(service, model, writeTarget, declare.key, next))} />
								) : <span className={finalValue === null || finalValue === undefined ? 'doc-note' : ''}>{appConfigValueText(finalValue)}</span>}
							</td>
							<td>
								{source.isDefault ? <span className="doc-note">default</span> : <span className="doc-badge-outline">{sourceLayer ? layerNameOf(sourceLayer, model) : source.layer}</span>}
								{isEditing && isHiddenAbove ? <span className="doc-note app-config-hidden">set above the layer written into</span> : null}
								{isEditing && inTarget !== undefined && inTarget !== null ? (
									<button type="button" className="doc-button-icon app-config-remove" disabled={!isEditable} title={`Remove from ${layerNameOf(writeTarget, model)}: the layer below gives the value`}
										aria-label={`Remove ${declare.key} from ${layerNameOf(writeTarget, model)}`} onClick={() => void run(valueWrite(service, model, writeTarget, declare.key, null))}>
										<X size={12} aria-hidden="true" />
									</button>
								) : null}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
});

// a value changed where it stands: a boolean a switch, a few values a group of buttons, anything
// else a cell of the cell editing kit (main/doc_page_impl_edit_cell.md), read by its type on commit
const ValueEdit = observer(function ValueEdit({ declare, value, cell, isEditable, editUnavailableReason, onWrite }) {
	if (declare.type === 'boolean') {
		return (
			<button type="button" role="switch" aria-checked={value === true} aria-label={declare.label || declare.key} className="app-config-switch"
				disabled={!isEditable} title={isEditable ? '' : editUnavailableReason} onClick={() => void onWrite(value !== true)}>
				<span className="app-config-switch-knob" aria-hidden="true" />
				<span>{value === true ? 'true' : 'false'}</span>
			</button>
		);
	}
	if (declare.type === 'enum' && (declare.valueList ?? []).length <= ENUM_BUTTON_MAX) {
		return (
			<span className="doc-button-group" role="group" aria-label={declare.label || declare.key}>
				{declare.valueList.map((one) => (
					<button key={String(one)} type="button" aria-pressed={one === value} disabled={!isEditable} title={isEditable ? '' : editUnavailableReason}
						onClick={() => { if (one !== value) void onWrite(one); }}>{String(one)}</button>
				))}
			</span>
		);
	}
	const text = declare.type === 'string-list' ? (Array.isArray(value) ? value.join(', ') : '') : value === null || value === undefined ? '' : String(value);
	return (
		<CellField cell={cell} value={text} isEditable={isEditable} editUnavailableReason={editUnavailableReason} placeholder={declare.type === 'string-list' ? 'values, separated by commas' : '(empty)'}
			onCommit={async (typed) => {
				const read = appConfigValueFromText(declare, typed);
				if (read.message) return { code: -1, message: read.message };
				const result = await onWrite(read.value);
				return result?.code ? result : { code: 0 };
			}} />
	);
});

const ProblemList = observer(function ProblemList({ model }) {
	if (model.problemList.length === 0) return null;
	return (
		<div className="app-config-problem-list">
			<span className="app-config-section-title"><TriangleAlert size={13} aria-hidden="true" /> Not used ({model.problemList.length})</span>
			{model.problemList.map((problem) => {
				const layer = model.layerList.find((one) => one.key === problem.layer);
				return (
					<div key={`${problem.layer}:${problem.key}:${problem.kind}`} className="app-config-problem">
						<span className="doc-badge-outline" data-error="">{problem.kind}</span>
						<span className="app-config-key-label">{problem.key}</span>
						<span className="doc-note">in {layer ? layerNameOf(layer, model) : problem.layer}: {problem.message}</span>
					</div>
				);
			})}
		</div>
	);
});

// the layers in stack order, the first at the bottom of the stack: a later one wins
const LayerList = observer(function LayerList({ service, model, isEditing, isShort = false, draft }) {
	const value = draft.value;
	const run = async (promise) => {
		draft.patch({ isBusy: true, message: '' });
		const result = await promise;
		draft.patch({ isBusy: false, message: result?.code && result.code !== 0 ? result.message : '' });
		return result;
	};
	const toggle = (layer) => {
		const next = { ...layer.data, label: layer.label || layer.key, order: layer.order, value: layer.value };
		if (layer.isDisabled) delete next.isDisabled;
		else next.isDisabled = true;
		return run(service.assetWrite(layer.key, next, layer.isDisabled ? 'enabled' : 'disabled'));
	};
	return (
		<div className="app-config-layer-list">
			<span className="app-config-section-title"><Layers size={13} aria-hidden="true" /> Layers, in stack order <span className="doc-note">· a later one wins</span></span>
			{model.layerList.length === 0 ? <p className="doc-note">No layer: the config is its defaults.</p> : null}
			{model.layerList.map((layer, index) => {
				const partition = model.partitionById[layer.partition];
				const leafList = leafListOf(layer.value);
				return (
					<div key={layer.key} className="app-config-layer" data-disabled={layer.isDisabled ? '' : undefined}>
						<div className="app-config-layer-head">
							<span className="app-config-rank">{index + 1}</span>
							<span className="doc-badge-outline" title={partition?.description ?? ''}>{partition?.label ?? layer.partition}{partition?.isGitIgnored ? ' · kept out of git' : ''}</span>
							<span className="app-config-key-label">{layer.label || layer.key}</span>
							<span className="doc-note">{layer.key} · order {layer.order}{layer.isDisabled ? ' · disabled' : ''}</span>
							{isShort ? <span className="doc-note">· {leafList.length} {leafList.length === 1 ? 'value' : 'values'}</span> : null}
							{isEditing ? (
								<button type="button" className="doc-button app-config-layer-toggle" disabled={!service.isEditable || value.isBusy} title={service.isEditable ? '' : service.editUnavailableReason} onClick={() => void toggle(layer)}>
									{layer.isDisabled ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
									<span>{layer.isDisabled ? 'Enable' : 'Disable'}</span>
								</button>
							) : null}
						</div>
						{!isShort && leafList.length > 0 ? (
							<div className="app-config-layer-value">
								{leafList.map(([key, one]) => (
									<span key={key} className="app-config-layer-entry"><span className="doc-note">{key}</span> {appConfigValueText(one)}</span>
								))}
							</div>
						) : null}
						{!isShort && leafList.length === 0 ? <p className="doc-note app-config-layer-value">sets nothing</p> : null}
					</div>
				);
			})}
			{isEditing && !isShort ? <LayerCreate service={service} model={model} draft={draft} run={run} /> : null}
		</div>
	);
});

// a new layer in a partition: its label, its order, and where it goes said before it is made
const LayerCreate = observer(function LayerCreate({ service, model, draft, run }) {
	const value = draft.value;
	const partitionList = model.partitionList.filter((one) => one.isDeclared !== false);
	const partition = partitionList.find((one) => one.id === value.partition) ?? partitionList.find((one) => one.id === model.partitionDefault) ?? partitionList[0];
	const label = value.label.trim();
	const name = appConfigLayerNameBuild(label);
	const key = partition ? appConfigLayerKeyBuild(partition.id, name) : '';
	const isTaken = model.layerList.some((layer) => layer.key === key);
	const orderText = String(value.order ?? '').trim();
	const order = orderText === '' ? 0 : Number(orderText);
	const reason = partition ? service.partitionWriteUnavailableReasonGet?.(partition.id) ?? '' : 'its type declares no partition';
	const create = async () => {
		if (!label) return draft.patch({ message: 'a layer needs a label' });
		if (!Number.isFinite(order)) return draft.patch({ message: 'its order is a number' });
		if (isTaken) return draft.patch({ message: `there is a layer ${key} already` });
		const result = await run(service.assetCreate({
			key, kind: APP_CONFIG_KIND_LAYER, name: label, pathList: [appConfigLayerPathBuild(partition.id, name)], partition: partition.id,
			data: { label, order, value: {} }, note: 'made',
		}));
		if (result?.code === 0) draft.patch({ label: '', order: '', message: `made ${key}` });
	};
	return (
		<div className="app-config-create">
			<span className="app-config-section-title"><Plus size={13} aria-hidden="true" /> New layer</span>
			{!service.isEditable ? <p className="doc-note">{service.editUnavailableReason}</p> : (
				<div className="app-config-create-form">
					{partitionList.length > 1 ? (
						<>
							<span className="doc-note">partition</span>
							<span className="doc-button-group" role="group" aria-label="The partition of the new layer">
								{partitionList.map((one) => <button key={one.id} type="button" aria-pressed={one.id === partition?.id} onClick={() => draft.patch({ partition: one.id })}>{one.label}</button>)}
							</span>
						</>
					) : null}
					<span className="doc-note">label</span>
					<EditValueInline value={value.label} placeholder="(its label)" isLocked={value.isBusy} onCommit={(text) => draft.patch({ label: text })} />
					<span className="doc-note">order</span>
					<EditValueInline value={value.order} placeholder="0" isLocked={value.isBusy} onCommit={(text) => draft.patch({ order: text })} />
					<span className="doc-note app-config-create-place">
						goes to {partition ? objectFrontendPartitionPlaceText(partition, 'layer') : '?'}{label ? ` as ${key}` : ''}; within its partition it stacks by its order
					</span>
					<span>
						<button type="button" className="doc-button" disabled={value.isBusy || Boolean(reason)} title={reason} onClick={() => void create()}>
							<Plus size={12} aria-hidden="true" />
							<span>Create</span>
						</button>
					</span>
				</div>
			)}
		</div>
	);
});

// every value a layer sets, by its dotted key
function leafListOf(tree, path = '') {
	const out = [];
	for (const [part, one] of Object.entries(tree && typeof tree === 'object' && !Array.isArray(tree) ? tree : {})) {
		const key = path ? `${path}.${part}` : part;
		if (one === null || one === undefined) continue;
		if (typeof one === 'object' && !Array.isArray(one)) out.push(...leafListOf(one, key));
		else out.push([key, one]);
	}
	return out;
}

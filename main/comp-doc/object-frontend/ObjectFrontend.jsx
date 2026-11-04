import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useCompState } from '../registry/use-comp-state.js';
import {
  OBJECT_FRONTEND_PLACEMENT, objectFrontendBlockRead, objectFrontendBlockTextBuild,
} from '../../frontend/src/lib/doc-object-frontend.js';
import { ObjectFrontendEdit } from './ObjectFrontendEdit.jsx';
import './ObjectFrontend.css';

// The entry component of the frontend objects (design: doc_page_impl_obj_frontend.md#the-entry-component):
// one block of a document names a frontend object, the mode it is drawn in
// and the parameters of that mode, and renders what the mode names: the
// component of the mode, given the object and the parameters. It adds
// nothing around it, so a block reads as the mode's component would.
//
//   <!--renderComp=ObjectFrontend-->
//   ```yaml
//   object: frontend:w5a1b2c3d4e     # the object (its reference, or its id)
//   mode: shelf                      # optional: a mode of its type; absent, the default one
//   param:                           # optional: over the mode's own parameters
//     status: reading
//   ```
//
// A mode switches what the block shows; it is the type's to say what each
// one is (a view of the data, a form registering new data, a summary), the
// page assumes nothing about them. The mode's component receives
//   data.ref, data.mode, data.param        what it draws
//   config.objectFrontend                  the object and its api: assets, metadata,
//                                          switching the mode and the parameters
// and switches the block with config.objectFrontend.modeSet / paramSet: the
// block is rewritten in its document where the page can write it (in reading
// mode as in edit mode), and the switch is shown at once in any case; with
// { isSaved: false }, or where the document cannot be written, it holds for
// as long as the page is open (the block's state, doc_page_impl_mdx_comp_state.md).
export const ObjectFrontend = observer(function ObjectFrontend({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <ObjectFrontendEdit data={data} config={config} onEvent={onEvent} />;
  return <ObjectFrontendBody data={data} config={config} onEvent={onEvent} />;
});

// the block as it reads: the object, its mode, the mode's component. used
// by the edit mode too, for what it shows in the flow (its draft)
export const ObjectFrontendBody = observer(function ObjectFrontendBody({ data = {}, config = {}, onEvent, blockDraft }) {
  const { envStore, objectFrontendStore } = useDocStores();
  const compState = useCompState(config, { override: null });
  const blockAuthored = objectFrontendBlockRead(data.raw ?? '');
  // a switch not written (yet) holds while the block's text is the one it was made on
  const override = compState.value.override?.rawBase === (data.raw ?? '') ? compState.value.override : null;
  const block = blockDraft ?? {
    ...blockAuthored,
    mode: override?.mode ?? blockAuthored.mode,
    param: override?.param ?? blockAuthored.param,
  };
  const state = objectFrontendStore.objectGet(block.object);
  const { modeList, mode, param } = objectFrontendStore.modeResolve(state, block.mode, block.param);

  // the block switched: shown at once, written into the document when it can be
  const blockSwitch = async (change, { isSaved = true } = {}) => {
    const next = { object: block.object, mode: change.mode ?? block.mode, param: change.param ?? block.param };
    compState.patch({ override: { rawBase: data.raw ?? '', mode: next.mode, param: next.param } });
    if (!isSaved || blockDraft) return { code: 0, message: 'switched while the page is open' };
    if (!envStore.isCapable('edit')) return { code: 0, message: `switched while the page is open: ${envStore.reasonGet('edit')}` };
    const result = await onEvent?.('dataReplaceRequest', { raw: objectFrontendBlockTextBuild(next) });
    return result ?? { code: -1, message: 'nobody answered' };
  };

  const service = useMemo(
    () => objectFrontendServiceBuild({ objectFrontendStore, ref: state.ref, mode, modeList, param, paramBlock: block.param, blockSwitch }),
    // the service is rebuilt with what it describes; its getters read the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectFrontendStore, state.ref, mode?.id, JSON.stringify(param), modeList.length, data.raw, compState.value.override],
  );

  if (blockAuthored.message && !blockDraft) return <p className="doc-error doc-object-frontend-line">ObjectFrontend: {blockAuthored.message}</p>;
  if (!block.object) {
    return <p className="doc-note doc-object-frontend-line">ObjectFrontend: name the object with <code>object: frontend:{'{id}'}</code></p>;
  }
  if (state.status === 'loading') {
    return (
      <p className="doc-status doc-object-frontend-line">
        <LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
        <span>Frontend object {block.object}</span>
      </p>
    );
  }
  if (state.status !== 'found') return <p className="doc-error doc-object-frontend-line">Frontend object {block.object}: {state.message}</p>;
  if (!mode) {
    return (
      <p className="doc-error doc-object-frontend-line">
        {state.name || state.id}: the type {objectFrontendStore.typeLabelGet(state.typeId)} has no mode “{block.mode}” (modes: {modeList.map((item) => item.id).join(', ')})
      </p>
    );
  }
  return (
    <div className="doc-object-frontend" data-object-ref={state.ref} data-mode={mode.id}>
      <RegisteredComp
        compName={mode.comp}
        placement={OBJECT_FRONTEND_PLACEMENT}
        input={{ data: { ref: state.ref, mode: mode.id, param } }}
        configRuntime={{
          objectFrontend: service,
          sourcePath: config.sourcePath,
          instanceId: `objectFrontend:${config.stateKey}:${mode.id}`,
        }}
      />
    </div>
  );
});

// what the component of a mode is given to work with its object: the
// object as the files say now (getters: it is an observer and re-renders),
// its assets by key, and the switches of its block. it never reaches the
// asset store or the document itself
export function objectFrontendServiceBuild({ objectFrontendStore, ref, mode, modeList, param, paramBlock = {}, blockSwitch }) {
  const stateGet = () => objectFrontendStore.objectGet(ref);
  return Object.freeze({
    ref,
    get id() { return stateGet().id; },
    get object() { return stateGet(); },
    mode: mode ? { id: mode.id, label: mode.label, category: mode.category, typeId: mode.typeId } : undefined,
    modeList: modeList.map(({ id, label, description, category, typeId }) => ({ id, label, description, category, typeId })),
    param,
    get isWritable() { return objectFrontendStore.writeUnavailableReason === ''; },
    get writeUnavailableReason() { return objectFrontendStore.writeUnavailableReason; },
    // the structural write in progress (an asset being created or removed)
    get write() { return objectFrontendStore.write; },
    // every read and write of one asset takes an asset reference: a path
    // (/book/sci-fi/dune), a key (book-1), name:…, id:…
    // (doc_page_impl_obj_frontend.md#naming-and-finding-the-assets)
    assetList: (kind) => stateGet().assetList.filter((asset) => kind === undefined || asset.kind === kind),
    // { status: found | missing | deleted | unknown | loading, asset?, by, message }
    assetResolve: (assetRef) => objectFrontendStore.assetResolve(ref, assetRef),
    assetGet: (assetRef) => objectFrontendStore.assetResolve(ref, assetRef).asset,
    // { tokenList, hitList: [{ asset, score, matchList, pathMatched }] }: the assets found by words
    assetSearch: (text, options) => objectFrontendStore.assetSearch(ref, text, options),
    // [{ kind: folder | asset, path, segment, asset?, assetCount }]: what completes a typed path
    assetComplete: (text, options) => objectFrontendStore.assetComplete(ref, text, options),
    // { status, message, text, asset, assetStatus } of an asset's head
    assetTextGet: (assetRef) => objectFrontendStore.assetTextGet(ref, assetRef),
    // { status, message, data, asset, assetStatus } of an asset whose text is yaml (or json)
    assetDataGet: (assetRef) => {
      const result = objectFrontendStore.assetTextGet(ref, assetRef);
      if (result.status !== 'done') return { ...result, data: undefined };
      try {
        return { ...result, data: yamlParse(result.text) };
      } catch (error) {
        return { ...result, status: 'error', message: `the asset ${assetRef} is not yaml: ${String(error?.message ?? error)}`, data: undefined };
      }
    },
    // a new asset: { key?, kind?, name?, pathList?, lang?, text } or { ..., data } (written as yaml);
    // { code, data: { key, objectId } }. a path another asset has is refused
    assetCreate: (input) => objectFrontendStore.assetCreate(stateGet().id, {
      key: input.key,
      kind: input.kind,
      name: input.name,
      pathList: input.pathList,
      lang: input.lang ?? 'yaml',
      text: input.text ?? yamlStringify(input.data ?? {}),
      note: input.note,
    }),
    assetWrite: (assetRef, textOrData, note) => objectFrontendStore.assetWrite(ref, assetRef, typeof textOrData === 'string' ? textOrData : yamlStringify(textOrData ?? {}), note),
    // how an asset is named and indexed: { name?, pathList?, kind? } (paths replaced whole)
    assetMetaSet: (assetRef, change) => {
      const asset = objectFrontendStore.assetResolve(ref, assetRef).asset;
      return asset ? objectFrontendStore.assetMetaSet(stateGet().id, asset.key, change) : Promise.resolve({ code: -1, message: `the object has no asset ${assetRef}` });
    },
    assetRemove: (assetRef, options = {}) => {
      const asset = objectFrontendStore.assetResolve(ref, assetRef).asset;
      return asset ? objectFrontendStore.assetRemove(stateGet().id, asset.key, options.isAssetKept === true) : Promise.resolve({ code: -1, message: `the object has no asset ${assetRef}` });
    },
    metadataSet: (patch) => objectFrontendStore.metadataSet(ref, patch),
    // the block switched to another mode / other parameters: the block's own
    // parameters, changed a key at a time (null removes one) unless isReplaced;
    // { isSaved: false } keeps the switch out of the document
    modeSet: (modeId, options) => blockSwitch({ mode: modeId }, options),
    // both at once: { mode, param } (param replaces the block's own)
    blockSet: (change, options) => blockSwitch({ mode: change.mode, param: change.param }, options),
    paramSet: (paramChange, options = {}) => {
      const paramNext = options.isReplaced ? { ...paramChange } : { ...paramBlock, ...paramChange };
      for (const key of Object.keys(paramNext)) if (paramNext[key] === null || paramNext[key] === undefined) delete paramNext[key];
      return blockSwitch({ param: paramNext }, options);
    },
    open: () => objectFrontendStore.settingsOpen(stateGet().id),
  });
}

import { useContext, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { DocNavArrivalContext } from '../link/DocNavScope.js';
import { useCompState } from '../registry/use-comp-state.js';
import {
  OBJECT_FRONTEND_PLACEMENT, objectFrontendBlockRead, objectFrontendBlockTextBuild,
} from '../../frontend/src/lib/doc-object-frontend.js';
import { ObjectFrontendEdit } from './ObjectFrontendEdit.jsx';
import { objectFrontendServiceBuild } from './object-frontend-service.js';
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

  // where a reader was going when the place this block is in was opened for them (the popup
  // showing the home document of an object)
  const navArrivalAny = useContext(DocNavArrivalContext);
  const service = useMemo(
    () => objectFrontendServiceBuild({ objectFrontendStore, ref: state.ref, mode, modeList, param, paramBlock: block.param, blockSwitch, docState: config.docState, blockKey: `objectFrontend:${config.stateKey}:${mode?.id}`, navArrival: navArrivalAny?.ref === state.ref ? navArrivalAny : undefined }),
    // the service is rebuilt with what it describes; its getters read the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectFrontendStore, state.ref, mode?.id, JSON.stringify(param), modeList.length, data.raw, compState.value.override, config.docState, config.stateKey, navArrivalAny],
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

// the api of a mode is built in a module of its own, so the layer's store can hand it to what
// answers for the inner paths of a type too (object-frontend-service.js)
export { objectFrontendServiceBuild };

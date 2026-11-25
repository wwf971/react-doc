import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { OBJECT_FRONTEND_PLACEMENT } from '../../frontend/src/lib/doc-object-frontend.js';
import { objectFrontendServiceBuild } from './object-frontend-service.js';
import './ObjectFrontend.css';

// A mode of a frontend object drawn where no document is (doc_page_impl_obj_frontend.md#a-mode-outside-a-document):
// in a portal (doc_page_impl_portal.md), in a panel of a component. The entry component
// ObjectFrontend draws a mode for a block, whose text holds the mode and its parameters and
// whose document says whether it is edited; here the one that draws it holds both:
//
//   object         the object: its reference (frontend:{id}), or its id
//   mode           a mode of its type; absent: the default
//   param          over the mode's own parameters, a key at a time
//   onBlockChange({ mode, param })   the mode switched itself (modeSet, paramSet, blockSet of its
//                  api): the host keeps what it is handed and gives it back as mode and param.
//                  absent, a switch is answered as not kept
//   docState       { isEditing, mode, editReason }: what the host says where a block's document
//                  would: whether the mode offers what changes the object (a portal:
//                  config.portal.docState). absent: reading
//   instanceKey    names this drawing among the others of the host: the state the mode keeps
//                  (useCompState) is found again under it
//
// The mode's component receives what it receives in a block: data { ref, mode, param } and
// config.objectFrontend, the api of the object.
export const ObjectFrontendMode = observer(function ObjectFrontendMode({ object, mode: modeIdAsked = '', param: paramAsked, onBlockChange, docState, instanceKey = '' }) {
  const { objectFrontendStore } = useDocStores();
  const paramBlock = paramAsked ?? PARAM_NONE;
  const state = objectFrontendStore.objectGet(object);
  const { modeList, mode, param } = objectFrontendStore.modeResolve(state, modeIdAsked, paramBlock);
  const instanceId = `objectFrontendMode:${instanceKey}:${state.ref || object}:${mode?.id ?? ''}`;
  const service = useMemo(
    () => objectFrontendServiceBuild({
      objectFrontendStore,
      ref: state.ref,
      mode,
      modeList,
      param,
      paramBlock,
      blockSwitch: async (change) => {
        if (!onBlockChange) return { code: 0, message: 'switched while it is shown: nothing keeps it here' };
        onBlockChange({ mode: change.mode ?? mode?.id ?? '', param: change.param ?? paramBlock });
        return { code: 0, message: '' };
      },
      docState,
      blockKey: instanceId,
    }),
    // rebuilt with what it describes; its getters read the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectFrontendStore, state.ref, mode?.id, JSON.stringify(param), modeList.length, docState, instanceId, onBlockChange],
  );
  if (!object) return <p className="doc-note doc-object-frontend-line">No object is named.</p>;
  if (state.status === 'loading') {
    return (
      <p className="doc-status doc-object-frontend-line">
        <LoaderCircle aria-hidden="true" size={12} className="doc-spin" />
        <span>Frontend object {object}</span>
      </p>
    );
  }
  if (state.status !== 'found') return <p className="doc-error doc-object-frontend-line">Frontend object {object}: {state.message}</p>;
  if (!mode) {
    return (
      <p className="doc-error doc-object-frontend-line">
        {state.name || state.id}: the type {objectFrontendStore.typeLabelGet(state.typeId)} has no mode “{modeIdAsked}” (modes: {modeList.map((item) => item.id).join(', ')})
      </p>
    );
  }
  return (
    <div className="doc-object-frontend" data-object-ref={state.ref} data-mode={mode.id}>
      <RegisteredComp
        compName={mode.comp}
        placement={OBJECT_FRONTEND_PLACEMENT}
        input={{ data: { ref: state.ref, mode: mode.id, param } }}
        configRuntime={{ objectFrontend: service, docState: docState ?? DOC_STATE_READ, sourcePath: '', instanceId }}
      />
    </div>
  );
});

const PARAM_NONE = Object.freeze({});
// what a host saying nothing means: the object is read
const DOC_STATE_READ = Object.freeze({ path: '', mode: 'read', isEditing: false, isEditAvailable: false, editReason: 'shown read-only here' });

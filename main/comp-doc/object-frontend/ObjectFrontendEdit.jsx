import { useState } from 'react';
import { makeAutoObservable } from 'mobx';
import { observer } from 'mobx-react-lite';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { Boxes } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditActions } from '../edit/EditActions.jsx';
import { EditFloatingPanel } from '../edit/EditFloatingPanel.jsx';
import { EditSourceSurface } from '../edit/EditSourceSurface.jsx';
import { ObjectSearchPanel } from '../object/ObjectSearchPanel.jsx';
import {
  OBJECT_FRONTEND_TYPE_ROOT, objectFrontendBlockRead, objectFrontendBlockTextBuild,
} from '../../frontend/src/lib/doc-object-frontend.js';
// eslint-disable-next-line import/no-cycle
import { ObjectFrontendBody } from './ObjectFrontend.jsx';

// The edit mode "entry" of the entry component (doc_page_impl_obj_frontend.md#the-entry-component):
// what the block names, edited in its floating bar, the block itself showing
// the draft in its place (the no-jitter rule: the bar floats, nothing is
// added to the flow):
//
//   Frontend Object  [▣ Reading list · Reading list]  [Change…]  [Shelf][Cards][Add][Overview]  [Save][Cancel]
//   ─────────────────────────────────────────────────────────────────────────────
//   param   status: reading                       (yaml, over the mode's own parameters)
//
// the mode buttons are the modes of the object's type (its own, then its
// ancestors'); Change… searches the frontend objects (the object registry's
// search, limited to frontend.object). every change is reported as the draft
// (editDraftChange { raw }); Save, or leaving the block, writes it.
export const ObjectFrontendEdit = observer(function ObjectFrontendEdit({ data = {}, config = {}, onEvent }) {
  const { objectFrontendStore, objectStore } = useDocStores();
  const [draft] = useState(() => new ObjectFrontendEditDraft(objectFrontendBlockRead(data.raw ?? '')));
  const session = config.edit?.session ?? {};
  const isLocked = session.status === 'submitting';
  const state = objectFrontendStore.objectGet(draft.object);
  const modeList = state.status === 'found' ? objectFrontendStore.modeListGet(state.typeId) : [];
  const modeIdCurrent = draft.mode || modeList.find((mode) => mode.isDefault)?.id || '';

  const draftReport = () => void onEvent?.('editDraftChange', { raw: objectFrontendBlockTextBuild(draft.blockGet()) });
  const change = (apply) => {
    apply();
    draftReport();
  };

  return (
    <>
      <ObjectFrontendBody data={data} config={config} onEvent={onEvent} blockDraft={draft.blockGet()} />
      <EditFloatingPanel
        label="Frontend Object"
        className="doc-object-frontend-edit"
        head={(
          <>
            <span className="doc-object-frontend-edit-object" title={state.ref}>
              <Boxes size={12} aria-hidden="true" />
              <span>{state.status === 'found' ? state.name || state.id : draft.object || '(no object)'}</span>
              {state.status === 'found' ? <span className="doc-badge">{objectFrontendStore.typeLabelGet(state.typeId)}</span> : null}
            </span>
            <button type="button" className="doc-button" disabled={isLocked} aria-pressed={draft.isPicking} onClick={() => draft.pickingToggle()}>
              Change…
            </button>
            {modeList.length > 0 ? (
              <span className="doc-button-group" role="group" aria-label="Mode">
                {modeList.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={mode.id === modeIdCurrent}
                    disabled={isLocked}
                    title={[mode.description, `${mode.category} · from ${objectStore.typeLabelGet(mode.typeId)}`].filter(Boolean).join(' · ')}
                    onClick={() => change(() => draft.modeSet(mode.isDefault && !draft.mode ? '' : mode.id))}
                  >
                    {mode.label}
                  </button>
                ))}
              </span>
            ) : null}
          </>
        )}
        actions={(
          <EditActions
            status={session.status}
            message={session.message}
            isSubmitDisabled={draft.paramMessage !== ''}
            onSubmit={() => !isLocked && void onEvent?.('editSubmitRequest')}
            onCancel={() => !isLocked && void onEvent?.('editCancelRequest')}
          />
        )}
      >
        {draft.isPicking ? (
          <ObjectSearchPanel
            sessionKey={`objectFrontendEdit:${config.stateKey}`}
            typeList={[OBJECT_FRONTEND_TYPE_ROOT]}
            isFilterShown={false}
            isAutoFocus
            placeholder="Search the frontend objects: a name, a type, an id"
            onChoose={(hit) => change(() => draft.objectSet(hit.descriptor.ref))}
            onClose={() => draft.pickingToggle()}
          />
        ) : null}
        <div className="doc-object-frontend-edit-param">
          <span className="doc-object-frontend-edit-label">param</span>
          <EditSourceSurface
            kind="code"
            text={draft.paramText}
            textVersion={draft.paramTextVersion}
            isLocked={isLocked}
            ariaLabel="Parameters of the mode (yaml)"
            onTextChange={(text) => change(() => draft.paramTextSet(text))}
            onSubmitRequest={() => void onEvent?.('editSubmitRequest')}
            onCancelRequest={() => void onEvent?.('editCancelRequest')}
          />
          {draft.paramMessage ? <span className="doc-error doc-edit-message" role="alert">{draft.paramMessage}</span> : null}
        </div>
      </EditFloatingPanel>
    </>
  );
});

// the draft of the block: the object, the mode, the parameters as yaml text
class ObjectFrontendEditDraft {
  object = '';
  mode = '';
  param = {};
  paramText = '';
  paramTextVersion = 0;
  paramMessage = '';
  isPicking = false;

  constructor(block) {
    this.object = block.object;
    this.mode = block.mode;
    this.param = block.param ?? {};
    this.paramText = Object.keys(this.param).length > 0 ? yamlStringify(this.param) : '';
    makeAutoObservable(this);
  }

  blockGet() {
    return { object: this.object, mode: this.mode, param: this.param };
  }

  objectSet(ref) {
    this.object = ref;
    // another object may be of another type: its default mode
    this.mode = '';
    this.isPicking = false;
  }

  modeSet(modeId) {
    this.mode = modeId;
  }

  pickingToggle() {
    this.isPicking = !this.isPicking;
  }

  // the parameters as typed: kept when they read as a mapping, else the
  // last good ones stay and the reason is shown
  paramTextSet(text) {
    this.paramText = text;
    try {
      const value = text.trim() === '' ? {} : yamlParse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        this.paramMessage = 'param is a mapping (key: value)';
        return;
      }
      this.param = value;
      this.paramMessage = '';
    } catch (error) {
      this.paramMessage = `not yaml: ${String(error?.message ?? error)}`;
    }
  }
}

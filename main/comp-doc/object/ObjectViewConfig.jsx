import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { ObjectIcon } from './object-icon.jsx';
import { ObjectStatusBadge } from './ObjectViewFallback.jsx';

// The view of a configuration (core.config, doc_page_impl_obj.md#services):
// its content is { valueByKey, defineList }, the define list
// [{ key, type: string | integer | number | boolean, default, description }];
// a change is the update { valueByKey } of the changed keys, which the
// provider checks (the kernel, for the config of a service instance:
// against the instance's own script, then service.yaml is written and the
// instance restarts). It draws any config of any provider: what it knows
// of the provider is the type's promise. What it read and the draft are
// the view's state in the object store (viewStateGet), not the component's.
export const ObjectViewConfig = observer(function ObjectViewConfig({ data = {}, config = {} }) {
  const { objectStore } = useDocStores();
  const descriptor = data.descriptor;
  const view = config.objectView ?? {};
  const state = objectStore.viewStateGet(`config:${descriptor.ref}:${config.instanceId ?? ''}`);

  // read once per object, and again when it is found again; not on every
  // new descriptor: a read refreshes the descriptor (its timeChecked) itself
  useEffect(() => {
    if (descriptor.status === 'found') void objectStore.viewContentLoad(state, descriptor.ref);
  }, [descriptor.ref, descriptor.status, state, objectStore]);

  const defineList = state.content?.defineList ?? [];
  const valueByKey = state.content?.valueByKey ?? {};
  const changedByKey = Object.fromEntries(Object.entries(state.draftByKey).filter(([key, value]) => value !== valueByKey[key]));
  const isChanged = Object.keys(changedByKey).length > 0;
  const isEditAllowed = view.isEditAllowed === true;
  const isLocked = !isEditAllowed || state.writeStatus === 'submitting';
  const save = () => objectStore.viewDraftSave(state, descriptor.ref, () => ({ valueByKey: changedByKey }), 'saved: the instance restarts with it');

  return (
    <div className={`doc-object-card doc-object-config${view.context === 'block' ? ' doc-object-card-block' : ''}`} data-status={descriptor.status}>
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        <span className="doc-object-card-label">{descriptor.label}</span>
        <span className="doc-badge">{objectStore.typeLabelGet(descriptor.typeList[0] ?? 'core.config')}</span>
        {descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null}
      </div>
      {state.contentStatus === 'error' ? <p className="doc-error">{state.contentMessage}</p> : null}
      {state.contentStatus === 'loading' && !state.content ? <p className="doc-status">reading…</p> : null}
      {state.contentStatus === 'done' && defineList.length === 0 ? <p className="doc-note">nothing to configure</p> : null}
      {defineList.length > 0 ? (
        <div className="doc-object-config-list">
          {defineList.map((define) => {
            const value = state.draftByKey[define.key] ?? valueByKey[define.key] ?? define.default;
            return (
              <div key={define.key} className="doc-object-config-row" title={define.description}>
                <span className="doc-object-config-key">{define.key}</span>
                {define.type === 'boolean' ? (
                  <span className="doc-button-group" role="group" aria-label={define.key}>
                    {[true, false].map((option) => (
                      <button key={String(option)} type="button" aria-pressed={value === option} disabled={isLocked} onClick={() => state.draftSet(define.key, option)}>{String(option)}</button>
                    ))}
                  </span>
                ) : (
                  <EditValueInline
                    className="doc-object-config-value"
                    value={value ?? ''}
                    placeholder={define.default === undefined || define.default === null ? '' : String(define.default)}
                    isLocked={isLocked}
                    aria-label={define.key}
                    onCommit={(text) => state.draftSet(define.key, configValueRead(text, define.type))}
                  />
                )}
                <span className="doc-note doc-object-config-description">{define.description}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {isEditAllowed ? (
        <div className="doc-object-config-bar">
          <button type="button" className="doc-button" data-primary="" disabled={!isChanged || state.writeStatus === 'submitting'} onClick={() => void save()}>Save</button>
          <button type="button" className="doc-button" disabled={!isChanged || state.writeStatus === 'submitting'} onClick={() => state.draftClear()}>Revert</button>
          {state.writeMessage ? <span className={state.writeStatus === 'error' ? 'doc-error' : 'doc-note'}>{state.writeMessage}</span> : null}
        </div>
      ) : (view.editUnavailableReason && defineList.length > 0 ? <p className="doc-note">read only: {view.editUnavailableReason}</p> : null)}
    </div>
  );
});

// a typed text as the value of its type: a number for integer and number
// (the provider refuses one that is not), the text otherwise
function configValueRead(text, type) {
  if (type !== 'integer' && type !== 'number') return text;
  const value = Number(text);
  if (text.trim() === '' || Number.isNaN(value)) return text;
  return type === 'integer' && Number.isInteger(value) ? value : value;
}

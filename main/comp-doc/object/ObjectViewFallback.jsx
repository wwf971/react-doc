import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from './object-icon.jsx';

// The view every object has (doc_page_impl_obj.md#the-fallback-view): it is
// registered for core.object in every context, so it is chosen only when no
// view nearer to the object's types can draw it. It needs nothing but the
// descriptor: the icon of the object's type, its label, its type, its
// status when it is not found, its summary, and where to open it. In the
// block context it reads the object's content on demand, from its provider.

const SUMMARY_SHOWN_MAX = 4;

export const ObjectViewFallback = observer(function ObjectViewFallback({ data = {}, config = {}, onEvent }) {
  const { objectStore } = useDocStores();
  const descriptor = data.descriptor ?? { ref: data.ref, typeList: [], label: data.ref, description: '', summary: {}, status: 'loading', capabilityList: [] };
  const view = config.objectView ?? {};
  const context = view.context ?? 'card';
  const typeId = descriptor.typeList[0] ?? '';
  const typeLabel = typeId ? objectStore.typeLabelGet(typeId) : '';
  const isOpenable = Boolean(descriptor.open);
  const open = (event) => {
    event?.stopPropagation?.();
    void onEvent?.('objectOpenRequest', { ref: descriptor.ref });
  };
  const statusBadge = descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null;
  const title = [descriptor.label, typeLabel, descriptor.message, view.note].filter(Boolean).join(' · ');

  if (context === 'icon' || context === 'inline') {
    const content = (
      <>
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={13} />
        <span className="doc-object-chip-label">{descriptor.label}</span>
        {statusBadge}
      </>
    );
    return isOpenable
      ? <button type="button" className="doc-object-chip" title={title} onClick={open}>{content}</button>
      : <span className="doc-object-chip" title={title}>{content}</span>;
  }

  const summaryList = Object.entries(descriptor.summary ?? {})
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, SUMMARY_SHOWN_MAX);
  return (
    <div className={`doc-object-card${context === 'block' ? ' doc-object-card-block' : ''}`} data-status={descriptor.status}>
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        {isOpenable
          ? <button type="button" className="doc-object-card-label doc-object-link" onClick={open} title={`open ${descriptor.label}`}>{descriptor.label}</button>
          : <span className="doc-object-card-label">{descriptor.label}</span>}
        {typeLabel ? <span className="doc-badge">{typeLabel}</span> : null}
        {statusBadge}
      </div>
      {descriptor.description ? <p className="doc-note doc-object-card-description">{descriptor.description}</p> : null}
      {summaryList.length > 0 ? (
        <dl className="doc-object-summary">
          {summaryList.map(([key, value]) => (
            <div key={key} className="doc-object-summary-item">
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {view.note || descriptor.message ? <p className="doc-note">{view.note || descriptor.message}</p> : null}
      {context === 'block' ? <ObjectContent descriptor={descriptor} /> : null}
      <p className="doc-note doc-object-card-foot" title={descriptor.ref}>
        {descriptor.provider?.label ? `${descriptor.provider.label} · ` : ''}{descriptor.ref}
      </p>
    </div>
  );
});

// the status of a descriptor that is not found: registered (known, not
// verified), missing, unavailable, unknown, loading
export function ObjectStatusBadge({ descriptor }) {
  const isError = ['missing', 'unknown'].includes(descriptor.status);
  return (
    <span className="doc-badge-outline" {...(isError ? { 'data-error': '' } : {})} title={descriptor.message || ''}>
      {descriptor.status}
    </span>
  );
}

// the content of an object, read from its provider when asked for; what
// was read is the view's state in the object store
const ObjectContent = observer(function ObjectContent({ descriptor }) {
  const { objectStore } = useDocStores();
  const state = objectStore.viewStateGet(`fallback:${descriptor.ref}`);
  if (!descriptor.capabilityList.includes('read')) return null;
  if (state.contentStatus === 'idle') {
    return <button type="button" className="doc-button doc-object-content-button" onClick={() => void objectStore.viewContentLoad(state, descriptor.ref)}>Read its content</button>;
  }
  if (state.contentStatus === 'loading') return <p className="doc-status">reading…</p>;
  if (state.contentStatus === 'error') return <p className="doc-error">{state.contentMessage}</p>;
  return <pre className="doc-object-content">{contentText(state.content)}</pre>;
});

function contentText(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content.text === 'string' && Object.keys(content).length <= 2) return content.text;
  return JSON.stringify(content, null, 2);
}

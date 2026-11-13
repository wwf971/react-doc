import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { objectIconComponentGet } from '../object/object-icon.jsx';
import { objectFrontendBlockTextBuild, objectFrontendRefSplit } from '../../frontend/src/lib/doc-object-frontend.js';
// eslint-disable-next-line import/no-cycle
import { ObjectFrontendBody } from './ObjectFrontend.jsx';
import './ObjectFrontend.css';

// The view of frontend.inner for the object registry
// (doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths): something inside a
// frontend object, named by an inner reference (frontend:{id}#{inner path}), drawn wherever
// the registry draws objects: a cell (inline), a list, a card diagram, a block.
//
//   icon, inline   a chip: the icon of its object's type, its name; a value (a thing its type
//                  answers with a text, a value of a profile) reads as the text itself
//   card           its name, its kind, its object and path
//   block          the object in the mode its type declares for one thing (pathParam), given the
//                  path: what an ObjectFrontend block naming that mode would draw; the card
//                  when the type declares none
//
// What is missing says so where it is: a dashed outline and the reason, never an empty place.
// It reads the layer itself rather than the descriptor, so it follows the object as it changes.
// A type brings a view of its own for its things by answering a type of its own for them
// (typeId of expose.objectInner's resolve) and exposing a view of that type.
export const ObjectViewFrontendInner = observer(function ObjectViewFrontendInner({ data = {}, config = {}, onEvent }) {
  const { objectStore, objectFrontendStore } = useDocStores();
  const context = config.objectView?.context ?? 'card';
  const split = objectFrontendRefSplit(data.ref);
  const state = objectFrontendStore.objectGet(split.id);
  const inner = objectFrontendStore.innerResolve(split.id, split.innerPath);
  const isFound = inner.status === 'found';
  const block = isFound ? objectFrontendStore.innerBlockGet(split.id, inner.path) : undefined;
  if (context === 'block' && block) {
    return <ObjectFrontendBody data={{ raw: objectFrontendBlockTextBuild(block) }} config={config} onEvent={onEvent} />;
  }
  const objectLabel = state.name || split.ref;
  const kindLabel = inner.kind ? (objectFrontendStore.assetKindListGet(split.id) ?? []).find((kind) => kind.id === inner.kind)?.label ?? inner.kind : '';
  const statusText = inner.status === 'loading' ? 'reading…' : isFound ? '' : inner.message || `nothing of ${objectLabel} is at ${inner.path}`;
  const title = [inner.label, kindLabel, `${objectLabel} ${inner.path}`, statusText].filter(Boolean).join(' · ');
  const open = (event) => {
    event?.stopPropagation?.();
    objectFrontendStore.innerOpen(split.id, inner.path);
  };
  const Icon = objectIconComponentGet(objectStore.typeIconGet([state.typeId || 'frontend.inner']));

  if (context === 'icon' || context === 'inline') {
    // a value reads as its text, in the line it stands in
    if (isFound && inner.text !== undefined) return <span className="doc-object-inner-value" title={title}>{inner.text}</span>;
    return (
      <button type="button" className="doc-object-chip doc-object-inner-chip" data-status={inner.status} title={title} onClick={open}>
        <Icon className="doc-object-icon" size={13} aria-hidden />
        <span className="doc-object-chip-label">{inner.label}</span>
      </button>
    );
  }
  return (
    <div className="doc-object-card" data-status={isFound ? 'found' : inner.status}>
      <div className="doc-object-card-head">
        <Icon className="doc-object-icon" size={15} aria-hidden />
        <button type="button" className="doc-object-card-label doc-object-link" title={`open ${inner.label}`} onClick={open}>{inner.label}</button>
        {kindLabel ? <span className="doc-badge">{kindLabel}</span> : null}
        {!isFound && inner.status !== 'loading' ? <span className="doc-badge-outline" data-error="">{inner.status}</span> : null}
      </div>
      {inner.text !== undefined ? <p className="doc-object-card-description">{inner.text}</p> : null}
      {statusText ? <p className="doc-note doc-object-card-description">{statusText}</p> : null}
      <p className="doc-note doc-object-card-foot" title={data.ref}>{objectLabel} · {inner.path}</p>
    </div>
  );
});

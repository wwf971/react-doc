import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import './DocObject.css';

// One object drawn in a context (doc_page_impl_obj.md#object-views): what
// the registry knows of the reference (resolved when it knows nothing yet,
// or what it knows is stale), the view chosen for its Types and the
// context (the nearest Type wins; the fallback view of core.object when no
// other can), and whether it may be changed here. Every consumer draws
// objects through it: ObjectView, ObjectList, ObjectGroup, the collection
// view, a node of a card diagram.
//
//   objectRef      the reference
//   context        icon | inline | card | block
//   viewCompId     a view asked for by the consumer; used when it can draw the object
//   isEditable     whether the consumer allows a change (default true); a
//                  change also needs the provider to offer it and to answer now
//   descriptor     a descriptor the consumer has already (a query's), drawn
//                  until the registry answers for the reference
//   note           a line the consumer adds (the note of a member of a group)
export const ObjectViewHost = observer(function ObjectViewHost({
  objectRef,
  context = 'card',
  viewCompId = '',
  isEditable = true,
  descriptor: descriptorGiven,
  note = '',
  sourcePath,
}) {
  const { objectStore } = useDocStores();
  const state = objectStore.resolveStateGet(objectRef);
  const descriptor = state.status === 'loading' && descriptorGiven ? descriptorGiven : state.descriptor;
  const view = objectStore.viewResolve(descriptor, context, viewCompId);
  const editUnavailableReason = isEditable ? objectStore.editUnavailableReasonGet(descriptor) : 'the consumer shows it read-only';
  const Wrapper = context === 'icon' || context === 'inline' ? 'span' : 'div';
  return (
    <Wrapper className={`doc-object-view doc-object-view-${context}`} data-object-ref={objectRef} data-object-view={view.compId}>
      <RegisteredComp
        compId={view.compId}
        placement="objectView"
        input={{ data: { ref: objectRef, descriptor } }}
        configRuntime={{
          objectView: { context, isEditAllowed: editUnavailableReason === '', editUnavailableReason, note, viewCompId: view.compId, isFallback: view.isFallback },
          ...(sourcePath !== undefined ? { sourcePath } : {}),
          instanceId: `object:${objectRef}:${context}`,
        }}
      />
    </Wrapper>
  );
});

import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import './DocObject.css';

// One object drawn in a context (doc_page_impl_obj.md#object-views): what
// the registry knows of the reference (resolved when it knows nothing yet,
// or what it knows is stale), the view chosen for its types and the
// context (the nearest type wins; the fallback view of core.object when no
// other can), and whether it may be changed here. Every consumer draws
// objects through it: ObjectView, ObjectList, ObjectGroup, the collection
// view, a node of a card diagram.
//
//   objectRef      the reference
//   context        icon | inline | card | block | panel (under what names it, where it is worked
//                  on: drawn by the type's card view when it has none for a panel)
//   viewCompId     a view asked for by the consumer; used when it can draw the object
//   isEditable     whether the consumer allows a change (default true); a
//                  change also needs the provider to offer it and to answer now
//   descriptor     a descriptor the consumer has already (a query's), drawn
//                  until the registry answers for the reference
//   note           a line the consumer adds (the note of a member of a group)
//   onClose        a consumer showing the object in something that closes (the card of a token, in
//                  the context panel): config.objectView.close, so the view may close it when its
//                  work is done (a value saved)
//   onWidthSet     the same holder's width asked for: config.objectView.widthSet('wide' | 'normal'),
//                  a view showing a text asking for the width of the place it is named in
export const ObjectViewHost = observer(function ObjectViewHost({
  objectRef,
  context = 'card',
  viewCompId = '',
  isEditable = true,
  descriptor: descriptorGiven,
  note = '',
  sourcePath,
  onClose,
  onWidthSet,
}) {
  const { objectStore } = useDocStores();
  const state = objectStore.resolveStateGet(objectRef);
  const descriptor = state.status === 'loading' && descriptorGiven ? descriptorGiven : state.descriptor;
  const view = objectStore.viewResolve(descriptor, context, viewCompId);
  const contextDrawn = view.contextDrawn ?? context;
  const editUnavailableReason = isEditable ? objectStore.editUnavailableReasonGet(descriptor) : 'the consumer shows it read-only';
  const Wrapper = context === 'icon' || context === 'inline' ? 'span' : 'div';
  return (
    <Wrapper className={`doc-object-view doc-object-view-${context}`} data-object-ref={objectRef} data-object-view={view.compId}>
      <RegisteredComp
        compId={view.compId}
        placement="objectView"
        input={{ data: { ref: objectRef, descriptor } }}
        configRuntime={{
          // isEditableConsumer: the consumer alone allows a change; a view of a thing written through
          // a layer of its own (a value inside a frontend object) asks that layer too
          objectView: { context: contextDrawn, contextAsked: context, isEditAllowed: editUnavailableReason === '', isEditableConsumer: isEditable, editUnavailableReason, note, viewCompId: view.compId, isFallback: view.isFallback, ...(onClose ? { close: onClose } : {}), ...(onWidthSet ? { widthSet: onWidthSet } : {}) },
          ...(sourcePath !== undefined ? { sourcePath } : {}),
          instanceId: `object:${objectRef}:${context}`,
        }}
      />
    </Wrapper>
  );
});

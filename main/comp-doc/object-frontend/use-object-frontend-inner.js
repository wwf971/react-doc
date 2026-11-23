import { useDocStores } from '../../frontend/src/store/context.js';
import { objectFrontendRefSplit } from '../../frontend/src/lib/doc-object-frontend.js';

// The view of a thing inside a frontend object, reaching that object
// (doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths): a type answering a type of
// its own for its things (typeId of expose.objectInner's resolve) exposes a view of that type, and
// the view calls this with the reference it draws (data.ref) and its config.
//
//   service        the api of a mode of the object, without a block (assetDataGet, assetWrite, …)
//   objectRef      the object: frontend:{id};  innerPath  what names the thing inside it
//   inner          what the path names now (innerResolve: status, label, kind, text?, …)
//   isEditable     a change may be made now: the consumer allows it (config.objectView.isEditableConsumer,
//                  a token being typed in a cell) and the object can be written
//   editUnavailableReason   why not, said where the change would be offered
//
// It reads the page's stores in the render of the view, which is an observer: what it answers
// follows the object.
export function useObjectFrontendInner(ref, config = {}) {
  const { objectFrontendStore } = useDocStores();
  const split = objectFrontendRefSplit(ref);
  const service = split.ref ? objectFrontendStore.innerServiceGet(split.ref) : undefined;
  const inner = split.id ? objectFrontendStore.innerResolve(split.id, split.innerPath) : { status: 'unknown', path: '', label: '', detail: '', kind: '', message: 'no frontend object is named' };
  const isConsumerEditable = config.objectView?.isEditableConsumer === true;
  const reasonObject = service ? service.writeUnavailableReason : 'no frontend object is named';
  const isEditable = isConsumerEditable && reasonObject === '';
  const editUnavailableReason = isEditable ? '' : !isConsumerEditable ? 'shown read-only here' : reasonObject;
  return { service, objectRef: split.ref, innerPath: split.innerPath, inner, isEditable, editUnavailableReason };
}

import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from './object-icon.jsx';
import { ObjectStatusBadge } from './ObjectViewFallback.jsx';

// The card of a document (core.document: a markdown document of the
// workspace, a note of a service, anything a person reads) and of a place
// in one (core.place: a section, a block). Its label opens it; its
// description is what the provider says of it; and the links that reach it
// (doc.link relations to it, from the navigation layer's link index) are
// counted, for a document or a section of the workspace, without this view
// knowing who keeps them.
export const ObjectViewDocument = observer(function ObjectViewDocument({ data = {}, config = {}, onEvent }) {
  const { objectStore } = useDocStores();
  const descriptor = data.descriptor;
  const view = config.objectView ?? {};
  const isWorkspaceDocument = ['doc.document', 'doc.section'].some((typeId) => objectStore.typeRegistry.isAssignableAny(descriptor.typeList, [typeId]));
  const linkState = isWorkspaceDocument && descriptor.status === 'found'
    ? objectStore.relationStateGet({ toRef: descriptor.ref, typeList: ['doc.link'] })
    : undefined;
  const linkCount = linkState?.result?.relationList?.length;
  const referrerCount = linkState?.result ? new Set(linkState.result.relationList.map((relation) => relation.fromRef)).size : undefined;
  const open = () => void onEvent?.('objectOpenRequest', { ref: descriptor.ref });
  return (
    <div className="doc-object-card doc-object-document" data-status={descriptor.status}>
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        {descriptor.open
          ? <button type="button" className="doc-object-card-label doc-object-link" onClick={open} title={`open ${descriptor.label}`}>{descriptor.label}</button>
          : <span className="doc-object-card-label">{descriptor.label}</span>}
        <span className="doc-badge">{objectStore.typeLabelGet(descriptor.typeList[0] ?? 'core.document')}</span>
        {descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null}
      </div>
      {descriptor.description ? <p className="doc-note doc-object-card-description">{descriptor.description}</p> : null}
      {linkCount !== undefined ? (
        <p className="doc-note">{linkCount === 0 ? 'no document links here' : `${linkCount} link${linkCount === 1 ? '' : 's'} here, from ${referrerCount} document${referrerCount === 1 ? '' : 's'}`}</p>
      ) : null}
      {view.note ? <p className="doc-note">{view.note}</p> : null}
    </div>
  );
});

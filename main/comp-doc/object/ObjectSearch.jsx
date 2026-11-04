import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectSearchPanel } from './ObjectSearchPanel.jsx';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { objectCompDataRead, objectContextRead, objectTypeListRead } from './object-comp-data.js';

// A search of the object service layer placed in a document
// (doc_page_impl_obj_search.md#the-ui): the panel, and below it the object
// chosen, drawn by the view of its types. What is typed and chosen is the
// search session's, kept by the layer for the block (by its place), so it
// survives navigating away and back; it is never written into the document.
//
//   <!--renderComp=ObjectSearch-->
//   ```yaml
//   typeList: [core.task]      # optional: the types it starts filtered by
//   context: card              # how the chosen object is drawn
//   ```
export const ObjectSearch = observer(function ObjectSearch({ data = {}, config = {} }) {
  const { objectStore } = useDocStores();
  const value = objectCompDataRead(data);
  if (value.message) return <p className="doc-error">{value.message}</p>;
  const sessionKey = `block:${config.stateKey ?? config.instanceId}`;
  const typeList = value.typeList || value.type ? objectTypeListRead(value) : [];
  const session = objectStore.searchStore.sessionGet(sessionKey, { typeList });
  return (
    <div className="doc-object-block doc-object-search-block">
      <ObjectSearchPanel sessionKey={sessionKey} typeList={typeList} />
      {session.refChosen ? (
        <ObjectViewHost objectRef={session.refChosen} context={objectContextRead(value.context, 'card')} sourcePath={config.sourcePath} />
      ) : null}
    </div>
  );
});

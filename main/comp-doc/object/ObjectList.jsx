import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { ObjectCompleteness } from './ObjectCompleteness.jsx';
import { objectCompDataRead, objectContextRead, objectTypeListRead } from './object-comp-data.js';

// The objects of some types, wherever they come from (doc_page_impl_obj.md#discovery):
// a query of the registry, federated to every provider of those types (the
// page's service layers, the backend's kernel and instances), each object
// drawn by the view of its own types. The list is a derived collection: it
// has no identity of its own, and says how complete it is.
//
//   <!--renderComp=ObjectList-->
//   ```yaml
//   type: core.task            # or typeList: [core.task, core.document]
//   text: ''                   # optional: what the label contains
//   filter: {}                 # optional: what the providers filter by (isDone, kind, docPageAlias)
//   limit: 20
//   context: card              # icon | card
//   layout: grid               # list | grid
//   ```
export const ObjectList = observer(function ObjectList({ data = {}, config = {} }) {
  const { objectStore } = useDocStores();
  const value = objectCompDataRead(data);
  if (value.message) return <p className="doc-error">{value.message}</p>;
  const spec = {
    typeList: objectTypeListRead(value),
    text: String(value.text ?? ''),
    filter: value.filter && typeof value.filter === 'object' ? value.filter : {},
    limit: Number(value.limit) || 50,
  };
  const context = objectContextRead(value.context, 'card') === 'icon' ? 'icon' : 'card';
  const layout = value.layout === 'list' || context === 'icon' ? 'list' : 'grid';
  const state = objectStore.queryStateGet(spec);
  const objectList = state.result?.objectList ?? [];
  return (
    <div className="doc-object-list" data-layout={layout}>
      <div className={layout === 'grid' && context === 'card' ? 'doc-object-grid' : 'doc-object-member-list'}>
        {objectList.map((descriptor) => (
          <ObjectViewHost key={descriptor.ref} objectRef={descriptor.ref} descriptor={descriptor} context={context} sourcePath={config.sourcePath} />
        ))}
      </div>
      <ObjectCompleteness
        completeness={state.result?.completeness}
        count={objectList.length}
        isTruncated={state.result?.isTruncated}
        isLoading={state.status === 'loading' || Boolean(state.promise)}
      />
    </div>
  );
});

import { observer } from 'mobx-react-lite';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { objectCompDataRead, objectContextRead } from './object-comp-data.js';

// One object of the object registry, placed in a document or a diagram
// (doc_page_impl_obj.md#object-views): the author names it by its
// reference and the context it is drawn in, and nothing else; the registry
// finds its provider, and the component registry the view of its types.
//
//   <!--renderComp=ObjectView-->
//   ```yaml
//   object: service.w55j3ztn3rq:todo/1      # the reference
//   context: card                            # icon | inline | card | block
//   view: ''                                 # optional: a view asked for (a component id)
//   isEditable: true                         # whether it may be changed from here
//   ```
//
// In a node of a card diagram (renderer: { component: ObjectView }) it is a
// card filling the node; its data is the same mapping.
export const ObjectView = observer(function ObjectView({ data = {}, config = {} }) {
  const value = objectCompDataRead(data);
  const objectRef = String(value.object ?? value.ref ?? '');
  const context = objectContextRead(value.context, 'card');
  if (value.message) return <p className="doc-error">{value.message}</p>;
  if (!objectRef) return <p className="doc-note">ObjectView: name the object with <code>object: {'{namespace}:{local}'}</code></p>;
  const host = (
    <ObjectViewHost
      objectRef={objectRef}
      context={context}
      viewCompId={String(value.view ?? '')}
      isEditable={value.isEditable !== false}
      sourcePath={config.sourcePath}
    />
  );
  if (config.placement === 'visualizationNode') return <div className="doc-object-node">{host}</div>;
  // a block of a document: the margins of a block, on the outer box
  return <div className="doc-object-block">{host}</div>;
});

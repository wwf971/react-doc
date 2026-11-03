import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from './object-icon.jsx';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { objectCompDataRead, objectContextRead } from './object-comp-data.js';
import { groupDataRead } from '../../frontend/src/lib/doc-object-provider-doc.js';

// A group of objects declared in a document (doc_page_impl_obj.md#groups-and-collections):
// the document is its source of truth. With an id, the block is an object
// of the registry itself, doc:{document}#{id} of the Type doc.group (a
// core.group and a doc.block), whose members are the core.member relations
// the doc page source provides from this data; a card diagram, an
// ObjectView or another group can then name the group. A member is an entry
// of its own (its key, its note), so one object can be listed twice.
//
//   <!--renderComp=ObjectGroup,id=release-checklist-->
//   ```yaml
//   label: Release checklist
//   context: card              # how members are drawn: icon | card
//   memberList:
//     - doc:~example:root/doc.md
//     - { ref: service.w55j3ztn3rq:todo/1, note: the first todo }
//   ```
export const ObjectGroup = observer(function ObjectGroup({ data = {}, config = {} }) {
  const { objectStore } = useDocStores();
  const value = objectCompDataRead(data);
  if (value.message) return <p className="doc-error">{value.message}</p>;
  const { label, memberList } = groupDataRead({ input: { raw: data.raw ?? '', propsAuthored: data } });
  const context = objectContextRead(value.context, 'card') === 'icon' ? 'icon' : 'card';
  const groupRef = data.id && config.sourcePath ? `doc:${config.sourcePath}#${data.id}` : '';
  const descriptorGroup = { typeList: ['doc.group'], iconUrl: '' };
  return (
    // a section holding the cards of its members, not a card of cards
    <div className="doc-object-section doc-object-group">
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptorGroup} objectStore={objectStore} size={15} />
        <span className="doc-object-card-label">{label || data.id || 'Group'}</span>
        <span className="doc-badge">{objectStore.typeLabelGet('doc.group')}</span>
        <span className="doc-note">{memberList.length} member{memberList.length === 1 ? '' : 's'}</span>
      </div>
      <div className={context === 'card' ? 'doc-object-grid' : 'doc-object-member-list'}>
        {memberList.map((member) => (
          <ObjectViewHost key={member.key} objectRef={member.ref} context={context} note={member.note} sourcePath={config.sourcePath} />
        ))}
      </div>
      <p className="doc-note doc-object-card-foot">
        {groupRef ? groupRef : 'without an id the group is drawn here but is no object of the registry: give the block an id'}
      </p>
    </div>
  );
});

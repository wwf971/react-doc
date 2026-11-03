import { objectRefParse } from '../../frontend/src/lib/doc-object-ref.js';
import { objectCompDataRead } from './object-comp-data.js';

// The build-time dependency extractor of ObjectView and ObjectGroup
// (registry-source-dependency.js): a reference of the namespace doc they
// name is a document they depend on, so a pruned build keeps it and the
// link index lists it (a backlink of that document, a doc.link relation).
// Free of React: the plugin imports it.
export function objectDependenciesCollect(data, context) {
  const value = objectCompDataRead(data);
  if (value.message) {
    context.warn(`the object data is invalid, its documents are not discovered: ${value.message}`);
    return;
  }
  const refList = [value.object, value.ref];
  for (const member of Array.isArray(value.memberList) ? value.memberList : []) {
    refList.push(typeof member === 'string' ? member : member?.ref);
  }
  for (const ref of refList) {
    const parsed = objectRefParse(ref);
    if (parsed?.namespace === 'doc') context.dependencyAdd(parsed.local, 'document');
  }
}

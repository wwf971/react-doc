import { Box, Group, LayoutList, Search } from '../../frontend/UICommon.js';
import { compDefine } from '../registry/comp-registry.js';
import { OBJECT_VIEW_CONTEXT_LIST } from '../../frontend/src/lib/doc-object-ref.js';
import { ObjectView } from './ObjectView.jsx';
import { ObjectList } from './ObjectList.jsx';
import { ObjectGroup } from './ObjectGroup.jsx';
import { ObjectSearch } from './ObjectSearch.jsx';
import { ObjectViewFallback } from './ObjectViewFallback.jsx';
import { ObjectViewCollection } from './ObjectViewCollection.jsx';
import { ObjectViewConfig } from './ObjectViewConfig.jsx';
import { ObjectViewDocument } from './ObjectViewDocument.jsx';

// The components of the object registry (doc_page_impl_obj.md#the-components):
// three a document writes (ObjectView, ObjectList, ObjectGroup), and the
// views the page draws objects with when nothing nearer to their types does
// (expose.objectView): the fallback view of core.object, and the views of
// core.collection, core.config and core.document. A view is a component of
// the registry like any other; a doc page, a package or a service template
// adds views the same way, and the nearest type wins.
//
// The blocks start in the comment-block form, as every component of the
// package: the marker <!--renderComp=Xxx--> and its fenced yaml. DO NOT
// write it as `{/* ... */}` or in any other comment syntax (registry-expose.js).

const placementDocList = ['mdx', 'commentBlock'];

export const compObjectView = compDefine(ObjectView, {
  // commentInline: the inline form, a marker and the reference as inline code
  placementList: [...placementDocList, 'commentInline', 'visualizationNode'],
  expose: {
    meta: {
      label: 'Object',
      description: 'one object of the object registry, by its reference, drawn by the view of its types',
    },
    icon: Box,
    sourceDefaultCreate: ({ docPath }) => ({
      lang: 'yaml',
      raw: `object: doc:${docPath}\ncontext: card\n`,
    }),
    // a node of a card diagram (renderer: { component: ObjectView }): one
    // anchor, the card, on every side
    visualizationNode: {
      anchorListGet: () => [{ id: 'body', label: 'Object', sideList: ['left', 'right', 'top', 'bottom'] }],
      sizeDefault: { width: 240, height: 72 },
    },
  },
});

export const compObjectList = compDefine(ObjectList, {
  placementList: placementDocList,
  expose: {
    meta: {
      label: 'Object list',
      description: 'the objects of some types, from every provider of the page and of the backend',
    },
    icon: LayoutList,
    sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'type: doc.document\nlimit: 12\ncontext: card\nlayout: grid\n' }),
  },
});

export const compObjectGroup = compDefine(ObjectGroup, {
  placementList: placementDocList,
  expose: {
    meta: {
      label: 'Object group',
      description: 'a group of objects written in the document; with an id, an object of the registry itself',
    },
    icon: Group,
    sourceDefaultCreate: ({ docPath }) => ({
      lang: 'yaml',
      raw: `label: A group\ncontext: card\nmemberList:\n  - doc:${docPath}\n`,
      props: { id: 'group' },
    }),
  },
});

export const compObjectSearch = compDefine(ObjectSearch, {
  placementList: placementDocList,
  expose: {
    meta: {
      label: 'Object search',
      description: 'a search of the object service layer: names, hosts, ids, types; the object chosen shown below',
    },
    icon: Search,
    sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'typeList: []\ncontext: card\n' }),
  },
});

// the views: rendered by the page in the placement objectView only
const viewDefine = (Comp, objectView, label) => compDefine(Comp, {
  placementList: ['objectView'],
  expose: { meta: { label, isNotInDoc: true, isReadOnly: true }, objectView },
});

export const compObjectViewFallback = viewDefine(ObjectViewFallback,
  { typeList: ['core.object'], contextList: [...OBJECT_VIEW_CONTEXT_LIST], priority: -100 }, 'Object (fallback view)');
export const compObjectViewCollection = viewDefine(ObjectViewCollection,
  { typeList: ['core.collection'], contextList: ['card', 'block'] }, 'Collection');
export const compObjectViewConfig = viewDefine(ObjectViewConfig,
  { typeList: ['core.config'], contextList: ['card', 'block'] }, 'Configuration');
export const compObjectViewDocument = viewDefine(ObjectViewDocument,
  { typeList: ['core.document', 'core.place'], contextList: ['card'] }, 'Document card');


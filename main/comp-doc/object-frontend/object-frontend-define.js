import { Boxes, LayoutList, SquarePen } from '../../frontend/UICommon.js';
import { compDefine } from '../registry/comp-registry.js';
import {
  OBJECT_FRONTEND_PLACEMENT, OBJECT_FRONTEND_TYPE_INNER, OBJECT_FRONTEND_TYPE_ROOT, objectFrontendBlockTextBuild,
} from '../../frontend/src/lib/doc-object-frontend.js';
import { ObjectFrontend } from './ObjectFrontend.jsx';
import { ObjectFrontendOverview } from './ObjectFrontendOverview.jsx';
import { ObjectViewFrontend } from './ObjectViewFrontend.jsx';
import { ObjectViewFrontendInner } from './ObjectViewFrontendInner.jsx';

// The components of the frontend object service layer (doc_page_impl_obj_frontend.md):
// the entry component a document writes (ObjectFrontend), the mode every
// frontend object has (ObjectFrontendOverview, of frontend.object), the
// view of frontend.object for the object registry, and the view of
// frontend.inner, something inside an object named by an inner path.
//
// The block starts in the comment-block form, as every component of the
// package: the marker <!--renderComp=ObjectFrontend--> and its fenced yaml.
// DO NOT write it as `{/* ... */}` or in any other comment syntax (registry-expose.js).

export const compObjectFrontend = compDefine(ObjectFrontend, {
  placementList: ['mdx', 'commentBlock'],
  expose: {
    meta: {
      label: 'Frontend Object',
      description: 'an object the page keeps in its assets, drawn in a mode of its type: pick one, or create one',
      isInsertCommon: true,
      // the component of a mode takes clicks (forms, buttons): only the Edit
      // button opens the block
      isEditEnterButtonOnly: true,
      // the insert menu asks for the object first (a search of the object
      // registry limited to these types), and creates one of a type on request
      insertObjectPick: { typeList: [OBJECT_FRONTEND_TYPE_ROOT], isCreateOffered: true },
    },
    icon: Boxes,
    editModeList: [
      { id: 'entry', label: 'Object and mode', description: 'the object, its mode and the parameters', icon: SquarePen, isDefault: true },
    ],
    // env.objectRef: the object picked in the insert menu
    sourceDefaultCreate: ({ objectRef }) => ({
      lang: 'yaml',
      // the yaml without its final line break: the fence follows on the next line
      raw: objectFrontendBlockTextBuild({ object: objectRef ?? '' }).replace(/\n$/, ''),
    }),
  },
});

export const compObjectFrontendOverview = compDefine(ObjectFrontendOverview, {
  placementList: [OBJECT_FRONTEND_PLACEMENT],
  expose: { meta: { label: 'Frontend object overview', isNotInDoc: true, isReadOnly: true }, icon: LayoutList },
});

export const compObjectViewFrontend = compDefine(ObjectViewFrontend, {
  placementList: ['objectView'],
  expose: {
    meta: { label: 'Frontend object', isNotInDoc: true, isReadOnly: true },
    objectView: { typeList: [OBJECT_FRONTEND_TYPE_ROOT], contextList: ['card', 'block'], priority: 0 },
  },
});

export const compObjectViewFrontendInner = compDefine(ObjectViewFrontendInner, {
  placementList: ['objectView'],
  expose: {
    meta: { label: 'Inside a frontend object', isNotInDoc: true, isReadOnly: true },
    objectView: { typeList: [OBJECT_FRONTEND_TYPE_INNER], contextList: ['icon', 'inline', 'card', 'block'], priority: 0 },
  },
});

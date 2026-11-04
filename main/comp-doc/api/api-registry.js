import { apiByIdDoc } from './api-doc.js';
import { apiByIdEdit } from './api-edit.js';
import { apiByIdNav } from './api-nav.js';
import { apiByIdPage } from './api-page.js';
import { apiByIdObject } from './api-object.js';
import { apiByIdObjectFrontend } from './api-object-frontend.js';

// all apis the package registers, by id ({layer}/{name}), the counterpart
// of compById in registry/registry.js and of slashActionById in
// slash/slash-registry.js (doc_page_impl_api.md#the-registry). each layer
// of the page keeps its apis in a file of this folder; the registry knows
// none of them by name. the doc pages add the apis they declare in yaml
// (.doc-page/api.yaml), a host adds or replaces apis through DocPageMdx
// config.apiById, and the components and the service instances add theirs
// through providers at run time (DocApiStore).
export const apiById = {
  ...apiByIdNav,
  ...apiByIdDoc,
  ...apiByIdEdit,
  ...apiByIdPage,
  ...apiByIdObject,
  ...apiByIdObjectFrontend,
};

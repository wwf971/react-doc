import { linkSlashAction } from '../link/link-slash.js';

// all slash actions the package registers, by id ({layer}/{name}), the
// counterpart of compById in registry/registry.js. each is defined by the
// service layer it belongs to, beside that layer's other code; the slash
// mode knows none of them by name. a host adds or replaces actions through
// DocPageMdx config.slashActionById (doc_page_impl_edit_slash.md#the-slash-action-registry).
export const slashActionById = {
  // the navigation layer: a link to a document of the workspace
  'nav/link': linkSlashAction,
};

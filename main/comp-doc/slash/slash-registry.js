import { linkInlineSlashAction, linkSlashAction } from '../link/link-slash.js';
import { objectSlashAction } from '../object/object-slash.js';
import { mdxSlashAction } from '../../../built-in/comp-mdx/text/mdx-slash.js';
import { codeSlashAction } from '../../../built-in/comp-mdx/text/code-slash.js';

// all slash actions the package registers, by id ({layer}/{name}), the
// counterpart of compById in registry/registry.js. each is defined by the
// service layer it belongs to, beside that layer's other code; the slash
// mode knows none of them by name. a host adds or replaces actions through
// DocPageMdx config.slashActionById (doc_page_impl_edit_slash.md#the-slash-action-registry).
export const slashActionById = {
  // the navigation layer: a link to a document of the workspace
  'nav/link': linkSlashAction,
  // an inline link: the document it names opens in the inline popup
  'nav/inline': linkInlineSlashAction,
  // a block at the caret, its view an optional parameter (Tab: choose it):
  // a fenced code block; an MDX block, a document of its own written inside
  // this one, an icon whose popup shows it (and edits it, in edit mode)
  'block/code': codeSlashAction,
  'block/mdx': mdxSlashAction,
  // the object service layer: a view of an object of the registry, found a
  // type, an object, then what is inside it
  'object/view': objectSlashAction,
};

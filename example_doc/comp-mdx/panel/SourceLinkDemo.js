import { LinkIcon } from '../../../main/frontend/UICommon.js';
import { SourceLink } from '../../../built-in/comp-mdx/source-link/SourceLink.jsx';
import { TextPanelDemo } from './TextPanelDemo.jsx';

// SourceLink (built-in/comp-mdx/source-link/) bound to the demonstration's
// popup panel: the panel that frames the source popup is host
// configuration, so the package does not register SourceLink itself; this
// doc page mounts it through comp.yaml of this folder (tag SourceLink, id
// specific/SourceLink, kept for the build-time link collector keyed by id,
// registry-source-dependency.js) with the options below
// (doc_page_impl_mdx_comp.md#components-of-a-doc-page)
export { SourceLink };

export const sourceLinkDefineOptions = {
  dataBuild: (input) => ({
    ...input,
    config: {
      ...input.config,
      panelComponent: TextPanelDemo,
    },
  }),
  placementList: ['mdx', 'commentBlock'],
  expose: {
    // the link points to the document it is written in until the author changes it
    meta: { label: 'Source link', description: 'A link that shows a source file in a popup.' },
    icon: LinkIcon,
    sourceDefaultCreate: ({ docPath }) => ({ lang: 'text', raw: docPath }),
  },
};

import { createElement } from 'react';
import { defaultMdxComponents } from '../../UICommon.js';
import { DocLink } from '../../../comp-doc/link/DocLink.jsx';
import { DocComp } from '../../../comp-doc/registry/DocComp.jsx';
import { compById } from '../../../comp-doc/registry/registry.js';
import {
  compDefinitionNormalize,
  compIdBuiltinByName,
  compIdResolve,
} from '../../../comp-doc/registry/comp-registry.js';
import { RegisteredComp } from '../../../comp-doc/registry/RegisteredComp.jsx';
import { MultiLangHeadingText } from '../../../../built-in/comp-mdx/multi-lang/MultiLangEntry.jsx';
import { headingTagCreate } from '../../../../built-in/comp-mdx/text/Heading.jsx';
import { listTagCreate } from '../../../../built-in/comp-mdx/text/List.jsx';
import { ParagraphTag } from '../../../../built-in/comp-mdx/text/Paragraph.jsx';

// component mapping used when rendering compiled docs.
// fumadocs defaults stay untouched (headings, code blocks, callout, ...);
// we only add DocLink/DocComp, the built-in names, and the tags enabled by
// config compRegistry.
//
// options.sourcePath: internal path of the document these components belong
// to, when it is not the current page (e.g. a document compiled for the
// SourceLink render popup). it scopes registered-component identity and
// configuration to that document instead of docStore.docCurrentPath.
export function buildMdxComps(configDoc, compByIdExtra = {}, options = {}) {
  const compByIdMerged = { ...compById, ...compByIdExtra };
  const configRuntimeShared = options.sourcePath !== undefined
    ? { sourcePath: options.sourcePath }
    : {};
  const comps = {
    ...defaultMdxComponents,
    DocLink,
    MultiLangHeadingText,
    DocComp: function MdxCommentRegisteredComp(props) {
      const compId = compIdResolve(configDoc, props.comp);
      return createElement(DocComp, {
        ...props,
        compDefinition: compByIdMerged[compId],
        compId,
        sourcePath: options.sourcePath,
      });
    },
  };
  // the text blocks live in comp-mdx/text, next to their edit-mode editors
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    comps[tag] = headingTagCreate(tag);
  }
  comps.p = ParagraphTag;
  for (const tag of ['ul', 'ol', 'li']) {
    comps[tag] = listTagCreate(tag);
  }
  const compIdByTag = { ...compIdBuiltinByName, ...configDoc.compRegistry };
  for (const [tag, compId] of Object.entries(compIdByTag)) {
    const definition = compDefinitionNormalize(compByIdMerged[compId]);
    if (!definition) {
      console.warn(`[comp-registry] unknown comp id "${compId}" for tag "${tag}"`);
      continue;
    }
    comps[tag] = function MdxRegisteredComp(props) {
      return createElement(RegisteredComp, {
        compDefinition: definition,
        compId,
        configRuntime: configRuntimeShared,
        input: { propsAuthored: props },
        placement: 'mdx',
      });
    };
  }
  return comps;
}

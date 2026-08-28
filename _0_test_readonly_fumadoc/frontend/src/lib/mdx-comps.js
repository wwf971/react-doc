import { createElement } from 'react';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocLink } from '../comp-doc/DocLink.jsx';
import { DocComp } from '../comp-doc/DocComp.jsx';
import { compById } from '../comp-doc/registry.js';
import { compDefinitionNormalize } from '../comp-doc/comp-registry.js';
import { RegisteredComp } from '../comp-doc/RegisteredComp.jsx';

// component mapping used when rendering compiled docs.
// fumadocs defaults stay untouched (headings, code blocks, callout, ...);
// we only add DocLink/DocComp and the tags enabled by config compRegistry.
export function buildMdxComps(configDoc, compByIdExtra = {}) {
  const compByIdMerged = { ...compById, ...compByIdExtra };
  const comps = {
    ...defaultMdxComponents,
    DocLink,
    DocComp: function MdxCommentRegisteredComp(props) {
      const compId = configDoc.compRegistry?.[props.comp] ?? props.comp;
      return createElement(DocComp, {
        ...props,
        compDefinition: compByIdMerged[compId],
        compId,
      });
    },
  };
  for (const [tag, compId] of Object.entries(configDoc.compRegistry ?? {})) {
    const definition = compDefinitionNormalize(compByIdMerged[compId]);
    if (!definition) {
      console.warn(`[comp-registry] unknown comp id "${compId}" for tag "${tag}"`);
      continue;
    }
    comps[tag] = function MdxRegisteredComp(props) {
      return createElement(RegisteredComp, {
        compDefinition: definition,
        compId,
        input: { propsAuthored: props },
        placement: 'mdx',
      });
    };
  }
  return comps;
}

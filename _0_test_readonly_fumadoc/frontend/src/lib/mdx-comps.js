import { createElement } from 'react';
import { defaultMdxComponents } from '../../UICommon.js';
import { DocLink } from '../comp-doc/DocLink.jsx';
import { DocComp } from '../comp-doc/DocComp.jsx';
import { compById } from '../comp-doc/registry.js';
import { compDefinitionNormalize } from '../comp-doc/comp-registry.js';
import { RegisteredComp } from '../comp-doc/RegisteredComp.jsx';
import { MultiLangHeadingText } from '../comp-doc/common/MultiLangEntry.jsx';

// component mapping used when rendering compiled docs.
// fumadocs defaults stay untouched (headings, code blocks, callout, ...);
// we only add DocLink/DocComp and the tags enabled by config compRegistry.
export function buildMdxComps(configDoc, compByIdExtra = {}) {
  const compByIdMerged = { ...compById, ...compByIdExtra };
  const comps = {
    ...defaultMdxComponents,
    DocLink,
    MultiLangHeadingText,
    DocComp: function MdxCommentRegisteredComp(props) {
      const compId = configDoc.compRegistry?.[props.comp] ?? props.comp;
      return createElement(DocComp, {
        ...props,
        compDefinition: compByIdMerged[compId],
        compId,
      });
    },
  };
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const HeadingDefault = defaultMdxComponents[tag];
    comps[tag] = function MdxMultiLangHeading({ children, ...props }) {
      const variantsJson = props['data-multi-lang-heading'];
      if (!variantsJson) return createElement(HeadingDefault, props, children);
      const propsHeading = { ...props };
      delete propsHeading['data-multi-lang-heading'];
      return createElement(
        HeadingDefault,
        propsHeading,
        createElement(MultiLangHeadingText, { variantsJson }),
      );
    };
  }
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

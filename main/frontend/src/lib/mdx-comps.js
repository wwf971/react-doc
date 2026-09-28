import { createElement } from 'react';
import { defaultMdxComponents } from '../../UICommon.js';
import { DocLink } from '../../../comp-doc/link/DocLink.jsx';
import { DocComp } from '../../../comp-doc/registry/DocComp.jsx';
import { compById } from '../../../comp-doc/registry/registry.js';
import { compDefinitionNormalize, compIdResolve } from '../../../comp-doc/registry/comp-registry.js';
import { RegisteredComp } from '../../../comp-doc/registry/RegisteredComp.jsx';
import { MultiLangHeadingText } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';

// component mapping used when rendering compiled docs.
// fumadocs defaults stay untouched (headings, code blocks, callout, ...);
// we only add DocLink/DocComp and the tags enabled by config compRegistry.
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
        configRuntime: configRuntimeShared,
        input: { propsAuthored: props },
        placement: 'mdx',
      });
    };
  }
  return comps;
}

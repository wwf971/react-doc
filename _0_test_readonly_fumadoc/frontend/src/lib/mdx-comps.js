import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocLink } from '../comp-doc/DocLink.jsx';
import { DocComp } from '../comp-doc/DocComp.jsx';
import { compById } from '../comp-doc/registry.js';

// component mapping used when rendering compiled docs.
// fumadocs defaults stay untouched (headings, code blocks, callout, ...);
// we only add DocLink/DocComp and the tags enabled by config compRegistry.
export function buildMdxComps(configDoc, compByIdExtra = {}) {
  const compByIdMerged = { ...compById, ...compByIdExtra };
  const comps = { ...defaultMdxComponents, DocLink, DocComp };
  for (const [tag, compId] of Object.entries(configDoc.compRegistry ?? {})) {
    const Comp = compByIdMerged[compId];
    if (!Comp) {
      console.warn(`[comp-registry] unknown comp id "${compId}" for tag "${tag}"`);
      continue;
    }
    comps[tag] = Comp;
  }
  return comps;
}

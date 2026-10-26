import { compDefine, compDefinitionNormalize } from './comp-registry.js';

// The components of the doc pages, mounted into the component registry
// (doc_page_impl_mdx_comp.md#components-of-a-doc-page). The vite plugin
// finds them in the component folders of every doc page the page loads
// (comp-mdx/ by convention, or the folders .doc-page/comp.yaml names),
// reads their manifests (comp.yaml), imports every module a manifest names
// and exports the mounts as docCompMountList of virtual:doc-source:
//
//   { docPageAlias, tagName, id, export, defineOptionsExport, entryFile, module }
//
// the host hands the list to DocPageMdx as data.compMountList; this builds
// the registry definitions from it, keyed by id: the export is a definition
// made with compDefine() and is taken as it is, or a React component, which
// is defined here with the options of defineOptionsExport (none: a plain
// definition). the tag name -> id mapping is not made here: the plugin
// writes it into configDoc.compRegistry, which compIdResolve reads.
//
// a mount whose export is missing is reported ([doc-comp]) and left out,
// never the page; the first of two mounts with one id is kept (the plugin
// already keeps the first of two declarations of a tag name or an id).
export function compMountByIdBuild(mountList) {
  const compById = {};
  for (const mount of Array.isArray(mountList) ? mountList : []) {
    const place = `${mount.docPageAlias}: ${mount.tagName} (${mount.entryFile})`;
    const module = mount.module;
    if (!module || typeof module !== 'object') {
      console.warn(`[doc-comp] ${place}: the module did not load`);
      continue;
    }
    const value = module[mount.export];
    if (value === undefined) {
      console.warn(`[doc-comp] ${place}: the module has no export "${mount.export}"`);
      continue;
    }
    let definition = compDefinitionNormalize(value);
    if (!definition) {
      console.warn(`[doc-comp] ${place}: export "${mount.export}" is neither a compDefine() definition nor a React component`);
      continue;
    }
    let options;
    if (mount.defineOptionsExport) {
      options = module[mount.defineOptionsExport];
      if (options === undefined) {
        console.warn(`[doc-comp] ${place}: the module has no export "${mount.defineOptionsExport}" (defineOptionsExport); defined without options`);
      } else if (!options || typeof options !== 'object') {
        console.warn(`[doc-comp] ${place}: export "${mount.defineOptionsExport}" (defineOptionsExport) must be the options object of compDefine(); ignored`);
        options = undefined;
      }
    }
    if (definition.isLegacy) {
      // a plain component: defined here, with the options when named
      definition = compDefine(value, options ?? {});
    } else if (options !== undefined) {
      console.warn(`[doc-comp] ${place}: export "${mount.export}" is a definition already; its defineOptionsExport is ignored`);
    }
    if (compById[mount.id] !== undefined) {
      console.warn(`[doc-comp] ${place}: the id ${mount.id} is mounted already; this one is left out`);
      continue;
    }
    compById[mount.id] = definition;
  }
  return compById;
}

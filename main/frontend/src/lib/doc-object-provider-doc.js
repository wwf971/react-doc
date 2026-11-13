import { parse as yamlParse } from 'yaml';
import { sourcePathDirGet, sourcePathNameGet, sourcePathParse } from './doc-source-path.js';
import { objectRefParse } from './doc-object-ref.js';

// The doc page source service layer as a provider of the object registry
// (design: doc_page_impl_obj.md#documents-as-objects). It keeps its own
// internal representation (the manifests, the compiled documents) and
// answers from it; the registry keeps nothing of it but what it answered.
//
//   docPage:{alias}               doc.page      a doc page of the workspace
//   docDir:{~page:root/dir}       doc.folder    a folder of the source (a root: ~page:root)
//   doc:{~page:root/a.md}         doc.document  a document
//   doc:{path}#{fragment}         doc.section   a heading, by the fragment navigation uses (its id)
//                                 doc.block     a component block that declares an id
//                                 doc.group     an ObjectGroup block: its members are the
//                                               references it lists (core.member)
//
// What it can enumerate (query) is what the manifests list: doc pages,
// folders, documents. Sections and blocks are resolved one by one (the
// document is compiled when it is not yet), and listed only for the
// documents this page compiled, which a query says (partial). The document
// is the truth of what is in it: a section renamed, a block removed by any
// editor, and the reference finds nothing (missing).
//
// relations: core.contains (doc page > root folders > folders and documents >
// sections > sub-sections), core.member (a group > the objects it lists)

export const DOC_OBJECT_GROUP_COMP_NAME = 'ObjectGroup';

const DOC_EXT_LIST = ['md', 'mdx'];

export function objectProviderDocCreate({ sourceStore, docStore }) {
  const isDocument = (entry) => DOC_EXT_LIST.includes(String(entry.ext ?? '').replace(/^\./, ''));

  const docPageDescriptor = (docPage) => ({
    ref: `docPage:${docPage.alias}`,
    typeList: ['doc.page'],
    label: docPage.title || docPage.alias,
    description: `the doc page ${docPage.alias}${docPage.isRoot ? '' : ' (included)'}`,
    summary: { alias: docPage.alias, isRoot: docPage.isRoot, rootCount: docPage.rootList?.length ?? 0 },
    capabilityList: [],
    open: null,
  });

  const dirDescriptor = (dir) => {
    const parsed = sourcePathParse(dir.internalPath);
    const name = parsed?.relPath ? sourcePathNameGet(dir.internalPath) : `~${dir.rootAlias}`;
    return {
      ref: `docDir:${dir.internalPath}`,
      typeList: ['doc.folder'],
      label: name,
      description: dir.internalPath,
      summary: { docPageAlias: dir.docPageAlias, rootAlias: dir.rootAlias, relPath: dir.relPath },
      capabilityList: [],
      open: null,
    };
  };

  const navigateOpenGet = (path, hash = '') => {
    const isNavigable = docStore?.treeModel?.itemIdsByDocPath?.has(path) === true;
    return isNavigable ? { kind: 'navigate', target: hash ? `${path}#${hash}` : path } : null;
  };

  const docDescriptor = (entry, { isOpenable = true } = {}) => ({
    ref: `doc:${entry.internalPath}`,
    typeList: ['doc.document'],
    label: entry.title || entry.name,
    description: entry.internalPath,
    summary: { docPageAlias: entry.docPageAlias, ext: entry.ext, collect: entry.collect ?? '' },
    // innerComplete: its sections complete a reference typed into it
    capabilityList: ['read', 'innerComplete'],
    open: isOpenable ? navigateOpenGet(entry.internalPath) : null,
  });

  // the sections of a compiled document: its headings, as the source layer lists them
  const sectionListGet = (path) => sourceStore.headingListGet(path);

  const sectionDescriptor = (path, section) => ({
    ref: `doc:${path}#${section.id}`,
    typeList: ['doc.section'],
    label: section.title || section.id,
    description: `${sourcePathNameGet(path)} § ${section.title || section.id}`,
    summary: { depth: section.depth, docPath: path },
    capabilityList: ['read'],
    open: navigateOpenGet(path, section.id),
  });

  const blockListGet = (path) => {
    const state = sourceStore.compiledByPath[path];
    if (state?.status !== 'done') return undefined;
    return (state.componentList ?? []).filter((component) => component.id);
  };

  const blockDescriptor = (path, component) => {
    const isGroup = component.compName === DOC_OBJECT_GROUP_COMP_NAME;
    const data = isGroup ? groupDataRead(component) : {};
    return {
      ref: `doc:${path}#${component.id}`,
      typeList: [isGroup ? 'doc.group' : 'doc.block'],
      label: (isGroup && data.label) || `${component.compName} ${component.id}`,
      description: isGroup
        ? `a group of ${data.memberList.length} declared in ${sourcePathNameGet(path)}`
        : `a ${component.compName} block of ${sourcePathNameGet(path)}`,
      summary: { compName: component.compName, docPath: path, ...(isGroup ? { memberCount: data.memberList.length } : {}) },
      capabilityList: ['read'],
      open: navigateOpenGet(path, component.id),
    };
  };

  // the descriptor of a place in a document: a block of that id, else a
  // heading of that id, else a heading of that title (the rules of a
  // fragment, doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)
  const placeDescriptorGet = (path, fragment) => {
    const component = (blockListGet(path) ?? []).find((item) => item.id === fragment);
    if (component) return blockDescriptor(path, component);
    const sectionList = sectionListGet(path) ?? [];
    const fragmentLower = fragment.toLowerCase();
    const section = sectionList.find((item) => item.id === fragment)
      ?? sectionList.find((item) => item.title.toLowerCase() === fragmentLower);
    return section ? sectionDescriptor(path, section) : null;
  };

  const resolveOne = async (ref) => {
    const parsed = objectRefParse(ref);
    if (!parsed) return null;
    if (parsed.namespace === 'docPage') {
      const docPage = sourceStore.docPageGet(parsed.local);
      return docPage ? docPageDescriptor(docPage) : null;
    }
    if (parsed.namespace === 'docDir') {
      const dir = sourceStore.dirManifest.find((item) => item.internalPath === parsed.local);
      return dir ? dirDescriptor(dir) : null;
    }
    const split = docRefSplit(ref);
    if (!split) return null;
    const entry = sourceStore.entryByInternalPath.get(split.path);
    if (!entry) return null;
    if (!split.fragment) return docDescriptor(entry);
    // a place inside: the document is compiled for it, once
    if (sourceStore.compiledByPath[split.path]?.status !== 'done') await sourceStore.loadDoc(split.path);
    return placeDescriptorGet(split.path, split.fragment);
  };

  return {
    id: 'doc-source',
    label: 'the doc page source',
    registry: 'page',
    namespaceList: ['doc', 'docDir', 'docPage'],
    typeList: ['doc.page', 'doc.folder', 'doc.document', 'doc.section', 'doc.block', 'doc.group'],
    relationTypeList: ['core.contains', 'core.member'],
    capabilityList: ['query', 'resolve', 'read', 'relationQuery', 'innerComplete'],
    queryFilterList: ['docPageAlias'],
    // the answers follow the source data: a manifest replaced or a document
    // compiled is a new version, so what the registry kept is asked again
    versionGet: () => [sourceStore.fileManifest, sourceStore.dirManifest, Object.keys(sourceStore.compiledByPath).length],
    cacheSecond: 300,

    // inside a document: its sections, by the words typed (a title, a fragment). the document
    // is compiled when it was not yet, and the list follows
    // (doc_page_impl_obj.md#inside-an-object)
    innerComplete: (ref, text) => {
      const split = docRefSplit(ref);
      if (!split || split.fragment || !sourceStore.entryByInternalPath.get(split.path)) return { status: 'done', itemList: [], message: `${ref} is not a document` };
      const sectionList = sectionListGet(split.path);
      if (!sectionList) {
        if (sourceStore.compiledByPath[split.path]?.status !== 'error') queueMicrotask(() => void sourceStore.loadDoc(split.path));
        return { status: sourceStore.compiledByPath[split.path]?.status === 'error' ? 'done' : 'loading', itemList: [], message: '' };
      }
      const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return {
        status: 'done',
        message: '',
        itemList: sectionList
          .filter((section) => wordList.every((word) => `${section.title} ${section.id}`.toLowerCase().includes(word)))
          .map((section) => ({ kind: 'item', ref: `doc:${split.path}#${section.id}`, label: section.title || section.id, detail: `§ ${'·'.repeat(Math.max(0, (section.depth ?? 1) - 1))} #${section.id}` })),
      };
    },

    query: (spec, registry) => {
      const typeListAsked = spec.typeList;
      const wants = (typeId) => typeListAsked.some((asked) => registry.isAssignable(typeId, asked));
      const docPageAlias = String(spec.filter?.docPageAlias ?? '');
      const objectList = [];
      if (wants('doc.page')) {
        for (const docPage of sourceStore.docPageList) {
          if (!docPageAlias || docPage.alias === docPageAlias) objectList.push(docPageDescriptor(docPage));
        }
      }
      if (wants('doc.folder')) {
        for (const dir of sourceStore.dirManifest) {
          if (!docPageAlias || dir.docPageAlias === docPageAlias) objectList.push(dirDescriptor(dir));
        }
      }
      if (wants('doc.document')) {
        for (const entry of sourceStore.fileManifest) {
          if (isDocument(entry) && (!docPageAlias || entry.docPageAlias === docPageAlias)) objectList.push(docDescriptor(entry));
        }
      }
      // the places of the documents compiled on this page only
      const isPlaceAsked = ['doc.section', 'doc.block', 'doc.group'].some(wants);
      if (isPlaceAsked) {
        for (const [path, state] of Object.entries(sourceStore.compiledByPath)) {
          if (state?.status !== 'done') continue;
          if (docPageAlias && sourceStore.entryByInternalPath.get(path)?.docPageAlias !== docPageAlias) continue;
          if (wants('doc.section')) for (const section of sectionListGet(path) ?? []) objectList.push(sectionDescriptor(path, section));
          for (const component of blockListGet(path) ?? []) {
            const descriptor = blockDescriptor(path, component);
            if (wants(descriptor.typeList[0])) objectList.push(descriptor);
          }
        }
      }
      return isPlaceAsked
        ? { objectList, isComplete: false, message: 'sections and blocks only of the documents compiled on this page' }
        : objectList;
    },

    resolve: (refList) => Promise.all(refList.map(resolveOne)),

    // a document: its text; a place: what it is; a group: its members as written
    read: async (ref) => {
      const descriptor = await resolveOne(ref);
      if (!descriptor) throw new Error(`${ref} is not found`);
      const split = docRefSplit(ref);
      if (!split?.fragment) {
        await sourceStore.loadRaw(split.path);
        return { descriptor, content: { path: split.path, text: sourceStore.rawByPath[split.path]?.content ?? '' } };
      }
      const component = (blockListGet(split.path) ?? []).find((item) => item.id === split.fragment);
      if (component) {
        return {
          descriptor,
          content: component.compName === DOC_OBJECT_GROUP_COMP_NAME
            ? groupDataRead(component)
            : { compName: component.compName, props: component.input.propsAuthored ?? {}, raw: component.input.raw ?? '' },
        };
      }
      return { descriptor, content: { ...descriptor.summary, title: descriptor.label } };
    },

    relationQuery: async (spec, registry) => {
      const wantsContains = spec.typeList.some((asked) => registry.isAssignable('core.contains', asked));
      const wantsMember = spec.typeList.some((asked) => registry.isAssignable('core.member', asked));
      const relationList = [];
      const contain = (fromRef, toRef, order) => relationList.push({ key: `contains/${toRef}`, type: 'core.contains', fromRef, toRef, order });
      const from = objectRefParse(spec.fromRef);
      const to = objectRefParse(spec.toRef);
      if (!from && !to) {
        return { relationList: [], isComplete: false, message: 'the doc page source lists relations from or to an object, not all of them' };
      }
      if (wantsContains && from?.namespace === 'docPage') {
        sourceStore.dirManifest
          .filter((dir) => dir.docPageAlias === from.local && dir.relPath === '')
          .forEach((dir, index) => contain(spec.fromRef, `docDir:${dir.internalPath}`, index));
      }
      if (wantsContains && from?.namespace === 'docDir') {
        let order = 0;
        for (const dir of sourceStore.dirManifest) {
          if (dir.relPath !== '' && sourcePathDirGet(dir.internalPath) === from.local) contain(spec.fromRef, `docDir:${dir.internalPath}`, order++);
        }
        for (const entry of sourceStore.fileManifest) {
          if (isDocument(entry) && sourcePathDirGet(entry.internalPath) === from.local) contain(spec.fromRef, `doc:${entry.internalPath}`, order++);
        }
      }
      const fromDoc = docRefSplit(spec.fromRef);
      if (fromDoc && sourceStore.entryByInternalPath.has(fromDoc.path)) {
        if (sourceStore.compiledByPath[fromDoc.path]?.status !== 'done') await sourceStore.loadDoc(fromDoc.path);
        const sectionList = sectionListGet(fromDoc.path) ?? [];
        if (wantsContains) {
          // the sections right under the document, or under a section: the
          // headings deeper than it up to the next one of its depth or less
          const indexFrom = fromDoc.fragment ? sectionList.findIndex((item) => item.id === fromDoc.fragment) : -1;
          if (!fromDoc.fragment || indexFrom >= 0) {
            const depthFrom = indexFrom >= 0 ? sectionList[indexFrom].depth : 0;
            const childList = [];
            for (let index = indexFrom + 1; index < sectionList.length; index += 1) {
              if (sectionList[index].depth <= depthFrom) break;
              childList.push(sectionList[index]);
            }
            const depthChild = Math.min(...childList.map((item) => item.depth));
            childList.filter((item) => item.depth === depthChild)
              .forEach((section, index) => contain(spec.fromRef, `doc:${fromDoc.path}#${section.id}`, index));
          }
        }
        if (wantsMember && fromDoc.fragment) {
          const component = (blockListGet(fromDoc.path) ?? []).find((item) => item.id === fromDoc.fragment && item.compName === DOC_OBJECT_GROUP_COMP_NAME);
          if (component) {
            groupDataRead(component).memberList.forEach((member, index) => {
              relationList.push({
                key: `member/${fromDoc.path}#${component.id}/${member.key}`,
                type: 'core.member',
                fromRef: spec.fromRef,
                toRef: member.ref,
                order: index,
                label: member.note,
                data: { note: member.note },
              });
            });
          }
        }
      }
      // the container of an object: its folder, its document, its doc page
      if (wantsContains && to) {
        if (to.namespace === 'docDir') {
          const dir = sourceStore.dirManifest.find((item) => item.internalPath === to.local);
          if (dir) {
            const parentRef = dir.relPath === '' ? `docPage:${dir.docPageAlias}` : `docDir:${sourcePathDirGet(dir.internalPath)}`;
            contain(parentRef, spec.toRef, 0);
          }
        }
        const toDoc = docRefSplit(spec.toRef);
        if (toDoc && sourceStore.entryByInternalPath.has(toDoc.path)) {
          contain(toDoc.fragment ? `doc:${toDoc.path}` : `docDir:${sourcePathDirGet(toDoc.path)}`, spec.toRef, 0);
        }
      }
      return relationList;
    },

    // a document or a place in one is navigated to
    open: (descriptor) => (descriptor.open?.kind === 'navigate' ? docStore.navigate(descriptor.open.target) : false),

    // what the page registers into the backend's registry: the doc pages and
    // the documents, so a service can find them (doc_page_impl_obj.md#the-page-and-the-backend);
    // the backend cannot navigate the page, so they have no place to open
    descriptorListForPeerGet: () => [
      ...sourceStore.docPageList.map(docPageDescriptor),
      ...sourceStore.fileManifest.filter(isDocument).map((entry) => docDescriptor(entry, { isOpenable: false })),
    ],
  };
}

// { path, fragment } of a reference of the namespace doc (the local part is
// this provider's: a full source path, then "#" and a fragment); undefined
// for another namespace. the links (doc-object-provider-link.js) relate the
// same documents and read their references with it
export function docRefSplit(ref) {
  const parsed = objectRefParse(ref);
  if (parsed?.namespace !== 'doc') return undefined;
  const indexHash = parsed.local.indexOf('#');
  return indexHash < 0
    ? { path: parsed.local, fragment: '' }
    : { path: parsed.local.slice(0, indexHash), fragment: fragmentDecode(parsed.local.slice(indexHash + 1)) };
}

function fragmentDecode(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

// the data of an ObjectGroup block: { label, memberList: [{ key, ref, note }] }.
// a member is a reference, or { ref, key?, note? }; its key (the entry) is
// the one written, else its position, so one object may be a member twice
export function groupDataRead(component) {
  let raw = {};
  try {
    raw = yamlParse(component.input?.raw ?? '') ?? {};
  } catch {
    raw = {};
  }
  const memberListRaw = Array.isArray(raw?.memberList) ? raw.memberList : [];
  const memberList = memberListRaw.map((item, index) => {
    const member = typeof item === 'string' ? { ref: item } : (item ?? {});
    return { key: String(member.key ?? index), ref: String(member.ref ?? ''), note: String(member.note ?? '') };
  }).filter((member) => objectRefParse(member.ref) !== undefined);
  return { label: String(raw?.label ?? component.input?.propsAuthored?.label ?? ''), memberList };
}

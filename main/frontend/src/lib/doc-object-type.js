import typeBuiltinFile from '../../../../built-in/object-type/object-type-builtin.json';

// The Type registry of the page (design: doc_page_impl_obj.md#types). The
// same semantics as the backend's (service_object.py TypeRegistry): a Type
// is { id, kind: object | relation, label, description, extendList, icon,
// summaryKeyList, definedBy }, a Type extends any number of Types of its
// kind, the roots are core.object and core.relation, and a Type nobody
// defines is taken as a child of both roots (every object is a core.object).
//
// The page reads the built-in Types from the JSON file the kernel reads too,
// and the backend's list when there is a backend (the built-in Types and
// those the service templates define), so both registries agree.

export const TYPE_ROOT_BY_KIND = { object: 'core.object', relation: 'core.relation' };

export const typeBuiltinList = (typeBuiltinFile.typeList ?? []).map((item) => typeDefineNormalize(item, { kind: 'builtIn' }));

export function typeDefineNormalize(item, definedBy = { kind: 'builtIn' }) {
  const kind = item.kind === 'relation' ? 'relation' : 'object';
  const extendList = Array.isArray(item.extendList)
    ? item.extendList.map(String)
    : (item.id === TYPE_ROOT_BY_KIND[kind] ? [] : [TYPE_ROOT_BY_KIND[kind]]);
  return {
    ...item,
    id: String(item.id),
    kind,
    label: String(item.label || item.id),
    description: String(item.description ?? ''),
    extendList,
    icon: String(item.icon ?? ''),
    summaryKeyList: Array.isArray(item.summaryKeyList) ? item.summaryKeyList.map(String) : [],
    definedBy: item.definedBy ?? definedBy,
  };
}

// a registry of a list of Types: the first definition of an id is kept; a
// parent nobody defines is replaced by the root of the kind; a cycle is
// broken where it closes. problemList says what was done
export function typeRegistryBuild(typeList) {
  const typeById = new Map();
  const problemList = [];
  for (const item of typeList) {
    if (typeById.has(item.id)) continue;
    typeById.set(item.id, { ...item, extendList: [...item.extendList] });
  }
  for (const type of typeById.values()) {
    const extendList = [];
    for (const parentId of type.extendList) {
      const parent = typeById.get(parentId);
      let parentIdUsed = parentId;
      if (!parent) {
        parentIdUsed = TYPE_ROOT_BY_KIND[type.kind];
        problemList.push(`the Type ${type.id} extends ${parentId}, which no one defines; it extends ${parentIdUsed} instead`);
      } else if (parent.kind !== type.kind) {
        problemList.push(`the Type ${type.id} (${type.kind}) cannot extend ${parentId} (${parent.kind})`);
        continue;
      }
      if (parentIdUsed !== type.id && !extendList.includes(parentIdUsed)) extendList.push(parentIdUsed);
    }
    type.extendList = extendList;
  }
  const stateById = new Map();
  const visit = (typeId, path) => {
    stateById.set(typeId, 'visiting');
    const type = typeById.get(typeId);
    for (const parentId of [...type.extendList]) {
      if (!typeById.has(parentId)) continue;
      if (stateById.get(parentId) === 'visiting') {
        problemList.push(`the Types extend one another in a cycle: ${[...path, typeId, parentId].join(' -> ')}`);
        type.extendList = type.extendList.filter((item) => item !== parentId);
      } else if (!stateById.has(parentId)) {
        visit(parentId, [...path, typeId]);
      }
    }
    stateById.set(typeId, 'done');
  };
  for (const typeId of typeById.keys()) if (!stateById.has(typeId)) visit(typeId, []);

  const ancestorById = new Map();
  // { ancestor: distance } of a Type, itself at 0
  const ancestorDistanceGet = (typeId) => {
    const cached = ancestorById.get(typeId);
    if (cached) return cached;
    let result;
    if (!typeById.has(typeId)) {
      result = new Map([[typeId, 0], ['core.object', 1], ['core.relation', 1]]);
    } else {
      result = new Map([[typeId, 0]]);
      let frontier = [typeId];
      let distance = 0;
      while (frontier.length > 0) {
        distance += 1;
        const frontierNext = [];
        for (const current of frontier) {
          for (const parentId of typeById.get(current)?.extendList ?? []) {
            if (result.has(parentId)) continue;
            result.set(parentId, distance);
            frontierNext.push(parentId);
          }
        }
        frontier = frontierNext;
      }
    }
    ancestorById.set(typeId, result);
    return result;
  };

  const registry = {
    typeById,
    problemList,
    typeGet: (typeId) => typeById.get(typeId),
    typeList: () => [...typeById.values()],
    ancestorDistanceGet,
    // the ancestors of a Type, the nearest first (not itself)
    ancestorListGet: (typeId) => [...ancestorDistanceGet(typeId)]
      .filter(([id]) => id !== typeId)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id),
    // whether an object of typeId is one of typeIdTo: the same Type or a subtype
    isAssignable: (typeId, typeIdTo) => ancestorDistanceGet(typeId).has(typeIdTo),
    isAssignableAny: (typeList, typeListTo) => typeList.some((typeId) => typeListTo.some((typeIdTo) => ancestorDistanceGet(typeId).has(typeIdTo))),
    // how far an object of these Types is from typeIdTo: the smallest number
    // of steps up to it, undefined when it is not one
    distanceGet: (typeList, typeIdTo) => {
      let distanceMin;
      for (const typeId of typeList) {
        const distance = ancestorDistanceGet(typeId).get(typeIdTo);
        if (distance !== undefined && (distanceMin === undefined || distance < distanceMin)) distanceMin = distance;
      }
      return distanceMin;
    },
    // where typeIdTo comes among what an object of these Types is, walking up
    // breadth first and each Type's parents in the order it lists them: the
    // nearest first, and of two at one distance the one listed first (a
    // doc.document is a core.document before it is a core.collection).
    // undefined when it is not one. what decides between two views
    rankGet: (typeList, typeIdTo) => {
      const seen = new Set();
      let frontier = [...typeList];
      let rank = 0;
      while (frontier.length > 0) {
        const frontierNext = [];
        for (const typeId of frontier) {
          if (seen.has(typeId)) continue;
          seen.add(typeId);
          if (typeId === typeIdTo) return rank;
          rank += 1;
          const parentList = typeById.has(typeId) ? typeById.get(typeId).extendList : ['core.object', 'core.relation'];
          frontierNext.push(...parentList);
        }
        frontier = frontierNext;
      }
      return undefined;
    },
    // the Types that extend typeId directly
    childListGet: (typeId) => [...typeById.values()].filter((type) => type.extendList.includes(typeId)),
  };
  return registry;
}

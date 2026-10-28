// The definition of a slash action, and the registry of the page built from
// the definitions (doc_page_impl_edit_slash.md#the-slash-action-registry).
// It is the counterpart of comp-registry.js for the component registry:
//
//   component registry                      slash action registry
//   compDefine(Comp, options)               slashActionDefine(options)
//   registry.js compById (package)          slash-registry.js slashActionById (package)
//   config.compById (host)                  config.slashActionById (host)
//   compByIdBuild -> docStore.compById      slashActionByIdBuild -> slashStore.slashActionById
//
// a slash action is offered by a service layer of the page (the link to a
// document by the navigation layer: comp-doc/link/link-slash.js). the slash
// mode itself (DocSlashStore) lists the actions while the author types the
// name after "/", and hands the parameter mode over to the chosen action:
//
//   slashActionDefine({
//     name         'link': what the author types after "/"; one word
//     aliasList    ['ln']: other names typed for it
//     label        'Link': how the menu names it
//     description  one line under the label
//     icon         a component drawing its icon
//
//     run(context) -> effect
//                  an action without a parameter: called when it is chosen
//     param: {     an action with a parameter: chosen (or typed, then a
//                  space), the slash mode enters its param mode and asks
//                  the action for everything the parameter needs:
//       placeholder              shown while the parameter is empty
//       itemListGet(param, context) -> [{ id, label, detail?, ... }]
//                                the items the menu lists for the
//                                parameter typed so far. called inside an
//                                observer, so it may read mobx stores and
//                                the list follows them
//       itemChoose(item, param, context) -> effect
//                                Enter, Tab or a click on an item
//       keyHandle(event, { param, item, context }) -> effect | undefined
//                                optional: a key the action takes itself,
//                                before the slash mode's own keys; answer
//                                an effect to consume the key
//       ItemRender({ item, isActive, param })
//                                optional: draws one item; default: the
//                                label, then the detail muted
//       emptyText                the line shown when there is no item
//     },
//   })
//
// an effect is one of slashEffect of lib/doc-slash.js: replace(text),
// paramSet(text), cancel(). the action never touches the editing surface;
// the slash mode applies the effect.
//
// context, the same for every call while the slash mode is open:
//   { sourcePath    the document being edited (full source path)
//     docPageAlias  its doc page
//     source        the service object of the doc page source service layer
//                   (doc_page_impl_source.md#the-page-side-docsourcestore-and-the-service-object) }

const nameRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function slashActionDefine(options = {}) {
  const name = String(options.name ?? '');
  if (!nameRegex.test(name)) throw new Error(`slashActionDefine: name must be one word (got ${JSON.stringify(options.name)}).`);
  const aliasList = Array.isArray(options.aliasList) ? options.aliasList.map(String) : [];
  for (const alias of aliasList) {
    if (!nameRegex.test(alias)) throw new Error(`slashActionDefine: alias of ${name} must be one word (got ${JSON.stringify(alias)}).`);
  }
  const param = options.param;
  if (param !== undefined) {
    if (typeof param?.itemListGet !== 'function' || typeof param?.itemChoose !== 'function') {
      throw new Error(`slashActionDefine: param of ${name} needs itemListGet and itemChoose.`);
    }
  } else if (typeof options.run !== 'function') {
    throw new Error(`slashActionDefine: ${name} needs run(context), or a param.`);
  }
  return Object.freeze({
    name,
    aliasList,
    label: String(options.label ?? name),
    description: String(options.description ?? ''),
    icon: options.icon,
    run: options.run,
    param: param === undefined ? undefined : Object.freeze({
      placeholder: String(param.placeholder ?? ''),
      itemListGet: param.itemListGet,
      itemChoose: param.itemChoose,
      keyHandle: typeof param.keyHandle === 'function' ? param.keyHandle : undefined,
      ItemRender: param.ItemRender,
      emptyText: String(param.emptyText ?? 'Nothing matches'),
    }),
  });
}

// the registry of the page, by id: the package's actions, the host's over
// them (config.slashActionById). a host maps an id to null to remove an
// action of the package. what is not a definition is reported ([doc-slash])
// and left out, never the page.
export function slashActionByIdBuild(...layerList) {
  const slashActionById = {};
  for (const layer of layerList) {
    for (const [id, action] of Object.entries(layer ?? {})) {
      if (action === null) {
        delete slashActionById[id];
        continue;
      }
      if (!action || typeof action.name !== 'string' || !Array.isArray(action.aliasList)) {
        console.warn(`[doc-slash] ${id}: not a slashActionDefine() definition; left out`);
        continue;
      }
      slashActionById[id] = action;
    }
  }
  return slashActionById;
}

// the action of every name and alias typed after "/" (lowercase). when two
// actions declare one name, the later in the registry wins (the host's over
// the package's), with a warning
export function slashActionByNameBuild(slashActionById) {
  const actionByName = new Map();
  for (const [id, action] of Object.entries(slashActionById ?? {})) {
    for (const name of [action.name, ...action.aliasList]) {
      const key = name.toLowerCase();
      if (actionByName.has(key)) console.warn(`[doc-slash] ${id}: the name /${name} is declared already; this one wins`);
      actionByName.set(key, action);
    }
  }
  return actionByName;
}

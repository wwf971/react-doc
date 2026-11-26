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
//     block        optional { viewList }: it puts a block at the caret, in one of
//                  these views (set by slashBlockActionDefine, and by the actions
//                  of the components, slash-comp.js)
//     scope        optional { actionList }: a "/" right after its name enters the
//                  scope, whose slash text these actions read by the same grammar
//                  (/card-comp/code icon: the create panel of a card diagram).
//                  chosen, it enters the scope; with run too, Enter runs it and
//                  Tab enters the scope
//
//     run(context) -> effect
//                  an action without a parameter: called when it is chosen
//     param: {     an action with a parameter: chosen (or typed, then a
//                  space), the slash mode enters its param mode and asks
//                  the action for everything the parameter needs.
//                  an action with run AND param has an OPTIONAL parameter:
//                  Enter (or a click) runs it as it is, with no parameter;
//                  Tab, or a space after its name, enters the param mode
//                  (the view of a block: slashBlockActionDefine below)
//       label                    what the parameter is, in a few words
//                                ('view'): "Tab: choose a view"
//       placeholder              shown while the parameter is empty
//       isListedOnRow            optional: the items for an empty parameter
//                                are drawn on the row of the action too, so a
//                                pointer chooses one at once (a short list
//                                that does not depend on what is typed)
//       itemListGet(param, context) -> [{ id, label, detail?, isDefault?, ... }]
//                                (isDefault: what running without the
//                                parameter does, marked so in the menu)
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
//       hintGet(param, context) -> string
//                                optional: what the parameter typed so far
//                                means, shown beside the label of the action
//                                (a reference being walked: the names of what
//                                it has reached); '' shows the placeholder
//       emptyText                the line shown when there is no item
//     },
//   })
//
// an effect is one of slashEffect of lib/doc-slash.js: replace(text),
// paramSet(text), cancel(), block(source), atom(atomKind, { isRow,
// textFallback }). the action never touches the editing surface; the slash
// mode applies the effect.
//
// context, the same for every call while the slash mode is open:
//   { sourcePath    the document being edited (full source path)
//     docPageAlias  its doc page
//     source        the service object of the doc page source service layer
//                   (doc_page_impl_source.md#the-page-side-docsourcestore-and-the-service-object)
//     object        the object service layer (DocObjectStore): what /object lists from
//     place         where a block put at the caret stands: undefined (a block
//                   of the document), 'inListItem' (the text of a list item)
//     configValueGet(key)  the value of a config key for the document }
// a surface of a component hands its own context (use-edit-slash-config.js); a cell's
// context is built by the cell editing kit, which adds source and object to the
// component's own (doc_page_impl_edit_cell.md)

import { slashEffect, slashViewItemListGet } from '../../frontend/src/lib/doc-slash.js';

const nameRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function slashActionDefine(options = {}) {
  const name = String(options.name ?? '');
  if (!nameRegex.test(name)) throw new Error(`slashActionDefine: name must be one word (got ${JSON.stringify(options.name)}).`);
  const aliasList = Array.isArray(options.aliasList) ? options.aliasList.map(String) : [];
  for (const alias of aliasList) {
    if (!nameRegex.test(alias)) throw new Error(`slashActionDefine: alias of ${name} must be one word (got ${JSON.stringify(alias)}).`);
  }
  const param = options.param;
  const isRunnable = typeof options.run === 'function';
  if (param !== undefined) {
    if (typeof param?.itemListGet !== 'function' || typeof param?.itemChoose !== 'function') {
      throw new Error(`slashActionDefine: param of ${name} needs itemListGet and itemChoose.`);
    }
  } else if (!isRunnable && !options.scope) {
    throw new Error(`slashActionDefine: ${name} needs run(context), a param, or a scope.`);
  }
  return Object.freeze({
    name,
    aliasList,
    label: String(options.label ?? name),
    description: String(options.description ?? ''),
    icon: options.icon,
    // an action putting a block at the caret says so, with the views of the block
    // (slashBlockActionDefine): a surface that is not a document may take the block
    // in a form of its own (the create panel of a card diagram: a card holding it)
    block: options.block ? Object.freeze({ viewList: Object.freeze([...(options.block.viewList ?? [])]) }) : undefined,
    scope: options.scope ? Object.freeze({ actionList: Object.freeze([...(options.scope.actionList ?? [])]) }) : undefined,
    run: isRunnable ? options.run : undefined,
    param: param === undefined ? undefined : Object.freeze({
      isOptional: isRunnable,
      label: String(param.label ?? ''),
      placeholder: String(param.placeholder ?? ''),
      isListedOnRow: param.isListedOnRow === true,
      itemListGet: param.itemListGet,
      itemChoose: param.itemChoose,
      keyHandle: typeof param.keyHandle === 'function' ? param.keyHandle : undefined,
      ItemRender: param.ItemRender,
      hintGet: typeof param.hintGet === 'function' ? param.hintGet : undefined,
      emptyText: String(param.emptyText ?? 'Nothing matches'),
    }),
  });
}

// an action that puts a block at the caret (slashEffect.block), its view an
// optional parameter: Enter puts the block in its default view, Tab (or
// "/name " typed) lists the views, and the views are on the row of the action
// for a pointer. the default comes first, marked so; choosing it writes no
// view, so the block keeps following the default of its place.
//
//   slashBlockActionDefine({
//     name, aliasList, label, description, icon    as slashActionDefine
//     viewList          [{ id, label?, description? }]: the views of the block
//     viewDefaultGet(context) -> id   the view a block gets when none is
//                       written, where the caret is (context.place)
//     sourceBuild(view, context) -> source   the source of the block; view
//                       undefined for the default (none written)
//   })
export function slashBlockActionDefine({ viewList, viewDefaultGet, sourceBuild, ...options }) {
  const viewDefault = (context) => {
    const view = typeof viewDefaultGet === 'function' ? viewDefaultGet(context) : undefined;
    return viewList.some((one) => one.id === view) ? view : viewList[0]?.id;
  };
  return slashActionDefine({
    ...options,
    block: { viewList },
    run: (context) => slashEffect.block(sourceBuild(undefined, context)),
    param: {
      label: 'view',
      placeholder: 'the view of the block; Enter: the default',
      isListedOnRow: true,
      emptyText: 'No view is named so',
      itemListGet: (param, context) => slashViewItemListGet(viewList, viewDefault(context), param),
      itemChoose: (item, param, context) => slashEffect.block(sourceBuild(item.isDefault ? undefined : item.id, context)),
    },
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

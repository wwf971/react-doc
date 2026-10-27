import { createElement } from 'react';
import { compExposeNormalize } from './comp-expose.js';

// options: how the registry boundary (RegisteredComp) treats the component
//   componentType     semantic type other components can reference (dataRef, part index)
//   dataBuild         input converter, see compInputNormalize
//   dataRefTypeList   component types this component accepts data from
//   placementList     where the component may render; undefined means anywhere
//   isAssetAware      the component receives config.assetInfo telling whether
//                     its data is inline or an asset-store object
//                     (doc_page_impl_mdx_comp.md#component-awareness)
//   assetDependencyListGet(data) -> [{ type, path | objectId }] the source files
//                     and assets the component's data refers to; recorded as the
//                     dependencies of an asset created from the data
//   deleteFileListGet(data) -> [{ path, reason? }] optional: the source files
//                     the component offers to delete with its block (the
//                     image an Image names). synchronous, writes nothing;
//                     a path is a source reference relative to the document,
//                     a nonempty reason says why that file cannot be chosen.
//                     a component without it gets ordinary block deletion,
//                     whatever assetDependencyListGet names
//                     (doc_page_impl_block_ops.md#deleting-blocks)
//   expose            what the component tells the page about itself
//                     (comp-expose.js): meta (read-only, the source edit mode,
//                     the shape of its config, ...), icon, viewModeList,
//                     editModeList, sourceDefaultCreate, and any non-standard name
//
// the former flat options isEditSupported, editTemplate and configDefineList
// are refused, so a definition still written with them fails here instead of
// silently losing its editor, its starting source or its config keys.
export function compDefine(CompRender, options = {}) {
  for (const optionRemoved of ['isEditSupported', 'editTemplate', 'configDefineList']) {
    if (options[optionRemoved] !== undefined) {
      throw new Error(`compDefine: '${optionRemoved}' is declared through 'expose' now (comp-expose.js).`);
    }
  }
  return {
    CompRender,
    componentType: options.componentType,
    dataBuild: options.dataBuild,
    dataRefTypeList: options.dataRefTypeList,
    placementList: options.placementList,
    isAssetAware: options.isAssetAware === true,
    assetDependencyListGet: options.assetDependencyListGet,
    deleteFileListGet: options.deleteFileListGet,
    expose: compExposeNormalize(options.expose),
  };
}

export function compNativeDefine(CompNative, options = {}) {
  function CompRender({ data = {} }) {
    const { content, ...props } = data;
    return createElement(CompNative, props, content);
  }

  return compDefine(CompRender, options);
}

// converts one registry invocation input into the component's { data, config }.
// authored properties become data; authored "data"/"config" objects are
// merged in. runtime config is added later by RegisteredComp.
export function compInputNormalize(definition, input = {}) {
  const propsAuthored = input.propsAuthored ?? {};
  const { children, config: configAuthored, data: dataAuthored, onEvent: _onEventIgnored, ...dataProps } = propsAuthored;
  const inputNormalized = {
    ...input,
    content: input.content ?? children,
    data: {
      ...(input.data ?? {}),
      ...(dataAuthored && typeof dataAuthored === 'object' ? dataAuthored : {}),
      ...dataProps,
      ...(input.raw !== undefined ? { raw: input.raw } : {}),
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(input.content !== undefined || children !== undefined
        ? { content: input.content ?? children }
        : {}),
    },
    config: {
      ...(configAuthored && typeof configAuthored === 'object' ? configAuthored : {}),
      ...(input.config ?? {}),
    },
  };
  const resultBuilt = definition.dataBuild?.(inputNormalized) ?? inputNormalized;
  return {
    data: resultBuilt.data ?? inputNormalized.data,
    config: resultBuilt.config,
  };
}

// names the page itself renders with even when config compRegistry does not
// mention them. mapping one of these names in compRegistry replaces the
// default, which is how an application provides its own side-panel item hook.
export const compIdBuiltinByName = {
  Anchor: 'common/Anchor',
  SidePanelItem: 'common/SidePanelItem',
  Tag: 'common/Tag',
  TagLabel: 'common/TagLabel',
  TagOverview: 'common/TagOverview',
  // default editors of the edit layer, one per block kind (placement "edit")
  Heading: 'common/Heading',
  Paragraph: 'common/Paragraph',
  List: 'common/List',
  BlockSource: 'common/BlockSource',
};

// tag name -> component id: config compRegistry first, then built-in names,
// otherwise the name itself is treated as an id.
export function compIdResolve(configDoc, compName) {
  return configDoc?.compRegistry?.[compName]
    ?? compIdBuiltinByName[compName]
    ?? compName;
}

export function compDefinitionNormalize(value) {
  if (compTypeIsValid(value)) {
    return { CompRender: value, isLegacy: true };
  }
  if (value && compTypeIsValid(value.CompRender)) return value;
  return undefined;
}

function compTypeIsValid(value) {
  return typeof value === 'function'
    || Boolean(value && typeof value === 'object' && value.$$typeof);
}
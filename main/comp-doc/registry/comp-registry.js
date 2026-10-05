import { createElement } from 'react';

// options:
//   componentType     semantic type other components can reference (dataRef, part index)
//   dataBuild         input converter, see compInputNormalize
//   dataRefTypeList   component types this component accepts data from
//   placementList     where the component may render; undefined means anywhere
//   isEditSupported   the component renders its own editor when config.isEdit
//                     is true (doc_page_impl_edit.md#component-edit-mode)
//   editTemplate      { lang, raw, props } of a new block inserted in edit mode
export function compDefine(CompRender, options = {}) {
  return {
    CompRender,
    componentType: options.componentType,
    dataBuild: options.dataBuild,
    dataRefTypeList: options.dataRefTypeList,
    placementList: options.placementList,
    isEditSupported: options.isEditSupported === true,
    editTemplate: options.editTemplate,
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
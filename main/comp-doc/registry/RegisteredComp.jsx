import { useContext, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve, compInputNormalize } from './comp-registry.js';
import { compDefinitionGet } from './comp-definition.js';
import { COMP_PLACEMENT_DOC_LIST, compMetaGet, compViewModeDefaultIdGet, compViewModeListGet } from './comp-expose.js';
import { CompDataRefHost } from './CompDataRef.jsx';
import { CompAssetHost, compInputIsAssetRef } from '../asset/CompAssetHost.jsx';
import { DocEditBlockContext } from '../edit/DocEditDocContext.js';

// One runtime boundary for every component resolved through compRegistry.
// Registered render components always receive { data, config, onEvent }.
// An observer, so a component follows its component-level config values
// (the reader may change them in the settings panel).
export const RegisteredComp = observer(function RegisteredComp(props) {
  const {
    compDefinition,
    compId,
    compName,
    configRuntime = {},
    input = {},
    onEventRuntime,
    placement,
  } = props;
  const { compById, compConfigHost, configStore, docStore, editStore, eventRouter, onEvent: onEventPage, sourceStore } = useDocStores();
  const idFallback = useId();
  // the block of the edit body the component is rendered in, when it is
  const editBlock = useContext(DocEditBlockContext);
  const compIdResolved = compId ?? compIdResolve(sourceStore.configDoc, compName);
  const definitionValue = compDefinition ?? compDefinitionGet(compById, compIdResolved);
  const definition = compDefinitionNormalize(definitionValue);

  // a fenced block in the language "asset" is a reference into the asset
  // store, not the data: CompAssetHost reads the referenced version and
  // renders this boundary again with that text (doc_page_impl_asset.md)
  if (definition && placement === 'commentBlock' && compInputIsAssetRef(input)) {
    return <CompAssetHost input={input} registeredProps={{ ...props, compId: compIdResolved }} />;
  }

  if (!definition) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        detail={`resolved id: ${compIdResolved || '(empty)'}`}
        raw={input.raw}
      />
    );
  }

  // what the component's metadata allows in a document
  // (doc_page_impl_mdx_comp.md#asset-only-and-not-in-doc): isNotInDoc refuses
  // the document, isAssetOnly refuses data written inline in it
  const meta = compMetaGet(definition);
  const isPlacementDoc = COMP_PLACEMENT_DOC_LIST.includes(placement);
  if (isPlacementDoc && meta.isNotInDoc) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`${compName ?? compIdResolved} cannot be used in a document.`}
      />
    );
  }

  if (definition.placementList && !definition.placementList.includes(placement)) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`component is not available for placement: ${placement}`}
        raw={input.raw}
      />
    );
  }

  if (isPlacementDoc && meta.isAssetOnly && !configRuntime.assetInfo?.isFromAsset) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`${compName ?? compIdResolved} keeps its data in the asset store only; move this block's data there with "to asset" in edit mode.`}
        raw={input.raw}
      />
    );
  }

  if (definition.isLegacy && input.propsAuthored?.dataRef !== undefined) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`${compName ?? compIdResolved} does not accept dataRef.`}
        detail={`dataRef: ${String(input.propsAuthored.dataRef)}`}
      />
    );
  }

  if (definition.isLegacy) {
    const CompLegacy = definition.CompRender;
    if (placement === 'commentBlock') {
      return (
        <CompLegacy
          raw={input.raw}
          lang={input.lang}
          {...(input.propsAuthored ?? {})}
        />
      );
    }
    if (placement === 'sidePanelDisplay') {
      return <CompLegacy data={input.data ?? {}} text={input.data?.text ?? ''} />;
    }
    if (placement === 'sidePanelPanel') {
      return (
        <CompLegacy
          data={input.data ?? {}}
          item={configRuntime.item}
          onNavigate={(target) => docStore.navigate(target)}
          toHref={(target) => docStore.toBrowserHref(target)}
        />
      );
    }
    return <CompLegacy {...(input.propsAuthored ?? {})} />;
  }

  const { data, config: configBuilt } = compInputNormalize(definition, input);
  // components rendered inside another compiled document (e.g. the SourceLink
  // render popup) belong to that document, not the outer page.
  const sourcePath = configRuntime.sourcePath ?? docStore.docCurrentPath;
  const instanceId = configRuntime.instanceId
    ?? data.id
    ?? `${compIdResolved}:${sourcePath || 'page'}:${idFallback}`;
  // the source layer resolves file references of the component relative to
  // the document it is in (doc_page_impl_source.md); a host may still hand
  // its own assetUrlGet in compConfigHost
  const assetUrlGet = compConfigHost.assetUrlGet
    ?? ((reference) => sourceStore.fileUrlGet(reference, sourcePath) ?? reference);
  // host settings (e.g. mermaidLoad, assetUrlGet) have the lowest priority.
  // compConfig: the component's own keys resolved for this document
  // (doc_page_impl_config.md#component-level-config). assetInfo: where the
  // data came from, for a component declared isAssetAware
  // (doc_page_impl_mdx_comp.md#component-awareness); CompAssetHost hands the
  // asset's info in configRuntime, so a plain block means inline data.
  // the block the component is in: given by the editor of a session, else
  // by the wrapper of the edit body; undefined in reading mode, where the
  // document cannot be written
  const blockIndex = configRuntime.blockIndex ?? (editBlock?.path === sourcePath ? editBlock.blockIndex : undefined);
  // the view mode of a component that exposes view modes
  // (doc_page_impl_mdx_comp.md#view-modes-and-edit-modes): the one a reader
  // picked for this block through the mode menu, else the component's
  // default; absent for a component without view modes
  const viewMode = compViewModeListGet(definition).length > 0
    ? (blockIndex !== undefined ? editStore?.blockViewModeGet(sourcePath, blockIndex) : undefined) ?? compViewModeDefaultIdGet(definition)
    : undefined;
  const config = {
    assetUrlGet,
    source: sourceStore.sourceService,
    ...compConfigHost,
    ...configBuilt,
    ...configRuntime,
    compConfig: configStore.compConfigGet(compIdResolved, sourcePath),
    ...(definition.isAssetAware ? { assetInfo: configRuntime.assetInfo ?? { isFromAsset: false } } : {}),
    ...(viewMode !== undefined ? { viewMode } : {}),
    blockIndex,
    compId: compIdResolved,
    instanceId,
    placement,
    sourcePath,
  };

  // every report of the component becomes one event of the event layer
  // (doc_page_impl_event.md): the host application answers first, then the
  // place that rendered the component (onEventRuntime), then the domain
  // route of the event type. the third argument carries what the report
  // knows beyond its data: { point } where the pointer was (the pointer
  // event itself can be passed as point), so a handler can act where the
  // user pointed.
  const eventHandle = (eventType, eventData = {}, eventContext = {}) => {
    const event = eventRouter.eventBuild({
      type: eventType,
      data: eventData,
      source: {
        compId: compIdResolved,
        instanceId,
        itemId: config.itemId,
        placement,
        sourcePath: config.sourcePath,
        blockIndex,
        // the asset the component's data came from, so a route that
        // replaces the data knows to update the asset, not the block
        asset: configRuntime.assetInfo?.isFromAsset ? configRuntime.assetInfo : undefined,
      },
      point: eventContext.point,
    });
    return eventRouter.dispatch(event, { onEventHost: onEventPage, onEventLocal: onEventRuntime });
  };

  const CompRender = definition.CompRender;
  if (data.dataRef === undefined) {
    return <CompRender data={data} config={config} onEvent={eventHandle} />;
  }
  return (
    <CompDataRefHost
      CompRender={CompRender}
      compLabel={compName ?? compIdResolved}
      config={config}
      data={data}
      definition={definition}
      onEvent={eventHandle}
    />
  );
});

function CompError({ compId, compName, detail, message, raw }) {
  return (
    <div className="border border-red-300 dark:border-red-700 rounded-sm p-2 text-sm select-text">
      <p className="text-red-600 dark:text-red-400 font-medium">
        {message ?? `unknown doc component: ${compName ?? compId}`}
      </p>
      {detail ? <p className="text-red-600 dark:text-red-400 text-xs">{detail}</p> : null}
      {raw ? <pre className="whitespace-pre-wrap">{raw}</pre> : null}
    </div>
  );
}
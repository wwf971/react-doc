import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { assetRefLangIs, assetRefParse } from '../../frontend/src/lib/doc-asset-ref.js';
import { assetSaveModeGet } from '../../frontend/src/store/DocAssetStore.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { AssetFrame } from './AssetFrame.jsx';

// The runtime boundary of a component whose data lives in the asset store
// (design: doc_page_impl_asset.md). RegisteredComp hands a comment-block
// invocation here when its fenced block is written in the language "asset":
// the block holds a reference { store, objectId | name, versionId }, not the data.
// The host resolves the reference through DocAssetStore and renders the
// component again with the text and language of that version in place of
// the reference, so the component sees exactly the input it would see with
// the data written inline. AssetFrame stands in for it while the data is
// loading, when the reference cannot be resolved, or when the data of the
// version is not text (a component block reads text); the asset panel is
// opened from the block's toolbar in edit mode.
//
//   <!--renderComp=Image-->
//   ```asset
//   store: local
//   name: hero image        (or objectId: m2x1k9q4z0a1b)
//   ```
//
//   input            the invocation input: { raw: reference yaml, lang: 'asset', propsAuthored }
//   registeredProps  the other props of RegisteredComp, passed through

export function compInputIsAssetRef(input) {
  return assetRefLangIs(input?.lang);
}

export const CompAssetHost = observer(function CompAssetHost({ input, registeredProps }) {
  const { assetStore } = useDocStores();
  const reference = useMemo(() => assetRefParse(input.raw), [input.raw]);
  const result = reference.message ? undefined : assetStore.refQuery(reference);
  const resultStatus = result?.status;
  const resultVersionId = result?.versionId;
  // the object decides the version a "head" reference means; the effect runs
  // again once it is known, to read that version's data
  useEffect(() => {
    if (!reference.message) void assetStore.refLoad(reference);
  }, [assetStore, reference, resultStatus, resultVersionId]);

  const label = registeredProps.compName ?? registeredProps.compId ?? 'component';
  const frameProps = { label, reference, raw: input.raw };

  if (reference.message) {
    return <AssetFrame {...frameProps} message={reference.message} />;
  }
  if (result.status === 'error') {
    return <AssetFrame {...frameProps} message={result.message} />;
  }
  if (result.status === 'loading') {
    return <AssetFrame {...frameProps} />;
  }
  if (assetRefLangIs(result.object.lang)) {
    return <AssetFrame {...frameProps} message={`asset object ${result.object.objectId} has lang "asset", which is reserved for references`} />;
  }
  if (!result.version.isText) {
    const sizeText = `${result.version.size ?? 0} bytes`;
    return (
      <AssetFrame
        {...frameProps}
        message={`version ${result.versionId} of the asset is not text (${result.object.contentType}, ${sizeText}); ${label} reads a ${result.object.lang || 'text'} block`}
      />
    );
  }
  // what a component declared isAssetAware learns about its data
  // (doc_page_impl_asset.md#component-awareness)
  const assetInfo = {
    isFromAsset: true,
    store: reference.store,
    objectId: result.object.objectId,
    name: result.object.name,
    versionId: result.versionId,
    versionIdHead: result.object.versionIdHead,
    isHead: result.versionId === result.object.versionIdHead,
    saveMode: assetSaveModeGet(result.object),
    isLocked: result.object.isLocked,
  };
  return (
    <AssetFrame {...frameProps}>
      <RegisteredComp
        {...registeredProps}
        configRuntime={{ ...(registeredProps.configRuntime ?? {}), assetInfo }}
        input={{ ...input, raw: result.version.text, lang: result.object.lang }}
      />
    </AssetFrame>
  );
});

import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { assetRefLangIs, assetRefParse } from '../../frontend/src/lib/doc-asset-ref.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { AssetFrame } from './AssetFrame.jsx';

// The runtime boundary of a component whose data lives in the asset store
// (design: doc_page_impl_asset.md). RegisteredComp hands a comment-block
// invocation here when its fenced block is written in the language "asset":
// the block holds a reference { objectId, versionId }, not the data. The
// host resolves the reference through DocAssetStore and renders the
// component again with the text and language of that version in place of
// the reference, so the component sees exactly the input it would see with
// the data written inline. Around it, AssetFrame shows which asset and
// version the data comes from and opens the asset panel.
//
//   <!--renderComp=Image-->
//   ```asset
//   objectId: m2x1k9q4z0a1b
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
  // the object read first decides the version a "head" reference means;
  // the effect runs again once it is known, to read that version's text
  useEffect(() => {
    if (!reference.message) void assetStore.refLoad(reference);
  }, [assetStore, reference, resultStatus, resultVersionId]);

  const label = registeredProps.compName ?? registeredProps.compId ?? 'component';
  const frameProps = { label, reference, result, raw: input.raw };

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
    return <AssetFrame {...frameProps} message={`asset object ${reference.objectId} has lang "asset", which is reserved for references`} />;
  }
  return (
    <AssetFrame {...frameProps}>
      <RegisteredComp
        {...registeredProps}
        input={{ ...input, raw: result.text, lang: result.object.lang }}
      />
    </AssetFrame>
  );
});

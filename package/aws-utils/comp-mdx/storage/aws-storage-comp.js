import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { AwsStoragePointPanel } from './AwsStoragePointPanel.jsx';

// The panel of a storage point of the type aws-utils.remote: rendered by the Asset service tab of
// the settings panel in the placement assetStoragePoint, never written as a block.
export const AwsStoragePointPanelDefine = compDefine(AwsStoragePointPanel, {
  placementList: ['assetStoragePoint'],
  expose: { meta: { label: 'AWS storage point', description: 'The account, the space and the unbound partitions of a storage point of the AWS storage service.', isNotInDoc: true } },
});

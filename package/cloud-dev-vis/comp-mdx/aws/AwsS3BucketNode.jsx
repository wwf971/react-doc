import { Archive } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from '../card-diagram/ResourceNodeCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

export function AwsS3BucketNode(props) {
	return <ResourceNodeCard {...props} family="aws-storage" label="S3" Icon={Archive} titleLeading={<AwsKindIcon type="aws-s3-bucket" Icon={Archive} />} />;
}

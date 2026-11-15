import { KeyRound } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from '../card-diagram/ResourceNodeCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

export function AwsIamRoleNode(props) {
	return <ResourceNodeCard {...props} family="aws-security" label="IAM" Icon={KeyRound} titleLeading={<AwsKindIcon type="aws-iam-role" Icon={KeyRound} />} />;
}

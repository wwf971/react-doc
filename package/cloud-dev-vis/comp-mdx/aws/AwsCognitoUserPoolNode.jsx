import { Users } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from '../card-diagram/ResourceNodeCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

export function AwsCognitoUserPoolNode(props) {
	return <ResourceNodeCard {...props} family="aws-security" label="Cognito" Icon={Users} titleLeading={<AwsKindIcon type="aws-cognito-user-pool" Icon={Users} />} />;
}

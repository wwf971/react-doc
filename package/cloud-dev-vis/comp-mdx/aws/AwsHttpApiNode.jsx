import { Route } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from '../card-diagram/ResourceNodeCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

export function AwsHttpApiNode(props) {
	return <ResourceNodeCard {...props} family="aws-network" label="API Gateway" Icon={Route} titleLeading={<AwsKindIcon type="aws-http-api" Icon={Route} />} />;
}

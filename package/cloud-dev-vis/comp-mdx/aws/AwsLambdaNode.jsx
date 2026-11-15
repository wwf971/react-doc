import { SquareFunction } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from '../card-diagram/ResourceNodeCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

export function AwsLambdaNode(props) {
	return <ResourceNodeCard {...props} family="aws-compute" label="Lambda" Icon={SquareFunction} titleLeading={<AwsKindIcon type="aws-lambda" Icon={SquareFunction} />} />;
}

import { Archive, Braces, Database, KeyRound, Route, ScrollText, SquareFunction, Users } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { cardDiagramFeatureList, cardDiagramNodeKindList } from '../card-diagram/card-diagram-node-registry.js';
import { resourceCardSchemaBuild } from '../card-diagram/TableCardSchema.js';
import { diagramArrangerLanesAcross, diagramArrangerLanesDown, diagramArrangerLayers } from '../card-diagram/DiagramArrangeLayers.js';
import { awsHandleOf } from './AwsCardData.js';
import { awsIconOf } from './AwsIcon.js';
import { awsHttpApiNodeContract, awsHttpApiNodeFields } from './AwsHttpApiNodeData.js';
import { AwsHttpApiNode } from './AwsHttpApiNode.jsx';
import { awsLambdaNodeContract, awsLambdaNodeFields } from './AwsLambdaNodeData.js';
import { AwsLambdaNode } from './AwsLambdaNode.jsx';
import { awsS3BucketNodeContract, awsS3BucketNodeFields } from './AwsS3BucketNodeData.js';
import { AwsS3BucketNode } from './AwsS3BucketNode.jsx';
import { awsCognitoUserPoolNodeContract, awsCognitoUserPoolNodeFields } from './AwsCognitoUserPoolNodeData.js';
import { AwsCognitoUserPoolNode } from './AwsCognitoUserPoolNode.jsx';
import { awsIamRoleNodeContract, awsIamRoleNodeFields } from './AwsIamRoleNodeData.js';
import { AwsIamRoleNode } from './AwsIamRoleNode.jsx';
import { awsLogGroupNodeContract } from './AwsLogGroupNodeData.js';
import { AwsLogGroupNode } from './AwsLogGroupNode.jsx';
import { awsDynamodbTableNodeContract, awsDynamodbTableSchema } from './AwsDynamodbTableNodeData.js';
import { AwsDynamodbTableNode } from './AwsDynamodbTableNode.jsx';
import { awsRouteGroupNodeContract, awsRouteGroupSchema } from './AwsRouteGroupNodeData.js';
import { AwsRouteGroupNode } from './AwsRouteGroupNode.jsx';
import './AwsCard.css';

// The node kinds of the AWS series (doc/aws.md): the resources of AWS a system is drawn with, as
// schemas over the cards of the base series, each with a simple display (a mark in the accent of
// its family, for an overview), on top of the generic kinds of the base series. A client (a
// browser, a page) is not an AWS kind: it is drawn with the cards of the base series.

// drawn simple (CardSimpleData.js): the mark of its family with its icon, its name, the service
// (or its official icon, when it was fetched: AwsIcon.js)
const simpleOf = ({ type, Icon, family, service, shape = 'tile' }) => ({ shape, contentGet: (data) => {
	const icon = awsIconOf(type);
	return { title: data.name, text: service, Icon, family, iconUrl: icon?.url, isIconFramed: icon?.isFramed };
} });

// a kind on the resource card: head fields and property rows (ResourceNodeCard.jsx)
function awsResourceKindBuild({ type, label, fields, contract, Card, Icon, family, service, description, keywordList, name }) {
	return {
		type,
		label,
		contract: { ...contract, simple: simpleOf({ type, Icon, family, service }) },
		schema: resourceCardSchemaBuild(type, fields, label),
		Card,
		create: {
			description, icon: Icon, keywordList: ['aws', ...keywordList],
			nodeCreate: (idNext) => {
				const data = Object.fromEntries(fields.map((field) => [field.id, field.defaultValue ?? '']));
				return { id: idNext(type.replace(/^aws-/, '')), renderer: { type }, size: { width: contract.sizeDefault.width, height: 'auto' }, data: { ...data, name, properties: [] }, handles: [awsHandleOf('in', 'in'), awsHandleOf('out', 'out')] };
			},
		},
	};
}

export const awsHttpApiNodeKind = awsResourceKindBuild({
	type: 'aws-http-api', label: 'HTTP API', fields: awsHttpApiNodeFields, contract: awsHttpApiNodeContract, Card: AwsHttpApiNode,
	Icon: Route, family: 'aws-network', service: 'API Gateway', name: '{prefix}--api',
	description: 'An http api of API Gateway: its authorizer, CORS, throttle, and its groups of routes.', keywordList: ['api gateway', 'http', 'rest', 'endpoint'],
});

export const awsLambdaNodeKind = awsResourceKindBuild({
	type: 'aws-lambda', label: 'Lambda function', fields: awsLambdaNodeFields, contract: awsLambdaNodeContract, Card: AwsLambdaNode,
	Icon: SquareFunction, family: 'aws-compute', service: 'Lambda', name: '{prefix}--function',
	description: 'A function: runtime, memory and time, its role, the names of its environment.', keywordList: ['lambda', 'function', 'compute', 'serverless'],
});

export const awsS3BucketNodeKind = awsResourceKindBuild({
	type: 'aws-s3-bucket', label: 'S3 bucket', fields: awsS3BucketNodeFields, contract: awsS3BucketNodeContract, Card: AwsS3BucketNode,
	Icon: Archive, family: 'aws-storage', service: 'S3', name: '{prefix}--data',
	description: 'A bucket: who reaches it, its key prefixes, its lifecycle.', keywordList: ['s3', 'bucket', 'object', 'storage'],
});

export const awsCognitoUserPoolNodeKind = awsResourceKindBuild({
	type: 'aws-cognito-user-pool', label: 'Cognito user pool', fields: awsCognitoUserPoolNodeFields, contract: awsCognitoUserPoolNodeContract, Card: AwsCognitoUserPoolNode,
	Icon: Users, family: 'aws-security', service: 'Cognito', name: '{prefix}--users',
	description: 'A user pool: its app clients, its groups, its MFA mode.', keywordList: ['cognito', 'user pool', 'sign in', 'auth', 'identity'],
});

export const awsIamRoleNodeKind = awsResourceKindBuild({
	type: 'aws-iam-role', label: 'IAM role', fields: awsIamRoleNodeFields, contract: awsIamRoleNodeContract, Card: AwsIamRoleNode,
	Icon: KeyRound, family: 'aws-security', service: 'IAM role', name: '{prefix}--role',
	description: 'A role: who assumes it, what it allows, by service.', keywordList: ['iam', 'role', 'policy', 'permission'],
});

export const awsLogGroupNodeKind = {
	type: 'aws-log-group',
	label: 'Log group',
	contract: { ...awsLogGroupNodeContract, simple: simpleOf({ type: 'aws-log-group', Icon: ScrollText, family: 'aws-management', service: 'CloudWatch Logs' }) },
	schema: null,
	Card: AwsLogGroupNode,
	create: {
		description: 'A log group of CloudWatch: its name and retention.', icon: ScrollText, keywordList: ['aws', 'cloudwatch', 'logs', 'log group'],
		nodeCreate: (idNext) => ({ id: idNext('log-group'), renderer: { type: 'aws-log-group' }, data: { name: '/aws/lambda/{prefix}--function', retention: 'never expires' }, handles: [awsHandleOf('in', 'in')] }),
	},
};

export const awsDynamodbTableNodeKind = {
	type: 'aws-dynamodb-table',
	label: 'DynamoDB table',
	contract: { ...awsDynamodbTableNodeContract, simple: simpleOf({ type: 'aws-dynamodb-table', Icon: Database, family: 'aws-database', service: 'DynamoDB' }) },
	schema: awsDynamodbTableSchema,
	Card: AwsDynamodbTableNode,
	create: {
		description: 'A table, or one kind of its rows: its key patterns and attributes, an index among them.', icon: Database, keywordList: ['aws', 'dynamodb', 'table', 'nosql', 'key'],
		nodeCreate: (idNext) => ({ id: idNext('table'), renderer: { type: 'aws-dynamodb-table' }, size: { width: 380, height: 'auto' }, data: {
			name: 'Table', nameLogical: '{prefix}--data', pk: 'pk (S)', sk: 'sk (S)', description: 'billed per request',
			attributes: [{ id: 'pk', key: 'PK', name: 'pk', type: 'S', holds: '' }, { id: 'sk', key: 'SK', name: 'sk', type: 'S', holds: '' }],
		}, handles: [awsHandleOf('in', 'in')] }),
	},
};

export const awsRouteGroupNodeKind = {
	type: 'aws-route-group',
	label: 'Route group',
	contract: { ...awsRouteGroupNodeContract, simple: simpleOf({ type: 'aws-route-group', Icon: Braces, family: 'aws-network', service: 'routes' }) },
	schema: awsRouteGroupSchema,
	Card: AwsRouteGroupNode,
	create: {
		description: 'The routes of one group of an http api: method, path, whether a token is needed.', icon: Braces, keywordList: ['aws', 'route', 'api', 'endpoint', 'path'],
		nodeCreate: (idNext) => ({ id: idNext('routes'), renderer: { type: 'aws-route-group' }, size: { width: 340, height: 'auto' }, data: {
			name: 'Routes', routes: [{ id: 'get', method: 'GET', path: '/thing/get', auth: 'token' }],
		}, handles: [awsHandleOf('in', 'in')] }),
	},
};

export const awsNodeKindList = [awsHttpApiNodeKind, awsLambdaNodeKind, awsDynamodbTableNodeKind, awsS3BucketNodeKind, awsCognitoUserPoolNodeKind, awsIamRoleNodeKind, awsLogGroupNodeKind, awsRouteGroupNodeKind];

// the arrangers of a system read downward (DiagramArrangeLayers.js)
export const awsArrangerList = [diagramArrangerLayers, diagramArrangerLanesDown, diagramArrangerLanesAcross];

// DiagramAws, DiagramAwsSwitch: the AWS kinds with the generic ones, so a diagram mixes a
// browser drawn as a note with the resources it talks to
// the features of the base series too (the parametric canvas): offered where a viewport names them
export const awsNodeRegistry = nodeRegistryBuild({ id: 'aws', label: 'AWS', kindList: [...cardDiagramNodeKindList, ...awsNodeKindList], arrangerList: awsArrangerList, featureList: cardDiagramFeatureList });

// DiagramAwsResource: one card of a resource outside a canvas, the kinds that are cards
export const awsResourceNodeRegistry = nodeRegistryBuild({ id: 'aws-resource', label: 'AWS resource', kindList: awsNodeKindList.filter((kind) => kind.schema) });

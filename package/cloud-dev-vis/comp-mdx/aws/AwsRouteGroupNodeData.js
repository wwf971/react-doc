import { awsRowCardAnchorListGet, awsRowCardNormalize, awsRowCardSchemaBuild } from './AwsCardData.js';
import { rowCardHeightEstimate } from '../card-diagram/TableCardData.js';

// the routes of one group of an http api (doc/aws.md): the method, the path, and whether it is
// answered only with a token. A line can leave a route (route/{id})
export const awsRouteMethodList = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'ANY'];
export const awsRouteAuthList = ['token', 'none'];

export const awsRouteGroupSchema = awsRowCardSchemaBuild({
	type: 'aws-route-group',
	labelNode: 'Route group',
	labelRow: 'Route',
	labelRowPlural: 'Routes',
	labelSubtitle: 'Subtitle',
	rowListKey: 'routes',
	anchorPrefix: 'route',
	fieldList: [
		{ id: 'method', label: 'Method', kind: 'enum', values: awsRouteMethodList, defaultValue: 'GET' },
		{ id: 'path', label: 'Path', kind: 'text' },
		{ id: 'auth', label: 'Auth', kind: 'enum', values: awsRouteAuthList, valueLabels: { token: 'token', none: 'none' }, defaultValue: 'token' },
	],
	rowNew: () => ({ method: 'POST', path: '/path', auth: 'token' }),
});

export const awsRouteGroupNodeContract = {
	dataNormalize: (data) => awsRowCardNormalize(data, awsRouteGroupSchema),
	anchorListGet: (data) => awsRowCardAnchorListGet(data, awsRouteGroupSchema),
	anchorSideDrawn: 'header',
	sizeDefault: { width: 340, height: 200 },
	sizeEstimate: (node) => ({ height: rowCardHeightEstimate(node, awsRouteGroupSchema, 340, [0.2, 0.6, 0.2]) }),
};

// The official AWS icons of the kinds of the series (doc/aws.md#the-official-icons). They are not
// part of the package: AWS lets them be used to draw architecture diagrams, but does not say they
// may be passed on, so they are fetched on a machine that draws with them (script-icon/aws-icon-fetch.mjs)
// into icon-official/, a folder git ignores, one file a kind, named by its type. Where a file is
// there, a kind is drawn with it (AwsIconOfficial.js registers what the folder holds); where it is
// not, with its own icon, as before.
//
//   { type, file, isFramed? }   file: the name of the icon in the icon package, whatever folder of
//                               it holds it; a service icon (Arch_*) is its own tile, a resource
//                               icon (Res_*) a glyph, drawn inside the tile of the kind (isFramed)
//
// The fetch script reads this list too, so what is fetched is said once.
export const AWS_ICON_LIST = [
	{ type: 'aws-http-api', file: 'Arch_Amazon-API-Gateway_64.svg' },
	{ type: 'aws-lambda', file: 'Arch_AWS-Lambda_64.svg' },
	{ type: 'aws-s3-bucket', file: 'Arch_Amazon-Simple-Storage-Service_64.svg' },
	{ type: 'aws-cognito-user-pool', file: 'Arch_Amazon-Cognito_64.svg' },
	{ type: 'aws-iam-role', file: 'Res_AWS-Identity-Access-Management_Role_48.svg', isFramed: true },
	{ type: 'aws-log-group', file: 'Res_Amazon-CloudWatch_Logs_48.svg', isFramed: true },
	{ type: 'aws-dynamodb-table', file: 'Arch_Amazon-DynamoDB_64.svg' },
	{ type: 'aws-route-group', file: 'Res_Amazon-API-Gateway_Endpoint_48.svg', isFramed: true },
];

// the folder the icons are fetched into, beside this file
export const AWS_ICON_FOLDER = 'icon-official';

const iconByType = new Map();

// what the folder holds: { './icon-official/aws-lambda.svg': url, ... }
export function awsIconUrlRegister(urlByPath) {
	for (const [path, url] of Object.entries(urlByPath ?? {})) {
		const type = path.split('/').pop().replace(/\.svg$/, '');
		const item = AWS_ICON_LIST.find((entry) => entry.type === type);
		if (item && url) iconByType.set(type, { url, isFramed: Boolean(item.isFramed) });
	}
}

// the official icon of a kind, when it was fetched: { url, isFramed }, else undefined
export const awsIconOf = (type) => iconByType.get(type);

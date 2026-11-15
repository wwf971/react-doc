import { awsIconOf } from './AwsIcon.js';

// the icon of a kind on its card: the official one when it was fetched (AwsIcon.js), else its own
export function AwsKindIcon({ type, Icon, size = 16 }) {
	const icon = awsIconOf(type);
	if (!icon) return <Icon size={size} aria-hidden="true" />;
	return <img className={`doc-aws-kind-icon${icon.isFramed ? ' is-framed' : ''}`} src={icon.url} alt="" width={size} height={size} draggable={false} />;
}

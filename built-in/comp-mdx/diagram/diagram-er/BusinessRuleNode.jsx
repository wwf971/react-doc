import { GitBranch } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from './ResourceNodeCard.jsx';

export function BusinessRuleNode(props) {
	return <ResourceNodeCard {...props} family="rule" label="Business Rule" Icon={GitBranch} />;
}

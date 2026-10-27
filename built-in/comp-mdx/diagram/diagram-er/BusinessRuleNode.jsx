import { GitBranch } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from './ResourceNodeCard.jsx';
import { businessRuleNodeFields } from './BusinessRuleNodeData.js';

export function BusinessRuleNode(props) {
	return <ResourceNodeCard {...props} fields={businessRuleNodeFields} family="rule" label="Business Rule" Icon={GitBranch} />;
}
import { Workflow } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from './ResourceNodeCard.jsx';
import { powerAutomateNodeFields } from './PowerAutomateNodeData.js';

export function PowerAutomateNode(props) {
	return <ResourceNodeCard {...props} fields={powerAutomateNodeFields} family="flow" label="Power Automate" Icon={Workflow} />;
}
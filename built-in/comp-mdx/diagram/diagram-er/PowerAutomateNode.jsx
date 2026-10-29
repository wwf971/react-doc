import { Workflow } from '../../../../main/frontend/UICommon.js';
import { ResourceNodeCard } from './ResourceNodeCard.jsx';

export function PowerAutomateNode(props) {
	return <ResourceNodeCard {...props} family="flow" label="Power Automate" Icon={Workflow} />;
}

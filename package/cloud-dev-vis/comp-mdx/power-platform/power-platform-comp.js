import { GitBranch, TableProperties, Waypoints, Workflow } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { cardDiagramCompCreate } from '../card-diagram/CardDiagram.jsx';
import { cardStandaloneCompCreate } from '../card-diagram/CardStandalone.jsx';
import { cardDiagramDefineOptionsBuild } from '../card-diagram/card-diagram-comp.js';
import { cardDiagramAnimationCompCreate } from '../card-diagram-animation/CardDiagramAnimation.jsx';
import { cardDiagramAnimationDefineOptionsBuild } from '../card-diagram-animation/card-diagram-animation-comp.js';
import { cardDiagramSwitchCompCreate } from '../card-diagram-switch/CardDiagramSwitch.jsx';
import { cardDiagramSwitchDefineOptionsBuild } from '../card-diagram-switch/card-diagram-switch-comp.js';
import { dataverseSourceDefaultCreate, diagramSourceDefaultCreate } from './DataverseCardSource.js';
import { powerAutomateSourceDefaultCreate } from './PowerAutomateNodeSource.js';
import { businessRuleSourceDefaultCreate } from './BusinessRuleNodeSource.js';
import { dataverseEntityNodeRegistry, powerPlatformNodeRegistry } from './power-platform-node-registry.js';

// The components of the Power Platform series (power-platform.md), mounted
// by comp.yaml beside this file. DiagramER, DiagramPowerAutomate and
// DiagramBusinessRule are one diagram component on the registry of the
// series (power-platform-node-registry.js), exposed three times with another
// label and starting text, so one diagram may mix their nodes.
// DiagramDataverseEntity is a standalone card on a registry of the Dataverse
// table alone.
const PowerPlatformDiagram = cardDiagramCompCreate(powerPlatformNodeRegistry, 'PowerPlatformDiagram');

export const DiagramER = compDefine(PowerPlatformDiagram, cardDiagramDefineOptionsBuild({
	label: 'ER diagram',
	description: 'Nodes and connections on a canvas: Dataverse tables, choices, operators and registered components.',
	icon: Waypoints,
	// two tables and one connection between column handles: the smallest
	// diagram that shows every part of the format
	sourceDefaultCreate: diagramSourceDefaultCreate,
	registry: powerPlatformNodeRegistry,
}));

export const DiagramPowerAutomate = compDefine(PowerPlatformDiagram, cardDiagramDefineOptionsBuild({
	label: 'Power Automate flow',
	description: 'Trigger, actions, branches and configuration in a design diagram.',
	icon: Workflow,
	sourceDefaultCreate: powerAutomateSourceDefaultCreate,
	registry: powerPlatformNodeRegistry,
}));

export const DiagramBusinessRule = compDefine(PowerPlatformDiagram, cardDiagramDefineOptionsBuild({
	label: 'Business rule',
	description: 'Dataverse conditions, actions, scope and target columns.',
	icon: GitBranch,
	sourceDefaultCreate: businessRuleSourceDefaultCreate,
	registry: powerPlatformNodeRegistry,
}));

// the animation of the series (doc/card-diagram-animation.md): the same document as
// CardDiagramAnimation, with every card of the registry
export const DiagramERAnimation = compDefine(cardDiagramAnimationCompCreate(powerPlatformNodeRegistry, 'DiagramERAnimation'), cardDiagramAnimationDefineOptionsBuild({
	label: 'Power Platform diagram animation',
	description: 'A diagram of Dataverse tables, flows and operators moving between named states.',
}));

// the switching layer of the series (doc/card-diagram-flexible-switch.md): many views
// by path in one viewport, with every card of the registry
export const DiagramERSwitch = compDefine(cardDiagramSwitchCompCreate(powerPlatformNodeRegistry, 'DiagramERSwitch'), cardDiagramSwitchDefineOptionsBuild({
	label: 'Power Platform diagram views',
	description: 'Many diagrams of Dataverse tables, flows and operators in one viewport, by path, with smooth switching.',
}));

export const DiagramDataverseEntity = compDefine(
	cardStandaloneCompCreate(dataverseEntityNodeRegistry, 'DiagramDataverseEntity', 'Dataverse table'),
	cardDiagramDefineOptionsBuild({
		label: 'Dataverse table',
		description: 'One Dataverse table card with its columns, outside a canvas.',
		icon: TableProperties,
		sourceDefaultCreate: dataverseSourceDefaultCreate,
	}),
);

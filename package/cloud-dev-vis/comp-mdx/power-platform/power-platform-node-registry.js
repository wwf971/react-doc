import { GitBranch, ListChecks, TableProperties, Workflow } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild, resourceNodeCreateBuild } from '../card-diagram/node-registry.js';
import { cardDiagramNodeKindList } from '../card-diagram/card-diagram-node-registry.js';
import { resourceCardSchemaBuild } from '../card-diagram/TableCardSchema.js';
import { dataverseAnchorListGet, dataverseCardNormalize, dataverseChoiceAnchorListGet } from './DataverseCardData.js';
import { dataverseCardLegacyConvert, dataverseChoiceSchema, dataverseTableSchema } from './DataverseCardSchema.js';
import './PowerPlatformCard.css';
import { DataverseCard } from './DataverseCard.jsx';
import { powerAutomateNodeContract, powerAutomateNodeFields } from './PowerAutomateNodeData.js';
import { PowerAutomateNode } from './PowerAutomateNode.jsx';
import { businessRuleNodeContract, businessRuleNodeFields } from './BusinessRuleNodeData.js';
import { BusinessRuleNode } from './BusinessRuleNode.jsx';
import { operatorNodeKindList } from './OperatorNodes.js';

// The node kinds of the Power Platform series (power-platform.md): Dataverse
// tables and global choices, Power Automate steps and business rules, on top
// of the kinds of the base series (a generic table, an operator).
export const dataverseTableNodeKind = {
	type: 'dataverse-table',
	label: 'Dataverse table',
	contract: { dataNormalize: dataverseCardNormalize, anchorListGet: dataverseAnchorListGet, sizeDefault: { width: 410, height: 320 } },
	schema: dataverseTableSchema,
	Card: DataverseCard,
	create: {
		description: 'Columns with key, logical name and type.', icon: TableProperties, keywordList: ['entity', 'er'],
		nodeCreate: idNext => ({ id: idNext('table'), renderer: { type: 'dataverse-table' }, data: { name: 'Table', nameLogical: '', columns: [{ id: 'id', name: 'ID', nameLogical: 'id', type: 'Unique identifier', key: 'PK', isRequired: true }] }, handles: [] }),
	},
};

export const dataverseChoiceNodeKind = {
	type: 'dataverse-choice',
	label: 'Dataverse choice',
	contract: { dataNormalize: dataverseCardNormalize, anchorListGet: dataverseChoiceAnchorListGet, sizeDefault: { width: 410, height: 320 } },
	schema: dataverseChoiceSchema,
	Card: DataverseCard,
	create: {
		description: 'A global choice with its options.', icon: ListChecks, keywordList: ['option set', 'enum'],
		nodeCreate: idNext => ({ id: idNext('choice'), renderer: { type: 'dataverse-choice' }, data: { name: 'Choice', nameLogical: '', columns: [{ id: 'option-1', name: 'Option', nameLogical: '1', type: 'Option' }] }, handles: [{ id: 'header-in', direction: 'in', anchor: { target: 'header', side: 'left' } }] }),
	},
};

export const powerAutomateNodeKind = {
	type: 'power-automate',
	label: 'Power Automate step',
	contract: powerAutomateNodeContract,
	schema: resourceCardSchemaBuild('power-automate', powerAutomateNodeFields, 'Flow step'),
	Card: PowerAutomateNode,
	create: { description: 'Trigger, action, condition, scope, loop or terminate.', icon: Workflow, keywordList: ['flow'], nodeCreate: resourceNodeCreateBuild('power-automate', powerAutomateNodeFields, 'Flow step') },
};

export const businessRuleNodeKind = {
	type: 'business-rule',
	label: 'Business rule',
	contract: businessRuleNodeContract,
	schema: resourceCardSchemaBuild('business-rule', businessRuleNodeFields, 'Business rule'),
	Card: BusinessRuleNode,
	create: { description: 'A Dataverse condition or action.', icon: GitBranch, keywordList: ['rule'], nodeCreate: resourceNodeCreateBuild('business-rule', businessRuleNodeFields, 'Business rule') },
};

// DiagramER, DiagramPowerAutomate and DiagramBusinessRule: one registry, so
// one diagram may mix tables, choices, flow steps and rules
export const powerPlatformNodeRegistry = nodeRegistryBuild({
	id: 'power-platform',
	label: 'Power Platform',
	kindList: [...cardDiagramNodeKindList, ...operatorNodeKindList, dataverseTableNodeKind, dataverseChoiceNodeKind, powerAutomateNodeKind, businessRuleNodeKind],
});

// DiagramDataverseEntity: one Dataverse table card, outside a canvas
export const dataverseEntityNodeRegistry = nodeRegistryBuild({
	id: 'dataverse-entity',
	label: 'Dataverse table',
	kindList: [dataverseTableNodeKind],
	cardLegacyConvert: dataverseCardLegacyConvert,
});

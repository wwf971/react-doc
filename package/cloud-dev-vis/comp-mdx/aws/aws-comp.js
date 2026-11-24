import { Cloud, SquareFunction } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { cardDiagramCompCreate } from '../card-diagram/CardDiagram.jsx';
import { cardStandaloneCompCreate } from '../card-diagram/CardStandalone.jsx';
import { cardDiagramDefineOptionsBuild } from '../card-diagram/card-diagram-comp.js';
import { cardDiagramSwitchCompCreate } from '../card-diagram-switch/CardDiagramSwitch.jsx';
import { cardDiagramSwitchDefineOptionsBuild } from '../card-diagram-switch/card-diagram-switch-comp.js';
import { awsNodeRegistry, awsResourceNodeRegistry } from './aws-node-registry.js';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { awsArchitectureSourceDefaultCreate, awsResourceSourceDefaultCreate, awsSourceDefaultCreate, awsSwitchSourceDefaultCreate } from './AwsSource.js';
import { awsArchitectureNormalize, awsArchitectureProviderBuild } from './AwsArchitecture.js';
// the official icons, where they were fetched (AwsIcon.js)
import './AwsIconOfficial.js';

// The components of the AWS series (doc/aws.md), mounted by comp.yaml beside this file: one
// diagram, many scenes in one viewport, and one card of a resource outside a canvas.
export const DiagramAws = compDefine(cardDiagramCompCreate(awsNodeRegistry, 'AwsDiagram'), cardDiagramDefineOptionsBuild({
	label: 'AWS diagram',
	description: 'The resources of a system on AWS as cards or marks, and the lines between them, on a canvas.',
	icon: Cloud,
	sourceDefaultCreate: awsSourceDefaultCreate,
	registry: awsNodeRegistry,
}));

// the switching layer of the series (doc/card-diagram-flexible-switch.md): a system at several
// scales, by path, in one viewport
export const DiagramAwsSwitch = compDefine(cardDiagramSwitchCompCreate(awsNodeRegistry, 'DiagramAwsSwitch'), cardDiagramSwitchDefineOptionsBuild({
	label: 'AWS diagram scenes',
	description: 'A system on AWS at several scales in one viewport: an overview, its resources, inside each of them.',
	sourceDefaultCreate: awsSwitchSourceDefaultCreate,
}));

export const DiagramAwsResource = compDefine(cardStandaloneCompCreate(awsResourceNodeRegistry, 'DiagramAwsResource', 'AWS resource'), cardDiagramDefineOptionsBuild({
	label: 'AWS resource',
	description: 'One card of an AWS resource, outside a canvas.',
	icon: SquareFunction,
	sourceDefaultCreate: awsResourceSourceDefaultCreate,
}));

// a system described as data (AwsArchitecture.js), drawn as scenes generated from the description:
// the groups as frames, each group at two levels and in its flows, the detail of a resource. the
// block holds the description; a deployment script may write it (describe_architect.py of a backend)
export const DiagramAwsArchitecture = compDefine(cardDiagramSwitchCompCreate(awsNodeRegistry, 'DiagramAwsArchitecture', {
	loadBuild: (source, { registry }) => {
		const model = awsArchitectureNormalize(yamlParse(source));
		return { spec: { root: model.root, title: model.title, height: model.height ?? 720, depthMax: model.depthMax }, provider: awsArchitectureProviderBuild(model, registry, { signature: source }) };
	},
}), cardDiagramSwitchDefineOptionsBuild({
	label: 'AWS architecture',
	description: 'A system on AWS described as data: its groups, resources, relations and flows, drawn as scenes from an overview of groups down to the detail of a resource.',
	sourceDefaultCreate: awsArchitectureSourceDefaultCreate,
	isSceneEditable: false,
}));

import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { switchConfigDefineList } from '../../../cloud-dev-vis/comp-mdx/card-diagram-switch/SwitchData.js';
import { cardDiagramDefineOptionsBuild } from '../../../cloud-dev-vis/comp-mdx/card-diagram/card-diagram-comp.js';
import { cardDiagramNodeRegistry } from '../../../cloud-dev-vis/comp-mdx/card-diagram/card-diagram-node-registry.js';
import { cardDiagramSourceDefaultCreate } from '../../../cloud-dev-vis/comp-mdx/card-diagram/DiagramERSource.js';
import { ZettelCard, ZettelExplorer } from './ZettelExplorer.jsx';
import { ZettelDiagram, ZettelNode, zettelNodeDefineOptions } from './ZettelDiagram.jsx';

// The components of a zettelkasten (doc/README.md#the-modes): modes of a frontend object,
// rendered by the entry component ObjectFrontend, never written as blocks themselves. A zettel
// draws a switching viewport (its connections), so it declares that viewport's config (SceneTitleAlign),
// which a doc page sets under compConfig by the name of the component.
const modeDefine = (label, description, { configDefineList } = {}) => ({ placementList: ['objectFrontend'], expose: { meta: { label, description, isNotInDoc: true, ...(configDefineList ? { configDefineList } : {}) } } });

export const ZettelExplorerDefine = compDefine(ZettelExplorer, modeDefine('Zettelkasten: explorer', 'A zettel lying on a desk: a card showing its text, its connections or its flow.', { configDefineList: switchConfigDefineList }));
export const ZettelCardDefine = compDefine(ZettelCard, modeDefine('Zettelkasten: one zettel', 'One zettel of a zettelkasten, the card alone, in the flow of the document.'));

// cards on a card diagram (doc/README.md#zettels-on-a-card-diagram): a block of any document, with
// the format, the editor and the apis of CardDiagram, and the node that draws a card
export const ZettelDiagramDefine = compDefine(ZettelDiagram, cardDiagramDefineOptionsBuild({
	label: 'Zettel diagram',
	description: 'A card diagram whose create panel finds the cards of a zettelkasten and makes new ones.',
	sourceDefaultCreate: cardDiagramSourceDefaultCreate,
	registry: cardDiagramNodeRegistry,
}));
export const ZettelNodeDefine = compDefine(ZettelNode, zettelNodeDefineOptions);

import { compDefine } from '../../../../../main/comp-doc/registry/comp-registry.js';
import { switchConfigDefineList } from '../../card-diagram-switch/SwitchData.js';
import { MigrationExplorer, MigrationTour } from './MigrationExplorer.jsx';
import { MigrationItemList, MigrationMappingChoiceEdit, MigrationMappingColumnEdit, MigrationMappingTableEdit, MigrationSchemaChoiceEdit, MigrationSchemaTableEdit } from './MigrationEdit.jsx';

// The components of a database migration (power-platform-migration.md): modes of a
// frontend object, rendered by the entry component ObjectFrontend, never written
// as blocks themselves.
// the modes drawing a switching viewport declare its config (SceneTitleAlign ...), set by a doc
// page under compConfig by their names
const modeDefine = (label, description, { configDefineList } = {}) => ({ placementList: ['objectFrontend'], expose: { meta: { label, description, isNotInDoc: true, ...(configDefineList ? { configDefineList } : {}) } } });

export const MigrationExplorerDefine = compDefine(MigrationExplorer, modeDefine('Migration: scenes', 'The scenes of a migration, generated from its data items.', { configDefineList: switchConfigDefineList }));
export const MigrationSchemaTableEditDefine = compDefine(MigrationSchemaTableEdit, modeDefine('Migration: edit a table', 'One table of a database, edited on its card.'));
export const MigrationSchemaChoiceEditDefine = compDefine(MigrationSchemaChoiceEdit, modeDefine('Migration: edit an option set', 'One global option set, edited on its card.'));
export const MigrationMappingTableEditDefine = compDefine(MigrationMappingTableEdit, modeDefine('Migration: edit a table mapping', 'A pair of tables: its column mappings edited as lines.'));
export const MigrationMappingColumnEditDefine = compDefine(MigrationMappingColumnEdit, modeDefine('Migration: edit a column mapping', 'One column: its chain of operators.'));
export const MigrationMappingChoiceEditDefine = compDefine(MigrationMappingChoiceEdit, modeDefine('Migration: edit an option set mapping', 'A pair of option sets: value to value.'));
export const MigrationItemListDefine = compDefine(MigrationItemList, modeDefine('Migration: the data items', 'Every data item of the object, by category and kind.'));
export const MigrationTourDefine = compDefine(MigrationTour, modeDefine('Migration: a tour of the scenes', 'Named states over the scenes of a migration, played under the animation layer.', { configDefineList: switchConfigDefineList }));

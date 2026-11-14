import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { AwsNotebook } from './AwsNotebook.jsx';

// The mode of a notebook: a mode of a frontend object, rendered by the entry component
// ObjectFrontend, never written as a block itself.
export const AwsNotebookDefine = compDefine(AwsNotebook, {
  placementList: ['objectFrontend'],
  expose: { meta: { label: 'Notebook: notes', description: 'The notes of one partition of a notebook, in the folders of the doc page or at a storage point.', isNotInDoc: true } },
});

import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { AppConfigView } from './AppConfigView.jsx';

// The mode of a config object (doc/README.md#the-mode): rendered by the entry component
// ObjectFrontend in the placement objectFrontend, never written as a block itself. The modes
// final and layers of the type are this one component, with param.section.
const modeDefine = (label, description) => ({ placementList: ['objectFrontend'], expose: { meta: { label, description, isNotInDoc: true } } });

export const AppConfigViewDefine = compDefine(AppConfigView, modeDefine('App config', 'The final config of an app, where each value came from, and the layers stacked into it.'));

import { slashActionDefine } from './slash-define.js';
import { slashEffect } from '../../frontend/src/lib/doc-slash.js';
import { compDefinitionNormalize, compIdBuiltinByName } from '../registry/comp-registry.js';
import { compDefinitionGet } from '../registry/comp-definition.js';
import { compIconGet, compMetaGet, compSourceDefaultGet } from '../registry/comp-expose.js';
import { componentTemplateTextBuild } from '../../frontend/src/lib/doc-edit-block.js';

// The slash actions of the components (doc_page_impl_edit_slash.md#components-in-the-slash-menu): a
// component that declares a name to be typed after "/" (meta.slashName, meta.slashAliasList) is put
// at the caret by that name, as the insert menu puts it: a block of the component, from the source
// its factory gives for the document (sourceDefaultCreate), in the form the insert menu writes. One
// action per component, under the id comp/{tag name}, built from the registry of the page as the
// insert menu's entries are (edit-template.js): by the tag names authors write, the first tag of a
// component naming it. A component that cannot be a block of a document (isNotInDoc), or whose data
// must first be an asset item (isAssetOnly: the insert menu creates the item), is offered by the
// insert menu alone.
//
//   slashActionByIdCompBuild({ compById, configDoc }) -> { 'comp/{tag name}': action }
export function slashActionByIdCompBuild({ compById = {}, configDoc } = {}) {
  const actionById = {};
  const compIdByTag = { ...compIdBuiltinByName, ...(configDoc?.compRegistry ?? {}) };
  const compIdDoneSet = new Set();
  for (const [compName, compId] of Object.entries(compIdByTag)) {
    if (compIdDoneSet.has(compId)) continue;
    const definition = compDefinitionNormalize(compDefinitionGet(compById, compId));
    if (!definition) continue;
    const meta = compMetaGet(definition);
    if (!meta.slashName || meta.isNotInDoc || meta.isAssetOnly) continue;
    compIdDoneSet.add(compId);
    actionById[`comp/${compName}`] = slashActionDefine({
      name: meta.slashName,
      aliasList: meta.slashAliasList,
      label: meta.label ?? compName,
      description: meta.description,
      icon: compIconGet(definition),
      run: (context = {}) => {
        const docPath = String(context.sourcePath ?? '');
        const source = compSourceDefaultGet(definition, { compName, docPath, docFormat: docPath.endsWith('.mdx') ? 'mdx' : 'md', compConfig: {} });
        if (!source) return slashEffect.cancel();
        return slashEffect.block(source.text ?? componentTemplateTextBuild(compName, source));
      },
    });
  }
  return actionById;
}

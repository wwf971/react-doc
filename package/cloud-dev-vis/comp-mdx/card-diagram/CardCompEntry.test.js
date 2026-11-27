import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

// The rule of the cards holding a component (card-diagram-impl.md#a-component-in-a-card): a card holds
// what a document holds as a block. Checked here over every component there is: the built-in ones,
// every package's and every doc page's of this repository (their comp.yaml, mounted as the page mounts
// them), and every slash action putting a block. Whatever a document can make as a block (the insert
// menu, a slash action), at its top level or in the text of a list item, a card can hold: offered in
// the create panel, started as the document starts it, drawn through the same boundary (placement
// commentBlock). A component added anywhere that breaks it fails here, with its name and the reason.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
// the folders whose components are a scaffold to copy, not components of a page
const FOLDER_SKIP_LIST = ['node_modules', 'dist', 'build', '.git', 'scaffold'];

// a module touching the page as it loads (react-comp-misc's common.js looks up an element) gets a
// page with nothing in it: the registry is read here, nothing is drawn
function pageEmptyProvide() {
  if (globalThis.document) return;
  const element = () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {}, classList: { add() {} }, sheet: { insertRule() {} } });
  globalThis.document = { createElement: element, createTextNode: element, head: element(), body: element(), documentElement: element(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [], addEventListener() {} };
}

function manifestListFind(folder, found = []) {
  for (const name of readdirSync(folder)) {
    if (FOLDER_SKIP_LIST.includes(name)) continue;
    const place = path.join(folder, name);
    if (statSync(place).isDirectory()) manifestListFind(place, found);
    else if (name === 'comp.yaml') found.push(place);
  }
  return found;
}

// the registry of a page holding every component of the repository: { compById, configDoc }
async function registryAllBuild() {
  pageEmptyProvide();
  const { compById: compByIdBuiltin } = await import('../../../../main/comp-doc/registry/registry.js');
  const { compMountByIdBuild } = await import('../../../../main/comp-doc/registry/comp-mount.js');
  const compRegistry = { ...(YAML.parse(readFileSync(path.join(ROOT, 'main/config.yaml'), 'utf8')).compRegistry ?? {}) };
  const mountList = [];
  const loadErrorList = [];
  const manifestList = [...manifestListFind(path.join(ROOT, 'package')), ...manifestListFind(path.join(ROOT, 'example_doc'))];
  for (const manifest of manifestList) {
    const relative = path.relative(ROOT, manifest);
    const owner = relative.startsWith('package/') ? relative.split('/')[1] : 'example';
    const parsed = YAML.parse(readFileSync(manifest, 'utf8')) ?? {};
    for (const item of parsed.compList ?? [parsed]) {
      if (!item?.tagName || !item.entry) continue;
      const entryFile = path.resolve(path.dirname(manifest), item.entry);
      const id = item.id ?? `${owner}/${item.tagName}`;
      try {
        const module = await import(pathToFileURL(entryFile).href);
        mountList.push({ docPageAlias: owner, tagName: item.tagName, id, export: item.export ?? item.tagName, defineOptionsExport: item.defineOptionsExport ?? '', entryFile: relative, module });
        if (compRegistry[item.tagName] === undefined) compRegistry[item.tagName] = id;
      } catch (error) {
        loadErrorList.push(`${relative} ${item.tagName}: ${error.message}`);
      }
    }
  }
  return { compById: { ...compByIdBuiltin, ...compMountByIdBuild(mountList) }, configDoc: { compRegistry }, loadErrorList };
}

const registryPromise = registryAllBuild();

test('every component of the repository is read (nothing left out of the check)', async () => {
  const { loadErrorList, compById } = await registryPromise;
  assert.deepEqual(loadErrorList, []);
  // the packages are in: a card diagram, the cards of oa, a zettel diagram
  for (const id of ['cloud-dev-vis/CardDiagram', 'oa/EventGeneral', 'zettelkasten/ZettelDiagram']) assert.ok(compById[id], `${id} is read`);
});

test('a card holds every component the insert menu of a document makes as a block', async () => {
  const { compById, configDoc } = await registryPromise;
  const { editTemplateListBuild } = await import('../../../../main/comp-doc/edit/edit-template.js');
  const { compIdResolve } = await import('../../../../main/comp-doc/registry/comp-registry.js');
  const { compDefinitionGet } = await import('../../../../main/comp-doc/registry/comp-definition.js');
  const { compIsDocBlock } = await import('../../../../main/comp-doc/registry/comp-expose.js');
  const { cardCompEntryListBuild } = await import('./CardCompEntry.js');
  const templateList = editTemplateListBuild({ configDoc, compById, docPath: '', docFormat: 'md', compConfigGet: () => ({}) });
  const entryByName = new Map(cardCompEntryListBuild({ compById, configDoc }).map((entry) => [entry.compName, entry]));
  const violationList = [];
  let checkedCount = 0;
  for (const template of templateList) {
    if (template.group !== 'component') continue;
    const definition = compDefinitionGet(compById, compIdResolve(configDoc, template.compName));
    if (!compIsDocBlock(definition)) continue;
    checkedCount += 1;
    const entry = entryByName.get(template.compName);
    if (!entry) { violationList.push(`${template.compName}: a block of a document, offered by no card`); continue; }
    if (!entry.source || typeof entry.source.raw !== 'string') violationList.push(`${template.compName}: a card of it starts from no data`);
    if (entry.objectPick && !entry.sourceForObjectGet?.('example:object')) violationList.push(`${template.compName}: a card of it starts from no data for the object picked`);
  }
  assert.deepEqual(violationList, []);
  assert.ok(checkedCount > 20, `the components checked (${checkedCount}) are the page's`);
  // the cases the rule was made for: a formula, a quote block, the entry of a frontend object, a canvas
  assert.deepEqual({ ...entryByName.get('MathBlock')?.source }, { lang: 'latex', raw: 'x', props: {} });
  assert.equal(entryByName.get('BlockSimple')?.source.raw, '> Text of the block.');
  assert.ok(entryByName.get('ObjectFrontend')?.objectPick, 'the entry of a frontend object asks for its object');
  assert.equal(entryByName.get('CardDiagram')?.isFlowCanvas, true, 'a card diagram is held, as a tile');
});

test('a card holds every block a slash action of a document puts, in every place it offers', async () => {
  const { compById, configDoc } = await registryPromise;
  const { slashActionById } = await import('../../../../main/comp-doc/slash/slash-registry.js');
  const { slashActionByIdCompBuild } = await import('../../../../main/comp-doc/slash/slash-comp.js');
  const { compIdResolve } = await import('../../../../main/comp-doc/registry/comp-registry.js');
  const { compDefinitionGet } = await import('../../../../main/comp-doc/registry/comp-definition.js');
  const { compIsDocBlock } = await import('../../../../main/comp-doc/registry/comp-expose.js');
  const { cardCompBlockReaderListBuild } = await import('./CardCompEntry.js');
  const { cardCompDataOfBlockSource } = await import('./CardCompData.js');
  const readerList = cardCompBlockReaderListBuild({ compById, configDoc });
  const actionList = Object.values({ ...slashActionById, ...slashActionByIdCompBuild({ compById, configDoc }) }).filter((action) => action.block);
  const context = { sourcePath: 'example/a.md', isBlockOnly: true };
  const violationList = [];
  const compNameSet = new Set();
  for (const action of actionList) {
    const effectList = [action.run?.(context)];
    for (const item of action.param?.itemListGet('', context) ?? []) effectList.push(action.param.itemChoose(item, '', context));
    for (const effect of effectList.filter(Boolean)) {
      if (effect.type !== 'block') { violationList.push(`/${action.name}: answers ${effect.type}, not a block, where a block alone is taken`); continue; }
      const data = cardCompDataOfBlockSource(effect.source, readerList);
      if (!data) { violationList.push(`/${action.name}: its block is no card: ${JSON.stringify(effect.source).slice(0, 80)}`); continue; }
      if (!compIsDocBlock(compDefinitionGet(compById, compIdResolve(configDoc, data.comp)))) violationList.push(`/${action.name}: a card of ${data.comp}, which no block of a document draws`);
      compNameSet.add(data.comp);
    }
  }
  assert.deepEqual(violationList, []);
  for (const compName of ['Code', 'Mdx', 'MathBlock', 'EventGeneral']) assert.ok(compNameSet.has(compName), `a slash action makes a card of ${compName}`);
});

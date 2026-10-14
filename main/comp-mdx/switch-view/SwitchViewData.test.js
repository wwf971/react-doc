import assert from 'node:assert/strict';
import test from 'node:test';
import { switchViewDataParse, switchViewDependenciesCollect } from './SwitchViewData.js';
import { yamlParse } from '../../frontend/src/lib/yaml.js';

const view = { id: 'table', label: 'Table', component: 'TableHierarchy', data: { rows: [] } };

test('preserves component props and serializes data as valid YAML', () => {
  const value = switchViewDataParse({ views: [{ ...view, props: { config: { height: 320 } } }] });
  assert.equal(value.viewDefault, 'table');
  assert.deepEqual(yamlParse(value.views[0].raw), view.data);
  assert.equal(value.views[0].props.config.height, 320);
});

test('accepts YAML data strings and shared anchors across view entries', () => {
  const value = switchViewDataParse({ raw: `
viewDefault: list
views:
  - id: table
    label: Table
    component: TableHierarchy
    data: &shared
      rows: [{label: Item}]
  - id: list
    label: List
    component: ListHierarchy
    data: *shared
` });
  assert.equal(value.viewDefault, 'list');
  assert.deepEqual(value.views[0].data, value.views[1].data);
  assert.deepEqual(switchViewDataParse({ views: [{ ...view, data: 'items: [one, two]' }] }).views[0].data, { items: ['one', 'two'] });
});

test('rejects invalid view declarations and defaults', () => {
  assert.throws(() => switchViewDataParse({ views: [] }), /non-empty/);
  assert.throws(() => switchViewDataParse({ views: [view, view] }), /unique/);
  assert.throws(() => switchViewDataParse({ views: [view], viewDefault: 'missing' }), /unknown/);
  assert.throws(() => switchViewDataParse({ views: [{ ...view, component: '' }] }), /component/);
  assert.throws(() => switchViewDataParse({ views: [{ ...view, props: [] }] }), /props/);
  assert.throws(() => switchViewDataParse({ views: [{ ...view, data: null }] }), /data/);
});

test('collects nested dependencies for every view, not just the active view', () => {
  const found = [];
  const warnings = [];
  const context = { componentCollect: (...entry) => found.push(entry), warn: (message) => warnings.push(message) };
  switchViewDependenciesCollect({ views: [view, { ...view, id: 'other', component: 'SourceLink', data: { target: '/example.js' } }] }, context);
  assert.deepEqual(found.map(([component]) => component), ['TableHierarchy', 'SourceLink']);
  assert.equal(found[1][1].target, '/example.js');
  switchViewDependenciesCollect({ views: [] }, context);
  assert.equal(warnings.length, 1);
});

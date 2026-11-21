import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUsageListScan } from './doc-asset-ref.js';

test('a reference after a fenced block that is a list item is found', () => {
  const text = [
    '- notes',
    '  - ```text view=icon',
    '    aaaa',
    '    ```',
    '- two icons and text',
    '  <!--renderComp=Code,view=icon,title=weekly query-->',
    '  ```asset',
    '  store: local',
    '  itemId: abc',
    '  ```',
    '  1. ```asset',
    '     store: local',
    '     itemId: unmarked',
    '     ```',
  ].join('\n');
  const usageList = assetUsageListScan(text, 'doc.md');
  assert.deepEqual(usageList.map((usage) => [usage.compName, usage.reference.itemId, usage.place.sourceLine]), [['Code', 'abc', 6]]);
});

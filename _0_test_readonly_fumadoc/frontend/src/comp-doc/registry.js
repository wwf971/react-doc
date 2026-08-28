import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { Callout } from 'fumadocs-ui/components/callout';
import { Accordions, Accordion } from 'fumadocs-ui/components/accordion';
import { Steps, Step } from 'fumadocs-ui/components/steps';
import { Files, File, Folder } from 'fumadocs-ui/components/files';
import { DemoCounter } from './specific/DemoCounter.jsx';
import { StockTable } from './specific/StockTable.jsx';
import { compDefine, compNativeDefine } from './comp-registry.js';

// all components that docs may use. what is actually exposed to doc authors
// (and under which tag name) is decided by compRegistry in config.yaml.
export const compById = {
  // relatively common components, re-exported from the fumadocs default theme
  'common/Tabs': compNativeDefine(Tabs, { placementList: ['mdx'] }),
  'common/Tab': compNativeDefine(Tab, { placementList: ['mdx'] }),
  'common/Callout': compNativeDefine(Callout, { placementList: ['mdx'] }),
  'common/Accordions': compNativeDefine(Accordions, { placementList: ['mdx'] }),
  'common/Accordion': compNativeDefine(Accordion, { placementList: ['mdx'] }),
  'common/Steps': compNativeDefine(Steps, { placementList: ['mdx'] }),
  'common/Step': compNativeDefine(Step, { placementList: ['mdx'] }),
  'common/Files': compNativeDefine(Files, { placementList: ['mdx'] }),
  'common/File': compNativeDefine(File, { placementList: ['mdx'] }),
  'common/Folder': compNativeDefine(Folder, { placementList: ['mdx'] }),
  'specific/DemoCounter': compDefine(DemoCounter),
  'specific/StockTable': compDefine(StockTable),
};

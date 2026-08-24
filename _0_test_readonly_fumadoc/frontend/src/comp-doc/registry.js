import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { Callout } from 'fumadocs-ui/components/callout';
import { Accordions, Accordion } from 'fumadocs-ui/components/accordion';
import { Steps, Step } from 'fumadocs-ui/components/steps';
import { Files, File, Folder } from 'fumadocs-ui/components/files';
import { DemoCounter } from './specific/DemoCounter.jsx';
import { StockTable } from './specific/StockTable.jsx';

// all components that docs may use. what is actually exposed to doc authors
// (and under which tag name) is decided by compRegistry in config.yaml.
export const compById = {
  // relatively common components, re-exported from the fumadocs default theme
  'common/Tabs': Tabs,
  'common/Tab': Tab,
  'common/Callout': Callout,
  'common/Accordions': Accordions,
  'common/Accordion': Accordion,
  'common/Steps': Steps,
  'common/Step': Step,
  'common/Files': Files,
  'common/File': File,
  'common/Folder': Folder,
  'specific/DemoCounter': DemoCounter,
  'specific/StockTable': StockTable,
};

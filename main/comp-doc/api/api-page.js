import { Info, Keyboard, Languages, ListIcon, Search, Settings, SquareTerminal } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { apiInfoBuild, apiAvailabilityGet } from '../../frontend/src/lib/doc-api.js';

// The apis of the page itself: its context, the settings panel, the
// search, the command palette, the language, and the registries (what
// apis and what keys exist), so a caller outside the page can find out
// what it may call (doc_page_impl_api.md#remote-callers).

const settingsTabList = ['config', 'compConfig', 'assetStore', 'service', 'workspace', 'api'];

export const apiByIdPage = {
  'page/contextGet': apiDefine({
    label: 'Where am I',
    description: 'The context an api runs in: the workspace, the doc page, the document, the block the author is at, the state of the page.',
    icon: Info,
    palette: false,
    run: (context) => context.stores.apiStore.contextInfoBuild(context.principal),
  }),
  'settings/open': apiDefine({
    label: 'Open the settings panel',
    description: 'Opens the settings panel, on a tab when one is named.',
    icon: Settings,
    paramList: [{ name: 'tab', type: 'string', valueList: settingsTabList, description: 'the tab to show' }],
    palette: true,
    run: ({ stores }, { tab }) => {
      if (tab) stores.configStore.settingsTabIdSet(tab);
      stores.configStore.settingsOpenSet(true);
    },
  }),
  'settings/close': apiDefine({
    label: 'Close the settings panel',
    icon: Settings,
    isAvailable: ({ stores }) => stores.configStore.isSettingsOpen || 'the settings panel is closed',
    run: ({ stores }) => stores.configStore.settingsOpenSet(false),
  }),
  'settings/toggle': apiDefine({
    label: 'Toggle the settings panel',
    icon: Settings,
    palette: false,
    run: ({ stores }) => stores.configStore.settingsOpenSet(!stores.configStore.isSettingsOpen),
  }),
  'search/open': apiDefine({
    label: 'Search the documents',
    description: 'Opens the search dialog.',
    icon: Search,
    isAvailable: (context) => Boolean(context.uiHandleGet('searchOpen')) || 'the search dialog is not mounted',
    run: (context) => context.uiHandleGet('searchOpen')?.(true),
  }),
  // find in the part of the page under the pointer or holding the focus (a diagram canvas):
  // its own search, not the browser's (doc_page_impl_api.md#finding-in-a-part-of-the-page)
  'find/open': apiDefine({
    label: 'Find in this part of the page',
    description: 'Opens the search of the part of the page under the pointer or holding the focus, such as a diagram.',
    icon: Search,
    palette: false,
    isAvailable: ({ stores }) => stores.findStore?.isScopeActive === true || 'nothing under the pointer finds in what it draws',
    run: ({ stores }) => { stores.findStore.open(); },
  }),
  'find/close': apiDefine({
    label: 'Close the search of this part of the page',
    icon: Search,
    palette: false,
    isAvailable: ({ stores }) => stores.findStore?.isOpen === true || 'no search of a part of the page is open',
    run: ({ stores }) => { stores.findStore.close(); },
  }),
  'palette/open': apiDefine({
    label: 'Open the command palette',
    icon: SquareTerminal,
    palette: false,
    run: ({ stores }) => stores.paletteStore.open(),
  }),
  'palette/close': apiDefine({
    label: 'Close the command palette',
    icon: SquareTerminal,
    palette: false,
    run: ({ stores }) => stores.paletteStore.close(),
  }),
  'palette/toggle': apiDefine({
    label: 'Toggle the command palette',
    icon: SquareTerminal,
    palette: false,
    run: ({ stores }) => stores.paletteStore.toggle(),
  }),
  'language/set': apiDefine({
    label: 'Set the language',
    description: 'Selects one of the authored languages of the current document.',
    icon: Languages,
    paramList: [{ name: 'language', type: 'string', isRequired: true, description: 'a language of the document (ja, en, ...)' }],
    run: ({ stores }, { language }) => {
      const isSet = stores.docStore.setLanguageSelected(language);
      return isSet ? { code: 0, data: { language }, message: '' } : { code: -1, message: `${language} is not a language of the document (${stores.docStore.languageListCurrent.join(', ') || 'none'})` };
    },
  }),
  'api/listGet': apiDefine({
    label: 'List the apis',
    description: 'Every api registered now, with its parameters and whether it can run.',
    icon: ListIcon,
    palette: false,
    run: (context) => {
      const { apiStore, hotkeyStore } = context.stores;
      return apiStore.apiList.map((definition) => ({
        ...apiInfoBuild(definition, apiAvailabilityGet(definition, context)),
        hotkey: hotkeyStore?.labelGet(definition.id) ?? '',
      }));
    },
  }),
  'hotkey/listGet': apiDefine({
    label: 'List the hotkeys',
    description: 'Every key bound now: the api it runs, the map it comes from, the bindings it shadows.',
    icon: Keyboard,
    palette: false,
    run: ({ stores }) => stores.hotkeyStore.rowListEffective.map((row) => ({
      key: row.keyText,
      keyLabel: row.keyLabel,
      api: row.binding?.api ?? null,
      params: row.binding?.params ?? {},
      when: row.binding?.whenText ?? '',
      map: row.binding?.mapId ?? '',
      source: row.binding?.source ?? '',
      passedList: row.passedList.map((passed) => ({ api: passed.binding.api, map: passed.binding.mapId, reason: passed.reason })),
    })),
  }),
};

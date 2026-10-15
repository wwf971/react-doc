import { CommandType, LocaleType, Plugin, createUniver, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import univerSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';

// The Univer sheet engine as ExcelUniver asks the host for it
// (config.univerLoad, given in compConfigHost): imported on the first
// spreadsheet of a page, so a page without one never loads it. The paths
// above are the public entries Univer documents for its preset.
//
//   univerVersion   the version of the engine (the core's, every @univerjs
//                   package is released under the same one), recorded in the
//                   metadata of the data it writes
export const univerVersion = Plugin.version;

export const univerLocaleDefault = LocaleType.EN_US;

export const univerLocales = {
  [LocaleType.EN_US]: mergeLocales(univerSheetsCoreEnUS),
};

export { CommandType, UniverSheetsCorePreset, createUniver };

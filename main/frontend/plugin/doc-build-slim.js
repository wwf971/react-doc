// What a build of one file leaves out (doc_page_impl_cli.md#one-file).
//
// A normal build keeps the big libraries of the page in chunks of their own, read only by a
// page that needs them. One file has no chunks: everything is in it, and is read when it
// opens. Most of what such a file would hold is three things only a few documents need:
//
//   mermaid and its layout engines      for DiagramMermaid
//   the spreadsheet engine (Univer)     for ExcelUniver
//   every language and theme of shiki   for the code blocks, which use a few
//
// So the text the build carries is read for what it asks for, and the rest is left out. The
// reading is on the safe side: the name of a library anywhere (a word of a document, an asset,
// the source of a component of the doc page or a package) keeps it. What is left out by
// mistake says so when it is used: a language falls back to plain text, a library fails with
// a message naming --keep-all.
//
// Only node's own modules: the command line imports this file directly.

const OMIT_ID_PREFIX = '\0doc-build-omit:';
const THEME_KEEP_LIST = ['github-light', 'github-dark'];
const FENCE_REGEX = /^[ \t>]*(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]+)/gm;

// what the text of a build asks for. registry: the tag names of the components and the
// ids they stand for (compRegistry), so a name of its own for one of them counts
export function docBuildUsageRead(textList, registry = {}) {
  const wordListOf = (idPart, wordList) => {
    const nameList = Object.entries(registry)
      .filter(([, id]) => typeof id === 'string' && id.includes(idPart))
      .map(([name]) => name.replace(/[^A-Za-z0-9_-]/g, ''))
      .filter(Boolean);
    return new RegExp(`\\b(?:${[...new Set([...nameList, ...wordList])].join('|')})`, 'i');
  };
  const mermaidRegex = wordListOf('DiagramMermaid', ['mermaid', '\\w*mermaid']);
  const univerRegex = wordListOf('ExcelUniver', ['univer', '\\w*univer']);
  const usage = { isMermaidUsed: false, isUniverUsed: false, langSet: new Set() };
  for (const text of textList) {
    usage.isMermaidUsed ||= mermaidRegex.test(text);
    usage.isUniverUsed ||= univerRegex.test(text);
    for (const match of text.matchAll(FENCE_REGEX)) usage.langSet.add(match[1].toLowerCase());
  }
  return usage;
}

// a list of shiki (languages, themes): an array of { "id", "aliases"?, ..., "import" } entries
// in its source, of which those kept stay. it falls back to plain text for a language it does
// not list. a source of another shape stays as it is: nothing is lost but the size
export function docBuildShikiListFilter(code, isKept) {
  let countKept = 0;
  let countAll = 0;
  const codeNext = code.replace(/^\t\{\n(?:\t\t.*\n)+?\t\},?\n/gm, (entry) => {
    const id = /"id": "([^"]+)"/.exec(entry)?.[1];
    if (!id) return entry;
    countAll += 1;
    const aliasList = /"aliases": \[([^\]]*)\]/.exec(entry)?.[1].match(/[^",\s]+/g) ?? [];
    if (!isKept(id, aliasList)) return '';
    countKept += 1;
    return entry;
  });
  return { code: codeNext, countKept, countAll };
}

// a font of many formats in one file holds all of them; every browser here reads woff2
export function docBuildFontSlim(cssText) {
  return cssText.replace(
    /(url\(["']?data:font\/woff2[^)]*\)\s*format\(["']?woff2["']?\))(?:\s*,\s*url\(["']?data:font\/(?:woff|ttf|truetype)[^)]*\)\s*format\(["']?(?:woff|truetype)["']?\))+/g,
    '$1',
  );
}

// what was left out, as the build reports it
export function docBuildSlimPlugin() {
  const report = { omitList: [], langList: [], langLeftOutCount: 0, themeLeftOutCount: 0 };
  let usage;
  const plugin = {
    name: 'doc-build-slim',
    enforce: 'pre',
    report,
    configResolved(config) {
      const source = config.plugins.find((item) => item.name?.startsWith('doc-source:'));
      usage = docBuildUsageRead(source.api.buildTextListGet(), source.api.buildCompRegistryGet());
      if (!usage.isMermaidUsed) report.omitList.push('mermaid');
      if (!usage.isUniverUsed) report.omitList.push('the spreadsheet engine (Univer)');
    },
    resolveId(id) {
      if (id === 'mermaid' && !usage.isMermaidUsed) return `${OMIT_ID_PREFIX}mermaid`;
      if (id.endsWith('/univer-load.js') && !usage.isUniverUsed) return `${OMIT_ID_PREFIX}univer`;
      // for the engine fumadocs does not use by default; the javascript one needs no wasm
      if (id === 'shiki/wasm') return `${OMIT_ID_PREFIX}shiki-wasm`;
      return undefined;
    },
    load(id) {
      if (!id.startsWith(OMIT_ID_PREFIX)) return undefined;
      const name = id.slice(OMIT_ID_PREFIX.length);
      return `throw new Error(${JSON.stringify(`${name} was left out of this file because no document seemed to use it: build again with react-doc build --keep-all`)});`;
    },
    transform(code, id) {
      const file = id.split('?')[0].replaceAll('\\', '/');
      if (/\/shiki\/dist\/langs-bundle-full-[^/]*\.mjs$/.test(file)) {
        const kept = [];
        const result = docBuildShikiListFilter(code, (langId, aliasList) => {
          const isKept = usage.langSet.has(langId) || aliasList.some((alias) => usage.langSet.has(alias));
          if (isKept) kept.push(langId);
          return isKept;
        });
        report.langList = kept;
        report.langLeftOutCount = result.countAll - result.countKept;
        return { code: result.code, map: null };
      }
      if (/\/shiki\/dist\/themes\.mjs$/.test(file)) {
        const result = docBuildShikiListFilter(code, (themeId) => THEME_KEEP_LIST.includes(themeId));
        report.themeLeftOutCount = result.countAll - result.countKept;
        return { code: result.code, map: null };
      }
      return undefined;
    },
  };
  return plugin;
}

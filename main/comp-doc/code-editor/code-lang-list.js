// The languages offered when the language of a code block is chosen
// (doc_page_impl_mdx_code.md#editing-the-lines): the ones met most, each
// highlighted by the page (shiki, when the document is compiled) and by the
// code editor (CodeMirror). A language not listed can be written all the
// same: a block of a language the page does not highlight is shown plain.
//
//   id        the word written in the info string of the fence
//   label     what the list says
//   aliasList other words that find it (py, sh, yml)
export const CODE_LANG_LIST = [
  { id: 'text', label: 'Text', aliasList: ['txt', 'plain', 'plaintext'] },
  { id: 'markdown', label: 'Markdown', aliasList: ['md'] },
  { id: 'json', label: 'JSON', aliasList: [] },
  { id: 'yaml', label: 'YAML', aliasList: ['yml'] },
  { id: 'toml', label: 'TOML', aliasList: [] },
  { id: 'xml', label: 'XML', aliasList: ['svg'] },
  { id: 'html', label: 'HTML', aliasList: ['htm'] },
  { id: 'css', label: 'CSS', aliasList: [] },
  { id: 'scss', label: 'SCSS', aliasList: ['sass'] },
  { id: 'javascript', label: 'JavaScript', aliasList: ['js', 'mjs', 'cjs'] },
  { id: 'typescript', label: 'TypeScript', aliasList: ['ts'] },
  { id: 'jsx', label: 'JSX', aliasList: [] },
  { id: 'tsx', label: 'TSX', aliasList: [] },
  { id: 'python', label: 'Python', aliasList: ['py'] },
  { id: 'bash', label: 'Bash', aliasList: ['sh', 'shell', 'zsh'] },
  { id: 'powershell', label: 'PowerShell', aliasList: ['ps1', 'pwsh'] },
  { id: 'sql', label: 'SQL', aliasList: ['tsql', 'mssql', 'mysql', 'postgresql'] },
  { id: 'java', label: 'Java', aliasList: [] },
  { id: 'kotlin', label: 'Kotlin', aliasList: ['kt'] },
  { id: 'c', label: 'C', aliasList: ['h'] },
  { id: 'cpp', label: 'C++', aliasList: ['c++', 'hpp', 'cc'] },
  { id: 'csharp', label: 'C#', aliasList: ['cs', 'c#'] },
  { id: 'go', label: 'Go', aliasList: ['golang'] },
  { id: 'rust', label: 'Rust', aliasList: ['rs'] },
  { id: 'php', label: 'PHP', aliasList: [] },
  { id: 'ruby', label: 'Ruby', aliasList: ['rb'] },
  { id: 'swift', label: 'Swift', aliasList: [] },
  { id: 'dart', label: 'Dart', aliasList: [] },
  { id: 'lua', label: 'Lua', aliasList: [] },
  { id: 'r', label: 'R', aliasList: [] },
  { id: 'scala', label: 'Scala', aliasList: [] },
  { id: 'haskell', label: 'Haskell', aliasList: ['hs'] },
  { id: 'perl', label: 'Perl', aliasList: ['pl'] },
  { id: 'dockerfile', label: 'Dockerfile', aliasList: ['docker'] },
  { id: 'makefile', label: 'Makefile', aliasList: ['make'] },
  { id: 'ini', label: 'INI', aliasList: ['properties', 'conf'] },
  { id: 'diff', label: 'Diff', aliasList: ['patch'] },
  { id: 'graphql', label: 'GraphQL', aliasList: ['gql'] },
  { id: 'vue', label: 'Vue', aliasList: [] },
  { id: 'svelte', label: 'Svelte', aliasList: [] },
  { id: 'latex', label: 'LaTeX', aliasList: ['tex'] },
];

// the languages matching what is typed, best first: an id or alias equal to
// it, then starting with it, then holding it (in the label too); all of them
// when nothing is typed
export function codeLangSearch(query) {
  const queryLower = String(query ?? '').trim().toLowerCase();
  if (queryLower === '') return CODE_LANG_LIST;
  const scoreGet = (lang) => {
    const wordList = [lang.id, ...lang.aliasList];
    if (wordList.includes(queryLower)) return 0;
    if (wordList.some((word) => word.startsWith(queryLower))) return 1;
    if (wordList.some((word) => word.includes(queryLower)) || lang.label.toLowerCase().includes(queryLower)) return 2;
    return -1;
  };
  return CODE_LANG_LIST
    .map((lang, index) => ({ lang, index, score: scoreGet(lang) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.lang);
}

// The "exclude" of an addFolder rule: files and folders the rule does not
// collect, written the way a .gitignore is (design:
// doc_page_impl_source.md#excluding-files-and-folders).
//
//   - action: addFolder
//     path: ..
//     collect: recursive
//     exclude:
//       - "*.pyc"            a name: matched at any depth, files and folders
//       - .DS_Store
//       - sub-doc/           a trailing "/": folders only (with everything below)
//       - /draft.md          a leading "/": only right in the rule's folder
//       - comp-mdx/**/*.js   a "/" inside: a path from the rule's folder
//       - "!keep.pyc"        "!": collected again, when an earlier pattern excluded it
//
// or the same lines as one block, like the file itself (blank lines and
// lines starting with "#" are skipped):
//
//     exclude: |
//       *.pyc
//       sub-doc/
//
// a pattern is matched against the path from the rule's folder, with "/"
// separators. "*" is any text but "/", "?" one character but "/", "[a-z]"
// one of a set ("[!a]" not in it), "**" any folders: "**/x" x at any depth,
// "x/**" everything inside x, "a/**/b" zero or more folders between. "\"
// takes the next character as it is ("\#a", "\!a"). the last pattern that
// matches decides. as in git, a file inside an excluded folder cannot be
// collected again by "!": the folder is not entered.

export type ExcludePattern = {
  // the pattern as written
  text: string;
  isNegated: boolean;
  isDirOnly: boolean;
  regex: RegExp;
};

export type ExcludeMatcher = {
  patternList: ExcludePattern[];
  // relPath from the rule's folder, "/" separated
  isExcluded: (relPath: string, isDir: boolean) => boolean;
};

// the patterns of an "exclude" value: a list of strings, or one string of
// lines. throws with the place for anything else
export function excludePatternTextListRead(value: unknown, place: string): string[] {
  if (value === undefined || value === null) return [];
  let lineList: unknown[];
  if (typeof value === 'string') lineList = value.split(/\r?\n/);
  else if (Array.isArray(value)) lineList = value;
  else throw new Error(`[doc-source] "exclude" must be a list of patterns or a block of lines (like a .gitignore): ${place}`);
  const textList: string[] = [];
  lineList.forEach((line, index) => {
    if (typeof line !== 'string') {
      throw new Error(`[doc-source] "exclude" item ${index} must be a string pattern: ${place}`);
    }
    const text = excludeLineTrim(line);
    if (text === '' || text.startsWith('#')) return;
    const error = excludePatternErrorGet(text);
    if (error) throw new Error(`[doc-source] "exclude" pattern ${JSON.stringify(line)}: ${error}: ${place}`);
    textList.push(text);
  });
  return textList;
}

export function excludeMatcherBuild(textList: string[]): ExcludeMatcher {
  const patternList = textList.map(excludePatternCompile);
  return {
    patternList,
    isExcluded: (relPath, isDir) => {
      let isExcluded = false;
      for (const pattern of patternList) {
        if (pattern.isDirOnly && !isDir) continue;
        if (pattern.isNegated !== isExcluded) continue; // cannot change the state
        if (pattern.regex.test(relPath)) isExcluded = !pattern.isNegated;
      }
      return isExcluded;
    },
  };
}

// trailing spaces go, unless escaped with "\"
function excludeLineTrim(line: string): string {
  const text = line.replace(/^\s+/, '');
  let end = text.length;
  while (end > 0 && text[end - 1] === ' ' && text[end - 2] !== '\\') end--;
  return text.slice(0, end);
}

function excludePatternErrorGet(text: string): string {
  const body = text.startsWith('!') ? text.slice(1) : text;
  if (body === '' || body === '/') return 'names nothing';
  if (/(^|\/)\.\.?(\/|$)/.test(body)) return '"." and ".." are not path segments here';
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    if (body[index] === '\\') index++;
    else if (body[index] === '[') depth++;
    else if (body[index] === ']' && depth > 0) depth--;
  }
  return depth > 0 ? 'a "[" is not closed' : '';
}

export function excludePatternCompile(textRaw: string): ExcludePattern {
  let text = textRaw;
  let isNegated = false;
  if (text.startsWith('!')) {
    isNegated = true;
    text = text.slice(1);
  } else if (text.startsWith('\\!') || text.startsWith('\\#')) {
    text = text.slice(1);
  }
  let isDirOnly = false;
  if (text.endsWith('/') && !text.endsWith('\\/')) {
    isDirOnly = true;
    text = text.replace(/\/+$/, '');
  }
  // a "/" at the start or inside anchors the pattern at the rule's folder;
  // without one it is a name, matched at any depth
  const isAnchored = text.includes('/');
  if (text.startsWith('/')) text = text.slice(1);
  const body = globBodyRegexBuild(text);
  const regex = new RegExp(isAnchored ? `^${body}$` : `^(?:.*/)?${body}$`);
  return { text: textRaw, isNegated, isDirOnly, regex };
}

function globBodyRegexBuild(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      result += regexEscape(text[index + 1] ?? '');
      index += 2;
      continue;
    }
    if (char === '*' && text[index + 1] === '*') {
      const isSegmentStart = index === 0 || text[index - 1] === '/';
      const isSegmentEnd = index + 2 === text.length || text[index + 2] === '/';
      if (isSegmentStart && isSegmentEnd) {
        if (index + 2 === text.length) {
          // "x/**": everything inside; "**" alone: everything
          result += index === 0 ? '.*' : '.+';
          index += 2;
        } else {
          // "**/": zero or more folders
          result += '(?:.*/)?';
          index += 3;
        }
        continue;
      }
      // "a**b" is two stars in one segment: any text but "/"
      result += '[^/]*';
      index += 2;
      continue;
    }
    if (char === '*') {
      result += '[^/]*';
      index++;
      continue;
    }
    if (char === '?') {
      result += '[^/]';
      index++;
      continue;
    }
    if (char === '[') {
      const end = text.indexOf(']', index + 2);
      if (end > 0) {
        let set = text.slice(index + 1, end);
        if (set.startsWith('!')) set = `^${set.slice(1)}`;
        result += `[${set.replace(/\\/g, '\\\\')}]`;
        index = end + 1;
        continue;
      }
    }
    result += regexEscape(char);
    index++;
  }
  return result;
}

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

import { parse as parseYaml } from 'yaml';

// The frontmatter of a document: the yaml between two "---" lines at its
// very start. The runtime preset of the compile has no frontmatter plugin, so
// the page strips and parses it here; the edit layer maps positions of the
// parsed content back to lines of the complete file with it, and the block
// model of a managed document (doc-managed-block.js) keeps it apart from its
// blocks. A module of its own, free of the compile, so that the development
// server reads it too.
export function splitFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) return { frontmatter: null, content: source };
  let frontmatter = null;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    // malformed frontmatter: keep it out of the rendered body anyway
  }
  return { frontmatter, content: source.slice(match[0].length) };
}

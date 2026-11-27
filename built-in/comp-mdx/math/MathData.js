import katex from 'katex';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// LaTeX math of a document (comp_math.md), in the Markdown
// the page reads it in (remark-math, drawn by KaTeX). The built-in component
// math: what the edit layer needs of it to type a formula as one thing of a
// text (its atom kind, math-atom.js), and to edit a block of it.
//
//   inline   $x^2$ in a line of text
//   block    $$ on a line of its own, the formula, $$ on a line of its own:
//            a line of its own in the text it stands in (a block of the
//            document, or a line of a list item among its text)
//
// what is math is what the parser of the page says it is: never a $ in code,
// an escaped \$, or a $ that opens nothing.

const parser = remark().use(remarkGfm).use(remarkMath);

// the math of a text, in order: [{ start, end, value, isRow }]
// start / end: the math in the text, its delimiters included (a block: from
// the start of its opening line to the end of its closing one); isRow: a
// block, on lines of its own
export function mathSpanListGet(text) {
  const source = String(text ?? '');
  if (!source.includes('$')) return [];
  let tree;
  try {
    tree = parser.parse(source);
  } catch {
    return [];
  }
  const spanList = [];
  const walk = (node) => {
    if (node.type === 'inlineMath' || node.type === 'math') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (Number.isInteger(start) && Number.isInteger(end)) {
        spanList.push({ start, end, value: String(node.value ?? ''), isRow: node.type === 'math' });
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return spanList.sort((a, b) => a.start - b.start);
}

// the formula of a text that is one block of math, $$ lines and nothing else (a block of a
// document), as the data of a block of the component MathBlock (its expose.blockTextRead: a card of a
// card diagram holds it so): { lang: 'latex', raw: the formula }; null for any other text
export function mathBlockTextRead(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  const spanList = mathSpanListGet(source);
  if (spanList.length !== 1 || !spanList[0].isRow || spanList[0].start !== 0 || spanList[0].end !== source.length) return null;
  return { lang: MATH_BLOCK_LANG, raw: spanList[0].value };
}

// the language of the data of a block of MathBlock held as data: its formula, in LaTeX
export const MATH_BLOCK_LANG = 'latex';

// the source of a formula: inline in its dollars, a block between its lines
// of $$. an inline formula is one line: its line breaks become spaces, and it
// keeps no space next to its dollars, which would make it no math
export function mathSourceBuild(value, isRow = false) {
  const text = String(value ?? '');
  if (isRow) return `$$\n${text.replace(/\n+$/, '')}\n$$`;
  return `$${text.replace(/\s*\n\s*/g, ' ').trim()}$`;
}

// the formula drawn into an element, as the page draws it (KaTeX), and what
// is wrong with it: '' when it is a formula, else the message of KaTeX (the
// formula is then drawn as far as it goes, the faulty part in red)
export function mathRender(element, value, isBlock = false) {
  const text = String(value ?? '');
  try {
    katex.render(text, element, { displayMode: isBlock, throwOnError: true, output: 'html' });
    return '';
  } catch (error) {
    try {
      katex.render(text, element, { displayMode: isBlock, throwOnError: false, output: 'html' });
    } catch {
      element.textContent = text;
    }
    return mathErrorMessageGet(error);
  }
}

// what is wrong with a formula, without drawing it: '' when nothing is
export function mathErrorGet(value, isBlock = false) {
  try {
    katex.renderToString(String(value ?? ''), { displayMode: isBlock, throwOnError: true, output: 'html' });
    return '';
  } catch (error) {
    return mathErrorMessageGet(error);
  }
}

// the message of KaTeX without the formula it quotes (marked with combining
// underlines): the field shows the formula already
function mathErrorMessageGet(error) {
  return String(error?.rawMessage ?? error?.message ?? error).replace(/^KaTeX parse error:\s*/, '');
}

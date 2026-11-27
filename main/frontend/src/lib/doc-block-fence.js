// The one fenced block a text is, from its opening fence to its closing one (``` or ~~~; the closing
// fence of the same character, at least as long): { info, raw }, raw its lines each ending with a line
// break ('' for none), or null for a text that is not one fenced block (no fence, not closed, text
// after it). Read by what takes a block of a document as data: the block of a component after its
// marker, and a fenced code block as the data of Code (its expose.blockTextRead), for a card of a card
// diagram holding it (package/cloud-dev-vis/comp-mdx/card-diagram/CardCompData.js)
export function blockFenceRead(text) {
  const lineList = String(text ?? '').replace(/\r\n?/g, '\n').trim().split('\n');
  const open = /^(`{3,}|~{3,})(.*)$/.exec(lineList[0] ?? '');
  if (!open) return null;
  const close = lineList.length - 1;
  if (close < 1 || !new RegExp(`^${open[1][0] === '`' ? '`' : '~'}{${open[1].length},}\\s*$`).test(lineList[close])) return null;
  const body = lineList.slice(1, close);
  return { info: open[2].trim(), raw: body.length ? `${body.join('\n')}\n` : '' };
}

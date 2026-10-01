// author-facing tag name of the anchor component. remarkAnchor and
// remarkCommentComp recognize the marker comment before the registry is involved.
export const anchorCompNameList = ['Anchor'];

export function anchorCompNameIs(compName) {
  return anchorCompNameList.includes(compName);
}

// aliases as authored:
//   comment form  aliases=[a, b]   -> the string "[a, b]"
//   mdx form      aliases={['a']}  -> an array
// returns ['a', 'b']
export function anchorAliasListParse(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (text === '') return [];
  const textInner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return textInner.split(',').map((item) => item.trim()).filter(Boolean);
}

// data { id, aliases } -> every declared id, primary id first, no duplicates
export function anchorIdListGet(data = {}) {
  const id = String(data.id ?? '').trim();
  const idList = id === '' ? [] : [id];
  return [...new Set([...idList, ...anchorAliasListParse(data.aliases)])];
}

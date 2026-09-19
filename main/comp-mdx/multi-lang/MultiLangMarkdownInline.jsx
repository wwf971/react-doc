import { Fragment } from 'react';
import { DocLink } from '../../frontend/src/comp-doc/DocLink.jsx';

export function multiLangInlineNodeListRender(nodeList, sourcePath) {
  return nodeList.map((node, index) => inlineNodeRender(node, index, sourcePath));
}

function inlineNodeRender(node, key, sourcePath) {
  if (node.type === 'text') return node.value;
  if (node.type === 'inlineCode') return <code key={key}>{node.value}</code>;
  if (node.type === 'emphasis') return <em key={key}>{multiLangInlineNodeListRender(node.children, sourcePath)}</em>;
  if (node.type === 'strong') return <strong key={key}>{multiLangInlineNodeListRender(node.children, sourcePath)}</strong>;
  if (node.type === 'delete') return <del key={key}>{multiLangInlineNodeListRender(node.children, sourcePath)}</del>;
  if (node.type === 'break') return <br key={key} />;
  if (node.type === 'link') {
    const children = multiLangInlineNodeListRender(node.children, sourcePath);
    if (isExternalUrl(node.url) || node.url.startsWith('#')) {
      return <a key={key} href={node.url} title={node.title ?? undefined}>{children}</a>;
    }
    return <DocLink key={key} target={node.url} from={sourcePath} kind="link">{children}</DocLink>;
  }
  return <Fragment key={key}>{multiLangInlineNodeListRender(node.children ?? [], sourcePath)}</Fragment>;
}

function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}
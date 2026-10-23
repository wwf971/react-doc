import { editTextModelBuild } from './doc-edit-block.js';

// The pipeline of a paste (design: doc_page_impl_block_ops.md): the text
// an author pastes becomes the list of root-level blocks it would be in the
// document it goes to, after the transforms the host application supplies.
//
//   text pasted
//     -> normalized: "\n" line endings, no blank lines around it
//     -> transforms of stage 'text', in order: (text, context) => text
//     -> parsed into blocks, as a document of the target's format is parsed
//        (editTextModelBuild: the block model of the edit layer)
//     -> transforms of stage 'block', in order, on every block:
//        (blockText, { ...context, block }) => text; the result is parsed
//        again, since a transform may turn one block into two
//     -> blockList, and the text that is inserted: the blocks, one blank
//        line between two of them
//
// a transform: { id, label?, stage: 'text' | 'block', transform }
// context:     { format: 'md' | 'mdx', docPath } of the target document
//
// a transform that throws leaves its input as it was and is reported in
// messageList; a text that does not parse (invalid JSX in mdx) gives no
// blocks and isError.
//
// result: { blockList, text, transformAppliedIdList, messageList, isError }
//   blockList  [{ id, index, kind, text, component? }], the block model's
//              entries (kind, component) with an id for the views
export function pasteBlockListBuild({ text, format, docPath = '', transformList = [] }) {
  const context = { format: format === 'mdx' ? 'mdx' : 'md', docPath };
  const transformAppliedIdList = [];
  const messageList = [];
  const transformRun = (transform, input, contextRun) => {
    try {
      const output = String(transform.transform(input, contextRun) ?? '');
      if (output !== input && !transformAppliedIdList.includes(transform.id)) transformAppliedIdList.push(transform.id);
      return output;
    } catch (error) {
      messageList.push(`The transform "${transform.label || transform.id}" failed: ${error?.message ?? error}`);
      return input;
    }
  };

  let textCurrent = pasteTextNormalize(text);
  for (const transform of transformList.filter((item) => item.stage !== 'block')) {
    textCurrent = transformRun(transform, textCurrent, context);
  }
  let model = modelBuild(textCurrent, context.format, messageList);
  const transformListBlock = transformList.filter((item) => item.stage === 'block');
  if (model && transformListBlock.length > 0 && model.blockList.length > 0) {
    textCurrent = model.blockList
      .map((block) => transformListBlock.reduce(
        (blockText, transform) => transformRun(transform, blockText, { ...context, block: blockInfoGet(block) }),
        block.text,
      ))
      .join('\n\n');
    model = modelBuild(textCurrent, context.format, messageList);
  }
  if (!model) return { blockList: [], text: '', transformAppliedIdList, messageList, isError: true };
  if (model.frontmatter) messageList.push('The frontmatter at the start of the pasted text is not inserted.');

  const blockList = model.blockList.map((block) => ({ id: `block-${block.index}`, ...blockInfoGet(block), text: block.text }));
  return {
    blockList,
    text: blockList.map((block) => block.text).join('\n\n'),
    transformAppliedIdList,
    messageList,
    isError: false,
  };
}

function pasteTextNormalize(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

function modelBuild(text, format, messageList) {
  try {
    return editTextModelBuild({ text, format });
  } catch (error) {
    const line = error?.place?.line ?? error?.line;
    const where = Number.isInteger(line) ? `line ${line}: ` : '';
    messageList.push(`The text does not parse as ${format === 'mdx' ? 'MDX' : 'Markdown'}: ${where}${error?.reason ?? error?.message ?? error}`);
    return undefined;
  }
}

function blockInfoGet(block) {
  const info = { index: block.index, kind: block.kind };
  if (block.depth !== undefined) info.depth = block.depth;
  if (block.component) info.component = { compName: block.component.compName, props: block.component.props, lang: block.component.lang };
  return info;
}

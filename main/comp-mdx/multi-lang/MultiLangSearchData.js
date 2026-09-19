import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { remarkHeading } from 'fumadocs-core/mdx-plugins/remark-heading';
import { remarkStructure } from 'fumadocs-core/mdx-plugins/remark-structure';
import { remarkCommentComp } from '../../frontend/src/lib/remark-comment-comp.js';
import { multiLangRemarkHeading } from './MultiLangRemarkHeading.js';
import { multiLangStructuredDataGet } from './MultiLangData.js';

// Fumadocs remarkStructure officially accepts custom-component search entries
// through node.data.structuredData.contents. Run the rendering transforms first
// so comment components can attach those entries before extraction.
export function multiLangSearchDataGet(markdown, config = {}) {
  const headingVariantList = [];
  const structuredDataGet = ({ compName, props, raw }) => {
    const getter = config.structuredDataGetByComponent?.[compName]
      ?? (compName === 'DocMultiLang' ? multiLangStructuredDataGet : undefined);
    return getter?.(raw, { compName, props });
  };
  const file = remark()
    .use(remarkGfm)
    .use(remarkHeading, { generateToc: false })
    .use(multiLangRemarkHeading, {
      onHeading: ({ id, variantsJson }) => {
        headingVariantList.push({ id, translationByLanguage: JSON.parse(variantsJson) });
      },
    })
    .use(remarkCommentComp, { isSearchIndex: true, structuredDataGet })
    .use(remarkStructure)
    .processSync(markdown);
  const data = file.data.structuredData ?? { contents: [], headings: [] };

  for (const headingVariant of headingVariantList) {
    const index = data.headings.findIndex((heading) => heading.id === headingVariant.id);
    if (index < 0) continue;
    data.headings.splice(
      index,
      1,
      ...Object.values(headingVariant.translationByLanguage).map((content) => ({
        id: headingVariant.id,
        content: String(content),
      })),
    );
  }
  return data;
}
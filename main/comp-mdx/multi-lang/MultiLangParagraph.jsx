import { useMemo } from 'react';
import { useDocLanguage } from './MultiLangContext.jsx';
import { multiLangParagraphsParse } from './MultiLangParagraphData.js';
import { multiLangInlineNodeListRender } from './MultiLangMarkdownInline.jsx';

export function MultiLangParagraphs({ data = {}, sourcePath = '' }) {
  const languagePreferred = useDocLanguage();
  const result = useMemo(
    () => multiLangParagraphsParse(data.raw ?? '', data.languages),
    [data.languages, data.raw],
  );

  if (result.error) return <MultiLangParagraphsError message={result.error} raw={data.raw} />;

  return result.groupList.map((group, index) => {
    const languageRendered = group[languagePreferred] ? languagePreferred : result.languageList[0];
    return (
      <p key={index} lang={languageRendered}>
        {multiLangInlineNodeListRender(group[languageRendered].children, sourcePath)}
      </p>
    );
  });
}

function MultiLangParagraphsError({ message, raw }) {
  return (
    <div className="not-prose my-2 rounded-sm border border-red-300 p-2 text-sm text-red-600 select-text dark:border-red-700 dark:text-red-400" role="alert">
      <p className="font-medium">{message}</p>
      {raw ? <pre className="mt-1 whitespace-pre-wrap text-xs">{raw}</pre> : null}
    </div>
  );
}
import { useMemo } from 'react';
import { useDocLanguage } from './MultiLangContext.jsx';
import { multiLangParagraphsParse } from './MultiLangParagraphData.js';

// MultiLang decides which language variant of each paragraph is shown; the
// paragraph content itself, including every link form, is rendered by the
// package renderer (config.MdxRenderer).
export function MultiLangParagraphs({ data = {}, config = {} }) {
  const languagePreferred = useDocLanguage();
  const MdxRenderer = config.MdxRenderer;
  const result = useMemo(
    () => multiLangParagraphsParse(data.raw ?? '', data.languages),
    [data.languages, data.raw],
  );

  if (!MdxRenderer) return <MultiLangParagraphsError message="MultiLang requires config.MdxRenderer." />;
  if (result.error) return <MultiLangParagraphsError message={result.error} raw={data.raw} />;

  return result.groupList.map((group, index) => {
    const languageRendered = group[languagePreferred] ? languagePreferred : result.languageList[0];
    return (
      <p key={index} lang={languageRendered}>
        <MdxRenderer
          data={{ nodeList: group[languageRendered].children }}
          config={{ contentMode: 'inline', sourcePath: config.sourcePath }}
        />
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

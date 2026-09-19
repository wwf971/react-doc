import { useMemo } from 'react';
import { useDocLanguage } from './MultiLangContext.jsx';
import { multiLangListParse } from './MultiLangListData.js';
import { multiLangInlineNodeListRender } from './MultiLangMarkdownInline.jsx';

export function MultiLangList({ data = {}, sourcePath = '' }) {
  const languagePreferred = useDocLanguage();
  const result = useMemo(
    () => multiLangListParse(data.raw ?? '', data.languages),
    [data.languages, data.raw],
  );

  if (result.error) return <MultiLangListError message={result.error} raw={data.raw} />;
  return (
    <MultiLangListNode
      languageList={result.languageList}
      languagePreferred={languagePreferred}
      list={result.list}
      sourcePath={sourcePath}
    />
  );
}

function MultiLangListNode({ languageList, languagePreferred, list, sourcePath }) {
  const ListTag = list.ordered ? 'ol' : 'ul';
  const groupList = [];
  for (let index = 0; index < list.children.length; index += languageList.length) {
    groupList.push(list.children.slice(index, index + languageList.length));
  }
  return (
    <ListTag start={list.ordered ? list.start ?? undefined : undefined}>
      {groupList.map((itemList, index) => {
        const languageIndex = Math.max(0, languageList.indexOf(languagePreferred));
        const languageRendered = languageList[languageIndex];
        const item = itemList[languageIndex];
        const paragraph = item.children.find((child) => child.type === 'paragraph');
        const listNested = itemList.flatMap((itemVariant) => (
          itemVariant.children.filter((child) => child.type === 'list')
        ));
        return (
          <li key={index} lang={languageRendered}>
            {multiLangInlineNodeListRender(paragraph.children, sourcePath)}
            {listNested.map((child, childIndex) => (
              <MultiLangListNode
                key={childIndex}
                languageList={languageList}
                languagePreferred={languagePreferred}
                list={child}
                sourcePath={sourcePath}
              />
            ))}
          </li>
        );
      })}
    </ListTag>
  );
}

function MultiLangListError({ message, raw }) {
  return (
    <div className="not-prose my-2 rounded-sm border border-red-300 p-2 text-sm text-red-600 select-text dark:border-red-700 dark:text-red-400" role="alert">
      <p className="font-medium">{message}</p>
      {raw ? <pre className="mt-1 whitespace-pre-wrap text-xs">{raw}</pre> : null}
    </div>
  );
}
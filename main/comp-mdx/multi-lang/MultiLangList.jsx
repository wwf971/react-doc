import { useMemo } from 'react';
import { useDocLanguage } from './MultiLangContext.jsx';
import { multiLangListParse } from './MultiLangListData.js';

// MultiLang decides which language variant of each item is shown; the item
// text, including every link form, is rendered by the package renderer
// (config.MdxRenderer).
export function MultiLangList({ data = {}, config = {} }) {
  const languagePreferred = useDocLanguage();
  const result = useMemo(
    () => multiLangListParse(data.raw ?? '', data.languages),
    [data.languages, data.raw],
  );

  if (!config.MdxRenderer) return <MultiLangListError message="MultiLang requires config.MdxRenderer." />;
  if (result.error) return <MultiLangListError message={result.error} raw={data.raw} />;
  return (
    <MultiLangListNode
      config={config}
      languageList={result.languageList}
      languagePreferred={languagePreferred}
      list={result.list}
    />
  );
}

function MultiLangListNode({ config, languageList, languagePreferred, list }) {
  const MdxRenderer = config.MdxRenderer;
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
            <MdxRenderer
              data={{ nodeList: paragraph.children }}
              config={{ contentMode: 'inline', sourcePath: config.sourcePath }}
            />
            {listNested.map((child, childIndex) => (
              <MultiLangListNode
                key={childIndex}
                config={config}
                languageList={languageList}
                languagePreferred={languagePreferred}
                list={child}
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

import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../main/frontend/src/store/context.js';

// Demo component: every config key resolved for one document, with the level
// that decided each value, read from the config service (DocConfigStore).
//   data.docPath   document to inspect; defaults to the document containing it
export const DocConfigDemo = observer(function DocConfigDemo({ data = {}, config = {} }) {
  const { configStore } = useDocStores();
  const docPath = String(data.docPath ?? config.sourcePath ?? '');
  const configService = configStore.configService;
  const configResolved = configService.configDocGet(docPath);
  return (
    <div className="not-prose my-2 text-sm">
      <div className="font-mono text-xs text-fd-muted-foreground select-text">{docPath}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-fd-border text-left">
            <th className="py-1 pr-2 font-medium">key</th>
            <th className="py-1 pr-2 font-medium">scope</th>
            <th className="py-1 pr-2 font-medium">value</th>
            <th className="py-1 font-medium">decided by</th>
          </tr>
        </thead>
        <tbody>
          {configService.configDefineListGet().map((define) => (
            <tr key={define.key} className="border-b border-fd-border">
              <td className="py-1 pr-2 font-mono select-text">{define.key}</td>
              <td className="py-1 pr-2">{define.scope}</td>
              <td className="py-1 pr-2 font-mono select-text">{JSON.stringify(configResolved[define.key])}</td>
              <td className="py-1">{configService.levelDocGet(docPath, define.key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

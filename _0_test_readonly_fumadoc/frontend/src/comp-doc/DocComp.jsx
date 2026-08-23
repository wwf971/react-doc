import { useDocStores } from '../store/context.js';
import { compById } from './registry.js';

// bridge for comment-marked blocks (see remark-comment-comp):
// looks up the tag in config compRegistry, then renders the registered
// component with the raw block text plus parsed key=value props.
export function DocComp({ comp, raw, lang, propsJson }) {
  const { sourceStore } = useDocStores();
  const compId = sourceStore.configDoc.compRegistry?.[comp];
  const Comp = compId ? compById[compId] : undefined;

  if (!Comp) {
    return (
      <div className="border border-red-300 dark:border-red-700 rounded-sm p-2 text-sm select-text">
        <p className="text-red-600 dark:text-red-400 font-medium">
          unknown doc component: {comp}
        </p>
        <pre className="whitespace-pre-wrap">{raw}</pre>
      </div>
    );
  }

  const props = propsJson ? JSON.parse(propsJson) : {};
  return <Comp raw={raw} lang={lang} {...props} />;
}

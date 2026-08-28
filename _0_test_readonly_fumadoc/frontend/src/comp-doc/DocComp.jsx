import { RegisteredComp } from './RegisteredComp.jsx';

// bridge for comment-marked blocks (see remark-comment-comp):
// looks up the tag in config compRegistry, then renders the registered
// component with the raw block text plus parsed key=value props.
export function DocComp({ comp, compDefinition, compId, raw, lang, propsJson, sourceOffset }) {
  const propsAuthored = propsJson ? JSON.parse(propsJson) : {};
  return (
    <RegisteredComp
      compDefinition={compDefinition}
      compId={compId}
      compName={comp}
      configRuntime={sourceOffset === undefined ? {} : { instanceId: `${comp}:${sourceOffset}` }}
      input={{ lang, propsAuthored, raw }}
      placement="commentBlock"
    />
  );
}

import { RegisteredComp } from './RegisteredComp.jsx';

// bridge for comment-marked blocks (see remark-comment-comp):
// looks up the tag in config compRegistry, then renders the registered
// component with the raw block text plus parsed key=value props.
export function DocComp({ comp, compDefinition, compId, raw, lang, propsJson, sourceOffset, sourcePath }) {
  const propsAuthored = propsJson ? JSON.parse(propsJson) : {};
  const configRuntime = {};
  if (sourceOffset !== undefined) configRuntime.instanceId = `${comp}:${sourceOffset}`;
  if (sourcePath !== undefined) configRuntime.sourcePath = sourcePath;
  return (
    <RegisteredComp
      compDefinition={compDefinition}
      compId={compId}
      compName={comp}
      configRuntime={configRuntime}
      input={{ lang, propsAuthored, raw }}
      placement="commentBlock"
    />
  );
}

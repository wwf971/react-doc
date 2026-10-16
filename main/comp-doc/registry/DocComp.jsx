import { RegisteredComp } from './RegisteredComp.jsx';

// bridge for comment-marked blocks (see remark-comment-comp):
// looks up the tag in config compRegistry, then renders the registered
// component with the raw block text plus parsed key=value props.
// isInline: the comment marked inline code inside text (placement
// commentInline) instead of a block (placement commentBlock).
// sourceLine: the line of a block's marker comment, counted in the content
// without frontmatter; a block placement only.
export function DocComp({ comp, compDefinition, compId, isInline, raw, lang, propsJson, sourceLine, sourceOffset, sourcePath }) {
  const propsAuthored = propsJson ? JSON.parse(propsJson) : {};
  const configRuntime = {};
  if (sourceOffset !== undefined) configRuntime.instanceId = `${comp}:${sourceOffset}`;
  if (sourcePath !== undefined) configRuntime.sourcePath = sourcePath;
  if (sourceLine) configRuntime.sourceLine = Number(sourceLine);
  return (
    <RegisteredComp
      compDefinition={compDefinition}
      compId={compId}
      compName={comp}
      configRuntime={configRuntime}
      input={{ lang, propsAuthored, raw }}
      placement={isInline === 'true' ? 'commentInline' : 'commentBlock'}
    />
  );
}

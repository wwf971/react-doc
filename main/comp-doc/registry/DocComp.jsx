import { RegisteredComp } from './RegisteredComp.jsx';
import { useDocEditLineGet } from '../edit/DocEditDocContext.js';

// bridge for comment-marked blocks (see remark-comment-comp):
// looks up the tag in config compRegistry, then renders the registered
// component with the raw block text plus parsed key=value props.
// isInline: the comment marked inline code inside text (placement
// commentInline) instead of a block (placement commentBlock).
// sourceLine: the line of a block's marker comment, counted in the content
// without frontmatter; a block placement only. in the edit body, the line of
// the compile that made the element, read with how far its block moved since
// (useDocEditLineGet: a block moved by lines added above is not drawn again).
// place: 'listItem' for a block that is the whole text of a list item
// (remark-comment-comp.js), handed to the component as config.place.
export function DocComp({ comp, compDefinition, compId, isInline, raw, lang, place, propsJson, sourceLine, sourceOffset, sourcePath }) {
  const propsAuthored = propsJson ? JSON.parse(propsJson) : {};
  const configRuntime = {};
  if (place) configRuntime.place = place;
  if (sourceOffset !== undefined) configRuntime.instanceId = `${comp}:${sourceOffset}`;
  if (sourcePath !== undefined) configRuntime.sourcePath = sourcePath;
  const lineGet = useDocEditLineGet(sourcePath);
  if (sourceLine) configRuntime.sourceLine = Number(lineGet(sourceLine));
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

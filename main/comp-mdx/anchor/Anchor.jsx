import { anchorIdListGet } from './AnchorData.js';

// Declares fragment ids for the node that follows it, so links can point at
// that place by id while its title text changes. Registered as common/Anchor
// under the built-in name Anchor.
//
//   data.id       primary id
//   data.aliases  more ids for the same place
//
// In Markdown:  <!--renderComp=Anchor,id=configuration-->
//               <!--renderComp=Anchor,id=configuration,aliases=[config-old,setup]-->
// In MDX:       <Anchor id="configuration" />
//
// Before a heading, the comment form gives the heading itself the primary id
// at compile time (remark-anchor.js); only the aliases reach this component.
// Every id rendered here is an empty marker; navigation highlights the
// content element after it.
export function Anchor({ data = {} }) {
  const idList = anchorIdListGet(data);
  return (
    <>
      {idList.map((id) => <span key={id} id={id} aria-hidden="true" />)}
    </>
  );
}

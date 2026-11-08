import { useEffect, useId, useRef } from 'react';

// A mode whose data takes a long time to mount waits for its turn with this, once the data
// is ready: a document of several such blocks then mounts one per frame, and it is painted
// and answers between them (doc_page_impl_obj_frontend.md#reading-many-assets). Read in an
// observer. Whether the turn has come stays true once it has, so a change of the mode's
// parameters or data never mounts its content again. The turn is the block's (service.blockKey),
// not the mount's: the same block mounted again, when the document enters or leaves edit mode,
// draws in its first frame instead of showing its count and its smaller height for a moment
export function useObjectFrontendDrawTurn(service, isReady) {
  const idMount = useId();
  const id = service.blockKey ?? idMount;
  const serviceRef = useRef(service);
  serviceRef.current = service;
  useEffect(() => {
    if (!isReady) return undefined;
    return serviceRef.current.drawTurnAsk(id);
  }, [id, isReady]);
  return service.drawTurnIs(id);
}

import { useEffect, useId, useRef } from 'react';

// A mode whose data takes a long time to mount waits for its turn with this, once the data
// is ready: a document of several such blocks then mounts one per frame, and it is painted
// and answers between them (doc_page_impl_obj_frontend.md#reading-many-assets). Read in an
// observer. Whether the turn has come stays true once it has, so a change of the mode's
// parameters or data never mounts its content again.
export function useObjectFrontendDrawTurn(service, isReady) {
  const id = useId();
  const serviceRef = useRef(service);
  serviceRef.current = service;
  useEffect(() => {
    if (!isReady) return undefined;
    return serviceRef.current.drawTurnAsk(id);
  }, [id, isReady]);
  return service.drawTurnIs(id);
}

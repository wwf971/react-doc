// The event layer of the doc page. Design: doc_page_impl_event.md
//
// A component never calls a store. It reports what the user asked for
// through onEvent(eventType, eventData); the boundary that rendered it
// (RegisteredComp) turns that into one DocEvent and hands it to the router,
// which decides who answers:
//
//   dispatch(event)
//     1. host        the application's DocPageMdx onEvent ('component:' + type)
//     2. local       the handler of the place that rendered the component
//                    (a hosted index, the tag overview popup, ...)
//     3. route       the domain route declared for the event type
//                    (navigation -> DocStore, edit -> DocEditStore, ...)
//     4. unrouted    nobody answered: { code: -2 }
//
// a stage answers by returning a result; returning undefined passes the
// event on to the next stage.
//
//   DocEvent        { type, data, source: { compId, instanceId, placement,
//                     sourcePath, blockIndex, itemId }, time }
//   DocEventResult  { code, data, message }
//                     code 0 accepted, -1 rejected or failed, -2 unrouted

export const eventCodeAccepted = 0;
export const eventCodeRejected = -1;
export const eventCodeUnrouted = -2;

export class DocEventRouter {
  constructor() {
    // [{ name, typeList, handle }], in registration order
    this.routeList = [];
    // route by event type, built from routeList
    this.routeByType = new Map();
  }

  // a domain declares the event types it answers. a type declared twice is
  // answered by the route registered last.
  routeAdd({ name, typeList, handle }) {
    const route = { name, typeList: [...typeList], handle };
    this.routeList.push(route);
    for (const type of route.typeList) this.routeByType.set(type, route);
  }

  routeGet(type) {
    return this.routeByType.get(type);
  }

  // the event one component report becomes
  eventBuild({ type, data = {}, source = {} }) {
    return { type, data, source, time: Date.now() };
  }

  //   onEventHost    the application's handler, stage 1 (optional)
  //   onEventLocal   the handler of the rendering place, stage 2 (optional)
  async dispatch(event, { onEventHost, onEventLocal } = {}) {
    const dataForHandler = { ...event.data, ...event.source };
    const resultHost = resultNormalize(await onEventHost?.(`component:${event.type}`, dataForHandler));
    if (resultHost) return resultHost;

    const resultLocal = resultNormalize(await onEventLocal?.(event.type, dataForHandler));
    if (resultLocal) return resultLocal;

    const route = this.routeByType.get(event.type);
    if (route) {
      const resultRoute = resultNormalize(await route.handle(event));
      if (resultRoute) return resultRoute;
    }
    return { code: eventCodeUnrouted, data: undefined, message: `no handler for event ${event.type}` };
  }
}

// a handler result in the { code, data, message } form; undefined when the
// handler did not answer. { isHandled: true } is the form host applications
// returned before the event layer existed and still means "accepted".
export function resultNormalize(result) {
  if (result === undefined || result === null) return undefined;
  if (typeof result !== 'object') return undefined;
  if (typeof result.code === 'number') {
    return { code: result.code, data: result.data, message: result.message ?? '' };
  }
  if (result.isHandled === true) return { code: eventCodeAccepted, data: result.data, message: '' };
  return undefined;
}

export function eventResultIsAccepted(result) {
  return result?.code === eventCodeAccepted;
}

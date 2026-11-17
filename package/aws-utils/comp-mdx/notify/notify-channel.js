// The page's end of a notification channel (contract: doc/notify-contract.md): a WebSocket kept
// open to one service, opened with a ticket the service made for the person signed in and this
// client instance, pinged while idle, and opened again after it closes, with a wait growing with
// each failure. Generic: a service of the package hands how its ticket is asked (ticketGet); what
// its notifications mean is the caller's (the storage driver turns them into what the storage
// layer reads).
//
//   notifyChannelCreate({ label, ticketGet, onNotification, onStateChange, WebSocketClass?, timer? })
//     ticketGet()        Promise<{ code, message, data: { ticket, url, topicList, pingIntervalSec } }>:
//                        POST /notify/ticket of the service, with the token and the client instance
//     onNotification(n)  { topic, event, time, actor: { userId, clientInstanceId }, detail }
//     onStateChange(s)   { status, message, timeOpened, retryCount }
//                          connecting   a ticket asked, the socket opening
//                          open         told of changes
//                          waiting      closed, opened again after a while
//                          unsupported  the service has no channel (-3): not asked again
//                          refused      the person may not have one (-7, -8): not asked again until
//                                       the caller opens a new channel (another session)
//                          closed       closed by the caller
//   -> { open(), close(), stateGet() }

const CODE_NOT_FOUND = -3;
const CODE_AUTH_REQUIRED = -7;
const CODE_FORBIDDEN = -8;
const RETRY_DELAY_MIN_MS = 1000;
const RETRY_DELAY_MAX_MS = 60000;
const PING_INTERVAL_DEFAULT_SEC = 300;

export function notifyChannelCreate({
  label = 'the service', ticketGet, onNotification, onStateChange,
  WebSocketClass = globalThis.WebSocket, timer = { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id) },
}) {
  let state = { status: 'closed', message: '', timeOpened: 0, retryCount: 0 };
  let socket;
  let isWanted = false;
  let retryTimer;
  let pingTimer;
  let pingIntervalMs = PING_INTERVAL_DEFAULT_SEC * 1000;
  let requestCount = 0;
  // a connection begun before a close (or another open) is dropped when it comes back
  let generation = 0;

  const stateSet = (patch) => {
    state = { ...state, ...patch };
    try {
      onStateChange?.({ ...state });
    } catch (error) {
      console.error('notify channel: onStateChange failed', error);
    }
  };

  const pingStop = () => {
    if (pingTimer !== undefined) timer.clearTimeout(pingTimer);
    pingTimer = undefined;
  };
  // an idle channel is closed by the service after some minutes: a ping keeps it, and only an idle one is pinged
  const pingSchedule = () => {
    pingStop();
    pingTimer = timer.setTimeout(() => {
      if (socket && socket.readyState === 1) socket.send(JSON.stringify({ action: 'ping', requestId: `ping${++requestCount}` }));
      pingSchedule();
    }, pingIntervalMs);
  };

  const retrySchedule = (message) => {
    if (!isWanted) return;
    const retryCount = state.retryCount + 1;
    const delay = Math.min(RETRY_DELAY_MAX_MS, RETRY_DELAY_MIN_MS * 2 ** Math.min(retryCount - 1, 10));
    const delayJittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    stateSet({ status: 'waiting', message: `${message}; opened again in ${Math.round(delayJittered / 1000)} s`, retryCount });
    if (retryTimer !== undefined) timer.clearTimeout(retryTimer);
    retryTimer = timer.setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delayJittered);
  };

  const frameAccept = (text) => {
    let frame;
    try {
      frame = JSON.parse(String(text));
    } catch {
      return;
    }
    const data = frame?.data;
    // an answer (a ping, a subscription) needs nothing here; a frame of no kind is not ours
    if (frame?.code !== 0 || data?.kind !== 'notification') return;
    try {
      onNotification?.(data);
    } catch (error) {
      console.error('notify channel: onNotification failed', error);
    }
  };

  const connect = async () => {
    if (!isWanted) return;
    const generationOfRun = ++generation;
    stateSet({ status: 'connecting', message: '' });
    let ticket;
    try {
      ticket = await ticketGet();
    } catch (error) {
      ticket = { code: -9, message: String(error?.message ?? error), data: null };
    }
    if (!isWanted || generationOfRun !== generation) return;
    if (ticket?.code !== 0 || !ticket.data?.ticket || !ticket.data?.url) {
      const message = ticket?.message || `no ticket of ${label}`;
      if (ticket?.code === CODE_NOT_FOUND) {
        stateSet({ status: 'unsupported', message });
        return;
      }
      if (ticket?.code === CODE_AUTH_REQUIRED || ticket?.code === CODE_FORBIDDEN) {
        stateSet({ status: 'refused', message });
        return;
      }
      retrySchedule(message);
      return;
    }
    if (typeof WebSocketClass !== 'function') {
      stateSet({ status: 'unsupported', message: 'this browser has no WebSocket' });
      return;
    }
    pingIntervalMs = Math.max(30, Number(ticket.data.pingIntervalSec) || PING_INTERVAL_DEFAULT_SEC) * 1000;
    let socketOfRun;
    try {
      socketOfRun = new WebSocketClass(`${ticket.data.url}?ticket=${encodeURIComponent(ticket.data.ticket)}`);
    } catch (error) {
      retrySchedule(`the channel of ${label} was not opened (${String(error?.message ?? error)})`);
      return;
    }
    socket = socketOfRun;
    socketOfRun.onopen = () => {
      if (socket !== socketOfRun) return;
      stateSet({ status: 'open', message: '', timeOpened: Date.now(), retryCount: 0 });
      pingSchedule();
    };
    socketOfRun.onmessage = (messageEvent) => {
      if (socket !== socketOfRun) return;
      pingSchedule();
      frameAccept(messageEvent?.data);
    };
    socketOfRun.onclose = (closeEvent) => {
      if (socket !== socketOfRun) return;
      socket = undefined;
      pingStop();
      const wasOpen = state.status === 'open';
      // a handshake refused (the ticket expired on the way, a service down) closes without opening
      retrySchedule(wasOpen
        ? `the channel of ${label} closed${closeEvent?.code ? ` (${closeEvent.code})` : ''}`
        : `the channel of ${label} did not open`);
    };
    // an error is followed by a close, which decides
    socketOfRun.onerror = () => {};
  };

  return {
    open() {
      if (isWanted) return;
      isWanted = true;
      state = { ...state, retryCount: 0 };
      void connect();
    },
    close() {
      isWanted = false;
      generation++;
      if (retryTimer !== undefined) timer.clearTimeout(retryTimer);
      retryTimer = undefined;
      pingStop();
      const socketHeld = socket;
      socket = undefined;
      try {
        socketHeld?.close(1000);
      } catch {
        // closing what is closing already
      }
      stateSet({ status: 'closed', message: '' });
    },
    // the network back after it was lost: a channel waiting is opened now
    wake() {
      if (!isWanted || state.status !== 'waiting') return;
      if (retryTimer !== undefined) timer.clearTimeout(retryTimer);
      retryTimer = undefined;
      void connect();
    },
    stateGet: () => ({ ...state }),
  };
}

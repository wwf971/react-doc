// The client instance (design: doc_page_impl_client_instance.md): one running copy of the page
// names itself with a temporary random id, sends it to the backends that take it, and recognizes
// its own changes in what they tell back (the actor of a notification).
//
//   clientInstanceIdGet()              the id of this instance: 16 characters 0-9 a-z, drawn at the
//                                      first call, kept in memory only (never in a storage of the
//                                      browser: a duplicated tab copies sessionStorage). a reload is a
//                                      new instance
//   clientInstanceIdIs(text)           the grammar a backend accepts: [0-9a-z]{8,64}
//   clientInstanceActorIsSelf(actor)   a change whose actor is this instance
//   CLIENT_INSTANCE_HEADER             the header a request names it in, to a backend that says it
//                                      takes it (a browser refuses a request carrying a header the
//                                      CORS of its backend does not allow)
//
// It is a name, not a credential: nothing is decided by it but whether a change was this
// instance's own.

export const CLIENT_INSTANCE_HEADER = 'X-Client-Instance-Id';

const ID_LENGTH = 16;
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_REGEX = /^[0-9a-z]{8,64}$/;
// kept on globalThis: two copies of this module in one page (a package bundling its own) are one
// instance
const GLOBAL_KEY = '__reactDocClientInstance';

function idDraw() {
  const bytes = new Uint8Array(ID_LENGTH);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < ID_LENGTH; index++) bytes[index] = Math.floor(Math.random() * 256);
  // 36 does not divide 256: the bias of the modulo is a few per cent on the first letters, which a
  // name that must only differ from the names of the other instances can afford
  let id = '';
  for (const byte of bytes) id += ID_CHARS[byte % ID_CHARS.length];
  return id;
}

// { id, timeStarted }: the instance, made at the first ask
export function clientInstanceGet() {
  let held = globalThis[GLOBAL_KEY];
  if (!held || !ID_REGEX.test(String(held.id ?? ''))) {
    held = { id: idDraw(), timeStarted: Date.now() };
    try {
      Object.defineProperty(globalThis, GLOBAL_KEY, { value: held, configurable: true, enumerable: false, writable: false });
    } catch {
      globalThis[GLOBAL_KEY] = held;
    }
  }
  return held;
}

export function clientInstanceIdGet() {
  return clientInstanceGet().id;
}

export function clientInstanceIdIs(text) {
  return typeof text === 'string' && ID_REGEX.test(text);
}

// actor: { userId, clientInstanceId } of a change, as a backend tells it
export function clientInstanceActorIsSelf(actor) {
  const id = actor?.clientInstanceId;
  return typeof id === 'string' && id !== '' && id === clientInstanceIdGet();
}

// the id written short, for a person: "3k9x…"
export function clientInstanceIdShortText(id = clientInstanceIdGet()) {
  const text = String(id ?? '');
  return text.length > 6 ? `${text.slice(0, 4)}…` : text;
}

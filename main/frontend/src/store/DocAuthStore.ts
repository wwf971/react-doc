import { makeAutoObservable, observable, runInAction } from 'mobx';

// The auth service layer of the page (design: doc_page_impl_auth.md): it signs a person in
// against an identity provider, holds the sessions that succeeded, and hands a credential of a
// session to whoever has to prove who the person is: a storage point of a remote type, a
// component calling a backend. It knows no identity provider itself.
//
//   auth kind       the code of one sort of identity provider (Amazon Cognito, …): how its config
//                   reads, how a session is checked, refreshed and ended, and the component of its
//                   sign-in dialog. a package brings it (auth-kind.yaml), the plugin imports it
//   auth provider   one identity provider a person can sign in with: a frontend object whose type
//                   is the type of a kind, its config in metadata.auth of its entry
//   session         a succeeded authentication of one provider: who (identity), until when, and
//                   what the kind keeps to prove it (its tokens). kept by the browser as the
//                   person chose: this browser, this tab, or this page only
//   consumer        whoever asks a session for a credential, saying who it is: { kind, id, label }
//
// what a kind exports (its module is named by auth-kind.yaml of its package):
//
//   configRead(metadataAuth)                -> { config, message }   message '' when the config is usable
//   sessionCheck({ config, data })          -> { isUsable, identity?, timeExpire? }   of what the browser kept
//   credentialGet({ config, data, consumer }) -> Promise<{ code, message, data: { token, tokenType, timeExpire,
//                                              session?: { data, identity, timeExpire } } }>
//                                              a credential that is good now: refreshed when needed (data.session:
//                                              what the layer keeps from now on, never handed to the consumer);
//                                              code -7 when the session cannot be used
//   signOut({ config, data })               -> Promise<void>
//   signInModelCreate({ provider, authStore })   the state of one sign-in dialog (an observable model the
//                                             kind defines: its fields, its step, what is pending). it
//                                             calls authStore.signInDone(ref, { data, identity, timeExpire,
//                                             keep }) when the person is signed in
//   SignInComp                              a React component drawing that model in the dialog of the page:
//                                             ({ model, provider, authStore, reason })

export type AuthResult = { code: number; data?: any; message: string };

export type AuthIdentity = {
  // the id the identity provider gave (never the id our services key data by)
  subject: string;
  userName: string;
  name: string;
  email: string;
  // the roles the account holds, by name: what it may do beyond signing in. how a role is kept
  // is the kind's (a group of a Cognito user pool). AUTH_ROLE_ACCOUNT_ADMIN is the layer's own
  roleList: string[];
  // the id of the person in our own user table, once a backend said it ('' until then)
  userId: string;
};

export type AuthSessionKeep = 'local' | 'session' | 'memory';

export type AuthSession = {
  providerRef: string;
  kindId: string;
  status: 'signedOut' | 'signedIn' | 'expired';
  message: string;
  identity?: AuthIdentity;
  timeSignedIn: number;
  // when the credential in hand ends (ms); the kind refreshes before that while it can
  timeExpire: number;
  keep: AuthSessionKeep;
  // the kind's own: its tokens. never shown, never given to a consumer whole
  data: any;
};

export type AuthProvider = {
  ref: string;
  id: string;
  name: string;
  description: string;
  typeId: string;
  docPageAlias: string;
  kindId: string;
  kindLabel: string;
  status: 'ready' | 'loading' | 'missing' | 'kindMissing' | 'configInvalid';
  message: string;
  config: Record<string, any>;
};

export type AuthConsumer = { kind: string; id: string; label: string };

export type AuthKind = {
  id: string;
  label: string;
  description: string;
  typeId: string;
  kind: {
    configRead: (metadataAuth: any) => { config: Record<string, any>; message: string };
    sessionCheck: (input: { config: Record<string, any>; data: any }) => { isUsable: boolean; identity?: Partial<AuthIdentity>; timeExpire?: number };
    credentialGet: (input: { config: Record<string, any>; data: any; consumer: AuthConsumer; isFresh?: boolean }) => Promise<AuthResult>;
    signOut: (input: { config: Record<string, any>; data: any }) => Promise<void>;
    signInModelCreate?: (input: { provider: AuthProvider; authStore: DocAuthStore }) => any;
    SignInComp: any;
  };
};

type Stores = { objectFrontendStore: any; objectStore: any };

// not signed in (or the session ended): the code a remote backend answers too
export const AUTH_CODE_SIGN_IN_REQUIRED = -7;

const SESSION_KEY_PREFIX = 'react-doc.auth.session:';

const identityEmpty = (): AuthIdentity => ({ subject: '', userName: '', name: '', email: '', roleList: [], userId: '' });

// the one role the layer itself knows: an account holding it manages the accounts of its
// provider (issues, changes, revokes them). an account like any other, marked with this role;
// a provider may have several. what it may really do is decided by the provider's backend
export const AUTH_ROLE_ACCOUNT_ADMIN = 'account-admin';

// a credential is made anew on request at most this often (ms): many requests refused at once
// for the same missing role ask for one new credential, not one each
const CREDENTIAL_FRESH_INTERVAL = 5000;
// the layer asking for itself (sessionRefresh): not listed among the consumers of a session
const CONSUMER_LAYER: AuthConsumer = { kind: 'layer', id: 'auth', label: 'Auth layer' };

export class DocAuthStore {
  stores: Stores;
  kindById = new Map<string, AuthKind>();
  // the session of every provider asked for so far, signed out ones included
  sessionByRef = observable.map<string, AuthSession>({}, { deep: false });
  // who asked a session for a credential, by provider: what the page shows as "used by"
  consumerListByRef = observable.map<string, (AuthConsumer & { timeLast: number })[]>({}, { deep: false });
  // the sign-in dialog: one at a time. model: the state of the dialog, the kind's own
  dialog: { providerRef: string; reason: string; model: any } | undefined = undefined;
  dialogResolveList: ((isSignedIn: boolean) => void)[] = [];
  // a credential being fetched, by provider: several consumers asking at once share one refresh
  credentialPromiseByRef = new Map<string, Promise<AuthResult>>();
  // when a credential was last made anew on request, by provider (ms)
  credentialTimeFreshByRef = new Map<string, number>();
  // called after a session ended (signed out, or signed in as someone else): a consumer drops
  // what it kept for the person before
  sessionEndListenerList: ((providerRef: string) => void)[] = [];

  constructor(stores: Stores, options: { kindList?: AuthKind[] } = {}) {
    this.stores = stores;
    for (const kind of options.kindList ?? []) if (kind?.id && kind.kind && !this.kindById.has(kind.id)) this.kindById.set(kind.id, kind);
    makeAutoObservable(this, {
      stores: false,
      kindById: false,
      dialogResolveList: false,
      dialog: observable.ref,
      credentialPromiseByRef: false,
      credentialTimeFreshByRef: false,
      sessionEndListenerList: false,
    });
  }

  get kindList(): AuthKind[] {
    return [...this.kindById.values()];
  }

  // ---------- the providers ----------

  // the kind whose type an object of this type is
  private kindOfTypeGet(typeId: string): AuthKind | undefined {
    const registry = this.stores.objectStore?.typeRegistry;
    return this.kindList.find((kind) => kind.typeId === typeId || (registry?.typeGet?.(typeId) && registry.isAssignable(typeId, kind.typeId)));
  }

  // every auth provider of the page: the frontend objects whose type is the type of a kind
  get providerList(): AuthProvider[] {
    const { objectFrontendStore } = this.stores;
    const list: AuthProvider[] = [];
    for (const decl of objectFrontendStore?.declList ?? []) {
      const provider = this.providerGet(`frontend:${decl.id}`);
      if (provider.status !== 'missing' && provider.status !== 'loading') list.push(provider);
    }
    return list;
  }

  // the provider a reference names. an object still being read is 'loading'; one that is no
  // provider (no such object, or of another type) is 'missing'
  providerGet(refInput: string): AuthProvider {
    const ref = String(refInput ?? '');
    const base: AuthProvider = { ref, id: ref.replace(/^frontend:/, ''), name: '', description: '', typeId: '', docPageAlias: '', kindId: '', kindLabel: '', status: 'missing', message: '', config: {} };
    const { objectFrontendStore } = this.stores;
    if (!ref || !objectFrontendStore) return { ...base, message: ref ? 'the page has no frontend objects' : 'no auth provider is named' };
    const state = objectFrontendStore.objectGet(ref);
    if (state.status === 'loading') return { ...base, status: 'loading' };
    if (state.status !== 'found') return { ...base, message: state.message || `${ref} is no frontend object of this page` };
    const kind = this.kindOfTypeGet(state.typeId);
    const filled = { ...base, id: state.id, ref: state.ref, name: state.name, description: state.description, typeId: state.typeId, docPageAlias: state.docPageAlias };
    if (!kind) {
      const isAuthType = /(^|\.)auth(-|$)/.test(state.typeId);
      return { ...filled, status: isAuthType ? 'kindMissing' : 'missing', message: `the type ${state.typeId} of ${state.name || ref} is the type of no auth kind of this page (the package bringing the kind is not imported)` };
    }
    const { config, message } = kind.kind.configRead(state.metadata?.auth);
    return { ...filled, kindId: kind.id, kindLabel: kind.label, config, status: message ? 'configInvalid' : 'ready', message };
  }

  // ---------- the sessions ----------

  // the session of a provider: what the browser kept is read the first time it is asked
  sessionGet(ref: string): AuthSession {
    const session = this.sessionByRef.get(ref);
    if (session) return session;
    const provider = this.providerGet(ref);
    const empty = this.sessionEmptyBuild(ref, provider.kindId);
    // read later, not while rendering; a provider still loading is asked again when it is there
    if (provider.status === 'ready') queueMicrotask(() => this.sessionRestore(ref));
    return empty;
  }

  private sessionEmptyBuild(ref: string, kindId: string): AuthSession {
    return { providerRef: ref, kindId, status: 'signedOut', message: '', timeSignedIn: 0, timeExpire: 0, keep: 'memory', data: undefined };
  }

  private sessionRestore(ref: string) {
    if (this.sessionByRef.has(ref)) return;
    const provider = this.providerGet(ref);
    if (provider.status !== 'ready') return;
    const kind = this.kindById.get(provider.kindId)!;
    let session = this.sessionEmptyBuild(ref, provider.kindId);
    for (const keep of ['session', 'local'] as const) {
      const kept = keptRead(keep, ref);
      if (!kept || kept.kindId !== provider.kindId) continue;
      const check = kind.kind.sessionCheck({ config: provider.config, data: kept.data });
      if (!check.isUsable) {
        keptRemove(keep, ref);
        continue;
      }
      session = {
        ...session, status: 'signedIn', keep, data: kept.data, timeSignedIn: Number(kept.timeSignedIn) || 0,
        timeExpire: check.timeExpire ?? Number(kept.timeExpire) ?? 0,
        identity: { ...identityEmpty(), ...(kept.identity ?? {}), ...(check.identity ?? {}) },
      };
      break;
    }
    runInAction(() => {
      if (!this.sessionByRef.has(ref)) this.sessionByRef.set(ref, session);
    });
  }

  private sessionSet(session: AuthSession) {
    this.sessionByRef.set(session.providerRef, session);
    for (const keep of ['session', 'local'] as const) keptRemove(keep, session.providerRef);
    if (session.status === 'signedIn' && session.keep !== 'memory') {
      keptWrite(session.keep, session.providerRef, {
        kindId: session.kindId, data: session.data, identity: session.identity, timeSignedIn: session.timeSignedIn, timeExpire: session.timeExpire,
      });
    }
  }

  isSignedIn(ref: string): boolean {
    return this.sessionGet(ref).status === 'signedIn';
  }

  // whether the account signed in to a provider holds a role: for what a page shows (an account
  // console, a button). never a permission: the backend asked decides again
  sessionRoleHas(ref: string, role: string): boolean {
    const session = this.sessionGet(ref);
    return session.status === 'signedIn' && (session.identity?.roleList ?? []).includes(role);
  }

  // a sign-in the kind's dialog reports: the session of the provider from now on
  signInDone(ref: string, input: { data: any; identity?: Partial<AuthIdentity>; timeExpire?: number; keep?: AuthSessionKeep }) {
    const provider = this.providerGet(ref);
    const subjectBefore = this.sessionByRef.get(ref)?.identity?.subject ?? '';
    const identity = { ...identityEmpty(), ...(input.identity ?? {}) };
    this.sessionSet({
      providerRef: ref, kindId: provider.kindId, status: 'signedIn', message: '', identity,
      timeSignedIn: Date.now(), timeExpire: input.timeExpire ?? 0, keep: input.keep ?? 'session', data: input.data,
    });
    // another person than before: what consumers kept of the one before goes
    if (subjectBefore && subjectBefore !== identity.subject) this.sessionEndNotify(ref);
    if (this.dialog?.providerRef === ref) this.dialogResolve(true);
  }

  // what a backend told about the person (the user id of our own user table, a name)
  identitySet(ref: string, patch: Partial<AuthIdentity>) {
    const session = this.sessionByRef.get(ref);
    if (!session || session.status !== 'signedIn') return;
    const identity = { ...identityEmpty(), ...(session.identity ?? {}), ...patch };
    if (JSON.stringify(identity) === JSON.stringify(session.identity)) return;
    this.sessionSet({ ...session, identity });
  }

  async signOut(ref: string): Promise<void> {
    const session = this.sessionByRef.get(ref);
    const provider = this.providerGet(ref);
    runInAction(() => {
      this.sessionSet(this.sessionEmptyBuild(ref, provider.kindId));
      this.consumerListByRef.delete(ref);
    });
    this.sessionEndNotify(ref);
    const kind = this.kindById.get(provider.kindId);
    if (session?.data && kind) {
      // the tokens are revoked at the provider too; the page is signed out whatever it answers
      try {
        await kind.kind.signOut({ config: provider.config, data: session.data });
      } catch {
        // the session is gone from this browser already
      }
    }
  }

  sessionEndListen(listener: (providerRef: string) => void): () => void {
    this.sessionEndListenerList.push(listener);
    return () => {
      this.sessionEndListenerList = this.sessionEndListenerList.filter((one) => one !== listener);
    };
  }

  private sessionEndNotify(ref: string) {
    for (const listener of [...this.sessionEndListenerList]) {
      try {
        listener(ref);
      } catch (error) {
        console.error('[doc-auth] a session end listener failed', error);
      }
    }
  }

  // ---------- the sign-in dialog ----------

  // opens the dialog of the provider's kind; resolves true once the person is signed in, false
  // when the dialog was closed. reason: one line shown in the dialog, why it opened
  signInOpen(ref: string, options: { reason?: string } = {}): Promise<boolean> {
    const provider = this.providerGet(ref);
    if (provider.status !== 'ready') return Promise.resolve(false);
    if (this.dialog && this.dialog.providerRef !== ref) this.dialogResolve(false);
    const kind = this.kindById.get(provider.kindId);
    if (!this.dialog) this.dialog = { providerRef: ref, reason: options.reason ?? '', model: kind?.kind.signInModelCreate?.({ provider, authStore: this }) };
    return new Promise((resolve) => {
      this.dialogResolveList.push(resolve);
    });
  }

  dialogClose() {
    this.dialogResolve(false);
  }

  private dialogResolve(isSignedIn: boolean) {
    this.dialog = undefined;
    const resolveList = this.dialogResolveList;
    this.dialogResolveList = [];
    for (const resolve of resolveList) resolve(isSignedIn);
  }

  // ---------- credentials for consumers ----------

  // a credential of the session of a provider, good now: { token, tokenType, timeExpire }. it
  // never opens a dialog: a consumer that gets -7 says so, and a person decides to sign in.
  // (which consumer may use which session is not decided here yet: every consumer of the page
  // may; the consumer is named so that a policy has what it needs,
  // doc_page_impl_TODO.md#auth-consumer-policy)
  //   isFresh   the kind makes the credential anew whatever time the one in hand has left: what
  //             a backend reads from it (the roles of the account) is then of now. asked when a
  //             backend refused for want of a role, or after the roles of the account changed.
  //             not more often than every CREDENTIAL_FRESH_INTERVAL: in between, the one in hand
  credentialGet(ref: string, options: { consumer: AuthConsumer; isFresh?: boolean }): Promise<AuthResult> {
    const provider = this.providerGet(ref);
    if (provider.status === 'loading') return Promise.resolve({ code: AUTH_CODE_SIGN_IN_REQUIRED, message: `the auth provider ${ref} is still being read` });
    if (provider.status !== 'ready') return Promise.resolve({ code: -1, message: provider.message || `${ref} is no auth provider` });
    if (!this.sessionByRef.has(ref)) this.sessionRestore(ref);
    const session = this.sessionByRef.get(ref);
    if (!session || session.status !== 'signedIn') {
      return Promise.resolve({ code: AUTH_CODE_SIGN_IN_REQUIRED, message: session?.status === 'expired' ? `the session of ${provider.name || ref} ended: sign in again` : `not signed in to ${provider.name || ref}` });
    }
    this.consumerNote(ref, options.consumer);
    const timeFreshLast = this.credentialTimeFreshByRef.get(ref) ?? 0;
    const isFresh = options.isFresh === true && Date.now() - timeFreshLast > CREDENTIAL_FRESH_INTERVAL;
    const pending = this.credentialPromiseByRef.get(ref);
    if (pending && !isFresh) return pending;
    // a fresh one asked while another is being fetched: made after it, from the session it leaves
    if (pending) return pending.then(() => this.credentialGet(ref, options));
    if (isFresh) this.credentialTimeFreshByRef.set(ref, Date.now());
    const kind = this.kindById.get(provider.kindId)!;
    const promise = kind.kind.credentialGet({ config: provider.config, data: session.data, consumer: options.consumer, isFresh }).then((result) => {
      runInAction(() => {
        const sessionNow = this.sessionByRef.get(ref);
        if (!sessionNow || sessionNow.data !== session.data) return;
        const sessionNext = result.code === 0 ? result.data?.session : undefined;
        if (result.code === AUTH_CODE_SIGN_IN_REQUIRED) {
          this.sessionSet({ ...sessionNow, status: 'expired', message: result.message, data: undefined });
        } else if (sessionNext) {
          this.sessionSet({
            ...sessionNow,
            data: sessionNext.data ?? sessionNow.data,
            timeExpire: sessionNext.timeExpire ?? sessionNow.timeExpire,
            identity: { ...identityEmpty(), ...(sessionNow.identity ?? {}), ...(sessionNext.identity ?? {}) },
          });
        }
      });
      // the consumer gets the credential; what the kind keeps of the session stays with the layer
      if (result.code !== 0 || !result.data) return { code: result.code, message: result.message };
      const { session: _session, ...credential } = result.data;
      return { code: 0, message: result.message ?? '', data: credential };
    }).catch((error) => ({ code: -1, message: `the credential of ${provider.name || ref} could not be read: ${String(error?.message ?? error)}` })).finally(() => {
      this.credentialPromiseByRef.delete(ref);
    });
    this.credentialPromiseByRef.set(ref, promise);
    return promise;
  }

  // the session of a provider read anew from the identity provider: its credential, and with it
  // what the session says of the account (its roles). for whoever just changed the account
  // signed in: Promise<{ code, message }>
  async sessionRefresh(ref: string): Promise<AuthResult> {
    this.credentialTimeFreshByRef.delete(ref);
    const result = await this.credentialGet(ref, { consumer: CONSUMER_LAYER, isFresh: true });
    return { code: result.code, message: result.message };
  }

  private consumerNote(ref: string, consumer: AuthConsumer) {
    if (consumer === CONSUMER_LAYER) return;
    const list = this.consumerListByRef.get(ref) ?? [];
    const one = list.find((other) => other.kind === consumer.kind && other.id === consumer.id);
    // a consumer already noted is not written again: reading a credential must not re-render
    if (one) return;
    runInAction(() => {
      this.consumerListByRef.set(ref, [...list, { ...consumer, timeLast: Date.now() }]);
    });
  }

  consumerListGet(ref: string): (AuthConsumer & { timeLast: number })[] {
    return this.consumerListByRef.get(ref) ?? [];
  }
}

// ---------- what the browser keeps of a session ----------

function storageGet(keep: 'local' | 'session'): Storage | undefined {
  try {
    return keep === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function keptRead(keep: 'local' | 'session', ref: string): any | undefined {
  try {
    const text = storageGet(keep)?.getItem(`${SESSION_KEY_PREFIX}${ref}`);
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function keptWrite(keep: 'local' | 'session', ref: string, value: any) {
  try {
    storageGet(keep)?.setItem(`${SESSION_KEY_PREFIX}${ref}`, JSON.stringify(value));
  } catch {
    // a browser refusing storage: the session lasts while the page is open
  }
}

function keptRemove(keep: 'local' | 'session', ref: string) {
  try {
    storageGet(keep)?.removeItem(`${SESSION_KEY_PREFIX}${ref}`);
  } catch {
    // nothing kept
  }
}

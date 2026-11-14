import { makeAutoObservable, runInAction } from 'mobx';
import { AUTH_ROLE_ACCOUNT_ADMIN } from '../../../../main/frontend/src/store/DocAuthStore.ts';
import { accountAdminGet, accountAdminPost, accountMeGet } from './account-api.js';
import { cognitoMfaBegin, cognitoMfaConfirm, cognitoMfaUriBuild, cognitoPasswordChange, cognitoUserGet } from './cognito-api.js';

// The state of the modes of one Cognito auth provider (AwsAuthSession, AwsAuthAdmin): what the
// account service and the user pool say of the person signed in, the dialogs of the password and
// of the authenticator app, and the console of the account admin. One model per provider, shared
// by every block showing it; the components render it and ask it for every change (contract:
// doc/auth-contract.md).
//
//   me         the person as our services know them (GET /me), and what the pool says of MFA
//   password   the dialog changing the password
//   mfa        the dialog turning on the authenticator app: the secret, the code typed
//   admin      the console: users, requests, roles (the groups of the pool), the user chosen, the
//              form open, the question open

const CONSUMER = { kind: 'component', id: 'aws-utils.account', label: 'Account service' };

const formEmpty = () => ({ kind: '', userId: '', requestId: '', userName: '', email: '', name: '', groupList: [], isPending: false, message: '' });

export class AuthAccountModel {
  authStore;
  providerRef;
  me = { status: 'idle', message: '', user: undefined, isMfaEnabled: undefined };
  password = { isOpen: false, before: '', next: '', repeat: '', isPending: false, message: '', isError: false };
  mfa = { isOpen: false, status: 'idle', secret: '', uri: '', code: '', isPending: false, message: '', isError: false };
  admin = {
    status: 'idle', reason: '', message: '', userList: [], requestList: [], groupList: [],
    userIdSelected: '', confirm: '', action: { status: 'idle', message: '', isError: false }, form: formEmpty(),
  };
  // the person the state above was read for: read again when another one signs in
  subjectLoaded = '';

  constructor({ authStore, providerRef }) {
    this.authStore = authStore;
    this.providerRef = providerRef;
    makeAutoObservable(this, { authStore: false, providerRef: false });
  }

  get provider() {
    return this.authStore.providerGet(this.providerRef);
  }

  get config() {
    return this.provider.config;
  }

  get session() {
    return this.authStore.sessionGet(this.providerRef);
  }

  get isSignedIn() {
    return this.session.status === 'signedIn';
  }

  get isAccountServiceNamed() {
    return Boolean(this.config.accountApiUrl);
  }

  async tokenGet() {
    return this.authStore.credentialGet(this.providerRef, { consumer: CONSUMER });
  }

  // the session changed (somebody signed in, or out): what was read for the person before goes
  sessionSync() {
    const subject = this.isSignedIn ? this.session.identity?.subject ?? '' : '';
    if (subject === this.subjectLoaded) return;
    this.subjectLoaded = subject;
    this.me = { status: 'idle', message: '', user: undefined, isMfaEnabled: undefined };
    this.admin = { ...this.admin, status: 'idle', reason: '', message: '', userList: [], requestList: [], groupList: [], userIdSelected: '', confirm: '', form: formEmpty() };
    if (subject) void this.meLoad();
  }

  // ---------- the person signed in ----------

  async meLoad() {
    if (!this.isSignedIn) return;
    this.me = { ...this.me, status: 'loading', message: '' };
    const credential = await this.tokenGet();
    if (credential.code !== 0) {
      runInAction(() => { this.me = { ...this.me, status: 'error', message: credential.message }; });
      return;
    }
    const token = credential.data.token;
    // the pool says whether the authenticator app is on; the account service who the person is to our services
    const [userOfPool, meResult] = await Promise.all([
      cognitoUserGet(this.config, token),
      this.isAccountServiceNamed ? accountMeGet(this.config, token) : Promise.resolve({ code: 0, data: { user: undefined }, message: '' }),
    ]);
    runInAction(() => {
      const user = meResult.code === 0 ? meResult.data?.user : undefined;
      this.me = {
        status: meResult.code === 0 ? 'done' : 'error',
        message: meResult.code === 0 ? '' : meResult.message,
        user,
        isMfaEnabled: userOfPool.code === 0 ? userOfPool.data.isMfaEnabled : user?.isMfaEnabled,
      };
      if (user?.userId) this.authStore.identitySet(this.providerRef, { userId: user.userId, ...(user.name ? { name: user.name } : {}), ...(user.email ? { email: user.email } : {}) });
    });
  }

  // ---------- the password ----------

  passwordOpen() {
    this.password = { isOpen: true, before: '', next: '', repeat: '', isPending: false, message: '', isError: false };
  }

  passwordClose() {
    this.password = { ...this.password, isOpen: false, before: '', next: '', repeat: '' };
  }

  passwordFieldSet(key, value) {
    this.password = { ...this.password, [key]: value };
  }

  async passwordSubmit() {
    const { before, next, repeat } = this.password;
    if (!before || !next) {
      this.password = { ...this.password, message: 'Type the password in use and the new one.', isError: true };
      return;
    }
    if (next !== repeat) {
      this.password = { ...this.password, message: 'The two new passwords are not the same.', isError: true };
      return;
    }
    this.password = { ...this.password, isPending: true, message: '', isError: false };
    const credential = await this.tokenGet();
    const result = credential.code === 0 ? await cognitoPasswordChange(this.config, credential.data.token, before, next) : credential;
    runInAction(() => {
      this.password = result.code === 0
        ? { isOpen: true, before: '', next: '', repeat: '', isPending: false, message: 'The password was changed.', isError: false }
        : { ...this.password, isPending: false, message: result.message, isError: true };
    });
  }

  // the session read anew from the identity provider, and what the account service says of the
  // person after it: after a change to the account signed in
  async sessionRenew() {
    const result = await this.authStore.sessionRefresh(this.providerRef);
    await this.meLoad();
    return result;
  }

  // ---------- the authenticator app ----------

  async mfaOpen() {
    this.mfa = { isOpen: true, status: 'loading', secret: '', uri: '', code: '', isPending: false, message: '', isError: false };
    const credential = await this.tokenGet();
    const result = credential.code === 0 ? await cognitoMfaBegin(this.config, credential.data.token) : credential;
    runInAction(() => {
      if (result.code !== 0) {
        this.mfa = { ...this.mfa, status: 'error', message: result.message, isError: true };
        return;
      }
      const userName = this.session.identity?.userName || this.session.identity?.email || 'account';
      this.mfa = { ...this.mfa, status: 'ready', secret: result.data.secret, uri: cognitoMfaUriBuild(result.data.secret, userName, this.provider.name || 'react-doc') };
    });
  }

  mfaClose() {
    this.mfa = { isOpen: false, status: 'idle', secret: '', uri: '', code: '', isPending: false, message: '', isError: false };
  }

  mfaCodeSet(code) {
    this.mfa = { ...this.mfa, code };
  }

  async mfaSubmit() {
    if (!/^\d{6}$/.test(this.mfa.code.trim())) {
      this.mfa = { ...this.mfa, message: 'The code is the 6 digits the authenticator app shows.', isError: true };
      return;
    }
    this.mfa = { ...this.mfa, isPending: true, message: '', isError: false };
    const credential = await this.tokenGet();
    const result = credential.code === 0 ? await cognitoMfaConfirm(this.config, credential.data.token, this.mfa.code.trim()) : credential;
    runInAction(() => {
      if (result.code !== 0) {
        this.mfa = { ...this.mfa, isPending: false, message: result.message, isError: true };
        return;
      }
      this.mfa = { ...this.mfa, isPending: false, status: 'done', secret: '', uri: '', code: '', message: 'The authenticator app is on: its code is asked at every sign-in from now on.' };
    });
    if (result.code === 0) {
      await this.meLoad();
      // the console was refused for want of MFA: it opens now
      if (this.admin.reason === 'mfaRequired') void this.adminLoad();
    }
  }

  // ---------- the console of the account admin ----------

  get userSelected() {
    return this.admin.userList.find((user) => user.userId === this.admin.userIdSelected);
  }

  // the users, the requests and the groups read; a refusal of the service says why the console stays closed
  async adminLoad() {
    if (!this.isSignedIn) return;
    // a session without the role is not sent to the service to be refused: the console says what
    // it needs. the service is the judge of a session that has it (the role still held, MFA on)
    if (!this.authStore.sessionRoleHas(this.providerRef, AUTH_ROLE_ACCOUNT_ADMIN)) {
      // the session says what the account was when it signed in: read anew, it carries a role
      // given since (the layer does this at most every few seconds)
      this.admin = { ...this.admin, status: 'loading', message: '', reason: '' };
      await this.authStore.credentialGet(this.providerRef, { consumer: CONSUMER, isFresh: true });
    }
    if (!this.authStore.sessionRoleHas(this.providerRef, AUTH_ROLE_ACCOUNT_ADMIN)) {
      runInAction(() => {
        this.admin = { ...this.admin, status: 'refused', reason: 'adminRequired', message: '', userList: [], requestList: [], groupList: [] };
      });
      return;
    }
    this.admin = { ...this.admin, status: 'loading', message: '', reason: '' };
    const credential = await this.tokenGet();
    if (credential.code !== 0) {
      runInAction(() => { this.admin = { ...this.admin, status: 'error', message: credential.message }; });
      return;
    }
    const token = credential.data.token;
    const [userResult, requestResult, groupResult] = await Promise.all([
      accountAdminGet(this.config, token, 'user/list'),
      accountAdminGet(this.config, token, 'request/list'),
      accountAdminGet(this.config, token, 'group/list'),
    ]);
    runInAction(() => {
      const failure = [userResult, requestResult, groupResult].find((result) => result.code !== 0);
      if (failure) {
        this.admin = {
          ...this.admin, status: failure.code === -8 ? 'refused' : 'error', reason: failure.code === -8 ? String(failure.data?.reason ?? '') : '',
          message: failure.message, userList: [], requestList: [], groupList: [],
        };
        return;
      }
      const userList = userResult.data?.userList ?? [];
      this.admin = {
        ...this.admin, status: 'done', reason: '', message: '', userList, requestList: requestResult.data?.requestList ?? [], groupList: groupResult.data?.groupList ?? [],
        userIdSelected: userList.some((user) => user.userId === this.admin.userIdSelected) ? this.admin.userIdSelected : '',
      };
    });
  }

  // a click on a row: chosen, or not any more
  adminUserSelect(userId) {
    this.admin = { ...this.admin, userIdSelected: this.admin.userIdSelected === userId ? '' : userId, confirm: '', action: { status: 'idle', message: '', isError: false } };
  }

  // the question open in the row of the actions: 'delete', 'disable', 'mfaReset', '' none
  adminConfirmSet(confirm) {
    this.admin = { ...this.admin, confirm };
  }

  // one action on the user chosen: 'disable' | 'enable' | 'delete' | 'password/reset' | 'session/revoke' | 'mfa/reset'
  async adminUserAction(action, messageDone) {
    const user = this.userSelected;
    if (!user || this.admin.action.status === 'pending') return;
    this.admin = { ...this.admin, confirm: '', action: { status: 'pending', message: '', isError: false } };
    const credential = await this.tokenGet();
    const result = credential.code === 0 ? await accountAdminPost(this.config, credential.data.token, `user/${action}`, { userId: user.userId }) : credential;
    runInAction(() => {
      this.admin = { ...this.admin, action: { status: 'idle', message: result.code === 0 ? messageDone : result.message, isError: result.code !== 0 } };
      if (result.code !== 0) return;
      const userNext = result.data?.user;
      const userList = action === 'delete'
        ? this.admin.userList.filter((one) => one.userId !== user.userId)
        : this.admin.userList.map((one) => (userNext && one.userId === userNext.userId ? userNext : one));
      this.admin = { ...this.admin, userList, userIdSelected: action === 'delete' ? '' : this.admin.userIdSelected };
    });
  }

  // a form of the console opened in its dialog: 'create' a new account, 'edit' the user chosen,
  // 'approve' a request
  adminFormOpen(kind, source = {}) {
    const groupDefaultList = this.admin.groupList.filter((group) => group.isDefault).map((group) => group.name);
    const base = { ...formEmpty(), kind };
    if (kind === 'edit') this.admin = { ...this.admin, form: { ...base, userId: source.userId, userName: source.userName ?? '', email: source.email ?? '', name: source.name ?? '', groupList: [...(source.groupList ?? [])] } };
    else if (kind === 'approve') this.admin = { ...this.admin, form: { ...base, requestId: source.requestId, email: source.email ?? '', userName: source.email ?? '', name: source.name ?? '', groupList: groupDefaultList } };
    else this.admin = { ...this.admin, form: { ...base, groupList: groupDefaultList } };
  }

  adminFormClose() {
    this.admin = { ...this.admin, form: formEmpty() };
  }

  adminFormFieldSet(key, value) {
    this.admin = { ...this.admin, form: { ...this.admin.form, [key]: value } };
  }

  adminFormGroupToggle(groupName) {
    const groupList = this.admin.form.groupList.includes(groupName) ? this.admin.form.groupList.filter((one) => one !== groupName) : [...this.admin.form.groupList, groupName];
    this.adminFormFieldSet('groupList', groupList);
  }

  async adminFormSubmit() {
    const form = this.admin.form;
    if (form.isPending || !form.kind) return;
    if (form.kind === 'create' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      this.adminFormFieldSet('message', 'Type the email the invitation goes to.');
      return;
    }
    this.admin = { ...this.admin, form: { ...form, isPending: true, message: '' } };
    const credential = await this.tokenGet();
    let result = credential;
    if (credential.code === 0) {
      const token = credential.data.token;
      const userName = form.userName.trim();
      if (form.kind === 'create') {
        result = await accountAdminPost(this.config, token, 'user/create', { email: form.email.trim(), name: form.name.trim(), groupList: form.groupList, ...(userName ? { userName } : {}) });
      } else if (form.kind === 'edit') {
        result = await accountAdminPost(this.config, token, 'user/update', { userId: form.userId, name: form.name.trim(), groupList: form.groupList });
      } else {
        result = await accountAdminPost(this.config, token, 'request/approve', { requestId: form.requestId, groupList: form.groupList, ...(userName ? { userName } : {}) });
      }
    }
    runInAction(() => {
      if (result.code !== 0) {
        this.admin = { ...this.admin, form: { ...this.admin.form, isPending: false, message: result.message } };
        return;
      }
      const user = result.data?.user;
      // the account signed in was changed (its roles): its session is read anew, so the page and
      // every service asked from now on see the account as it is, without signing in again
      if (user && user.userId === this.me.user?.userId) void this.sessionRenew();
      const isKnown = user && this.admin.userList.some((one) => one.userId === user.userId);
      this.admin = {
        ...this.admin,
        form: formEmpty(),
        userList: !user ? this.admin.userList : isKnown ? this.admin.userList.map((one) => (one.userId === user.userId ? user : one)) : [...this.admin.userList, user],
        requestList: form.kind === 'approve' ? this.admin.requestList.filter((one) => one.requestId !== form.requestId) : this.admin.requestList,
        userIdSelected: user?.userId ?? this.admin.userIdSelected,
        action: { status: 'idle', isError: false, message: form.kind === 'edit' ? 'The account was changed.' : `An invitation with a temporary password was sent to ${user?.email ?? form.email}.` },
      };
    });
  }

  async adminRequestReject(requestId) {
    const credential = await this.tokenGet();
    const result = credential.code === 0 ? await accountAdminPost(this.config, credential.data.token, 'request/reject', { requestId }) : credential;
    runInAction(() => {
      this.admin = {
        ...this.admin,
        requestList: result.code === 0 ? this.admin.requestList.filter((one) => one.requestId !== requestId) : this.admin.requestList,
        action: { status: 'idle', message: result.code === 0 ? 'The request was rejected.' : result.message, isError: result.code !== 0 },
      };
    });
  }
}

// one model per provider of an auth layer, shared by every block showing that provider
const modelByStore = new WeakMap();

export function authAccountModelGet(authStore, providerRef) {
  let modelByRef = modelByStore.get(authStore);
  if (!modelByRef) {
    modelByRef = new Map();
    modelByStore.set(authStore, modelByRef);
  }
  if (!modelByRef.has(providerRef)) modelByRef.set(providerRef, new AuthAccountModel({ authStore, providerRef }));
  return modelByRef.get(providerRef);
}

import { makeAutoObservable, runInAction } from 'mobx';
import {
  cognitoChallengeAnswer, cognitoPasswordForgot, cognitoPasswordForgotConfirm, cognitoSignIn, identityOfTokensGet,
} from './cognito-api.js';
import { accountRegisterRequest } from './account-api.js';

// The state of one sign-in dialog of the kind cognito (contract: doc/auth-contract.md
// #signing-in-inside-the-page). The dialog draws it (AuthSignIn.jsx) and asks it for every step;
// when Cognito answers tokens it tells the auth layer, which closes the dialog.
//
//   step   credential        user name and password
//          passwordNew       the first sign-in of an issued account: the temporary password replaced
//          mfa               the 6 digits of the authenticator app
//          forgot            a forgotten password: the user name, to send a code to its email
//          forgotConfirm     the code and a new password
//          request           asking for an account: email, name, a note for the account admin
//          requestDone       the request was sent
export class AuthSignInModel {
  provider;
  authStore;
  step = 'credential';
  userName = '';
  password = '';
  passwordNew = '';
  passwordNewRepeat = '';
  code = '';
  email = '';
  name = '';
  note = '';
  // the session stays in this browser after it is closed (localStorage); else it lasts while this tab does
  isKept = false;
  isPending = false;
  message = '';
  isError = false;
  // the challenge Cognito asked last: { name, session, userName, parameters }
  challenge = undefined;

  constructor({ provider, authStore }) {
    this.provider = provider;
    this.authStore = authStore;
    makeAutoObservable(this, { provider: false, authStore: false });
  }

  get config() {
    return this.provider.config;
  }

  get isRequestOffered() {
    return Boolean(this.config.accountApiUrl);
  }

  fieldSet(key, value) {
    this[key] = value;
  }

  stepSet(step) {
    this.step = step;
    this.message = '';
    this.isError = false;
    this.code = '';
    this.passwordNew = '';
    this.passwordNewRepeat = '';
  }

  messageSet(message, isError = false) {
    this.message = message;
    this.isError = isError;
  }

  // the two new passwords agree and are not empty: '' when they do, else what is wrong
  get passwordNewProblem() {
    if (!this.passwordNew) return 'Type the new password.';
    if (this.passwordNew !== this.passwordNewRepeat) return 'The two passwords are not the same.';
    return '';
  }

  // the main button of the step in hand
  async submit() {
    if (this.isPending) return;
    const run = {
      credential: () => this.signIn(),
      passwordNew: () => this.passwordNewSend(),
      mfa: () => this.mfaSend(),
      forgot: () => this.forgotSend(),
      forgotConfirm: () => this.forgotConfirmSend(),
      request: () => this.requestSend(),
    }[this.step];
    if (!run) return;
    this.isPending = true;
    this.messageSet('');
    try {
      await run();
    } finally {
      runInAction(() => {
        this.isPending = false;
      });
    }
  }

  // tokens or a challenge, taken as the next step
  answerTake(result) {
    if (result.code !== 0) {
      // an account admin reset the password: the reset sent a code already, so the step asking for
      // it opens at once instead of sending a second one
      if (result.data?.errorType === 'PasswordResetRequiredException') {
        this.password = '';
        this.stepSet('forgotConfirm');
      }
      this.messageSet(result.message, result.data?.errorType !== 'PasswordResetRequiredException');
      return;
    }
    if (result.data.tokens) {
      const tokens = result.data.tokens;
      this.password = '';
      this.authStore.signInDone(this.provider.ref, {
        data: tokens, identity: identityOfTokensGet(tokens), timeExpire: tokens.timeExpire, keep: this.isKept ? 'local' : 'session',
      });
      return;
    }
    const challenge = result.data.challenge;
    this.challenge = challenge;
    if (challenge.name === 'NEW_PASSWORD_REQUIRED') this.stepSet('passwordNew');
    else if (challenge.name === 'SOFTWARE_TOKEN_MFA') this.stepSet('mfa');
    else this.messageSet(`Cognito asks for a step this page does not offer (${challenge.name}).`, true);
  }

  async signIn() {
    if (!this.userName.trim() || !this.password) {
      this.messageSet('Type the user name and the password.', true);
      return;
    }
    const result = await cognitoSignIn(this.config, this.userName.trim(), this.password);
    runInAction(() => this.answerTake(result));
  }

  async passwordNewSend() {
    if (this.passwordNewProblem) {
      this.messageSet(this.passwordNewProblem, true);
      return;
    }
    const result = await cognitoChallengeAnswer(this.config, this.challenge, { NEW_PASSWORD: this.passwordNew });
    runInAction(() => this.answerTake(result));
  }

  async mfaSend() {
    if (!/^\d{6}$/.test(this.code.trim())) {
      this.messageSet('The code is the 6 digits the authenticator app shows.', true);
      return;
    }
    const result = await cognitoChallengeAnswer(this.config, this.challenge, { SOFTWARE_TOKEN_MFA_CODE: this.code.trim() });
    runInAction(() => this.answerTake(result));
  }

  async forgotSend() {
    if (!this.userName.trim()) {
      this.messageSet('Type the user name of the account.', true);
      return;
    }
    const result = await cognitoPasswordForgot(this.config, this.userName.trim());
    runInAction(() => {
      if (result.code !== 0) this.messageSet(result.message, true);
      else {
        this.stepSet('forgotConfirm');
        this.messageSet('A code was sent to the email of the account.');
      }
    });
  }

  async forgotConfirmSend() {
    if (!this.code.trim()) {
      this.messageSet('Type the code of the email.', true);
      return;
    }
    if (this.passwordNewProblem) {
      this.messageSet(this.passwordNewProblem, true);
      return;
    }
    const result = await cognitoPasswordForgotConfirm(this.config, this.userName.trim(), this.code.trim(), this.passwordNew);
    runInAction(() => {
      if (result.code !== 0) this.messageSet(result.message, true);
      else {
        this.password = '';
        this.stepSet('credential');
        this.messageSet('The password was changed: sign in with it.');
      }
    });
  }

  async requestSend() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim())) {
      this.messageSet('Type the email the account is for.', true);
      return;
    }
    const result = await accountRegisterRequest(this.config, { email: this.email.trim(), name: this.name.trim(), note: this.note.trim() });
    runInAction(() => {
      if (result.code !== 0) this.messageSet(result.message, true);
      else this.stepSet('requestDone');
    });
  }
}

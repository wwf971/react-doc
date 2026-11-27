import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { AuthSessionLine } from '../../../../main/comp-doc/auth/AuthSessionLine.jsx';
import { PanelPopup } from '../../../../main/comp-doc/popup/PanelPopup.jsx';
import { authAccountModelGet } from './AuthAccountModel.js';
import { qrCodeSvgBuild } from './qr-code.js';
import './AwsAuth.css';

// The mode "session" of a Cognito auth provider (doc/README.md#the-auth-provider): who is signed
// in to it on this browser, what the account service knows of them, and the things a person does
// with their own account: signing in and out, the password, the authenticator app, asking for an
// account. It changes no asset of the object, so it reads the same whether its document is read
// or edited. Its state is the model of the provider (AuthAccountModel).
export const AwsAuthSession = observer(function AwsAuthSession({ config = {} }) {
  const service = config.objectFrontend;
  const { authStore } = useDocStores();
  if (!service) return <p className="doc-error">AwsAuthSession is a mode of a Cognito auth provider (ObjectFrontend).</p>;
  if (!authStore) return <p className="doc-error">The page has no auth layer.</p>;
  return <AwsAuthSessionBody authStore={authStore} providerRef={service.ref} />;
});

const AwsAuthSessionBody = observer(function AwsAuthSessionBody({ authStore, providerRef }) {
  const provider = authStore.providerGet(providerRef);
  const model = authAccountModelGet(authStore, providerRef);
  const session = authStore.sessionGet(providerRef);
  const subject = session.status === 'signedIn' ? session.identity?.subject ?? '' : '';
  useEffect(() => {
    model.sessionSync();
  }, [model, subject]);

  if (provider.status === 'loading') return <p className="doc-status">Reading the auth provider</p>;
  if (provider.status !== 'ready') return <p className="doc-error">{provider.name || providerRef}: {provider.message}</p>;
  const { config: providerConfig } = provider;
  const consumerList = authStore.consumerListGet(providerRef);
  return (
    <div className="aws-auth">
      <div className="aws-auth-head">
        <AuthSessionLine providerRef={providerRef} />
      </div>
      <div className="aws-auth-fact-list">
        <AwsAuthFact label="Identity provider" value={`${provider.kindLabel} · ${providerConfig.userPoolId}`} />
        <AwsAuthFact label="Account service" value={providerConfig.accountApiUrl || 'not named (metadata.auth.accountApiUrl): accounts are managed elsewhere'} />
      </div>
      {session.status === 'signedIn' ? (
        <AwsAuthMe model={model} session={session} consumerList={consumerList} />
      ) : (
        <div className="aws-auth-section">
          <div className="aws-auth-note">
            Sign in to use what stands behind this provider. Without an account, ask for one: an account admin approves the request,
            and a user name with a temporary password arrives by email.
          </div>
          {providerConfig.accountApiUrl ? (
            <div className="aws-auth-button-row">
              <button
                type="button"
                className="doc-button"
                onClick={() => {
                  void authStore.signInOpen(providerRef);
                  authStore.dialog?.model?.stepSet('request');
                }}
              >
                Ask for an account…
              </button>
            </div>
          ) : null}
        </div>
      )}
      <AwsAuthPasswordPopup model={model} />
      <AwsAuthMfaPopup model={model} owner="session" />
    </div>
  );
});

// what the account service and the user pool say of the person signed in, and what they can change
const AwsAuthMe = observer(function AwsAuthMe({ model, session, consumerList }) {
  const { me } = model;
  const user = me.user;
  const identity = session.identity ?? {};
  // the roles the session carries: what a service reads from its credential. the account
  // service may know of a role given since; Read again brings the session up to it
  const roleList = identity.roleList ?? user?.groupList ?? [];
  const isMfaEnabled = me.isMfaEnabled;
  // what the services make of this session under the MFA requirement of the account (GET /me)
  const mfaAccess = user?.mfaAccess ?? 'ok';
  const mfaText = isMfaEnabled === undefined ? 'reading' : isMfaEnabled ? 'on: its code is asked at every sign-in' : 'off';
  return (
    <div className="aws-auth-section">
      <div className="aws-auth-fact-list">
        <AwsAuthFact label="User name" value={user?.userName || identity.userName || '—'} />
        <AwsAuthFact label="Name" value={user?.name || identity.name || '—'} />
        <AwsAuthFact label="Email" value={user?.email || identity.email || '—'} />
        <AwsAuthFact label="User id" value={user?.userId || identity.userId || (me.status === 'loading' ? 'reading' : '—')} title="The id our services keep data under: it stays when another identity is linked to the person" isFigure />
        <AwsAuthFact label="Roles" value={roleList.length > 0 ? roleList.join(', ') : 'none'} />
        <AwsAuthFact label="Authenticator app" value={user?.isMfaRequired ? `${mfaText}; required by your account admin` : mfaText} />
        <AwsAuthFact label="Session kept" value={session.keep === 'local' ? 'on this browser, until signing out' : 'while this tab is open'} />
        <AwsAuthFact label="Used by" value={consumerList.length > 0 ? consumerList.map((one) => one.label).join(', ') : 'nothing on this page yet'} title="Whoever asked this session for a credential on this page" />
      </div>
      {mfaAccess !== 'ok' ? (
        <div className="doc-auth-reason" role="status">
          {mfaAccess === 'setupRequired'
            ? 'Your account admin requires an authenticator app of this account: our services refuse it until the app is on. Turn it on below, then sign in again with its code.'
            : 'This session began before your account could pass MFA (before the requirement, or before its app was turned on): our services refuse it. Sign in again, with the code of the app.'}
        </div>
      ) : null}
      <div className="aws-auth-message" {...(me.status === 'error' ? { 'data-error': true } : {})}>{me.status === 'error' ? me.message : ''}</div>
      <div className="aws-auth-button-row">
        {mfaAccess === 'signInRequired' ? <button type="button" className="doc-button" data-primary onClick={() => void model.signInAgain()}>Sign in again</button> : null}
        <button type="button" className="doc-button" onClick={() => model.passwordOpen()}>Change the password…</button>
        {isMfaEnabled === false ? <button type="button" className="doc-button" data-primary onClick={() => void model.mfaOpen('session')}>Turn on the authenticator app…</button> : null}
        <button type="button" className="doc-button" disabled={me.status === 'loading'} title="reads the session anew: a role given to the account since it signed in is carried from now on" onClick={() => void model.sessionRenew()}>Read again</button>
      </div>
    </div>
  );
});

export function AwsAuthFact({ label, value, title = '', isFigure = false }) {
  return (
    <div className="aws-auth-fact" title={title || undefined}>
      <span className="aws-auth-fact-label">{label}</span>
      <span className="aws-auth-fact-value" {...(isFigure ? { 'data-figure': true } : {})}>{value}</span>
    </div>
  );
}

const AwsAuthPasswordPopup = observer(function AwsAuthPasswordPopup({ model }) {
  const { password } = model;
  const fieldList = [
    { key: 'before', label: 'Password in use', autoComplete: 'current-password' },
    { key: 'next', label: 'New password', autoComplete: 'new-password' },
    { key: 'repeat', label: 'Once more', autoComplete: 'new-password' },
  ];
  return (
    <PanelPopup panelId="awsAuthPassword" title="Change the password" isOpen={password.isOpen} onClose={() => model.passwordClose()} className="doc-auth-popup" bodyClassName="doc-auth-popup-body">
      <form
        className="doc-auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          void model.passwordSubmit();
        }}
      >
        <div className="doc-auth-note">The passwords go to Amazon Cognito and nowhere else.</div>
        {fieldList.map((field) => (
          <label key={field.key} className="doc-auth-field">
            <span className="doc-auth-field-label">{field.label}</span>
            <input className="doc-auth-input" type="password" autoComplete={field.autoComplete} value={password[field.key]} onChange={(event) => model.passwordFieldSet(field.key, event.target.value)} />
          </label>
        ))}
        <div className="doc-auth-message" {...(password.isError ? { 'data-error': true } : {})}>{password.message}</div>
        <div className="doc-auth-button-row">
          <button type="submit" className="doc-button" data-primary disabled={password.isPending}>{password.isPending ? 'Working…' : 'Change the password'}</button>
          <button type="button" className="doc-button" onClick={() => model.passwordClose()}>Close</button>
        </div>
      </form>
    </PanelPopup>
  );
});

// the authenticator app turned on: the secret as a QR code and as text, then the first code of the app
export const AwsAuthMfaPopup = observer(function AwsAuthMfaPopup({ model, owner = 'session' }) {
  const { mfa } = model;
  return (
    <PanelPopup panelId={`awsAuthMfa-${owner}`} title="Turn on the authenticator app" isOpen={mfa.isOpen && mfa.owner === owner} onClose={() => model.mfaClose()} className="doc-auth-popup aws-auth-mfa-popup" bodyClassName="doc-auth-popup-body">
      <form
        className="doc-auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          void model.mfaSubmit();
        }}
      >
        {mfa.status === 'done' ? null : (
          <div className="doc-auth-note">
            Scan the code with an authenticator app (Google Authenticator, 1Password, Authy …), or type the key into it. Then type the 6 digits the app shows.
            From then on the app is asked at every sign-in.
          </div>
        )}
        {mfa.status === 'loading' ? <div className="doc-auth-message">Asking for a key</div> : null}
        {mfa.status === 'ready' ? (
          <>
            <div className="doc-auth-qr" role="img" aria-label="QR code of the key" dangerouslySetInnerHTML={{ __html: qrCodeSvgBuild(mfa.uri) }} />
            <label className="doc-auth-field">
              <span className="doc-auth-field-label">Key</span>
              <span className="doc-auth-secret">{mfa.secret}</span>
            </label>
            <label className="doc-auth-field">
              <span className="doc-auth-field-label">Code of the app</span>
              <input className="doc-auth-input" data-code inputMode="numeric" maxLength={8} autoComplete="one-time-code" autoFocus value={mfa.code} onChange={(event) => model.mfaCodeSet(event.target.value)} />
            </label>
          </>
        ) : null}
        <div className="doc-auth-message" {...(mfa.isError ? { 'data-error': true } : {})}>{mfa.message}</div>
        <div className="doc-auth-button-row">
          {mfa.status === 'ready' ? <button type="submit" className="doc-button" data-primary disabled={mfa.isPending}>{mfa.isPending ? 'Working…' : 'Turn on'}</button> : null}
          <button type="button" className="doc-button" onClick={() => model.mfaClose()}>Close</button>
        </div>
      </form>
    </PanelPopup>
  );
});

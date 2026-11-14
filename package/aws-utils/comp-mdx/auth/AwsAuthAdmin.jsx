import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { AuthSessionLine } from '../../../../main/comp-doc/auth/AuthSessionLine.jsx';
import { PanelPopup } from '../../../../main/comp-doc/popup/PanelPopup.jsx';
import { timeTextDisplay } from '../../../../main/frontend/src/lib/time-text.js';
import { authAccountModelGet } from './AuthAccountModel.js';
import { AwsAuthMfaPopup } from './AwsAuthSession.jsx';
import './AwsAuth.css';

// The mode "admin" of a Cognito auth provider (doc/README.md#the-account-admin-console): the
// account console, a component a document embeds. It works with the session its auth provider
// holds, when that session is of an account admin: an account like any other, holding the role
// account-admin of the auth layer. Without one it says what it needs, and nothing else. Requests for an account are approved or rejected; accounts are
// issued, changed, disabled, enabled and deleted; a password is reset, sessions are ended, a lost
// authenticator app is turned off. Every change is a call of the account service, which decides
// who may (the group account-admin, with MFA on): this component only draws what it answers.
// Its state is the model of the provider (AuthAccountModel); forms open in dialogs.
export const AwsAuthAdmin = observer(function AwsAuthAdmin({ config = {} }) {
  const service = config.objectFrontend;
  const { authStore } = useDocStores();
  if (!service) return <p className="doc-error">AwsAuthAdmin is a mode of a Cognito auth provider (ObjectFrontend).</p>;
  if (!authStore) return <p className="doc-error">The page has no auth layer.</p>;
  return <AwsAuthAdminBody authStore={authStore} providerRef={service.ref} />;
});

const AwsAuthAdminBody = observer(function AwsAuthAdminBody({ authStore, providerRef }) {
  const provider = authStore.providerGet(providerRef);
  const model = authAccountModelGet(authStore, providerRef);
  const session = authStore.sessionGet(providerRef);
  const subject = session.status === 'signedIn' ? session.identity?.subject ?? '' : '';
  useEffect(() => {
    model.sessionSync();
    if (subject && model.admin.status === 'idle') void model.adminLoad();
  }, [model, subject]);

  if (provider.status === 'loading') return <p className="doc-status">Reading the auth provider</p>;
  if (provider.status !== 'ready') return <p className="doc-error">{provider.name || providerRef}: {provider.message}</p>;
  if (!provider.config.accountApiUrl) return <p className="doc-note">{provider.name || providerRef} names no account service (metadata.auth.accountApiUrl): there is no console.</p>;
  const { admin } = model;
  return (
    <div className="aws-auth">
      <div className="aws-auth-head">
        <AuthSessionLine providerRef={providerRef} reason="The account console is for an account admin." />
        <span className="aws-auth-head-title">Account admin console</span>
      </div>
      {session.status !== 'signedIn' ? (
        <div className="aws-auth-note">
          The account console needs the session of an account admin, and {provider.name || 'this auth provider'} holds none: nobody is signed in. Sign in with an account holding the role <b>account-admin</b>.
        </div>
      ) : null}
      {session.status === 'signedIn' && admin.status === 'loading' && admin.userList.length === 0 ? <div className="aws-auth-note">Reading the accounts</div> : null}
      {session.status === 'signedIn' && admin.status === 'refused' ? <AwsAuthAdminRefused model={model} /> : null}
      {session.status === 'signedIn' && admin.status === 'error' ? (
        <div className="aws-auth-section">
          <div className="aws-auth-message" data-error>{admin.message}</div>
          <div className="aws-auth-button-row"><button type="button" className="doc-button" onClick={() => void model.adminLoad()}>Try again</button></div>
        </div>
      ) : null}
      {session.status === 'signedIn' && (admin.status === 'done' || admin.userList.length > 0) ? <AwsAuthAdminConsole model={model} /> : null}
      <AwsAuthAdminFormPopup model={model} />
      <AwsAuthMfaPopup model={model} />
    </div>
  );
});

// why the console stays closed, with the way in where there is one
const AwsAuthAdminRefused = observer(function AwsAuthAdminRefused({ model }) {
  const { admin } = model;
  if (admin.reason === 'mfaRequired') {
    return (
      <div className="aws-auth-section">
        <div className="aws-auth-note">
          An account admin signs in with an authenticator app. Turn it on for this account to open the console: from then on its code is asked at every sign-in.
        </div>
        <div className="aws-auth-button-row">
          <button type="button" className="doc-button" data-primary onClick={() => void model.mfaOpen()}>Turn on the authenticator app…</button>
        </div>
      </div>
    );
  }
  return (
    <div className="aws-auth-section">
      <div className="aws-auth-note">
        {admin.reason === 'adminRequired'
          ? <>The account console needs the session of an account admin. The account signed in does not hold the role <b>account-admin</b>: sign in with one that does.</>
          : admin.message}
      </div>
      {admin.reason === 'adminRequired' ? (
        <div className="aws-auth-button-row">
          <button type="button" className="doc-button" title="for an account given the role just now: its session is read anew" onClick={() => void model.adminLoad()}>Read again</button>
        </div>
      ) : null}
    </div>
  );
});

const AwsAuthAdminConsole = observer(function AwsAuthAdminConsole({ model }) {
  const { admin } = model;
  const user = model.userSelected;
  const isPending = admin.action.status === 'pending';
  const subjectSelf = model.session.identity?.subject ?? '';
  const isSelf = Boolean(user) && (user.identityList ?? []).some((identity) => identity.userIdFromAuth === subjectSelf);
  return (
    <>
      <div className="aws-auth-button-row">
        <button type="button" className="doc-button" data-primary onClick={() => model.adminFormOpen('create')}>New account…</button>
        <button type="button" className="doc-button" disabled={admin.status === 'loading'} onClick={() => void model.adminLoad()}>Read again</button>
      </div>

      {admin.requestList.length > 0 ? (
        <div className="aws-auth-section">
          <div className="aws-auth-section-title">Requests for an account <span className="aws-auth-count">{admin.requestList.length}</span></div>
          <div className="aws-auth-table-scroll">
            <table className="aws-auth-table">
              <thead><tr><th>Email</th><th>Name</th><th>Note</th><th>Asked</th><th /></tr></thead>
              <tbody>
                {admin.requestList.map((request) => (
                  <tr key={request.requestId}>
                    <td className="aws-auth-cell-wide" title={request.email}>{request.email}</td>
                    <td className="aws-auth-cell-wide" title={request.name}>{request.name}</td>
                    <td className="aws-auth-cell-wide" title={request.note}>{request.note}</td>
                    <td className="aws-auth-cell-time">{timeTextDisplay(request.timeCreated)}</td>
                    <td className="aws-auth-cell-action">
                      <button type="button" className="doc-button" data-primary onClick={() => model.adminFormOpen('approve', request)}>Approve…</button>
                      <button type="button" className="doc-button" onClick={() => void model.adminRequestReject(request.requestId)}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="aws-auth-section">
        <div className="aws-auth-section-title">Accounts <span className="aws-auth-count">{admin.userList.length}</span></div>
        <div className="aws-auth-table-scroll">
          <table className="aws-auth-table" data-selectable>
            <thead><tr><th>User name</th><th>Name</th><th>Email</th><th>State</th><th>Roles</th><th>MFA</th><th>Created</th></tr></thead>
            <tbody>
              {admin.userList.map((one) => (
                <tr key={one.userId} {...(one.userId === admin.userIdSelected ? { 'data-selected': true } : {})} onClick={() => model.adminUserSelect(one.userId)}>
                  <td className="aws-auth-cell-wide" title={one.userName}>{one.userName}</td>
                  <td className="aws-auth-cell-wide" title={one.name}>{one.name}</td>
                  <td className="aws-auth-cell-wide" title={one.email}>{one.email}</td>
                  <td><span className="doc-badge-outline" {...stateAttributeGet(one)}>{stateTextGet(one)}</span></td>
                  <td className="aws-auth-cell-wide" title={(one.groupList ?? []).join(', ')}>{(one.groupList ?? []).join(', ')}</td>
                  <td>{one.isMfaEnabled ? 'on' : 'off'}</td>
                  <td className="aws-auth-cell-time">{timeTextDisplay(one.timeCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* the actions of the account chosen: a row of its own below the table, of one height
            whether an account is chosen or not, so choosing moves nothing */}
        <div className="aws-auth-action-area">
          <div className="aws-auth-action-title">{user ? `${user.userName}${isSelf ? ' (you)' : ''}` : 'Choose an account to change it'}</div>
          <div className="aws-auth-button-row">
            <button type="button" className="doc-button" disabled={!user || isPending} onClick={() => model.adminFormOpen('edit', user)}>Edit…</button>
            {user?.status === 'disabled'
              ? <button type="button" className="doc-button" disabled={isPending} onClick={() => void model.adminUserAction('enable', 'The account can sign in again.')}>Enable</button>
              : <button type="button" className="doc-button" disabled={!user || isPending || isSelf} title={isSelf ? 'An admin does not disable itself' : 'It cannot sign in, its sessions end, our services refuse it'} onClick={() => model.adminConfirmSet('disable')}>Disable</button>}
            <button type="button" className="doc-button" disabled={!user || isPending} title="A new invitation while the first sign-in is pending; else a reset code by email" onClick={() => void model.adminUserAction('password/reset', 'An email to choose a new password was sent.')}>Reset the password</button>
            <button type="button" className="doc-button" disabled={!user || isPending} title="Every session of the account ends; it signs in again" onClick={() => void model.adminUserAction('session/revoke', 'Every session of the account was ended.')}>End sessions</button>
            <button type="button" className="doc-button" disabled={!user || isPending || !user?.isMfaEnabled} title="For a lost device: the authenticator app is turned off" onClick={() => model.adminConfirmSet('mfaReset')}>Turn off MFA</button>
            <button type="button" className="doc-button" data-danger disabled={!user || isPending || isSelf} title={isSelf ? 'An admin does not delete itself' : 'The account is removed for good'} onClick={() => model.adminConfirmSet('delete')}>Delete</button>
          </div>
          <div className="aws-auth-confirm-row">
            {admin.confirm && user ? (
              <>
                <span>{CONFIRM_BY_ID[admin.confirm].question(user)}</span>
                <button type="button" className="doc-button" data-danger onClick={() => void model.adminUserAction(CONFIRM_BY_ID[admin.confirm].action, CONFIRM_BY_ID[admin.confirm].done)}>{CONFIRM_BY_ID[admin.confirm].label}</button>
                <button type="button" className="doc-button" onClick={() => model.adminConfirmSet('')}>Cancel</button>
              </>
            ) : (
              <span className="aws-auth-message" {...(admin.action.isError ? { 'data-error': true } : {})}>{isPending ? 'Working…' : admin.action.message}</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

const CONFIRM_BY_ID = {
  disable: { action: 'disable', label: 'Disable', done: 'The account is disabled: it cannot sign in, and its sessions were ended.', question: (user) => `Disable ${user.userName}? It cannot sign in until it is enabled again.` },
  mfaReset: { action: 'mfa/reset', label: 'Turn off', done: 'The authenticator app of the account was turned off.', question: (user) => `Turn off the authenticator app of ${user.userName}?` },
  delete: { action: 'delete', label: 'Delete', done: 'The account was deleted.', question: (user) => `Delete ${user.userName} for good? What our services hold under its user id stays.` },
};

// the forms of the console, one dialog: a new account, an account edited, a request approved
const AwsAuthAdminFormPopup = observer(function AwsAuthAdminFormPopup({ model }) {
  const { form, groupList } = model.admin;
  const kind = FORM_BY_KIND[form.kind];
  return (
    <PanelPopup panelId="awsAuthAdminForm" title={kind?.title ?? ''} isOpen={Boolean(kind)} onClose={() => model.adminFormClose()} className="doc-auth-popup aws-auth-form-popup" bodyClassName="doc-auth-popup-body">
      {kind ? (
        <form
          className="doc-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void model.adminFormSubmit();
          }}
        >
          <div className="doc-auth-note">{kind.note}</div>
          <label className="doc-auth-field">
            <span className="doc-auth-field-label">Email</span>
            <input className="doc-auth-input" type="email" autoFocus={form.kind === 'create'} disabled={form.kind !== 'create'} value={form.email} onChange={(event) => model.adminFormFieldSet('email', event.target.value)} />
          </label>
          <label className="doc-auth-field" title="What the person signs in with. Empty: the email">
            <span className="doc-auth-field-label">User name</span>
            <input className="doc-auth-input" disabled={form.kind === 'edit'} placeholder={form.kind === 'edit' ? '' : 'the email'} value={form.userName} onChange={(event) => model.adminFormFieldSet('userName', event.target.value)} />
          </label>
          <label className="doc-auth-field">
            <span className="doc-auth-field-label">Name</span>
            <input className="doc-auth-input" value={form.name} onChange={(event) => model.adminFormFieldSet('name', event.target.value)} />
          </label>
          <div className="doc-auth-field">
            <span className="doc-auth-field-label">Roles</span>
            <span className="aws-auth-group-list">
              {groupList.map((group) => (
                <label key={group.name} className="doc-auth-check" title={group.description || (group.isAdminGroup ? 'May use this console' : '')}>
                  <input type="checkbox" checked={form.groupList.includes(group.name)} onChange={() => model.adminFormGroupToggle(group.name)} />
                  <span>{group.name}{group.isAdminGroup ? ' (account admin)' : ''}</span>
                </label>
              ))}
            </span>
          </div>
          <div className="doc-auth-message" data-error>{form.message}</div>
          <div className="doc-auth-button-row">
            <button type="submit" className="doc-button" data-primary disabled={form.isPending}>{form.isPending ? 'Working…' : kind.submitLabel}</button>
            <button type="button" className="doc-button" onClick={() => model.adminFormClose()}>Cancel</button>
          </div>
        </form>
      ) : null}
    </PanelPopup>
  );
});

const FORM_BY_KIND = {
  create: { title: 'New account', submitLabel: 'Create and invite', note: 'An invitation with a user name and a temporary password goes to the email. The person chooses a password at the first sign-in.' },
  edit: { title: 'Edit the account', submitLabel: 'Save', note: 'The groups say what the account may use: they replace the ones it has.' },
  approve: { title: 'Approve the request', submitLabel: 'Approve and invite', note: 'Approving creates the account: an invitation with a user name and a temporary password goes to the email.' },
};

function stateTextGet(user) {
  if (user.status === 'disabled') return 'disabled';
  if (user.cognitoStatus === 'FORCE_CHANGE_PASSWORD') return 'invited';
  if (user.cognitoStatus === 'RESET_REQUIRED') return 'password reset';
  return 'active';
}

function stateAttributeGet(user) {
  if (user.status === 'disabled') return { 'data-error': true };
  return stateTextGet(user) === 'active' ? { 'data-primary': true } : {};
}


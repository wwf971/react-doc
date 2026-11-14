import { observer } from 'mobx-react-lite';

// The sign-in dialog of the kind cognito (contract: doc/auth-contract.md#signing-in-inside-the-page),
// drawn inside the dialog of the page's auth layer. Everything it shows is the state of its model
// (AuthSignInModel); every button asks the model for the next step. The form keeps one layout
// whatever the step, and the line of its message keeps its height, so nothing jumps between steps.
export const AuthSignIn = observer(function AuthSignIn({ model }) {
  if (!model) return null;
  const submitHandle = (event) => {
    event.preventDefault();
    void model.submit();
  };
  const step = STEP_BY_ID[model.step] ?? STEP_BY_ID.credential;
  return (
    <form className="doc-auth-form" onSubmit={submitHandle} autoComplete="on">
      <div className="doc-auth-title">{step.title}</div>
      <div className="doc-auth-note">{step.note}</div>
      {step.fieldList.map((field) => <AuthField key={field.key} model={model} field={field} />)}
      {model.step === 'credential' ? (
        <label className="doc-auth-check" title="Checked: still signed in after the browser is closed. Unchecked: signed in while this tab is open.">
          <input type="checkbox" checked={model.isKept} onChange={(event) => model.fieldSet('isKept', event.target.checked)} />
          <span>Keep me signed in on this browser</span>
        </label>
      ) : null}
      <div className="doc-auth-message" {...(model.isError ? { 'data-error': true } : {})}>{model.message}</div>
      <div className="doc-auth-button-row">
        {step.submitLabel ? <button type="submit" className="doc-button" data-primary disabled={model.isPending}>{model.isPending ? 'Working…' : step.submitLabel}</button> : null}
        {model.step !== 'credential' ? <button type="button" className="doc-button" disabled={model.isPending} onClick={() => model.stepSet('credential')}>Back to sign in</button> : null}
      </div>
      {model.step === 'credential' ? (
        <div className="doc-auth-button-row">
          <button type="button" className="doc-auth-link" onClick={() => model.stepSet('forgot')}>Forgot the password</button>
          {model.isRequestOffered ? <button type="button" className="doc-auth-link" onClick={() => model.stepSet('request')}>Ask for an account</button> : null}
        </div>
      ) : null}
    </form>
  );
});

const AuthField = observer(function AuthField({ model, field }) {
  return (
    <label className="doc-auth-field">
      <span className="doc-auth-field-label">{field.label}</span>
      <input
        className="doc-auth-input"
        {...(field.isCode ? { 'data-code': true, inputMode: 'numeric', maxLength: 8 } : {})}
        type={field.type ?? 'text'}
        name={field.name ?? field.key}
        autoComplete={field.autoComplete ?? 'off'}
        autoFocus={field.isFocused === true}
        value={model[field.key]}
        onChange={(event) => model.fieldSet(field.key, event.target.value)}
      />
    </label>
  );
});

const FIELD_PASSWORD_NEW_LIST = [
  { key: 'passwordNew', label: 'New password', type: 'password', autoComplete: 'new-password', isFocused: true },
  { key: 'passwordNewRepeat', label: 'Once more', type: 'password', autoComplete: 'new-password' },
];

const STEP_BY_ID = {
  credential: {
    title: 'Sign in',
    note: 'The password goes to Amazon Cognito and nowhere else; this page keeps the session it answers.',
    submitLabel: 'Sign in',
    fieldList: [
      { key: 'userName', label: 'User name', name: 'username', autoComplete: 'username', isFocused: true },
      { key: 'password', label: 'Password', type: 'password', name: 'password', autoComplete: 'current-password' },
    ],
  },
  passwordNew: {
    title: 'Choose a password',
    note: 'This is the first sign-in of the account: the temporary password is replaced by one of your own.',
    submitLabel: 'Set the password',
    fieldList: FIELD_PASSWORD_NEW_LIST,
  },
  mfa: {
    title: 'Authenticator code',
    note: 'This account asks for the 6 digits your authenticator app shows now.',
    submitLabel: 'Verify',
    fieldList: [{ key: 'code', label: 'Code', isCode: true, autoComplete: 'one-time-code', isFocused: true }],
  },
  forgot: {
    title: 'Forgot the password',
    note: 'A code is sent to the email of the account; with it you choose a new password.',
    submitLabel: 'Send the code',
    fieldList: [{ key: 'userName', label: 'User name', name: 'username', autoComplete: 'username', isFocused: true }],
  },
  forgotConfirm: {
    title: 'Choose a new password',
    note: 'Type the code of the email and the new password.',
    submitLabel: 'Change the password',
    fieldList: [{ key: 'code', label: 'Code', isCode: true, autoComplete: 'one-time-code', isFocused: true }, ...FIELD_PASSWORD_NEW_LIST.map((field) => ({ ...field, isFocused: false }))],
  },
  request: {
    title: 'Ask for an account',
    note: 'An account admin looks at the request. When it is approved, a user name and a temporary password arrive by email.',
    submitLabel: 'Send the request',
    fieldList: [
      { key: 'email', label: 'Email', type: 'email', autoComplete: 'email', isFocused: true },
      { key: 'name', label: 'Name', autoComplete: 'name' },
      { key: 'note', label: 'Note for the admin' },
    ],
  },
  requestDone: {
    title: 'The request was sent',
    note: 'An account admin will look at it. When it is approved, a user name and a temporary password arrive by email; sign in with them here.',
    submitLabel: '',
    fieldList: [],
  },
};

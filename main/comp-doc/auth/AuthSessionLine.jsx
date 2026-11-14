import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocAuth.css';

// One line saying who is signed in to an auth provider, with the button that changes it
// (doc_page_impl_auth.md#what-the-page-shows): "Signed in as alice [Sign out]", "Not signed in
// [Sign in]", or why the provider cannot be used. Shown wherever a session matters: a storage
// point of the Asset service tab, the modes of an auth provider, a mode whose data is behind one.
//
//   providerRef   the auth provider (frontend:{id})
//   reason        why a sign-in is asked for here, said in the dialog
export const AuthSessionLine = observer(function AuthSessionLine({ providerRef, reason = '', isNameShown = true }) {
  const { authStore } = useDocStores();
  if (!authStore) return <span className="doc-auth-line"><span className="doc-auth-line-text" data-muted>the page has no auth layer</span></span>;
  const provider = authStore.providerGet(providerRef);
  const name = provider.name || providerRef || '(no auth provider)';
  if (provider.status === 'loading') {
    return <span className="doc-auth-line"><span className="doc-auth-line-text" data-muted>{isNameShown ? `${name}: ` : ''}reading</span></span>;
  }
  if (provider.status !== 'ready') {
    return (
      <span className="doc-auth-line">
        <span className="doc-badge-outline" data-error>auth</span>
        <span className="doc-auth-line-text" title={provider.message}>{provider.message || `${name} is no auth provider`}</span>
      </span>
    );
  }
  const session = authStore.sessionGet(providerRef);
  const isSignedIn = session.status === 'signedIn';
  const who = session.identity?.name || session.identity?.userName || session.identity?.email || '';
  return (
    <span className="doc-auth-line">
      {isNameShown ? <span className="doc-auth-line-name" title={`${provider.kindLabel} · ${providerRef}`}>{name}</span> : null}
      <span className="doc-badge-outline" {...(isSignedIn ? { 'data-primary': true } : {})}>{isSignedIn ? 'signed in' : session.status === 'expired' ? 'session ended' : 'signed out'}</span>
      {isSignedIn && who ? <span className="doc-auth-line-text" title={session.identity?.email || who}>{who}</span> : null}
      {isSignedIn
        ? <button type="button" className="doc-button" onClick={() => void authStore.signOut(providerRef)}>Sign out</button>
        : <button type="button" className="doc-button" data-primary onClick={() => void authStore.signInOpen(providerRef, { reason })}>Sign in</button>}
    </span>
  );
});

import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { PanelPopup } from '../popup/PanelPopup.jsx';
import './DocAuth.css';

// The sign-in dialog of the page (design: doc_page_impl_auth.md#signing-in). The auth layer
// (DocAuthStore) says which provider a person is signing in to and holds the state of the
// dialog; what is drawn inside is the component of the provider's auth kind, so the layer knows
// no identity provider. One dialog at a time, framed like every dialog of the page (moved,
// resized, closed by its button and by Escape).
export const DocAuthPopup = observer(function DocAuthPopup() {
  const { authStore } = useDocStores();
  const dialog = authStore?.dialog;
  if (!dialog) return null;
  const provider = authStore.providerGet(dialog.providerRef);
  const SignInComp = authStore.kindById.get(provider.kindId)?.kind.SignInComp;
  return (
    <PanelPopup
      panelId="authSignIn"
      title={`Sign in: ${provider.name || provider.ref}`}
      isOpen
      onClose={() => authStore.dialogClose()}
      className="doc-auth-popup"
      bodyClassName="doc-auth-popup-body"
    >
      {dialog.reason ? <div className="doc-auth-reason">{dialog.reason}</div> : null}
      {SignInComp
        ? <SignInComp model={dialog.model} provider={provider} authStore={authStore} reason={dialog.reason} />
        : <div className="doc-auth-message" data-error>{provider.message || `no auth kind of this page signs in to ${provider.ref}`}</div>}
    </PanelPopup>
  );
});

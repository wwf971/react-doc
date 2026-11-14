<!-- Design of the auth service layer: signing a person in against an identity provider, holding the sessions that succeeded, and handing a credential of a session to whoever must prove who the person is. Parent document: doc_page_impl.md. Its first consumer is the asset storage service layer (doc_page_impl_asset_storage.md#points-of-the-page); its first kind is brought by the package aws-utils. -->

# Auth Service Layer: Design

A page that reaches a backend on its own (a [storage point of a remote type](doc_page_impl_asset_storage.md#points-of-the-page), a component calling a service) has to say who is asking. The **auth service layer** is where that is decided, once for the whole page: it signs a person in against an **identity provider**, keeps the **session** that results, and hands a **credential** of it to whoever asks. A storage point does not sign anyone in, and an identity provider does not know what a storage point is; the layer stands between them, so one sign-in serves every part of the page that needs it.

```text
a consumer                                the auth layer (DocAuthStore)                 an identity provider
  a storage point "cloud"   credentialGet   sessions, one per auth provider   kind cognito   Amazon Cognito
  a mode of an object      ───────────────►   signedIn: who, until when     ◄────────────►  (a user pool)
  any component             { token }         the kind's own: its tokens     refresh, sign out
                                                    ▲
                                                    │ signInOpen
                                              the sign-in dialog: drawn by the kind, inside the page
```

The layer knows no identity provider. What it knows is the shape every provider is given: a **kind** (code, brought by a package) and **providers** (frontend objects a doc page keeps).

## The concepts

- **An auth kind** is the code for one sort of identity provider: how its config reads, how a session is checked, refreshed and ended, and the component of its sign-in dialog. A package brings it; `cognito` of the package `aws-utils` is the first.
- **An auth provider** is one identity provider a person can sign in with, as a doc page has it: a **frontend object** whose type is the type of a kind, with its config in `metadata.auth` of its entry (a user pool, a client). It is named by its reference, `frontend:{id}`, by whatever uses it.
- **A session** is a succeeded sign-in of one provider: who the person is (the **identity**), until when, and what the kind keeps to prove it (its tokens). One session per provider and browser.
- **An account** is what a person signs in with at a provider: the identity of a session is the account it stands for.
- **A role** is a name an account holds that says what it may do beyond signing in. `identity.roleList` carries the roles of the account signed in; how a provider keeps them is its kind's (the groups of a Cognito user pool). One role is the layer's own: **`account-admin`**, the account that manages the accounts of its provider ([Accounts and roles](#accounts-and-roles)).
- **A consumer** is whoever asks a session for a credential, saying who it is: `{ kind, id, label }` (a storage point, a component).
- **A credential** is what a consumer sends to a backend: a token good now, refreshed by the kind when it is about to end.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| which kinds exist | the packages the page imports (`auth-kind.yaml`) | the development server, which hands the page their modules |
| which providers exist, their config | the frontend objects of the types of the kinds: their entry asset | the layer, through the frontend object layer |
| who is signed in | the session the browser keeps (`localStorage` or `sessionStorage`, as the person chose) | the layer |
| whether a session is still good | the identity provider: a refresh it refuses ends the session | the kind |
| who the person is to our backends (their user id) | the backend, which tells the layer (`identitySet`) | consumers, the modes of a provider |

Nothing secret is in a file: a provider's config is public by design (a pool id, a client id), and tokens live in the browser only.

## Auth kinds of a package

A package declares its kinds in a file at its top, as it declares types in `type.yaml`:

```yaml
# {package}/auth-kind.yaml
authKindList:
  - id: cognito                          # lower case letters, digits, "-": unique in the page
    label: Amazon Cognito
    description: signs a person in against a Cognito user pool, from a form inside the page
    typeId: aws-utils.auth-cognito       # the frontend objects of this type are its providers
    module: { entry: ./comp-mdx/auth/auth-kind-cognito.js, export: authKindCognito }   # relative to the file
```

The development server reads the files (`doc-auth-config.ts`), imports each module into the page like a component (`docAuthKindList` of the virtual module), and reports what is wrong with a file without stopping the page. The first declaration of an id is kept. What a kind exports:

```text
configRead(metadataAuth)                  -> { config, message }      message '' when the config can be used
sessionCheck({ config, data })            -> { isUsable, identity?, timeExpire? }   of what the browser kept
credentialGet({ config, data, consumer }) -> { code, message, data: { token, tokenType, timeExpire,
                                               session?: { data, identity, timeExpire } } }
                                             a credential good now; refreshed when needed (data.session: what the
                                             layer keeps from now on, never handed to a consumer); code -7 when
                                             the session cannot be used any more
signOut({ config, data })                 -> the session ended at the identity provider
signInModelCreate({ provider, authStore }) -> the state of one sign-in dialog, the kind's own
SignInComp                                the component drawing that state: ({ model, provider, authStore, reason })
```

A kind keeps no state of its own: what it needs between calls is the `data` of the session, which the layer keeps and gives back.

## Providers

An auth provider is a frontend object, so it is created, named, moved and shown like any object, and a document shows it with the entry component in the modes its type brings (the package `aws-utils`: `session`, and `admin`, the console of an account admin).

```yaml
# the entry asset of an auth provider
name: My account
type: aws-utils.auth-cognito
metadata:
  auth: { region: us-east-1, userPoolId: us-east-1_AbCdEfGhI, clientId: 1example23456789 }
```

`providerGet(ref)` answers a provider with a state the page can say:

| state | means |
| --- | --- |
| `ready` | its kind is here and its config reads |
| `loading` | its object is still being read |
| `configInvalid` | `metadata.auth` lacks something its kind needs; the message says what |
| `kindMissing` | its type is an auth type, and no kind of the page answers for it (the package is not imported) |
| `missing` | no such object, or not an auth provider |

## Sessions

```text
signedOut ── signInOpen: the dialog of the kind ──► signedIn ── the kind refuses a refresh ──► expired
    ▲                                                  │                                          │
    └──────────────── signOut ─────────────────────────┴────────── signInOpen ◄───────────────────┘
```

- **Signing in is asked by a person, never by the layer.** A consumer that gets "not signed in" says so where it is shown, with a **Sign in** button; the dialog opens on a click. So a page does not throw a dialog at a reader who only reads.
- **Where a session is kept** is chosen at sign-in: this browser (`localStorage`: still signed in after a restart) or this tab (`sessionStorage`). It is read back the first time the provider is asked for.
- **A session ends** when the person signs out, or when the identity provider refuses to refresh it (revoked, too old, the account disabled). Consumers are told (`sessionEndListen`), and drop what they kept for the person: the storage layer drops its cache of that person.
- **Another person signing in** on the same provider ends the session before, for the consumers, the same way.

## Accounts and roles

Accounts and roles are terms of the layer, not of one identity provider, so a component can be written against them whatever kind stands behind:

```text
an auth provider (frontend:{id})
  accounts                      what people sign in with; kept by the identity provider
    an account                    subject, user name, name, email
      roleList                    the roles it holds: [ "account-admin", "doc-storage", … ]
  the session it holds          one account signed in, in this browser
    sessionRoleHas(ref, role)     whether that account holds a role
```

- **An account admin is an account like any other**, marked with the role `account-admin` (`AUTH_ROLE_ACCOUNT_ADMIN`). It is kept where every account is kept, signs in through the same dialog of the same provider, with whatever the kind asks of it on top (a second factor), and a provider may have several.
- **An account console is a component that needs such a session.** It is a mode of the auth provider object, embedded in a document like any block, and works with the session that object holds: with the session of an account admin it shows the accounts, and with none, or with the session of another account, it says that it needs one and offers to sign in. The console and the sign-in know nothing of each other: one holds a session, the other asks whether it has the role.
- **A role on the page is for what is shown, never a permission.** `sessionRoleHas` reads what the session says of its account, so a page does not send a request that can only be refused. The backend behind the provider checks every request again, by its own rules: the account service of the kind `cognito` asks for the role and a second factor ([its contract](../package/aws-utils/doc/auth-contract.md#for-an-account-admin)).
- **A session says the roles its account had when its credential was made.** A role given later is not in it, and a reload of the page does not change that: the session is kept by the browser and read back as it was. So the layer makes a credential anew when one is asked for with `isFresh`, and whoever depends on a role asks that way at the moment it matters: a storage point that was refused asks once and sends the request again when the session then says something else; an account console asks before it says that the account is no admin; a console that changed the account signed in calls `sessionRefresh`. A person can ask too (**Read again** of the session view, **Refresh** of a partition). Nobody has to sign in again for a role.
- **Other roles are the provider's own names.** What `doc-storage` grants is said by the service that asks for it; the layer only carries the name.

## Signing in

The dialog is the page's (`DocAuthPopup`, framed like every dialog: moved, resized, closed by its button and by Escape); what is inside is the kind's component, drawing the kind's own state (a model the layer holds while the dialog is open). The shared pieces of a form (`comp-doc/auth/DocAuth.css`: a field, the row of buttons, the line of a message that keeps its height) are the page's, so every kind looks like the page.

`AuthSessionLine` is the one line that says who is signed in to a provider, with the button that changes it; it is shown wherever a session matters: a storage point in the Asset service tab, the modes of a provider.

## Credentials for consumers

```text
credentialGet(ref, { consumer: { kind, id, label } })
  -> the provider is not ready                      -1, with its message
  -> nobody signed in, or the session expired       -7: the consumer says so, a person decides to sign in
  -> else the kind answers a token good now
       -> it refreshed: the layer keeps the new tokens
       -> it says the session ended (-7): the session is expired from now on
  -> { code: 0, message, data: { token, tokenType, timeExpire } }
```

Every answer of the layer and of a kind has the one shape of the project, `{ code, message, data }`, and nothing else at its top level: what a kind has to say beside the credential travels inside `data`.

- **Several consumers asking at once share one refresh**: the call in progress is the answer of all of them.
- **A consumer is named**, and the layer keeps who asked (`consumerListGet`), which a mode of the provider shows as "used by".
- **Every consumer of the page may ask every session today.** The consumer is passed so that a policy has what it needs without changing a caller ([what is left](#what-is-left-for-later)).

## The apis of the layer

`DocAuthStore` (`stores.authStore`, `useDocStores().authStore` in a component):

```text
kindList, providerList, providerGet(ref)
sessionGet(ref)                      { status: signedOut | signedIn | expired, identity, timeExpire, keep }
isSignedIn(ref)
sessionRoleHas(ref, role)            whether the account signed in holds a role (AUTH_ROLE_ACCOUNT_ADMIN: "account-admin")
signInOpen(ref, { reason? })         Promise<boolean>: true once signed in, false when the dialog was closed
signOut(ref)
credentialGet(ref, { consumer, isFresh? })
                                     Promise<{ code, message, data: { token, tokenType, timeExpire } }>
                                     isFresh: made anew now (at most every few seconds), so it says the account as it is
sessionRefresh(ref)                  the session read anew from the identity provider: its credential and its roles
identitySet(ref, patch)              what a backend told of the person: its user id, a name
consumerListGet(ref)                 who asked this session for a credential
sessionEndListen(listener)           told when a session ended
dialog, dialogClose()                the sign-in dialog open now
```

## Files

```text
frontend/plugin/doc-auth-config.ts        the auth kinds the packages declare (auth-kind.yaml), their problems
frontend/plugin/doc-source.ts             config.authDeclared; docAuthKindList of the virtual module: the modules of the kinds
frontend/src/store/DocAuthStore.ts        the layer: providers, sessions, the dialog, credentials
frontend/src/DocPageMdx.jsx               data.authKindList -> authStore; DocAuthPopup mounted
comp-doc/auth/DocAuthPopup.jsx            the sign-in dialog of the page
comp-doc/auth/AuthSessionLine.jsx         who is signed in to a provider, with Sign in / Sign out
comp-doc/auth/DocAuth.css                 the dialog, the session line, the pieces of a form a kind draws with
package/aws-utils/auth-kind.yaml          the kind cognito
package/aws-utils/comp-mdx/auth/          its code, its dialog, the modes of its providers
```

## What is left for later

In [TODO](doc_page_impl_TODO.md#auth): a policy of which consumer may use which session, kinds that sign in through another window (a redirect to Google or to a hosted page), one person signed in to several providers seen as one, and sessions kept in step across the tabs of a browser.

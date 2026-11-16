<!-- Root document of the package aws-utils: what it brings to a doc page, the concepts, and how its parts work together. The wire contracts are documents of their own beside it: storage-contract.md, auth-contract.md. Design of the package system: @react-doc/main/doc_page_impl_package.md -->

# aws-utils: AWS Behind a Doc Page

A doc page is usually files: documents, and the frontend objects it keeps in its own folders. The package **aws-utils** puts a backend on AWS behind it, so that some of what a doc page holds lives in the cloud and belongs to the person signed in: the same data on every machine, on the development server and on a statically hosted page alike.

It brings two things, kept apart on purpose, and one small type that shows them working together:

```text
a doc page
  storage point "cloud"  (asset-storage.yaml)            an auth provider object  (frontend:{id})
    type  aws-utils.remote ──────────────┐                 type  aws-utils.auth-cognito
    url   the storage service            │ asks for        kind  cognito
    auth  { provider: frontend:{id} } ───┼── a credential ─►  signs a person in, inside the page;
                                         │                    keeps the session
  a frontend object                      │
    partition "cloud" bound to the point │
        │                                │
        ▼                                ▼
  the storage service (AWS)            Amazon Cognito + the account service (AWS)
    spaces, partitions, items            who a person is; accounts issued and revoked
    storage-contract.md                  auth-contract.md
```

- **The storage type `aws-utils.remote`** keeps the partitions of frontend objects at a storage service on AWS. It is a type of the [asset storage service layer](../../../main/doc_page_impl_asset_storage.md): a partition bound to a point of it reads and writes through the same api as a partition in a folder.
- **The auth kind `cognito`** signs a person in against an Amazon Cognito user pool, from a form inside the page. It is a kind of the [auth service layer](../../../main/doc_page_impl_auth.md): the session it holds is handed to whoever must prove who the person is.
- **They do not know each other.** A storage point names an auth provider by its reference; the storage layer asks the auth layer for a credential. So one sign-in serves several storage points, and whatever else is built on the same backend later.

## The concepts

| concept | what it is | where it is said |
| --- | --- | --- |
| **storage service** | one deployment on AWS, reached by one url, serving many accounts | `config.url` of a storage point |
| **space** | the area of one storage point at the service: nothing outside it is reached by the point. Named by a key, the id of the point unless its config says another | `config.space` of a storage point |
| **auth provider** | a frontend object of the type `aws-utils.auth-cognito`: which user pool people sign in to | `metadata.auth` of its entry |
| **session** | a succeeded sign-in of a provider, kept by the browser: this tab, or this browser | the auth layer of the page |
| **user** | a person as our services know them: a user id of our own, mapped to identities (a Cognito user now) | the user table of the auth backend |
| **role** | a name an account holds that says what it may do: `doc-storage` may use the storage service, `account-admin` manages the accounts. A term of the [auth layer](../../../main/doc_page_impl_auth.md#accounts-and-roles); this package keeps a role as a group of the user pool | the user pool; the token of a session carries them |
| **account admin** | an account like any other that holds the role `account-admin` and has MFA on: issues, changes and revokes accounts. There may be several | the account service |

The two backends are sub-projects of the repository `aws_oa`, each written to answer a contract of this package:

```text
storage-contract.md  ◄── aws_oa/_5_doc_storage     the storage service
auth-contract.md     ◄── aws_oa/_0_auth_cognito    the user pool, the user table, the account service
```

A contract is the source of truth: a change is written into it first, and the backend follows. How the storage service is built on AWS, drawn at several scales in one viewport (who talks to whom, its resources, one request step by step, the inside of its table and bucket), is [Storage Service Architecture](storage-architecture.md), drawn with the AWS cards of the package `cloud-dev-vis`.

## The storage type

```yaml
# asset-storage.yaml of a workspace or a doc page
storagePointList:
  - id: cloud
    type: aws-utils.remote
    label: Cloud
    config: { url: "https://abc123.execute-api.us-east-1.amazonaws.com" }
    auth: { provider: frontend:w6abcdefghi }
```

A partition is bound to the point by its type (`storagePoint: cloud` of `partitionList`), or in the Frontend objects tab: **Storage…** moves a partition there with every item and its history, and back. From then on:

```text
the page starts
  -> the cache of the browser is shown at once (the notes are there before the network answers)
  -> the point is asked whether the partition changed: one small request while it did not
a mode writes an asset
  -> one request to the service: the item and its record made together
  -> the answer is taken into the cache
nobody is signed in
  -> the partition shows nothing, and says so; the other partitions of the object work
```

- **The driver** (`comp-mdx/storage/aws-storage-driver.js`) is all this package adds to the storage layer: how each call of the item and partition api sets is sent to the service. The cache, the state of a partition, moving a partition and the settings tab are the layer's, the same for every remote type.
- **What travels how.** Small data inside the request; a large version through a signed S3 url, straight between the browser and S3. The limits are the service's (`GET /status`).
- **Where it is kept** is another thing: a row of the table or an object of the bucket, by the size, unless the item prefers one (`storagePreference: database | objectStorage`); each version says where its bytes went ([the contract](storage-contract.md#where-the-bytes-are-kept)). The drive of the package asset-service asks for object storage for large uploads.
- **The panel of a point** (`AwsStoragePointPanel`, in the Asset service tab): the account at the service, the space of the point with what it holds, and the partitions of that space no object of the page reads, each restored or removed for good.

Everything a request looks like is in [the storage contract](storage-contract.md).

## The auth provider

An auth provider is a frontend object, so a doc page has it like any object, and a document shows it with the entry component:

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w6abcdefghi
mode: session
```
````

| mode | shows |
| --- | --- |
| `session` (default) | who is signed in, what the account service knows of them (user id, groups, MFA), which parts of the page use the session; signing in and out, changing the password, turning on the authenticator app, asking for an account |
| `admin` | [the account admin console](#the-account-admin-console) |

**Signing in happens inside the page**: a dialog with a form, in steps (user name and password; a new password at the first sign-in; the code of the authenticator app). The password goes to Cognito over https and nowhere else. A person chooses whether the session stays on this browser or lasts while the tab does. The steps and the calls are in [the auth contract](auth-contract.md#signing-in-inside-the-page).

```text
comp-mdx/auth/
  auth-kind-cognito.js    the kind: config, session check, refresh, sign-out (what the auth layer calls)
  cognito-api.js          the calls of Cognito's public api
  AuthSignInModel.js      the state of the sign-in dialog, step by step
  AuthSignIn.jsx          the dialog
  account-api.js          the client of the account service
  AuthAccountModel.js     the state of the two modes: me, password, MFA, the console
  AwsAuthSession.jsx      the mode session
  AwsAuthAdmin.jsx        the mode admin
  qr-code.js              the QR code of the MFA key (drawn in the page: the key never leaves it)
```

### The account admin console

The mode `admin` of an auth provider is the account console: a component a document embeds, like any block, for whoever manages the accounts.

```text
Requests for an account     email, name, note        [Approve…] [Reject]
Accounts                    user name, name, email, state, roles, MFA, created
  the account chosen        [Edit…] [Disable | Enable] [Reset the password] [End sessions] [Turn off MFA]
                            [Require MFA… | Stop requiring MFA] [Delete]
[New account…]              email, user name, name, roles   -> an invitation with a temporary password by email
```

- **It works with the session its auth provider holds.** The console signs nobody in by itself: the account admin signs in through the same dialog of the same provider as everyone, MFA included, and the console asks the auth layer whether that session holds the role `account-admin`. With no session, or the session of another account, it shows one line saying that it needs the session of an account admin, and the way to sign in.
- **An account admin is an account marked with a role**, kept where every account is kept; a provider may have several. On top of the role the account service asks for an authenticator app: an admin without one is offered to turn it on first, and from then on the code is asked at every sign-in.
- **The console decides nothing.** Every change is a call of the account service, which checks the caller; a page that skipped the checks would be refused the same way.
- **An account may be required to use MFA.** For an account that reaches what matters, the admin requires MFA of it: its sessions end, and our services serve it from then on only with a session that passed MFA, refusing an older one at its next request. An account without an authenticator app is told so in its session view, turns one on, and signs in again with its code ([the auth contract](auth-contract.md#an-account-that-must-use-mfa)). An account other programs sign in with by password alone cannot be required: those programs would be refused.
- **An admin is not the root of anything.** It can change accounts and their roles in one user pool, through the narrow IAM role of the service, and holds no AWS credentials.

## The notebook

`aws-utils.notebook` is a small type that makes the rest tangible: notes kept in the partitions of one object, `local` (the folders of the doc page) and `cloud` (meant for a storage point). Its mode `notes` lists the notes of one partition and adds, edits and removes them through the api of a mode, which is the same for both. A doc page binds `cloud` to its storage point with a type of its own:

```yaml
# .doc-page/type.yaml of a doc page
typeList:
  - id: my.notebook
    extendList: [aws-utils.notebook]
    partitionList:
      - { id: local, label: This doc page, isDefault: true }
      - { id: cloud, label: Cloud, storagePoint: cloud }
```

Notes are added, changed and removed while the document is in edit mode, as every mode writes, whichever partition holds them; a partition a storage point holds needs its sign-in on top. So a built page, which has no edit mode, shows the notes of `cloud` and does not change them through this mode. The storage layer itself does not ask for edit mode: a type whose data belongs to the reader and not to the document may write while the document is read, on a built page too.

## First use

The owner of a deployment sets up the two backends once, declares an auth provider and a storage point, and becomes the first account admin; a new person asks for an account from the sign-in dialog. The steps, with what to type where, are in [First use](first-use.md).

To see everything working before writing any of it by hand, `script-demo/demo-create.mjs` makes a small doc page from the values of a deployment: an auth provider, a storage point, and a notebook whose partition `cloud` is held by that point ([First use](first-use.md#the-quick-way-a-demonstration-doc-page)).

## What a package needs to bring these

```text
doc-package.yaml           the package
type.yaml                  the types of objects: aws-utils.auth-cognito, aws-utils.notebook
asset-storage-type.yaml    the storage type aws-utils.remote, and the module of its driver
auth-kind.yaml             the auth kind cognito, the type of its providers, and its module
comp-mdx/                  the components (the modes, the panel) and the modules above
doc/                       this document, the two contracts, first use
script-demo/               demo-create.mjs: makes a small doc page using a deployment of one's own
```

`asset-storage-type.yaml` and `auth-kind.yaml` are how a package brings a storage type and an auth kind, as `type.yaml` brings types ([Packages](../../../main/doc_page_impl_package.md#what-a-package-brings)).

## What is left for later

- **Being told of a change.** A point is asked; the service never calls the page. Telling the page (the api set `notify`, turned on per point with `config.isNotifyEnabled`) is reserved in the contract and not built. It would matter where waiting for a refresh is too slow: two people editing one document at once, the same notebook open on two devices, a dashboard watching data a job writes, comments and presence. On AWS it would be a WebSocket api of API Gateway fed by the stream of the table.
- **A space shared between accounts.** A space belongs to one account. Sharing one (a team's partitions) needs members and roles on a space, and a point naming a space by its id instead of a key of the caller's account.
- **More identity providers.** The user table already maps one user to several identities. Missing: another auth kind (Google, a self-hosted provider) or the user pool federating one, and a route of the account service linking an identity to an existing user.
- **Which consumer may use which session.** Every part of the page may ask a session for a credential today; a consumer says who it is, so a policy has what it needs ([the auth layer](../../../main/doc_page_impl_auth.md#what-is-left-for-later)).
- **A deleted account and its last token.** The access token of a deleted account is good for up to an hour, and a service resolving it to a user would make a new, empty user ([the auth contract](auth-contract.md#for-an-account-admin)). Missing: a mark the account service leaves for the deleted identity, which the shared resolving of a user refuses.
- **SRP sign-in.** The dialog sends the password to Cognito over https (`USER_PASSWORD_AUTH`). The app client also allows SRP, where the password never leaves the browser; it needs the SRP arithmetic in the page.
- **One asset moved between a point and another.** A whole partition moves between points; one asset alone does not yet, since its item would have to leave one store and enter the other under the same id.

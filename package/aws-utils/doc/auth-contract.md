<!-- The contract of the auth kind cognito: what an auth provider object declares, how the page signs a person in without leaving the page, and every request of the account service (accounts issued, changed and revoked by an account admin). This document is the source of truth; the AWS backend (aws_oa `_0_auth_cognito`) is written to answer it. Parent document: README.md. The layer it plugs into: @react-doc/main/doc_page_impl_auth.md. -->

# Auth Contract of the Kind `cognito`

An **auth provider** of the kind `cognito` signs a person in against an Amazon Cognito user pool, **inside the page**: a form in a dialog, no redirect and no other window, so it works from any origin, a development server and a static page alike. The session it holds is then given to whoever needs to prove who the person is, such as a storage point of the type [`aws-utils.remote`](storage-contract.md). Beside the user pool stands the **account service**, a small backend through which an **account admin** issues, changes and revokes accounts, and a person asks for one.

```text
the page (browser)                                    AWS
  auth provider object  frontend:{id}
    kind cognito, region, userPoolId, clientId ──────► Cognito user pool      who a person is: password, MFA,
    accountApiUrl ─────────────────┐                    (its public json api)  tokens
                                   │                         ▲
  sign-in dialog ──────────────────┼─────────────────────────┘ InitiateAuth, RespondToAuthChallenge, …
  session: access / id / refresh token                       
        │ Authorization: Bearer {access token}
        ├──────────────────────────┴─────────────────► account service         accounts: the user table, groups,
        │                                               API Gateway + Lambda    requests for an account
        └────────────────────────────────────────────► any other service of the same pool (the storage service)
```

## The concepts

- **The user pool** holds the identities: a user name, a password, an email, optionally an authenticator app (MFA), and groups. It is the only place a password is checked.
- **A user** is a person as our services know it: a **user id** of our own in the **user table**, mapped to one or more identities (`cognito#{sub}` now; another identity provider later maps to the same user id). Every service keys its data by the user id, so linking a second identity later does not move any data.
- **A role** says what an account may do, and is kept as a **group** of the user pool: `account-admin` may use the admin routes below, `doc-storage` may use the storage service. A token carries the groups of its user, and the auth layer reads them as the roles of the session ([accounts and roles](../../../main/doc_page_impl_auth.md#accounts-and-roles)). The requests below name them as the pool does: `groupList`.
- **The account admin** is a user like any other, in the group `account-admin`, **who has MFA turned on**; a pool may have several. It manages accounts and nothing else: it is not the root user of the AWS account and holds no AWS credentials. What it can do is exactly what the account service's own role allows on one user pool and one table.
- **A request for an account** is what a person without an account sends; an account admin approves it, which creates the account, or rejects it. Nobody can create an account for themselves.

```text
who is who
  AWS root user              owns the AWS account. never used by anything here
  deploy user (IAM)          runs the ensure scripts: creates the pool, the tables, the functions
  account service role (IAM) what the account service runs as: admin calls on ONE user pool, ONE user table
  account admin (a person)   a user of the pool in the group account-admin, with MFA: uses the admin console
  user (a person)            a user of the pool; what it may use is said by its groups
```

## What an auth provider declares

An auth provider is a frontend object of the type `aws-utils.auth-cognito`; what it needs is in the metadata of its entry:

```yaml
# the entry asset of the object
name: My account
type: aws-utils.auth-cognito
metadata:
  auth:
    region: us-east-1
    userPoolId: us-east-1_AbCdEfGhI
    clientId: 1example23456789            # an app client of the pool without a secret
    accountApiUrl: https://abc123.execute-api.us-east-1.amazonaws.com   # optional: the account service
```

Nothing here is secret: a pool id and a client id are public by design, and a client used from a browser has no secret.

**What the app client must allow** (the ensure script of `_0_auth_cognito` sets it): no client secret; the flows `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_SRP_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`; token revocation on; user existence errors hidden. **What the pool must allow:** MFA `OPTIONAL` with authenticator apps (TOTP); accounts created by an administrator only.

## Signing in, inside the page

The page calls the public api of Cognito itself (`https://cognito-idp.{region}.amazonaws.com/`, json, CORS allowed for every origin); no code of ours stands between the person's password and Cognito.

```text
sign in (user name, password)
  -> InitiateAuth USER_PASSWORD_AUTH
       -> tokens                                            signed in
       -> challenge NEW_PASSWORD_REQUIRED                   the first sign-in of an issued account:
            -> the dialog asks for a new password             the temporary password is replaced
            -> RespondToAuthChallenge
       -> challenge SOFTWARE_TOKEN_MFA                      the account has MFA:
            -> the dialog asks for the 6 digits               the code of the authenticator app
            -> RespondToAuthChallenge
       -> tokens: access (who, groups; sent to services), id (name, email), refresh (kept to stay signed in)

staying signed in      InitiateAuth REFRESH_TOKEN_AUTH, shortly before the access token expires
signing out            RevokeToken (the refresh token), then the session is dropped from the browser
a forgotten password   ForgotPassword -> a code by email -> ConfirmForgotPassword
a password reset by    InitiateAuth answers PasswordResetRequiredException: the reset sent a code by email already,
an account admin         so the dialog asks for it and a new password at once -> ConfirmForgotPassword
changing the password  ChangePassword (signed in)
turning MFA on         AssociateSoftwareToken -> the secret, shown as text and as a QR code
                       -> VerifySoftwareToken (6 digits) -> SetUserMFAPreference
```

Turning MFA on needs the pool to allow authenticator apps (above). A pool that does not answers `SoftwareTokenMFANotFoundException`, and the dialog says that the owner of the deployment has to turn it on: until then no account admin can open the console.

- **The password goes from the dialog to Cognito over https and nowhere else.** The page keeps the tokens, never the password.
- **Where the session is kept** is the person's choice at sign-in: this browser (`localStorage`: still signed in after a restart) or this tab only (`sessionStorage`). An account admin is asked again in every new tab by default.
- **A token says the groups its user had when it was made.** A group given later is in the next token: the page asks Cognito for one (`REFRESH_TOKEN_AUTH`) when a service refused the account for want of a group, when the account console changed the account signed in, and when the person asks (**Read again**, **Refresh**), and sends the request again. Nobody signs in again for a group; a reload alone changes nothing, since the session is kept with its tokens.
- **A token is good until it expires** (one hour for an access token). Revoking an account therefore also turns it off in the user table, which every service of ours reads, so a revoked person is refused within a minute, not within the hour.
- **MFA is of the account, not of the page.** An account with MFA on is asked for the code at every sign-in through every app client of the pool, also by programs that send a password themselves and know no such step. An account admin is therefore best an account of its own, not one that other programs sign in with.
- **An account admin may require MFA of an account** ([below](#an-account-that-must-use-mfa)): from then on our services serve it only with a session that passed MFA, and a session of before is refused at its next request.

## The account service

Requests are `{accountApiUrl}{route}`, json, answered `{ code, message, data }` and nothing else at the top level, as the [storage contract](storage-contract.md#requests) says it, with its codes (`0`, `-1`, `-3`, `-7` not signed in, `-8` not allowed with `data.reason`, `-10` over a limit with `data.limit`). CORS as there. Routes under `/me` and `/admin` need `Authorization: Bearer {access token}`: an id token is refused (`-7`).

- **A failure of the service itself** is `-1` with http 500, as at the storage service.
- **What AWS answers itself** comes in its own shape, and the client reads it by its http status: `401 { "message": "Unauthorized" }` is `-7`, `429` (the request rate passed) is `-10`, the `404 { "message": "Not Found" }` of a path outside `/me` and `/admin` is `-1`. An unknown path under `/me` or `/admin` is the service's own `-3`.
- **An account that is disabled or deleted** is answered `-8` with `data.reason: "accountDisabled"` on every route under `/me` and `/admin`, while its token is still good.

### For everyone

```text
GET  /status             { service: "react-doc-account", contractVersion: 1,
                           auth: { kind: "cognito", region, userPoolId, clientId },
                           isRegisterRequestOffered }
POST /register/request   { email, name, note? }     { requestId }
```

`register/request` is the one write without a token. It records a request for an account admin to look at and answers the same for any well-formed email, so it tells nobody which emails have accounts (the pool is never asked). It is throttled, keeps at most a few hundred open requests, one per email, and a request left unanswered is dropped after 30 days.

| case | answer |
| --- | --- |
| the same email again | the `requestId` it has already; nothing is written |
| the open requests are at their cap | `-10`, `data.limit: "requestOpenCount"`, for every email alike |
| the deployment does not offer requests (`isRegisterRequestOffered: false`) | `-8`, `data.reason: "registerRequestNotOffered"` |
| an email over 254 characters, a name over 100, a note over 1000 | `-1` |

### For a signed-in person

```text
GET  /me                 { user }
POST /me/name/set        { name }                   { user }

user = { userId, userName, name, email, status: "active" | "disabled", groupList, isAdmin, isMfaEnabled,
         isMfaRequired, timeMfaRequired, cognitoStatus, timeCreated, identityList: [{ authSystemType, userIdFromAuth }] }
me   = user & { mfaAccess: "ok" | "setupRequired" | "signInRequired" }    (GET /me only: what the services make of
                                                                          the session that asked)
```

`/me` is what the page shows as "signed in as", and how it learns the user id our services use. The first `/me` of a person the user table does not know yet (an account made in the AWS console) adds them to it. `me/name/set` writes the name into the user table and into the pool, so the next id token carries it.

| field of `user` | meaning |
| --- | --- |
| `status` | `disabled` when the user table says so, or the pool has the identity disabled |
| `isAdmin` | in the group `account-admin`: the admin routes take it when `isMfaEnabled` is true too |
| `isMfaRequired`, `timeMfaRequired` | an account admin requires MFA of the account, since that time (`""` when not required) |
| `mfaAccess` | of `/me` only: `ok`, or why the services refuse this session: the account has no authenticator app (`setupRequired`), or the session began before what the requirement asks (`signInRequired`) |
| `cognitoStatus` | the state of the identity in the pool (`CONFIRMED`, `FORCE_CHANGE_PASSWORD` while the first sign-in is pending, `RESET_REQUIRED`, …); `""` for a user of the table without an identity in the pool |
| `timeCreated` | the time format of the project, in `+00`: `20261114_07443316+00` (a request has it too) |

### For an account admin

Every route below is refused with `-8` unless the caller is in the group `account-admin` **and has MFA turned on** (`data.reason`: `adminRequired`, `mfaRequired`). The group claim of the token is not enough: the pool must still have the caller enabled and in the group, so an admin who was removed is refused before its token expires.

```text
GET  /admin/user/list                                        { userList: [user] }
POST /admin/user/create     { userName?, email, name?, groupList? }   { user }     an invitation with a temporary password
                                                                                   goes to the email; userName defaults to it
POST /admin/user/update     { userId, name?, groupList? }    { user }
POST /admin/user/disable    { userId }                       { user }     cannot sign in, every session ended, refused by our services
POST /admin/user/enable     { userId }                       { user }
POST /admin/user/delete     { userId }                       {}           the identities and the rows of the user table removed;
                                                                          the data other services hold under the user id stays
POST /admin/user/password/reset   { userId }                 { user }     a new invitation while the first sign-in is pending;
                                                                          else a reset code by email
POST /admin/user/session/revoke   { userId }                 { user }     every refresh token of the user ended
POST /admin/user/mfa/reset  { userId }                       { user }     MFA turned off, for a lost device
POST /admin/user/mfa/require { userId, isRequired }          { user }     MFA required of the account (or not): every
                                                                          session it holds is ended when required
GET  /admin/group/list                                       { groupList: [{ name, description, isAdminGroup, isDefault }] }
GET  /admin/request/list                                     { requestList: [request] }
POST /admin/request/approve { requestId, userName?, groupList? }   { user }     creates the account (as user/create)
POST /admin/request/reject  { requestId }                    {}

request = { requestId, email, name, note, timeCreated }
```

- **An admin cannot lock itself out**: it cannot disable or delete itself, nor take the group `account-admin` from itself (`-8`, `data.reason: "selfLockout"`). Turning off its own MFA is allowed: the console then closes until it is on again.
- **`user/list` is the pool joined with the user table.** A user of the pool the table does not know yet is added by it; a user of the table without an identity in the pool is listed with `cognitoStatus: ""`.
- **`user/create` and `request/approve`:** `groupList` absent gives the default groups, `[]` none; a group the pool does not have is `-1`. A user name that is taken is `-1`; the same email under another user name is allowed.
- **`user/password/reset`** of an account that signed in before ends its password at once: the next sign-in is told so and asks for the code of the email ([Signing in](#signing-in-inside-the-page)).
- **`user/delete` and a token still good.** The access token of a deleted account lives up to an hour. The account service refuses it; a service that resolves a token to a user by itself would make a new, empty user for it. Disabling an account first and deleting it an hour later closes the gap ([what is left](README.md#what-is-left-for-later)).
- **A deployment may be set not to send email** (config of the service, for tests): accounts are then made without an invitation, and `user/password/reset` is refused (`-1`).
- **`groupList` of an update replaces** the groups of the user. The groups a new account gets when none are named are config of the service (`group_default_list`); `group/list` marks them `isDefault`, so the console checks them first.
- **Why MFA is checked by the service.** A user pool cannot ask MFA of one group only. With MFA `OPTIONAL`, a user who turned it on is asked for the code at every sign-in, so "has MFA on" means "every session of this user passed MFA". The service reads it from the pool for the caller, per request (cached for a minute).

### An account that must use MFA

The pool asks MFA of nobody (`OPTIONAL`), and asks the code at every sign-in of an account that turned an authenticator app on. An account admin may **require** MFA of an account, for one that reaches what matters (the account admin's own, an account publishing pages). The requirement is ours, kept in the profile row of the user table, and every service of ours enforces it as it enforces a disabled account, through the same shared reading of the user table:

```text
an admin requires MFA of an account     POST /admin/user/mfa/require { userId, isRequired: true }
  -> the profile row: mfaRequired, the time it was required
  -> every refresh token of the account ended (as session/revoke)

a request of that account, at any service of ours
  -> the account has no authenticator app on (as the account service last read the pool)     -8  mfaSetupRequired
  -> the session signed in (auth_time of the token) before it was required, or before its
     app was turned on                                                                        -7  mfaSignInRequired
  -> else                                                                                      served
```

- **So a session that did not pass MFA is never served.** With the app on, Cognito asks the code at every sign-in; a token signed in after both times passed it. A session of before, still within its hour, is refused at its very next request: the services read the profile row for every request, not from a cache.
- **Turning the app on is the one thing left to an account without it.** `/me` answers it, with `mfaAccess`, and the page turns the app on through Cognito as for any account; `/me` then reads the pool again and records the time the app was turned on (`mfaEnabledTime` of the profile row). The session that did it began before, so the next step is to sign in again, with the code.
- **The services know the app from the profile row**, which the account service keeps in step with the pool whenever it reads the account (`/me`, the console's list, every admin route about it). An account turning its app off through Cognito's own api, past the page, is caught at its next such read; it needs a session that passed MFA to do so, so it opens nothing to someone holding the password alone.
- **`isRequired: false`** lifts the requirement and ends nothing. `mfa/reset` of a required account (a lost device) leaves it required: it must turn an app on again before it is served.
- **An admin may require MFA of itself**; its own sessions end too, and it signs in again with its code. Every admin route asks MFA of its caller anyway.
- Codes: `-7` with `data.reason: "mfaSignInRequired"` (sign in again; the page offers it), `-8` with `data.reason: "mfaSetupRequired"` (turn the app on). The storage service, the share service of the asset service and the account service answer them alike.

## First use

```text
the owner of the deployment, once
  -> ensure_architect.py of _0_auth_cognito: the pool, the app client, the groups, the tables, the account service;
     the first account admin is a user named in its config, put into account-admin
  -> an auth provider object in a doc page, with the four values the script prints
  -> signs in (the temporary password is replaced), opens the mode "admin" of the object
       -> "turn on MFA to manage accounts": the QR code, the 6 digits -> the console opens

a new person
  -> the sign-in dialog, "Ask for an account": email, name, a note
  -> the account admin sees the request in the console, approves it with the groups it should have
  -> an email with a user name and a temporary password
  -> the person signs in, chooses a password, and the storage point works
```

## Linking more identity providers (not built)

The user table already maps one user id to several identities, and every service reads the user id. What is missing is the way in: another kind of auth provider (Google, a self-hosted one) on the page, or the same pool federating it, and a route linking the identity to a user. See [what is left](README.md#what-is-left-for-later).

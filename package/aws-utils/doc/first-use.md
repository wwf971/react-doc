<!-- First use of the package aws-utils: what the owner of a deployment does once, and what a new person does. Parent document: README.md. -->

# First Use

Three roles meet here, and each has little to do:

```text
the owner of the deployment   once: the backends on AWS, an auth provider and a storage point in a doc page
the account admin             now and then: approves a request, issues or revokes an account
a person                      asks for an account, signs in, and uses what the doc page keeps in the cloud
```

## The owner, once

**1. The backends.** In the repository `aws_oa`, with the access key of its **deploy user** in `config/config.0.yaml` (an IAM user of your AWS account made for running these scripts; it is never the root user):

```sh
python3 -m pip install -r requirements.txt            # once: boto3 and PyYAML
cd _0_auth_cognito && python3 ensure_architect.py     # the user pool, the user table, the account service
cd ../_5_doc_storage && python3 ensure_architect.py   # the storage service
```

The first script creates the accounts of its config, among them the first account admin (a user of the pool in the group `account-admin`; Cognito sends each new one an invitation with a temporary password), and prints what a page needs; the second prints the url of the storage service. Both can be run again at any time: they change only what differs.

- **A call the deploy user may not make** is not fatal: the script does the rest and ends with what was denied, the IAM policy that allows it, and the arn of the deploy user. Allowing it is a step for a person who may edit IAM:

  ```text
  AWS console -> IAM -> Users -> the deploy user (the arn the script printed) -> Permissions
    -> Add permissions -> Create inline policy -> JSON -> paste the policy the script printed -> Create policy
  run the script again: it does what was left undone
  ```

  One denial matters for what follows: setting the MFA of the pool (`cognito-idp:GetUserPoolMfaConfig`, `cognito-idp:SetUserPoolMfaConfig` on the user pool). Until the script prints `mfa: set to optional, authenticator apps on` nobody can turn on an authenticator app, so the console of step 5 stays closed, and the dialog says *The user pool does not take authenticator apps yet*. The whole policy a deployment needs is in the implementation document of each backend (`auth_cognito_impl.md`, `doc_storage_impl.md` in `aws_oa`), and the steps once more in `doc/aws_oa_impl.md` there.
- **Which account is the admin.** An account with MFA on is asked for the code at every sign-in, through every program that signs in to the pool. A program that sends a password itself and knows no MFA step stops working for that account, so the admin is best an account of its own.

<a id="the-quick-way-a-demonstration-doc-page"></a>**The quick way: a demonstration doc page.** Steps 2 to 4 below are what a doc page of your own needs. To see it all working first, a script makes a small doc page from the values the two ensure scripts wrote, with an auth provider, a storage point and a notebook in it (run from `main/frontend` of react-doc):

```sh
node --import tsx --import ./src/lib/node-test-register.js ../../package/aws-utils/script-demo/demo-create.mjs \
    --out ../../temporary/aws-demo --aws-oa ../../../aws_oa
node cli/doc-cli.js dev ../../temporary/aws-demo
```

Make it somewhere git does not track: the values of a deployment are its owner's.

**2. The package.** A doc page names the package in its entry, or the workspace does:

```yaml
# .doc-page/entry.yaml
packageList:
  - name: aws-utils
```

**3. An auth provider.** In the settings panel, tab **Frontend objects**: **New object**, type *Cognito auth provider*. Then its metadata, with the four values the first script printed (Frontend objects tab, the object, metadata; or the entry asset by hand):

```yaml
metadata:
  auth:
    region: us-east-1
    userPoolId: us-east-1_AbCdEfGhI
    clientId: 1example23456789
    accountApiUrl: https://abc123.execute-api.us-east-1.amazonaws.com
```

**4. A storage point**, naming the provider by its reference:

```yaml
# .doc-page/asset-storage.yaml (or .doc-workspace/asset-storage.yaml, for every doc page)
storagePointList:
  - id: cloud
    type: aws-utils.remote
    label: Cloud
    config: { url: "https://def456.execute-api.us-east-1.amazonaws.com" }
    auth: { provider: frontend:w6abcdefghi }
```

The Asset service tab now lists the point under **Points the page reaches itself**, with **Check** saying whether the service answers.

**5. The first sign-in of the admin.** A block of the provider in any document:

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w6abcdefghi
mode: admin
```
````

```text
Sign in                         the user name of the config, the temporary password of the invitation email
  -> Choose a password          the temporary one is replaced
  -> "Turn on the authenticator app…"
       scan the QR code, type the 6 digits
  -> the console opens          from now on the code is asked at every sign-in
```

## A partition in the cloud

- **A new object**: its type declares the partition with the point (`storagePoint: cloud` of `partitionList`), and the first write makes it at the service.
- **An object that exists**: Frontend objects tab, its partition, **Storage…**, the point, **Move**. Every item goes there with its history; the keys, names and paths of its assets stay.
- **On another machine**: the folder of a partition kept out of git is not there. **Create or claim** of the partition binds it to the point and finds what the point already holds for this object.
- **Back to files**: **Storage…**, `file-tree` or `file-pack`, **Move**; with **keep a copy** checked, what the point holds stays there.

## A new person

```text
the sign-in dialog -> "Ask for an account"      email, name, a note
  ... the account admin approves the request in the console, choosing its groups
an email arrives                                a user name and a temporary password
Sign in -> Choose a password                    and the storage point works
```

What a person may use is said by the groups of the account: `doc-storage` for the storage service. An account without it signs in and is told that the storage service does not take it.

## When something does not work

| what the page says | what it means |
| --- | --- |
| *the storage point … names no auth provider* | `auth: { provider: frontend:{id} }` is missing in `asset-storage.yaml` |
| *sign in to … to reach the storage point* | nobody is signed in to the provider of the point |
| *the storage service … did not accept the session* | the token was refused: the session ended, or the service trusts another user pool than the provider (the panel of the point says so) |
| *not allowed* (`groupRequired`) | the account lacks the group the storage service asks for: the account admin adds it (**Edit…** of the account, role `doc-storage`). The person then presses **Refresh** of the partition, or reloads: the page fetches a token that carries the group; signing in again is not needed |
| *not allowed* (`accountDisabled`) | the account was disabled by an account admin |
| *out of reach* / *shown from the cache* | the service was not reached; what the browser kept is shown, and nothing is written until it answers |
| *An account admin signs in with an authenticator app* | the console asks for MFA: turn it on, then it opens |
| *The user pool does not take authenticator apps yet* | the MFA setting of the pool is off: the ensure script of `_0_auth_cognito` sets it, once its deploy user may ([The owner, once](#the-owner-once)) |
| *The password of this account was reset* | an account admin reset it: the email of the account has a code, and the dialog asks for it with a new password |

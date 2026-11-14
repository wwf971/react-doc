# Cloud Storage and Signing In

A partition of a frontend object can be kept **in the cloud** instead of in the folders of the doc page: at a storage point of a remote type, which the page reaches itself, as the person signed in. The data is then the same on every machine, and it is read and written on a statically built page too. Two layers make it, kept apart:

```text
asset storage layer     a storage point of a remote type holds the partition       main/doc_page_impl_asset_storage.md
auth layer              an auth provider signs the person in; its session signs     main/doc_page_impl_auth.md
                        the requests of the storage point
package aws-utils       the storage type aws-utils.remote (a storage service on     the section "aws-utils" of the side panel
                        AWS) and the auth kind cognito (Amazon Cognito)
```

## What is here without a backend

This demonstration is tracked by git, and a backend belongs to whoever deploys it, so nothing here names one. What the page shows all the same:

- **Settings panel, Asset service, Storage points.** The table **Storage types** lists `aws-utils.remote` below `remote`, with what it promises beyond the two common api sets: a cache and authorization. The point `team-remote` of this doc page is of the type `remote` itself, a contract without a driver, and is listed as *contract only*.
- **The documents of the package**, in the side panel section `aws-utils`: what it brings, first use, and the two contracts its backends on AWS are written against.

## The demonstration with a backend of your own

A script of the package makes a small doc page that uses your deployment: an auth provider, a storage point, and a notebook whose partition `cloud` is held by that point. It is made outside of what git tracks.

```sh
cd main/frontend
node --import tsx --import ./src/lib/node-test-register.js ../../package/aws-utils/script-demo/demo-create.mjs --out ../../temporary/aws-demo --aws-oa ../../../aws_oa
node cli/doc-cli.js dev ../../temporary/aws-demo
```

`--aws-oa` names the repository holding the two backends, whose ensure scripts wrote what the page needs into their `config_gen.yaml`; the five values can be given one by one instead (`--region`, `--user-pool-id`, `--client-id`, `--account-api-url`, `--storage-url`).

What to try there:

```text
Sign in                           the session line of the first block; the notebook's partition "Cloud" fills
Edit, then New note… in Cloud     written at the storage service; open the page in another browser, sign in: it is there
Refresh                           asks the service whether the partition changed elsewhere
settings, Asset service           "Points the page reaches itself": the session, Check, the cache, Refresh, Clear
settings, Frontend objects        the notebook, Partitions: Storage… moves "This doc page" to the cloud and back;
                                  Copy… copies the notes of one partition into the other
the document Account admin        the console: a new account, a request approved, an account disabled
react-doc build … --out x.html    the built page signs in and reads the cloud partition with no server
```

## Declaring it in a doc page

Three things, each a few lines ([First use](../package/aws-utils/doc/first-use.md) has them with every step):

```yaml
# .doc-page/entry.yaml: the package
packageList:
  - name: aws-utils

# .doc-page/asset-storage.yaml: the storage point
storagePointList:
  - id: cloud
    type: aws-utils.remote
    config: { url: "https://abc123.execute-api.us-east-1.amazonaws.com" }
    auth: { provider: frontend:w6abcdefghi }

# .doc-page/type.yaml: a partition of a type bound to the point
typeList:
  - id: my.notebook
    extendList: [aws-utils.notebook]
    partitionList:
      - { id: local, label: This doc page, isDefault: true }
      - { id: cloud, label: Cloud, storagePoint: cloud }
```

and the auth provider, a frontend object of the type `aws-utils.auth-cognito` whose entry names the user pool (`metadata.auth`). A partition that exists is moved to the point in the Frontend objects tab (**Storage…**).

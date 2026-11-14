<!-- The contract of the storage type aws-utils.remote: what a storage point of this type declares, and every request the page sends to the storage service. This document is the source of truth; the AWS backend (aws_oa `_5_doc_storage`) is written to answer it. Parent document: README.md. The layer it plugs into: @react-doc/main/doc_page_impl_asset_storage.md. -->

# Storage Contract of `aws-utils.remote`

A storage point of the type `aws-utils.remote` keeps partitions of frontend objects at a **storage service** on AWS. The page talks to the service directly from the browser, over https with CORS, so it works the same on the development server and on a statically hosted page. This document fixes what the two sides promise each other. The page side is `storage/` of this package; the service is the sub-project `_5_doc_storage` of the repository `aws_oa`, which is implemented against this document and never the other way round.

```text
the page (browser)                                         the storage service (AWS)
  storage point "cloud"          https + CORS                API Gateway (http api, jwt authorizer)
    type   aws-utils.remote   ─────────────────────────►       │
    url    https://….amazonaws.com      Authorization:         ▼
    space  cloud                         Bearer {token}      Lambda: the routes of this document
    auth   frontend:{id} ──► an auth provider                  │               │
                             (auth-contract.md)                ▼               ▼
                                                             DynamoDB        S3
                                                             spaces, partitions,  the bytes of
                                                             items, records       large versions
```

## The concepts

- **The service** is one deployment, reached by one url. It serves many accounts.
- **An account** is the person a token stands for. The service knows a person by its own **user id** (the user table of the auth backend), never by the id an identity provider gave, so a person keeps the data when another identity is linked later.
- **A space** is the area of one storage point at the service: everything a point reads or writes lies in its space. A space belongs to one account and is named by a **key** unique in that account; the key is the id of the storage point unless the point says another one. So the same point declared on two machines by the same person reaches the same data, and two points never see each other's.
- **A partition** is a partition of a frontend object held in a space, identified by its object and its name: `{ ownerRef, partition }` (with `ownerTypeId`, the type of the object, said for people). It holds items and the records of the object about them.
- **An item** is an asset item as the asset store knows it (`@react-doc/main/doc_page_impl_asset.md#stores-items-versions`): metadata, versions, a head, locks, events. The service applies the same rules as the local store, so an item behaves the same wherever it is held.
- **A record** is one line of the item list of the object: `{ key, kind, itemId, name?, pathList? }`. A remote partition has no `item-list.yaml`; its records are kept at the service and travel with it.
- **The revision** of a partition is a number that grows by one with every write into the partition. It is how the page knows whether its cached copy is still the truth.

## What a storage point declares

```yaml
# asset-storage.yaml of a workspace or a doc page
storagePointList:
  - id: cloud
    type: aws-utils.remote
    label: Cloud
    config:
      url: https://abc123.execute-api.us-east-1.amazonaws.com   # the service
      space: cloud                 # optional: the key of its space; absent, the id of the point
      cacheMode: readThrough       # readThrough | pinned | none (the cache is the page's: see the storage layer)
    auth:
      provider: frontend:w6abcdefghi   # the auth provider whose session signs the requests (auth-contract.md)
```

| key | meaning | default |
| --- | --- | --- |
| `config.url` | the base url of the service, without a trailing `/` | required |
| `config.space` | the key of the space of this point: lower case letters, digits, `.`, `_`, `-`, at most 64 | the id of the point |
| `config.cacheMode`, `config.isRefreshedOnFocus`, `config.refreshIntervalSec` | how the page caches and refreshes: keys of the type `remote`, not sent to the service | `readThrough`, `false`, `0` |
| `config.isNotifyEnabled` | reserved: turns on the api set `notify` ([Notifications](#notifications-reserved)) | `false` |
| `auth.provider` | the reference of an auth provider object | required |

Nothing secret is written in the file: the url and the reference are public, and what proves the person is the session of the auth provider.

## Requests

- **Where.** `{config.url}{route}`. Reads are `GET` with the arguments as a query string, writes are `POST` with a json body.
- **Who.** `Authorization: Bearer {access token}`, the access token of the session of the auth provider. Only `GET /status` is answered without it.
- **Which space.** Every route but `/status`, `/account` and `/space/list` names the space: `space={key}` in the query, or `"space": "{key}"` in the body.
- **Answer.** Always a json object `{ code, message, data }`, as every backend of the asset layer answers: `code` an integer (0 done, negative a failure), `message` a text, `data` whatever the route answers; `message` and `data` may be left out, and no other key stands beside them. It holds for every answer the service itself gives: a success, a refusal, an unknown route, a body that does not parse, a failure nobody foresaw. The http status follows the code, except where the service itself failed.
- **Time zone.** A write may say `timeZone: "+09"`; the times the service writes into the item (events, versions) are then in that zone, else in `+00`. The format is the one of the project: `20261020_18495741+09`.
- **CORS.** The service allows any origin, the methods `GET`, `POST`, `OPTIONS` and the headers `authorization`, `content-type`. It sets no cookie.

| code | http | means |
| --- | --- | --- |
| `0` | 200 | done |
| `-1` | 400 | a bad request: a missing argument, a value out of its grammar, a rule of the store broken (a locked item, the head deleted) |
| `-2` | 409 | the data changed since the caller read it (`hashBase` does not match) |
| `-1` | 500, 503 | the service itself failed, whatever was asked. `503`: a write that could not get past the writes of others; sending it again is right |
| `-3` | 404 | no such space, partition, item, version or record; no such route, or a route asked with the other method |
| `-7` | 401 | no token, or one the service does not accept |
| `-8` | 403 | the token is good, and the account may not do this: it is disabled, it lacks the group the service asks for, or the space is not its own. `data.reason` says which: `accountDisabled`, `groupRequired`, `spaceForbidden` (kept for shared spaces: never answered while a space belongs to one account) |
| `-10` | 413 | over a limit of the service; `data.limit` names it: a key of `limit` of `/status`, or `answerSizeMax` for an answer too large to send |

The codes `-4`, `-5` and `-6` of the asset layer are the page's own and are never answered by the service; `-9` is what the page says when the service cannot be reached.

**What AWS answers itself.** A few answers are given before the code of the service runs, in AWS's own shape and not ours. The page driver turns each into the shape above by its http status, so nothing above the driver ever sees another shape:

| http | body | when | read as |
| --- | --- | --- | --- |
| 401 | `{ "message": "Unauthorized" }` | no token, or one the authorizer refuses | `-7` |
| 429 | `{ "message": "Too Many Requests" }` | the request rate of the api is passed | `-10` |
| 413 | `{ "message": "Request Entity Too Large" }` | a body larger than a request may be: larger data goes by an upload | `-10` |
| 404 | `{ "message": "Not Found" }` | a method the api has no route for (anything but `GET`, `POST`, `OPTIONS`) | `-1` |
| 5xx | `{ "message": "Internal Server Error" }` or alike | the function could not be run, or did not answer in time | `-1` |

The signed urls of [large data](#large-data) are S3's own: a `PUT` of another size or type than signed, or an expired url, is refused with `403` and an xml body.

## Who may touch what

```text
a request arrives
  -> API Gateway checks the token: signed by the user pool, not expired, issued to a client the service lists
  -> the service finds the account: token subject -> user id (the user table)
       -> the account is disabled, or lacks the group the service asks for          -> -8
  -> the space: (user id, key) -> the space of that account, and no other
       -> space/ensure and partition/create make a space that does not exist yet;
          every other request into it answers "not found" (-3)
  -> the partition, the item: looked up inside that space only
       -> an id of another space is "not found" (-3), never "forbidden": nothing says it exists
```

So a storage point can only reach the data of its own space, and a person only the spaces of the account they signed in as. Ids of partitions and items are not secrets: knowing one gives nothing without a token of its account. The S3 urls the service hands out for large data ([Large data](#large-data)) are signed for one object and a few minutes.

Sharing a space between accounts is not part of this contract yet ([what is left](README.md#what-is-left-for-later)).

## The routes

### The service and the account

```text
GET  /status          no token      { service: "react-doc-storage", contractVersion: 1,
                                      apiSetList: ["item", "partition", "cache", "auth"],
                                      auth: { kind: "cognito", region, userPoolId, clientIdList },
                                      limit: { dataInlineMax, dataSizeMax, itemMetaSizeMax, requestListMax,
                                               spaceCountMax, spaceSizeMax } }
GET  /account                       { userId, name, groupList, limit, usage: { spaceCount, size } }
```

`/status` lets a page check a url before anyone signs in, and says which user pool the service trusts, so a point whose auth provider is of another pool is reported before a request fails.

| `limit` | what passes it (`-10`) |
| --- | --- |
| `dataInlineMax` | data said inside a request: it goes by an upload instead |
| `dataSizeMax` | the bytes of one version |
| `itemMetaSizeMax` | the metadata of one item: its versions, their metadata, its events |
| `requestListMax` | the requests of one `item/get/list` |
| `spaceCountMax` | the spaces of one account |
| `spaceSizeMax` | the bytes of every version in one space |

### Spaces

```text
GET  /space/list                                   { spaceList: [space] }      the spaces of the account
GET  /space/get      space                         { space }                   -3 when the account has none of that key
POST /space/ensure   { space, label? }             { space, isCreated }        made when missing
POST /space/meta/set { space, label }              { space }
POST /space/delete   { space, isPurged? }          {} | { space }    refused (-1) while it holds partitions
                                                                     (one marked deleted counts), unless isPurged

space = { spaceId, key, label, timeCreated, partitionCount, itemCount, size }
```

`itemCount` and `size`, here and of a partition, count everything held: items marked deleted, and every version of every item.

### Partitions

```text
GET  /partition/list     space                                { partitionList: [partition] }   deleted ones included
GET  /partition/get      space, partitionId, revisionKnown?   { partition, isSame: true }
                                                              | { partition, isSame: false, recordList, itemList }
POST /partition/create   { space, ownerRef, ownerTypeId, partition }   { partition, isCreated }
POST /partition/rename   { space, partitionId, partition }             { partition }
POST /partition/delete   { space, partitionId, isPurged? }             { partition? }
POST /partition/restore  { space, partitionId }                        { partition }

partition = { partitionId, ownerRef, ownerTypeId, partition, revision, isDeleted, itemCount, size,
              timeCreated, timeUpdated }
```

- **`partition/get` is the whole index of a partition**: its records in order, and the metadata of every item (no data of a version). With `revisionKnown` equal to its revision it answers `isSame: true` and nothing else, which is what makes a refresh cheap. The index is one answer, without pages: one too large to send is `-10` with `data.limit: "answerSizeMax"` (in practice a partition with a very long history).
- **`partition/create`** with an identity `{ ownerRef, partition }` the space has already answers that partition and `isCreated: false`; it makes the space when it is missing. This is also how an object **claims** its partition from a point: it asks `partition/list` and finds its own identity.
- **`partition/delete`** marks the partition deleted: it stays at the service with everything in it, is listed with `isDeleted: true`, and comes back with `partition/restore`. While marked it is still read and refuses every write (`-1`); `partition/create` of its identity answers it as it is (`isCreated: false`, `isDeleted: true`), and the page restores it before it writes.
- **`isPurged`** removes the rows and the bytes for good, of a partition or of a whole space. Much data is more than one request removes: the answer then still carries the thing (`{ partition }`, `{ space }`), and the same request is sent again until it answers `{}`. A partition being purged cannot be restored.
- **`partition/rename`, `partition/delete` and `partition/restore` grow the revision**, as every write into the partition does.
- `ownerRef` is a reference of the object registry (`frontend:{id}`); `partition` is a folder name of the frontend object layer (`[A-Za-z0-9][A-Za-z0-9_.-]*`).

### Items

Every route below takes `space` and `partitionId`, and every write answers the `revision` of the partition after it. A write that changes nothing (a lock that is that already, the same place, a record as it is) writes nothing and answers the revision as it was.

```text
POST /item/get/list     { requestList: [{ itemId, versionId }] }     { answerList: [{ code, data: { item, version }, message }] }
POST /item/create       { lang, contentType?, fileExt?, component?, owner?, saveMode?, groupPath?, note?,
                          dependencyList?, versionMetadata?, text | dataBase64 | uploadId, record? }
                                                                      { item, version, record?, revision }
POST /item/update       { itemId, hashBase, text | dataBase64 | uploadId, mode?, note?, dependencyList?, versionMetadata? }
                                                                      { item, version, revision }
POST /item/meta/set     { itemId, lang?, contentType?, component?, owner?, saveMode? }     { item, revision }
POST /item/move         { itemId, groupPath }                         { item, revision }
POST /item/delete       { itemId, isRecordRemoved? }                  { item, revision }     the deletion mark
POST /item/restore      { itemId }                                    { item, revision }
POST /item/lock/set     { itemId, isLocked }                          { item, revision }
POST /item/remove       { itemId }                                    { revision }           for good, with its record
POST /item/import       { item, versionList: [{ versionId, text | dataBase64 | uploadId, metadata? }], record? }
                                                                      { item, record?, revision }
POST /version/checkout      { itemId, versionId }                     { item, revision }
POST /version/delete        { itemId, versionId }                     { item, revision }
POST /version/lock/set      { itemId, versionId, isLocked }           { item, revision }
POST /version/metadata/set  { itemId, versionId, versionMetadata }    { item, version, revision }
POST /dependency/set        { itemId, versionId, dependencyList }     { item, revision }
POST /dependency/add        { itemId, versionId, dependency }         { item, revision }
POST /dependency/remove     { itemId, versionId, dependency }         { item, revision }
POST /group/move            { groupPathFrom, groupPathTo }            { itemList, revision }
```

```text
item = { itemId, name: "", lang, contentType, fileExt, component?, owner?, saveMode?, versionIdHead, isDeleted, isLocked,
         timeCreated, groupPath, revision,
         versionList: [{ versionId, versionIdPrevList, time, note, size, hash, isLocked, dependencyList }],
         eventList: [{ eventType, time, versionId?, placeFrom?, placeTo?, userId }] }
version = { versionId, size, hash, isText, metadata, text? | dataBase64? | dataUrl? }
```

**The rules of an item are those of the asset store**, and the service enforces them, so they hold whichever client writes:

- **Ids** are ms_48 ids made by the service; `item/create` and `item/import` may bring an `itemId` (and version ids), which must be free in the partition.
- **`item/create` needs `lang`** (`""` is one).
- **The `version` a write answers is without its data**: the caller has the bytes it sent.
- **Save modes.** `item/update` rewrites the head in place or makes a new version, by `mode`, else by the `saveMode` of the item, else in place. A locked head is not rewritten in place (`-1`).
- **`hashBase`** is the hash of the head the caller started from; another hash at the service is `-2`, and nothing is written.
- **Locks.** A locked version is neither rewritten nor deleted; a locked item accepts only its unlocking, so `item/remove` of one is refused too.
- **Deleting.** `item/delete` is a mark; the head is never deleted; `version/delete` relinks the versions made from the deleted one to its predecessors.
- **Events.** Every write appends its event, with the user id of the account. The service keeps the last 200 events of an item. `placeFrom` and `placeTo` of a `move` event are group paths, without the name of the partition.
- **Hash and text.** `hash` is the sha1 of the bytes, in hex. A version is text when its bytes are valid utf-8 without a NUL byte. Text is answered byte for byte: a byte order mark at its start stays in `version.text`.
- **`revision` of an item** is the revision of its partition at the last write that touched the item (its data, its metadata, a version's metadata, its place). The page keeps what it read of an item while this number stands.
- **`versionId: "head"`** in a request means the head of the item, and so does an absent or empty one, except where a version is changed: `version/checkout`, `version/delete` and `version/lock/set` need it said.
- **`groupPath` is the place inside the partition** (`book`, `history/edu`, `''` at its top), without the name of the partition: renaming a partition touches no item. The page shows an item at `{partition}/{groupPath}`.
- **No names.** An item of a remote partition has no name of the store (`name` is always `""`, and a write bringing another is `-1`): what people call it is the `name` of its record.
- **`group/move`** moves every item below a group path, with a `move` event in each; a target that holds items already is refused (`-1`).

**Items and records are written together where the object needs both:**

- `item/create` with `record: { key, kind, name?, pathList? }` makes the item and records it, or does neither. It is the write behind `asset/create` of a frontend object. A key the partition has already is `-1`.
- `item/delete` with `isRecordRemoved: true` takes the record off and marks the item deleted (`asset/remove`).
- `item/import` writes an item **with the history it is given**: its metadata, every version with its id, bytes and metadata, and its record. An item of that id in the partition is replaced, whatever its locks, and keeps its record when the request brings none. It adds no event of its own, and takes the size and the hash of a version from the bytes it is given. It is what moves a partition, or one item, between two storage points ([Moving data between points](#moving-data-between-points)).

**One write is one step, with two exceptions.** A write is done whole or not at all, and grows the revision by one. `group/move` and `record/order/set` over many rows (more than about 60) are done in several such steps: the revision grows by their number, and a request cut in the middle leaves a part done, which asking again finishes.

### Records

```text
POST /record/set      { key, kind?, name?, pathList?, itemId? }     { record, revision }    name: null removes it;
                                                                                           with itemId: a new record of an existing item
POST /record/remove   { key }                                       { revision }            the record only; its item stays
POST /record/order/set { keyList }                                  { revision }            the order of the list

record = { key, kind, itemId, name?, pathList? }
```

A key is unique in the partition, and an item has one record at most: a second record of an item, or the key of another item, is `-1`. `record/set` of a key the partition does not have makes a record when it names an `itemId`, and is `-3` when not. An empty `pathList` removes the paths, as `name: null` removes the name. `record/order/set` puts the keys it names first, and the records it does not name after them in the order they had. Whether a key or a path is unique **in the whole object**, across its partitions, and whether the type of the object accepts the asset, is checked by the page, which knows the other partitions and the type; the service knows one partition.

### Large data

The data of a version travels inside the request or the answer while it is small, and through S3 directly when it is not.

```text
writing    size <= limit.dataInlineMax     text | dataBase64 in the body of item/create, item/update, item/import
           larger                          POST /data/upload/begin { space, partitionId, size, contentType? }
                                             -> { uploadId, url, method: "PUT", headerMap, timeExpire }
                                           the page PUTs the bytes to url with headerMap, then names uploadId in the write
reading    a text version, small           version.text
           a binary version, small         version.dataBase64
           larger, text or not             version.dataUrl: a signed url to GET the bytes from, valid for a few minutes
```

An answer of `item/get/list` holding many versions switches to `dataUrl` for the rest once its inline data passes what the service sends in one answer (config of the deployment, not one of `limit`), so a reader takes whichever of the three ways a version comes.

An upload is used by one write, in the partition it was begun for; an `uploadId` that is not there (not sent yet, expired, used) is `-3`. `timeExpire` follows the `timeZone` of the request, as every time the service writes.

## Revisions and the cache

The page keeps a copy of what it read (the index of each partition, the data of the versions it showed) and uses the revision to know when the copy is stale:

```text
page start, or a refresh
  -> GET /partition/get  revisionKnown = the revision of the cached index
       -> isSame: true                    the cache is the truth: nothing else is read
       -> isSame: false                   the new index replaces the cached one; a cached version whose hash
                                          is no longer the one of its version is dropped
a write of the page
  -> the answer carries the revision after it
       -> the revision known + 1          nobody else wrote: the answer is applied to the cache
       -> more                            somebody else wrote meanwhile: the index is read again
the data of a version
  -> cached under (itemId, versionId, hash): bytes never change under one hash, so they are never asked twice
```

How long the page trusts the cache before it asks (`cacheMode`, refreshing on focus or by a timer, the Refresh button) is the page's business and is described with the storage layer (`@react-doc/main/doc_page_impl_asset_storage.md#the-cache-of-a-remote-point`).

## Moving data between points

A partition, or one item, moves between a local point and this one, or between two remote points, **through the page**: it reads from one side and writes to the other.

```text
a partition to this point                     a partition away from this point
  -> partition/create (its identity)            -> partition/get: the records, the items
  -> for every item:                            -> for every item: item/get/list with every version
       read every version at the source         -> written at the target with its history
       item/import { item, versionList, record }-> partition/delete (or it is kept as a copy)
  -> partition/get: every hash compared
  -> the bind of the partition is switched
```

`item/import` replaces an item of the same id, so a transfer that stopped halfway is simply run again.

## Notifications (reserved)

A point is always asked; the service never calls the page. Being told of a change made elsewhere is a separate api set, `notify`, that a point turns on with `config.isNotifyEnabled: true` and the service offers by listing `notify` in `apiSetList` of `/status`. This contract version does not define its routes, and the service does not list it; the page then refuses the flag with a problem of the point instead of pretending. What it is for, and what it would be built on, is in [what is left](README.md#what-is-left-for-later).

## The service on AWS

The sub-project `_5_doc_storage` of `aws_oa` holds the implementation and its own design document (`doc_storage_impl.md`): the tables, the bucket, the role, the ensure script and the tests. What matters to a reader of this contract:

- **Nothing runs while nobody asks.** An http api of API Gateway, one Lambda function, a DynamoDB table billed per request and an S3 bucket: no instance, no minimum fee.
- **The limits** answered by `/status` are config of the deployment, and protect the account's bill: the size of one version, the size of a space, the number of spaces of an account.
- **A change of this document comes first.** `contractVersion` grows when a route changes meaning; the service answers the version it implements, and the page refuses a service of another major version with a problem of the point.

<!-- The architecture of the backends behind aws-utils (aws_oa _5_doc_storage and _0_auth_cognito) as scenes generated from a description, which the describe scripts of the backends write: what a reader can open, where the facts come from, how the block is kept in step. The block is DiagramAwsArchitecture of the package cloud-dev-vis (its comp-mdx/aws/comp-aws.md). Parent document: README.md. -->

# Storage Service Architecture

The storage service that answers [the storage contract](storage-contract.md), and the auth backend it trusts, drawn at several scales in one viewport: from "a page talks to two services" down to the keys of a table. Nothing here is drawn by hand: the block below is a **description** of the two backends, and every scene is generated from it.

```text
/system                         the two backends as frames, each showing what it holds; the page beside
                                them; what passes between them
/system/storage                 the storage service
   @resources @overview            its resources as cards, or as marks
   @read @write @upload @deploy    one request (or the deployment) step by step, on the same cards
/system/storage/api             its routes, in the groups of the contract
/system/storage/function        the modules of backend/, and what imports what
/system/storage/table           the kinds of rows of its one table, and what a row names
/system/storage/bucket          its keys, and what the lifecycle removes
/system/auth                    the auth backend: the user pool, the user table, the account service
   @issue                          an admin issues an account
/system/auth/api, …/userTable   the routes of the account service, the rows of the user table
```

**Moving around.** A click on a frame zooms into its backend; the menu after the path bar switches between its resources, its overview and its flows, and a card with more inside (the api, the function, a table, the bucket) opens a scene of its own. A mark of the other backend, at the edge of a scene, opens that backend. The path bar goes back and up.

**Where the facts come from, and keeping them in step.** The description is written by a script of each backend, offline, from what its ensure script makes the resources from: the config (limits, the lambda, throttles, MFA, how long an upload is kept), the names (with the prefix written `{prefix}`, so no deployment's own names appear), the routes of the code, the environment of the function and the policy of its role, the modules of `backend/` and what imports what; the kinds of rows of the tables are listed in the scripts as the design documents of the backends list them. Each script writes only its own group into this block:

```sh
cd aws_oa/_5_doc_storage  && python3 describe_architect.py --write-doc {react-doc}/package/aws-utils/doc/storage-architecture.md --block storage-architecture
cd aws_oa/_0_auth_cognito && python3 describe_architect.py --write-doc {react-doc}/package/aws-utils/doc/storage-architecture.md --block storage-architecture
```

A change of a backend is a run of its script; the diagrams follow. Without `--write-doc` a script prints the description.

<!--renderComp=DiagramAwsArchitecture,id=storage-architecture,title=The backends of aws-utils-->
```yaml
version: 1
title: The backends of react-doc
clientList:
- {id: page, title: The doc page, text: 'a storage point and an auth provider, in a browser', tone: slate}
- {id: deploy-user, title: The deploy user, text: runs the ensure scripts, tone: violet}
groupList:
- id: storage
  label: Storage service
  project: _5_doc_storage
  tone: teal
  icon: cloud
  description: partitions of frontend objects, kept for the person signed in
  resourceList:
  - id: api
    kind: aws-http-api
    name: '{prefix}--api'
    data:
      authorizer: 'jwt: the user pool'
      cors: 'any origin: GET, POST, OPTIONS'
      throttle: 20 a second, 40 at once
      properties:
      - {id: status, name: GET /status, value: no token}
      - {id: proxy, name: 'GET, POST /{proxy+}', value: 'a token: every other route'}
    detail:
      routeGroupList:
      - id: service
        name: The service and the account
        routes:
        - {method: GET, path: /status, auth: none}
        - {method: GET, path: /account, auth: token}
      - id: space
        name: Spaces
        routes:
        - {method: GET, path: /space/list, auth: token}
        - {method: GET, path: /space/get, auth: token}
        - {method: POST, path: /space/ensure, auth: token}
        - {method: POST, path: /space/meta/set, auth: token}
        - {method: POST, path: /space/delete, auth: token}
      - id: partition
        name: Partitions
        routes:
        - {method: GET, path: /partition/list, auth: token}
        - {method: GET, path: /partition/get, auth: token}
        - {method: POST, path: /partition/create, auth: token}
        - {method: POST, path: /partition/rename, auth: token}
        - {method: POST, path: /partition/delete, auth: token}
        - {method: POST, path: /partition/restore, auth: token}
      - id: item
        name: Items
        routes:
        - {method: POST, path: /item/get/list, auth: token}
        - {method: POST, path: /item/create, auth: token}
        - {method: POST, path: /item/update, auth: token}
        - {method: POST, path: /item/meta/set, auth: token}
        - {method: POST, path: /item/move, auth: token}
        - {method: POST, path: /item/delete, auth: token}
        - {method: POST, path: /item/restore, auth: token}
        - {method: POST, path: /item/lock/set, auth: token}
        - {method: POST, path: /item/remove, auth: token}
        - {method: POST, path: /item/import, auth: token}
        - {method: POST, path: /group/move, auth: token}
      - id: version
        name: Versions and dependencies
        routes:
        - {method: POST, path: /version/checkout, auth: token}
        - {method: POST, path: /version/delete, auth: token}
        - {method: POST, path: /version/lock/set, auth: token}
        - {method: POST, path: /version/metadata/set, auth: token}
        - {method: POST, path: /dependency/set, auth: token}
        - {method: POST, path: /dependency/add, auth: token}
        - {method: POST, path: /dependency/remove, auth: token}
      - id: record
        name: Records
        routes:
        - {method: POST, path: /record/set, auth: token}
        - {method: POST, path: /record/remove, auth: token}
        - {method: POST, path: /record/order/set, auth: token}
      - id: data
        name: Large data
        routes:
        - {method: POST, path: /data/upload/begin, auth: token}
  - id: function
    kind: aws-lambda
    name: '{prefix}--api'
    data:
      runtime: python3.12
      memory: 512 MB
      timeout: 29 s
      role: '{prefix}--api-role'
      properties:
      - {id: table_data, name: TABLE_DATA, value: the data table}
      - {id: bucket_data, name: BUCKET_DATA, value: the data bucket}
      - {id: table_user, name: TABLE_USER, value: the user table}
      - {id: service_config, name: SERVICE_CONFIG, value: 'limits, user pool, group'}
    detail:
      partList:
      - {id: item_logic, title: item_logic.py, tag: pure, text: 'the rules of one item: no boto3, no clock', tone: green}
      - {id: lambda_function, title: lambda_function.py, tag: the door, text: 'event of api gateway to request to
          http response; a second catch-all: a body not json 400, the service not made 500', tone: amber}
      - {id: storage_db, title: storage_db.py, tag: thin, text: 'the table: get, query, transact', tone: blue}
      - {id: storage_s3, title: storage_s3.py, tag: thin, text: 'the bucket: get, put, copy, delete, signed urls',
        tone: blue}
      - {id: storage_service, title: storage_service.py, tag: every route, text: 'request(): the only place an answer
          is made; anything unforeseen 500. The transactions', tone: amber}
      - {id: time_text, title: time_text.py, tag: pure, text: the time text 20261020_18495741+09, tone: green}
      - {id: id_util, title: id_util.py, tag: aws_utils, text: ms_48 ids and random ids, tone: slate}
      - {id: user_identity_util, title: user_identity_util.py, tag: aws_utils, text: 'a token to a user: the user
          table; a new person is added', tone: violet}
      - {id: table, title: '{prefix}--data', tag: DynamoDB, text: the table, tone: blue}
      - {id: bucket, title: '{prefix}--data', tag: S3, text: the bucket, tone: green}
      linkList:
      - {from: lambda_function, to: id_util}
      - {from: lambda_function, to: storage_db}
      - {from: lambda_function, to: storage_s3}
      - {from: lambda_function, to: storage_service}
      - {from: lambda_function, to: user_identity_util}
      - {from: storage_service, to: item_logic}
      - {from: storage_service, to: storage_db}
      - {from: storage_service, to: time_text}
      - {from: storage_db, to: table}
      - {from: storage_s3, to: bucket}
  - id: table
    kind: aws-dynamodb-table
    name: data
    data:
      nameLogical: '{prefix}--data'
      pk: pk (S)
      sk: sk (S)
      description: 'billed per request; no index: every read is a get, or a query of one pk'
      attributes:
      - {id: pk, key: PK, name: pk, type: S, holds: 'u#, s#, p#: whose'}
      - {id: sk, key: SK, name: sk, type: S, holds: what the row is}
    detail:
      rowKindList:
      - id: account
        name: account
        pk: u#{userId}
        sk: account
        column: 0
        description: the usage of an account
        attributes:
        - {name: spaceCount, type: N, holds: its spaces}
        - {name: size, type: N, holds: its bytes}
      - id: space
        name: space
        pk: u#{userId}
        sk: s#{key}
        column: 0
        attributes:
        - {name: spaceId, type: S, holds: the start of every key it holds}
        - {name: key, type: S, holds: the key a point names}
        - {name: partitionCount, type: N}
        - {name: itemCount, type: N}
        - {name: size, type: N, holds: within spaceSizeMax}
      - id: owner
        name: owner
        pk: s#{spaceId}
        sk: owner
        column: 1
        description: the claim of a space id, written with the space
        attributes:
        - {name: userId, type: S, holds: who claimed the id}
        - {name: key, type: S}
      - id: identity
        name: identity
        pk: s#{spaceId}
        sk: y#{partition}#{ownerRef}
        column: 1
        description: the identity of a partition
        attributes:
        - {name: partitionId, type: S, holds: one partition per identity}
      - id: partition
        name: partition
        pk: s#{spaceId}
        sk: p#{partitionId}
        column: 1
        attributes:
        - {name: revision, type: N, holds: one more with every write}
        - {name: ownerRef, type: S, holds: 'frontend:{id}'}
        - {name: partition, type: S, holds: its name}
        - {name: isDeleted, type: BOOL}
        - {name: recordOrderNext, type: N}
      - id: item
        name: item
        pk: p#{spaceId}#{partitionId}
        sk: i#{itemId}
        column: 2
        description: 'one row an item: a write of an item is one row'
        attributes:
        - {name: itemJson, type: S, holds: 'the item: versions, events, revision'}
        - {name: recordKey, type: S, holds: its record}
        - {name: size, type: N}
      - id: record
        name: record
        pk: p#{spaceId}#{partitionId}
        sk: r#{key}
        column: 2
        attributes:
        - {name: key, type: S}
        - {name: kind, type: S}
        - {name: itemId, type: S, holds: its item}
        - {name: order, type: N, holds: its place in the list}
      - id: bytes
        name: bytes in a row
        pk: p#{spaceId}#{partitionId}
        sk: d#{dataId}
        column: 2
        description: 'a blob kept in the database: as the storagePreference of the item wishes, up to dataRowAutoMax
          without one; the others are objects of the bucket'
        attributes:
        - {name: data, type: B, holds: a version up to dataInlineMax}
      linkList:
      - {from: space.spaceId, to: owner, label: 's#{spaceId}'}
      - {from: space.spaceId, to: partition}
      - {from: identity.partitionId, to: partition, label: 'p#{partitionId}'}
      - {from: item.recordKey, to: record, label: 'r#{key}'}
      - {from: record.itemId, to: item, label: 'i#{itemId}'}
      - {from: item.itemJson, to: bytes, label: versions kept in a row}
  - id: bucket
    kind: aws-s3-bucket
    name: '{prefix}--data'
    data:
      access: 'private: signed urls'
      versioning: 'off'
      properties:
      - {id: data, name: data/, value: the bytes kept in object storage}
      - {id: upload, name: upload/, value: 'bytes on their way: 1 day'}
      - {id: temp, name: temp/, value: 'copies for dataUrl: 1 day'}
    detail:
      partList:
      - {id: data, title: 'data/{spaceId}/{partitionId}/{dataId}', text: 'the bytes of one version kept in object
          storage, named by a write. Kept', tone: green}
      - {id: upload, title: 'upload/{spaceId}/{partitionId}/{uploadId}', text: 'bytes on their way: PUT by the page,
          not yet named by a write', tone: amber}
      - {id: temp, title: 'temp/{spaceId}/{partitionId}/{dataId}', text: 'a copy of a version kept in a row, made
          to answer it as dataUrl', tone: amber}
      - {id: lifecycle, title: Lifecycle, tag: upload_keep_day, text: 'removes what is under upload/ and temp/ after
          1 day, and an unfinished multipart upload', tone: red}
      linkList:
      - {from: lifecycle, to: upload, label: removed}
      - {from: lifecycle, to: temp, label: removed}
  - id: role
    kind: aws-iam-role
    name: '{prefix}--api-role'
    isEdge: true
    data:
      assumedBy: lambda.amazonaws.com
      properties:
      - {id: logs, name: Logs, value: 'CreateLogGroup, CreateLogStream, PutLogEvents'}
      - {id: usertable, name: UserTable, value: 'GetItem, Query, PutItem'}
      - {id: datatable, name: DataTable, value: 'GetItem, BatchGetItem, Query, PutItem, UpdateItem, DeleteItem,
          BatchWriteItem'}
      - {id: databucketobjects, name: DataBucketObjects, value: 'GetObject, PutObject, DeleteObject'}
      - {id: databucketlist, name: DataBucketList, value: ListBucket}
  - id: logs
    kind: aws-log-group
    name: /aws/lambda/{prefix}--api
    isEdge: true
    data: {retention: never expires}
  relationList:
  - {from: page, to: api, label: 'requests, Bearer token'}
  - {from: api, to: auth.pool, label: checks the token}
  - {from: api, to: function, label: every route}
  - {from: function, to: table, label: rows}
  - {from: function, to: bucket, label: 'objects, signed urls'}
  - {from: function, to: auth.userTable, label: subject to user id}
  - {from: function, to: role, label: runs as}
  - {from: function, to: logs, label: logs}
  flowList:
  - id: read
    label: A read
    title: 'A read: partition/get with a known revision'
    stepList:
    - {from: page, to: api, label: 'GET /partition/get, revisionKnown'}
    - {from: api, to: auth.pool, label: the token}
    - {from: api, to: function, label: the request}
    - {from: function, to: auth.userTable, label: subject to user id}
    - {from: function, to: table, label: 'the space, the partition'}
    note: {title: The answer, text: 'revision = revisionKnown: { partition, isSame: true }, nothing else is read',
      tone: green}
  - id: write
    label: A write
    title: 'A write: one transaction, one revision'
    stepList:
    - {from: page, to: api, label: 'POST /item/update, hashBase'}
    - {from: api, to: auth.pool, label: the token}
    - {from: api, to: function, label: the request}
    - {from: function, to: auth.userTable, label: subject to user id}
    - {from: function, to: table, label: 'read r, then one transaction'}
    note: {title: One transaction, text: 'the partition row: revision r + 1, on the condition revision = r; the
        item, the record, bytes kept in a row; the counters. The condition failed: read again, up to 8 times', tone: blue}
  - id: upload
    label: Large data
    title: 'Large data: a signed url, past the function'
    stepList:
    - {from: page, to: api, label: data/upload/begin}
    - {from: api, to: function, label: the request}
    - {from: function, to: bucket, label: 'a PUT url, signed for its size'}
    - {from: page, to: bucket, label: PUT the bytes}
    - {from: page, to: api, label: 'item/update, uploadId'}
    - {from: function, to: bucket, label: 'read once; kept in a row, or copied to data/'}
    - {from: function, to: table, label: the transaction names it}
  - id: deploy
    label: Deploy
    title: 'ensure_architect.py: what it makes, in order'
    stepList:
    - {from: deploy-user, to: table, label: the table}
    - {from: deploy-user, to: bucket, label: 'cors, lifecycle, tag'}
    - {from: deploy-user, to: role, label: the role}
    - {from: deploy-user, to: function, label: waits for the role}
    - {from: deploy-user, to: api, label: 'authorizer, routes, throttle'}
    note: {title: Ensure, text: 'creates what is missing, updates what differs from the config, never recreates.
        A call denied is reported and the rest goes on', tone: amber}
- id: auth
  label: Auth backend
  project: _0_auth_cognito
  tone: red
  icon: shield
  description: 'who a person is, for every service: sign-in, the user table, accounts'
  resourceList:
  - id: pool
    kind: aws-cognito-user-pool
    name: the user pool
    data:
      mfa: optional, TOTP
      description: the only place a password is checked; the access token carries the groups
      properties:
      - {id: group-admin, name: admin group, value: account-admin}
      - {id: group-default-0, name: a new account, value: doc-storage}
  - id: api
    kind: aws-http-api
    name: '{prefix}--account-api'
    data: {authorizer: 'jwt: access tokens of the accepted clients', cors: 'any origin: GET, POST, OPTIONS', throttle: '20
        a second, 40 at once; /register/request 1 a second'}
    detail:
      routeGroupList:
      - id: public
        name: Without a token
        routes:
        - {method: GET, path: /status, auth: none}
        - {method: POST, path: /register/request, auth: none}
      - id: me
        name: The account signed in
        routes:
        - {method: GET, path: /me, auth: token}
        - {method: POST, path: '/me/{proxy+}', auth: token}
      - id: admin
        name: The account admin
        nameLogical: an admin with MFA, checked against the pool
        routes:
        - {method: GET, path: '/admin/{proxy+}', auth: token}
        - {method: POST, path: '/admin/{proxy+}', auth: token}
  - id: function
    kind: aws-lambda
    name: '{prefix}--account-api'
    data: {runtime: python3.12, memory: 256 MB, timeout: 30 s, role: '{prefix}--account-api-role'}
  - id: userTable
    kind: aws-dynamodb-table
    name: user table
    data:
      nameLogical: '{prefix}-user'
      pk: user_id
      sk: auth_id
      description: 'who a user is for us: a user id of our own, its identities'
      attributes:
      - {id: user_id, key: PK, name: user_id, type: S}
      - {id: auth_id, key: SK, name: auth_id, type: S}
      - {id: gsi, key: GSI PK, name: auth_id, type: S, holds: 'gsi_auth_id: identity to user'}
    detail:
      rowKindList:
      - id: identity
        name: identity
        pk: '{user_id}'
        sk: cognito#{sub}
        column: 0
        description: one identity of the user in an auth service
        attributes:
        - {name: user_id, key: PK, type: S}
        - {name: auth_id, key: SK, type: S, holds: 'cognito#{sub}'}
        - {name: username, type: S}
      - id: profile
        name: profile
        pk: '{user_id}'
        sk: profile
        column: 0
        description: the user itself
        attributes:
        - {name: status, type: S, holds: 'active, disabled: what every service reads'}
        - {name: origin, type: S, holds: 'script, admin, auto, legacy'}
        - {name: email, type: S}
      - id: lock
        name: auth lock
        pk: auth-lock#cognito#{sub}
        sk: auth-lock
        column: 1
        description: 'which user an identity belongs to: written with a condition, so one person is one user'
        attributes:
        - {name: user_id_value, type: S, holds: the user of the identity}
      linkList:
      - {from: lock.user_id_value, to: identity, label: user_id}
  - id: requestTable
    kind: aws-dynamodb-table
    name: request table
    data:
      nameLogical: '{prefix}--account-request'
      pk: row_type
      sk: row_key
      description: requests for an account, kept for a time to live
      attributes:
      - {id: row_type, key: PK, name: row_type, type: S}
      - {id: row_key, key: SK, name: row_key, type: S}
  - id: role
    kind: aws-iam-role
    name: '{prefix}--account-api-role'
    isEdge: true
    data:
      assumedBy: lambda.amazonaws.com
      properties:
      - {id: pool, name: the user pool, value: admin calls on one pool}
      - {id: tables, name: the tables, value: rows of the user and request tables}
      - {id: logs, name: logs, value: its own log}
  relationList:
  - {from: page, to: pool, label: 'sign in: password, TOTP'}
  - {from: page, to: api, label: 'my account, the admin console'}
  - {from: api, to: pool, label: checks the token}
  - {from: api, to: function, label: every route}
  - {from: function, to: pool, label: admin calls}
  - {from: function, to: userTable, label: users}
  - {from: function, to: requestTable, label: requests}
  - {from: function, to: role, label: runs as}
  flowList:
  - id: issue
    label: Issuing an account
    title: An admin issues an account
    stepList:
    - {from: page, to: api, label: 'POST /admin/..., an access token'}
    - {from: api, to: pool, label: the token}
    - {from: api, to: function, label: the request}
    - {from: function, to: pool, label: 'an admin, with MFA?'}
    - {from: function, to: pool, label: 'AdminCreateUser, the groups'}
    - {from: function, to: userTable, label: 'identity, profile, lock row'}
    note: {title: The invitation, text: 'Cognito emails the user name and a temporary password: a password never
        passes through the service', tone: red}
```

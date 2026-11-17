<!-- Design of the client instance: how one running copy of a frontend (a tab, a window of the desktop app, a run of the mobile app, a script) names itself to a backend with a temporary id, so that a backend can say which instance made a change (the actor of a notification) and each instance recognizes its own changes. Shared by every service of react-doc and of the repository aws_oa, present and to come; its first users are the storage service of the package aws-utils and the notification channel (@react-doc/package/aws-utils/doc/notify-contract.md). Related: doc_page_impl_auth.md (the account a request is made as), doc_page_impl_asset_storage.md (the api set notify of a storage point). -->

# Client Instance: Design

A backend knows **who** asks by the account the request is signed as ([auth layer](doc_page_impl_auth.md)). It does not know **from where**: two tabs of one browser, the laptop and the phone of one person, a script run by that person are one account. That is enough to decide what a request may do, and not enough to tell a page whether a change it hears of is its own. A **client instance** is one running copy of a frontend. It names itself with a temporary id, sends it with every request, and a backend writes it beside the account wherever it says who made a change: so every instance can tell its own changes from the changes of the others.

<!--renderComp=DiagramText-->
```text
 tab A  (instance 3k9x…)       tab B  (instance p2mf…)      phone (instance 8qa0…)
    │  POST /item/update           ▲                             ▲
    │  Authorization: the account  │                             │
    │  X-Client-Instance-Id: 3k9x… │ notification                │ notification
    ▼                              │ actor: { user u1,           │ actor: { user u1,
 ┌─────────────────────────┐       │   instance 3k9x… }          │   instance 3k9x… }
 │ backend                 ├───────┴─────────────────────────────┘
 │ writes, then tells every│      tab A hears it too: the actor is itself, so
 │ channel of the topic    ├────► it does nothing (its answer brought the result)
 └─────────────────────────┘      B and the phone: another instance: read again
```

The mechanism is not one service's: the storage service of `aws-utils.remote` is its first user, and a service written later takes it over as it is.

## The concepts

- **A client instance** is one running copy of a frontend: one load of the page in a tab (or in a frame of its own), one window of the desktop app, the mobile app from its start to its end, one run of a script. A reload is a new instance; so is a duplicated tab.
- **The client instance id** names it: 16 characters of `0-9a-z`, drawn at random when the instance first asks for it (`id-format.md`: a plain random id, no prefix). It is kept in the memory of the instance only, and dies with it.
- **The actor** of a change is `{ userId, clientInstanceId }`: the account that made it and the instance it came from. A backend writes it where it reports a change (a notification); `clientInstanceId` is `''` when the request named none.
- **Self.** An instance compares `actor.clientInstanceId` with its own id: equal, the change is its own; else it was made elsewhere (another tab, another device, a program). The user id says further whether elsewhere is the same person.

**It is a name, not a credential.** Anyone can send any id; a backend never decides what a request may do by it, never refuses a request for an id it saw before, and never treats it as a secret. What an instance may read and write is decided by its account. The worst a false id does is make a page skip a notification it should have acted on, which only that account's own requests could cause, and which the next read of the page repairs ([What a client does with it](#what-a-client-does-with-it)).

## Why a new id, and not something that exists

The question is "was this change mine?", asked by one tab. Everything the page already has answers another question:

| candidate | why it does not answer |
| --- | --- |
| the account (user id) | every tab and every device of one person is one account |
| the session of the auth provider | shared by the tabs of a browser (`localStorage`), and it outlives a reload |
| the access token | renewed while the page runs, secret, and never sent back by a backend |
| an id kept in `localStorage` | shared by every tab of the browser |
| an id kept in `sessionStorage` | copied into the new tab when a tab is duplicated: two instances with one id |
| the id of a WebSocket connection | exists only while a channel is open; the http requests of the instance do not carry it, and a reconnection changes it |
| the backend leaving out the sender | the backend has to know which connection belongs to the sender: the same id, needed anyway; and it decides for the client what the client wants to hear |

So the id lives in memory, one per running copy, and **the client filters, not the backend**: a backend tells every subscriber, the actor's own channels too, and the client compares one id. A backend may leave out the actor's own channels to save a message; a client depends on neither.

## Its lifetime

<!--renderComp=DiagramText-->
```text
the page loads ──► the first caller asks: clientInstanceIdGet()
                     -> an id drawn at random, kept on globalThis
                   every request to a backend that takes it:
                     X-Client-Instance-Id: {id}
                   a notification channel opened: the ticket binds it
the page reloads, the tab closes ──► the id is gone; the next load draws another
```

- **One per realm of JavaScript.** The id is kept on `globalThis`, so two copies of the module loaded by one page (a package bundling its own) still answer one id.
- **A worker** of the page is the same instance: the page hands it the id.
- **The desktop app** (Electron, [desktop apps](doc_page_impl_desktop.md)): each window is a page and an instance; the main process, when it asks a backend itself, is one more.
- **The mobile app** (Capacitor): its webview is one instance from the start of the app to its end; an app suspended and woken keeps it, an app started again draws another.
- **A script** (a python tool writing into a drive, a CLI) draws one per run, or sends none and is then "elsewhere" to every page.

## On the wire

**Every http request** to a backend that takes part carries the header

```text
X-Client-Instance-Id: 3k9xq2m0ad7ve1zp        16 characters 0-9 a-z when made by react-doc;
                                              a backend accepts [0-9a-z]{8,64}
```

- **It is a header, never an argument.** It says who sends, like `Authorization`, not what a route is asked; no route reads it from its query or body.
- **Absent** is allowed: the actor then has `clientInstanceId: ''`. **Malformed** is refused like any value out of its grammar (`-1`), so a client with a bug hears of it.
- **A backend that takes it says so** where it answers what it is before anyone signs in: `clientInstanceHeader: "X-Client-Instance-Id"` (in `GET /status` of the storage contract). It then allows the header in its CORS configuration. **A client sends it only to a backend that says so**: a browser refuses every request carrying a header the CORS of its backend does not allow, so sending it to an older deployment would break it whole.
- **A WebSocket** cannot carry a header from a browser. A notification channel is opened with a ticket, and the http request asking for the ticket carries the header: the channel belongs to that instance from then on ([the notification channel](../package/aws-utils/doc/notify-contract.md#opening-a-channel)).

## What a backend does with it

- **It writes the actor** wherever it reports a change: the notifications of a write carry `actor: { userId, clientInstanceId }` taken from the account and the header of the request that wrote. A request touching several things gives each the same actor.
- **It keeps it no longer than what it came with**: the request, a ticket, a channel. It is not written into the data (the events of an item record the user id only): after the instance is gone the id means nothing.
- **It tells every subscriber**, the actor's own channels included, and leaves the comparing to the client.
- **It authorizes nothing by it**, and logs it at most beside the request for tracing.

## What a client does with it

```text
a notification of a change arrives, with its actor
  -> actor.clientInstanceId is this instance        its own: the answer of its request brings the result.
                                                    nothing is read; a moment later the page checks it holds
                                                    what the notification says (an answer lost on the way)
  -> another id, or ''                              made elsewhere: read again what changed, and say so
                                                    where it is shown ("changed in another tab or device")
  -> actor.userId is not the account signed in      made by another person (a space shared, later)
```

**Correctness never depends on it.** A page that ignored the actor would read again after its own writes, one read too many; a page that misses a notification reads again at its next refresh. The id saves the read and lets the page say where a change came from.

## In react-doc

```text
frontend/src/lib/doc-client-instance.js   clientInstanceIdGet()                the id of this instance
                                          clientInstanceIdIs(text)             the grammar a backend accepts
                                          clientInstanceActorIsSelf(actor)     a change made by this instance
                                          CLIENT_INSTANCE_HEADER               "X-Client-Instance-Id"
```

- **The page drivers get it**: `driverCreate({ point, credentialGet, clientInstanceIdGet })` ([the page driver](doc_page_impl_asset_storage.md#the-page-driver)). A driver adds the header to the requests of a backend that says it takes it, and the notification channel binds it.
- **The storage layer compares it**: a notification of a partition changed by this instance is not read again ([Being told of changes](doc_page_impl_asset_storage.md#being-told-of-changes)).
- **It is shown** where a channel is: the Asset service tab writes "this tab: instance 3k9x…" in the block of a point with notifications, and the log of what the point told marks each change as this tab's or another's.

## In the backends of aws_oa

```text
aws_utils/client_instance_util.py    CLIENT_INSTANCE_HEADER, client_instance_id_read(header_dict)
                                     -> '' (absent), the id, or ValueError (malformed); zipped into a lambda
                                     like id_util.py
```

A service taking part reads the header with that function in the door of its lambda, allows `x-client-instance-id` in the CORS of its http api, and answers `clientInstanceHeader` in its status route. The storage service (`_5_doc_storage`) is the first.

## What is left for later

- **The development server** reports a change of a file to every tab (`doc-asset-change`) without saying which tab wrote it, so a tab reads again what it has just written itself. The asset api of the development server would read the header and the event carry the actor.
- **A label of an instance**: "Firefox on the laptop", given by the instance itself and carried by its ticket, so a page can say where a change came from beyond "another tab or device".
- **The other services of aws-utils** (the account service, the share service of the drive) do not read the header yet; each takes it with the first thing it reports.

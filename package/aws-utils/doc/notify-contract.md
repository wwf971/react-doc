<!-- The contract of the notification channel: how a service of this package tells a page of something as it happens (a ticket asked over https, then a WebSocket; topics, events, the actor of a change, keeping the channel open, what a notification promises). Generic: a service defines its own topics and events on top (the storage service: storage-contract.md#notifications). The id each page names itself with is @react-doc/main/doc_page_impl_client_instance.md. The AWS side is aws_oa _5_doc_storage (doc_storage_impl.md#notifications). Parent document: README.md. -->

# Notification Channel Contract

A page asks a service, and the service answers. Some things a page wants to hear of **as they happen**, without asking again and again: a partition changed by another tab or device, later an account changed by its admin, a share published. A **notification channel** is the other direction: a WebSocket a page keeps open to one service, on which the service tells it of what changed. This document fixes what every service offering it promises and how a page uses it; each service adds its own topics and events.

**A notification is a hint, never the data.** It says that something changed, which and by whom; the page then reads it with the ordinary routes of the service, with the token of the person, as it always reads. So a channel adds no second way of reading data, a page that missed a notification is only late, and nothing has to be kept in step between the two.

## The concepts

- **A channel** is one WebSocket between one [client instance](../../../main/doc_page_impl_client_instance.md) (a tab, an app) and one service, opened as one account. It lives at most two hours and is opened again by the page.
- **A ticket** is a permission to open one channel: made by an ordinary request of the service (checked like every other), used once, good for a minute. It binds the channel to the account and to the client instance of the request that asked for it.
- **A topic** names what one can be told of. Its grammar and who may hear it are the service's: the storage service has `space/{key}`. A channel hears the topics it is subscribed to.
- **A notification** is one event of one topic: `{ topic, event, time, actor, detail }`.
- **The actor** of a change is `{ userId, clientInstanceId }`: the account that made it and the instance it came from (`''` when the request named none). An instance recognizes its own changes by it.

## Turning it on

Notifications cost something on both sides (a connection kept open, a message for every change), so **both sides choose**:

```text
the service     deployed with or without the channel (its config). with it, GET /status lists "notify"
                in apiSetList; without it, the ticket route answers -3 and nothing of the channel exists
the page        a client turns it on per use: a storage point with config.isNotifyEnabled: true
both            the channel is opened; a page asking a service that does not offer it says so
                (a problem of the point) and works as before, by asking
```

## Opening a channel

<!--renderComp=DiagramText-->
```text
the page                                        the service
  POST /notify/ticket  { topicList }   ───────►   the account checked as for every route;
  Authorization: Bearer {token}                   each topic allowed to it (else -1 / -8)
  X-Client-Instance-Id: {id}           ◄───────   { ticket, url, timeExpire, topicList,
                                                    pingIntervalSec }
  new WebSocket(url + "?ticket=" + ticket)  ──►   the ticket: there, unused, unexpired
                                                  -> used up; the channel belongs to its
                                                     account and instance; its topics
                                                     subscribed
                                       ◄───────   open. refused: the handshake fails
```

```text
POST /notify/ticket   { topicList?: [topic] }
  -> { ticket, url, timeExpire, topicList, pingIntervalSec }
       ticket            32 characters 0-9 a-z, used by one connection
       url               wss://… the endpoint of the channel
       timeExpire        when the ticket can no longer open a channel (the time text of the project)
       topicList         the topics the channel will hear from its first moment
       pingIntervalSec   how often the page pings an idle channel
```

- **The ticket carries the authorization.** A browser cannot send a header with a WebSocket, and a token in a url would be written into logs; so the token goes where it always goes, in the request for the ticket, and the url carries a value that opens one connection within a minute and nothing else.
- **The topics of the ticket are checked with the account**, as the request is: a topic the account may not hear is refused there, with the codes of the service.
- **A refused connection** (no ticket, used, expired) fails its handshake. A browser reports only that it failed, so the page asks a new ticket before every connection and never reuses one.

## Frames

Every frame is one json text. **Every frame the service sends is `{ code, message?, data? }`** and nothing else at the top level, as every answer of the service; `data.kind` says what it is.

```text
the page -> the service
  { action: "subscribe",   requestId?, topicList: [topic] }     hear these topics too
  { action: "unsubscribe", requestId?, topicList: [topic] }     hear them no longer
  { action: "ping",        requestId? }                         keeps an idle channel open

the service -> the page
  an answer       { code, message?, data: { kind: "answer", action, requestId, ... } }
                    subscribe, unsubscribe   ... topicList: the topics of the channel after it
                    ping                     ... time: the clock of the service, unix milliseconds
                    an unknown action        code -3
  a notification  { code: 0, data: { kind: "notification", topic, event, time,
                                     actor: { userId, clientInstanceId }, detail } }
```

- `requestId` is the page's own (any text up to 64 characters) and comes back in the answer, so a page matches an answer to its question; absent, `''`.
- `event` and `detail` are the service's: what happened to the topic, and what a page needs to decide whether to read again (an id, a revision). `time` is the time text of the project, in the zone of the request that made the change.
- A channel hears at most `limit.notifyTopicMax` topics (`GET /status`); one more is `-10`.

## Keeping it open

```text
open ──► every pingIntervalSec (300) without a frame: ping
     ──► closed: by the service (an idle channel after 10 minutes, any channel after 2 hours),
         by the network, by the page sleeping
           -> the page waits (1 s, then twice as long after each failure, at most 60 s, a little at random)
           -> a new ticket, a new channel
           -> what the notifications would have said in between is lost: the page reads again
              whatever it holds of the topics (a partition: one cheap request while it did not change)
the page no longer needs it (signed out, nothing held) ──► closed by the page, not opened again
```

## What a notification promises

- **At most once, maybe never.** A notification is sent once, to the channels subscribed at that moment, and is lost when one is closing; the page catches up by reading when a channel opens again, at a refresh of its own, or at its next start.
- **Order is not relied on.** Notifications of one topic leave in the order the service made them and almost always arrive so; a page compares what a detail carries (a revision) with what it holds, never the order of arrival.
- **No data.** A notification says what changed and by whom, never the content; what changed is read through the routes of the service, checked as every read.
- **The actor's own channels hear it too.** The service does not filter by the sender; the page recognizes its own changes by the client instance id ([the client instance](../../../main/doc_page_impl_client_instance.md#what-a-client-does-with-it)).

## Who hears what

- A ticket is made only for an account the service serves (the group, a disabled account, MFA: as every route), and only with topics that account may hear.
- **A channel keeps what it was given when it opened.** An account disabled while its channel is open goes on hearing until the channel closes (two hours at most), and hears no data: only that something it was allowed to hear of changed.
- A topic is resolved inside the account (`space/{key}` is a space of that account), so a channel never hears of another account's data.

## What a service defines

A service offering the channel writes in its own contract: its topics (their grammar, who may hear them), its events with their `detail`, and what a page does on each. The storage service: [its notifications](storage-contract.md#notifications).

## On AWS

The channel of a service of this package is a **WebSocket api of API Gateway** in front of the same Lambda function as its http api, with a table of its own for the tickets, the channels and their topics (rows that end by themselves, by the time to live of the table). A write of the service tells the channels of its topics right after it is done. Nothing runs while nobody is connected; a connection costs by the minute and by the message, and a service deployed without the channel has none of it. How the storage service does it: `aws_oa/_5_doc_storage/doc_storage_impl.md#notifications`.

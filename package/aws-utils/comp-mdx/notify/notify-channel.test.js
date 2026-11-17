import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyChannelCreate } from './notify-channel.js';
import { awsStorageDriverCreate } from '../storage/aws-storage-driver.js';

// the page's end of a notification channel (doc/notify-contract.md), with a WebSocket and timers
// of the test: what is opened, what is told, when it is opened again, and what the storage driver
// sends and turns into what the storage layer reads

function socketClassFake() {
  const socketList = [];
  class SocketFake {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sentList = [];
      this.closeCode = undefined;
      socketList.push(this);
    }
    send(text) { this.sentList.push(JSON.parse(text)); }
    close(code) { this.closeCode = code; this.readyState = 3; }
    // what the service does
    accept() { this.readyState = 1; this.onopen?.(); }
    tell(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    drop(code = 1001) { this.readyState = 3; this.onclose?.({ code }); }
  }
  return { SocketFake, socketList };
}

function timerFake() {
  let next = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout: (run, delay) => { const id = next++; pending.set(id, { run, delay }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    // run the timers waiting, the shortest first
    runNext() {
      const [id, entry] = [...pending.entries()].sort((a, b) => a[1].delay - b[1].delay)[0] ?? [];
      if (!id) return undefined;
      pending.delete(id);
      entry.run();
      return entry.delay;
    },
  };
}

const settle = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };
const ticketOk = (ticket = 't'.repeat(32)) => ({ code: 0, message: '', data: { ticket, url: 'wss://example.invalid/main', topicList: ['space/cloud'], pingIntervalSec: 300 } });

test('a channel is opened with a ticket, tells its notifications, pings while idle, and is opened again after it closes', async () => {
  const { SocketFake, socketList } = socketClassFake();
  const timer = timerFake();
  const stateList = [];
  const notificationList = [];
  let ticketCount = 0;
  const channel = notifyChannelCreate({
    label: 'Cloud',
    ticketGet: async () => { ticketCount += 1; return ticketOk(String(ticketCount).repeat(32).slice(0, 32)); },
    onNotification: (one) => notificationList.push(one),
    onStateChange: (state) => stateList.push(state.status),
    WebSocketClass: SocketFake,
    timer,
  });
  channel.open();
  await settle();
  assert.equal(socketList.length, 1);
  assert.equal(socketList[0].url, `wss://example.invalid/main?ticket=${'1'.repeat(32)}`);
  socketList[0].accept();
  assert.equal(channel.stateGet().status, 'open');
  socketList[0].tell({ code: 0, data: { kind: 'notification', topic: 'space/cloud', event: 'partitionChanged', time: 't', actor: { userId: 'u', clientInstanceId: 'x' }, detail: { revision: 3 } } });
  socketList[0].tell({ code: 0, data: { kind: 'answer', action: 'ping', requestId: 'p' } });
  socketList[0].tell({ code: -1, message: 'no' });
  assert.equal(notificationList.length, 1, 'answers and failures are not notifications');
  // idle: pinged after pingIntervalSec
  const delay = timer.runNext();
  assert.equal(delay, 300000);
  assert.equal(socketList[0].sentList[0].action, 'ping');

  // closed by the service: waits, a new ticket, a new socket
  socketList[0].drop();
  assert.equal(channel.stateGet().status, 'waiting');
  assert.match(channel.stateGet().message, /closed/);
  const delayRetry = timer.runNext();
  assert.ok(delayRetry >= 800 && delayRetry <= 1200, `the first wait is about a second: ${delayRetry}`);
  await settle();
  assert.equal(ticketCount, 2, 'a ticket is never used twice');
  socketList[1].drop();
  assert.ok(timer.runNext() >= 1600, 'the wait grows with each failure');
  await settle();
  socketList[2].accept();
  assert.equal(channel.stateGet().retryCount, 0, 'open again: the next failure waits a second again');

  channel.close();
  assert.equal(socketList[2].closeCode, 1000);
  assert.equal(channel.stateGet().status, 'closed');
  assert.equal(timer.pending.size, 0, 'nothing is left waiting');
  assert.deepEqual([stateList[0], stateList[1], stateList.at(-1)], ['connecting', 'open', 'closed'], `the states told: ${stateList.join(' ')}`);
});

test('a service without a channel, and a person without one, are not asked again', async () => {
  for (const [code, status] of [[-3, 'unsupported'], [-7, 'refused'], [-8, 'refused']]) {
    const { SocketFake, socketList } = socketClassFake();
    const timer = timerFake();
    const channel = notifyChannelCreate({ ticketGet: async () => ({ code, message: 'no', data: null }), WebSocketClass: SocketFake, timer });
    channel.open();
    await settle();
    assert.equal(channel.stateGet().status, status);
    assert.equal(socketList.length, 0);
    assert.equal(timer.pending.size, 0, `${code}: not asked again`);
  }
  // a service out of reach is asked again
  const timer = timerFake();
  const channel = notifyChannelCreate({ ticketGet: async () => ({ code: -9, message: 'gone', data: null }), WebSocketClass: socketClassFake().SocketFake, timer });
  channel.open();
  await settle();
  assert.equal(channel.stateGet().status, 'waiting');
  assert.equal(timer.pending.size, 1);
  channel.close();
});

test('the storage driver: the client instance sent where the service takes it; a ticket of the space; notifications as the layer reads them', async () => {
  const requestList = [];
  let statusData = { apiSetList: ['item', 'partition', 'cache', 'auth'], limit: {} };
  const fetchReal = globalThis.fetch;
  const WebSocketReal = globalThis.WebSocket;
  const { SocketFake, socketList } = socketClassFake();
  globalThis.WebSocket = SocketFake;
  globalThis.fetch = async (url, init) => {
    requestList.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const route = new URL(url).pathname;
    const data = route === '/status' ? statusData
      : route === '/notify/ticket' ? ticketOk().data
        : { partitionList: [] };
    return { status: 200, json: async () => ({ code: 0, data }) };
  };
  try {
    const point = { id: 'cloud', config: { url: 'https://storage.invalid', isNotifyEnabled: true } };
    const driverOf = () => awsStorageDriverCreate({ point, credentialGet: async () => ({ code: 0, data: { token: 'tok' } }), clientInstanceIdGet: () => 'abcdefgh12345678' });
    await driverOf().partitionList();
    assert.equal(requestList.at(-1).headers['X-Client-Instance-Id'], undefined, 'a service that does not say it takes the header is not sent it');
    statusData = { ...statusData, clientInstanceHeader: 'X-Client-Instance-Id' };
    const driver = driverOf();
    await driver.partitionList();
    assert.equal(requestList.at(-1).headers['X-Client-Instance-Id'], 'abcdefgh12345678');
    assert.equal(requestList.at(-1).headers.Authorization, 'Bearer tok');

    // a service without notify: the channel says so and asks no ticket
    const stateList = [];
    const handle = driver.notifyOpen({ onNotification: () => {}, onStateChange: (state) => stateList.push(state) });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(stateList.at(-1).status, 'unsupported');
    assert.equal(requestList.some((one) => one.url.endsWith('/notify/ticket')), false);
    handle.close();

    statusData = { ...statusData, apiSetList: [...statusData.apiSetList, 'notify'] };
    const driverNotify = driverOf();
    const notificationList = [];
    const handleNotify = driverNotify.notifyOpen({ onNotification: (one) => notificationList.push(one), onStateChange: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const ticketRequest = requestList.find((one) => one.url.endsWith('/notify/ticket'));
    assert.deepEqual(ticketRequest.body, { space: 'cloud' }, 'the ticket of the space of the point');
    assert.equal(ticketRequest.headers['X-Client-Instance-Id'], 'abcdefgh12345678', 'the ticket binds the channel to this instance');
    const socket = socketList.at(-1);
    socket.accept();
    const actor = { userId: 'u1', clientInstanceId: 'zzzzzzzzzzzzzzzz' };
    socket.tell({ code: 0, data: { kind: 'notification', topic: 'space/cloud', event: 'partitionChanged', time: 't1', actor, detail: { partitionId: 'p1', ownerRef: 'frontend:x', partition: 'cloud', revision: 4, isDeleted: false, itemIdList: ['i1'], isItemIdListComplete: true } } });
    socket.tell({ code: 0, data: { kind: 'notification', topic: 'space/other', event: 'partitionChanged', time: 't2', actor, detail: { partitionId: 'p9', revision: 1 } } });
    socket.tell({ code: 0, data: { kind: 'notification', topic: 'space/cloud', event: 'spaceRemoved', time: 't3', actor, detail: { key: 'cloud' } } });
    assert.deepEqual(notificationList, [
      { actor, time: 't1', event: 'partitionChanged', partitionId: 'p1', ownerRef: 'frontend:x', partition: 'cloud', revision: 4, isDeleted: false, itemIdList: ['i1'], isItemIdListComplete: true },
      { actor, time: 't3', event: 'pointChanged' },
    ], 'another topic is not the point\'s; a space removed is "read every partition"');
    handleNotify.close();
    assert.equal(socket.closeCode, 1000);
  } finally {
    globalThis.fetch = fetchReal;
    globalThis.WebSocket = WebSocketReal;
  }
});

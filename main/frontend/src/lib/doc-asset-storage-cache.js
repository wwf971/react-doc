// The cache of the storage points the page drives (design:
// doc_page_impl_asset_storage.md#the-cache-of-a-remote-point). A remote point is behind a
// network: what the page read from it is kept in the browser, so the next page start shows it at
// once, asks the point only whether it still stands, and never reads the same bytes twice.
//
//   index     the index of one partition: { partition, recordList, itemList }, with when it was
//             fetched. keyed by the scope and the identity of the partition
//   version   the data of one version of one item: { hash, itemRevision, isText, text | bytes,
//             metadata, size }. keyed by the scope, the item and the version; it stands while the
//             item has that revision and the version that hash
//
// The scope says whose cache it is: the storage point, its backend and space, and the person
// signed in. So two people on one browser never read each other's copy, and signing out removes
// the copy of that person (clear with the scope).
//
// It is kept in IndexedDB (binary values, no size limit worth mentioning). Where the browser has
// none (a private window that refuses it, a test), it is kept in memory for the life of the page.
// A cache is never the truth: every failure of it is swallowed, and the caller reads the point.

const DB_NAME = 'react-doc-asset-storage';
const DB_VERSION = 1;
const STORE_INDEX = 'index';
const STORE_VERSION = 'version';
const KEY_SEPARATOR = '\u0001';

// scope: a string naming whose cache it is (assetStorageCacheScopeBuild)
export function assetStorageCacheScopeBuild({ pointId, url, space, subject }) {
  return [pointId, url, space, subject].map((one) => String(one ?? '')).join(KEY_SEPARATOR);
}

const indexKeyBuild = (scope, ownerRef, partition) => [scope, ownerRef, partition].join(KEY_SEPARATOR);
const versionKeyBuild = (scope, itemId, versionId) => [scope, itemId, versionId].join(KEY_SEPARATOR);

export function assetStorageCacheCreate({ indexedDB = globalThis.indexedDB } = {}) {
  const memoryByStore = { [STORE_INDEX]: new Map(), [STORE_VERSION]: new Map() };
  let dbPromise;
  let isMemory = !indexedDB;

  const dbGet = () => {
    if (isMemory) return Promise.resolve(undefined);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        let request;
        try {
          request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
          isMemory = true;
          resolve(undefined);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const name of [STORE_INDEX, STORE_VERSION]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          isMemory = true;
          resolve(undefined);
        };
        request.onblocked = () => {
          isMemory = true;
          resolve(undefined);
        };
      });
    }
    return dbPromise;
  };

  // one request against a store, answered as a promise; undefined on any failure
  const run = async (storeName, mode, work) => {
    const db = await dbGet();
    if (!db) return work(undefined, memoryByStore[storeName]);
    return new Promise((resolve) => {
      let result;
      try {
        const transaction = db.transaction(storeName, mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => resolve(undefined);
        transaction.onabort = () => resolve(undefined);
        const request = work(transaction.objectStore(storeName));
        if (request) request.onsuccess = () => { result = request.result; };
      } catch {
        resolve(undefined);
      }
    });
  };

  const get = (storeName, key) => run(storeName, 'readonly', (store, memory) => (store ? store.get(key) : memory.get(key)));
  const set = (storeName, key, value) => run(storeName, 'readwrite', (store, memory) => (store ? store.put(value, key) : void memory.set(key, value)));
  const remove = (storeName, key) => run(storeName, 'readwrite', (store, memory) => (store ? store.delete(key) : void memory.delete(key)));
  // every key of a store starting with a prefix
  const rangeOf = (prefix) => globalThis.IDBKeyRange?.bound(prefix, `${prefix}￿`);
  const removePrefix = (storeName, prefix) => run(storeName, 'readwrite', (store, memory) => {
    if (store) return store.delete(rangeOf(prefix));
    for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
    return undefined;
  });
  const listPrefix = async (storeName, prefix) => {
    const db = await dbGet();
    if (!db) return [...memoryByStore[storeName].entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
    return new Promise((resolve) => {
      const list = [];
      try {
        const transaction = db.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).openCursor(rangeOf(prefix));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          list.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        transaction.oncomplete = () => resolve(list);
        transaction.onerror = () => resolve(list);
      } catch {
        resolve(list);
      }
    });
  };

  return {
    get place() {
      return isMemory ? 'memory' : 'indexedDB';
    },
    // { partition, recordList, itemList, timeFetched } | undefined
    indexGet: (scope, ownerRef, partition) => get(STORE_INDEX, indexKeyBuild(scope, ownerRef, partition)),
    indexSet: (scope, ownerRef, partition, value) => set(STORE_INDEX, indexKeyBuild(scope, ownerRef, partition), value),
    indexRemove: (scope, ownerRef, partition) => remove(STORE_INDEX, indexKeyBuild(scope, ownerRef, partition)),
    // { hash, itemRevision, isText, text?, bytes?, metadata, size, timeFetched } | undefined
    versionGet: (scope, itemId, versionId) => get(STORE_VERSION, versionKeyBuild(scope, itemId, versionId)),
    versionSet: (scope, itemId, versionId, value) => set(STORE_VERSION, versionKeyBuild(scope, itemId, versionId), value),
    versionRemove: (scope, itemId, versionId) => remove(STORE_VERSION, versionKeyBuild(scope, itemId, versionId)),
    // everything of a scope; with only a pointId, everything of that point whoever was signed in
    clear: async (scopeOrPrefix) => {
      const prefix = `${scopeOrPrefix}${KEY_SEPARATOR}`;
      await removePrefix(STORE_INDEX, prefix);
      await removePrefix(STORE_VERSION, prefix);
    },
    // what a scope holds: { partitionCount, itemCount, versionCount, size, timeFetchedLast }
    infoGet: async (scopeOrPrefix) => {
      const prefix = `${scopeOrPrefix}${KEY_SEPARATOR}`;
      const indexList = await listPrefix(STORE_INDEX, prefix);
      const versionList = await listPrefix(STORE_VERSION, prefix);
      let size = 0;
      let timeFetchedLast = 0;
      let itemCount = 0;
      for (const { value } of indexList) {
        itemCount += value?.itemList?.length ?? 0;
        size += JSON.stringify(value ?? null).length;
        timeFetchedLast = Math.max(timeFetchedLast, value?.timeFetched ?? 0);
      }
      for (const { value } of versionList) {
        size += value?.size ?? 0;
        timeFetchedLast = Math.max(timeFetchedLast, value?.timeFetched ?? 0);
      }
      return { partitionCount: indexList.length, itemCount, versionCount: versionList.length, size, timeFetchedLast };
    },
  };
}

// ---------- bytes and text ----------

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(String(base64 ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// the sha1 of bytes, in hex: the hash the asset store identifies the bytes of a version by
export async function bytesHashGet(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((one) => one.toString(16).padStart(2, '0')).join('');
}

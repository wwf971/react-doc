// Browser client of the edit api served by the development server
// (plugin/doc-edit-server.ts). Every call resolves to { code, data, message };
// code 0 is success, a negative code is a failure explained by message.
// Network failures are reported the same way, so callers need one branch.

export function docEditApiCreate(endpoint) {
  const endpointNormalized = String(endpoint ?? '').replace(/\/+$/, '');

  const requestSend = async (route, init) => {
    try {
      const response = await fetch(`${endpointNormalized}${route}`, { cache: 'no-store', ...init });
      const payload = await response.json().catch(() => undefined);
      if (!payload || typeof payload.code !== 'number') {
        return { code: -1, data: null, message: `edit api answered ${response.status} without a result` };
      }
      return payload;
    } catch (error) {
      return { code: -1, data: null, message: `edit api is not reachable: ${String(error?.message ?? error)}` };
    }
  };

  return {
    endpoint: endpointNormalized,

    // { isWritable } when a development server answers
    statusGet() {
      return requestSend('/status');
    },

    // { internalPath, text, hash } of the file on disk
    sourceRead(internalPath) {
      return requestSend(`/source?path=${encodeURIComponent(internalPath)}`);
    },

    // applies one line operation (lib/doc-edit-block.js builds them) against
    // the version identified by hashBase; answers the new { text, hash }.
    // a list of operations built on the same text is applied together.
    sourceApply(internalPath, hashBase, operation) {
      const body = Array.isArray(operation)
        ? { internalPath, hashBase, operationList: operation }
        : { internalPath, hashBase, operation };
      return requestSend('/source/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },

    // one change of the workspace file (plugin/doc-workspace-edit.ts);
    // answers { hash } of the file written
    //   request    { action: 'itemFieldSet' | 'itemPathSet' | 'itemAdd' | 'itemRemove' | 'itemMove' | 'titleSet', ... }
    //   hashBase   configDoc.workspace.fileHash, the version the page shows
    workspaceEdit(request, hashBase) {
      return requestSend('/workspace/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request, hashBase }),
      });
    },

    // rewrites the label of one side-panel item in its yaml file
    // (plugin/doc-side-panel-text.ts); answers { file, fieldName, text }
    //   file, nodePath   the item's textSource, annotated by the plugin
    //   language         '' for a plain string label, else the shown translation
    //   textBase         the authored label the edit started from
    sidePanelTextApply({ file, nodePath, language, text, textBase }) {
      return requestSend('/side-panel/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, nodePath, language, text, textBase }),
      });
    },

    // moves one side-panel item (with its subtree) to another place of a
    // yaml list, in its file or another one (plugin/doc-side-panel-move.ts);
    // answers { fileChangeList: [{ file, hashBefore, hashAfter, textBefore,
    // textAfter }] }, empty when the item already is there
    //   item             { file, path }: the item's nodeSource
    //   target           { file, listPath, index }: the list and the index
    //                    the item gets there (-1: the end)
    //   hashBaseByFile   file -> the hash of the file the page was built
    //                    from; refused with -2 when one changed
    sidePanelItemMoveApply({ item, target, hashBaseByFile }) {
      return requestSend('/side-panel/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, target, hashBaseByFile }),
      });
    },

    // writes one value of a config declaration of the doc page, in place;
    // answers { file, keyPath, value }
    //   file        the file of the declaration, relative to the config directory
    //   keyPath     the yaml address of the declaration, then [Key] or
    //               ['compConfig', CompName, Key]; the key must be declared
    //   value       null, boolean, number, string, or a list of strings
    //   valueBase   the value the file declared when the page displayed it;
    //               refused with -2 when it changed
    configValueApply({ file, keyPath, value, valueBase }) {
      return requestSend('/config/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, keyPath, value, valueBase }),
      });
    },
  };
}

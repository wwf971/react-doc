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
    // the version identified by hashBase; answers the new { text, hash }
    sourceApply(internalPath, hashBase, operation) {
      return requestSend('/source/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalPath, hashBase, operation }),
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
  };
}

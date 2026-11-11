import { ArrowLeft, ArrowRight, ArrowUp, House, LinkIcon } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of the navigation layer (doc_page_impl_nav.md), as the unified
// api registry lists them (doc_page_impl_api.md): what the navigation
// buttons do, offered to the palette, the hotkeys and remote callers.
// every one runs through DocStore, the one place a location changes from.
export const apiByIdNav = {
  'nav/back': apiDefine({
    label: 'Back',
    description: 'The document visited before this one.',
    icon: ArrowLeft,
    isAvailable: ({ stores }) => stores.docStore.isNavigationBackAvailable || 'nothing to go back to',
    run: ({ stores }) => (stores.docStore.navigationBack() ? undefined : { code: -1, message: 'nothing to go back to' }),
  }),
  'nav/forward': apiDefine({
    label: 'Forward',
    description: 'The document visited after this one.',
    icon: ArrowRight,
    isAvailable: ({ stores }) => stores.docStore.isNavigationForwardAvailable || 'nothing to go forward to',
    run: ({ stores }) => (stores.docStore.navigationForward() ? undefined : { code: -1, message: 'nothing to go forward to' }),
  }),
  'nav/up': apiDefine({
    label: 'Up',
    description: 'The folder of the current side-panel item.',
    icon: ArrowUp,
    isAvailable: ({ stores }) => stores.docStore.isNavigationUpAvailable || 'the current item has no folder above it',
    run: ({ stores }) => (stores.docStore.navigationUp() ? undefined : { code: -1, message: 'no item above the current one' }),
  }),
  'nav/home': apiDefine({
    label: 'Home',
    description: 'The home document of the page.',
    icon: House,
    isAvailable: ({ stores }) => stores.docStore.routeHome !== '' || 'the page has no home document',
    run: ({ stores }) => navigateResult(stores.docStore, stores.docStore.routeHome),
  }),
  'nav/goTo': apiDefine({
    label: 'Go to a document',
    description: 'Opens a document by any form of a link target: a source path, a relative path, a file name, @first/{itemId}, with an optional #fragment.',
    icon: LinkIcon,
    paramList: [{ name: 'target', type: 'sourcePath', pathSpec: { kind: 'file' }, isRequired: true, description: 'the target, as a link would write it' }],
    run: ({ stores }, { target }) => navigateResult(stores.docStore, target),
  }),
  'nav/popup': apiDefine({
    label: 'Open a document in the popup',
    description: 'Shows a document of the source in the inline popup of the page, at a place when a fragment is given. A document registered by an object opens its home document when the object has one (object-frontend/doc/open).',
    icon: LinkIcon,
    paramList: [
      { name: 'target', type: 'sourcePath', pathSpec: { kind: 'file' }, isRequired: true, description: 'the full source path of the document' },
      { name: 'hash', type: 'string', description: 'the place in it: an id or a heading title' },
      { name: 'arrival', type: 'object', description: 'where the reader was going, handed to what the document renders: { target, hash, key, ref }' },
    ],
    run: ({ stores }, { target, hash, arrival }) => stores.navStore.popupOpen({ target: String(target), hash: String(hash ?? ''), arrival }),
  }),
  'nav/request': apiDefine({
    label: 'Follow a link',
    description: 'Resolves a link target as a document would write it and routes it as a click on the link would: to the owner of a registered document, the side panel item, or the popup. ?nav=page | popup | owner in the target names one route.',
    icon: LinkIcon,
    paramList: [
      { name: 'target', type: 'string', isRequired: true, description: 'the target, as a link would write it' },
      { name: 'fromPath', type: 'sourcePath', description: 'the document the target is written in (relative targets, the local doc page)' },
    ],
    run: async ({ stores }, { target, fromPath = '' }) => {
      const { targetList, hash, param = {} } = stores.docStore.docTargetResolve(String(target), String(fromPath));
      if (targetList.length === 0) return { code: -1, message: `The target names no document: ${target}` };
      const first = targetList[0];
      return (await stores.navStore.request({ target: first.internalPath, hash, fromPath: String(fromPath), param, owner: first.owner, route: first.navigationTarget })) ?? { code: -1, message: `Nothing can show ${first.internalPath}.` };
    },
  }),
};

function navigateResult(docStore, target) {
  const isNavigated = docStore.navigate(String(target));
  if (!isNavigated) return { code: -1, message: docStore.navigationError || `cannot navigate to ${target}` };
  return { code: 0, data: { path: docStore.docCurrentPath, hash: docStore.docCurrentHash }, message: '' };
}

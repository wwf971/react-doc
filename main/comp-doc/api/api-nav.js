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
};

function navigateResult(docStore, target) {
  const isNavigated = docStore.navigate(String(target));
  if (!isNavigated) return { code: -1, message: docStore.navigationError || `cannot navigate to ${target}` };
  return { code: 0, data: { path: docStore.docCurrentPath, hash: docStore.docCurrentHash }, message: '' };
}

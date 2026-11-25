import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { AppWindow, BookOpen } from '../../frontend/UICommon.js';

// the apis of the portals (doc_page_impl_portal.md#the-apis): which there are, which is shown,
// another one opened. The command palette and an agent switch portals with them, also out of a
// portal that offers no switcher of its own
export const apiByIdPortal = {
  'portal/list': apiDefine({
    label: 'List the portals',
    description: 'Every portal of the page, by doc page: its id, name, provider, component, what it is made for; and which one is shown.',
    icon: AppWindow,
    run: ({ stores }) => ({
      code: 0,
      data: {
        portalIdCurrent: stores.portalStore.portalIdCurrent,
        at: stores.portalStore.at,
        isLoading: stores.portalStore.isLoading,
        portalList: stores.portalStore.portalList.map((portal) => ({
          id: portal.id, label: portal.label, description: portal.description, docPageAlias: portal.docPageAlias, providerRef: portal.providerRef,
          providerLabel: portal.providerLabel, comp: portal.comp, deviceList: portal.deviceList, isBuiltIn: portal.isBuiltIn,
          problem: portal.isBuiltIn ? '' : stores.portalStore.compProblemGet(portal),
        })),
        problemList: stores.portalStore.problemList,
      },
    }),
  }),
  'portal/open': apiDefine({
    label: 'Open a portal',
    description: 'Shows a portal of the page in the place of what is shown: an app of a frontend object, or the documents of a doc page (docPage:{alias}/doc).',
    icon: AppWindow,
    paramList: [
      { name: 'id', type: 'string', isRequired: true, description: 'the portal: {provider}/{name}, as portal/list answers it' },
      { name: 'at', type: 'string', description: 'the place inside it, in its own words (a path)' },
    ],
    run: ({ stores }, { id, at = '' }) => stores.portalStore.open(String(id), { at: String(at ?? '') }),
  }),
  'portal/docOpen': apiDefine({
    label: 'Open the documents',
    description: 'Shows the documents with their side panel again, where a portal of its own is shown.',
    icon: BookOpen,
    isAvailable: ({ stores }) => stores.portalStore.portalIdOpen !== '' || 'the documents are shown',
    run: ({ stores }) => stores.portalStore.docOpen(),
  }),
};

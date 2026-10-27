// The environment the doc page runs in, and what it allows.
// Design: doc_page_impl.md#the-environment
//
// An environment kind says how the page is served; each kind offers a set of
// capabilities. Logic that depends on where the page runs (may a document be
// edited, may a file be created, is there an asset api) asks for a
// capability (DocEnvStore.isCapable), never for an endpoint, a build flag or
// import.meta.env by itself. Another kind is one more entry here.
//
//   kind            how the page is served
//   label           how the panel and messages name it
//   capabilityList  what it offers; a capability that needs an api is on only
//                   when the api is configured too (and, for "edit", answers).
//                   "service" is in every kind: the service backend is a
//                   process of its own, not the server of the page, so the
//                   page reaches it wherever it is served once it is given its
//                   address (doc_page_impl_service.md#reaching-the-backend)
export const docEnvKindDefineList = [
  {
    kind: 'viteDevServer',
    label: 'development server',
    capabilityList: ['sourceWrite', 'edit', 'asset', 'service', 'devWarning'],
  },
  {
    kind: 'staticBuild',
    label: 'static build',
    capabilityList: ['service'],
  },
];

// the capabilities, each with the api that answers it ('' when none)
//   sourceWrite   files are created in the source (doc_page_impl_source.md)
//   edit          documents and the yaml files of the doc page are written in
//                 place: edit mode, side-panel edits, doc page config values
//   asset         the asset api of the development server; without it the
//                 asset service layer reads the snapshot bundled into a build
//   service       the service backend, at the address the page is given (the
//                 development server forwards it; a build may name a deployed one)
//   devWarning    hints meant for the integrator, printed to the console
export const docEnvCapabilityDefineByName = {
  sourceWrite: { api: 'source', label: 'creating files' },
  edit: { api: 'edit', label: 'editing' },
  asset: { api: 'asset', label: 'the asset api' },
  service: { api: 'service', label: 'the service backend' },
  devWarning: { api: '', label: 'development warnings' },
};

// the kind of a page that was not told its kind (a host that renders
// DocPageMdx without the virtual module's docEnv): served by a development
// server when any api of the development server is configured, else a static
// build. the service backend's address says nothing of how the page is served
export function docEnvKindInfer(endpointByApi = {}) {
  return Object.entries(endpointByApi)
    .some(([api, endpoint]) => api !== 'service' && typeof endpoint === 'string' && endpoint !== '')
    ? 'viteDevServer'
    : 'staticBuild';
}

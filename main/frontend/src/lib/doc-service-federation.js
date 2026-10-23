// Loads the dashboards of a service instance: a federated module (design:
// doc_page_impl_service.md#dashboard-module), built by
// @originjs/vite-plugin-federation and served by the service backend from
// the instance's own folder. The page is the host; it is not built with the
// federation plugin, so it
// speaks the container contract itself:
//
//   const container = await import(remoteEntryUrl)   // { init, get }
//   container.init(shareScope)                       // the packages the page shares
//   const factory = await container.get('./dashboard')
//   const module = factory()                         // { NoteDbDashboard, ... }
//
// the page shares react and react-dom, so a dashboard renders with the
// page's react (one react: hooks, context and events work across the two).
// a remote declares them shared with singleton and a loose requiredVersion
// (^19.0.0); anything else it uses it bundles itself.
//
// a container is loaded once per entry url; the url carries the build time
// of the entry, so a rebuilt dashboard is a new url and is loaded anew.
import * as React from 'react';
import * as ReactDOM from 'react-dom';

function sharedEntryBuild(module, version) {
  return {
    [version]: {
      get: () => Promise.resolve(() => module),
      loaded: true,
      from: 'host',
      version,
    },
  };
}

const shareScope = {
  react: sharedEntryBuild(React, React.version),
  'react-dom': sharedEntryBuild(ReactDOM, ReactDOM.version ?? React.version),
};

const containerPromiseByUrl = new Map();

function containerLoad(entryUrl) {
  if (!containerPromiseByUrl.has(entryUrl)) {
    const promise = import(/* @vite-ignore */ entryUrl).then(async (container) => {
      if (typeof container.init !== 'function' || typeof container.get !== 'function') {
        throw new Error(`${entryUrl} is not a federated remote entry (no init / get)`);
      }
      await container.init(shareScope);
      return container;
    });
    // a failed load is not kept: the next attempt (after the dashboard is
    // built, after the backend is up) loads again
    promise.catch(() => containerPromiseByUrl.delete(entryUrl));
    containerPromiseByUrl.set(entryUrl, promise);
  }
  return containerPromiseByUrl.get(entryUrl);
}

// the module of a remote: { code: 0, data: module } or { code: -1, message }
export async function remoteModuleLoad(entryUrl, modulePath) {
  try {
    const container = await containerLoad(entryUrl);
    const factory = await container.get(modulePath);
    return { code: 0, data: factory(), message: '' };
  } catch (error) {
    return { code: -1, data: null, message: `the dashboard module did not load: ${String(error?.message ?? error)}` };
  }
}

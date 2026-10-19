import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// The dashboards of note-db, built as one federated module
// (doc_page_impl_service_instance.md#dashboard-module). The service backend
// serves dist/ (expose.dashboardRemote of service_type.py names it), and the
// doc page loads dist/remoteEntry.js. container and module here must be the
// ones dashboardRemote declares.
export default defineConfig({
  // the backend serves the build under a path the page decides: every url
  // of the build is relative to the remote entry
  base: './',
  plugins: [
    react(),
    federation({
      name: 'serviceNoteDb',
      filename: 'remoteEntry.js',
      exposes: {
        './dashboard': './src/dashboard.jsx',
      },
      // the page provides react: one react, so hooks and context work across
      // the page and the dashboard
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^19.0.0',
        },
      },
    }),
  ],
  build: {
    // every file at the top of dist/, beside remoteEntry.js: the plugin
    // writes the chunk paths relative to the build root, and they resolve
    // relative to the entry only when the entry is at the root as well
    assetsDir: '',
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
});

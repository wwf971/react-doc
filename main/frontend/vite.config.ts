import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { docLaunchFromEnvGet, docSourcePlugin } from './plugin/doc-source.ts';

// react-doc dev hands what to serve over in the environment
// (main/doc_page_impl_cli.md#the-launch-layer); started by pnpm dev there is
// none, and config.yaml names the workspace
const launch = docLaunchFromEnvGet();

export default defineConfig({
  plugins: [react(), tailwindcss(), docSourcePlugin({ launch, configFile: launch?.configFile })],
  resolve: {
    // parent workspaces may contain several React versions;
    // force one single react instance, otherwise hooks break at runtime
    dedupe: ['react', 'react-dom'],
    // a component of a doc page lying anywhere imports the page by its name
    // (compDefine, RegisteredComp), from a checkout as from an installed package; its pure
    // utilities without the page by a path of their own (asset-path, pagination: no React, for node tests too)
    alias: [
      { find: /^@wwf971\/react-doc$/, replacement: path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/index.js') },
      { find: /^@wwf971\/react-doc\/asset-path$/, replacement: path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/lib/doc-object-frontend-asset-path.js') },
      { find: /^@wwf971\/react-doc\/pagination$/, replacement: path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/lib/doc-pagination.js') },
    ],
  },
  server: {
    port: 45173,
    strictPort: true,
    fs: {
      // doc source folders and gitignored third_party/shadcn live outside frontend/;
      // @wwf971/react-comp-misc is a linked workspace package served from its source folder
      allow: ['..', '../..', '../../..', '../../../../2025/react-comp-misc'],
    },
  },
  preview: {
    port: 45173,
    strictPort: true,
  },
});

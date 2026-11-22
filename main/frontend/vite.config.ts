import { createRequire } from 'node:module';
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

// the folder of the package katex, wherever it is installed: its stylesheet
// (imported by src/style.css) names its fonts in that folder, which the server
// must serve. in a workspace that hoists its packages (pnpm nodeLinker
// hoisted) it is outside every folder allowed below, and a listed allow
// turns off the workspace root vite would otherwise allow: the fonts were
// refused and every formula fell back to the fonts of the system
const katexDir = path.dirname(createRequire(import.meta.url).resolve('katex/package.json'));

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
  // the first visit after a server starts (main/doc_page_impl_cli.md#the-first-load-after-a-start):
  // a library only a lazy import reaches is found by vite when a page asks for it, which bundles it
  // again and reloads the page; naming it here bundles it with the others before the first visit
  optimizeDeps: {
    // mathjax-full is CommonJS, loaded only when a formula is copied as SVG
    // (built-in/comp-mdx/math/math-svg.js): bundled when the server starts,
    // not found then and the page reloaded in the middle of a copy
    include: [
      'html-to-image',
      'mathjax-full/js/mathjax.js',
      'mathjax-full/js/input/tex.js',
      'mathjax-full/js/output/svg.js',
      'mathjax-full/js/adaptors/liteAdaptor.js',
      'mathjax-full/js/handlers/html.js',
      'mathjax-full/js/input/tex/AllPackages.js',
    ],
  },
  server: {
    port: 45173,
    strictPort: true,
    // the page's modules transformed as soon as the server starts, not when the first visit asks
    // for them one by one
    warmup: {
      clientFiles: ['./src/main.jsx'],
    },
    fs: {
      // doc source folders and gitignored third_party/shadcn live outside frontend/;
      // @wwf971/react-comp-misc is a linked workspace package served from its source folder
      allow: ['..', '../..', '../../..', '../../../../2025/react-comp-misc', katexDir],
    },
  },
  preview: {
    port: 45173,
    strictPort: true,
  },
});

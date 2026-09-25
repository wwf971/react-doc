import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { docSourcePlugin } from './plugin/doc-source';

export default defineConfig({
  plugins: [react(), tailwindcss(), docSourcePlugin()],
  resolve: {
    // parent workspaces may contain several React versions;
    // force one single react instance, otherwise hooks break at runtime
    dedupe: ['react', 'react-dom'],
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

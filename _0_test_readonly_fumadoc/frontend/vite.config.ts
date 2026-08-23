import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { docSourcePlugin } from './plugin/doc-source';

export default defineConfig({
  plugins: [react(), tailwindcss(), docSourcePlugin()],
  resolve: {
    // the pnpm workspace hoists several react versions (other projects);
    // force one single react instance, otherwise hooks break at runtime
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      // doc source folders live outside frontend/, allow serving them as ?raw modules
      allow: ['..', '../../..'],
    },
  },
});

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Two pages: the game (index.html) and the L01 Cabbagetown tunnel tutorial / G01 gym (tunnel.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tunnel: fileURLToPath(new URL('./tunnel.html', import.meta.url)),
      },
    },
  },
});

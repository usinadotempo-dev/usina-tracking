// Build do app React (portal + novo admin) servido em /app/.
// Saída em dist/app; build/copy-static.mjs copia para dist/ o resto do que é
// público (LPs, admin/dash legados, assets). O Pages publica só dist/ — e as
// Functions continuam vindo de ./functions na raiz do repositório.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` local: encaminha as chamadas de API para o site no ar.
    proxy: {
      '/auth': 'https://tracking.usinadotempo.com.br',
      '/api': 'https://tracking.usinadotempo.com.br',
      '/admin': 'https://tracking.usinadotempo.com.br',
    },
  },
});

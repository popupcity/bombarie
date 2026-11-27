import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './app',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  build: { assets: 'assets' },
  security: { allowedDomains: [{ protocol: 'https' }] },
  vite: {
    plugins: [tailwindcss()],
    ssr: { noExternal: ['@popupcity/ui'] }
  }
});

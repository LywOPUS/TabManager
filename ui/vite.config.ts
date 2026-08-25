import { rmSync } from 'node:fs'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  plugins: [
    {
      name: 'clean-ui-output',
      apply: 'build',
      buildStart() {
        rmSync(path.resolve(__dirname, '../extension/mgmt'), { recursive: true, force: true })
      },
    },
    {
      name: 'extension-html',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html
            .replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/g, '')
            .replace(/\n?\s*<link\s+rel="modulepreload"[^>]*>/g, '')
        },
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ext': path.resolve(__dirname, '../extension'),
    },
  },
  build: {
    modulePreload: false,
    outDir: path.resolve(__dirname, '../extension'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        management: path.resolve(__dirname, 'management.html'),
        popup: path.resolve(__dirname, 'popup.html'),
        sidepanel: path.resolve(__dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: 'mgmt/[name].js',
        chunkFileNames: 'mgmt/chunks/[name]-[hash].js',
        assetFileNames: 'mgmt/[name][extname]',
      },
    },
  },
  server: {
    port: 5190,
    strictPort: true,
  },
})

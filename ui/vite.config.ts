import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ext': path.resolve(__dirname, '../extension'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../extension'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        management: path.resolve(__dirname, 'management.html'),
        popup: path.resolve(__dirname, 'popup.html'),
        'glass-compare': path.resolve(__dirname, 'glass-compare.html'),
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

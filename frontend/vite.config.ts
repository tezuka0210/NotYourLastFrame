

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
  ],

  // --- VVVVVV 你需要添加这个 server 块 VVVVVV ---
  server: {
    proxy: {
      // 匹配所有以 /api 开头的请求
      '/api': {
        target: 'http://127.0.0.1:5005', // 你的后端 app.py 地址
        changeOrigin: true, // 必须开启，以支持跨域
      },
      '/view': {
        target: 'http://127.0.0.1:5005', // 你的后端 app.py 地址
        changeOrigin: true, // 必须开启，以支持跨域
      }
    }
  },
  // --- ^^^^^^ 你需要添加这个 server 块 ^^^^^^ ---

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
})
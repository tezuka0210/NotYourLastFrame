// vite.config.js
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    vue(),
    // 已移除 vue-devtools 插件
    tailwindcss(),
  ],

  server: {
    proxy: {
      // 匹配所有以 /api 开头的请求
      '/api': {
        target: 'http://127.0.0.1:5005', // 你的后端 app.py 地址
        changeOrigin: true,
      },
      '/view': {
        target: 'http://127.0.0.1:5005', // 你的后端 app.py 地址
        changeOrigin: true,
      }
    }
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    }
  },
})

// src/main.js
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/main.css'

const app = createApp(App)

// 如果你有 router / pinia 之类的，就照常 use
app.use(router)

// 如果你想全局关闭 devtools（一起解决 vue-devtools 悬浮问题）：
app.config.devtools = false

app.mount('#app')

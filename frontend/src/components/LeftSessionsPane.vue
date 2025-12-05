<template>
  <!-- 外层容器添加左右间距，限制最大宽度，居中显示 -->
  <div class="w-full max-w-md mx-auto px-4 py-6">
    <section class="w-full h-full bg-white rounded-2xl shadow-md flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg border border-gray-100">
      <!-- 头部区域 - 优化背景和边框 -->
      <div class="p-4 border-b border-gray-100 flex flex-col gap-3 bg-gray-50/90 backdrop-blur-sm rounded-t-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-800 tracking-wide flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-500 rounded-full p-0.5 bg-indigo-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"></path>
            </svg>
            Sessions
          </h2>
          <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{{ sessions.length }} {{ sessions.length === 1 ? 'session' : 'sessions' }}</span>
        </div>

        <!-- 新建按钮 - 优化hover效果和阴影 -->
        <button
          @click="createNewSession"
          type="button"
          class="w-full aspect-[5/1] flex items-center justify-center border-2 border-dashed border-gray-300 rounded-3xl hover:border-indigo-400 hover:bg-indigo-50 text-gray-500 hover:text-indigo-600 transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.98] hover:shadow-sm"
          title="New Session"
        >
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 font-light transition-transform duration-300 hover:rotate-90 rounded-full p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"></path>
            </svg>
            <span class="text-sm font-medium">New Session</span>
          </div>
        </button>
      </div>

      <!-- 列表区域 - 优化内边距和间距 -->
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2.5 text-sm">
        <!-- 无数据状态 - 优化样式和间距 -->
        <div v-if="sessions.length === 0" class="flex flex-col items-center justify-center h-40 text-gray-400 bg-gray-50 rounded-2xl p-6">
          <svg class="w-10 h-10 mb-3 opacity-50 rounded-full p-1.5 bg-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
          </svg>
          <p class="text-sm font-medium">No sessions yet</p>
          <p class="text-xs mt-1 opacity-70">Click "New Session" to create your first session</p>
        </div>

        <!-- 会话列表项 - 优化交互和视觉效果 -->
        <div
          v-for="session in sessions"
          :key="session.id"
          @click="selectSession(session.id)"
          :class="[
            'px-4 py-3.5 rounded-2xl cursor-pointer transition-all duration-200 border border-transparent flex items-center gap-3',
            currentSessionId === session.id
              ? 'bg-indigo-500 text-white shadow-md border-indigo-600' 
              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:border-gray-200 hover:shadow-sm'
          ]"
        >
          <span 
            :class="[
              'w-2.5 h-2.5 rounded-full',
              currentSessionId === session.id ? 'bg-white' : 'bg-gray-300'
            ]"
          ></span>
          <p class="leading-relaxed break-words flex-1 font-medium">{{ session.title }}</p>
          <span 
            :class="[
              'w-8 h-8 flex items-center justify-center rounded-full opacity-0 hover:opacity-100 transition-all duration-200 transform hover:scale-110',
              currentSessionId === session.id ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            ]"
            @click.stop="deleteSession(session.id)"
            title="Delete session"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// 定义会话类型接口，提升类型安全性
interface Session {
  id: number;
  title: string;
}

// 模拟数据 - 明确类型定义
const sessions = ref<Session[]>([
  { id: 1, title: 'Guqin' },
  { id: 2, title: 'Three colored camel figurines carrying music' },
  { id: 3, title: 'New Exploration' }
])

const currentSessionId = ref<number>(1)

// 选择会话
function selectSession(id: number) {
  currentSessionId.value = id
}

// 创建新会话
function createNewSession() {
  const newId = Date.now()
  sessions.value.unshift({
    id: newId,
    title: 'New Session'
  })
  currentSessionId.value = newId
  
  // 滚动到顶部（新创建的会话）
  setTimeout(() => {
    const container = document.querySelector('.overflow-y-auto')
    if (container) {
      container.scrollTop = 0
    }
  }, 100)
}

// 删除会话 - 添加类型保护，修复 TS 报错
function deleteSession(id: number) {
  // 不能删除最后一个会话
  if (sessions.value.length <= 1) return
  
  const index = sessions.value.findIndex(session => session.id === id)
  if (index !== -1) {
    sessions.value.splice(index, 1)
    
    // 添加类型保护，确保数组不为空再访问
    if (currentSessionId.value === id && sessions.value.length > 0) {
      // 使用可选链和空值合并，确保类型安全
      const firstSession = sessions.value[0]
      if (firstSession) {
        currentSessionId.value = firstSession.id
      }
    }
  }
}
</script>

<style scoped>
/* 自定义滚动条 - 优化样式 */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #f8f8f8;
  border-radius: 3px;
  margin: 4px 0;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #e0e0e0;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #d0d0d0;
  border-radius: 3px;
}

/* 平滑滚动 */
.overflow-y-auto {
  scroll-behavior: smooth;
}

/* 确保所有边框元素都是圆角 */
* {
  border-radius: inherit !important;
}

/* 全局过渡效果优化 */
section {
  box-sizing: border-box;
}

/* 按钮点击反馈 */
button:active {
  transform: scale(0.98) !important;
}

/* 列表项焦点样式 */
div[class*="rounded-2xl cursor-pointer"]:focus {
  outline: 2px solid rgba(99, 102, 241, 0.5);
  outline-offset: 2px;
}
</style>
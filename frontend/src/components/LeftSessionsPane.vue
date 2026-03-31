<template>
  <div class="container">
    <section class="session-card">
      <div class="card-header">
        <div class="header-row">
          <h2 class="header-title">Projects</h2>
          <button
            @click="createNewSession"
            type="button"
            class="new-project-btn"
            title="New Project"
          >
            <svg class="new-project-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="session-list">
        <div class="empty-state" v-if="sessions.length === 0">
          <p class="empty-title">No projects yet</p>
        </div>

        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          @click="selectSession(session.id)"
          :class="['session-item', { active: currentSessionId === session.id }]"
        >
          <span class="status-dot"></span>
          <span class="session-title">{{ session.title }}</span>
          <span
            class="delete-btn"
            @click.stop="deleteSession(session.id)"
            title="Delete project"
          >
            <svg class="delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Session {
  id: number
  title: string
}

const sessions = ref<Session[]>([
  { id: 1, title: 'New Session' },
  { id: 2, title: 'Guqin' },
  { id: 3, title: 'Three colored camel figurines carrying music' }
])

const currentSessionId = ref<number>(1)

function selectSession(id: number) {
  currentSessionId.value = id
}

function createNewSession() {
  const newId = Date.now()
  sessions.value.unshift({ id: newId, title: 'New Session' })
  currentSessionId.value = newId

  setTimeout(() => {
    const container = document.querySelector('.session-list') as HTMLElement | null
    if (container) container.scrollTop = 0
  }, 50)
}

function deleteSession(id: number) {
  if (sessions.value.length <= 1) return
  const index = sessions.value.findIndex(session => session.id === id)
  if (index === -1) return

  sessions.value.splice(index, 1)
  if (currentSessionId.value === id && sessions.value.length > 0) {
    currentSessionId.value = sessions.value[0].id
  }
}
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.container {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0 5px 4px;
}

.session-card {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #e7eaf0;
  border-radius: 14px;
  overflow: hidden;
}

.card-header {
  padding: 8px 12px 6px;
  border-bottom: 1px solid #f1f3f6;
  background: #ffffff;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.header-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: #2f3946;
}

.new-project-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #e1e5eb;
  border-radius: 8px;
  background: #ffffff;
  color: #7d8796;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.new-project-btn:hover {
  background: #f6f7f9;
  border-color: #d5dbe3;
  color: #5e6878;
}

.new-project-icon {
  width: 14px;
  height: 14px;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-list::-webkit-scrollbar {
  width: 6px;
}

.session-list::-webkit-scrollbar-track {
  background: transparent;
}

.session-list::-webkit-scrollbar-thumb {
  background: #d6dbe3;
  border-radius: 999px;
}

.session-item {
  width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  color: #667085;
  transition: background 0.15s ease, color 0.15s ease;
}

.session-item:hover {
  background: #f7f8fa;
}

.session-item.active {
  background: #f0f2f5;
  color: #1f2937;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #c7ced8;
  flex-shrink: 0;
}

.session-item.active .status-dot {
  background: #4b5563;
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  word-break: break-word;
}

.delete-btn {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #8c96a5;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.session-item:hover .delete-btn,
.session-item.active .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #e9edf2;
}

.delete-icon {
  width: 12px;
  height: 12px;
}

.empty-state {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-title {
  font-size: 12px;
  color: #98a2b3;
}
</style>

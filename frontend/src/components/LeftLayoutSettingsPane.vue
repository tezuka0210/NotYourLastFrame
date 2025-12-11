<template>
  <div class="container">
    <section class="settings-card">
      <header class="settings-header">
        <h2 class="header-title">Layout & Colors</h2>
      </header>

      <div class="settings-content">
        <!-- Layout: Horizontal Spacing -->
        <div class="form-group">
          <label class="form-label">Horizontal Spacing</label>
          <div class="layout-control">
            <input
              type="range"
              min="40"
              max="320"
              step="10"
              v-model.number="horizontalGap"
              class="layout-slider"
            />
            <input
              type="number"
              min="40"
              max="320"
              step="10"
              v-model.number="horizontalGap"
              class="layout-input"
            />
          </div>
        </div>

        <!-- Layout: Vertical Spacing -->
        <div class="form-group">
          <label class="form-label">Vertical Spacing</label>
          <div class="layout-control">
            <input
              type="range"
              min="60"
              max="320"
              step="10"
              v-model.number="verticalGap"
              class="layout-slider"
            />
            <input
              type="number"
              min="60"
              max="320"
              step="10"
              v-model.number="verticalGap"
              class="layout-input"
            />
          </div>
        </div>

        <!-- Colors: Image Modality -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Image Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="imageColor"
              class="color-input"
            />
            <span class="color-hex">{{ imageColor }}</span>
          </div>
        </div>

        <!-- Colors: Video Modality -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Video Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="videoColor"
              class="color-input"
            />
            <span class="color-hex">{{ videoColor }}</span>
          </div>
        </div>

        <!-- Colors: Audio Modality -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Audio Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="audioColor"
              class="color-input"
            />
            <span class="color-hex">{{ audioColor }}</span>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="apply-btn" @click="applySettings">
          Apply Layout & Colors
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'apply-layout-settings', payload: {
    horizontalGap: number
    verticalGap: number
    colors: { image: string; video: string; audio: string }
  }): void
}>()

// 默认值与当前 dagre 设置保持一致（nodesep=100, ranksep=120）
const horizontalGap = ref(100)
const verticalGap = ref(120)

// 从全局 CSS 变量里读默认颜色（与你 style.css 里的 :root 保持一致）
const imageColor = ref('#5F96DB')
const videoColor = ref('#5ABF8E')
const audioColor = ref('#E06C6E')

onMounted(() => {
  const rootStyle = getComputedStyle(document.documentElement)

  const img = rootStyle.getPropertyValue('--media-image').trim()
  const vid = rootStyle.getPropertyValue('--media-video').trim()
  const aud = rootStyle.getPropertyValue('--media-audio').trim()

  if (img) imageColor.value = normalizeColor(img)
  if (vid) videoColor.value = normalizeColor(vid)
  if (aud) audioColor.value = normalizeColor(aud)
})

function normalizeColor(value: string): string {
  const trimmed = value.trim()
  // 现在你的 CSS 就是 #xxxxxx，直接返回即可
  if (trimmed.startsWith('#')) return trimmed
  return trimmed
}

/**
 * 简单 soft 颜色生成：把颜色往白色拉近（factor 越大越浅）
 * 比如 factor=0.5 表示往 #ffffff 走一半
 */
function makeSoftColor(hex: string, factor = 0.5): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex // 非法就原样返回

  const raw = m[1]
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)

  const mixChannel = (c: number) =>
    Math.round(c + (255 - c) * factor)

  const nr = mixChannel(r)
  const ng = mixChannel(g)
  const nb = mixChannel(b)

  const toHex = (c: number) => c.toString(16).padStart(2, '0')

  return '#' + toHex(nr) + toHex(ng) + toHex(nb)
}

const applySettings = () => {
  // 1) 基础颜色写入 CSS 变量
  document.documentElement.style.setProperty('--media-image', imageColor.value)
  document.documentElement.style.setProperty('--media-video', videoColor.value)
  document.documentElement.style.setProperty('--media-audio', audioColor.value)

  // 2) soft 颜色写入 CSS 变量（给卡片标题、渐变、背景用）
  const imageSoft = makeSoftColor(imageColor.value, 0.45)
  const videoSoft = makeSoftColor(videoColor.value, 0.45)
  const audioSoft = makeSoftColor(audioColor.value, 0.45)

  document.documentElement.style.setProperty('--media-image-soft', imageSoft)
  document.documentElement.style.setProperty('--media-video-soft', videoSoft)
  document.documentElement.style.setProperty('--media-audio-soft', audioSoft)

  // 3) 通过 window 事件广播布局 & 颜色更新（WorkflowTree.vue 监听）
  window.dispatchEvent(
    new CustomEvent('t2v-layout-updated', {
      detail: {
        horizontalGap: horizontalGap.value,
        verticalGap: verticalGap.value,
        colors: {
          image: imageColor.value,
          video: videoColor.value,
          audio: audioColor.value,
        },
      },
    }),
  )

  // 4) 同时通过 emit 暴露给父组件（如果你那边有用）
  emit('apply-layout-settings', {
    horizontalGap: horizontalGap.value,
    verticalGap: verticalGap.value,
    colors: {
      image: imageColor.value,
      video: videoColor.value,
      audio: audioColor.value,
    },
  })
}
</script>


<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  border-radius: inherit;
}

.container {
  width: 100%;
  max-width: 380px;
  margin: 0 auto;
  padding: 2px 16px;
}

.settings-card {
  width: 100%;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  border: 1px solid #f0f0f0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.settings-header {
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #f8f9fa;
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px; /* 稍微压缩垂直间距 */
  scroll-behavior: smooth;
}

.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: #f8f8f8;
  border-radius: 3px;
  margin: 4px 0;
}

.settings-content::-webkit-scrollbar-thumb {
  background: #e0e0e0;
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: #d0d0d0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.form-label {
  font-size: 10px;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-label-inline {
  font-size: 11px;
  font-weight: 600;
  color: #4b5563;
  white-space: nowrap;
}

/* 布局控制：slider + number */
.layout-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.layout-slider {
  flex: 1;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  appearance: none;
  cursor: pointer;
}

.layout-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6b7280;
  cursor: pointer;
  transition: all 0.2s ease;
}

.layout-slider::-webkit-slider-thumb:hover {
  background: #4b5563;
  transform: scale(1.05);
}

.layout-input {
  width: 56px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 4px 6px;
  font-size: 13px;
  text-align: center;
  color: #374151;
}

.layout-input:focus {
  outline: none;
  border-color: #6b7280;
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.1);
}

/* 颜色控制 */
.color-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-input {
  width: 32px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: transparent;
  cursor: pointer;
}

.color-hex {
  font-size: 12px;
  color: #4b5563;
}

/* 底部按钮 */
.settings-footer {
  padding: 16px;
  border-top: 1px solid #f0f0f0;
  background: #f8f9fa;
  border-radius: 0 0 20px 20px;
}

.apply-btn {
  width: 100%;
  padding: 4px 0;
  background: white;
  color: #6b7280;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.apply-btn:hover {
  color: #2d3038;
  border: 1px solid #3e4144;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.2);
}

.apply-btn:active {
  transform: scale(0.98);
}

.apply-btn:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(225, 234, 252, 0.3);
}
</style>

<template>
  <div class="container">
    <section class="settings-card">
      <header class="settings-header">
        <div class="header-row">
          <h2 class="header-title">Layout &amp; Colors</h2>
          <button class="apply-btn" @click="applySettings">Apply</button>
        </div>
      </header>

      <div class="settings-content">
        <div class="layout-row">
          <label class="row-label">Horizontal</label>
          <input
            type="range"
            min="40"
            max="320"
            step="10"
            v-model.number="horizontalGap"
            class="layout-slider"
            :style="sliderStyle(horizontalGap, 40, 320)"
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

        <div class="layout-row">
          <label class="row-label">Vertical</label>
          <input
            type="range"
            min="60"
            max="320"
            step="10"
            v-model.number="verticalGap"
            class="layout-slider"
            :style="sliderStyle(verticalGap, 60, 320)"
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

        <div class="color-row">
          <span class="row-label">Image Node</span>
          <div class="picker-wrap">
            <input type="color" v-model="imageColor" class="color-input" />
          </div>
        </div>

        <div class="color-row">
          <span class="row-label">Video Node</span>
          <div class="picker-wrap">
            <input type="color" v-model="videoColor" class="color-input" />
          </div>
        </div>

        <div class="color-row">
          <span class="row-label">Audio Node</span>
          <div class="picker-wrap">
            <input type="color" v-model="audioColor" class="color-input" />
          </div>
        </div>

        <div class="color-row">
          <span class="row-label">Merged Node</span>
          <div class="picker-wrap">
            <input type="color" v-model="overlapColor" class="color-input" />
          </div>
        </div>
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
    colors: { image: string; video: string; audio: string; overlap: string }
  }): void
}>()

const horizontalGap = ref(100)
const verticalGap = ref(120)

const imageColor = ref('#5F96DB')
const videoColor = ref('#5ABF8E')
const audioColor = ref('#E06C6E')
const overlapColor = ref('#7385A9')

onMounted(() => {
  const rootStyle = getComputedStyle(document.documentElement)
  const img = rootStyle.getPropertyValue('--media-image').trim()
  const vid = rootStyle.getPropertyValue('--media-video').trim()
  const aud = rootStyle.getPropertyValue('--media-audio').trim()
  const ovl = rootStyle.getPropertyValue('--media-overlap').trim()

  if (img) imageColor.value = normalizeColor(img)
  if (vid) videoColor.value = normalizeColor(vid)
  if (aud) audioColor.value = normalizeColor(aud)
  if (ovl) overlapColor.value = normalizeColor(ovl)
})

function normalizeColor(value: string): string {
  return value.trim()
}

function makeSoftColor(hex: string, factor = 0.45): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex

  const raw = m[1]
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)

  const mixChannel = (c: number) => Math.round(c + (255 - c) * factor)
  const toHex = (c: number) => c.toString(16).padStart(2, '0')

  return '#' + toHex(mixChannel(r)) + toHex(mixChannel(g)) + toHex(mixChannel(b))
}

function sliderStyle(value: number, min: number, max: number) {
  const ratio = ((value - min) / (max - min)) * 100
  return { '--fill': `${Math.max(0, Math.min(100, ratio))}%` }
}

const applySettings = () => {
  document.documentElement.style.setProperty('--media-image', imageColor.value)
  document.documentElement.style.setProperty('--media-video', videoColor.value)
  document.documentElement.style.setProperty('--media-audio', audioColor.value)
  document.documentElement.style.setProperty('--media-overlap', overlapColor.value)

  document.documentElement.style.setProperty('--media-image-soft', makeSoftColor(imageColor.value, 0.45))
  document.documentElement.style.setProperty('--media-video-soft', makeSoftColor(videoColor.value, 0.45))
  document.documentElement.style.setProperty('--media-audio-soft', makeSoftColor(audioColor.value, 0.45))
  document.documentElement.style.setProperty('--media-overlap-soft', makeSoftColor(overlapColor.value, 0.45))

  const detail = {
    horizontalGap: horizontalGap.value,
    verticalGap: verticalGap.value,
    colors: {
      image: imageColor.value,
      video: videoColor.value,
      audio: audioColor.value,
      overlap: overlapColor.value,
    },
  }

  window.dispatchEvent(new CustomEvent('t2v-layout-updated', { detail }))
  emit('apply-layout-settings', detail)
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

.settings-card {
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

.settings-header {
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

.apply-btn {
  height: 24px;
  min-width: 52px;
  padding: 0 10px;
  border: 1px solid #e1e5eb;
  border-radius: 8px;
  background: #ffffff;
  color: #7d8796;
  font-size: 11px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.apply-btn:hover {
  background: #f6f7f9;
  border-color: #d5dbe3;
  color: #5e6878;
}

.settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb {
  background: #d6dbe3;
  border-radius: 999px;
}

.layout-row,
.color-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 54px;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.row-label {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  color: #4b5563;
  white-space: nowrap;
}

.layout-slider {
  width: 100%;
  margin: 0;
  height: 16px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

.layout-slider::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  border: 1px solid #dde2e8;
  background: linear-gradient(
    to right,
    rgba(148, 163, 184, 0.18) 0 var(--fill, 0%),
    #ffffff var(--fill, 0%) 100%
  );
}

.layout-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -3px;
  border-radius: 50%;
  border: 1px solid #cdd3dc;
  background: #eef1f4;
}

.layout-slider::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  border: 1px solid #dde2e8;
  background: #ffffff;
}

.layout-slider::-moz-range-progress {
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
}

.layout-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid #cdd3dc;
  background: #eef1f4;
}

.layout-input,
.picker-wrap {
  width: 54px;
  height: 24px;
  border: 1px solid #dde2e8;
  border-radius: 8px;
  background: #ffffff;
  justify-self: end;
}

.layout-input {
  color: #667085;
  font-size: 10px;
  font-weight: 400;
  text-align: center;
  outline: none;
  padding: 0 4px;
}

.layout-input::-webkit-outer-spin-button,
.layout-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.layout-input[type='number'] {
  -moz-appearance: textfield;
}

.color-row .picker-wrap {
  grid-column: 3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-input {
  width: 42px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-input::-webkit-color-swatch {
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 2px;
}

.color-input::-moz-color-swatch {
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 2px;
}
</style>

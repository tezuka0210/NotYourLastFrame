<template>
  <div class="h-full min-h-0 box-border px-2 py-2">
    <div class="left-grid h-full min-h-0">
      <!-- 1) Sessions：按内容高度 -->
      <div class="min-h-0">
        <LeftSessionsPane class="h-full" />
      </div>

      <!-- 2) Layout settings：吃掉剩余空间 -->
      <div class="min-h-0">
        <LeftLayoutSettingsPane
          class="h-full"
          @apply-layout-settings="handleApplyLayoutSettings"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import LeftSessionsPane from './LeftSessionsPane.vue'
import LeftLayoutSettingsPane from './LeftLayoutSettingsPane.vue'

const handleApplyLayoutSettings = (payload: {
  horizontalGap: number
  verticalGap: number
  colors: { image: string; video: string; audio: string; overlap: string }
}) => {
  window.dispatchEvent(new CustomEvent('layout-settings-changed', { detail: payload }))
}
</script>

<style scoped>
.left-grid {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 0;
}
</style>
<template>
  <div class="h-full min-h-0 box-border p-2">
    <div class="left-grid h-full min-h-0">
      <!-- 1) Sessions：吃剩余高度；内部内容可以滚动 -->
      <div class="min-h-0 pt-[4px]">
        <LeftSessionsPane class="h-full" />
      </div>

      <!-- 2) Global settings：固定高度（随屏幕 clamp） -->
      <div class="min-h-0">
        <LeftGlobalSettingsPane class="h-full" />
      </div>

      <!-- 3) Layout settings：固定高度（随屏幕 clamp）+ 底部 4px -->
      <div class="min-h-0 pb-[4px]">
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
import LeftGlobalSettingsPane from './LeftGlobalSettingsPane.vue'
import LeftLayoutSettingsPane from './LeftLayoutSettingsPane.vue'

const handleApplyLayoutSettings = (payload: {
  horizontalGap: number
  verticalGap: number
  colors: { image: string; video: string; audio: string }
}) => {
  window.dispatchEvent(new CustomEvent('layout-settings-changed', { detail: payload }))
}
</script>

<style scoped>
/* 三段式：上面 minmax(0,1fr)；下面两段固定高度但可随屏幕变化 */
.left-grid{
  display: grid;
  grid-template-rows: minmax(0, 1fr) var(--lg-h) var(--ll-h);

  min-height: 0;
}

/* 大小屏兼容：用 clamp 在一个合理范围内自动伸缩 */
:root{
  --lg-h: clamp(220px, 30vh, 320px); /* Global Settings 高度 */
  --ll-h: clamp(220px, 30vh, 320px); /* Layout Settings 高度 */
}

/* 极矮屏：稍微压低下两块，避免 sessions 被挤没 */
@media (max-height: 760px){
  :root{
    --lg-h: clamp(180px, 28vh, 260px);
    --ll-h: clamp(180px, 28vh, 260px);
  }
}
</style>

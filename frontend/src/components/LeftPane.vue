<template>
  <div class="flex flex-col h-full min-h-0 space-y-3 p-2 box-border">
    <!-- 上半：Session -->
    <div class="flex-1 min-h-0">
      <LeftSessionsPane class="h-full" />
    </div>

    <!-- 下半：两个设置卡片 -->
    <div class="min-h-[400px] flex flex-col gap-2">
      <div class="flex-1 min-h-0">
        <LeftGlobalSettingsPane class="h-full" />
      </div>
      <div class="flex-1 min-h-0">
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
  // 简单做法：用 window 事件广播给中心工作流视图
  window.dispatchEvent(
    new CustomEvent('layout-settings-changed', { detail: payload }),
  )
}
</script>

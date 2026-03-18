<template>
  <aside class="h-full min-h-0 bg-white rounded-lg shadow p-3 flex flex-col">
    <header class="mb-2">
      <h2 class="text-sm font-semibold text-gray-700">Inspector / Metadata</h2>
    </header>

    <div class="text-xs text-gray-500 mb-4">
      Right pane placeholder. You can put node details, logs,
      or advanced timeline controls here later.
    </div>

    <div class="mt-4 flex flex-col flex-1">
      <h3 class="text-xs font-semibold text-gray-700 mb-2">Drawing Canvas</h3>
      <!-- 绘画面板：纯原生DOM，无Vue渲染逻辑 -->
      <div 
        id="drawing-board"
        class="flex-1 min-h-[300px] border-2 border-dashed border-gray-300 rounded-lg relative overflow-hidden bg-gray-50 transition-all duration-200"
      >
        <!-- 原生占位提示（由JS控制显示/隐藏） -->
        <div class="canvas-placeholder absolute inset-0 flex flex-col items-center justify-center text-xs text-gray-400">
          <span>🖱️ Drag & drop segmented entities here</span>
        </div>
      </div>

      <!-- 清空按钮：只保留ID，无Vue事件 -->
      <div class="mt-2 flex gap-2">
        <button 
          id="clear-canvas-btn"
          class="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
// 导入独立的拖拽处理函数
import { initCanvasDrag } from '@/lib/canvasDrag.js';

// 组件挂载后初始化拖拽监听（去掉setTimeout，直接执行）
onMounted(() => {
  initCanvasDrag();
});
</script>

<style scoped>
#drawing-board {
  user-select: none;
}
/* 拖拽进入时高亮样式 */
#drawing-board.dragover {
  border-color: #3B82F6 !important;
  background-color: rgba(59, 130, 246, 0.05) !important;
}
#drawing-board img:hover {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}
.canvas-placeholder {
  user-select: none;
}
/* 有图片时隐藏占位提示 */
#drawing-board:has(img) .canvas-placeholder {
  display: none;
}

#canvas-drag-container {
  margin-top: 8px;
  user-select: none;
}
#canvas-drag-container img {
  pointer-events: none; /* 避免图片拦截拖拽事件 */
}

</style>
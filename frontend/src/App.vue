<template>
  <div class="app-container">
    <!-- 顶部细细一条标题栏 -->
    <header class="title-bar">
      <div class="title-main">
        <h1>T2VTree Visual Analytics System</h1>
        <!-- <p id="status">{{ statusText }}</p> -->
      </div>
      <!-- 右上角可以预留一些全局状态 / 按钮位 -->
      <!-- <div class="title-actions">...</div> -->
    </header>

    <!-- 三列外壳 -->
    <div class="app-shell">
      <!-- 左列：会话 + 全局参数 -->
      <aside class="col col-left">
        <LeftPane />
      </aside>

      <!-- 中列：上树，下拼接 -->
      <main class="col col-center">
        <div class="center-top">
          <WorkflowTree
            class="tree-wrapper"
            :nodes="viewNodes"
            v-model:selectedIds="selectedParentIds"
            @delete-node="handleDeleteNode"
            @add-clip="addClipToStitch"
            @open-preview="openPreview"
            @open-generation="handleOpenGenerationPopover"
            @toggle-collapse="toggleNodeCollapse"
            @create-card="createCard"
            @refresh-node="handleRefreshNode"
            @upload-media="updateNodeMedia"
            @regenerate-node="handleGenerate"
          />
        </div>

        <div class="center-bottom">
          <StitchingPanel
            :clips="stitchingClips"
            :audioClips="audioClips"
            :bufferClips="bufferClips"
            :is-stitching="isStitching"
            :stitch-result-url="stitchResultUrl"
            @update:clips="handleClipsUpdate"
            @update:bufferClips="handleBufferUpdate"
            @update:audioClips="handleAudioUpdate"
            @remove-clip="removeClipFromStitch"
            @remove-audio-clip="removeClipFromAudio"
            @stitch="onStitchRequest"
          />
        </div>
      </main>

      <!-- 右列：先占位，将来用。当前宽度设为 0，看不到 -->
      <aside class="col col-right">
        <RightPane />
      </aside>
    </div>

    <!-- 预览弹窗 -->
    <PreviewModal
      v-if="isPreviewOpen"
      :url="previewMedia.url"
      :type="previewMedia.type"
      @close="closePreview"
    />

    <!-- 生成配置弹窗 -->
    <GenerationPopover
      v-if="isGenerationPopoverOpen"
      :selected-ids="selectedParentIds"
      :is-generating="isGenerating"
      :initial-module-id="initialModuleIdForPopover"
      :initial-workflow-type="initialWorkflowTypeForPopover"
      @close="isGenerationPopoverOpen = false"
      
      
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'

import {
  useWorkflow,
  type AppNode,
  type StitchingClip,
  type BufferClip,     
  type AudioClip      
} from '@/composables/useWorkflow'

import { buildWorkflowView } from '@/lib/workflowLayout'

import WorkflowTree from './components/WorkflowTree.vue'
import StitchingPanel from './components/StitchingPanel.vue'
import PreviewModal from './components/PreviewModal.vue'
import GenerationPopover from './components/GenerationPopover.vue'

import LeftPane from './components/LeftPane.vue'
import RightPane from './components/RightPane.vue'
import type { S } from 'node_modules/tailwindcss/dist/types-WlZgYgM8.d.mts'

const {
  statusText,
  allNodes,
  selectedParentIds,
  stitchingClips,
  audioClips,
  bufferClips,
  isGenerating,
  isStitching,
  isPreviewOpen,
  previewMedia,

  loadAndRender,
  handleGenerate,
  handleFileUpload,
  handleDeleteNode,
  addClipToStitch,
  removeClipFromStitch,
  removeClipFromAudio,
  handleStitchRequest,
  openPreview,
  closePreview,
  toggleNodeCollapse,
  updateNodeMedia,
} = useWorkflow()

// ⭐ 把 AppNode[] → ViewNode[]（带 cardType/title/isInit 的视图节点）
const viewNodes = computed(() => buildWorkflowView(allNodes.value))

function handleClipsUpdate(newList: StitchingClip[]) {
  stitchingClips.splice(0, stitchingClips.length, ...newList)
}

function handleBufferUpdate(newList: BufferClip[]) {
  bufferClips.splice(0, bufferClips.length, ...newList)
}

function handleAudioUpdate(newList: AudioClip[]) {
  audioClips.splice(0, audioClips.length, ...newList)
}

watch(
  selectedParentIds,
  (newIds) => {
    console.log(
      '%c[App] selectedParentIds updated',
      'color:#FF69B4;font-weight:bold;',
      newIds,
    )
  },
  { deep: true }
)

const stitchResultUrl = ref<string | null>(null)

async function onStitchRequest() {
  stitchResultUrl.value = null
  const resultUrl = await handleStitchRequest()
  if (resultUrl) {
    stitchResultUrl.value = resultUrl
  }
}

/**
 * 处理 Init 节点的直接生成请求
 * @param {Object} parentNode - Init 节点对象
 * @param {String} moduleId - 要生成的模块ID (这里是 'textFull')
 */
const createCard = async (parentNode: AppNode, moduleId: string) => {
  console.log(`[App] 收到直接生成请求: Parent=${parentNode.id}, Module=${moduleId}`);
  const newNodeId = crypto.randomUUID();
  selectedParentIds.value = [parentNode.id];
  const defaultParams = {
    
  };
  await handleGenerate(newNodeId,moduleId, defaultParams,moduleId);
  selectedParentIds.value = []; 
}

const handleRefreshNode = (nodeId: string, newModuleId: string, updatedParams: Record<string, any>,title: Record<string, any>) => {
  // 找到需要刷新的节点并修改其数据（触发响应式更新）
  allNodes.value = allNodes.value.map(node => {
    if (node.id === nodeId) {
      // 同时更新模块ID和参数
      return {
        ...node,
        module_id: newModuleId,       // 更新模块类型
        title:title,
        parameters: updatedParams  // 更新参数
      };
    }
    return node;
  });
};


const isGenerationPopoverOpen = ref(false)
const initialModuleIdForPopover = ref<string | null>(null)
const initialWorkflowTypeForPopover = ref<'preprocess' | 'image' | 'video' | null>(null)

function handleOpenGenerationPopover(
  node: AppNode,
  defaultModuleId: string,
  workflowType: 'preprocess' | 'image' | 'video'
) {
  if (!selectedParentIds.value.includes(node.id)) {
    if (selectedParentIds.value.length < 2) {
      selectedParentIds.value = [...selectedParentIds.value, node.id]
    } else {
      alert('Max 2 parents selected. Opening popover with current selection.')
    }
  }
  initialModuleIdForPopover.value = defaultModuleId
  initialWorkflowTypeForPopover.value = workflowType
  isGenerationPopoverOpen.value = true
}

onMounted(() => {
  loadAndRender()
})
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  background: #f3f4f6;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
}

:root {
  --shell-gap: 8px;
  --left-col-w: 320px;
  --right-col-w: 0px; /* 右侧暂时不用：0px，后面要的话改 320/360 即可 */
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 顶部：固定占 4% 高度 */
.title-bar {
  flex: 0 0 4%;
  min-height: 32px;          /* 避免窗口太小的时候压扁 */
  max-height: 56px;          /* 不要太高 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  box-sizing: border-box;
  background: #ffffffee;
  border-bottom: 1px solid #e5e7eb;
  backdrop-filter: blur(8px);
}

.title-main h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;

  background-image: linear-gradient(
    80deg,
    #5A8CCD,  /* 深蓝（Image） */
    #4FB488,  /* 深青绿（Video） */
    #F3A953,  /* 深橙黄（Text） */
    #D87474   /* 深玫瑰红（Audio） */
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;

  /* 轻微发光，让颜色更立体 */
  text-shadow: 0 0 1px rgba(0,0,0,0.15);
}

/* 渐变缓慢流动 */
@keyframes titleGradientShift {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 100% 50%;
  }
}


.title-main p {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

/* 下方三列区域：占剩余 96% 高度 */
.app-shell {
  flex: 1 1 96%;
  min-height: 0; /* 允许内部滚动 */
  display: grid;
  grid-template-columns: var(--left-col-w) minmax(0, 1fr) var(--right-col-w);
  gap: var(--shell-gap);
  padding: var(--shell-gap);
  box-sizing: border-box;
  align-items: stretch;
  overflow: hidden;
}

/* 三列通用卡片样式 */
.col {
  background: #ffffff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.04), 0 8px 18px rgba(15, 23, 42, 0.06);
}

.col-left {
  box-sizing: border-box;
}

.col-center {
  padding: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 中间列上下区域 */
.center-top {
  flex: 1 1 0;
  min-height: 0;
  padding: 8px 8px 6px;
  box-sizing: border-box;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  flex-direction: column;
}

.tree-wrapper {
  flex: 1;
  min-height: 0;
}

.center-bottom {
  padding: 4px 8px 8px;
  box-sizing: border-box;
  flex: 0 0 32%;
  min-height: 0;   /* 关键：允许内部子组件用 h-full 撑满 */
  display: flex;   /* 关键：把 StitchingPanel 作为可拉伸子项 */
  flex-direction: column;
}

.col-right {
  box-sizing: border-box;
}
</style>


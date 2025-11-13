<template>
  <div class="container mx-auto p-4 h-full flex flex-col">
    <header class="text-center mb-6">
      <h1 class="text-3xl font-semibold" style="color:#374151;">Workflow Creation and Review</h1>
      <p id="status" class="text-gray-500 mt-1">{{ statusText }}</p>
    </header>

    <main class="flex-1 flex flex-col gap-4 min-h-0">
      <WorkflowTree
        class="flex-1 min-h-0"
        :nodes="allNodes"
        v-model:selectedIds="selectedParentIds"
        @delete-node="handleDeleteNode"
        @add-clip="addClipToStitch"
        @open-preview="openPreview"
        @open-generation="handleOpenGenerationPopover"
        @toggle-collapse="toggleNodeCollapse"
      />
      <StitchingPanel
        :clips="stitchingClips"
        :audioClips="audioClips"
        :is-stitching="isStitching"
        :stitch-result-url="stitchResultUrl"
        @update:clips="handleClipsUpdate"
        @remove-clip="removeClipFromStitch"
        @remove-audio-clip="removeClipFromAudio"
        @stitch="onStitchRequest"
      />
    </main>
    <PreviewModal
      v-if="isPreviewOpen"
      :url="previewMedia.url"
      :type="previewMedia.type"
      @close="closePreview"
    />
    <GenerationPopover
      v-if="isGenerationPopoverOpen"
      :selected-ids="selectedParentIds"
      :is-generating="isGenerating"
      :initial-module-id="initialModuleIdForPopover"
      :initial-workflow-type="initialWorkflowTypeForPopover" @close="isGenerationPopoverOpen = false"
      @generate="handleGenerate"
      @upload="handleFileUpload"
    />

  </div>
</template>

<script setup lang="ts">
// --- 1. 导入 Vue 核心功能 ---
import { onMounted, ref, watch } from 'vue'

// --- 2. 导入我们的 Composable (状态和逻辑) ---
import { useWorkflow, workflowTypes, type AppNode, type StitchingClip } from '@/composables/useWorkflow'

// --- 3. 导入所有子组件 ---
import WorkflowTree from './components/WorkflowTree.vue'
//import WorkflowForm from './components/WorkflowForm.vue'
import StitchingPanel from './components/StitchingPanel.vue'
import PreviewModal from './components/PreviewModal.vue'

import GenerationPopover from './components/GenerationPopover.vue' 

// --- 4. (核心) 初始化 Composable ---
// 这会创建所有的响应式状态 (ref, reactive) 和函数
const {
  // 状态 (State)
  statusText,
  allNodes,
  selectedParentIds,
  stitchingClips,
  audioClips,
  isGenerating,
  isStitching,
  isPreviewOpen,
  previewMedia,

  // 逻辑 (Actions)
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
} = useWorkflow()

function handleClipsUpdate(newList: StitchingClip[]) {
  // 我们不能执行: stitchingClips = newList (这是错的)

  // 我们必须“就地修改” (mutate) 原始的 reactive 数组
  stitchingClips.splice(0, stitchingClips.length, ...newList);
}


// 这个 watch 会告诉我们 App.vue 的“父状态”是否真的更新了
watch(selectedParentIds, (newIds) => {
  console.log(
    `%c[App] 3. 状态已更新 (selectedParentIds)`,
    'color: #FF69B4; font-weight: bold;',
    newIds
  );
}, { deep: true });

// --- 5. App.vue 自己的本地状态 ---
// 用于存储拼接完成后的下载 URL
const stitchResultUrl = ref<string | null>(null)

// --- 6. 事件处理包装器 ---
// (因为 handleStitchRequest 会返回一个值, 我们需要在这里接收它)
async function onStitchRequest() {
  stitchResultUrl.value = null // 1. 清除旧的 URL
  const resultUrl = await handleStitchRequest() // 2. 调用 composable 里的函数
  if (resultUrl) {
    stitchResultUrl.value = resultUrl // 3. 将返回的 URL 存入本地状态
  }
}

// (核心修改 7) 添加新状态来控制弹窗
const isGenerationPopoverOpen = ref(false)
// (Core Change 8) New ref to store the module ID from the clicked dot
const initialModuleIdForPopover = ref<string | null>(null) 
const initialWorkflowTypeForPopover = ref<'preprocess' | 'image' | 'video' | null>(null) 

// (Core Change 9) Update function signature and logic
function handleOpenGenerationPopover(node: AppNode, defaultModuleId: string, workflowType:'preprocess'|'image'|'video') {
  // 1. Set the clicked node as the initial parent
  //    (User can still click others while popover is open if needed,
  //     but handleGenerate will use the final selectedParentIds.value)
  if (!selectedParentIds.value.includes(node.id)) {
      if (selectedParentIds.value.length < 2) {
          selectedParentIds.value = [...selectedParentIds.value, node.id];
      } else {
          alert("Max 2 parents selected. Opening popover with current selection.");
      }
  }
  // 2. Store the default module ID for the popover
  initialModuleIdForPopover.value = defaultModuleId;
  initialWorkflowTypeForPopover.value = workflowType;
  // 3. Open the popover
  isGenerationPopoverOpen.value = true; 
}

// // (核心修改 8) 添加新函数来处理来自树的事件
// function handleOpenGenerationPopover(node: AppNode) {
//   // 无论如何，都打开弹窗
//   isGenerationPopoverOpen.value = true;
// }

// --- 7. 生命周期钩子 ---
// (当 App.vue 组件被挂载到页面上时，执行一次)
onMounted(() => {
  // 调用 composable 中的函数，加载初始数据
  loadAndRender()
})
</script>
<template>
  <div class="app-container" :class="{ 'is-resizing': resizingMode !== null }">
    <!-- Top Title Bar -->
    <header class="title-bar">
      <div class="title-main">
        <h1>ShotWeaver: Branching Video Storyboard Authoring</h1>
      </div>
    </header>

    <!-- Main Workspace -->
    <main ref="appShellRef" class="app-shell">
      <!-- Top Resizable Area -->
      <section class="workspace-top-shell" :style="topShellStyle">
        <div ref="topWorkspaceRef" class="workspace-top">
          <!-- Tree Panel -->
          <div class="tree-panel-shell" :style="treePaneStyle">
            <section class="tree-panel">
              <button
                class="drawer-toggle"
                :class="{ open: isLeftPaneOpen }"
                @click="isLeftPaneOpen = !isLeftPaneOpen"
                :title="isLeftPaneOpen ? 'Collapse left panel' : 'Expand left panel'"
              >
                <svg viewBox="0 0 24 24" class="drawer-icon">
                  <path
                    d="M9 6l6 6-6 6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>

              <transition name="drawer-slide">
                <aside v-if="isLeftPaneOpen" class="left-drawer">
                  <LeftPane />
                </aside>
              </transition>

              <div class="tree-scroll-shell">
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
                  @merge-nodes="handleMergeNodes"
                  @update:ungroup="handleUngroup"
                />
              </div>
            </section>
          </div>

          <!-- Vertical Splitter -->
          <div
            class="splitter splitter-vertical"
            title="Drag to resize left and right panels"
            @mousedown="startVerticalResize"
          >
            <span class="splitter-line"></span>
          </div>

          <!-- Right Workspace -->
          <div class="right-workspace-shell">
            <section class="right-workspace">
              <RightPane class="right-pane-root" />
            </section>
          </div>
        </div>
      </section>

      <!-- Horizontal Splitter -->
      <div
        class="splitter splitter-horizontal"
        title="Drag to resize top and bottom panels"
        @mousedown="startHorizontalResize"
      >
        <span class="splitter-line"></span>
      </div>

      <!-- Bottom Stitching Area -->
      <section class="workspace-bottom-shell">
        <div class="workspace-bottom">
          <div class="stitch-content stitch-content--overlay">
            <button
              class="icon-btn stitch-floating-btn"
              :disabled="isStitching"
              title="Stitch video"
              @click="onStitchRequest"
            >
              <svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 4v10" />
                <path d="M8 10l4 4 4-4" />
                <rect x="5" y="17" width="14" height="3" rx="1.5" />
              </svg>
            </button>

            <StitchingPanel
              class="stitch-wrapper"
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
        </div>
      </section>
    </main>

    <!-- Preview Modal -->
    <PreviewModal
      v-if="isPreviewOpen"
      :url="previewMedia.url"
      :type="previewMedia.type"
      @close="closePreview"
    />

    <!-- Generation Popover -->
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

interface MergeNodesPayload {
  originalNodeIds: string[];
  mergedNode: AppNode;
}

interface UngroupTarget extends AppNode {
  combinedNodes?: string[];
  sourceNodeIds?: string[];
  lastInternalNodeId?: string;
}

const {
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

const isLeftPaneOpen = ref(false)
const stitchResultUrl = ref<string | null>(null)

const appShellRef = ref<HTMLElement | null>(null)
const topWorkspaceRef = ref<HTMLElement | null>(null)

const leftPaneRatio = ref(0.38)
const topPaneRatio = ref(0.64)

const resizingMode = ref<'vertical' | 'horizontal' | null>(null)

const viewNodes = computed(() => buildWorkflowView(allNodes.value))

const topShellStyle = computed(() => ({
  flexBasis: `${(topPaneRatio.value * 100).toFixed(2)}%`,
}))

const treePaneStyle = computed(() => ({
  flexBasis: `${(leftPaneRatio.value * 100).toFixed(2)}%`,
}))

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function startVerticalResize(e: MouseEvent) {
  if (window.innerWidth < 980) return
  resizingMode.value = 'vertical'
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  e.preventDefault()
}

function startHorizontalResize(e: MouseEvent) {
  resizingMode.value = 'horizontal'
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
  e.preventDefault()
}

function stopResize() {
  resizingMode.value = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

function onGlobalMouseMove(e: MouseEvent) {
  if (resizingMode.value === 'vertical' && topWorkspaceRef.value) {
    const rect = topWorkspaceRef.value.getBoundingClientRect()
    const minLeft = 300
    const minRight = 460

    const nextLeft = clamp(e.clientX - rect.left, minLeft, rect.width - minRight)
    leftPaneRatio.value = nextLeft / rect.width
    return
  }

  if (resizingMode.value === 'horizontal' && appShellRef.value) {
    const rect = appShellRef.value.getBoundingClientRect()
    const minTop = 260
    const minBottom = 220

    const nextTop = clamp(e.clientY - rect.top, minTop, rect.height - minBottom)
    topPaneRatio.value = nextTop / rect.height
  }
}

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

async function onStitchRequest() {
  stitchResultUrl.value = null
  const resultUrl = await handleStitchRequest()
  if (resultUrl) {
    stitchResultUrl.value = resultUrl
  }
}

/**
 * Init 节点的直接生成请求
 */
const createCard = async (parentNode: AppNode, moduleId: string) => {
  console.log(`[App] direct generation request: Parent=${parentNode.id}, Module=${moduleId}`)
  const newNodeId = crypto.randomUUID()
  selectedParentIds.value = [parentNode.id]
  const defaultParams = {}
  await handleGenerate(newNodeId, moduleId, defaultParams, moduleId)
  selectedParentIds.value = []
}

const handleRefreshNode = (
  nodeId: string,
  newModuleId: string,
  updatedParams: Record<string, any>,
  title: Record<string, any>
) => {
  allNodes.value = allNodes.value.map(node => {
    if (node.id === nodeId) {
      return {
        ...node,
        module_id: newModuleId,
        title,
        parameters: updatedParams
      }
    }
    return node
  })
}

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

function handleMergeNodes({ originalNodeIds, mergedNode }: MergeNodesPayload) {
  allNodes.value = allNodes.value.filter(node => !originalNodeIds.includes(node.id))

  const originalParents = (mergedNode as any).originalParents || []
  if (originalParents.length > 0) {
    originalParents.forEach((parentId: string) => {
      const parentNode = allNodes.value.find(n => n.id === parentId)
      if (parentNode) {
        parentNode.childrenIds = parentNode.childrenIds || []
        parentNode.childrenIds = parentNode.childrenIds
          .filter(id => !originalNodeIds.includes(id))
          .concat(mergedNode.id)
      }
    })
  }

  if (mergedNode.childrenIds && mergedNode.childrenIds.length > 0) {
    allNodes.value = allNodes.value.map(node => {
      if (mergedNode.childrenIds?.includes(node.id)) {
        return {
          ...node,
          originalParents: [mergedNode.id]
        } as AppNode
      }
      return node
    })
  }

  allNodes.value.push(mergedNode)
  selectedParentIds.value = [mergedNode.id]

  console.log('✅ Composite node:', mergedNode.id, 'children:', mergedNode.childrenIds)
}

function handleUngroup(compositeNode: UngroupTarget) {
  console.log('Start ungroup composite node:', compositeNode.id)

  const innerNodeIds =
    compositeNode.combinedNodes ||
    compositeNode.sourceNodeIds ||
    []

  const fallbackParentId =
    compositeNode.lastInternalNodeId ||
    innerNodeIds[innerNodeIds.length - 1] ||
    null

  allNodes.value = allNodes.value
    .filter(node => node.id !== compositeNode.id)
    .map(node => {
      const nextNode: any = { ...node }

      if (
        Array.isArray(nextNode.originalParents) &&
        nextNode.originalParents.includes(compositeNode.id) &&
        fallbackParentId
      ) {
        nextNode.originalParents = nextNode.originalParents.map((pId: string) =>
          pId === compositeNode.id ? fallbackParentId : pId
        )
      }

      if (innerNodeIds.includes(nextNode.id)) {
        nextNode.isComposite = false
      }

      return nextNode
    })

  selectedParentIds.value = fallbackParentId ? [fallbackParentId] : []

  console.log('Ungroup completed, node references repaired')
}

onMounted(() => {
  loadAndRender()
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', stopResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', stopResize)
})
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  background: #f3f4f6;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Text",
    "Helvetica Neue",
    Arial,
    sans-serif;
}

:root {
  --shell-gap: 6px 8px 8px 6px;
  --page-max-width: 1480px;
  --drawer-w: 280px;
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-container.is-resizing * {
  cursor: inherit !important;
}

/* Top title */
.title-bar {
  flex: 0 0 40px;
  min-height: 40px;
  width: min(var(--page-max-width), calc(100vw - 20px));
  margin: 0 auto;
  display: flex;
  align-items: center;
  box-sizing: border-box;

  background-image: linear-gradient(
    80deg,
    #5A8CCD,
    #4FB488,
    #F3A953,
    #D87474
  );
}

.title-main {
  width: 100%;
  padding: 0 14px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.title-main h1 {
  margin: 0;
  font-size: 13px;
  line-height: 1.1;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}

/* Main shell */
.app-shell {
  flex: 1 1 auto;
  min-height: 0;
  width: min(var(--page-max-width), calc(100vw - 20px));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--shell-gap);
  padding: var(--shell-gap);
  box-sizing: border-box;
  overflow: hidden;
}

.workspace-top-shell {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-top {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow: hidden;
}

/* Tree side */
.tree-panel-shell {
  min-width: 0;
  min-height: 0;
  display: flex;
}

.tree-panel {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 8px 18px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
}

.drawer-toggle {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 20;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  color: #6b7280;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.06),
    0 2px 10px rgba(15, 23, 42, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
}

.drawer-toggle:hover {
  color: #111827;
  background: #f9fafb;
}

.drawer-toggle.open .drawer-icon {
  transform: rotate(180deg);
}

.drawer-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s ease;
}

.left-drawer {
  position: absolute;
  top: 10px;
  left: 48px;
  bottom: 10px;
  width: min(var(--drawer-w), calc(100% - 58px));
  background: #ffffff;
  border-radius: 12px;
  overflow: auto;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.05),
    0 12px 24px rgba(15, 23, 42, 0.10);
  z-index: 18;
}

.tree-scroll-shell {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 8px 8px 8px 44px;
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
}

.tree-wrapper {
  flex: 1 1 auto;
  min-width: 100%;
  min-height: 100%;
}

/* Try to let the top-level workflow SVG stretch */
.tree-wrapper > svg,
.tree-wrapper > div > svg {
  display: block;
  width: 100%;
  min-height: 100%;
  height: 100%;
}

/* Right side */
.right-workspace-shell {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.right-workspace {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 8px 18px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
}

.right-pane-root {
  flex: 1 1 auto;
  min-height: 0;
}

/* Bottom area */
.workspace-bottom-shell {
  flex: 1 1 auto;
  min-height: 220px;
  overflow: hidden;
  display: flex;
}

.workspace-bottom {
  flex: 1 1 auto;
  min-height: 0;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 8px 18px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  padding: 4px 8px 8px 8px;
  box-sizing: border-box;
}

.stitch-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  position: relative;
}

.stitch-content--overlay {
  padding-top: 0;
}

.stitch-floating-btn {
  position: absolute;
  top: 18px;
  right: 20px;
  z-index: 20;
  background: rgba(255, 255, 255, 0.96);
  border-color: #d1d5db;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 2px 8px rgba(15, 23, 42, 0.08);
}

.stitch-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* Splitters */
.splitter {
  position: relative;
  flex: 0 0 auto;
  z-index: 14;
}

.splitter:hover .splitter-line {
  background: #9ca3af;
}

.splitter-vertical {
  width: 10px;
  cursor: col-resize;
}

.splitter-horizontal {
  height: 10px;
  cursor: row-resize;
  margin: -2px 0;
}

.splitter-line {
  position: absolute;
  inset: 0;
  margin: auto;
  border-radius: 999px;
  background: transparent;
  transition: background 0.15s ease;
}

.splitter-vertical .splitter-line {
  width: 2px;
  height: calc(100% - 20px);
}

.splitter-horizontal .splitter-line {
  width: calc(100% - 20px);
  height: 2px;
}

/* Toolbar button style */
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: #6b7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.12s ease;
}

.icon-btn:hover:not(:disabled) {
  background: #ffffff;
  border-color: #d1d5db;
  color: #374151;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.icon-btn:active:not(:disabled) {
  transform: translateY(0.5px);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-svg {
  width: 15px;
  height: 15px;
  vector-effect: non-scaling-stroke;
}

/* Drawer animation */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: all 0.22s ease;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

/* Responsive */
@media (max-width: 1440px) {
  :root {
    --page-max-width: 1380px;
  }
}

@media (max-width: 1180px) {
  :root {
    --page-max-width: 1120px;
  }
}

@media (max-width: 980px) {
  .app-shell {
    width: min(98vw, 1120px);
  }

  .workspace-top {
    flex-direction: column;
  }

  .tree-panel-shell,
  .right-workspace-shell {
    flex-basis: auto !important;
  }

  .splitter-vertical {
    display: none;
  }

  .left-drawer {
    width: min(280px, calc(100% - 58px));
  }
}
</style>
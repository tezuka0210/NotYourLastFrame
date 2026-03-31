<template>
  <div
    id="chart-wrapper"
    class="flex-1 min-h-0 workflow-tree-shell"
  >
    <svg ref="svgContainer" class="w-full h-full"></svg>

    <div v-if="showToolbar" class="workflow-toolbar">
      <div class="toolbar-status" :class="{ active: boxSelectMode }">
        {{ toolbarStatusText }}
      </div>
      <div class="toolbar-actions">
        <button
          class="toolbar-btn toolbar-btn-primary"
          :disabled="!canMerge"
          @click.stop="mergeSelectedNodes(localSelectedIds)"
        >
          Merge
        </button>
        <button
          v-if="localSelectedIds.length > 0"
          class="toolbar-btn"
          @click.stop="clearSelection"
        >
          Clear
        </button>
        <button
          class="toolbar-btn"
          @click.stop="startBoxSelectMode"
        >
          {{ boxSelectMode ? 'Reselect' : 'Box' }}
        </button>
        <button
          v-if="boxSelectMode"
          class="toolbar-btn"
          @click.stop="stopBoxSelectMode"
        >
          Done
        </button>
      </div>
    </div>

    <div
      v-if="selecting"
      class="selection-box"
      :style="{
        left: selectBox.left + 'px',
        top: selectBox.top + 'px',
        width: selectBox.width + 'px',
        height: selectBox.height + 'px'
      }"
    ></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { workflowTypes } from '@/composables/useWorkflow'
import * as d3 from 'd3'
import {
  renderTree,
  updateSelectionStyles
} from '@/lib/workflowGraph.js'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'update:selectedIds',
  'delete-node',
  'add-clip',
  'open-preview',
  'open-generation',
  'create-card',
  'toggle-collapse',
  'rename-node',
  'update-node-parameters',
  'refresh-node',
  'upload-media',
  'update-node-media-from-parent',
  'regenerate-node'
])

const svgContainer = ref(null)

const boxSelectMode = ref(false)
const selecting = ref(false)
const selectionStarted = ref(false)
const selectBox = ref({ left: 0, top: 0, width: 0, height: 0 })
const selectStart = ref({ x: 0, y: 0 })

const BOX_DRAG_THRESHOLD = 6

const layoutConfig = ref({
  horizontalGap: 112,
  verticalGap: 124,
  colors: {
    image: null,
    video: null,
    audio: null
  }
})

const localGroups = ref([])
const renderedNodes = ref([])
const localSelectedIds = ref([...(props.selectedIds || [])])
const nodeSizeOverrides = ref({})

const ignoreBackgroundClearUntil = ref(0)

function markIgnoreBackgroundClear(ms = 250) {
  ignoreBackgroundClearUntil.value = Date.now() + ms
}

const canMerge = computed(() => localSelectedIds.value.length >= 2)

const showToolbar = computed(() => {
  return boxSelectMode.value || localSelectedIds.value.length > 0
})

const toolbarStatusText = computed(() => {
  const count = localSelectedIds.value.length

  if (boxSelectMode.value) {
    return count > 0 ? `${count} source${count > 1 ? 's' : ''}` : 'Select sources'
  }

  if (count > 0) {
    return `${count} selected`
  }

  return ''
})

function sameIds(a = [], b = []) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node))
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)))
}

function isTypingTarget(target) {
  if (!target) return false
  const tag = target.tagName?.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  )
}

function applyLocalSelectedIds(ids = []) {
  const nextIds = [...ids]
  if (sameIds(localSelectedIds.value, nextIds)) return

  localSelectedIds.value = nextIds

  if (svgContainer.value) {
    updateSelectionStyles(svgContainer.value, nextIds)
  }
}

function commitSelectedIds(ids = []) {
  const nextIds = [...ids]

  if (!sameIds(localSelectedIds.value, nextIds)) {
    localSelectedIds.value = nextIds
    if (svgContainer.value) {
      updateSelectionStyles(svgContainer.value, nextIds)
    }
  }

  if (!sameIds(props.selectedIds || [], nextIds)) {
    emit('update:selectedIds', nextIds)
  }
}

function clearSelection() {
  commitSelectedIds([])
  stopBoxSelectMode()
}

function startBoxSelectMode() {
  boxSelectMode.value = true
  resetSelectionBox()
}

function stopBoxSelectMode() {
  boxSelectMode.value = false
  resetSelectionBox()
}

function resetSelectionBox() {
  selecting.value = false
  selectionStarted.value = false
  selectBox.value = { left: 0, top: 0, width: 0, height: 0 }

  document.body.style.userSelect = ''
  document.body.style.webkitUserSelect = ''
}

function getCurrentViewState() {
  if (!svgContainer.value) return null

  const svg = d3.select(svgContainer.value)
  const zoomContainer = svg.select('.zoom-container')
  if (zoomContainer.empty()) return null

  const transform = zoomContainer.attr('transform')
  if (!transform) return null

  const scaleMatch = transform.match(/scale\(([^)]+)\)/)
  const translateMatch = transform.match(/translate\(([^,]+),([^)]+)\)/)

  if (scaleMatch && translateMatch) {
    return {
      k: parseFloat(scaleMatch[1]),
      x: parseFloat(translateMatch[1]),
      y: parseFloat(translateMatch[2])
    }
  }
  return null
}

function mergeNodeAssets(assetsList) {
  const mergedAssets = {
    input: { images: [], videos: [], audio: [] },
    output: { images: [], videos: [], audio: [] }
  }

  assetsList.forEach(assets => {
    if (!assets) return

    if (assets.input) {
      mergedAssets.input.images = [...mergedAssets.input.images, ...(assets.input.images || [])]
      mergedAssets.input.videos = [...mergedAssets.input.videos, ...(assets.input.videos || [])]
      mergedAssets.input.audio = [...mergedAssets.input.audio, ...(assets.input.audio || [])]
    }

    if (assets.output) {
      mergedAssets.output.images = [...mergedAssets.output.images, ...(assets.output.images || [])]
      mergedAssets.output.videos = [...mergedAssets.output.videos, ...(assets.output.videos || [])]
      mergedAssets.output.audio = [...mergedAssets.output.audio, ...(assets.output.audio || [])]
    }
  })

  return mergedAssets
}

function buildCompositeSummary(nodes) {
  const summary = {
    image: 0,
    video: 0,
    audio: 0,
    text: 0
  }

  nodes.forEach(node => {
    const assets = node.assets || {}
    const output = assets.output || {}

    summary.image += (output.images || []).filter(
      p => !String(p).includes('.mp4') && !String(p).includes('subfolder=video')
    ).length

    summary.video +=
      (output.videos || []).length +
      (output.images || []).filter(
        p => String(p).includes('.mp4') || String(p).includes('subfolder=video')
      ).length

    summary.audio += (output.audio || []).length

    const text = node.parameters?.text || node.parameters?.positive_prompt || ''
    if (text && String(text).trim()) summary.text += 1
  })

  return summary
}

function parentSignature(node) {
  return JSON.stringify([...(node.originalParents || [])].sort())
}

function buildCompositeNode(group, groupedNodes, allNodes) {
  const selectedSet = new Set(group.nodeIds)

  const externalParents = uniq(
    groupedNodes.flatMap(n => n.originalParents || []).filter(pid => !selectedSet.has(pid))
  )

  const downstreamIds = uniq(
    allNodes
      .filter(n => !selectedSet.has(n.id))
      .filter(n => (n.originalParents || []).some(pid => selectedSet.has(pid)))
      .map(n => n.id)
  )

  const summary = buildCompositeSummary(groupedNodes)

  return {
    id: group.id,
    originalParents: externalParents.length ? externalParents : null,
    module_id: 'composite',
    created_at: group.created_at,
    status: 'completed',
    media: null,
    parameters: {
      composite_nodes: groupedNodes.map(cloneNode),
      global_context: ''
    },
    isComposite: true,
    isVirtualGroup: true,
    sourceNodeIds: [...group.nodeIds],
    combinedNodes: groupedNodes.map(cloneNode),
    childrenIds: downstreamIds,
    label: `Merged · ${groupedNodes.length}`,
    summary,
    assets: mergeNodeAssets(groupedNodes.map(n => n.assets || {})),
    linkColor: '#8b5cf6',
    _collapsed: false
  }
}

function applyLocalGroups(baseNodes) {
  let nextNodes = (baseNodes || []).map(n => ({ ...n }))

  localGroups.value.forEach(group => {
    const selectedSet = new Set(group.nodeIds)
    const groupedNodes = nextNodes.filter(n => selectedSet.has(n.id))

    if (groupedNodes.length < 2) return

    const compositeNode = buildCompositeNode(group, groupedNodes, nextNodes)
    const firstIndex = Math.max(0, nextNodes.findIndex(n => selectedSet.has(n.id)))

    const rewiredNodes = nextNodes
      .filter(n => !selectedSet.has(n.id))
      .map(n => {
        const parents = n.originalParents || []
        if (!parents.some(pid => selectedSet.has(pid))) return n

        return {
          ...n,
          originalParents: uniq(
            parents.map(pid => (selectedSet.has(pid) ? group.id : pid))
          )
        }
      })

    rewiredNodes.splice(Math.min(firstIndex, rewiredNodes.length), 0, compositeNode)
    nextNodes = rewiredNodes
  })

  return nextNodes
}

function applyNodeSizeOverrides(nodes) {
  return (nodes || []).map(n => {
    const ov = nodeSizeOverrides.value[n.id]
    if (!ov) return n
    return { ...n, calculatedHeight: ov.height ?? n.calculatedHeight, manualHeight: ov.height ?? n.manualHeight }
  })
}

function syncRenderedTree(nextSelectedIds = localSelectedIds.value || []) {
  renderedNodes.value = applyNodeSizeOverrides(applyLocalGroups(props.nodes))

  if (!svgContainer.value) return

  const viewState = getCurrentViewState()

  renderTree(
    svgContainer.value,
    renderedNodes.value,
    nextSelectedIds,
    graphEmit,
    workflowTypes,
    viewState,
    layoutConfig.value
  )
}

function handleKeyDown(e) {
  if (isTypingTarget(e.target)) return

  if (e.key === 'b' || e.key === 'B') {
    e.preventDefault()

    if (boxSelectMode.value) {
      stopBoxSelectMode()
    } else {
      startBoxSelectMode()
    }
    return
  }

  if ((e.key === 'g' || e.key === 'G') && localSelectedIds.value.length >= 2) {
    e.preventDefault()
    mergeSelectedNodes(localSelectedIds.value)
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    clearSelection()
  }
}

function handleKeyUp() {}

function handleSvgMouseDown(e) {
  if (!boxSelectMode.value || e.button !== 0) return

  const target = e.target
  const clickedOnNode = !!(
    target &&
    target.closest &&
    target.closest('.node, foreignObject, .node-card, button, input, textarea, select')
  )

  if (clickedOnNode) return

  e.preventDefault()
  e.stopPropagation()
  if (typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation()
  }

  selectStart.value = { x: e.clientX, y: e.clientY }
  selectBox.value = {
    left: e.clientX,
    top: e.clientY,
    width: 0,
    height: 0
  }

  selecting.value = true
  selectionStarted.value = false

  document.body.style.userSelect = 'none'
  document.body.style.webkitUserSelect = 'none'
}

function handleWindowMouseMove(e) {
  if (!selecting.value) return

  e.preventDefault()
  e.stopPropagation()

  const dx = e.clientX - selectStart.value.x
  const dy = e.clientY - selectStart.value.y

  if (!selectionStarted.value) {
    if (Math.hypot(dx, dy) < BOX_DRAG_THRESHOLD) {
      return
    }
    selectionStarted.value = true
  }

  const x = e.clientX
  const y = e.clientY

  selectBox.value.left = Math.min(x, selectStart.value.x)
  selectBox.value.top = Math.min(y, selectStart.value.y)
  selectBox.value.width = Math.abs(x - selectStart.value.x)
  selectBox.value.height = Math.abs(y - selectStart.value.y)
}

function handleMouseUp(e) {
  if (!selecting.value) return

  if (e) {
    e.preventDefault()
    e.stopPropagation()
  }

  const hadRealDrag = selectionStarted.value
  const selectedNodeIds = hadRealDrag ? getNodesInSelectionBox() : []

  resetSelectionBox()

  if (!hadRealDrag) return

  if (selectedNodeIds.length > 0) {
    markIgnoreBackgroundClear()
    commitSelectedIds(selectedNodeIds)
  } else {
    commitSelectedIds([])
  }

  boxSelectMode.value = false
}

function getNodesInSelectionBox() {
  if (!svgContainer.value) return []

  const box = selectBox.value
  const selectedIds = []
  const svgEl = svgContainer.value

  const nodeElements = d3.select(svgEl).selectAll('.node[data-id]').nodes()

  nodeElements.forEach(el => {
    const rect = el.getBoundingClientRect()

    const isInBox =
      rect.left < box.left + box.width &&
      rect.right > box.left &&
      rect.top < box.top + box.height &&
      rect.bottom > box.top

    if (isInBox) {
      const nodeId = el.getAttribute('data-id')
      if (nodeId) selectedIds.push(nodeId)
    }
  })

  return selectedIds
}

function mergeSelectedNodes(selectedNodeIds) {
  const selectedNodes = renderedNodes.value.filter(node =>
    selectedNodeIds.includes(node.id)
  )

  const validNodeIds = uniq(selectedNodes.map(node => node.id))
  if (validNodeIds.length < 2) return

  const groupId = `composite_${Date.now()}_${Math.floor(Math.random() * 1000)}`

  localGroups.value.push({
    id: groupId,
    nodeIds: validNodeIds,
    created_at: new Date().toISOString()
  })

  stopBoxSelectMode()
  commitSelectedIds([groupId])
  syncRenderedTree([groupId])
}

function ungroupNodes(compositeNodeId) {
  const targetGroup = localGroups.value.find(g => g.id === compositeNodeId)
  if (!targetGroup) return

  const restoredIds = [...targetGroup.nodeIds]
  localGroups.value = localGroups.value.filter(g => g.id !== compositeNodeId)

  commitSelectedIds(restoredIds)
  syncRenderedTree(restoredIds)
}

const graphEmit = (event, ...args) => {
  if (event === 'ungroup-node') {
    ungroupNodes(...args)
    return
  }

  if (event === 'update:selectedIds') {
    const nextIds = Array.isArray(args[0]) ? args[0] : []

    if (
      nextIds.length === 0 &&
      Date.now() < ignoreBackgroundClearUntil.value
    ) {
      ignoreBackgroundClearUntil.value = 0
      return
    }

    commitSelectedIds(nextIds)
    return
  }

  if (event === 'resize-node-height') {
    const [nodeId, nextHeight] = args
    if (!nodeId || typeof nextHeight !== 'number') return
    nodeSizeOverrides.value = {
      ...nodeSizeOverrides.value,
      [nodeId]: { height: nextHeight }
    }
    syncRenderedTree(localSelectedIds.value)
    return
  }

  if (event === 'delete-node') {
    const nodeId = args[0]
    const found = renderedNodes.value.find(n => n.id === nodeId)
    if (found?.isComposite) {
      ungroupNodes(nodeId)
      return
    }
  }

  emit(event, ...args)
}

function handleLayoutUpdated(event) {
  const detail = event.detail || {}
  layoutConfig.value = {
    horizontalGap: detail.horizontalGap ?? layoutConfig.value.horizontalGap,
    verticalGap: detail.verticalGap ?? layoutConfig.value.verticalGap,
    colors: {
      image: detail.colors?.image ?? layoutConfig.value.colors.image,
      video: detail.colors?.video ?? layoutConfig.value.colors.video,
      audio: detail.colors?.audio ?? layoutConfig.value.colors.audio
    }
  }

  syncRenderedTree(localSelectedIds.value)
}

onMounted(() => {
  if (!svgContainer.value) return

  window.addEventListener('t2v-layout-updated', handleLayoutUpdated)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)

  const svgEl = svgContainer.value
  svgEl.addEventListener('mousedown', handleSvgMouseDown, true)
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  syncRenderedTree(localSelectedIds.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('t2v-layout-updated', handleLayoutUpdated)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)

  if (svgContainer.value) {
    svgContainer.value.removeEventListener('mousedown', handleSvgMouseDown, true)
  }

  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})

watch(
  () => props.nodes,
  (nodes) => {
    const nodeIdSet = new Set((nodes || []).map(n => n.id))
    localGroups.value = localGroups.value.filter(group =>
      group.nodeIds.every(id => nodeIdSet.has(id))
    )
    syncRenderedTree(localSelectedIds.value)
  },
  { immediate: true }
)

watch(
  () => props.selectedIds,
  (ids) => {
    const nextIds = [...(ids || [])]
    if (sameIds(localSelectedIds.value, nextIds)) return

    localSelectedIds.value = nextIds

    if (!svgContainer.value) return
    updateSelectionStyles(svgContainer.value, nextIds)
  },
  { immediate: true }
)
</script>


<style scoped>
.workflow-tree-shell {
  position: relative;
  min-height: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

.workflow-toolbar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 4px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: none;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(6px);
  flex-wrap: nowrap;
}

.toolbar-status {
  flex: 0 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  border: none;
  color: #4b5563;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 1.2;
}

.toolbar-status.active {
  background: rgba(59, 130, 246, 0.10);
  color: #1d4ed8;
}

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
}

.toolbar-btn {
  border: none;
  background: transparent;
  color: #374151;
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: #f3f4f6;
  color: #111827;
}

.toolbar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.toolbar-btn-primary {
  background: #1f2937;
  color: #ffffff;
}

.toolbar-btn-primary:hover:not(:disabled) {
  background: #111827;
  color: #ffffff;
}

.selection-box {
  position: fixed;
  border: 1px solid rgba(59, 130, 246, 0.65);
  background: rgba(59, 130, 246, 0.10);
  pointer-events: none;
  z-index: 9999;
  border-radius: 6px;
}

svg {
  cursor: default;
}

@media (max-width: 900px) {
  .workflow-toolbar {
    top: 8px;
    max-width: calc(100% - 16px);
    padding: 4px 5px;
    gap: 4px;
  }

  .toolbar-status {
    display: none;
  }

  .toolbar-btn {
    padding: 5px 7px;
    font-size: 10px;
  }
}
</style>
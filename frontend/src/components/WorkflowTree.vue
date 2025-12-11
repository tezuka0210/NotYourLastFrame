<template>
  <div
    id="chart-wrapper"
    class="bg-white rounded shadow p-3 flex-1 min-h-0"
    style="position: relative;"
  >
    <svg ref="svgContainer" class="w-full h-full"></svg>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { workflowTypes } from '@/composables/useWorkflow'
import * as d3 from 'd3'

import {
  renderTree,
  updateVisibility,
  updateSelectionStyles
} from '@/lib/workflowGraph.js'

// ========== Props ==========
const props = defineProps({
  nodes: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] }
})

// ========== Emits ==========
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

// 传给 lib 的 emit 适配器
const graphEmit = (event, ...args) => {
  emit(event, ...args)
}

// ========== Refs ==========
const svgContainer = ref(null)

// 当前布局配置（默认值与 dagre 一致）
const layoutConfig = ref({
  horizontalGap: 100,
  verticalGap: 120,
  colors: {
    image: null,
    video: null,
    audio: null
  }
})

// 从当前 SVG 中提取 zoom/平移状态（你之前的逻辑略微整理成一个函数）
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

// ========== 布局更新事件监听 ==========

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

  if (!svgContainer.value) return

  const viewState = getCurrentViewState()

  renderTree(
    svgContainer.value,
    props.nodes,
    props.selectedIds,
    graphEmit,
    workflowTypes,
    viewState,
    layoutConfig.value
  )
}

// ========== 生命周期 ==========
onMounted(() => {
  if (!svgContainer.value) return

  window.addEventListener('t2v-layout-updated', handleLayoutUpdated)

  // 初次渲染，带上默认 layoutConfig
  renderTree(
    svgContainer.value,
    props.nodes,
    props.selectedIds,
    graphEmit,
    workflowTypes,
    null,
    layoutConfig.value
  )
})

onBeforeUnmount(() => {
  window.removeEventListener('t2v-layout-updated', handleLayoutUpdated)
})

// ========== Watchers ==========

// 1) 监听节点变化：结构变化 -> 重绘；仅状态变化 -> 只更新可见性
function isAssetsEqual(newAssets, oldAssets) {
  if (!newAssets && !oldAssets) return true
  if (!newAssets || !oldAssets) return false

  const inputEqual = isMediaGroupEqual(newAssets.input, oldAssets.input)
  const outputEqual = isMediaGroupEqual(newAssets.output, oldAssets.output)

  return inputEqual && outputEqual
}

function isMediaGroupEqual(newGroup, oldGroup) {
  if (!newGroup && !oldGroup) return true
  if (!newGroup || !oldGroup) return false

  const imagesEqual = arraysEqual(newGroup.images || [], oldGroup.images || [])
  const videosEqual = arraysEqual(newGroup.videos || [], oldGroup.videos || [])
  const audioEqual = arraysEqual(newGroup.audio || [], oldGroup.audio || [])

  return imagesEqual && videosEqual && audioEqual
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

watch(
  () => props.nodes,
  (newNodes, oldNodes) => {
    if (!svgContainer.value) return

    let structureChanged = false

    if (!oldNodes || newNodes.length !== oldNodes.length) {
      structureChanged = true
    } else {
      const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]))
      for (const newNode of newNodes) {
        if (!oldNodeMap.has(newNode.id)) {
          structureChanged = true
          break
        }
      }
      if (!structureChanged) {
        for (const newNode of newNodes) {
          const oldNode = oldNodeMap.get(newNode.id)
          if (!oldNode) {
            structureChanged = true
            break
          }
          if (newNode.module_id !== oldNode.module_id) {
            structureChanged = true
            break
          }
          if (!isAssetsEqual(newNode.assets, oldNode.assets)) {
            structureChanged = true
            break
          }
        }
      }
    }

    if (structureChanged) {
      const viewState = getCurrentViewState()
      renderTree(
        svgContainer.value,
        newNodes,
        props.selectedIds,
        graphEmit,
        workflowTypes,
        viewState,
        layoutConfig.value
      )
    } else {
      updateVisibility(svgContainer.value, newNodes)
    }
  },
  { deep: true }
)

// 2) 监听选中变化：只更新选中样式
watch(
  () => props.selectedIds,
  (ids) => {
    if (svgContainer.value) {
      updateSelectionStyles(svgContainer.value, ids)
    }
  },
  { deep: true }
)
</script>

<template>
  <div id="chart-wrapper" class="bg-white rounded shadow p-3 flex-1 min-h-0" style="position: relative;">
    <svg ref="svgContainer" class="w-full h-full"></svg>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { workflowTypes } from '@/composables/useWorkflow'

// 从 JS 版工具库导入
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
  'toggle-collapse'
])

// 传给 lib 的 emit 适配器
const graphEmit = (event, ...args) => {
  emit(event, ...args)
}

// ========== Refs ==========
const svgContainer = ref(null)

// ========== 生命周期 ==========
onMounted(() => {
  if (!svgContainer.value) return
  renderTree(
    svgContainer.value,
    props.nodes,
    props.selectedIds,
    graphEmit,
    workflowTypes
  )
})

// ========== Watchers ==========

// 监听节点变化：结构变化 -> 重绘；仅状态变化 -> 只更新可见性
watch(
  () => props.nodes,
  (newNodes, oldNodes) => {
    if (!svgContainer.value) return

    let structureChanged = false
    if (!oldNodes || newNodes.length !== oldNodes.length) {
      structureChanged = true
    } else {
      const newIds = new Set(newNodes.map(n => n.id))
      for (const n of oldNodes) {
        if (!newIds.has(n.id)) {
          structureChanged = true
          break
        }
      }
    }

    if (structureChanged) {
      renderTree(
        svgContainer.value,
        newNodes,
        props.selectedIds,
        graphEmit,
        workflowTypes
      )
    } else {
      updateVisibility(svgContainer.value, newNodes)
    }
  },
  { deep: true }
)

// 监听选中变化：只更新选中样式
watch(
  () => props.selectedIds,
  (ids) => {
    if (svgContainer.value) updateSelectionStyles(svgContainer.value, ids)
  },
  { deep: true }
)
</script>

import { ref, computed, watch, nextTick } from 'vue'
import VideoEditingTimeline from 'video-editing-timeline'

/* --------------  主逻辑：返回给组件用  -------------- */
export function useStitching(props, emit) {

  /* ----- 1. 响应式状态 (UI) ----- */
  const pixelsPerSecond = ref(40) // 缩放级别 (两个轨道共享)

  // 【修改】拖拽状态现在需要知道轨道信息
  // 将存储: { track: 'video' | 'audio', index: number }
  const draggedClip = ref(null)
  // 将存储: { track: 'video' | 'audio', index: number }
  const draggedOver = ref(null)
  // 将存储: 'video' | 'audio'
  const isDraggingOverContainer = ref(null)

  /* ----- 2. 计算属性 (UI) ----- */

  // 【修改】重命名为 videoClipWidths，并使用 props.clips
  const videoClipWidths = computed(() =>
    props.clips.map(c =>
      `${Math.max(50, c.duration * pixelsPerSecond.value)}px`
    )
  )

  // 【新增】为音轨计算宽度，使用 props.audioClips
  const audioClipWidths = computed(() =>
    props.audioClips.map(c =>
      `${Math.max(30, c.duration * pixelsPerSecond.value)}px`
    )
  )

  /* ----- 3. 时间尺 (不变) ----- */
  function drawTimeline(pxPerSec) {
    nextTick(() => {
      const canvas = document.getElementById('timeline-ruler')
      if (!canvas) return
      const Constructor = VideoEditingTimeline.default || VideoEditingTimeline

      let newScaleTime = 1
      let newScalePx   = pxPerSec
      if (pxPerSec > 100) { newScaleTime = 0.5; newScalePx = pxPerSec * 0.5 }
      if (pxPerSec < 10)  { newScaleTime = 5;   newScalePx = pxPerSec * 5 }

      new Constructor({
        el: '#timeline-ruler',
        canvasWidth: canvas.clientWidth,
        canvasHeight: 30,
        minimumScale: newScalePx,
        minimumScaleTime: newScaleTime
      })
    })
  }

  /* ----- 4. 缩放 (不变) ----- */
  function handleZoom(e) {
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    pixelsPerSecond.value =
      Math.max(10, Math.min(800, pixelsPerSecond.value * factor))
  }

  /* ----- 5. 拖拽核心 (已重构) ----- */

  /** 拖拽开始 (需要知道来自哪个轨道) */
  function handleDragStart(trackType, index, e) {
    draggedClip.value = { track: trackType, index: index }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  /** 悬停在另一个剪辑上 (需要知道目标轨道) */
  function handleDragOverItem(trackType, index) {
    draggedOver.value = { track: trackType, index: index }
    isDraggingOverContainer.value = null
  }

  function handleDragLeaveItem() {
    draggedOver.value = null
  }

  /** 在另一个剪辑上松手 (需要知道目标轨道) */
  function handleDropOnItem(targetTrack, targetIndex) {
    const src = draggedClip.value
    // 检查：必须有拖拽源，且源轨道必须与目标轨道相同
    if (!src || src.track !== targetTrack) {
      console.warn('跨轨道拖放无效。');
      return
    }
    if (src.index === targetIndex) return // 拖到自己身上

    // 根据轨道类型选择正确的数组和 emit 事件
    const list = (src.track === 'video') ? [...props.clips] : [...props.audioClips]
    const emitEvent = (src.track === 'video') ? 'update:clips' : 'update:audioClips'

    // 执行数组操作
    const [moved] = list.splice(src.index, 1)
    if (moved) list.splice(targetIndex, 0, moved)

    // 【修改】发出正确的事件
    emit(emitEvent, list)

    draggedOver.value = null
  }

  /** 拖拽结束 (重置一切) */
  function handleDragEnd() {
    draggedClip.value = null;
    draggedOver.value = null;
    isDraggingOverContainer.value = null
  }

  /* ----- 6. 拖进空白处 (已重构) ----- */

  /** 悬停在空白容器上 (需要知道目标轨道) */
  function handleDragOverContainer(trackType) {
    if (draggedOver.value === null) {
      isDraggingOverContainer.value = trackType
    }
  }

  function handleDragLeaveContainer() {
    isDraggingOverContainer.value = null
  }

  /** 在空白容器上松手 (需要知道目标轨道) */
  function handleDropContainer(targetTrack) {
    const src = draggedClip.value
    if (!src || src.track !== targetTrack || isDraggingOverContainer.value !== targetTrack) {
        console.warn('容器拖放无效。');
        return
    }

    const list = (src.track === 'video') ? [...props.clips] : [...props.audioClips]
    const emitEvent = (src.track === 'video') ? 'update:clips' : 'update:audioClips'

    // 执行数组操作 (移动到末尾)
    const [moved] = list.splice(src.index, 1)
    if (moved) list.push(moved)

    // 【修改】发出正确的事件
    emit(emitEvent, list)
  }

  /* ----- 7. 导出 ----- */
  return {
    pixelsPerSecond,
    videoClipWidths, // <-- 重命名
    audioClipWidths, // <-- 新增

    // 拖拽状态 (UI)
    draggedClip,     // <-- 重命名
    draggedOver,     // <-- 重命名
    isDraggingOverContainer,

    // 函数
    drawTimeline,
    handleZoom,
    handleDragStart,
    handleDragOverItem,
    handleDragLeaveItem,
    handleDropOnItem,
    handleDragEnd,
    handleDragOverContainer,
    handleDragLeaveContainer,
    handleDropContainer,
  }
}
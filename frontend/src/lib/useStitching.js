// src/composables/useStitching.js
import { ref, computed, nextTick } from 'vue'

export function useStitching(props, emit) {
  /* ---------------- 1. 基础状态 ---------------- */
  // 所有“秒 -> 像素”都用这个系数
  const pixelsPerSecond = ref(40)

  const draggedClip = ref(null)              // { track: 'video' | 'audio', index }
  const draggedOver = ref(null)              // { track: 'video' | 'audio', index }
  const isDraggingOverContainer = ref(null)  // 'video' | 'audio' | null

  // 时间轴选区
  const isSelecting = ref(false)
  const selectionStartPx = ref(null)
  const selectionEndPx = ref(null)

  /* ---------------- 2. clip 宽度（秒 * pps） ---------------- */

  const videoClipWidths = computed(() =>
    (props.clips || []).map(c =>
      `${Math.max(50, (c.duration || 0) * pixelsPerSecond.value)}px`
    )
  )

  const audioClipWidths = computed(() =>
    (props.audioClips || []).map(c =>
      `${Math.max(30, (c.duration || 0) * pixelsPerSecond.value)}px`
    )
  )

  /* ---------------- 工具函数 ---------------- */

  // 统一：秒显示 1 位小数；>= 60s 用 mm:ss
  function formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0)
    if (s < 60) {
      return s.toFixed(1) + 's'
    }
    const m = Math.floor(s / 60)
    const remain = s - m * 60
    const mm = String(m).padStart(2, '0')
    const ss = remain.toFixed(0).padStart(2, '0')
    return `${mm}:${ss}`
  }

  // 根据当前缩放自动选择“主刻度”步长，保证刻度既不太密也不太稀
  function pickMajorStep(pps) {
    // 目标：相邻主刻度大概 80 像素左右
    const targetPx = 80
    const candidates = [
      0.1, 0.2, 0.5,
      1, 2, 5,
      10, 20, 30,
      60, 120, 300
    ] // 单位：秒

    let best = candidates[0]
    let bestDiff = Infinity
    for (const step of candidates) {
      const px = step * pps
      const diff = Math.abs(px - targetPx)
      if (diff < bestDiff) {
        bestDiff = diff
        best = step
      }
    }
    return best
  }

  /* ---------------- 3. 时间轴绘制（视窗内刻度） ---------------- */
  function drawTimeline() {
    nextTick(() => {
      const container = document.getElementById('timeline-ruler')
      if (!container) return

      const wrapper = container.parentElement
      const wrapperWidth = wrapper?.getBoundingClientRect().width || 300
      const scrollLeft = wrapper?.scrollLeft || 0

      const clips = props.clips || []
      const audio = props.audioClips || []

      // 真实总时长
      const totalVideo = clips.reduce((s, c) => s + (c.duration || 0), 0)
      const totalAudio = audio.reduce((s, c) => s + (c.duration || 0), 0)
      const totalDuration = Math.max(totalVideo, totalAudio, 0)

      // 即使没有 clip，也给一个“虚拟可视时长”，防止太短
      const minVisibleDuration = wrapperWidth / pixelsPerSecond.value || 5
      const effectiveDuration = Math.max(totalDuration, minVisibleDuration)

      // 时间轴总宽度 = max(父容器宽度, 总时长 * pps)
      const timelineWidth = Math.max(
        wrapperWidth,
        effectiveDuration * pixelsPerSecond.value
      )
      const height = 30

      // 清空 & 基础样式
      container.innerHTML = ''
      container.style.width = timelineWidth + 'px'
      container.style.height = height + 'px'
      container.style.position = 'relative'
      container.style.background = '#fafafa'
      // 关键：允许 0.0s 文字向左“溢出”而不被裁掉
      container.style.overflow = 'visible'

      // 让视频轨/音频轨跟时间轴宽度一致
      const videoPanel = document.getElementById('stitching-panel')
      const audioPanel = document.getElementById('audio-stitching-panel')
      const bufferStrip = document.getElementById('buffer-strip')

      if (videoPanel) videoPanel.style.width = timelineWidth + 'px'
      if (audioPanel) audioPanel.style.width = timelineWidth + 'px'
      if (bufferStrip) bufferStrip.style.width = timelineWidth + 'px'

      // 当前视窗对应的时间范围（只画这部分）
      const visibleStartPx = scrollLeft
      const visibleEndPx = scrollLeft + wrapperWidth
      const visibleStartTime = visibleStartPx / pixelsPerSecond.value
      const visibleEndTime = visibleEndPx / pixelsPerSecond.value

      // 稍微往两边扩一点，避免边缘突兀
      const padTime = (visibleEndTime - visibleStartTime) * 0.1
      const tStart = Math.max(0, visibleStartTime - padTime)
      const tEnd = Math.min(effectiveDuration, visibleEndTime + padTime)

      // 动态选择主刻度 / 次刻度
      const majorStep = pickMajorStep(pixelsPerSecond.value) // 主刻度间隔
      const minorCount = 4                                   // 主刻度之间插 4 个次刻度
      const minorStep = majorStep / (minorCount + 1)

      // 是否绘制 0.02s 的“次次刻度”：
      // 1) 主刻度不大于 1s（已经比较细了）
      // 2) 0.02s 至少有 4px 宽度，避免太密
      const subMinorStep = 0.02
      const shouldDrawSubMinor =
        majorStep <= 1 && (pixelsPerSecond.value * subMinorStep >= 4)

      const EPS = 1e-6

      // baseline
      const baseline = document.createElement('div')
      baseline.style.position = 'absolute'
      baseline.style.left = '0'
      baseline.style.right = '0'
      baseline.style.bottom = '0'
      baseline.style.height = '1px'
      baseline.style.background = '#e5e7eb'
      container.appendChild(baseline)

      // 计算第一个主刻度时间点（向下取整到 majorStep 的倍数）
      let firstMajor = Math.floor(tStart / majorStep) * majorStep
      if (firstMajor < 0) firstMajor = 0

      // -------- 3.1 主刻度 + 次刻度 --------
      for (let T = firstMajor; T <= tEnd + EPS; T += majorStep) {
        const x = T * pixelsPerSecond.value

        const majorTick = document.createElement('div')
        majorTick.style.position = 'absolute'
        majorTick.style.bottom = '0'
        majorTick.style.left = `${x}px`

        const line = document.createElement('div')
        line.style.width = '1px'
        line.style.height = '10px'
        line.style.background = '#9ca3af'
        majorTick.appendChild(line)

        const label = document.createElement('div')
        label.textContent = formatTime(T)
        label.style.position = 'absolute'
        label.style.bottom = '10px'
        label.style.left = '50%'
        label.style.transform = 'translateX(-50%)'
        label.style.fontSize = '10px'
        label.style.color = '#4b5563'
        label.style.whiteSpace = 'nowrap'
        majorTick.appendChild(label)

        container.appendChild(majorTick)

        // 次刻度：在 (T, T+majorStep) 之间插 minorCount 个
        for (let i = 1; i <= minorCount; i++) {
          const tm = T + i * minorStep
          if (tm > tEnd + EPS) break
          if (tm < tStart - EPS) continue

          const xm = tm * pixelsPerSecond.value

          const minorTick = document.createElement('div')
          minorTick.style.position = 'absolute'
          minorTick.style.left = `${xm}px`
          minorTick.style.bottom = '0'

          const mLine = document.createElement('div')
          mLine.style.width = '1px'
          mLine.style.height = '6px'
          mLine.style.background = '#d1d5db'
          minorTick.appendChild(mLine)

          container.appendChild(minorTick)
        }
      }

      // -------- 3.2 次次刻度：固定 0.02s 间隔 --------
      if (shouldDrawSubMinor) {
        // 找到第一个 >= tStart 的 0.02 倍数
        let firstSub =
          Math.ceil(tStart / subMinorStep) * subMinorStep

        for (let ts = firstSub; ts <= tEnd + EPS; ts += subMinorStep) {
          const x = ts * pixelsPerSecond.value

          // 跳过已存在的主刻度 / 次刻度位置，避免重叠
          const isMajor =
            Math.abs(ts / majorStep - Math.round(ts / majorStep)) < 1e-3
          const isMinor =
            Math.abs(ts / minorStep - Math.round(ts / minorStep)) < 1e-3
          if (isMajor || isMinor) continue

          const subTick = document.createElement('div')
          subTick.style.position = 'absolute'
          subTick.style.left = `${x}px`
          subTick.style.bottom = '0'

          const sLine = document.createElement('div')
          sLine.style.width = '1px'
          sLine.style.height = '3px'
          sLine.style.background = '#e5e7eb'
          subTick.appendChild(sLine)

          container.appendChild(subTick)
        }
      }

      // -------- 3.3 选区渲染（保持原逻辑） --------
      if (
        selectionStartPx.value !== null &&
        selectionEndPx.value !== null &&
        selectionStartPx.value !== selectionEndPx.value
      ) {
        const x1 = Math.max(
          0,
          Math.min(selectionStartPx.value, selectionEndPx.value)
        )
        const x2 = Math.min(
          timelineWidth,
          Math.max(selectionStartPx.value, selectionEndPx.value)
        )
        const sel = document.createElement('div')
        sel.style.position = 'absolute'
        sel.style.left = `${x1}px`
        sel.style.width = `${x2 - x1}px`
        sel.style.top = '0'
        sel.style.bottom = '0'
        sel.style.background = 'rgba(59,130,246,0.15)'
        sel.style.border = '1px solid rgba(37,99,235,0.8)'
        sel.style.pointerEvents = 'none'
        container.appendChild(sel)
      }
    })
  }

  // wrapper 滚动时，只重画当前视窗的刻度（性能优化）
  function handleTimelineScroll() {
    drawTimeline()
  }

  /* ---------------- 4. 缩放：滚轮只改 pixelsPerSecond ---------------- */
  function handleZoom(e) {
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    pixelsPerSecond.value = Math.max(
      5,
      Math.min(800, pixelsPerSecond.value * factor)
    )
    // 重绘由外面的 watch(pixelsPerSecond) 触发
  }

  /* ---------------- 5. 时间轴选区拖动 ---------------- */

  function handleTimelineMouseDown(e) {
    const container = e.currentTarget
    if (!container) return
    isSelecting.value = true
    const x = e.offsetX
    selectionStartPx.value = x
    selectionEndPx.value = x
    drawTimeline()
  }

  function handleTimelineMouseMove(e) {
    if (!isSelecting.value) return
    const container = e.currentTarget
    if (!container) return
    const x = e.offsetX
    selectionEndPx.value = x
    drawTimeline()
  }

  function handleTimelineMouseUp() {
    isSelecting.value = false
    drawTimeline()
  }

  /* ---------------- 6. 拖拽逻辑（支持 buffer / video / audio） ---------------- */
  // 小工具：按轨道类型拿对应的列表和事件名
  function getListAndEventByTrack(trackType) {
    if (trackType === 'video') {
      return {
        raw: props.clips || [],
        list: [...(props.clips || [])],
        event: 'update:clips',
      }
    }
    if (trackType === 'audio') {
      return {
        raw: props.audioClips || [],
        list: [...(props.audioClips || [])],
        event: 'update:audioClips',
      }
    }
    if (trackType === 'buffer') {
      return {
        raw: props.bufferClips || [],
        list: [...(props.bufferClips || [])],
        event: 'update:bufferClips',
      }
    }
    return null
  }

  // trackType: 'buffer' | 'video' | 'audio'
  function handleDragStart(trackType, index, e) {
    draggedClip.value = { track: trackType, index }
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
    }
  }

  function handleDragOverItem(trackType, index) {
    draggedOver.value = { track: trackType, index }
    isDraggingOverContainer.value = null
  }

  function handleDragLeaveItem() {
    draggedOver.value = null
  }

  /**
   * 在某个 item 上松手：
   * - 同轨道：重排（video / audio / buffer 内部重排）
   * - buffer → video/audio：从 buffer 移除，插入到对应轨道的指定位置
   */
  function handleDropOnItem(targetTrack, targetIndex) {
    const src = draggedClip.value
    if (!src) return

    // ① 同轨道重排
    if (src.track === targetTrack) {
      const info = getListAndEventByTrack(targetTrack)
      if (!info) return

      const list = info.list
      if (src.index === targetIndex) {
        draggedOver.value = null
        return
      }

      const [moved] = list.splice(src.index, 1)
      if (!moved) return
      list.splice(targetIndex, 0, moved)

      emit(info.event, list)
      draggedOver.value = null
      return
    }

    // ② buffer → video/audio：从 buffer “运”到轨道
    if (src.track === 'buffer' && (targetTrack === 'video' || targetTrack === 'audio')) {
      const bufferInfo = getListAndEventByTrack('buffer')
      const targetInfo = getListAndEventByTrack(targetTrack)
      if (!bufferInfo || !targetInfo) return

      const bufferList = bufferInfo.list
      const targetList = targetInfo.list

      const [moved] = bufferList.splice(src.index, 1)
      if (!moved) return

      // 在目标轨道指定 index 插入
      targetList.splice(targetIndex, 0, moved)

      emit('update:bufferClips', bufferList)
      emit(targetInfo.event, targetList)

      draggedOver.value = null
      draggedClip.value = null
      return
    }

    console.warn('暂不支持从', src.track, '拖到', targetTrack)
  }

  function handleDragEnd() {
    draggedClip.value = null
    draggedOver.value = null
    isDraggingOverContainer.value = null
  }

  function handleDragOverContainer(trackType) {
    // buffer 目前没有“整条轨道”级别的 drop，只标记 video / audio 的容器高亮
    if (trackType === 'video' || trackType === 'audio') {
      isDraggingOverContainer.value = trackType
    }
  }

  function handleDragLeaveContainer() {
    isDraggingOverContainer.value = null
  }

  /**
   * 在轨道空白处松手：
   * - 同轨道：移动到轨道末尾
   * - buffer → video/audio：从 buffer 删除，追加到轨道末尾
   */
  function handleDropContainer(targetTrack) {
    const src = draggedClip.value
    if (!src || (targetTrack !== 'video' && targetTrack !== 'audio')) {
      console.warn('容器拖放无效。')
      return
    }

    // ① 同轨道 -> 移动到末尾
    if (src.track === targetTrack) {
      const info = getListAndEventByTrack(targetTrack)
      if (!info) return
      const list = info.list

      const [moved] = list.splice(src.index, 1)
      if (!moved) return
      list.push(moved)

      emit(info.event, list)
      isDraggingOverContainer.value = null
      draggedClip.value = null
      return
    }

    // ② buffer → video/audio：从 buffer 拿出来追加到轨道末尾
    if (src.track === 'buffer') {
      const bufferInfo = getListAndEventByTrack('buffer')
      const targetInfo = getListAndEventByTrack(targetTrack)
      if (!bufferInfo || !targetInfo) return

      const bufferList = bufferInfo.list
      const targetList = targetInfo.list

      const [moved] = bufferList.splice(src.index, 1)
      if (!moved) return

      targetList.push(moved)

      emit('update:bufferClips', bufferList)
      emit(targetInfo.event, targetList)

      isDraggingOverContainer.value = null
      draggedClip.value = null
      return
    }

    console.warn('容器拖放：暂不支持从', src.track, '到', targetTrack)
  }


  /* ---------------- 7. 导出 ---------------- */

  return {
    pixelsPerSecond,
    videoClipWidths,
    audioClipWidths,

    draggedClip,
    draggedOver,
    isDraggingOverContainer,

    // 时间轴相关
    drawTimeline,
    handleTimelineScroll,
    handleTimelineMouseDown,
    handleTimelineMouseMove,
    handleTimelineMouseUp,

    // 缩放 & 拖拽
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

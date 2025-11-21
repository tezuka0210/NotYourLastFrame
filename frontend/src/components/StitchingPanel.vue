<template>
  <div class="bg-white rounded shadow p-4">
    <!-- <h2 class="text-l font-semibold mb-4 text-gray-700">Stitching Sequence</h2> -->

    <div
      id="stitching-panel-wrapper"
      class="bg-gray-100 border border-dashed border-gray-300 min-h-[80px] overflow-x-auto overflow-y-hidden"
      @wheel.prevent="handleZoom"
      @scroll="handleTimelineScroll"
    >

      <!-- ★★ Transport strip: collected snapshots (buffer) -->
      <div id="buffer-strip">
        <div
          v-for="(clip, index) in bufferClips"
          :key="`buffer-${clip.nodeId}-${index}`"
          :class="[
            'buffer-item',
            clip.type === 'image'
              ? 'buffer-item--image'
              : clip.type === 'video'
                ? 'buffer-item--video'
                : 'buffer-item--audio',
            {
              'insert-before': isInsertBefore(index),
              'insert-after': isInsertAfter(index)
            }
          ]"
          draggable="true"
          @dragstart="handleDragStart('buffer', index, $event)"
          @dragover.prevent="onBufferDragOver(index, $event)"
          @dragleave="onBufferDragLeave"
          @drop.prevent.stop="onBufferDrop(index, $event)"
          @dragend="handleDragEnd"
        >
          <!-- 缩略内容，根据类型区分 -->
          <template v-if="clip.type === 'image'">
            <img
              :src="clip.thumbnailUrl"
              draggable="false"
            />
          </template>

          <template v-else-if="clip.type === 'video'">
            <video
              :src="clip.thumbnailUrl"
              autoplay
              loop
              muted
              playsinline
              preload="metadata"
              draggable="false"
            ></video>
          </template>

          <!-- 音频：不再显示图像缩略图，只用色块 + 图标区分 -->
          <template v-else>
            <div class="buffer-audio-icon">♪</div>
          </template>

          <!-- 底部元数据条：用对应三原色填充，文字显示关键属性 -->
          <div class="buffer-meta">
            {{ getBufferMeta(clip) }}
          </div>

          <!-- 右上角关闭按钮：复用全局 remove-btn 样式 -->
          <span
            class="remove-btn buffer-remove-btn"
            @mousedown.stop.prevent
            @click.stop="removeBuffer(index)"
          >
            ×
          </span>
        </div>

        <span
          v-if="bufferClips.length === 0"
          class="buffer-placeholder"
        >
          Click ▶ on any node to collect snapshots here…
        </span>
      </div>

      <!-- Timeline: width is set dynamically by drawTimeline -->
      <div
        id="timeline-ruler"
        @mousedown="handleTimelineMouseDown"
        @mousemove="handleTimelineMouseMove"
        @mouseup="handleTimelineMouseUp"
        @mouseleave="handleTimelineMouseUp"
      ></div>

      <!-- Video track -->
      <div
        id="stitching-panel"
        class="bg-gray-100 rounded min-h-[80px] py-4 px-0"
        :class="{ 'drag-over': isDraggingOverContainer === 'video' }"
        @dragover.prevent="handleDragOverContainer('video')"
        @dragleave="handleDragLeaveContainer"
        @drop="handleDropContainer('video')"
      >
        <div id="clips-container">
          <div
            v-for="(clip, index) in clips"
            :key="`${clip.nodeId}-${pixelsPerSecond}`"
            class="clip-item"
            :class="[
              clip.type === 'image' ? 'clip-item-image' : 'clip-item-video',
              { dragging: draggedClip?.track === 'video' && draggedClip?.index === index }
            ]"
            :style="{ width: videoClipWidths[index] }"
            draggable="true"
            @dragstart="handleDragStart('video', index, $event)"
            @dragover.prevent="handleDragOverItem('video', index)"
            @dragleave="handleDragLeaveItem"
            @drop.prevent.stop="handleDropOnItem('video', index)"
            @dragend="handleDragEnd"
          >
            <!-- 缩略图 -->
            <img
              v-if="clip.type === 'image'"
              :src="clip.thumbnailUrl"
              class="thumb"
              draggable="false"
            />
            <video
              v-else
              :src="clip.thumbnailUrl"
              class="thumb"
              autoplay
              loop
              muted
              playsinline
              preload="metadata"
              draggable="false"
            ></video>

            <!-- 底部信息条：icon + name + duration -->
            <div class="clip-meta">
              <div class="clip-meta-left">
                <span class="clip-name">{{ getClipName(clip) }}</span>
              </div>
              <span class="clip-duration">{{ formatClipDuration(clip.duration) }}</span>
            </div>

            <!-- 删除按钮 -->
            <span class="remove-btn" @click.stop="removeVideo(index)">×</span>

            <!-- 拖拽覆盖提示 -->
            <div
              v-if="draggedOver?.track === 'video' && draggedOver?.index === index"
              class="absolute inset-0 bg-blue-500 opacity-50 border-2 border-blue-700 pointer-events-none"
              style="border-radius: 4px"
            ></div>
          </div>

          <span
            v-if="clips.length === 0"
            id="clips-placeholder"
            class="track-placeholder"
          >
            Drag video / image nodes here…
          </span>
        </div>
      </div>

      <!-- Audio track -->
      <div
        id="audio-stitching-panel"
        class="p-4 rounded min-h-[40px]"
        :class="{ 'drag-over': isDraggingOverContainer === 'audio' }"
        @dragover.prevent="handleDragOverContainer('audio')"
        @dragleave="handleDragLeaveContainer"
        @drop="handleDropContainer('audio')"
      >
        <div id="audio-clips-container">
          <div
            v-for="(clip, index) in audioClips"
            :key="clip.nodeId"
            class="audio-clip-item"
            :class="{ dragging: draggedClip?.track === 'audio' && draggedClip?.index === index }"
            :style="{ width: audioClipWidths[index] }"
            draggable="true"
            @dragstart="handleDragStart('audio', index, $event)"
            @dragover.prevent="handleDragOverItem('audio', index)"
            @dragleave="handleDragLeaveItem"
            @drop.prevent.stop="handleDropOnItem('audio', index)"
            @dragend="handleDragEnd"
          >
            <div class="audio-thumb">
              <span class="audio-clip-name">
                {{ clip.nodeId.substring(0, 8) }}...
              </span>
              <span class="audio-clip-duration">{{ clip.duration.toFixed(1) }}s</span>
            </div>

            <span class="remove-btn" @click.stop="removeAudio(index)">×</span>

            <div
              v-if="draggedOver?.track === 'audio' && draggedOver?.index === index"
              class="absolute inset-0 bg-blue-500 opacity-50 border-2 border-blue-700 pointer-events-none"
              style="border-radius: 4px"
            ></div>
          </div>

          <span
            v-if="audioClips.length === 0"
            id="audio-clips-placeholder"
            class="track-placeholder"
          >
            Drag audio nodes here…
          </span>
        </div>
      </div>
    </div>

    <!-- Stitch button -->
    <button
      id="stitch-button"
      class="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-400"
      :disabled="clips.length === 0 || isStitching"
      @click="stitch"
    >
      {{ isStitching ? 'Stitching…' : 'Stitch Video' }}
    </button>

    <!-- 结果链接去掉，不再展示可见链接
    <div id="stitch-result" class="mt-3 text-center">
      ...
    </div>
    -->
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, nextTick } from 'vue'
import { useStitching } from '@/lib/useStitching.js'
import WaveSurfer from 'wavesurfer.js'

type WaveSurferInstance = ReturnType<typeof WaveSurfer.create>

const props = defineProps({
  clips:           { type: Array,  required: true },
  audioClips:      { type: Array,  required: true },
  bufferClips:     { type: Array, default: () => [] },
  isStitching:     { type: Boolean, default: false },
  stitchResultUrl: { type: [String, null] }
})

const emit = defineEmits([
  'update:clips',
  'update:audioClips',
  'update:bufferClips', 
  'stitch',
  'remove-clip',
  'remove-audio-clip'
])

const {
  pixelsPerSecond,
  videoClipWidths,
  audioClipWidths,
  draggedClip,
  draggedOver,
  isDraggingOverContainer,
  handleZoom,
  handleDragStart,
  handleDragOverItem,
  handleDragLeaveItem,
  handleDropOnItem,
  handleDragEnd,
  handleDragOverContainer,
  handleDragLeaveContainer,
  handleDropContainer,
  drawTimeline,
  handleTimelineScroll,
  handleTimelineMouseDown,
  handleTimelineMouseMove,
  handleTimelineMouseUp
} = useStitching(props, emit)

/* ========= buffer-strip 的插入辅助线状态 ========= */

const bufferInsert = ref<null | { index: number; position: 'before' | 'after' }>(null)

function onBufferDragOver(index: number, e: DragEvent) {
  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  const offsetX = e.clientX - rect.left
  const position: 'before' | 'after' = offsetX < rect.width / 2 ? 'before' : 'after'

  bufferInsert.value = { index, position }
  // 仍然把 hover 状态交给通用逻辑
  handleDragOverItem('buffer', index)
}

function onBufferDragLeave() {
  bufferInsert.value = null
  handleDragLeaveItem()
}

function onBufferDrop(index: number, e: DragEvent) {
  let targetIndex = index
  if (
    bufferInsert.value &&
    bufferInsert.value.index === index &&
    bufferInsert.value.position === 'after'
  ) {
    targetIndex = index + 1
  }
  handleDropOnItem('buffer', targetIndex)
  bufferInsert.value = null
}

const isInsertBefore = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'before'

const isInsertAfter = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'after'

/* ========= buffer 中音频缩略图：WaveSurfer 波形 ========= */

const audioWaveformRefs = ref<HTMLElement[]>([])
const bufferWaveforms = ref<WaveSurferInstance[]>([])

function destroyBufferWaveforms() {
  bufferWaveforms.value.forEach(ws => {
    if (ws) {
      try { ws.destroy() } catch (e) { /* ignore */ }
    }
  })
  bufferWaveforms.value = []
}

/**
 * 当 bufferClips 变化时，为其中的 audio 类型创建/更新波形缩略图
 * 依赖 clip.mediaUrl（建议在 useWorkflow 的 bufferClips 构造时写入）
 */
watch(
  () => props.bufferClips,
  (newClips: any[]) => {
    destroyBufferWaveforms()
    nextTick(() => {
      newClips.forEach((clip, index) => {
        if (clip.type !== 'audio') return
        const el = audioWaveformRefs.value[index]
        if (!el) return

        const audioUrl: string | undefined = clip.mediaUrl || clip.media_url || clip.audioUrl
        if (!audioUrl) {
          // 没有音频 URL，就不画波形，避免报错
          return
        }

        const progressColor =
          getComputedStyle(document.documentElement)
            .getPropertyValue('--media-audio')
            .trim() || '#F4A7A8'

        const ws = WaveSurfer.create({
          container: el,
          waveColor: '#9ca3af',
          progressColor,
          height: 36,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          url: audioUrl
        })

        bufferWaveforms.value[index] = ws
      })
    })
  },
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  destroyBufferWaveforms()
})

/* 初次挂载时绘制一次时间轴 */
onMounted(() => {
  drawTimeline()
})

/* 缩放或 clips/audioClips 改变时重绘时间轴 */
watch(
  () => [pixelsPerSecond.value, props.clips, props.audioClips],
  () => {
    drawTimeline()
  },
  { deep: true }
)

/* 自动触发浏览器下载（当 stitchResultUrl 更新时） */
watch(
  () => props.stitchResultUrl,
  (newUrl) => {
    if (!newUrl) return
    const a = document.createElement('a')
    a.href = newUrl
    a.download = ''
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
)

/* 快捷方法 */
const removeVideo = (index: number) => emit('remove-clip', index)
const removeAudio = (index: number) => emit('remove-audio-clip', index)
const stitch = () => emit('stitch')

/** buffer 删除：用 v-model:bufferClips 更新上层状态 */
const removeBuffer = (index: number) => {
  const next = [...(props.bufferClips as any[])]
  next.splice(index, 1)
  emit('update:bufferClips', next)
}

/* 帮视频块取一个显示名称 */
const getClipName = (clip: any) => {
  return clip.filename || clip.name || clip.nodeId || 'Video'
}

/* 格式化时长为一位小数，例如 3.2s */
const formatClipDuration = (duration: number) => {
  const v = Number(duration) || 0
  return v.toFixed(1) + 's'
}

/**
 * buffer-meta 显示的关键属性
 * - image / video: 优先显示分辨率（width×height 或 resolution）
 * - audio: 显示时长（秒）
 */
const getBufferMeta = (clip: any): string => {
  // 音频：时长是最直观的属性
  if (clip.type === 'audio') {
    if (clip.duration != null) {
      const v = Number(clip.duration) || 0
      return `${v.toFixed(1)} s`
    }
    if (clip.sampleRate) {
      return `${clip.sampleRate} Hz`
    }
    return 'Audio'
  }

  // 图片 / 视频：分辨率优先
  if (clip.width && clip.height) {
    return `${clip.width}×${clip.height}`
  }
  if (clip.resolution) {
    return String(clip.resolution)
  }

  // 没有分辨率信息时，退而求其次用时长（如果有）
  if (clip.duration != null) {
    const v = Number(clip.duration) || 0
    return `${v.toFixed(1)} s`
  }

  // 最后才 fallback 到类型名
  if (clip.type === 'image') return 'Image'
  if (clip.type === 'video') return 'Video'
  return 'Media'
}

</script>

<style scoped>
/* 固定整体容器背景，让四条轨道视觉一致 */
#stitching-panel-wrapper {
  background: #f9fafb;
  border-radius: 8px;
}

/* ===== buffer-strip：固定高度 + 底部分割线，左右不留白 ===== */

#buffer-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 8px;  /* ✅ 上 4px，下 8px，避免粗边框压住灰线 */
  box-sizing: border-box;
  min-height: 64px;
  max-height: 64px;
  border-bottom: 1px solid #e5e7eb;
  overflow-x: auto;
  overflow-y: hidden;
}

/* buffer 卡片：根据类型加三原色边框和淡填充 */
.buffer-item {
  position: relative;
  flex: 0 0 auto;
  width: 80px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  background: #ffffff;
}

.buffer-item--image {
  border: 2px solid var(--media-image);
  background: color-mix(in srgb, var(--media-image) 16%, #ffffff);
}

.buffer-item--video {
  border: 2px solid var(--media-video);
  background: color-mix(in srgb, var(--media-video) 16%, #ffffff);
}

.buffer-item--audio {
  border: 2px solid var(--media-audio);
  background: color-mix(in srgb, var(--media-audio) 16%, #ffffff);
}

/* 去掉 hover 的上下抖动效果 */
.buffer-item:hover {
  transform: none;
  box-shadow: none;
}

.buffer-item img,
.buffer-item video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 音频波形容器：占据中部区域 */
.buffer-waveform {
  width: 100%;
  height: 36px;
}

/* 空 buffer 的占位文字 */
.buffer-placeholder {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  white-space: nowrap;
}

/* 轨道占位文字，和 buffer 一致的风格 */
.track-placeholder {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  white-space: nowrap;
}

/* ===== buffer 内插入辅助线：竖线提示 before/after ===== */

.buffer-item.insert-before::before,
.buffer-item.insert-after::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: #60a5fa;  /* 蓝色提示线 */
}

.buffer-item.insert-before::before {
  left: -2px;
}

.buffer-item.insert-after::after {
  right: -2px;
}

/* buffer-meta：底部圆角条，用对应类型三原色填充 */

.buffer-meta {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  height: 16px;
  border-radius: 999px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #ffffff;
  pointer-events: none;
  white-space: nowrap;
  z-index: 0;          /* ✅ 保证在关闭按钮下面 */
}

.buffer-item--image .buffer-meta {
  background: var(--media-image);
}

.buffer-item--video .buffer-meta {
  background: var(--media-video);
}

.buffer-item--audio .buffer-meta {
  background: var(--media-audio);
}

/* ===== 轨道分隔线：时间轴下是 video，上 video 下是 audio ===== */

#timeline-ruler {
  border-top: none; /* 由 buffer-strip 的 border-bottom 做上一条线 */
}

/* video 轨道上边缘线（和灰色一致） */
#stitching-panel {
  border-top: 1px solid #e5e7eb;
}

/* audio 轨道上边缘线（固定灰色） */
#audio-stitching-panel {
  border-top: 1px solid #e5e7eb;
}

/* Audio clip 在轨道中的样式（你原来已有，可以保留/微调） */
.audio-clip-item {
  position: relative;
  border-radius: 6px;
  border: 1px solid var(--media-audio-bg, #F4A7A8);
  background: color-mix(in srgb, var(--media-audio-bg, #F4A7A8) 16%, #ffffff);
}
</style>

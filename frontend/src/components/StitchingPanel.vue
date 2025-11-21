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
          class="buffer-item"
          :class="{
            'insert-before': isInsertBefore(index),
            'insert-after': isInsertAfter(index)
          }"
          draggable="true"
          @dragstart="handleDragStart('buffer', index, $event)"
          @dragover.prevent="onBufferDragOver(index, $event)"
          @dragleave="onBufferDragLeave"
          @drop.prevent.stop="onBufferDrop(index, $event)"
          @dragend="handleDragEnd"
        >
          <img
            v-if="clip.type === 'image'"
            :src="clip.thumbnailUrl"
            draggable="false"
          />
          <video
            v-else
            :src="clip.thumbnailUrl"
            autoplay
            loop
            muted
            playsinline
            preload="metadata"
            draggable="false"
          ></video>
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

            <div
              v-if="draggedOver?.track === 'video' && draggedOver?.index === index"
              class="absolute inset-0 bg-blue-500 opacity-50 border-2 border-blue-700 pointer-events-none"
              style="border-radius: 4px"
            ></div>
          </div>

          <span
            v-if="clips.length === 0"
            id="clips-placeholder"
            class="text-gray-500 italic"
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
            class="text-gray-500 italic"
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
import { onMounted, watch, ref } from 'vue'
import { useStitching } from '@/lib/useStitching.js'

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
  if (bufferInsert.value && bufferInsert.value.index === index && bufferInsert.value.position === 'after') {
    targetIndex = index + 1
  }
  handleDropOnItem('buffer', targetIndex)
  bufferInsert.value = null
}

const isInsertBefore = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'before'

const isInsertAfter = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'after'


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
const removeVideo = index => emit('remove-clip', index)
const removeAudio = index => emit('remove-audio-clip', index)
const stitch = () => emit('stitch')

/* 帮视频块取一个显示名称 */
const getClipName = (clip) => {
  return clip.filename || clip.name || clip.nodeId || 'Video'
}

/* 格式化时长为一位小数，例如 3.2s */
const formatClipDuration = (duration) => {
  const v = Number(duration) || 0
  return v.toFixed(1) + 's'
}
</script>

<style scoped>
/* 固定整体容器背景，让四条轨道视觉一致 */
#stitching-panel-wrapper {
  background: #f9fafb;
  border-radius: 8px;
}

/* ===== buffer-strip：固定高度 + 底部分割线 ===== */

#buffer-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  box-sizing: border-box;
  min-height: 64px;
  max-height: 64px;       /* 避免随着内容微抖 */
  border-bottom: 1px solid #e5e7eb;  /* ✅ buffer 与时间轴的灰色分隔线 */
  overflow-x: auto;
  overflow-y: hidden;
}

.buffer-item {
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  cursor: grab;
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

/* 空 buffer 的占位文字 */
.buffer-placeholder {
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

/* 如果你之前给 audio-clip-item 加了背景色，在这里可以继续用媒体色变量 */
.audio-clip-item {
  position: relative;
  border-radius: 6px;
  border: 1px solid var(--media-audio-bg, #F4A7A8);
  background: color-mix(in srgb, var(--media-audio-bg, #F4A7A8) 16%, #ffffff);
}
</style>



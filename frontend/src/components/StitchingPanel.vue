<template>
  <div class="bg-white rounded shadow p-4">
    <!-- <h2 class="text-l font-semibold mb-4 text-gray-700">Stitching Sequence</h2> -->

    <div
      id="stitching-panel-wrapper"
      class="bg-gray-100 border border-dashed border-gray-300 min-h-[80px] overflow-x-auto overflow-y-hidden"
      @wheel.prevent="handleZoom"
      @scroll="handleTimelineScroll"
    >
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

<script setup>
import { onMounted, watch } from 'vue'
import { useStitching } from '@/lib/useStitching.js'

const props = defineProps({
  clips:           { type: Array,  required: true },
  audioClips:      { type: Array,  required: true },
  isStitching:     { type: Boolean, default: false },
  stitchResultUrl: { type: [String, null] }
})

const emit = defineEmits([
  'update:clips',
  'update:audioClips',
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


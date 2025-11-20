<template>
  <div
    class="overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    @click.self="handleClose"
  >
    <div
      class="modal relative bg-white rounded-xl border border-gray-200 shadow-2xl max-w-[90%] max-h-[90%] p-2 md:p-3 overflow-auto"
    >
      <!-- Close button: same style logic as clip remove button -->
      <button
        @click="handleClose"
        class="modal-close-btn"
        aria-label="Close preview"
      >
        ×
      </button>

      <img
        v-if="props.type === 'image'"
        :src="props.url"
        alt="Preview image"
        class="block max-w-full max-h-[80vh] mx-auto rounded-md"
      />

      <video
        v-else
        :src="props.url"
        controls
        autoplay
        loop
        class="block max-w-full max-h-[80vh] mx-auto rounded-md"
      >
        Your browser does not support this video.
      </video>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  url: string
  type: 'image' | 'video' | 'audio'
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function handleClose() {
  emit('close')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    handleClose()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>


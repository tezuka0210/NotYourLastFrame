<template>
  <aside class="mask-pane-shell">
    <!-- Top Toolbar -->
    <div class="toolbar-shell">
      <div class="toolbar-bar">
        <!-- Left tools -->
        <div class="toolbar-group">
          <button
            id="tool-select-btn"
            class="toolbar-btn is-active"
            title="Select"
            aria-label="Select"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M6 4l10 10-4 1 2 5-2 1-2-5-3 3V4z" />
            </svg>
          </button>

          <button
            id="tool-region-btn"
            class="toolbar-btn"
            title="Region"
            aria-label="Region"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="5" y="5" width="14" height="14" rx="2" />
              <path d="M9 9h6v6H9z" />
            </svg>
          </button>

          <button
            id="tool-paint-btn"
            class="toolbar-btn"
            title="Paint Mask"
            aria-label="Paint Mask"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 20c2.5 0 4-1 5-2l8.5-8.5a2.2 2.2 0 0 0-3.1-3.1L5.9 14.9C5 15.8 4 17.5 4 20z" />
              <path d="M13 6l5 5" />
            </svg>
          </button>

          <button
            id="tool-label-btn"
            class="toolbar-btn"
            title="Edit Label"
            aria-label="Edit Label"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 19.5V15l10-10 4.5 4.5-10 10H4z" />
              <path d="M13 6l4.5 4.5" />
            </svg>
          </button>

          <button
            id="tool-layer-btn"
            class="toolbar-btn"
            title="Layer Menu"
            aria-label="Layer Menu"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 5l7 4-7 4-7-4 7-4z" />
              <path d="M5 13l7 4 7-4" />
            </svg>
          </button>
        </div>

        <!-- Right actions -->
        <div class="toolbar-group">
          <button
            id="collect-buffer-btn"
            class="toolbar-btn"
            title="Add to Buffer"
            aria-label="Add to Buffer"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 7h16" />
              <path d="M6 11h8" />
              <path d="M6 15h8" />
              <path d="M17 10v6" />
              <path d="M14 13h6" />
            </svg>
          </button>

          <button
            id="export-mask-btn"
            class="toolbar-btn"
            title="Export Mask"
            aria-label="Export Mask"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 12c3-5 13-5 16 0-3 5-13 5-16 0z" />
              <circle cx="12" cy="12" r="2.2" />
            </svg>
          </button>

          <button
            id="export-composite-btn"
            class="toolbar-btn"
            title="Export Composite"
            aria-label="Export Composite"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="4" y="5" width="10" height="10" rx="2" />
              <rect x="10" y="9" width="10" height="10" rx="2" />
            </svg>
          </button>

          <span class="toolbar-divider" />

          <button
            id="clear-canvas-btn"
            class="toolbar-btn toolbar-btn--danger"
            title="Clear Canvas"
            aria-label="Clear Canvas"
          >
            <svg viewBox="0 0 24 24" class="toolbar-icon" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 7h16" />
              <path d="M9 7V5h6v2" />
              <path d="M7 7l1 12h8l1-12" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Canvas -->
    <div class="board-shell">
      <div
        id="drawing-board"
        class="drawing-board"
      >
        <div id="drawing-scene" class="drawing-scene"></div>

        <div class="canvas-placeholder absolute inset-0 flex items-center justify-center text-gray-300">
          <svg viewBox="0 0 24 24" class="w-7 h-7 opacity-70" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M8 12h8M12 8v8" />
          </svg>
        </div>
      </div>
    </div>

  </aside>
</template>

<script setup lang="ts">

import { onMounted } from 'vue'
import { initCanvasDrag } from '@/lib/canvasDrag.js'

onMounted(() => {
  initCanvasDrag()
})
</script>

<style scoped>
.mask-pane-shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px;
  box-sizing: border-box;
  background: transparent;
}

/* ===== Toolbar ===== */
.toolbar-shell {
  flex: 0 0 auto;
  padding: 2px 2px 10px;
}

.toolbar-bar {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.05),
    0 8px 20px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
  box-sizing: border-box;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.toolbar-btn {
  width: 30px;
  height: 30px;
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

.toolbar-btn:hover {
  background: #ffffff;
  border-color: #d1d5db;
  color: #374151;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.toolbar-btn:active {
  transform: translateY(0.5px);
}

.toolbar-btn.is-active {
  background: #ffffff;
  border-color: #d9dee7;
  color: #111827;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 1px 3px rgba(15, 23, 42, 0.08);
}

.toolbar-btn--danger:hover {
  background: #fff7f7;
  border-color: #fecaca;
  color: #dc2626;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: #e5e7eb;
  margin: 0 6px;
}

.toolbar-icon {
  width: 15px;
  height: 15px;
  vector-effect: non-scaling-stroke;
}

/* ===== Main board ===== */
.board-shell {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 2px;
  display: flex;
  overflow: hidden;
}

.drawing-board {
  --board-dot-gap: 24px;
  --board-dot-size: 1px;
  --board-dot-alpha: 0.085;

  position: relative;
  flex: 1 1 auto;
  min-height: 300px;
  border-radius: 14px;
  overflow: hidden;
  user-select: none;
  outline: none !important;
  border: 0 !important;
  background-color: #ffffff;
  background-image:
    radial-gradient(
      circle,
      rgba(148, 148, 148, var(--board-dot-alpha)) 0,
      rgba(148, 148, 148, var(--board-dot-alpha)) var(--board-dot-size),
      transparent calc(var(--board-dot-size) + 0.35px)
    );
  background-size: var(--board-dot-gap) var(--board-dot-gap);
  background-position: center center;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 8px 18px rgba(15, 23, 42, 0.05);
}

.drawing-board::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.03);
  border-radius: inherit;
}

.drawing-scene {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: visible;
  transform-origin: 0 0;
  will-change: transform;
}

.drawing-board.is-panning {
  cursor: grabbing;
}

#drawing-board.dragover {
  outline: none !important;
  border: 0 !important;
  background-color: #ffffff !important;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.04),
    0 8px 18px rgba(15, 23, 42, 0.05) !important;
}

#drawing-board img,
#drawing-board canvas {
  outline: none !important;
}

#drawing-board img:hover {
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.18);
}

.canvas-placeholder {
  z-index: 0;
  pointer-events: none;
  user-select: none;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

#drawing-board.has-content .canvas-placeholder {
  opacity: 0;
  visibility: hidden;
}
</style>

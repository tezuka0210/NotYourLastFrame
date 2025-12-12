<template>
  <div class="container">
    <section class="settings-card">
      <header class="settings-header">
        <h2 class="header-title">Global Model Settings</h2>
      </header>

      <div class="settings-content">
        <!-- Model Select -->
        <div class="form-group">
          <label class="form-label">Model</label>
          <select class="form-select">
            <option>GPT-4O</option>
            <option>image-llm-1</option>
            <option>custom-v2</option>
          </select>
        </div>


        <!-- Style Select -->
        <div class="form-group">
          <label class="form-label">Style</label>
          <select class="form-select">
            <option>Realistic & Photography</option>
            <option>Cyber & Sci-Fi</option>
            <option>Anime & Cel-Shaded</option>
            <option>Pixar & 3D Cartoon</option>
            <option>Art History & Painterly</option>
            <option>Dark & Horror</option>
            <option>GuFeng Classic</option>
          </select>
        </div>

        <!-- Mood Select -->
        <div class="form-group">
          <label class="form-label">Mood</label>
          <select class="form-select">
            <option value="joyful">Joyful</option>
            <option value="melancholic">Melancholic</option>
            <option value="epic">Epic</option>
            <option value="eerie">Eerie</option>
            <option value="serene">Serene</option>
          </select>
        </div>

        <!-- Palette Select -->
        <div class="form-group">
          <label class="form-label">Palette</label>
          <select class="form-select">
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="monochrome">Monochrome</option>
            <option value="pastel">Pastel</option>
          </select>
        </div>

        <!-- Reference Materials -->
        <div class="form-group">
          <label class="form-label">Reference Materials</label>
          <textarea
            rows="5"
            class="form-textarea"
            placeholder="Paste your reference text, cultural context, or historical background here..."
          ></textarea>
        </div>
      </div>
      
      <div class="settings-footer">
        <button class="apply-btn">
          Apply Global Settings
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// 温度值双向绑定
const temperature = ref(0.7)
</script>

<style scoped>
/* 全局样式重置 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  border-radius: inherit;
}

/* 统一容器 - 和会话组件保持一致 */
.container {
  width: 100%;
  max-width: 380px;
  margin: 0 auto;
  padding: 2px 8px;
}

/* 设置卡片主体 - 视觉统一 */
.settings-card {
  width: 100%;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  border: 1px solid #f0f0f0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 卡片头部 - 统一内边距 */
.settings-header {
  padding: 10px;
  border-bottom: 1px solid #f0f0f0;
  background: #f8f9fa;
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* 设置内容区域 - 统一内边距 */
.settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

/* 自定义滚动条 - 和会话组件一致 */
.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: #f8f8f8;
  border-radius: 3px;
  margin: 4px 0;
}

.settings-content::-webkit-scrollbar-thumb {
  background: #e0e0e0;
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: #d0d0d0;
}

/* 表单组样式 */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.form-label {
  font-size: 10px;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 下拉选择框样式 */
.form-select {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1px 12px;
  font-size: 14px;
  color: #374151;
  background: #ffffff;
  transition: all 0.2s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M8 11.5l-6-6 1.5-1.5L8 8.5l4.5-4.5L14 5.5l-6 6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px;
}

.form-select:focus {
  outline: none;
  border-color: #6b7280; /* 灰色焦点 */
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.1);
}

.form-select:hover {
  border-color: #d1d5db;
}

/* 温度控制样式 */
.temperature-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.temp-slider {
  flex: 1;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  appearance: none;
  cursor: pointer;
}

.temp-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6b7280; /* 灰色滑块 */
  cursor: pointer;
  transition: all 0.2s ease;
}

.temp-slider::-webkit-slider-thumb:hover {
  background: #4b5563; /* 深灰色 hover */
  transform: scale(1.1);
}

.temp-input {
  width: 40px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px 4px;
  font-size: 14px;
  text-align: center;
  color: #374151;
  transition: all 0.2s ease;
}

.temp-input:focus {
  outline: none;
  border-color: #6b7280; /* 灰色焦点 */
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.1);
}

/* 文本域样式 */
.form-textarea {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  color: #374151;
  background: #f9fafb;
  transition: all 0.2s ease;
  resize: none;
  line-height: 1.5;
  max-height: 140px;   /* ✅ 限制高度 */
  overflow-y: auto;    /* ✅ 内容多时内部滚动 */
}

.form-textarea:focus {
  outline: none;
  border-color: #6b7280; /* 灰色焦点 */
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.1);
  background: #ffffff;
}

.form-textarea:hover {
  border-color: #d1d5db;
}

.form-textarea::placeholder {
  color: #9ca3af;
  font-size: 13px;
}

/* 底部按钮区域 - 统一内边距 */
.settings-footer {
  padding: 16px;
  border-top: 1px solid #f0f0f0;
  background: #f8f9fa;
  border-radius: 0 0 20px 20px;
}

.apply-btn {
  width: 100%;
  padding: 4px 0;
  background: white; /* 灰色按钮 */
  color: #6b7280;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.apply-btn:hover {
  color: #2d3038;
  border: 1px solid #3e4144;
  background: #ffffff; /* 深灰色 hover */
  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.2);
}

.apply-btn:active {
  transform: scale(0.98);
}

.apply-btn:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(225, 234, 252, 0.3);
}
</style>
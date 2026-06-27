<template>
  <div class="recent-page">
    <div class="header">
      <h2>最近播放</h2>
      <p class="subtitle">记录最近播放过的歌曲</p>
    </div>
    <div class="content">
      <div class="empty-state">
        <t-icon name="history" size="48" class="empty-icon" />
        <p>暂无播放历史记录</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
</script>

<style scoped>
.recent-page {
  padding: 24px;
}
.header {
  margin-bottom: 24px;
}
.subtitle {
  color: var(--td-text-color-secondary);
  font-size: 14px;
  margin-top: 4px;
}
.content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--td-text-color-secondary);
}
.empty-icon {
  margin-bottom: 12px;
  opacity: 0.6;
}
</style>

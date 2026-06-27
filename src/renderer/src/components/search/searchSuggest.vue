<template>
  <div class="search-suggest-stub"></div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  'to-search': [val: string]
}>()
</script>

<style scoped>
.search-suggest-stub {
  display: none;
}
</style>

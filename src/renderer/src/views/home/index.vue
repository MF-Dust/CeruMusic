<template>
  <HomeLayout>
    <template #body>
      <router-view />
    </template>
  </HomeLayout>
</template>

<script setup lang="ts">
import HomeLayout from '@renderer/components/layout/HomeLayout.vue'
</script>

<template>
  <component :is="iconComponent" v-if="iconComponent" />
  <span v-else>{{ name }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  MusicIcon,
  PreviousIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  LockOffIcon,
  LockOnIcon,
  CloseIcon
} from 'tdesign-icons-vue-next'

const props = defineProps<{
  name: string
}>()

const iconComponent = computed(() => {
  switch (props.name) {
    case 'Music': return MusicIcon
    case 'SkipPrev': return PreviousIcon
    case 'SkipNext': return NextIcon
    case 'Pause': return PauseIcon
    case 'Play': return PlayIcon
    case 'ListLockOpen': return LockOffIcon
    case 'EyeLock': return LockOnIcon
    case 'WindowClose': return CloseIcon
    default: return null
  }
})
</script>

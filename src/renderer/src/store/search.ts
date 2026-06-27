import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const searchValue = defineStore('search', () => {
  const value = ref('')
  const focus = ref(false)
  const query = ref('')
  const results = ref<any[]>([])

  const getValue = computed(() => value.value)
  const getFocus = computed(() => focus.value)

  const setValue = (val: string) => {
    value.value = val
    query.value = val
  }

  const setFocus = (val: boolean) => {
    focus.value = val
  }

  return {
    value,
    focus,
    query,
    results,
    getValue,
    getFocus,
    setValue,
    setFocus
  }
})
export const useSearchStore = searchValue


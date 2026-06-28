<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSearchStore } from '@renderer/store'

type SuggestGroup = 'songs' | 'artists' | 'albums' | 'playlists'

interface SuggestItem {
  id?: string | number
  name?: string
  source?: string
  [key: string]: any
}

interface HotSearchSource {
  source?: string
  list?: string[]
}

const emit = defineEmits<{
  'to-search': [val: string]
}>()

const props = defineProps<{
  source: string
}>()

const searchStore = useSearchStore()
const manualClosed = ref(false)
const loading = ref(false)
const hotKeywords = ref<string[]>([])
const tipData = ref<Record<SuggestGroup, SuggestItem[]>>({
  songs: [],
  artists: [],
  albums: [],
  playlists: []
})
const order = ref<SuggestGroup[]>([])
const activeIndex = ref(-1)
const requestSeq = ref(0)

const keyword = computed(() => searchStore.getValue.trim())
const hasTipResult = computed(() => order.value.length > 0)
const visible = computed(() => !manualClosed.value && (searchStore.getFocus || !!keyword.value))

const normalizeItems = (items: any[]) =>
  items
    .map((item) => ({
      ...item,
      name: String(item?.name || item?.keyword || item?.title || '').trim()
    }))
    .filter((item) => item.name)

const resetTipData = () => {
  tipData.value = { songs: [], artists: [], albums: [], playlists: [] }
  order.value = []
  activeIndex.value = -1
}

const loadHotSearch = async () => {
  const seq = ++requestSeq.value
  loading.value = true
  try {
    const res = await window.api.music.requestSdk('hotSearch', { source: props.source })
    if (seq !== requestSeq.value) return
    const list = Array.isArray((res as HotSearchSource)?.list) ? (res as HotSearchSource).list : []
    hotKeywords.value = list.map((item) => String(item || '').trim()).filter(Boolean)
  } catch {
    if (seq === requestSeq.value) hotKeywords.value = []
  } finally {
    if (seq === requestSeq.value) loading.value = false
  }
}

const loadTipSearch = async (val: string) => {
  const kw = val.trim()
  if (!kw) {
    resetTipData()
    await loadHotSearch()
    return
  }

  const seq = ++requestSeq.value
  loading.value = true
  try {
    const res = await window.api.music.requestSdk('tipSearch', { source: props.source, keyword: kw })
    if (seq !== requestSeq.value) return
    const nextOrder = Array.isArray((res as any)?.order) ? (res as any).order : []
    const nextData = {
      songs: normalizeItems((res as any)?.songs || []),
      artists: normalizeItems((res as any)?.artists || []),
      albums: normalizeItems((res as any)?.albums || []),
      playlists: normalizeItems((res as any)?.playlists || [])
    }
    tipData.value = nextData
    order.value = nextOrder.filter((item: SuggestGroup) => nextData[item]?.length > 0)
    activeIndex.value = -1
  } catch {
    if (seq === requestSeq.value) resetTipData()
  } finally {
    if (seq === requestSeq.value) loading.value = false
  }
}

watch(
  () => keyword.value,
  async (val) => {
    manualClosed.value = false
    await loadTipSearch(val)
  },
  { immediate: true }
)

watch(
  () => searchStore.getFocus,
  (focused) => {
    if (focused) manualClosed.value = false
  }
)

watch(
  () => props.source,
  async () => {
    manualClosed.value = false
    await loadTipSearch(keyword.value)
  }
)

const handlePick = (val: string) => {
  emit('to-search', val)
}

const showHot = computed(() => !keyword.value)

const flatTipList = computed(() => {
  const list: Array<{ group: SuggestGroup; item: SuggestItem; index: number }> = []
  let offset = 0
  for (const group of order.value) {
    for (const item of tipData.value[group] || []) {
      list.push({ group, item, index: offset })
      offset += 1
    }
  }
  return list
})

const suggestList = computed(() => {
  if (showHot.value) return hotKeywords.value
  return flatTipList.value
})

const onKeydown = (event: KeyboardEvent) => {
  if (!visible.value || !suggestList.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestList.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? suggestList.value.length - 1 : activeIndex.value - 1
  } else if (event.key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    const item = suggestList.value[activeIndex.value]
    handlePick(String((item as any)?.name || item || ''))
  } else if (event.key === 'Escape') {
    manualClosed.value = true
    searchStore.setFocus(false)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-show="visible" class="search-suggest" @mousedown.prevent>
    <div v-if="loading" class="suggest-state">加载中...</div>
    <template v-else>
      <div v-if="showHot" class="suggest-section">
        <div class="section-title">热搜</div>
        <div class="suggest-grid">
          <button
            v-for="(item, index) in hotKeywords"
            :key="item + index"
            class="suggest-chip"
            :class="{ active: activeIndex === index }"
            @click="handlePick(item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div v-else-if="hasTipResult" class="suggest-section">
        <div v-for="group in order" :key="group" class="group-block">
          <div class="section-title">{{ group === 'songs' ? '单曲' : group === 'artists' ? '歌手' : group === 'albums' ? '专辑' : '歌单' }}</div>
          <div class="suggest-list">
            <button
              v-for="entry in flatTipList.filter((entry) => entry.group === group)"
              :key="String(entry.item.id || entry.item.name || entry.index)"
              class="suggest-row"
              :class="{ active: activeIndex === entry.index }"
              @click="handlePick(entry.item.name || '')"
            >
              <span class="row-name">{{ entry.item.name }}</span>
              <span v-if="entry.item.source" class="row-source">{{ entry.item.source }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else class="suggest-state">暂无推荐</div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.search-suggest {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 10000001;
  background: var(--td-bg-color-container, #fff);
  border: 1px solid var(--td-border-level-1-color, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12);
  padding: 8px;
  max-height: 340px;
  overflow: auto;
}

.suggest-state,
.section-title {
  font-size: 12px;
  color: var(--td-text-color-secondary, #666);
}

.suggest-state {
  padding: 10px 8px;
}

.suggest-section + .suggest-section,
.group-block + .group-block {
  margin-top: 10px;
}

.section-title {
  margin: 0 0 8px;
  font-weight: 600;
}

.suggest-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggest-chip,
.suggest-row {
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.suggest-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--td-text-color-primary, #222);
}

.suggest-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--td-text-color-primary, #222);
}

.suggest-chip.active,
.suggest-row.active,
.suggest-chip:hover,
.suggest-row:hover {
  background: rgba(0, 112, 243, 0.1);
}

.row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-source {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--td-text-color-secondary, #666);
}
</style>

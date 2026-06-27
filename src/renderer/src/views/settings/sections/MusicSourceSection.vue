<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { LocalUserDetailStore } from '@renderer/store/LocalUserDetail'

const localUserStore = LocalUserDetailStore()
const refreshing = ref(false)
const refreshError = ref('')

const sourceNames: Record<string, string> = {
  wy: '网易云音乐',
  kg: '酷狗音乐',
  mg: '咪咕音乐',
  tx: 'QQ音乐',
  kw: '酷我音乐',
  git: 'GitCode',
  all: '聚合搜索'
}

const qualityNames: Record<string, string> = {
  any: '自动匹配',
  low: '低品质',
  standard: '标准品质',
  high: '高品质',
  lossless: '无损',
  '128k': '标准 128K',
  '192k': '高品质 192K',
  '320k': '超高品质 320K',
  flac: '无损 FLAC',
  flac24bit: '高解析度无损',
  hires: '高清臻音',
  atmos: '沉浸环绕声',
  master: '超清母带'
}

type SourceEntry = {
  key: string
  name: string
  type: string
  qualities: string[]
}

const getSourceQualities = (source: any): string[] => {
  const raw = source?.qualitys || source?.qualities || source?.quality || []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') return raw.split('|').map((q) => q.trim()).filter(Boolean)
  return []
}

const normalizeSourcesForStore = (sources: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(sources || {}).map(([key, source]) => [
      key,
      {
        ...source,
        name: source?.name || sourceNames[key] || key,
        type: source?.type || 'music',
        qualitys: getSourceQualities(source)
      }
    ])
  )

const sourceEntries = computed<SourceEntry[]>(() => {
  const sources = localUserStore.userInfo.supportedSources || {}
  return Object.entries(sources).map(([key, source]: any) => ({
    key,
    name: source?.name || sourceNames[key] || key,
    type: source?.type || 'music',
    qualities: getSourceQualities(source)
  }))
})

const hasSources = computed(() => sourceEntries.value.length > 0)

const activeSource = computed(() => localUserStore.userInfo.selectSources || '')

const currentSourceName = computed(() => {
  if (activeSource.value === 'all') return sourceNames.all
  return sourceEntries.value.find((item) => item.key === activeSource.value)?.name || '未选择'
})

const currentQuality = computed(() => {
  const source = activeSource.value
  if (!source || source === 'all') return ''
  return (
    (localUserStore.userInfo.sourceQualityMap || {})[source] ||
    localUserStore.userInfo.selectQuality ||
    ''
  )
})

const ensureQualityMap = () => {
  if (!localUserStore.userInfo.sourceQualityMap) localUserStore.userInfo.sourceQualityMap = {}
  return localUserStore.userInfo.sourceQualityMap
}

const applyPluginSources = (plugin: any) => {
  const sources = normalizeSourcesForStore(plugin?.supportedSources || {})
  localUserStore.userInfo.pluginId = plugin.pluginId
  localUserStore.userInfo.pluginName = plugin.pluginInfo?.name || plugin.pluginName || ''
  localUserStore.userInfo.supportedSources = sources

  const sourceKeys = Object.keys(sources)
  if (!sourceKeys.length) return false

  if (
    !localUserStore.userInfo.selectSources ||
    (localUserStore.userInfo.selectSources !== 'all' &&
      !sources[localUserStore.userInfo.selectSources])
  ) {
    localUserStore.userInfo.selectSources = sourceKeys[0]
  }

  const selected = localUserStore.userInfo.selectSources
  if (selected && selected !== 'all') {
    const quality = pickDefaultQuality(selected)
    if (quality) {
      ensureQualityMap()[selected] = quality
      localUserStore.userInfo.selectQuality = quality
    }
  }
  return true
}

const refreshCurrentPluginSources = async (showMessage = false) => {
  const pluginId = localUserStore.userInfo.pluginId
  if (!pluginId || refreshing.value) return
  refreshing.value = true
  refreshError.value = ''
  try {
    const list = await window.api.plugins.loadAllPlugins()
    const plugin = Array.isArray(list) ? list.find((item: any) => item.pluginId === pluginId) : null
    if (!plugin) {
      refreshError.value = '未找到当前插件，请在插件管理中重新选择。'
      return
    }
    const ok = applyPluginSources(plugin)
    if (!ok) {
      refreshError.value = '当前插件初始化成功，但未返回音乐源列表。'
      return
    }
    if (showMessage) MessagePlugin.success('音乐源信息已刷新')
  } catch (err: any) {
    refreshError.value = err?.message || '刷新音乐源信息失败'
  } finally {
    refreshing.value = false
  }
}

const pickDefaultQuality = (sourceKey: string) => {
  const item = sourceEntries.value.find((source) => source.key === sourceKey)
  const qualities = item?.qualities || []
  const saved = localUserStore.userInfo.sourceQualityMap?.[sourceKey]
  if (saved && qualities.includes(saved)) return saved
  return qualities[qualities.length - 1] || ''
}

const selectSource = (sourceKey: string) => {
  if (!hasSources.value) return
  localUserStore.userInfo.selectSources = sourceKey
  if (sourceKey !== 'all') {
    const quality = pickDefaultQuality(sourceKey)
    if (quality) {
      ensureQualityMap()[sourceKey] = quality
      localUserStore.userInfo.selectQuality = quality
    }
  }
  MessagePlugin.success(`已切换到 ${sourceKey === 'all' ? sourceNames.all : currentSourceName.value}`)
}

const setQuality = (sourceKey: string, quality: string) => {
  if (!sourceKey || !quality) return
  ensureQualityMap()[sourceKey] = quality
  if (localUserStore.userInfo.selectSources === sourceKey) {
    localUserStore.userInfo.selectQuality = quality
  }
}

const qualityLabel = (quality: string) => qualityNames[quality] || quality

onMounted(() => {
  if (localUserStore.userInfo.pluginId) {
    void refreshCurrentPluginSources(false)
  }
})
</script>

<template>
  <div class="settings-section">
    <div id="music-source" class="setting-group">
      <h3>音乐源设置</h3>
      <p>查看当前插件提供的音乐源，并配置默认搜索源和各源音质。</p>

      <div v-if="!localUserStore.userInfo.pluginId" class="empty-state">
        <div class="empty-title">未选择音源插件</div>
        <div class="empty-desc">请先在“插件管理”中安装并使用一个音乐源插件。</div>
      </div>

      <template v-else>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">当前插件</span>
            <span class="status-value">{{ localUserStore.userInfo.pluginName || '未命名插件' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">当前音源</span>
            <span class="status-value">{{ currentSourceName }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">当前音质</span>
            <span class="status-value">{{ currentQuality ? qualityLabel(currentQuality) : '按歌曲来源配置' }}</span>
          </div>
        </div>

        <div v-if="!hasSources" class="empty-state">
          <div class="empty-title">插件未提供可用音源</div>
          <div class="empty-desc">
            {{ refreshError || '当前缓存为空，点击刷新会重新读取插件运行时信息。' }}
          </div>
          <t-button
            class="empty-action"
            theme="primary"
            size="small"
            :loading="refreshing"
            @click="refreshCurrentPluginSources(true)"
          >
            刷新音乐源信息
          </t-button>
        </div>

        <div v-else class="setting-item source-picker">
          <div class="item-info">
            <div class="item-title">默认音乐源</div>
            <div class="item-desc">搜索、发现和播放解析默认使用的音源。</div>
          </div>
          <t-radio-group
            class="choice-group"
            :value="activeSource"
            variant="primary-filled"
            @change="(val) => selectSource(String(val))"
          >
            <t-radio-button v-if="sourceEntries.length >= 2" value="all">聚合</t-radio-button>
            <t-radio-button v-for="source in sourceEntries" :key="source.key" :value="source.key">
              {{ source.name }}
            </t-radio-button>
          </t-radio-group>
        </div>
      </template>
    </div>

    <div v-if="hasSources" id="music-source-quality" class="setting-group">
      <h3>音质配置</h3>
      <p>每个音源可单独保存音质偏好，播放对应来源歌曲时自动使用。</p>

      <div v-for="source in sourceEntries" :key="source.key" class="setting-item quality-row">
        <div class="item-info">
          <div class="item-title">{{ source.name }}</div>
          <div class="item-desc">
            {{ source.key }} · {{ source.qualities.length ? `${source.qualities.length} 个音质档位` : '未声明音质档位' }}
          </div>
        </div>
        <t-radio-group
          v-if="source.qualities.length"
          class="choice-group"
          :value="localUserStore.userInfo.sourceQualityMap?.[source.key] || pickDefaultQuality(source.key)"
          variant="primary-filled"
          @change="(val) => setQuality(source.key, String(val))"
        >
          <t-radio-button v-for="quality in source.qualities" :key="quality" :value="quality">
            {{ qualityLabel(quality) }}
          </t-radio-button>
        </t-radio-group>
        <t-tag v-else theme="warning" variant="light">未配置</t-tag>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  animation: fadeInUp 0.4s ease-out;
  animation-fill-mode: both;
}

.setting-group {
  background: var(--settings-group-bg);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--settings-group-border);
  box-shadow: 0 1px 3px var(--settings-group-shadow);

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--settings-text-primary);
  }

  p {
    margin: 0 0 1rem;
    color: var(--settings-text-secondary);
    font-size: 0.875rem;
  }
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--settings-feature-border);
  background: var(--settings-feature-bg);
  border-radius: 0.5rem;
  margin-top: 0.75rem;
}

.item-info {
  min-width: 12rem;
}

.item-title {
  font-weight: 600;
  color: var(--settings-text-primary);
  font-size: 0.95rem;
}

.item-desc {
  color: var(--settings-text-secondary);
  font-size: 0.8rem;
  margin-top: 0.25rem;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.status-item,
.empty-state {
  border: 1px solid var(--settings-feature-border);
  background: var(--settings-feature-bg);
  border-radius: 0.5rem;
  padding: 1rem;
}

.status-label,
.empty-desc {
  display: block;
  color: var(--settings-text-secondary);
  font-size: 0.8rem;
}

.status-value,
.empty-title {
  display: block;
  color: var(--settings-text-primary);
  font-weight: 600;
  margin-top: 0.25rem;
}

.empty-action {
  margin-top: 0.75rem;
}

.source-picker,
.quality-row {
  flex-wrap: wrap;
}

.choice-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  min-width: 0;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { send } from '@cordisjs/client'

const data = ref<any>(null)
let timer: number | undefined

const fetchStatus = async () => {
  try { data.value = await send('bilibili/status') } catch {}
}

onMounted(() => {
  fetchStatus()
  timer = window.setInterval(fetchStatus, 500)
  if (!document.getElementById('lfvs-home-grid')) {
    const s = document.createElement('style')
    s.id = 'lfvs-home-grid'
    s.textContent = `.page-home .content-body .el-scrollbar__view{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;padding:16px}@media(max-width:720px){.page-home .content-body .el-scrollbar__view{grid-template-columns:1fr}}`
    document.head.appendChild(s)
  }
})
onUnmounted(() => { if (timer !== undefined) clearInterval(timer) })

const pct = (v: number) => Math.min(100, Math.round(v * 100))
const getColor = (v: number) => v > 0.8 ? '#f56c6c' : v > 0.5 ? '#e6a23c' : '#67c23a'

const statusText = computed(() => {
  if (!data.value) return '离线'
  return data.value.status === 'logged_in' ? '在线' : data.value.status === 'waiting_qr' ? '扫码中' : '离线'
})
const statusClass = computed(() => {
  if (!data.value) return 'off'
  return data.value.status === 'logged_in' ? 'ok' : data.value.status === 'waiting_qr' ? 'warn' : 'off'
})
</script>

<template>
  <k-slot-item :order="900">
    <k-card class="lfvs-load-card">
      <div class="card-head">
        <span class="card-title">Bilibili 适配器</span>
        <span class="badge" :class="statusClass">{{ statusText }}</span>
      </div>
      <template v-if="data">
        <div class="bar-row">
          <span class="bar-label">Lisfox</span>
          <el-progress :percentage="pct(data.loadLisfox)" :color="getColor(data.loadLisfox)" :show-text="false" :stroke-width="8" class="bar" />
          <span class="bar-num">{{ data.rpmLisfox }}<small> / {{ data.maxRpmLisfox }}</small></span>
        </div>
        <div class="bar-row">
          <span class="bar-label">直连</span>
          <el-progress :percentage="pct(data.loadLocal)" :color="getColor(data.loadLocal)" :show-text="false" :stroke-width="8" class="bar" />
          <span class="bar-num">{{ data.rpmLocal }}<small> / {{ data.maxRpmLocal }}</small></span>
        </div>
        <div class="card-foot" v-if="data.uname">
          <span>{{ data.uname }}</span>
        </div>
      </template>
      <div v-else class="card-empty">等待连接…</div>
    </k-card>
  </k-slot-item>
</template>

<style scoped>
.lfvs-load-card { height: 100%; }
.card-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;
}
.card-title { font-weight: 600; font-size: 1.05rem; }
.badge {
  font-size: 0.8rem; padding: 2px 10px; border-radius: 10px; font-weight: 500;
}
.badge.ok   { background: rgba(103,194,58,0.15); color: #67c23a; }
.badge.warn { background: rgba(230,162,60,0.15); color: #e6a23c; }
.badge.off  { background: rgba(144,147,153,0.15); color: #909399; }
.bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.bar-label {
  font-size: 0.9rem; color: var(--k-text-light, #888); width: 52px; flex-shrink: 0;
}
.bar { flex: 1; min-width: 0; }
.bar-num {
  font-size: 0.85rem; font-variant-numeric: tabular-nums;
  text-align: right; min-width: 90px; flex-shrink: 0;
}
.bar-num small { color: var(--k-text-light, #888); }
.card-foot { margin-top: 6px; font-size: 0.85rem; color: var(--k-text-light, #888); }
.card-empty { color: var(--k-text-light, #888); font-size: 0.9rem; }
</style>

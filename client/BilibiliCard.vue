<template>
  <k-slot-item v-if="isCurrentPlugin">
    <k-comment :type="statusType" class="bilibili-card">
      <div class="card-content">
        <h3 class="mb-2">Bilibili 适配器状态</h3>
        <p><strong>当前状态: </strong> {{ statusText }}</p>

        <div v-if="statusData.qrcode" class="qrcode-container mt-4">
          <p class="mb-2">请使用 Bilibili 手机客户端扫描下方二维码登录：</p>
          <img :src="statusData.qrcode" alt="Bilibili Login QR Code" class="qrcode-image" />
        </div>

        <div v-if="statusData.mid" class="user-info mt-4">
          <p><strong>当前登录用户: </strong> {{ statusData.uname }} (UID: {{ statusData.mid }})</p>
        </div>
      </div>
    </k-comment>
  </k-slot-item>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useContext, send } from '@cordisjs/client'

const ctx = useContext()

const isCurrentPlugin = computed(() => {
  const entry = ctx.manager?.currentEntry
  return entry?.name === 'lfvs-bilibili-adapter' || entry?.name?.includes('lfvs-bilibili-adapter')
})

interface BilibiliStatus {
  status: 'offline' | 'waiting_qr' | 'logged_in'
  qrcode?: string // Base64 image
  mid?: number
  uname?: string
}

const statusData = ref<BilibiliStatus>({ status: 'offline' })

const statusType = computed(() => {
  switch (statusData.value.status) {
    case 'logged_in': return 'success'
    case 'waiting_qr': return 'warning'
    default: return 'danger'
  }
})

const statusText = computed(() => {
  switch (statusData.value.status) {
    case 'logged_in': return '已登录'
    case 'waiting_qr': return '等待扫码'
    default: return '未登录或已离线'
  }
})

onMounted(() => {
  if (isCurrentPlugin.value) {
    // 初始获取状态
    send('bilibili/status').then((data: BilibiliStatus) => {
      if (data) statusData.value = data
    }).catch(() => {})
  }
})

// 监听服务端推送更新
ctx.on('bilibili/status-update', (data: BilibiliStatus) => {
  statusData.value = data
})
</script>

<style scoped>
.bilibili-card {
  margin-top: 1rem;
}
.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--k-color-background);
  padding: 1rem;
  border-radius: 8px;
}
.qrcode-image {
  width: 200px;
  height: 200px;
  background: white;
  padding: 8px;
  border-radius: 4px;
}
</style>

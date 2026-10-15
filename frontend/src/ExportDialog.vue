<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { Check, Copy, TextSelect } from '@lucide/vue'
import { ZButton } from '@codex-proxy/ui/button'
import { ZDialog } from '@codex-proxy/ui/dialog'
import { ZTextarea } from '@codex-proxy/ui/textarea'

const props = defineProps<{ text: string }>()
const open = defineModel<boolean>({ required: true })
const textarea = useTemplateRef<InstanceType<typeof ZTextarea>>('textarea')
const copied = ref(false), error = ref('')
watch(open, () => { copied.value = false; error.value = '' })
function select() { textarea.value?.focus(); textarea.value?.select() }
async function copy() {
  error.value = ''; copied.value = false
  select()
  // Sandboxed management pages cannot navigate to downloads or assume clipboard permissions.
  try { copied.value = document.execCommand('copy') } catch { /* Try the secure clipboard when available. */ }
  if (!copied.value && navigator.clipboard) {
    try { await navigator.clipboard.writeText(props.text); copied.value = true } catch { /* Keep the selection for native copy. */ }
  }
  if (!copied.value) { select(); error.value = '自动复制不可用，CSV 内容已选中' }
}
</script>

<template>
  <ZDialog v-model="open" title="导出 CSV" width="48rem">
    <ZTextarea ref="textarea" :model-value="text" :rows="9" resize="none" readonly aria-label="账号 CSV 数据" class="csv-data" />
    <p v-if="error" class="error" role="status">{{ error }}</p>
    <template #footer>
      <ZButton @click="select"><template #icon><TextSelect :size="16" /></template>全选</ZButton>
      <ZButton type="primary" @click="copy"><template #icon><Check v-if="copied" :size="16" /><Copy v-else :size="16" /></template>{{ copied ? '已复制' : '复制 CSV' }}</ZButton>
    </template>
  </ZDialog>
</template>

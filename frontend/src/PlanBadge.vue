<script setup lang="ts">
import { computed } from 'vue'
import { ZTag } from '@codex-proxy/ui/tag'
import { planLabel } from './format'
const props = defineProps<{ plan: string | null }>()
const key = computed(() => props.plan?.trim().toLowerCase() || 'unknown')
const label = computed(() => planLabel(key.value))
const type = computed(() => key.value === 'team' || key.value === 'business' ? 'success' : key.value === 'plus' ? 'info' : key.value.startsWith('pro') ? 'primary' : 'default')
</script>
<template><ZTag :type="type" size="small" :title="label">{{ label }}</ZTag></template>

<script setup lang="ts">
import { computed } from 'vue'
import { forecastTitle, weeklyForecast } from './format'
import type { Row } from './types'

const props = defineProps<{ row: Row }>()
const forecast = computed(() => weeklyForecast(props.row))
</script>

<template>
  <div class="forecast-cell" :title="forecastTitle(row)">
    <template v-if="forecast?.estimatedUsd != null">
      <span class="forecast-value">≈{{ forecast.estimatedUsdDisplay }}</span>
      <span v-if="forecast.extrapolated || forecast.lowSample" class="forecast-note">{{ [forecast.extrapolated ? '折算' : '', forecast.lowSample ? '初步预估' : ''].filter(Boolean).join(' · ') }}</span>
    </template>
    <span v-else :class="row.forecastError ? 'warning' : 'muted'">{{ row.forecastError || '暂无预估' }}</span>
  </div>
</template>

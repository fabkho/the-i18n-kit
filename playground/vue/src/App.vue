<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <main>
    <h1>{{ $t('common.navigation.home') }}</h1>
    <p>{{ $t('booking.upcoming') }}</p>
    <button type="button">
      {{ t('common.actions.save') }}
    </button>
    <button type="button">
      {{ t('booking.confirm') }}
    </button>
  </main>
</template>

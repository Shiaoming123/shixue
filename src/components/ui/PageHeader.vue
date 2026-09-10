<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    variant?: 'large' | 'inline'
  }>(),
  { title: '', subtitle: '', variant: 'inline' },
)
</script>

<template>
  <header class="page-header" :class="`page-header--${variant}`">
    <div v-if="$slots.leading" class="page-header__leading"><slot name="leading" /></div>
    <div class="page-header__copy">
      <h1><slot name="title">{{ title }}</slot></h1>
      <p v-if="subtitle || $slots.subtitle"><slot name="subtitle">{{ subtitle }}</slot></p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.page-header__leading,
.page-header__actions {
  flex: 0 0 auto;
}

.page-header__copy {
  min-width: 0;
  flex: 1;
}

h1,
p {
  margin: 0;
}

h1 {
  color: var(--text);
  font-size: var(--font-title-2-size);
  font-weight: var(--font-title-2-weight);
  line-height: var(--font-title-2-leading);
  overflow-wrap: anywhere;
}

p {
  margin-top: var(--space-1);
  color: var(--muted);
  font-size: var(--font-subheadline-size);
  line-height: var(--font-subheadline-leading);
}

.page-header--large h1 {
  font-size: var(--font-large-title-size);
  font-weight: var(--font-large-title-weight);
  line-height: var(--font-large-title-leading);
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

@media (max-width: 389px) {
  .page-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .page-header__actions {
    max-width: 100%;
    margin-left: auto;
  }
}
</style>

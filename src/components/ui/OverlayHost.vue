<template>
  <div id="ui-overlay-host" class="overlay-host" />
</template>

<style scoped>
.overlay-host {
  position: fixed;
  z-index: var(--z-toast);
  inset: 0;
  pointer-events: none;
}
</style>

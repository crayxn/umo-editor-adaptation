<template>
  <modal
    :visible="exportFile.docx"
    :header="false"
    :footer="false"
    :close-btn="false"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    width="280px"
    destroy-on-close
  >
    <div
      class="umo-docx-export-progress"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <t-loading size="24px" />
      <span>{{ t('export.docx.loading') }}</span>
    </div>
  </modal>
</template>

<script setup>
const exportFile = inject('exportFile')
</script>

<style lang="less">
.umo-docx-export-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 0;
  font-size: var(--umo-font-size);
}
</style>

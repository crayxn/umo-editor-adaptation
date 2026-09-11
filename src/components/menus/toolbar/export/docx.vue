<template>
  <menus-button
    ico="word"
    :aria-label="t('export.docx.text')"
    :text="t('export.docx.text')"
    :disabled="!mainEditor"
    :force-enabled="!!mainEditor"
    huge
    @menu-click="saveDocx"
  />
</template>

<script setup>
const container = inject('container')
const mainEditor = inject('mainEditor')
const exportFile = inject('exportFile')
const exportDocx = inject('exportDocx')

const saveDocx = async () => {
  if (exportFile.value.docx) return
  try {
    await exportDocx()
  } catch {
    const dialog = useAlert({
      attach: container,
      theme: 'warning',
      header: t('export.docx.error.title'),
      body: t('export.docx.error.message'),
      onConfirm() {
        dialog.destroy()
      },
    })
  }
}
</script>

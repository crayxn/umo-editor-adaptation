<template>
  <menus-button
    ico="page-footer"
    :text="t('page.footer.text')"
    huge
    :disabled="page.layout !== 'page'"
    :menu-active="headerFooter.active === 'footer'"
    @menu-click="editHeaderFooter('footer')"
  />
</template>

<script setup>
const page = inject('page')
const headerFooter = inject('headerFooter')
const editHeaderFooter = inject('editHeaderFooter')
</script>

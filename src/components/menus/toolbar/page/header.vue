<template>
  <menus-button
    ico="page-header"
    :text="t('page.header.text')"
    huge
    :disabled="page.layout !== 'page'"
    :menu-active="headerFooter.active === 'header'"
    @menu-click="editHeaderFooter('header')"
  />
</template>

<script setup>
const page = inject('page')
const headerFooter = inject('headerFooter')
const editHeaderFooter = inject('editHeaderFooter')
</script>

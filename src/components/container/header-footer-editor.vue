<template>
  <editor-content
    class="umo-editor-content umo-header-footer-content"
    :editor="editor"
  />
  <menus-bubble v-if="options.document?.enableBubbleMenu && !destroyed">
    <template #bubble_menu="props">
      <slot name="bubble_menu" v-bind="props" />
    </template>
  </menus-bubble>
</template>

<script setup>
import { EditorContent } from '@tiptap/vue-3'

// 页眉页脚编辑器子树内（节点视图、气泡菜单）固定使用自己的实例
const props = defineProps({
  editor: { type: Object, required: true },
})
const options = inject('options')
const destroyed = inject('destroyed')
provide(
  'editor',
  computed(() => props.editor),
)
</script>

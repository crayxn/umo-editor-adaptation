<template>
  <div
    class="umo-page-header-footer-layer"
    :class="{ 'is-editing': headerFooter.active }"
  >
    <template v-for="number in pagination.pageCount" :key="number">
      <div
        v-for="kind in kinds"
        v-show="page[kind]?.show !== false"
        :key="kind"
        class="umo-page-region"
        :class="[`umo-page-${kind}`, { 'is-live': number === livePage }]"
        :data-page-number="number"
        :style="regionStyle(kind, number)"
        @dblclick="enter(kind, number)"
        @mousedown="switchTo(kind, number)"
      >
        <div
          v-if="number !== livePage"
          v-page-fields="{ page: number, total: pagination.pageCount }"
          class="umo-editor-content umo-header-footer-content is-clone"
        >
          <div
            class="umo-editor umo-header-footer-editor ProseMirror"
            v-html="cloneHtml[kind]"
          ></div>
        </div>
        <template v-else>
          <span
            v-if="headerFooter.active === kind"
            class="umo-header-footer-label"
            @mousedown.stop
          >
            {{ t(`page.${kind}.text`) }}
          </span>
          <container-header-footer-editor
            v-if="editors[kind]"
            :editor="editors[kind]"
          />
          <div
            v-if="headerFooter.active === kind"
            class="umo-header-footer-toolbar"
            @mousedown.stop
            @dblclick.stop
          >
            <menus-button
              ico="page-number"
              :text="t('page.headerFooter.insertPageNumber')"
              menu-type="dropdown"
              :select-options="formatOptions"
              overlay-class-name="umo-header-footer-format-dropdown"
              @change="(item) => insertField('insertPageNumber', item)"
            />
            <menus-button
              ico="page-count"
              :text="t('page.headerFooter.insertPageCount')"
              menu-type="dropdown"
              :select-options="formatOptions"
              overlay-class-name="umo-header-footer-format-dropdown"
              @change="(item) => insertField('insertPageCount', item)"
            />
            <menus-button
              :ico="`page-${kind}`"
              :text="t(`page.${kind}.hide`)"
              @menu-click="hide(kind)"
            />
            <menus-button
              ico="close"
              :text="t('page.headerFooter.close')"
              @menu-click="exit(true)"
            />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import { Placeholder } from '@tiptap/extensions'
import { Editor } from '@tiptap/vue-3'

import { getDefaultExtensions, inputAndPasteRules } from '@/extensions'
import PageFields, {
  applyPageFields,
  PAGE_NUMBER_FORMATS,
} from '@/extensions/page-fields'
import {
  CM_TO_PX,
  getHeaderFooterDistance,
  HEADER_FOOTER_GAP_CM,
} from '@/extensions/pagination/layout'
import { contentTransform } from '@/utils/content-transform'
import { getHeaderFooterCloneHTML } from '@/utils/header-footer'

const kinds = ['header', 'footer']
// 这些扩展只对正文有意义，页眉页脚编辑器不加载
const EXCLUDED_EXTENSIONS = new Set([
  'doc',
  'placeholder',
  'pageBreak',
  'toc',
  'footnotes',
  'footnote',
  'footnoteReference',
  'footnoteRules',
  'typewriter',
  'uniqueID',
  'invisibleCharacters',
])

const container = inject('container')
const options = inject('options')
const page = inject('page')
const pagination = inject('pagination')
const headerFooter = inject('headerFooter')
const editors = inject('headerFooterEditors')
const mainEditor = inject('mainEditor')
const uploadFileMap = inject('uploadFileMap')

const livePage = $computed(() =>
  Math.min(Math.max(1, headerFooter.value.page), pagination.value.pageCount),
)
const cloneHtml = reactive({ header: '', footer: '' })
const formatOptions = PAGE_NUMBER_FORMATS.map((value) => ({
  value,
  content: t(`page.headerFooter.formats.${value}`),
}))

const vPageFields = {
  mounted: (el, { value }) => applyPageFields(el, value),
  updated: (el, { value }) => applyPageFields(el, value),
}

const regionStyle = (kind, number) => {
  const pageTop = `calc(${number - 1} * (var(--umo-page-height) + var(--umo-page-gap)))`
  return kind === 'header'
    ? { top: pageTop }
    : { top: `calc(${pageTop} + var(--umo-page-height))` }
}

// 编辑器
const lastSynced = { header: null, footer: null }
const syncTimers = { header: null, footer: null }
let cloneFrame = 0

const refreshClones = () => {
  if (cloneFrame) return
  cloneFrame = requestAnimationFrame(() => {
    cloneFrame = 0
    kinds.forEach((kind) => {
      cloneHtml[kind] = getHeaderFooterCloneHTML(editors[kind])
    })
  })
}

const writeContent = (kind) => {
  syncTimers[kind] = null
  const editor = editors[kind]
  if (!editor || !page.value[kind]) return
  const content = editor.getHTML()
  lastSynced[kind] = content
  if (page.value[kind].content !== content) {
    page.value[kind].content = content
  }
}

const createEditor = (kind) => {
  const extensions = getDefaultExtensions({
    container,
    options,
    uploadFileMap,
  }).filter((extension) => !EXCLUDED_EXTENSIONS.has(extension.name))
  const editor = new Editor({
    editable: false,
    content: contentTransform(page.value[kind]?.content || ''),
    enableInputRules: inputAndPasteRules(options),
    enablePasteRules: inputAndPasteRules(options),
    parseOptions: options.value.document?.parseOptions,
    editorProps: {
      attributes: {
        class: `umo-editor umo-header-footer-editor`,
        'data-kind': kind,
      },
    },
    extensions: [
      ...extensions,
      Document.extend({ content: 'block+' }),
      Placeholder.configure({
        placeholder: () => t(`page.${kind}.placeholder`),
        showOnlyWhenEditable: true,
      }),
      ...PageFields,
      Extension.create({
        name: 'headerFooterKeymap',
        addKeyboardShortcuts: () => ({
          Escape: () => {
            exit(true)
            return true
          },
        }),
      }),
    ],
    onUpdate() {
      refreshClones()
      if (syncTimers[kind] !== null) clearTimeout(syncTimers[kind])
      syncTimers[kind] = setTimeout(() => writeContent(kind), 300)
    },
    onCreate({ editor }) {
      lastSynced[kind] = editor.getHTML()
    },
  })
  editor.storage.container = container
  editor.storage.options = options.value
  return editor
}

kinds.forEach((kind) => {
  editors[kind] = markRaw(createEditor(kind))
})

const flushContent = () => {
  kinds.forEach((kind) => {
    if (syncTimers[kind] !== null) {
      clearTimeout(syncTimers[kind])
      writeContent(kind)
    }
  })
}

// 外部通过 setPage 等方式修改内容时同步到编辑器
kinds.forEach((kind) => {
  watch(
    () => page.value[kind]?.content,
    (content) => {
      const editor = editors[kind]
      if (!editor || content === undefined || content === lastSynced[kind])
        return
      editor.commands.setContent(contentTransform(content), {
        emitUpdate: false,
      })
      lastSynced[kind] = editor.getHTML()
      refreshClones()
      scheduleMeasure()
    },
  )
})

watch(
  () => options.value,
  () => {
    kinds.forEach((kind) => {
      if (editors[kind]) editors[kind].storage.options = options.value
    })
  },
  { deep: true },
)

// 页码字段
watch(
  () => [livePage, pagination.value.pageCount],
  ([current, total]) => {
    kinds.forEach((kind) => {
      editors[kind]?.storage.pageFields?.update(current, total)
    })
  },
  { immediate: true },
)
watch(
  () => pagination.value.pageCount,
  (count) => {
    if (headerFooter.value.page > count) headerFooter.value.page = count
  },
)

// 进入 / 退出编辑
const enter = (kind, number) => {
  if (
    options.value.document?.readOnly ||
    mainEditor.value?.isEditable === false ||
    page.value.preview?.enabled
  ) {
    return
  }
  headerFooter.value.page = number
  headerFooter.value.active = kind
}

const switchTo = (kind, number) => {
  if (!headerFooter.value.active) return
  if (headerFooter.value.active === kind && number === livePage) return
  enter(kind, number)
}

const exit = (focusBody = false) => {
  if (!headerFooter.value.active) return
  headerFooter.value.active = null
  if (focusBody) {
    nextTick(() => mainEditor.value?.commands.focus(undefined, {
      scrollIntoView: false,
    }))
  }
}

const hide = (kind) => {
  if (page.value[kind]) page.value[kind].show = false
  exit(true)
}

const insertField = (command, item) => {
  const editor = editors[headerFooter.value.active]
  if (!editor) return
  editor
    .chain()
    .focus()
    [command]({ format: item?.value || 'decimal' })
    .run()
}

watch(
  () => headerFooter.value.active,
  async (active, previous) => {
    kinds.forEach((kind) => {
      editors[kind]?.setEditable(active === kind, false)
    })
    if (previous && previous !== active) {
      flushContent()
      refreshClones()
    }
    if (!active) return
    await nextTick()
    editors[active]?.commands.focus('end', { scrollIntoView: true })
  },
)

// 点击正文时退出
const exitOnBodyFocus = () => exit()
watch(
  () => mainEditor.value,
  (editor, previous) => {
    previous?.off('focus', exitOnBodyFocus)
    editor?.on('focus', exitOnBodyFocus)
  },
  { immediate: true },
)

// 页眉页脚高度超过页边距时撑开正文
let measureFrame = 0
const measure = () => {
  measureFrame = 0
  const margin = page.value.margin || {}
  const needed = (kind, side) => {
    const editor = editors[kind]
    if (!editor || page.value[kind]?.show === false) return 0
    const height = editor.view.dom.offsetHeight
    if (!height) return 0
    const distance = getHeaderFooterDistance(margin[side])
    const total =
      Math.ceil((distance + HEADER_FOOTER_GAP_CM) * CM_TO_PX + height)
    return total > (Number(margin[side]) || 0) * CM_TO_PX + 0.5 ? total : 0
  }
  const next = { top: needed('header', 'top'), bottom: needed('footer', 'bottom') }
  const { insets } = headerFooter.value
  if (insets.top !== next.top || insets.bottom !== next.bottom) {
    headerFooter.value.insets = next
  }
}
const scheduleMeasure = () => {
  if (!measureFrame) measureFrame = requestAnimationFrame(measure)
}
let resizeObserver = null
onMounted(() => {
  resizeObserver = new ResizeObserver(scheduleMeasure)
  kinds.forEach((kind) => {
    const dom = editors[kind]?.view.dom
    if (dom) {
      resizeObserver.observe(dom)
      dom.addEventListener('load', refreshClones, true)
    }
  })
  refreshClones()
  scheduleMeasure()
})
watch(
  () => [
    page.value.margin,
    page.value.header?.show,
    page.value.footer?.show,
    page.value.size,
    page.value.orientation,
  ],
  scheduleMeasure,
  { deep: true, flush: 'post' },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(cloneFrame)
  cancelAnimationFrame(measureFrame)
  flushContent()
  headerFooter.value.active = null
  headerFooter.value.insets = { top: 0, bottom: 0 }
  kinds.forEach((kind) => {
    editors[kind]?.destroy()
    editors[kind] = null
  })
})
</script>

<style lang="less">
.umo-page-header-footer-layer {
  position: absolute;
  inset: 0;
  z-index: 21;
  pointer-events: none;
}

.umo-page-region {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: default;
  color: var(--umo-content-text-color);
  font-size: 12px;

  &.umo-page-header {
    padding: var(--umo-page-header-distance) var(--umo-page-margin-right) 0
      var(--umo-page-margin-left);
  }

  &.umo-page-footer {
    padding: 0 var(--umo-page-margin-right) var(--umo-page-footer-distance)
      var(--umo-page-margin-left);
    transform: translateY(-100%);
  }

  .umo-header-footer-content {
    .umo-editor {
      padding: 0;
      min-height: 0;
      color: inherit;
      font-size: inherit;

      p.is-empty::before {
        content: attr(data-placeholder);
        float: left;
        height: 0;
        color: var(--umo-content-placeholder-color);
        pointer-events: none;
      }
    }

    &.is-clone .umo-editor {
      user-select: none;
      pointer-events: none;
    }
  }

  .umo-page-field {
    display: inline;
    padding: 0 2px;
    border-radius: 2px;
    background-color: rgba(0, 0, 0, 0.05);

    &.ProseMirror-selectednode {
      outline: 2px solid var(--umo-primary-color);
      outline-offset: 1px;
    }
  }

  // 正在编辑的区域和正文之间显示一条虚线
  .is-editing &.is-live::before {
    content: '';
    position: absolute;
    left: var(--umo-page-margin-left);
    right: var(--umo-page-margin-right);
    border-top: 1px dashed var(--umo-primary-color);
    pointer-events: none;
  }

  .is-editing &.is-live.umo-page-header::before {
    bottom: -2px;
  }

  .is-editing &.is-live.umo-page-footer::before {
    top: -2px;
  }
}

.umo-header-footer-label {
  position: absolute;
  left: var(--umo-page-margin-left);
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--umo-color-white);
  background-color: var(--umo-primary-color);
  border-radius: 2px;
  user-select: none;
  pointer-events: none;

  .umo-page-header & {
    top: 100%;
    margin-top: 2px;
  }

  .umo-page-footer & {
    bottom: 100%;
    margin-bottom: 2px;
  }
}

.umo-header-footer-toolbar {
  position: absolute;
  right: var(--umo-page-margin-right);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border-radius: var(--umo-radius);
  border: 1px solid var(--umo-border-color);
  background-color: var(--umo-color-white);
  box-shadow: var(--umo-shadow);
  z-index: 30;

  .umo-page-header & {
    top: 100%;
    margin-top: 2px;
  }

  .umo-page-footer & {
    bottom: 100%;
    margin-bottom: 2px;
  }

  .umo-menu-button .umo-button-text {
    display: none !important;
  }
}

@media print {
  .umo-header-footer-label,
  .umo-header-footer-toolbar {
    display: none !important;
  }
}
</style>

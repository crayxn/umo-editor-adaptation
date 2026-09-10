import { applyPageFields } from '@/extensions/page-fields'

const TRANSIENT_CLASSES = [
  'is-empty',
  'is-editor-empty',
  'has-focus',
  'umo-node-focused',
  'ProseMirror-selectednode',
  'ProseMirror-selectednoderange',
  'ProseMirror-focused',
]

// Static copy of a header or footer editor. Other pages show this copy, so it
// must not carry selection, focus or placeholder state from the live editor.
export function getHeaderFooterCloneHTML(editor) {
  const dom = editor?.view?.dom
  if (!dom) return ''
  const clone = dom.cloneNode(true)
  clone
    .querySelectorAll('.ProseMirror-gapcursor, .ProseMirror-widget')
    .forEach((element) => element.remove())
  clone.querySelectorAll('[data-placeholder]').forEach((element) => {
    element.removeAttribute('data-placeholder')
  })
  clone.querySelectorAll('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable')
  })
  clone.querySelectorAll('[class]').forEach((element) => {
    element.classList.remove(...TRANSIENT_CLASSES)
    if (!element.classList.length) element.removeAttribute('class')
  })
  return clone.innerHTML
}

// Header or footer markup for one page with the page fields filled in.
export function renderHeaderFooterForPage(html, { page, total }, document) {
  const holder = document.createElement('div')
  holder.innerHTML = html
  applyPageFields(holder, { page, total })
  return holder.innerHTML
}

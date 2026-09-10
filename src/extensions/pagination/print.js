import { CM_TO_PX } from './layout'
import { renderHeaderFooterForPage } from '@/utils/header-footer'

// Keep the measured break positions, but let the print engine supply physical
// page margins. Screen spacers would otherwise create blank printed pages.
export function preparePaginationForPrint(content) {
  const document = content.ownerDocument
  content
    .querySelectorAll(
      '.umo-page-sheets, .umo-page-node-header, .umo-page-node-footer, .umo-page-header-footer-layer',
    )
    .forEach((element) => element.remove())
  content.querySelectorAll('.umo-pagination-spacer').forEach((spacer) => {
    const next = spacer.nextElementSibling
    if (!spacer.classList.contains('umo-pagination-spacer-inline') && next) {
      next.style.setProperty('break-before', 'page', 'important')
      spacer.remove()
    } else {
      const marker = document.createElement('span')
      marker.className = 'umo-print-break'
      spacer.replaceWith(marker)
    }
  })
  content.querySelectorAll('.umo-page-break').forEach((element) => {
    element.removeAttribute('style')
    element.className = 'umo-print-break'
    element.removeAttribute('data-content')
  })
  content.querySelectorAll('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable')
  })
  return content
}

const pxToCm = (value) => Number(value || 0) / CM_TO_PX

// Splits the editor content into one section per measured page and injects the
// header and footer (with per-page fields filled in) into each section, so the
// print engine repeats them on every sheet.
export function buildPrintPages(
  content,
  { headerHtml, footerHtml, margin = {}, insets = {} },
) {
  const document = content.ownerDocument
  const editorBody =
    content.querySelector('.umo-page-node-content .ProseMirror') ||
    content.querySelector('.umo-page-node-content') ||
    content
  const blocks = Array.from(editorBody.children)
  if (!blocks.length) return

  // Group top level blocks by the measured break markers. Consecutive break
  // markers keep an empty group so blank pages survive printing.
  const groups = []
  let current = []
  blocks.forEach((block) => {
    if (block.classList.contains('umo-print-break')) {
      // Pure break marker (page break node or spacer): start a new page.
      groups.push(current)
      current = []
      return
    }
    if (block.style?.breakBefore === 'page') {
      // Automatic break: the block itself starts the next page, so an empty
      // group must not be created for it.
      if (current.length) {
        groups.push(current)
        current = []
      }
      block.style.removeProperty('break-before')
    }
    current.push(block)
  })
  if (current.length) groups.push(current)
  if (!groups.length) return

  const total = groups.length
  const bodyPadding = (side) =>
    Math.max(
      Number(margin[side]) || 0,
      pxToCm(insets[side === 'top' ? 'top' : 'bottom']),
    )

  const regionEl = (className, html) => {
    if (!html) return null
    const element = document.createElement('div')
    element.className = className
    element.innerHTML = html
    return element
  }

  const fragment = document.createDocumentFragment()
  groups.forEach((group, index) => {
    const number = index + 1
    const section = document.createElement('section')
    section.className = 'umo-print-page'

    const header = regionEl(
      'umo-print-page-header',
      headerHtml &&
        renderHeaderFooterForPage(
          headerHtml,
          { page: number, total },
          document,
        ),
    )
    const footer = regionEl(
      'umo-print-page-footer',
      footerHtml &&
        renderHeaderFooterForPage(
          footerHtml,
          { page: number, total },
          document,
        ),
    )
    if (header) section.appendChild(header)

    const body = document.createElement('div')
    body.className = 'umo-print-page-body'
    body.style.padding = `${bodyPadding('top')}cm ${Number(margin.right) || 0}cm ${bodyPadding('bottom')}cm ${Number(margin.left) || 0}cm`
    group.forEach((block) => body.appendChild(block))
    section.appendChild(body)

    if (footer) section.appendChild(footer)
    fragment.appendChild(section)
  })

  editorBody.innerHTML = ''
  editorBody.appendChild(fragment)
}

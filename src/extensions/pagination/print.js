// Keep the measured break positions, but let the print engine supply physical
// page margins. Screen spacers would otherwise create blank printed pages.
export function preparePaginationForPrint(content) {
  const document = content.ownerDocument
  content
    .querySelectorAll(
      '.umo-page-sheets, .umo-page-node-header, .umo-page-node-footer',
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

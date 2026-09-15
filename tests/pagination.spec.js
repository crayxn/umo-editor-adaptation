import { expect, test } from '@playwright/test'

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 100)),
        )
      }),
  )
}

async function setContent(page, html) {
  await page.evaluate(
    (content) =>
      window.editor
        .chain()
        .setContent(content)
        .setMeta('addToHistory', false)
        .run(),
    html,
  )
  await settle(page)
}

async function pageCount(page) {
  return page.evaluate(() => window.editor.storage.pagination.pageCount)
}

// Inspect actual text rectangles independently of the pagination algorithm.
async function textOutsidePages(page) {
  return page.evaluate(() => {
    const root = window.editor.view.dom
    const papers = [...document.querySelectorAll('.umo-page-sheet')].map((el) =>
      el.getBoundingClientRect(),
    )
    const style = getComputedStyle(root.closest('.umo-page-content'))
    const zoom =
      papers[0].width / document.querySelector('.umo-page-sheet').offsetWidth
    const topMargin =
      ((parseFloat(style.getPropertyValue('--umo-page-margin-top')) * 96) /
        2.54) *
      zoom
    const bottomMargin =
      ((parseFloat(style.getPropertyValue('--umo-page-margin-bottom')) * 96) /
        2.54) *
      zoom
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const outside = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (
        !node.textContent.trim() ||
        node.parentElement.closest(
          '[contenteditable="false"], .ProseMirror-widget',
        )
      )
        continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (!rect.height || !rect.width) continue
        if (
          !papers.some(
            (paper) =>
              rect.top >= paper.top + topMargin - 1 &&
              rect.bottom <= paper.bottom - bottomMargin + 1,
          )
        ) {
          outside.push({
            text: node.textContent.slice(0, 20),
            top: rect.top,
            bottom: rect.bottom,
          })
        }
      }
    }
    return outside.slice(0, 8)
  })
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  await page.goto('./')
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.tiptap.umo-editor:not(.umo-header-footer-editor)',
      )?.editor,
  )
  await page.evaluate(() => {
    window.editor = document.querySelector(
      '.tiptap.umo-editor:not(.umo-header-footer-editor)',
    ).editor
    let component = document.querySelector(
      '.umo-editor-container',
    ).__vueParentComponent
    while (component && !component.exposed?.getPage)
      component = component.parent
    window.umo = component.exposed
  })
  await settle(page)
})

test('long documents paginate and shrink without changing stored content', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const html = Array.from(
    { length: 36 },
    (_, index) =>
      `<p>第 ${index + 1} 段：${'分页测试，内容自动换行。'.repeat(18)}</p>`,
  ).join('')
  await setContent(page, html)
  expect(await pageCount(page)).toBeGreaterThan(3)
  await expect(page.locator('.umo-page-sheet')).toHaveCount(
    await pageCount(page),
  )
  expect(await textOutsidePages(page)).toEqual([])
  const saved = await page.evaluate(() => window.editor.getHTML())
  expect(saved).not.toContain('umo-pagination')
  expect(saved).not.toContain('pageBreak')
  await setContent(page, '<p>只剩一页</p>')
  expect(await pageCount(page)).toBe(1)
  await expect(page.locator('.umo-pagination-spacer')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a single paragraph flows across pages and supports cross-page undo', async ({
  page,
}) => {
  await setContent(
    page,
    `<p>${'连续中文段落与 English words，不拆分文档。'.repeat(220)}</p>`,
  )
  expect(await pageCount(page)).toBeGreaterThan(2)
  expect(await textOutsidePages(page)).toEqual([])
  const before = await page.evaluate(() => {
    const json = window.editor.getJSON()
    const pos = window.editor.storage.pagination.layout.breaks[0].pos
    window.editor.commands.setTextSelection({ from: pos - 5, to: pos + 5 })
    window.editor.commands.focus()
    return json
  })
  await expect(
    page.locator('.tiptap.umo-editor:not(.umo-header-footer-editor)'),
  ).toBeFocused()
  await page.keyboard.press('Backspace')
  await settle(page)
  await page.evaluate(() => window.editor.commands.undo())
  await settle(page)
  expect(await page.evaluate(() => window.editor.getJSON())).toEqual(before)
  expect(await textOutsidePages(page)).toEqual([])
})

test('manual page breaks survive automatic reflow and consecutive breaks create blank pages', async ({
  page,
}) => {
  await setContent(page, '<p>前半后半</p>')
  await page.evaluate(() =>
    window.editor.chain().focus().setTextSelection(3).run(),
  )
  await expect(
    page.locator('.tiptap.umo-editor:not(.umo-header-footer-editor)'),
  ).toBeFocused()
  // tiptap 的 Mod-Enter 在 macOS 上是 Cmd+Enter，其余平台是 Ctrl+Enter
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
  )
  await settle(page)
  expect(await pageCount(page)).toBe(2)
  await expect(page.locator('.umo-editor > .umo-page-break')).toHaveCount(1)
  expect(await textOutsidePages(page)).toEqual([])
  await setContent(
    page,
    '<p>第一页</p><div class="umo-page-break"></div><div class="umo-page-break"></div><p>第三页</p>',
  )
  expect(await pageCount(page)).toBe(3)
  expect(await textOutsidePages(page)).toEqual([])
})

test('paper size, margins, zoom and web view reflow the same document', async ({
  page,
}) => {
  await setContent(page, `<p>${'页面尺寸改变后重新排版。'.repeat(240)}</p>`)
  const before = await page.evaluate(() => window.editor.getJSON())
  const count = await pageCount(page)
  await page.evaluate(() => {
    window.umo.getPage().zoomLevel = 60
  })
  await settle(page)
  expect(await pageCount(page)).toBe(count)
  expect(await textOutsidePages(page)).toEqual([])
  await page.evaluate(() => {
    window.umo.getPage().margin = { top: 4, bottom: 4, left: 4, right: 4 }
  })
  await settle(page)
  expect(await pageCount(page)).toBeGreaterThan(count)
  expect(await textOutsidePages(page)).toEqual([])
  await page.evaluate(() => {
    window.umo.getPage().orientation = 'landscape'
  })
  await settle(page)
  expect(await textOutsidePages(page)).toEqual([])
  await page.evaluate(() => {
    window.umo.getPage().layout = 'web'
  })
  await settle(page)
  await expect(page.locator('.umo-pagination-spacer')).toHaveCount(0)
  await expect(page.locator('.umo-page-sheet')).toHaveCount(0)
  expect(await page.evaluate(() => window.editor.getJSON())).toEqual(before)
})

test('tables and lists continue on following pages', async ({ page }) => {
  const rows = Array.from(
    { length: 80 },
    (_, index) =>
      `<tr><td><p>第 ${index + 1} 行</p></td><td><p>表格内容</p></td></tr>`,
  ).join('')
  await setContent(page, `<table><tbody>${rows}</tbody></table>`)
  expect(await pageCount(page)).toBeGreaterThan(2)
  expect(await textOutsidePages(page)).toEqual([])
  expect(
    await page.evaluate(
      () => window.editor.getJSON().content[0].content.length,
    ),
  ).toBe(80)
  await setContent(
    page,
    `<ol>${Array.from({ length: 70 }, (_, index) => `<li><p>列表项 ${index + 1} ${'列表内容。'.repeat(10)}</p></li>`).join('')}</ol>`,
  )
  expect(await pageCount(page)).toBeGreaterThan(2)
  expect(await textOutsidePages(page)).toEqual([])
})

test('cursor keys and typing cross a page boundary without adding document nodes', async ({
  page,
}) => {
  await setContent(page, `<p>${'跨页编辑与光标移动测试。'.repeat(180)}</p>`)
  const pos = await page.evaluate(() => {
    const boundary = window.editor.storage.pagination.layout.breaks[0].pos
    window.editor
      .chain()
      .setTextSelection(boundary - 1)
      .focus()
      .run()
    return boundary
  })
  await expect(
    page.locator('.tiptap.umo-editor:not(.umo-header-footer-editor)'),
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => page.evaluate(() => window.editor.state.selection.head))
    .toBe(pos)
  await page.keyboard.insertText('新输入的中文')
  await settle(page)
  expect(
    await page.evaluate(() =>
      window.editor.state.doc.textBetween(
        window.editor.state.selection.head - 6,
        window.editor.state.selection.head,
      ),
    ),
  ).toBe('新输入的中文')
  expect(await textOutsidePages(page)).toEqual([])
  expect(await page.evaluate(() => window.editor.state.doc.childCount)).toBe(1)
})

test('reflow waits for composition to finish and works in read-only preview', async ({
  page,
}) => {
  await setContent(page, '<p>中文输入</p>')
  await page.evaluate(() => {
    window.editor.view.dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    window.editor.commands.insertContent('输入法组合文本。'.repeat(400))
  })
  await settle(page)
  expect(await pageCount(page)).toBe(1)
  await page.evaluate(() =>
    window.editor.view.dom.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  )
  await settle(page)
  expect(await pageCount(page)).toBeGreaterThan(1)
  expect(await textOutsidePages(page)).toEqual([])
  const count = await pageCount(page)
  await page.evaluate(() => {
    window.umo.getPage().preview.enabled = true
  })
  await settle(page)
  expect(await pageCount(page)).toBe(count)
  expect(await page.evaluate(() => window.editor.isEditable)).toBe(false)
})

test('hard breaks, nested lists and large text retain all their lines', async ({
  page,
}) => {
  await setContent(
    page,
    `<p style="font-size: 24px; text-indent: 2em">${Array.from({ length: 90 }, (_, i) => `第 ${i + 1} 行，中英混排 English <b>加粗</b>`).join('<br>')}</p>`,
  )
  expect(await pageCount(page)).toBeGreaterThan(2)
  expect(await textOutsidePages(page)).toEqual([])
  await setContent(
    page,
    `<ul><li><p>外层列表</p><ol>${Array.from({ length: 70 }, (_, i) => `<li><p>嵌套项 ${i} ${'文字内容'.repeat(12)}</p></li>`).join('')}</ol></li></ul>`,
  )
  expect(await textOutsidePages(page)).toEqual([])
})

test('oversized images fit a page and content reflows when an image is resized', async ({
  page,
}) => {
  const src =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1800"><rect width="400" height="1800" fill="#b8d8f5"/></svg>',
    )
  await setContent(
    page,
    `<p>图片前的文字</p><img src="${src}" width="400" height="1800"><p>图片后的文字</p>`,
  )
  await expect(page.locator('.umo-pagination-scaled')).toHaveCount(1)
  expect(await textOutsidePages(page)).toEqual([])
  const fits = await page.evaluate(() => {
    const image = document
      .querySelector('.umo-node-view[data-type="image"]')
      .getBoundingClientRect()
    const { bodyHeight } = window.editor.storage.pagination.layout.geometry
    return image.height <= bodyHeight + 1
  })
  expect(fits).toBe(true)
  await page.evaluate(() => {
    window.editor.state.doc.forEach((node, pos) => {
      if (node.type.name === 'image')
        window.editor.view.dispatch(
          window.editor.state.tr.setNodeMarkup(pos, null, {
            ...node.attrs,
            width: 200,
            height: 200,
          }),
        )
    })
  })
  await settle(page)
  expect(await pageCount(page)).toBe(1)
  expect(await textOutsidePages(page)).toEqual([])
  await setContent(page, `<img src="${src}" width="400" height="1800">`)
  // A fitted image at the beginning must not create an empty leading page.
  expect(await pageCount(page)).toBeLessThanOrEqual(2)
  expect(
    await page.evaluate(
      () => window.editor.storage.pagination.layout.pages[1]?.from ?? 1,
    ),
  ).not.toBe(0)
})

test('printing preserves page count and removes screen spacers', async ({
  page,
  context,
}, testInfo) => {
  await setContent(
    page,
    `<p>${'打印分页和正文内容。'.repeat(320)}</p><div class="umo-page-break"></div><p>手动分页后的最后一页</p>`,
  )
  const count = await pageCount(page)
  await page.evaluate(() => {
    window.umo.getPage().zoomLevel = 60
  })
  await settle(page)
  await page.screenshot({ path: testInfo.outputPath('pagination-preview.png') })
  await page.evaluate(() => window.umo.print())
  await expect(page.locator('.umo-print-iframe')).toHaveAttribute(
    'srcdoc',
    /umo-print-break/,
  )
  const code = await page.locator('.umo-print-iframe').getAttribute('srcdoc')
  const output = await context.newPage()
  await output.setContent(code)
  await expect(
    output.locator('.umo-pagination-spacer, .umo-page-sheet'),
  ).toHaveCount(0)
  const pdf = await output.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    path: testInfo.outputPath('pagination.pdf'),
  })
  expect(
    (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length,
  ).toBe(count)
  await output.close()
})

test('tall header pushes body content down when printing', async ({
  page,
  context,
}) => {
  await setContent(page, `<p>${'正文内容，用于验证页眉挤压。'.repeat(60)}</p>`)
  await page.evaluate(() => {
    const p = window.umo.getPage()
    p.header = {
      ...p.header,
      show: true,
      content: Array.from(
        { length: 8 },
        (_, i) => `<p>页眉第 ${i + 1} 行</p>`,
      ).join(''),
    }
  })
  await settle(page)
  const count = await pageCount(page)
  await page.evaluate(() => window.umo.print())
  await expect(page.locator('.umo-print-iframe')).toHaveAttribute(
    'srcdoc',
    /umo-print-page-header/,
  )
  const code = await page.locator('.umo-print-iframe').getAttribute('srcdoc')
  const output = await context.newPage()
  await output.setContent(code)
  // 模拟静态预留不足：清空正文上边距后运行挤压逻辑，正文必须被推到页眉之下
  const layout = await output.evaluate(() => {
    const body = document.querySelector('.umo-print-page-body')
    body.style.paddingTop = '0px'
    window.fitHeaderFooter()
    const section = document.querySelector('.umo-print-page')
    const header = section.querySelector('.umo-print-page-header')
    const first = section.querySelector('.umo-print-page-body > *')
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      bodyTop: first.getBoundingClientRect().top,
      padding: body.style.paddingTop,
    }
  })
  expect(layout.padding).not.toBe('0px')
  expect(layout.bodyTop).toBeGreaterThan(layout.headerBottom)
  const pdf = await output.pdf({ preferCSSPageSize: true })
  expect(
    (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length,
  ).toBe(count)
  await output.close()
})

for (const kind of ['header', 'footer']) {
  test(`printing merged ${kind} tables keeps images inside their cells`, async ({
    page,
    context,
  }, testInfo) => {
    const src =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="74"><rect width="140" height="74" fill="#304448"/><circle cx="28" cy="37" r="18" fill="#e53935"/><path d="M60 25h65v24H60z" fill="white"/></svg>',
      )
    await page.evaluate(
      ({ kind, src }) => {
        // Keep the fixture readable by the separate PDF page after upload.
        window.umo.getOptions().onFileUpload = async () => ({
          id: `print-${kind}-image`,
          url: src,
        })
        const settings = window.umo.getPage()
        settings.margin = { top: 2, bottom: 2, left: 2.5, right: 2.5 }
        settings.header.show = false
        settings.footer.show = false
        settings[kind] = {
          ...settings[kind],
          show: true,
          content: `<table><tbody><tr><th rowspan="3"><img src="${src}" width="140" height="74"></th><th colspan="3"><p>测试文档</p></th></tr><tr><td><p>编号</p></td><td><p>5</p></td><td><p>1</p></td></tr><tr><td><p>版本</p></td><td><p>A</p></td><td><p><span data-type="pageNumber"></span> / <span data-type="pageCount"></span></p></td></tr></tbody></table>`,
        }
      },
      { kind, src },
    )
    await setContent(
      page,
      '<p>测试文档正文</p><div class="umo-page-break"></div><p>第二页正文</p>',
    )
    const liveImage = page.locator(`.umo-page-${kind}.is-live img[src]`)
    await expect(liveImage).toBeVisible()
    await liveImage.evaluate((image) => image.decode())
    await settle(page)
    await page.locator(`.umo-page-${kind}.is-live th p`).dblclick()
    await liveImage.click()
    await expect(
      page.locator(`.umo-page-${kind}.is-live .es-drager.selected`),
    ).toHaveCount(1)

    const measureImage = (image) => {
      const rect = image.getBoundingClientRect()
      const cell = image.closest('th, td').getBoundingClientRect()
      return {
        left: rect.left - cell.left,
        top: rect.top - cell.top,
        width: rect.width,
        height: rect.height,
        right: cell.right - rect.right,
        bottom: cell.bottom - rect.bottom,
      }
    }
    const preview = await liveImage.evaluate(measureImage)
    const count = await pageCount(page)
    await page.evaluate(() => window.umo.print())
    await expect(page.locator('.umo-print-iframe')).toHaveAttribute(
      'srcdoc',
      /umo-print-page/,
    )
    const code = await page.locator('.umo-print-iframe').getAttribute('srcdoc')
    const output = await context.newPage()
    await output.setViewportSize({ width: 794, height: 1123 })
    await output.emulateMedia({ media: 'print' })
    await output.setContent(code)
    const images = output.locator(`.umo-print-page-${kind} img[src]`)
    await expect(images).toHaveCount(count)
    await images.evaluateAll((elements) =>
      Promise.all(elements.map((image) => image.decode())),
    )
    await output.evaluate(() => window.fitHeaderFooter())
    const controls = output.locator(
      '.es-drager-dot, .es-drager-rotate, .umo-node-image-loading, .umo-node-image-uploading',
    )
    for (const control of await controls.all()) {
      await expect(control).toBeHidden()
    }
    for (const frame of await output.locator('.es-drager').all()) {
      await expect(frame).toHaveCSS('outline-style', 'none')
    }
    await expect(
      output.locator(`.umo-print-page-${kind} [data-type="pageNumber"]`),
    ).toHaveText(['1', '2'])
    await expect(
      output.locator(`.umo-print-page-${kind} [data-type="pageCount"]`),
    ).toHaveText(['2', '2'])
    await output.screenshot({ path: testInfo.outputPath(`${kind}-print.png`) })
    const pdf = await output.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      path: testInfo.outputPath(`${kind}-table.pdf`),
    })
    for (const image of await images.all()) {
      const printed = await image.evaluate(measureImage)
      expect(printed.left).toBeGreaterThanOrEqual(0)
      expect(printed.top).toBeGreaterThanOrEqual(0)
      expect(printed.right).toBeGreaterThanOrEqual(0)
      expect(printed.bottom).toBeGreaterThanOrEqual(0)
      for (const dimension of ['left', 'top', 'width', 'height']) {
        expect(
          Math.abs(printed[dimension] - preview[dimension]),
        ).toBeLessThan(1)
      }
    }
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length,
    ).toBe(count)
    await output.close()
  })
}

test('code blocks paginate without losing lines', async ({ page }) => {
  await setContent(
    page,
    `<pre><code>${Array.from({ length: 100 }, (_, i) => `const value${i} = ${i}`).join('\n')}</code></pre>`,
  )
  expect(await pageCount(page)).toBeGreaterThan(1)
  expect(await textOutsidePages(page)).toEqual([])
})

for (const [name, html] of [
  [
    'consecutive manual breaks',
    '<p>第一页</p><div class="umo-page-break"></div><div class="umo-page-break"></div><p>第三页</p>',
  ],
  [
    'tables',
    `<table><tbody>${Array.from({ length: 90 }, (_, i) => `<tr><td><p>表格第 ${i} 行</p></td><td><p>第二列</p></td></tr>`).join('')}</tbody></table>`,
  ],
]) {
  test(`${name} produce the same number of PDF pages`, async ({
    page,
    context,
  }) => {
    await setContent(page, html)
    const count = await pageCount(page)
    await page.evaluate(() => window.umo.print())
    await expect(page.locator('.umo-print-iframe')).toHaveAttribute(
      'srcdoc',
      /umo-print-break/,
    )
    const code = await page.locator('.umo-print-iframe').getAttribute('srcdoc')
    const output = await context.newPage()
    await output.setContent(code)
    const pdf = await output.pdf({ preferCSSPageSize: true })
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length,
    ).toBe(count)
    await output.close()
  })
}

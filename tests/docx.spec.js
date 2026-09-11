import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const text = (value, marks) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const paragraph = (value, attrs = {}) => ({
  type: 'paragraph',
  attrs,
  content: typeof value === 'string' ? [text(value)] : value,
})
const item = (...content) => ({ type: 'listItem', content })
const cell = (value, attrs = {}, type = 'tableCell') => ({
  type,
  attrs,
  content: [paragraph(value)],
})

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
}

async function getDocx(page) {
  const result = await page.evaluate(async () => {
    const blob = await window.umo.getDocx()
    return {
      type: blob.type,
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    }
  })
  expect(result.type).toBe(MIME)
  return JSZip.loadAsync(Buffer.from(result.bytes))
}

async function xml(zip, name = 'word/document.xml') {
  expect(zip.file(name), `DOCX part ${name} exists`).not.toBeNull()
  return zip.file(name).async('string')
}

async function validatePackage(page, zip) {
  const parts = await Promise.all(
    zip
      .file(/\.(?:xml|rels)$/)
      .map(async (file) => [file.name, await file.async('string')]),
  )
  const result = await page.evaluate((parts) => {
    const errors = []
    const targets = []
    for (const [name, content] of parts) {
      const doc = new DOMParser().parseFromString(content, 'application/xml')
      if (doc.querySelector('parsererror')) errors.push(name)
      if (!name.endsWith('.rels')) continue
      const base = name.replace(/_rels\/[^/]*\.rels$/, '')
      for (const relationship of doc.getElementsByTagName('Relationship')) {
        if (relationship.getAttribute('TargetMode') === 'External') continue
        targets.push(
          new URL(
            relationship.getAttribute('Target'),
            `https://docx.invalid/${base}`,
          ).pathname.slice(1),
        )
      }
    }
    return { errors, targets }
  }, parts)
  expect(result.errors).toEqual([])
  for (const target of result.targets)
    expect(zip.file(target), target).not.toBeNull()
  expect(await xml(zip, '[Content_Types].xml')).toContain(
    'wordprocessingml.document.main+xml',
  )
  expect(await xml(zip)).not.toContain('altChunk')
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
    while (component && !component.exposed?.getDocx)
      component = component.parent
    window.umo = component.exposed
  })
  await settle(page)
})

for (const mode of ['ribbon', 'classic']) {
  test(`${mode} toolbar shows export progress and prevents duplicate downloads, including in read-only mode`, async ({
    page,
  }, testInfo) => {
    const downloads = []
    page.on('download', (download) => downloads.push(download))
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      return canvas.toDataURL('image/png').split(',')[1]
    })
    let releaseImage
    let exportRequests = 0
    const imageReady = new Promise((resolve) => (releaseImage = resolve))
    await page.route('**/docx-progress.png', async (route) => {
      if (route.request().resourceType() === 'fetch') {
        exportRequests++
        await imageReady
      }
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(png, 'base64'),
      })
    })
    await page.evaluate((mode) => {
      window.umo.setToolbar({ mode })
      window.umo.setDocument({ title: '导出:测试.docx' })
      window.editor.commands.setContent(
        '<p>从工具栏下载的中文文档</p><img src="/docx-progress.png" width="80" height="40">',
      )
      if (mode === 'classic') window.umo.setReadOnly(true)
    }, mode)
    if (mode === 'classic') {
      await page
        .locator('.umo-classic-menu')
        .getByRole('textbox', { name: '请选择', exact: true })
        .click()
      await page.getByText('导出', { exact: true }).click()
    } else {
      await page
        .locator('.umo-toolbar')
        .getByText('导出', { exact: true })
        .click()
    }
    const button = page.getByRole('button', { name: 'Word 文档', exact: true })
    await expect(button).toBeEnabled()
    const downloadPromise = page.waitForEvent('download')
    await button.click()
    const progress = page.getByRole('status').filter({ hasText: '正在导出…' })
    await expect(progress).toBeVisible()
    await expect(button).toBeEnabled()
    await expect(button).toHaveText('Word 文档')
    await page.keyboard.press('Escape')
    await expect(progress).toBeVisible()
    // Click the export button's screen position: the modal must intercept it.
    const bounds = await button.boundingBox()
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )
    await expect(progress).toBeVisible()
    // Even programmatic clicks and concurrent API calls reuse the active export.
    await button.dispatchEvent('click')
    expect(
      await page.evaluate(() => {
        const first = window.umo.exportDocx('重复请求一')
        const second = window.umo.exportDocx('重复请求二')
        window.pendingDocxExport = Promise.all([first, second])
        return first === second
      }),
    ).toBe(true)
    expect(downloads).toHaveLength(0)
    releaseImage()
    const download = await downloadPromise
    await page.evaluate(() => window.pendingDocxExport.then(() => true))
    expect(download.suggestedFilename()).toBe('导出_测试.docx')
    const output = testInfo.outputPath('export.docx')
    await download.saveAs(output)
    const zip = await JSZip.loadAsync(await readFile(output))
    expect(await xml(zip)).toContain('从工具栏下载的中文文档')
    await validatePackage(page, zip)
    await expect(progress).toBeHidden()
    await expect(button).toBeEnabled()
    expect(exportRequests).toBe(1)
    expect(downloads).toHaveLength(1)
  })
}

test('uses SimSun for the document and DOCX defaults while preserving explicit fonts', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.editor.commands.setContent(
      '<h1>宋体标题</h1><p>默认宋体正文 ABC 123</p><p><span style="font-family: SimHei">手动黑体</span></p><pre><code>const value = 1</code></pre>',
    )
    window.umo.setPage({
      header: { show: true, content: '<p>宋体页眉</p>' },
      footer: { show: true, content: '<p>宋体页脚</p>' },
    })
  })
  const main = page.locator('.tiptap.umo-editor:not(.umo-header-footer-editor)')
  for (const element of [
    main,
    main.locator('h1'),
    main.getByText('默认宋体正文 ABC 123', { exact: true }),
    page.locator('.umo-page-header .umo-editor').first(),
    page.locator('.umo-page-footer .umo-editor').first(),
  ]) {
    await expect(element).toHaveCSS('font-family', /^SimSun(?:,|$)/i)
  }
  await expect(main.getByText('手动黑体', { exact: true })).toHaveCSS(
    'font-family',
    'SimHei',
  )
  const zip = await getDocx(page)
  const fonts = await page.evaluate(
    (content) => {
      const doc = new DOMParser().parseFromString(content, 'application/xml')
      const styles = [
        doc.getElementsByTagName('w:docDefaults')[0],
        ...Array.from(doc.getElementsByTagName('w:style')).filter((style) =>
          /^Heading[1-6]$/.test(style.getAttribute('w:styleId')),
        ),
      ]
      return styles.map((style) => {
        const [font] = style.getElementsByTagName('w:rFonts')
        return Object.fromEntries(
          ['ascii', 'hAnsi', 'eastAsia', 'cs'].map((name) => [
            name,
            font?.getAttribute(`w:${name}`),
          ]),
        )
      })
    },
    await xml(zip, 'word/styles.xml'),
  )
  expect(fonts).toHaveLength(7)
  for (const font of fonts) {
    expect(font).toEqual({
      ascii: 'SimSun',
      hAnsi: 'SimSun',
      eastAsia: 'SimSun',
      cs: 'SimSun',
    })
  }
  const body = await xml(zip)
  for (const slot of ['ascii', 'hAnsi', 'eastAsia', 'cs']) {
    expect(body).toContain(`w:${slot}="SimHei"`)
    expect(body).toContain(`w:${slot}="Consolas"`)
  }
  expect(await xml(zip, zip.file(/^word\/header\d+\.xml$/)[0].name)).toContain(
    '宋体页眉',
  )
  expect(await xml(zip, zip.file(/^word\/footer\d+\.xml$/)[0].name)).toContain(
    '宋体页脚',
  )
})

test('exports editable formatting, numbering, merged tables, footnotes and explicit page breaks', async ({
  page,
}) => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [text('中文标题 & <DOCX>')],
      },
      paragraph(
        [
          text('格式文字', [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'strike' },
            {
              type: 'textStyle',
              attrs: {
                fontFamily: 'SimSun',
                fontSize: '16pt',
                color: 'rgb(18, 52, 86)',
                backgroundColor: '#ffff00',
              },
            },
            { type: 'letterSpacing', attrs: { spacing: '2px' } },
          ]),
          { type: 'hardBreak' },
          text('链接', [
            { type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } },
          ]),
          text('上标', [{ type: 'superscript' }]),
          text('下标', [{ type: 'subscript' }]),
          {
            type: 'footnoteReference',
            attrs: { 'data-fn-id': 'export-note', referenceNumber: 1 },
          },
        ],
        {
          textAlign: 'center',
          lineHeight: 2,
          indent: 1,
          indentUnit: 'em',
          margin: { top: '12', bottom: '18' },
        },
      ),
      {
        type: 'orderedList',
        attrs: { start: 4, listType: 'lower-roman' },
        content: [
          item(paragraph('编号四'), {
            type: 'bulletList',
            attrs: { listType: 'square' },
            content: [item(paragraph('嵌套项目'))],
          }),
          item(paragraph('编号五'), paragraph('同一列表项的续段')),
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [item(paragraph('重新编号一'))],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [paragraph('已完成')],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [paragraph('待完成')],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell(
                '合并表头',
                { colspan: 2, colwidth: [100, 140] },
                'tableHeader',
              ),
              cell('表头三', { colwidth: [120] }, 'tableHeader'),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('纵向合并', {
                rowspan: 2,
                colwidth: [100],
                background: '#abcdef',
                align: 'center-middle',
              }),
              cell('横向合并', { colspan: 2, colwidth: [140, 120] }),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('第二列', { colwidth: [140] }),
              cell('第三列', { colwidth: [120] }),
            ],
          },
        ],
      },
      {
        type: 'codeBlock',
        content: [text('const 中文 = 1\n\treturn 中文 < 2')],
      },
      { type: 'pageBreak' },
      { type: 'pageBreak' },
      paragraph('自动换页的正文内容。'.repeat(350)),
      {
        type: 'footnotes',
        content: [
          {
            type: 'footnote',
            attrs: { id: 'fn:1', 'data-fn-id': 'export-note' },
            content: [paragraph('脚注解释内容')],
          },
        ],
      },
    ],
  }
  await page.evaluate((content) => {
    window.editor.commands.setContent(content)
    window.umo.setPage({
      orientation: 'landscape',
      margin: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
    })
    window.umo.getPage().zoomLevel = 70
    window.editor.commands.setTextSelection(3)
  }, content)
  await settle(page)
  const before = await page.evaluate(() => ({
    content: window.editor.getJSON(),
    selection: window.editor.state.selection.toJSON(),
    zoom: window.umo.getPage().zoomLevel,
    editable: window.editor.isEditable,
  }))
  const zip = await getDocx(page)
  const body = await xml(zip)
  await validatePackage(page, zip)
  expect(body).toContain('中文标题 &amp; &lt;DOCX&gt;')
  expect(body).toContain('<w:pStyle w:val="Heading2"')
  for (const tag of [
    '<w:b/>',
    '<w:i/>',
    '<w:strike/>',
    '<w:u w:val="single"',
    'w:sz w:val="32"',
    'w:color w:val="123456"',
    'w:fill="FFFF00"',
    'w:eastAsia="SimSun"',
    'w:vertAlign w:val="superscript"',
    'w:vertAlign w:val="subscript"',
  ]) {
    expect(body).toContain(tag)
  }
  expect(body).toContain('w:line="480"')
  expect(body).toContain('w:before="180"')
  expect(body).toContain('w:after="270"')
  expect(body).toContain('w:firstLine="420"')
  expect(body).toContain('w:gridSpan w:val="2"')
  expect(body).toContain('w:vMerge w:val="restart"')
  expect(body).toContain('w:vMerge w:val="continue"')
  expect(body).toContain('w:fill="ABCDEF"')
  expect(body).toContain('<w:tblHeader')
  expect(body).toContain('☑')
  expect(body).toContain('☐')
  expect(body).toContain('<w:tab/>')
  expect(body.match(/<w:br w:type="page"\s*\/>/g)).toHaveLength(2)
  expect(body).not.toContain('umo-pagination')
  expect(body).toContain('w:footnoteReference w:id="1"')
  expect(await xml(zip, 'word/footnotes.xml')).toContain('脚注解释内容')
  expect(await xml(zip, 'word/numbering.xml')).toContain(
    'w:numFmt w:val="lowerRoman"',
  )
  expect(await xml(zip, 'word/numbering.xml')).toContain('w:start w:val="4"')
  expect(await xml(zip, 'word/_rels/document.xml.rels')).toContain(
    'https://example.com/?a=1&amp;b=2',
  )
  expect(body).toContain('w:orient="landscape"')
  expect(body).toContain('w:w="16838"')
  expect(body).toContain('w:h="11906"')
  expect(body).toContain('w:left="1417"')
  expect(
    await page.evaluate(() => ({
      content: window.editor.getJSON(),
      selection: window.editor.state.selection.toJSON(),
      zoom: window.umo.getPage().zoomLevel,
      editable: window.editor.isEditable,
    })),
  ).toEqual(before)
})

test('includes the entire body and the latest header edits, including fields in web view', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.editor.commands.setContent('<h1>完整正文</h1><p>正文结束</p>')
    window.umo.setPage({
      header: { show: true, content: '<p>旧页眉</p>' },
      footer: {
        show: true,
        content:
          '<p style="text-align: center">第 <span data-type="pageNumber" data-format="upperRoman"></span> 页 / 共 <span data-type="pageCount"></span> 页</p>',
      },
    })
  })
  await settle(page)
  await page.evaluate(() => {
    window.umo.editHeaderFooter('header')
    window.umo
      .getHeaderFooterEditor('header')
      .commands.setContent('<p><strong>尚未同步的最新页眉</strong></p>')
    window.docxFromHeader = window.umo.getDocx()
  })
  const bytes = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(await (await window.docxFromHeader).arrayBuffer()),
    ),
  )
  const zip = await JSZip.loadAsync(Buffer.from(bytes))
  expect(await xml(zip)).toContain('完整正文')
  expect(await xml(zip)).toContain('正文结束')
  const headerName = zip.file(/^word\/header\d+\.xml$/)[0].name
  const footerName = zip.file(/^word\/footer\d+\.xml$/)[0].name
  expect(await xml(zip, headerName)).toContain('尚未同步的最新页眉')
  expect(await xml(zip, footerName)).toContain('PAGE \\* ROMAN')
  expect(await xml(zip, footerName)).toContain('NUMPAGES \\* Arabic')
  expect(await xml(zip, 'word/settings.xml')).toContain('w:updateFields')
  await validatePackage(page, zip)
  await page.evaluate(() => window.umo.setLayout('web'))
  const web = await getDocx(page)
  expect(await xml(web, headerName)).toContain('尚未同步的最新页眉')
  expect(await xml(web, footerName)).toContain('NUMPAGES')
  await page.evaluate(() =>
    window.umo.setPage({ header: { show: false }, footer: { show: false } }),
  )
  const hidden = await getDocx(page)
  expect(hidden.file(/^word\/(?:header|footer)\d+\.xml$/)).toHaveLength(0)
})

test('embeds data/blob images and converts SVG and WebP into Word-compatible images', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 40
    const context = canvas.getContext('2d')
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 80, 40)
    const png = canvas.toDataURL('image/png')
    const blob = await new Promise((resolve) => canvas.toBlob(resolve))
    window.originalImageURL = URL.createObjectURL(blob)
    context.fillStyle = '#0000ff'
    context.fillRect(0, 0, 80, 40)
    const webp = canvas.toDataURL('image/webp')
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="green"/></svg>')}`
    window.editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '行内图片' },
            {
              type: 'inlineImage',
              attrs: { src: png, width: 40, height: 20, uploaded: true },
            },
          ],
        },
        {
          type: 'image',
          attrs: {
            src: window.originalImageURL,
            width: 160,
            height: 80,
            uploaded: true,
            showTitle: true,
            nodeAlign: 'flex-end',
          },
          content: [{ type: 'text', text: '图片说明' }],
        },
        {
          type: 'image',
          attrs: { src: svg, width: 120, height: 60, uploaded: true },
        },
        {
          type: 'image',
          attrs: { src: webp, width: 80, height: 40, uploaded: true },
        },
      ],
    })
  })
  const zip = await getDocx(page)
  await validatePackage(page, zip)
  const media = zip.file(/^word\/media\//)
  expect(media.length).toBeGreaterThanOrEqual(3)
  expect(media.every((file) => file.name.endsWith('.png'))).toBe(true)
  const body = await xml(zip)
  expect(body.match(/<w:drawing>/g)).toHaveLength(4)
  expect(body).toContain('图片说明')
  expect(body).toContain('w:jc w:val="right"')
  expect(body).toContain('cx="1524000"')
  expect(body).not.toContain('blob:')
  expect(
    await page.evaluate(async () => (await fetch(window.originalImageURL)).ok),
  ).toBe(true)
})

test('reports an inaccessible image, clears loading state and allows a successful retry', async ({
  page,
}) => {
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  await page.route('**/docx-missing-image.png', (route) =>
    route.fulfill({ status: 404, body: 'missing image' }),
  )
  await page.evaluate(() =>
    window.editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '/docx-missing-image.png', uploaded: true },
        },
      ],
    }),
  )
  await page.locator('.umo-toolbar').getByText('导出', { exact: true }).click()
  const button = page.getByRole('button', { name: 'Word 文档', exact: true })
  await button.click()
  await expect(
    page.getByText('无法导出 Word 文档。请确认文档中的图片可访问后重试。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: '正在导出…' }),
  ).toBeHidden()
  await expect(button).toBeEnabled()
  expect(downloads).toHaveLength(0)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.evaluate(() =>
    window.editor.commands.setContent('<p>恢复后可以下载</p>'),
  )
  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  const zip = await JSZip.loadAsync(await readFile(await download.path()))
  expect(await xml(zip)).toContain('恢复后可以下载')
})

test('exports an empty document and preserves text from additional editor nodes', async ({
  page,
}) => {
  await page.evaluate(() => window.editor.commands.clearContent())
  await validatePackage(page, await getDocx(page))
  await page.evaluate(() =>
    window.editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'datetime', attrs: { text: '2026年9月10日' } },
            { type: 'mention', attrs: { id: 'alice', label: 'Alice' } },
            { type: 'tag', attrs: { text: '重要标签' } },
            { type: 'inlineMath', attrs: { latex: 'x^2 + y^2 = z^2' } },
            {
              type: 'optionBox',
              attrs: {
                items: [
                  { label: '选项甲', checked: true },
                  { label: '选项乙', checked: false },
                ],
              },
            },
          ],
        },
        {
          type: 'file',
          attrs: {
            name: '附件.pdf',
            url: 'https://example.com/attachment.pdf',
            uploaded: true,
          },
        },
        {
          type: 'columnContainer',
          content: [
            {
              type: 'column',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '左栏内容' }],
                },
              ],
            },
            {
              type: 'column',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '右栏内容' }],
                },
              ],
            },
          ],
        },
      ],
    }),
  )
  const zip = await getDocx(page)
  const body = await xml(zip)
  for (const value of [
    '2026年9月10日',
    '@Alice',
    '重要标签',
    'x^2 + y^2 = z^2',
    '选项甲',
    '选项乙',
    '附件.pdf',
    '左栏内容',
    '右栏内容',
  ]) {
    expect(body).toContain(value)
  }
  expect(await xml(zip, 'word/_rels/document.xml.rels')).toContain(
    'https://example.com/attachment.pdf',
  )
  await validatePackage(page, zip)
})

<template>
  <iframe ref="iframeRef" class="umo-print-iframe" :srcdoc="iframeCode" />
</template>

<script setup>
import {
  buildPrintPages,
  preparePaginationForPrint,
} from '@/extensions/pagination/print'
import { CM_TO_PX, getHeaderFooterDistance } from '@/extensions/pagination/layout'

const container = inject('container')
const editor = inject('mainEditor')
const printing = inject('printing')
const exportFile = inject('exportFile')
const page = inject('page')
const headerFooter = inject('headerFooter')
const options = inject('options')

const iframeRef = $ref(null)
let iframeCode = $ref('')
const getStylesHtml = () => {
  return Array.from(document.querySelectorAll('link, style'))
    .map((item) => item.outerHTML)
    .join('')
}

const getPlyrSprite = () => {
  return document.querySelector('#sprite-plyr')?.innerHTML || ''
}

const getContentDiv = () => {
  const originalContent =
    document.querySelector(`${container} .umo-page-content`)?.outerHTML || ''
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = originalContent
  preparePaginationForPrint(tempDiv)
  prepareEchartsForPrint(tempDiv)
  return tempDiv
}
// 因echart依赖于组件动态展示，打印时效果无法通过html实现，所以通过转成图片方式解决
const prepareEchartsForPrint = (tempDiv) => {
  // 找到所有需要转换的ECharts实例
  const charts = tempDiv.querySelectorAll('.umo-node-echarts-body')
  for (const chartElement of charts) {
    const chartInstance = echarts.getInstanceByDom(chartElement)
    if (chartInstance) {
      // 使用getDataURL方法获取图表的base64图片数据
      const imgData = chartInstance.getDataURL({
        type: 'png', // 可以是'png'或'jpeg'
        pixelRatio: 2, // 提高分辨率，默认是1//分辨率太高会慢
        backgroundColor: '#fff', // 背景颜色，默认是透明
      })

      // 创建一个新的img元素并设置其src属性为图表的base64图片数据
      const imgElement = document.createElement('img')
      imgElement.src = imgData
      imgElement.style.width = '100%' // 确保图片宽度适合容器，根据实际情况调整

      // 替换原图表元素为img元素
      if (chartElement && chartElement.parentNode) {
        chartElement.parentNode.replaceChild(imgElement, chartElement)
      }
    }
  }
}

const defaultLineHeight = $computed(
  () => options.value.dicts?.lineHeights.find((item) => item.default)?.value,
)

const getIframeCode = () => {
  const { orientation, size, margin, background } = page.value
  const contentDiv = getContentDiv()
  // 分页布局下按页拆分内容并注入页眉页脚（页码字段按页填充）
  const withHeaderFooter =
    page.value.layout === 'page' &&
    (page.value.header?.show !== false || page.value.footer?.show !== false)
  if (withHeaderFooter) {
    buildPrintPages(contentDiv, {
      headerHtml:
        page.value.header?.show !== false
          ? page.value.header?.content || ''
          : '',
      footerHtml:
        page.value.footer?.show !== false
          ? page.value.footer?.content || ''
          : '',
      margin,
      insets: headerFooter.value?.insets,
    })
  }
  const headerDistance = getHeaderFooterDistance(margin?.top)
  const footerDistance = getHeaderFooterDistance(margin?.bottom)
  // 打印页物理高度，与 @page size 保持一致，页眉页脚以纸张边缘定位。
  // 偏移取整到整数像素：cm 换算是小数（如 1.5cm = 56.69px），
  // 1px 边框跨像素行时光栅化会丢掉顶部一像素，导致页眉顶端显示不全
  const pxPerCm = CM_TO_PX
  const pageHeight = orientation === 'portrait' ? size?.height : size?.width
  const pageHeightPx = Math.round(Number(pageHeight || 0) * pxPerCm)
  const headerOffsetPx = Math.round(headerDistance * pxPerCm)
  const footerOffsetPx = Math.round(footerDistance * pxPerCm)
  /* eslint-disable */
  return `
    <!DOCTYPE html>
    <html lang="zh-CN" theme-mode="${options.value.theme}">
    <head>
      <title>${options.value.document?.title}</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${getStylesHtml()}
      <style>
      html{
        margin: 0;
        padding: 0;
        overflow: visible;
      }
      body{
        margin: 0;
        padding: 0;
        background-color: ${background};
        -webkit-print-color-adjust: exact;
      }
      .umo-editor-container{
        display: block;
        height: auto !important;
        min-height: 0;
        background-color: ${background} !important;
      }
      .umo-page-content{
        display: block !important;
        width: auto !important;
        min-height: 0 !important;
        transform: none !important;
        overflow: visible !important;
      }
      .umo-page-node-content, .umo-editor-content .umo-editor{
        padding: 0 !important;
        min-height: 0 !important;
      }
      .umo-editor *{
        orphans: 1;
        widows: 1;
      }
      .umo-editor-content .tableWrapper{
        overflow: visible !important;
      }
      .umo-print-break{
        display: block;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        break-before: page;
      }
      .umo-print-break::after{
        display: none !important;
      }
      .umo-print-page{
        position: relative;
        /* 至少占满一页纸张（减 1px 避免舍入溢出产生空白页），页眉页脚的
           top/bottom 才能以纸张边缘为参照，与屏幕端一致；内容超过一页
           （如跨页表格）时仍按内容撑高，交给浏览器自然分页 */
        min-height: ${pageHeightPx - 1}px;
        /* 消除编辑器段落间距在分页 section 间产生的额外空隙，
           否则 section 放不进一页会打印出空白页 */
        margin: 0 !important;
      }
      .umo-print-page:not(:last-child){
        break-after: page;
      }
      .umo-print-page-header{
        position: absolute;
        top: ${headerOffsetPx}px;
        left: 0;
        right: 0;
        box-sizing: border-box;
        padding: 0 ${margin?.right}cm 0 ${margin?.left}cm;
        color: var(--umo-content-text-color);
        /* 与屏幕端页眉页脚（.umo-page-region）的字号/行距一致，
           度量偏差会让正文与页眉之间留出大片空白 */
        font-size: 12px;
        line-height: normal;
        font-family: var(--umo-font-family);
      }
      .umo-print-page-footer{
        position: absolute;
        bottom: ${footerOffsetPx}px;
        left: 0;
        right: 0;
        box-sizing: border-box;
        padding: 0 ${margin?.right}cm 0 ${margin?.left}cm;
        color: var(--umo-content-text-color);
        font-size: 12px;
        line-height: normal;
        font-family: var(--umo-font-family);
      }
      /* 与屏幕端编辑器段落间距保持一致；提高特异性以覆盖
         全局样式 .umo-editor-container p 的 margin: 0 */
      .umo-editor-container .umo-print-page-header > * + *,
      .umo-editor-container .umo-print-page-footer > * + *{
        margin-top: var(--umo-content-node-bottom);
      }
      /* 屏幕端图片是块级节点（独立成行），打印端保持一致 */
      .umo-print-page-header img,
      .umo-print-page-footer img{
        display: block;
      }
      /* 屏幕端空段落靠 tiptap 的行尾 br 撑出行框，序列化后的空段落
         需要补回同样的高度，否则页眉页脚比屏幕端矮 */
      .umo-print-page-header p:empty::after,
      .umo-print-page-footer p:empty::after{
        content: '\\200B';
      }
      @page {
        size: ${orientation === 'portrait' ? size?.width : size?.height}cm ${orientation === 'portrait' ? size?.height : size?.width}cm;
        margin: ${withHeaderFooter ? 0 : `${margin?.top}cm ${margin?.right}cm ${margin?.bottom}cm ${margin?.left}cm`};
        background-color: ${background};
      }
      </style>
    </head>
    <body class="is-print">
      <div id="sprite-plyr" style="display: none;">
      ${getPlyrSprite()}
      </div>
      <div class="umo-editor-container" style="line-height: ${defaultLineHeight};" aria-expanded="false">
        ${contentDiv.innerHTML}
      </div>
      <script>
        // 页眉页脚超出预留位置时向下挤压正文：按打印时实际渲染的高度校准
        // 正文上下 padding（只增不减，静态预留值来自屏幕端测量）。
        window.fitHeaderFooter = function () {
          var sections = document.querySelectorAll('.umo-print-page')
          if (!sections.length) return
          var probe = document.createElement('div')
          probe.style.cssText = 'position:absolute;visibility:hidden;height:1cm'
          document.body.appendChild(probe)
          var cm = probe.offsetHeight || 37.8
          probe.parentNode.removeChild(probe)
          var gap = 0.2 * cm
          Array.prototype.forEach.call(sections, function (section) {
            var body = section.querySelector('.umo-print-page-body')
            if (!body) return
            var header = section.querySelector('.umo-print-page-header')
            var footer = section.querySelector('.umo-print-page-footer')
            if (!header && !footer) return
            var style = getComputedStyle(body)
            var paddingTop = parseFloat(style.paddingTop) || 0
            var paddingBottom = parseFloat(style.paddingBottom) || 0
            if (header) {
              var headerNeed =
                (parseFloat(getComputedStyle(header).top) || 0) +
                header.offsetHeight + gap
              if (headerNeed > paddingTop) paddingTop = headerNeed
            }
            if (footer) {
              var footerNeed =
                (parseFloat(getComputedStyle(footer).bottom) || 0) +
                footer.offsetHeight + gap
              if (footerNeed > paddingBottom) paddingBottom = footerNeed
            }
            body.style.paddingTop = paddingTop + 'px'
            body.style.paddingBottom = paddingBottom + 'px'
          })
        }
        document.addEventListener('DOMContentLoaded', window.fitHeaderFooter)
        // print() 同步触发 beforeprint，此时字体图片已就绪，按最终度量再校准一次
        window.addEventListener('beforeprint', window.fitHeaderFooter)
        document.addEventListener("DOMContentLoaded", (event) => {
          const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
              if (mutation.removedNodes) {
                Array.from(mutation.removedNodes).forEach(node => {
                  if (node?.classList?.contains('umo-page-watermark')) {
                    location.reload();
                  }
                });
              }
            });
          });
        });
      <\/script>
    </body>
    </html>`
  /* eslint-enable */
}

const printPage = async () => {
  editor.value?.commands.blur()
  await nextTick()
  editor.value?.commands.repaginate()
  await new Promise(requestAnimationFrame)
  iframeCode = getIframeCode()

  const dialog = useConfirm({
    attach: container,
    theme: 'info',
    header: printing.value ? t('print.title') : t('export.pdf.title'),
    body: printing.value ? t('print.message') : t('export.pdf.message'),
    confirmBtn: printing.value ? t('print.confirm') : t('export.pdf.confirm'),
    async onConfirm() {
      dialog.destroy()
      const printDocument = iframeRef?.contentDocument
      if (!printDocument || !iframeRef.contentWindow) return
      await printDocument.fonts?.ready
      await Promise.all(
        Array.from(printDocument.images).map((image) =>
          image.decode().catch(() => {}),
        ),
      )
      iframeRef.contentWindow.print()
    },
    onClosed() {
      printing.value = false
      exportFile.value.pdf = false
    },
  })
}

watch(
  () => [printing.value, exportFile.value.pdf],
  (value) => {
    if (!value[0] && !value[1]) {
      return
    }
    printPage()
  },
)
</script>

<style lang="less" scoped>
.umo-print-iframe {
  position: absolute;
  width: 0;
  height: 0;
  border: none;
  overflow: auto;
}
</style>

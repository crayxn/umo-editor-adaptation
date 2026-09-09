# 分页

页面视图默认根据纸张尺寸和页边距自动分页，默认纸张为 A4。直接输入或粘贴长文即可看到多页效果，删除内容会自动回流。页间距为 24px；缩放只改变显示比例。

- 段落和代码块按实际行高分页，列表可以跨页继续。
- 普通表格在行之间分页，有纵向合并单元格时保留合并区域。
- 图片和其他无法拆分的节点整体换页；超过一页高度时按比例缩小显示。无法放入一页的合并表格整体缩放。
- 工具栏「页面 → 分页符」或 `Ctrl+Enter`（macOS 为 `Cmd+Enter`）插入手动分页符。连续分页符保留空白页。
- 页脚显示页码，状态栏显示光标所在页和总页数。「页面 → 页脚」可隐藏页脚页码。
- 纸张、方向、页边距、字号、图片尺寸和字体加载完成后会重新分页。中文输入法组合输入结束后再重排。
- Web 视图恢复连续排版，打印 / PDF 使用实际纸张边距，并保留页面视图中的分页位置。

沿用现有组件 API：

```js
editorRef.value.setLayout('page')
editorRef.value.setPage({ size: 'A4', orientation: 'portrait' })

// 读取最近一次排版结果；布局更新在下一动画帧完成。
const { currentPage, pageCount } = editorRef.value.getPagination()

// 自定义节点在自身布局变化后也可以主动请求重新排版。
editorRef.value.useEditor().commands.repaginate()
```

实现位于 `src/extensions/pagination/`。它通过 ProseMirror decorations 为页边距和页间距预留空间，始终保留一个连续的编辑器。自动分页不会改动 HTML / JSON 文档结构，不产生撤销步骤；手动分页符仍是文档中的 `pageBreak` 节点。正文测量考虑缩放、实际字体和浏览器行布局；打印时将屏幕占位替换为打印分页规则。

这里提供纸张分页与连续编辑，不包含 Word 的节、不同首页页眉或脚注逐页编排。浮动节点仍遵循原有定位方式。

运行浏览器回归测试（默认使用本机 Chrome）：

```sh
npm install
npm run test:pagination
npm run build
```

也可将 `PLAYWRIGHT_CHANNEL` 设置为 `msedge`，使用已安装的 Edge。测试覆盖内容回流、跨页键盘编辑与撤销、组合输入、缩放与纸张设置、图片、表格、列表、代码块和生成 PDF 的实际页数。

/**
 * 工具注册表 —— 加工具只改这个文件。
 *
 * 每个工具是一个**自包含**的目录（自己的 HTML / JS / CSS / 依赖），跑在独立 iframe 里，
 * 所以各工具的全局变量和样式互不干扰：一个工具里的 `marked` 不会撞上另一个工具里的。
 *
 * 字段：
 *   id      必填，唯一标识，也是 URL hash（#gzh-studio）
 *   name    导航栏上显示的名字
 *   desc    一句话说明，作 title 提示
 *   entry   相对 renderer/ 的入口 HTML
 *   group   导航栏分组标题，同组的排在一起
 *   icon    可选，32×32 的内联 SVG 字符串；不给就用首字生成占位图标
 *   badge   可选，右上角小角标（"新" / "Beta"）
 */
window.GZH_TOOLS = [
  {
    id: 'gzh-studio',
    name: '公众号排版',
    desc: 'Markdown → 微信公众号 HTML，支持从文章链接抓取',
    entry: 'tools/gzh-studio/index.html',
    group: '内容生产',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10"/><path d="M4 12h16"/><path d="M4 17h7"/><path d="M17 4.5 19 7l-2 2.5"/></svg>'
  }

  /* 加新工具：复制 docs/new-tool-template/ 到 renderer/tools/<id>/，再加一条：
   *
   * ,{
   *   id: 'image-tools',
   *   name: '图片处理',
   *   desc: '压缩 / 裁剪 / 转格式',
   *   entry: 'tools/image-tools/index.html',
   *   group: '素材处理'
   * }
   */
];

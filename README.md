# 匿名百宝箱 · Toolbox

一个**可扩展的本地小工具集**桌面程序。左侧导航切换工具，每个工具独立隔离、独立开发。
目前装了第一个工具：**公众号排版**（Markdown → 微信公众号 HTML，支持从文章链接一键抓取正文）。

打包成 Windows 安装程序，安装时可自选路径。

---

## 为什么要包一层 Electron

公众号排版这个工具要抓文章，而浏览器里抓公众号有个绕不过去的坎：CORS 是 Chromium
渲染进程的策略，`mp.weixin.qq.com` 不返回 `Access-Control-Allow-Origin`，页面里的
`fetch()` 必然拿不到响应，只能借公共 CORS 代理转发 —— 而这条路的免费额度现在基本没了：

| 通道 | 现况（实测） |
| --- | --- |
| r.jina.ai | HTTP 401 `AuthenticationRequiredError`，匿名额度已取消 |
| corsproxy.io | HTTP 401 `A valid API key is required` |
| 其它公共代理 | 多数已被 CORS 拒绝或下线 |

主进程走 Node 的 `http/https`，没有同源策略，直接 GET 就能拿到正文 ——
公众号正文（`#js_content`）是服务端直出的，一次请求即可，**不需要无头浏览器执行 JS**。

```
外壳 renderer/index.html（左侧导航）
  └─ iframe: renderer/tools/gzh-studio/
        └─ window.toolbox.invoke('fetchArticle', {url})
              │ postMessage
              ▼
           外壳 renderer/shell/shell.js        补上「消息来自哪个工具」，然后转发
              │
              ▼
           src/preload.js                      通用通道 tool:invoke
              │
              ▼
           src/main.js                         只做分发，不认识任何具体工具
              │
              ▼
           src/tools/gzh-studio/main.js        公众号策略：伪装 UA、防盗链 Referer、反爬页识别
              └─► src/shell/http.js            通用 HTTP：重定向、超时、解压（无 CORS）
```

工具页里仍保留了原来的代理链，所以它单独用浏览器打开也能跑（只是成功率看代理脸色）；
在外壳里跑时自动切换成主进程直连。

---

## 目录

```
Toolbox/
├── src/                       主进程：通用平台，不认识任何具体工具
│   ├── main.js                启动：开窗、快捷键、装配、窗口/菜单
│   ├── preload.js             contextBridge，只注入到外壳，工具靠外壳转发
│   ├── shell/
│   │   ├── paths.js           用户数据目录（~/.toolbox）
│   │   ├── store.js           统一配置库（node:sqlite，零原生依赖）
│   │   ├── logger.js          文件日志 + 全局错误钩子
│   │   ├── http.js            通用 HTTP GET：重定向、超时、解压（不含业务策略）
│   │   ├── downloads.js       下载落盘交系统保存对话框
│   │   └── tool-modules.js    发现并加载 src/tools/*/main.js
│   ├── tools/
│   │   └── gzh-studio/
│   │       └── main.js        ★ 公众号的主进程侧：UA、防盗链 Referer、反爬页识别
│   └── assets/icon.ico        窗口图标
├── renderer/                  ★ 运行时目录，整个打进 app.asar
│   ├── index.html             外壳：左侧导航 + iframe 工具宿主
│   ├── shell/
│   │   ├── shell.js           导航渲染、工具切换、通用 broker
│   │   └── logo.png           导航栏顶部的程序 logo（由 make-icon.py 生成）
│   └── tools/
│       ├── registry.js        ★ 加工具只改这个文件
│       └── gzh-studio/        公众号排版工具，见下面的结构
├── docs/                      开发文档，不打包
│   ├── adding-a-tool.md       怎么加工具、隔离怎么做的
│   └── new-tool-template/     新工具模板（复制到 renderer/tools/<id>/ 用）
├── build/
│   ├── logo.png               设计稿原件（图标和导航栏 logo 的唯一来源）
│   ├── icon.ico               多尺寸 16/20/24/32/40/48/64/128/256
│   ├── icon.png               256 预览
│   ├── preview-sheet.png      各尺寸对照图，验收小尺寸是否糊
│   └── installer.nsh          NSIS 卸载钩子：问要不要删 ~/.toolbox
├── tools/                     构建脚本，不打包
│   └── make-icon.py           从 build/logo.png 生成图标 + 导航栏 logo
└── package.json               含全部 electron-builder 配置
```

**一个工具的东西分布在两个地方，但同名**（都叫 `gzh-studio`）：界面在 `renderer/tools/`、
主进程侧在 `src/tools/`。分开是因为它们跑在不同进程里（主进程有 Node 能力，渲染进程没有），
混在一起反而看不清谁是谁；同名是为了顺着名字就能找全。

### 公众号排版工具内部结构

```
renderer/tools/gzh-studio/
├── index.html          页面骨架（8 KB），只放标记和外链引用
├── app.css             全部样式
├── bridge.js           宿主桥：把主进程能力代理成 window.toolbox
├── vendor/             第三方压缩包，原样不动
│   ├── marked.min.js
│   └── html2canvas.min.js
└── js/
    ├── core.js         元素引用、state、示例文章、预览布局、convert 管线、toast
    │                   ← 定义 window.GZH，其它模块的共享上下文
    ├── themes.js       18 套主题定义
    ├── converter.js    Markdown → 语义 token
    ├── validator.js    公众号平台红线校验
    ├── prompts.js      提示词模板（改措辞不用翻别的文件）
    ├── picker.js       主题下拉选择器
    ├── export.js       复制到公众号 / 下载 HTML / 导出长图
    ├── ai.js           AI 排版优化（模型管理 + 调用 + 弹框）
    ├── article.js      文章链接抓取 + 网页 HTML → Markdown
    └── app.js          只剩事件绑定与启动（3 KB）
```

加载顺序有依赖（`index.html` 里有注释标明）：
`vendor → themes/converter/validator → core → 各功能模块 → app`。
拆出来的模块用 `var 同名 = GZH.同名` 接住自己需要的东西，所以每个文件开头几行就能看清
**它依赖外部什么**，函数体保持原样、没有隐式共享。

---

## 工具化架构

外壳只做三件事：渲染左侧导航、把选中的工具放进 iframe、替工具转发主进程能力。
**加工具 = 建一个目录 + 在 `renderer/tools/registry.js` 加一条**，不碰 `main.js`
也不碰 `package.json`。详见 [`docs/adding-a-tool.md`](docs/adding-a-tool.md)。

**什么该放哪**（`package.json` 的 `files` 只收 `src/**`、`renderer/**`、`package.json`）：

| 目录 | 打包进 app.asar | 放什么 |
| --- | --- | --- |
| `renderer/` | ✅ | 只放应用跑起来真正要的文件。多一个字节都是白发给用户 |
| `src/` | ✅ | 主进程 / preload / 抓取模块 |
| `docs/` | ❌ | 开发文档、新工具模板 |
| `tools/` | ❌ | 构建脚本、改造脚本、图标生成 |
| `build/` | ❌ | 图标源件和 electron-builder 的 buildResources |

几个刻意的决定：

- **用 iframe 而不是动态 import 做隔离。** 每个工具要有独立的 JS realm：公众号排版定义的
  `Md2GZHConverter`、`marked` 这些全局变量不会撞上别的工具，CSS 也不会互相污染。
  代价是 iframe 拿不到 preload，所以主进程能力由外壳转发。
- **preload 只注入外壳，不开 `nodeIntegrationInSubFrames`。** 开了的话 preload 会进
  **每一个** iframe，包括排版工具里渲染文章 HTML 的那个预览 iframe —— 预览内容是从网上
  抓回来的，不该拿到一个「任意发请求」的口子。外壳当唯一出口，顺便也是将来按工具授权的
  管控点。
- **工具载体不销毁。** 切换工具只切 `hidden`，排版工具里的文章不会因为点了别的工具就没了。
- **工具永远可以单独打开调试。** 宿主桥是可选能力 `if (window.toolbox)`，没有就走兜底。
- **程序 logo 只出现在外壳**（导航栏、exe、安装程序）。工具不带图标。

---

## 用户数据与配置库

所有需要留存的东西都在**用户主目录下的 `.toolbox`**，不用 Electron 默认的
`%APPDATA%\Toolbox` —— 路径好记、好备份、好手动清理：

```
~/.toolbox/
├── toolbox.db          统一配置库（SQLite）
└── logs/
    └── main.log        主进程 + 渲染进程的日志（超过 2 MB 轮转成 main.log.1）
```

### 配置库

用 Node 内置的 **`node:sqlite`**（Node 22.5+ 随运行时提供），所以**零依赖**：
不需要 `better-sqlite3`，不需要 `electron-rebuild` 编译原生模块，装了 Node 就能跑。

表结构就一张 kv 表，值统一按 JSON 存，工具想存对象/数组/字符串都行：

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
```

**键名约定**：跨工具共享的用通用前缀，只有自己用的加工具前缀。

| 键 | 是什么 | 谁在用 |
| --- | --- | --- |
| `ai.models` | 大模型配置（接口地址 / 密钥 / 模型名） | 公众号排版 |
| `author.name` | 用户署名 | 公众号排版的「署名配置」 |
| `gzh-studio.xxx` | 工具私有配置 | 公众号排版 |

工具侧的统一入口是 `window.toolbox.store`：

```js
const r = await window.toolbox.store.get('ai.models');
if (r.ok) console.log(r.result);
await window.toolbox.store.set('ai.models', [{ id: 'm1', model: 'deepseek-chat' }]);
await window.toolbox.store.remove('ai.models');
const all = await window.toolbox.store.all();
```

外壳里走主进程的 SQLite；工具单独用浏览器打开时（调试），`GZH.store` 自动降级到
localStorage，所以工具照样能跑。

> 沿革：大模型配置原本塞在 localStorage 的 `gzh.studio.models.v1` 里，现在搬进了配置库的
> 通用键 `ai.models`（首次运行会自动迁移）。localStorage 里仍留一份缓存，只供「独立打开调试」
> 和首屏使用，**配置库是权威存储**。

### 日志

`src/shell/logger.js` 把三样东西落到文件：主进程的启动/退出/工具加载、未捕获异常、
以及渲染进程的 `console.warn/error`（包括各个工具 iframe 里的报错）。出问题时让用户把
`~/.toolbox/logs/main.log` 发过来即可。用环境变量 `TOOLBOX_LOG_LEVEL=debug` 可以放宽级别。

### 卸载时

安装程序会在卸载前问一句：

```
是否同时删除所有数据与配置？

将删除：C:\Users\<你>\.toolbox
（配置数据库 toolbox.db、运行日志、大模型配置等）

选「否」则保留，以后重新安装还能接着用。
```

默认按钮是「否」，静默卸载（`/S`）时不弹窗、**保留**数据 —— 都往安全的那一侧靠。
实现在 `build/installer.nsh`（electron-builder 的 `customUnInstall` 钩子），
它在删除程序文件**之前**执行，而且在「检查应用是否在运行」之后，所以库不会被占用。

---

## 开发

```bash
npm install     # 首次会下载 Electron 二进制（约 100MB）
npm start       # 或 npm run dev，两个等价
```

`start` 和 `dev` 两个名字都指向 `electron .`。用 `start` 是因为**它是 npm 的保留生命周期
脚本名**（和 `test` 一样），所以可以直接敲 `npm start` 而不用 `npm run start` ——
不是 Electron 版本变化，纯 npm 惯例。`dev` 是顺手加的别名，用哪个都行。

改了文件按 `Ctrl+Shift+R` 重载（**`Ctrl+R` 故意没接**，防误按丢文章）。

**没有菜单栏**（`Menu.setApplicationMenu(null)`），保留的快捷键：

| 键 | 作用 |
| --- | --- |
| `F12` / `Ctrl+Shift+I` | 开发者工具 |
| `Ctrl+Shift+R` | 重新载入 |
| `Ctrl+±` / `Ctrl+0` | 缩放 |

调工具最省事的办法：直接用浏览器打开 `renderer/tools/<工具>/index.html` ——
每个工具都保证能独立跑（宿主能力是可选降级）。调试外壳里的完整链路才需要 `npm start`。

> ⚠️ 调试时容易踩的坑：`electron .`（dev）和打包版**共用同一个 userData 目录**
> （由 `productName` 决定）。只要有一个实例活着，另一个会因单实例锁**静默退出** ——
> 表现为「窗口没起来」或「调试端口连不上」。先 `taskkill /F /IM electron.exe` 再看。

---

## 打包

```bash
npm run dist           # NSIS 安装包 → dist/Toolbox-Setup-1.0.0.exe
npm run dist:dir       # 只解包不打包，调试用 → dist/win-unpacked/
npm run dist:portable  # 免安装绿色版 → dist/Toolbox-Portable-1.0.0.exe
```

`dist/` 里的产物：

| 文件 | 说明 |
| --- | --- |
| `Toolbox-Setup-1.0.0.exe` | 安装向导（可改路径），双击安装 |
| `Toolbox-Setup-1.0.0.exe.blockmap` | 增量更新用，留着即可 |
| `win-unpacked/` | 未压缩的绿色目录，可直接运行 |

`.npmrc` 里已配 npmmirror 镜像，否则首次 install / build 容易卡在 GitHub 下载。
npm 11 会对那两行报 `Unknown project config` 警告 —— 目前仍然生效（`npm run` 会把它们
导出成 `npm_config_*` 环境变量），等 npm 大版本砍掉后改成环境变量即可：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

### 安装程序行为（package.json → build.nsis）

向导的页面顺序（对照 `app-builder-lib/templates/nsis/assistedInstaller.nsh` 核过）：

```
① 欢迎
② 安装模式     为所有用户安装（需 UAC）/ 仅为我安装（免 UAC）
③ 选择安装位置  默认 <所选模式目录>\Toolbox，可改
④ 安装进度
⑤ 完成         默认勾选「运行 匿名百宝箱」
```

| 选项 | 值 | 效果 |
| --- | --- | --- |
| `oneClick` | `false` | 走向导而不是静默一键装 —— ②③ 页存在的前提 |
| `allowToChangeInstallationDirectory` | `true` | **编译进「选择安装位置」页**。构建日志里能查到 `Command line defined: "allowToChangeInstallationDirectory"` |
| `perMachine` | `false` | 不锁定安装模式，所以向导会问 ②；选「仅为我」时全程不弹 UAC |
| `allowElevation` | `true` | 只有选「为所有用户」时才提权，两个选项都可用 |
| `shortcutName` | 匿名百宝箱 | 桌面 / 开始菜单快捷方式名字 |
| `uninstallDisplayName` | 匿名百宝箱 | 控制面板「卸载程序」里显示的名字 |
| `installerLanguages` | `zh_CN` | 安装界面中文 |

选完目录后安装程序会自动补一层 `Toolbox` 子目录（模板里的 `instFilesPre`）：
选 `D:\Tools` 实际装到 `D:\Tools\Toolbox`。

想**跳过模式选择页、强制全机器安装**：

```jsonc
"nsis": {
  "perMachine": true,          // 改这里：不再出现 ②，直接装 C:\Program Files
  "allowElevation": true,      // 保持 true
  ...
}
```

### 关于文件名用 ASCII

`productName` 特意用 ASCII 的 `Toolbox`（决定安装目录名、exe 文件名、userData 目录），
中文名「匿名百宝箱」放在 `shortcutName` / `uninstallDisplayName` / 窗口标题 / 导航栏上 ——
避免中文路径在 NSIS、杀软、签名环节上出幺蛾子。

### 关于代码签名

没有配置签名，安装时 Windows SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」即可。
要消掉这个提示得买代码签名证书，然后在 `build.win` 里加：

```jsonc
"certificateFile": "path/to/cert.pfx",
"certificatePassword": "${env.CSC_KEY_PASSWORD}"
```

---

## 与浏览器的差异

外壳里额外做了三件页面做不到的事：

1. **抓取走主进程** —— 没有 CORS，不用借公共代理。
2. **图片防盗链修正** —— `mmbiz.qpic.cn` 会校验 Referer，主进程把 qpic 域名的请求头
   统一补成 `https://mp.weixin.qq.com/`，预览里图片不再是碎图。
3. **保存对话框** —— 工具的「下载 HTML」「导出长图」原本是 Blob 静默下载，现在是原生
   保存对话框，能自己选目录和文件名。存完由外壳把提示转给当前工具。

---

## 换程序 logo

设计稿放在 `build/logo.png`（带透明通道，竖构图也行），然后：

```bash
npm run icon        # 等价于 python tools/make-icon.py
npm run dist
```

`make-icon.py` 把设计稿裁到不透明包围盒 → 等比缩放进透明正方形画布（**不裁切**，
免得切掉面具或箱子）→ 缩到 9 个尺寸打进 ICO，同时产出导航栏用的 `renderer/shell/logo.png`
和供肉眼验收的 `build/preview-sheet.png`（含 16/24/32 放大 6 倍的对比行）。

logo 只出现在**程序级**位置：导航栏、exe、安装程序、窗口图标。
工具页不带图标 —— 早前版本误把 logo 放进了公众号排版工具的头部，那一版和改造它的脚本
都已经不在了。

> 踩过的坑：早期版本是「每个尺寸各截一张 Chrome 无头截图」。Chrome 无头窗口在 Windows
> 上有最小宽度（约 175px），`100vw/100vh` 按被撑大的布局视口算，而 `--screenshot` 仍按
> 请求尺寸裁剪 —— 结果 128px 那张是空图，180px 那张只切到图标一条边。现在改成
> 「一次大图 + PIL 缩放」，没这个问题了。

---

## 公众号排版工具的来历

工具的前身是一份 363 KB 的**自包含单文件页面**（Markdown → 公众号 HTML，含内联的
marked / html2canvas / 18 套主题 / 转换器 / 校验器 / 全部交互逻辑）。有了外壳之后做了两件事：

1. **拆文件**：CSS 出 `app.css`，第三方库出 `vendor/`，主题/转换器/校验器各成一个文件，
   那个 1430 行的应用闭包按职责拆成 `core / prompts / picker / export / ai / article / app`。
   `index.html` 从 363 KB 降到 8 KB。
2. **改成外壳桥**：原来它自己借公共 CORS 代理抓公众号（那些代理的免费额度现在基本没了），
   现在在有外壳时走 `window.toolbox.invoke('fetchArticle')` 交给主进程；
   单独用浏览器打开则退回原来的代理链，仍可独立调试。

拆文件时用的是一次性迁移脚本（跑完就删了，没留在仓库里），所以**现在的这些文件就是源码本身**，
直接改即可，不存在「从别处生成」这一步。三个当时的定点改造脚本（打补丁、装宿主桥、去 logo）
也随之删除 —— 它们操作的「单文件原版」已经不存在了。

几个跨文件的约定，改代码时留意：

- `core.js` 定义 `window.GZH`，其余模块 `var 同名 = GZH.同名` 取用；加载顺序在 `index.html` 里。
- 每个模块只在**文件开头几行**依赖外部，往下都是自洽的 —— 想知道谁依赖谁，看开头就行。
- `js/prompts.js` 只管文案；`js/ai.js` 只管流程。调提示词不用翻 ai 的逻辑。

## 已知限制

- **反爬看 IP**：家宽/办公网带正常 UA 一般没问题；机房里跑容易被丢验证页，此时会在弹框里
  提示「微信返回了反爬验证页」。这类情况需要换网络，或自己在
  `src/tools/gzh-studio/main.js` 的 `USER_AGENT` 里换成你账号的 Cookie 方案。
- **登录后才可见的文章**抓不到（需要 Cookie，当前没做）。
- 抓到的 Markdown 是**结构还原**，不是像素级还原：微信自己的编辑器会把排版压成大量
  `<section>`，标题层级只能按 `h1-h6` 判断；很多号的「小标题」其实是加粗正文，会保留成
  `**加粗**` 而不是 `##`。这是有意为之 —— 不乱猜结构。
- 图标重新生成需要 `Pillow`（`python -m pip install pillow`）。产物已入库，日常构建不用重跑。

---

## 许可

`renderer/tools/gzh-studio/index.html` 内联了
[gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) 与
[wechat-motion-layout-studio](https://github.com/lanmengSakura/wechat-motion-layout-studio)
的代码，两者都是 **AGPL-3.0**，所以本工程同样是 AGPL-3.0。

⚠️ **对外分发前请补上完整的 AGPL-3.0 许可证全文**（本仓库没有附带 —— 我没有替你决定
版权归属和署名格式）。AGPL 是传染性协议：你打包发给别人（含内网分发）时，对方有权拿到
完整源码。自行使用不受影响。

第三方组件：

| 组件 | 许可 |
| --- | --- |
| marked v12.0.2 | MIT |
| html2canvas 1.4.1 | MIT |
| Electron / Chromium / Node | MIT / BSD-style |

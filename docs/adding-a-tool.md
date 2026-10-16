# 加一个工具

一个工具由两部分组成，**每部分都有自己的家**：

| 部分 | 放哪 | 打包 | 什么时候需要 |
| --- | --- | --- | --- |
| 界面 | `renderer/tools/<id>/` | ✅ | 必须有 |
| 主进程侧 | `src/tools/<id>/main.js` | ✅ | 只有需要 Node 能力（发请求、读写文件…）时才要 |
| 开发脚本 | `tools/<id>/` | ❌ | 可选，比如「从旧页面生成这个工具」的补丁脚本 |

三个地方同名（都叫 `<id>`），一眼能对上。分开放是因为它们运行在不同的进程里，
混在一起反而看不清谁是谁。

> **一条须知：`renderer/` 和 `src/` 是运行时目录。**
> `package.json` 的 `files` 把 `src/**`、`renderer/**` 整个打进 `app.asar`，
> 所以这两个目录里只该放**应用跑起来真正需要**的文件。文档、模板、示例放 `docs/`，
> 开发脚本放 `tools/`。放错地方会白白跟着安装包发给每个用户（这个坑踩过一次）。

---

## 三步

### 1. 建界面目录

复制 `docs/new-tool-template/` 到 `renderer/tools/<id>/`：

```
renderer/tools/image-tools/
  index.html          ← 工具界面（可以是多文件，随便引自己的 css/js）
  ...                 你自己的子目录、素材、第三方库
```

### 2. 注册

在 `renderer/tools/registry.js` 的数组里加一条：

```js
{
  id: 'image-tools',                        // 唯一，也是 URL hash
  name: '图片处理',                          // 导航栏文字
  desc: '压缩 / 裁剪 / 转格式',               // 悬停提示
  entry: 'tools/image-tools/index.html',     // 相对 renderer/
  group: '素材处理',                          // 导航栏分组标题
  icon: '<svg …></svg>',                    // 可选，内联 SVG；不写就用首字
  badge: '新'                                // 可选角标
}
```

`group` 相同的工具自动排在一起。第二个组出现时导航栏会自动多一个分组标题 —— 这就是「分包」。

### 3. 打包

```bash
npm run dist
```

不用改 `main.js`、不用改 `package.json`：`src/**` 和 `renderer/**` 本来就在打包范围内。

---

## 隔离是怎么做的

每个工具跑在独立 iframe 里，所以：

- **JS 全局变量互不可见**。公众号排版定义了 `window.Md2GZHConverter`、`marked` 等全局；
  你新工具里再定义一个同名的不冲突，甚至可以用不同版本的同一个库。
- **CSS 不会互相污染**。没有 `!important` 满天飞的继承问题，也不用加前缀命名空间。
- **一个工具崩了不会带走另一个**（各自的 realm 独立）。

代价：iframe 拿不到 preload，主进程能力得由外壳转发。

---

## 需要主进程能力时

在 `src/tools/<id>/main.js` 写一个模块，导出 `{ id, setup?, methods? }`：

```js
// src/tools/image-tools/main.js
const { fetchPage } = require('../../shell/http');

module.exports = {
  id: 'image-tools',                     // 必须和 renderer 侧的 id 一致

  /* 可选：应用启动时跑一次，拿到 electron 的 session / app */
  setup({ session }) { /* 注册 webRequest 规则、协议处理… */ },

  methods: {
    /* 方法名随便起，参数和返回值都走结构化克隆（只放能序列化的东西） */
    async download({ url, headers }) {
      const page = await fetchPage(url, { headers });
      return { bytes: page.body.length };
    }
  }
};
```

界面这边通过外壳桥调用它：

```js
const response = await window.toolbox.invoke('download', { url, headers });
if (!response.ok) throw new Error(response.error);
console.log(response.result.bytes);
```

**方法抛出的异常会被主进程转成 `{ ok:false, error }`**，不用自己 try/catch 再包一层。

### 外壳桥（`window.toolbox`）

| 成员 | 说明 |
| --- | --- |
| `invoke(method, payload)` | 调**本工具**的主进程模块。工具身份由外壳按「消息来自哪个 iframe」填，工具自己无法冒充别的工具 |
| `store` | 统一配置库，所有工具共用（见下） |
| `onToast(fn)` | 主进程存完文件后的提示 |
| `info()` | 仅有外壳页面；工具页拿不到 |

**它只在被外壳用 iframe 装起来时存在。** 工具页被单独用浏览器打开（调试时最常用）
或直接开这个 html 时是 `undefined`，所以务必写降级分支：

```js
if (window.toolbox) {
  // 外壳里：走主进程
} else {
  // 独立打开：走你自己的兜底（fetch、提示用户手动粘贴…）
}
```

这样每个工具永远保持「单独打开能调试」，公众号排版现在就是这么做的。

### 配置存哪：用统一配置库

**别用 localStorage 存配置。** 用 `window.toolbox.store` —— 它落到
`~/.toolbox/toolbox.db`（SQLite），跨工具共享、能备份、卸载时会被问要不要一起删：

```js
const r = await window.toolbox.store.get('my-tool.settings');
if (r.ok && r.result) applySettings(r.result);

await window.toolbox.store.set('my-tool.settings', { theme: 'dark' });
await window.toolbox.store.remove('my-tool.settings');
const everything = await window.toolbox.store.all();     // { key: value }
```

所有方法都 resolve 成 `{ ok: true, result }` 或 `{ ok: false, error }`，**不会 reject**。
值是任意可 JSON 序列化的东西。

**键名怎么起**：跨工具共享的用通用前缀，只有自己用的加工具前缀。

| 键 | 归谁 |
| --- | --- |
| `ai.models` | 大模型配置 —— 通用，谁都能读（公众号排版已经在用） |
| `author.name` | 用户署名 / 显示名 —— 通用（公众号排版的「署名配置」在用） |
| `gzh-studio.xxx` | 公众号排版自己的 |
| `image-tools.xxx` | 图片处理自己的 |

新写一个通用配置前，先扫一眼上面这两个键，别再造一个同义的了。

公众号排版在浏览器里单独打开时，`GZH.store` 会自动降级成 localStorage 实现，所以工具
照样能跑 —— 但你写的代码只认 `store` 这一套接口就行，降级是框架的事。

---

## 通用能力放哪

**不要**在 `src/main.js` 里加业务逻辑 —— 那里只做「平台」的事（开窗、快捷键、装配），
它不认识任何具体工具。

要加通用的主进程能力，放 `src/shell/`：

| 文件 | 职责 |
| --- | --- |
| `paths.js` | 用户数据目录（`~/.toolbox`）—— 所有要留存的东西都往这放 |
| `store.js` | 统一配置库（SQLite），工具通过 `window.toolbox.store` 用 |
| `logger.js` | 文件日志 + 全局错误钩子 |
| `http.js` | 通用 HTTP GET：重定向、超时、解压、网络错误翻译成人话。**不含任何业务策略** |
| `downloads.js` | 下载落盘交系统保存对话框 |
| `tool-modules.js` | 发现并加载 `src/tools/*/main.js` |

唯一的例外是 `src/main.js` 里那条通用 IPC `tool:invoke` —— 它是所有工具共用的入口，
本身不含任何工具知识。

**不要**给 `webPreferences` 打开 `nodeIntegrationInSubFrames` —— 那会让 preload
注入到**每一个** iframe，包括公众号排版里渲染文章 HTML 的那个预览 iframe。
预览内容是从网上抓回来的，不该拿到一个「任意发请求」的口子。
外壳作为唯一出口，顺便也是将来按工具授权的天然管控点。

---

## 工具载体不会被销毁

切换工具只是切 `hidden`，iframe 一直活着 —— 公众号排版里的文章不会因为点了别的
工具就没了。想给工具加「离开前保存」之类的钩子，可以监听外壳发来的消息
（在 `shell.js` 的 `activate()` 里加一个 postMessage 即可）。

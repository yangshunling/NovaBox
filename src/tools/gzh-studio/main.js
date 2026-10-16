'use strict';

/**
 * 公众号排版的**主进程侧**。
 *
 * 为什么公众号的网络逻辑不放在 renderer/tools/gzh-studio/：
 *   CORS 是 Chromium 渲染进程的策略，抓 mp.weixin.qq.com 必须走主进程。
 *   所以工具可以有一个 src/tools/<id>/main.js，放它在主进程这边要做的事。
 *
 * 这里只放**公众号特有的策略**（伪装 UA、防盗链 Referer、判断拿没拿到正文），
 * 通用能力（HTTP、下载对话框、日志）在 src/shell/ 下，和具体工具无关。
 *
 * 约定：导出 { id, setup?, methods? }，由 src/shell/tool-modules.js 发现，
 *       src/main.js 挂到通用 IPC 上 —— 主进程不需要知道任何具体工具的存在。
 */

const { fetchPage } = require('../../shell/http');
const logger = require('../../shell/logger');

const SITE = 'https://mp.weixin.qq.com/';

/* 带微信内置浏览器的 UA：公众号对陌生 UA 容易直接丢验证页 */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0.0.0 Safari/537.36 MicroMessenger/8.0.50(0x28003032) WeChat/3.9.12';

/**
 * 拿到的东西像不像一篇文章 —— 判定顺序很重要，踩过的坑：
 *
 *   微信的「参数错误 / 内容已删除 / 环境异常」页**自带完整页面外壳，原始 HTML 就有 31 KB**，
 *   所以「页面短于 N KB 才去查特征串」这种写法会让它们从门槛上溜过去，被当成正文返回，
 *   最后在上层报出一个误导性的「内容为空，可能是反爬验证页」。
 *
 * 实测（同一时刻抓的）：
 *   真实文章      3,512,656 字符 → 可见文字 2,199 → 有 #js_content
 *   「参数错误」页    31,647 字符 → 可见文字    51 → 没有 #js_content
 *   普通网页(MDN)   259,210 字符 → 可见文字 31,963 → 没有 #js_content
 *
 * 所以：先看公众号正文容器，再认已知错误页，最后才用整页可见文字量兜底（给普通网页用）。
 */
const MIN_CONTENT_CHARS = 80;    /* #js_content 里有这么多字就算拿到正文了 */
const MIN_VISIBLE_CHARS = 200;   /* 整页可见文字这么多，当普通网页放行 */

/* 认出来就给一句人话；这些页面都没有 #js_content，所以一定会走到这里 */
const BLOCK_PAGES = [
  { pattern: /参数错误|无法打开该页面/, message: '链接参数不完整 —— 请用公众号里的「复制链接」重新取一次完整地址' },
  { pattern: /环境异常|去验证|访问过于频繁|请完成验证/, message: '微信返回了验证页，稍后再试；一直这样的话换手机热点／家用网络' },
  { pattern: /该内容已被发布者删除|此内容因违规无法查看|该公众号已迁移|内容已被删除/, message: '文章不存在或已被删除' },
  { pattern: /请在微信客户端打开|请在微信中打开/, message: '这篇需要在微信客户端里打开，取不到网页版正文' },
  { pattern: /该链接已过期|链接已失效/, message: '链接已过期，请重新取一次' }
];

/* 去掉脚本/样式/标签/实体后的可见文字 */
function visibleText(html) {
  return String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, '');
}

function visibleLength(html) {
  return visibleText(html).length;
}

/* 公众号正文容器里的文字；不确定边界就取一段——够判断「有没有正文」了 */
function contentLength(html) {
  const at = String(html).indexOf('id="js_content"');
  if (at === -1) return 0;
  return visibleText(String(html).slice(at, at + 300000)).length;
}

/* 页面摘出来的前几十个字，放进错误里当证据 */
function textPreview(html, limit) {
  const text = String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, limit || 80);
}

/**
 * 拿到的东西像不像一篇文章？
 * @returns {string} 空串表示通过；否则是人话错误说明
 */
function inspectPage(html) {
  /* 1. 有公众号正文容器 → 就是文章。
        这一步放在特征串前面，是为了避免正文里正好提到「环境异常」之类被误杀 */
  const content = contentLength(html);
  if (content >= MIN_CONTENT_CHARS) return '';

  /* 2. 认已知的错误页，给出具体原因 */
  for (const page of BLOCK_PAGES) {
    if (page.pattern.test(html)) return page.message;
  }

  /* 3. 没有正文容器但可见文字够多 → 当普通网页放行 */
  const visible = visibleLength(html);
  if (visible >= MIN_VISIBLE_CHARS) return '';

  /* 4. 都不是：把证据摆出来，别再让用户猜「是不是被反爬了」 */
  const size = (html.length / 1024).toFixed(0);
  const preview = textPreview(html);
  return '这个地址没拿到正文：页面 ' + size + ' KB，可见文字只有 ' + visible + ' 字'
    + (preview ? '，内容是「' + preview + '…」' : '')
    + '。如果这不是一篇文章页，换「复制链接」拿到的完整地址试试。';
}

module.exports = {
  id: 'gzh-studio',

  /**
   * 预览里的图片来自微信 CDN（mmbiz.qpic.cn），它会校验 Referer，
   * 不补上公众号域名就是一片碎图。
   */
  setup({ session }) {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.qpic.cn/*'] },
      (details, callback) => {
        details.requestHeaders.Referer = SITE;
        callback({ requestHeaders: details.requestHeaders });
      }
    );
  },

  methods: {
    /** 抓一篇公众号文章（或任意网页）的正文 HTML */
    async fetchArticle({ url }) {
      const started = Date.now();
      const page = await fetchPage(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: SITE }
      });
      const visible = visibleLength(page.body);

      const blocked = inspectPage(page.body);
      if (blocked) {
        logger.warn('gzh-studio', '没拿到正文 ' + page.finalUrl + ' → ' + blocked);
        throw new Error(blocked);
      }

      logger.info('gzh-studio', '抓取成功 ' + page.finalUrl + '  '
        + (page.body.length / 1024).toFixed(0) + ' KB / 可见文字 ' + visible + ' 字  '
        + (Date.now() - started) + 'ms');

      return { body: page.body, finalUrl: page.finalUrl };
    }
  }
};

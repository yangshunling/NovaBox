'use strict';

/**
 * 通用 HTTP 抓取：GET、跟随重定向、超时、gzip/deflate/br 解压、把网络错误翻译成人话。
 *
 * 这里**不含任何业务策略** —— 用什么 UA、带不带 Referer、返回的内容算不算有效，
 * 都是调用方（各工具的主进程模块）自己的事。工具要新的抓取语义时扩展这个文件，
 * 而不是各自再写一份。
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

function normalizeUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) throw new Error('链接为空');
  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw new Error('链接格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http/https 链接');
  }
  return parsed;
}

function decodeBody(buffer, contentEncoding) {
  const name = String(contentEncoding || '').toLowerCase().trim();
  if (name === 'gzip' || name === 'x-gzip') return zlib.gunzipSync(buffer);
  if (name === 'deflate') return zlib.inflateSync(buffer);
  if (name === 'br') return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function readBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        resolve(decodeBody(raw, response.headers['content-encoding']).toString('utf8'));
      } catch (error) {
        reject(new Error('响应解压失败：' + error.message));
      }
    });
    response.on('error', reject);
  });
}

function describeNetworkError(error) {
  const code = error && error.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败，检查网络或链接是否写错';
  if (code === 'ECONNREFUSED') return '连接被拒绝';
  if (code === 'ETIMEDOUT') return '连接超时';
  if (/certificate|self signed/i.test(String(error && error.message))) return 'HTTPS 证书校验失败';
  return error && error.message ? error.message : '网络请求失败';
}

function requestOnce(target, headers, timeout) {
  return new Promise((resolve, reject) => {
    const client = target.protocol === 'http:' ? http : https;
    const request = client.get(target, { headers }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ redirect: new URL(response.headers.location, target).href });
        return;
      }
      readBody(response).then(
        (body) => resolve({ status, body }),
        reject
      );
    });

    request.setTimeout(timeout, () => request.destroy(new Error('请求超时')));
    request.on('error', (error) => reject(new Error(describeNetworkError(error))));
  });
}

/**
 * 抓一个 URL 的文本内容。
 *
 * @param {string} rawUrl
 * @param {{
 *   headers?: Record<string,string>,   // 调用方自己决定 UA / Referer / Cookie…
 *   timeout?: number
 * }} [options]
 * @returns {Promise<{body: string, finalUrl: string, status: number}>}
 */
async function fetchPage(rawUrl, options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT_MS;
  const headers = Object.assign({
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache'
  }, options.headers || {});

  let target = normalizeUrl(rawUrl);
  const requestHeaders = Object.assign({}, headers);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(target, requestHeaders, timeout);

    if (result.redirect) {
      /* 和浏览器一致：跳转一次，Referer 就变成刚才那一跳的地址 */
      requestHeaders.Referer = target.href;
      target = new URL(result.redirect);
      continue;
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error('服务器返回 HTTP ' + result.status);
    }

    return { body: result.body, finalUrl: target.href, status: result.status };
  }

  throw new Error('重定向次数过多，已放弃');
}

module.exports = { fetchPage, normalizeUrl, describeNetworkError };

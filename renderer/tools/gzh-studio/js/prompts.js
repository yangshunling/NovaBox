/* 提示词模板：发给大模型的文案，和调用逻辑分开放，改措辞不用翻 ai.js。

   只有 optimizePrompt 依赖示例文章（GZH.SAMPLE_MD），拿它当「结构样板」。
 */

window.GZH.prompts = (function (GZH) {
  'use strict';

  var SAMPLE_MD = GZH.SAMPLE_MD;

    var PING_MESSAGE = '你好，请只回复两个字：正常';

    /* 模板样例去掉结尾的署名段：那是示例作者的落款，发给模型容易被照抄到用户文章末尾 */
    function templateSample() {
      var lines = SAMPLE_MD.split('\n');
      var last = lines.length - 1;
      while (last >= 0 && !lines[last].trim()) last--;
      if (last >= 0 && /^\s*我是\s*\S/.test(lines[last])) lines.splice(last, 1);
      return lines.join('\n').trim();
    }

    /* 发给大模型的提示词：少改内容 + 按「载入示例」的模板重排 */
    function optimizePrompt(content) {
      return [
        '你是一位资深的微信公众号排版编辑。下面给你一份「模板样例」和一篇「用户原文」，请把用户原文重新排成与模板样例一致的 Markdown 结构。',
        '',
        '【硬性要求】',
        '1. 内容尽可能少改：不新增信息、不删减信息、不改写句子含义、不改变原文观点与语气；数字、专有名词、链接、图片、代码、表格一律原样保留。',
        '2. 只做结构与版式层面的优化：按模板样例的层级给标题分级（# / ## / ###）、拆分过长的段落、补全段落之间的空行、把并列内容整理成列表、把要点提炼为引用或关键词强调。',
        '3. 可以使用模板样例中出现过的全部 Markdown 语法：> 引用、**关键词强调**、==荧光高亮==、++下划线++、~~删除~~、`行内代码`、图片 ![说明](地址)、无序与有序列表、--- 分隔线、代码块、表格。',
        '4. 不要照抄模板样例里的任何具体文字，只借用它的结构、层级与语法风格；也不要给文章新增署名、落款或结尾语，原文没有的内容一律不要自己补。',
        '5. 标题只依据原文语义分级，不要凭空增加原文没有的章节。',
        '',
        '【输出要求】',
        '只输出重新排版后的 Markdown 正文本身。不要任何解释、说明、开场白或结束语，也不要用 ``` 把整篇文章包起来。',
        '',
        '===== 模板样例（来自「载入示例」，仅用于对齐结构与语法）=====',
        templateSample(),
        '===== 模板样例结束 =====',
        '',
        '===== 用户原文（内容尽可能少改）=====',
        content,
        '===== 用户原文结束 =====',
        '',
        '现在请直接输出重新排版后的 Markdown：'
      ].join('\n');
    }
  return {
    PING_MESSAGE: PING_MESSAGE,
    templateSample: templateSample,
    optimizePrompt: optimizePrompt
  };
})(window.GZH);

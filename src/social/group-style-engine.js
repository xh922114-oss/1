// 群风格统计引擎 —— 从 QQAgent（MIT，作者 Kondius）`plugins/adaptive-group-style/style-engine.js`
// 原样移植（算法与阈值未改，只加本段说明）。迁移判定见 docs/guides/QQAGENT_MIGRATION.md「合并组 G1」。
//
// 为什么能原样搬：这个文件**不 import 任何宿主模块**（纯函数 + 只用标准 JS），
// 输入输出都是普通对象 —— 换一个宿主只是换喂进来的数据形状，适配层见 ./group-style.js。
//
// 它在原项目里的位置：确定性型插件（providers/hooks），每轮发言前必然把学到的风格放进提示词；
// 搬到 dsh-qq 后同样是"必然执行"——由桥接在拼每轮提示词时注入，不交给模型自己决定要不要参考。
//
// 上游文件头保留在下面（它写清了三条设计约束，改动前请先读）：
//
// 纯统计层：从聊天记录里算出「这个群怎么说话」。
//
// 设计上的三条硬约束（都是踩过的坑换来的）：
//   1. 这个文件**不 import 任何宿主模块**（没有 fs / path / config）——
//      宿主升级挪动文件时，顶层 import 抛错会让整个插件变成"加载失败"（变砖）。
//      纯函数 + 只用标准 JS，注入进来的数据也全是普通对象。
//   2. 只用 `Intl.Segmenter` 的**标准枚举值**（granularity: 'word'）与布尔值选项，
//      不依赖任何版本特有的参数；取不到就退回"按标点断句 + 2~4 字片段"的朴素统计。
//      取不到分词器不是错误，只是精度低一点。
//   3. 学出来的东西一律是**统计口径**（多长、爱用什么标点、几条一发），
//      绝不把群友的原话当成"应该照念的模板"输出 —— 那样等于把机器人变回复读机，
//      正是本插件要解决的问题。

/** 判断"机器人现在像不像群里人"时，看它最近多少条发言（再往前的不代表现状）。 */
const SELF_WINDOW = 24;

/** 常用虚词/寒暄，它们高频但**不携带任何风格信息**，统计口头语时必须剔除。 */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '我们', '你们', '他们',
  '这', '那', '这个', '那个', '这些', '那些', '什么', '怎么', '为什么', '还是', '但是',
  '然后', '而且', '因为', '所以', '如果', '可以', '不能', '没有', '不是', '就是',
  '一个', '一下', '一点', '不过', '已经', '现在', '时候', '知道', '觉得', '应该',
  '可能', '真的', '有点', '还有', '只是', '这样', '那样', '一样', '起来', '出来',
  '不会', '不要', '不用', '好像', '怎么', '多少', '哪个', '哪里', '干嘛', '干什么'
]);

/**
 * 判断一个片段是不是"值得记下来的口头语"（滤掉虚词、纯数字、纯标点）。
 * @param {number} minChars 最短长度（1 = 允许单字语气词）
 * @param {number} maxChars 最长长度
 */
function isInteresting(token, minChars = 2, maxChars = 8, stopwords = STOPWORDS) {
  const t = String(token || '').trim();
  if (!t || t.length < minChars || t.length > maxChars) return false;
  if (stopwords.has(t)) return false;
  if (/^[\d\s.．。!！?？,，、~～…·\-—+*/\\|@#%^&()[\]{}<>:;'"`]+$/.test(t)) return false; // 纯数字/标点
  if (/\d{5,}/.test(t)) return false;                                                        // 群号、QQ 号
  if (/^[a-zA-Z]{1,3}$/.test(t)) return false;                                               // 零碎英文
  return true;
}

/** 连续重复字符压成一个：让「哈哈哈哈哈」和「哈哈」归到同一类。 */
function squeeze(s) {
  return String(s || '').replace(/(.)\1{2,}/g, '$1');
}

/** 安全取整。 */
function toInt(v, dflt) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : dflt;
}

/**
 * 去掉媒体/事件占位符、@ 片段与引用块，只留真正打出来的字。
 *
 * ⚠️ 引用块必须整块剥掉，不能只去方括号（实测踩到的坑）：
 *   一行引用消息在存档里长这样——
 *     `[引用 ?!哦鲸鲸!?(QQ:3084260945)：[image]]这波是青年漫发力了`
 *   只把 `[image]` 换成空格之后，剩下的 `[引用 ?!哦鲸鲸!?...]` 里
 *   「引用」这个词会以高文档频率混进"全群常用口头语"，最后教机器人学说「引用」。
 *   剥法是按**括号深度**找配对的那个 `]`（引用块里可以嵌 [图片]/[at] 之类的占位符，
 *   用非贪婪正则会在内层括号上提前收尾），再连同后面的空白一起删掉。
 */
function cleanText(text) {
  let s = String(text == null ? '' : text);
  // CQ 码
  s = s.replace(/\[CQ:[^\]]*\]/g, ' ');
  // 引用块：按括号深度配对剥除（含嵌套占位符）
  for (let guard = 0; guard < 6; guard += 1) {
    const start = s.indexOf('[引用');
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < s.length; i += 1) {
      if (s[i] === '[') depth += 1;
      else if (s[i] === ']') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) { s = s.slice(0, start); break; }   // 没配对就保守地只保留引用块之前的内容
    s = `${s.slice(0, start)} ${s.slice(end + 1)}`;
  }
  // 其余方括号占位符：[图片] [表情] [语音] [视频] [文件] [拍一拍] [合并转发 共2条]…
  s = s.replace(/\[[^\]]{0,20}\]/g, ' ');
  // @ 片段（含 speaker-identity 渲染出的 `@昵称(QQ:xxx)` 形态）
  s = s.replace(/@\S{1,24}(?:\(QQ:\d+\))?/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ───────────────────────────── 分词 ─────────────────────────────

let segmenter = null;
let segmenterTried = false;

/** 懒加载分词器：拿不到就返回 null（调用方走朴素的 fallback）。 */
function getSegmenter() {
  if (segmenterTried) return segmenter;
  segmenterTried = true;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
    }
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/**
 * 从一段文本里取"词"。
 * 分词器可用就用它；不可用就按标点切成片段 —— 只作为最后的兜底。
 */
function words(text) {
  const seg = getSegmenter();
  const out = [];
  if (seg) {
    try {
      for (const piece of seg.segment(text)) {
        if (piece && piece.isWordLike && piece.segment) out.push(String(piece.segment));
      }
      return out;
    } catch { /* 落到下面的兜底 */ }
  }
  for (const chunk of String(text).split(/[\s，。！？、；：""''（）()~～…·,.!?;:]+/)) {
    if (chunk) out.push(chunk);
  }
  return out;
}

/** 取 2 字片段（对中文口头语很有用：群友 → 群友/友都 这种）。 */
function catchPhrases(text) {
  const out = [];
  for (const chunk of String(text).split(/[\s，。！？、；：""''（）()~～…·,.!?;:]+/)) {
    if (chunk.length < 2) continue;
    if (chunk.length <= 4) { out.push(chunk); continue; }
    for (let i = 0; i + 2 <= chunk.length; i += 1) out.push(chunk.slice(i, i + 2));
  }
  return out;
}

// ───────────────────────────── 标点与节奏 ─────────────────────────────

/**
 * 统计标点习惯。分母统一用**有效文本消息数**，这样每个比值都读作
 * "多少比例的群友消息里出现了它"。
 *
 * ⚠️ 必须传**清洗过**的文本（调用方负责）。原始存档里的 `[图片]` `[引用 …]`
 *    `[合并转发 共2条]` 自带方括号、纯媒体消息则一个字都没有 ——
 *    拿原文统计会把"这个人只发了张图"算成"他句末不带标点"，
 *    把一个 88% 的结论吹到 94%（实测真的会这样，而且越活跃的群偏得越多）。
 */
function punctuationStats(texts, humanTotal) {
  const denom = Math.max(1, humanTotal);
  let noEnd = 0;      // 整句没有任何收尾标点（= 说话不带句号）
  let dot = 0;
  let q = 0;
  let ex = 0;
  let tilde = 0;
  let ellipsis = 0;
  let comma = 0;
  let laugh = 0;
  let repeatChar = 0; // 叠字拉长（哈哈哈哈 / 急急急）
  let emoji = 0;
  let bracketTag = 0; // 形如（笑）（doge）这种括号注释

  for (const raw of texts) {
    const t = String(raw || '');
    if (!/[。！？…~～!?.]/.test(t)) noEnd += 1;
    if (/[。]/.test(t)) dot += 1;
    if (/[?？]/.test(t)) q += 1;
    if (/[!！]/.test(t)) ex += 1;
    if (/[~～]/.test(t)) tilde += 1;
    if (/…|\.{3,}/.test(t)) ellipsis += 1;
    if (/[，,]/.test(t)) comma += 1;
    if (/[哈哼嘿嘻呵]{2,}|[草靠卧我日]{2,}/.test(t)) laugh += 1;
    if (/(.)\1{2,}/.test(t)) repeatChar += 1;
    // 只认零星点缀的 emoji：避免把整串表情刷屏算成"语言习惯"
    if (hasEmoji(t)) emoji += 1;
    if (/[（(][^）)]{1,6}[）)]/.test(t)) bracketTag += 1;
  }

  const r = (n) => n / denom;
  const pct = (n) => Math.round(r(n) * 100);
  return {
    noEndPct: pct(noEnd),
    dotPct: pct(dot),
    qPct: pct(q),
    exPct: pct(ex),
    tildePct: pct(tilde),
    ellipsisPct: pct(ellipsis),
    commaPct: pct(comma),
    laughPct: pct(laugh),
    repeatPct: pct(repeatChar),
    emojiPct: pct(emoji),
    bracketPct: pct(bracketTag)
  };
}

/**
 * 有没有"零星 emoji"。
 * 用码点区间判断而不是正则字符类 —— `\p{Emoji}` 这类属性转义在个别运行环境里
 * 会直接抛 SyntaxError，一旦顶层抛错整个插件就加载失败了，不值得为它冒险。
 */
function hasEmoji(text) {
  const s = String(text || '');
  let count = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const isEmoji = (cp >= 0x1F300 && cp <= 0x1FAFF)
      || (cp >= 0x2600 && cp <= 0x27BF)
      || (cp >= 0x1F000 && cp <= 0x1F2FF)
      || cp === 0x2764 || cp === 0x203C || cp === 0x2049;
    if (isEmoji) {
      count += 1;
      if (count > 3) return false;   // 超过 3 个 = 刷屏，不算语言习惯
    }
  }
  return count > 0;
}

/** 空行/纯符号太短的消息算"无实义"，不计入句长统计。 */
function isMeaningful(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  if (s.length <= 1) return false;
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(s);
}

/**
 * 句长与分条节奏。
 *
 * 「分条」只在**同一人 45 秒内连着发的相邻消息**之间合并计数 ——
 * 不用"固定窗口里的消息数"糊弄：群里十个人同时说话时，那个数字量的是
 * "群有多热闹"，不是"一个人习惯发几条"，学出来的节奏会是错的。
 */
function rhythmStats(rows) {
  const lens = [];
  for (const m of rows) {
    const t = String(m.text || '').trim();
    if (isMeaningful(t)) lens.push(t.length);
  }
  const n = lens.length;
  const mean = n ? lens.reduce((a, b) => a + b, 0) / n : 0;
  const sorted = [...lens].sort((a, b) => a - b);
  const quantile = (p) => (n ? sorted[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))] : 0);
  const median = quantile(0.5);

  let short = 0;      // ≤ 6 字
  let medium = 0;     // 7~15 字
  let long = 0;       // ≥ 16 字
  for (const L of lens) {
    if (L <= 6) short += 1;
    else if (L <= 15) medium += 1;
    else long += 1;
  }

  const human = rows.filter((m) => !m.self);
  let bursts = 0;          // 开口次数：一个人连着发的消息算一次
  let prev = null;         // 上一次开口的人 + 那条消息
  let lastTs = 0;
  for (const m of human) {
    const ts = Number(m.ts) || 0;
    const sameSpeaker = prev !== null && String(prev) === String(m.senderId || '')
      && ts >= lastTs && ts - lastTs <= 45_000;
    if (!sameSpeaker) bursts += 1;
    prev = m.senderId || '';
    lastTs = ts;
  }
  bursts = Math.max(1, bursts);

  return {
    n,
    meanChars: Math.round(mean * 10) / 10,
    medianChars: median,
    p90Chars: quantile(0.9),
    shortRatio: n ? Math.round((short / n) * 100) / 100 : 0,
    longRatio: n ? Math.round((long / n) * 100) / 100 : 0,
    bucketShort: short,
    bucketMedium: medium,
    bucketLong: long,
    perBurst: human.length ? Math.round((human.length / bursts) * 100) / 100 : 1,
    bursts
  };
}

// ───────────────────────────── 口头语 ─────────────────────────────

// 单字语气词白名单：中文的"语气/态度"信息几乎全落在这几个字上。
const SINGLE_SLANG = new Set([
  '草', '靠', '哈', '嘿', '呵', '嘻', '哼', '哎', '诶', '欸', '唉', '哦', '噢', '喔', '呜', '哇',
  '嘶', '咦', '嘁', '咳', '6', '乐', '典', '急', '孝', '麻', '汗', '笑', '哭', '喵', '汪', '嘤',
  '惹', '捏', '嘛', '呗', '哟', '喂', '操', '淦', '服', '绝'
]);

// 多字语气/态度词。放在正则里而不是 Set 里，是因为它们常紧跟在别的字后面
// （"我真服了""这波笑死"），需要按"词首匹配"来取。
const INTERJECTION_RE = /^(笑死|笑不活|破防|绷不住|麻了|无语|好家伙|逆天|抽象|离谱|难绷|绝了|寄了|摆了|润了|睡了|谢了|服了|牛|强|可以|彳亍|彳亍|啊这|这也|就这|确实|真实|合理|正确|支持|泪目|上头|下头|沉默|震惊|呆住|流汗|黄豆|doge)/i;

/**
 * 语气词/口头禅通道（**独立于高频词统计**）。
 *
 * 为什么不能跟"高频词"合用一条路（真踩到的坑）：
 *   中文里单字出现频率最高的永远是虚词（吗 / 给 / 了 / 是）。按"高频"取前几名，
 *   学出来的结论是「群里高频语气词：吗、给」—— 拿这个去教机器人，它只会更像机器。
 *   语气词的价值在于"它**本来就是**语气词"，所以这里靠白名单 + 叠字结构判定，
 *   频率只用于排序和过滤偶发。
 */
function slangStats(texts, { minDocCount = 2, minDocRatio = 0.008, limit = 5 } = {}) {
  const docs = new Map();
  const total = texts.length;
  if (!total) return [];
  for (const raw of texts) {
    const t = cleanText(raw);
    if (!t) continue;
    const seen = new Set();
    // ① 整条消息就是一个语气词（含叠字）：最纯粹的"这人在用语气词"
    const whole = squeeze(t.replace(/[\s。，、！？!?~～…·,.]/g, ''));
    if (whole && whole.length <= 6
      && (SINGLE_SLANG.has(whole) || isRepeatedSlang(whole) || INTERJECTION_RE.test(whole))) {
      seen.add(whole);
    }
    // ② 被标点/空格隔开的独立语气词，以及词首的叠字（哈哈哈哈 / 草草草）
    for (const piece of t.split(/[\s。，、；：！？!?~～…·,.]+/)) {
      if (!piece) continue;
      if (piece.length <= 4 && (SINGLE_SLANG.has(squeeze(piece)) || isRepeatedSlang(piece))) {
        seen.add(squeeze(piece));
        continue;
      }
      const head = /^([\u4e00-\u9fa5A-Za-z]{1,4})/.exec(piece);
      if (head && isRepeatedSlang(head[1])) seen.add(squeeze(head[1]));
      const m = INTERJECTION_RE.exec(piece.slice(0, 4));
      if (m) seen.add(m[0]);
    }
    for (const tok of seen) docs.set(tok, (docs.get(tok) || 0) + 1);
  }
  const minCount = Math.max(minDocCount, Math.ceil(total * minDocRatio));
  return [...docs.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([token, count]) => ({ token, ratio: Math.round((count / total) * 100) / 100, kind: 'slang' }));
}

/** 叠字语气词：哈哈 / 草草 / 急急急 / 好好好（同一个字重复 ≥2 次）。 */
function isRepeatedSlang(token) {
  const t = String(token || '');
  if (t.length < 2) return false;
  const m = /^(\S)\1+$/.exec(t);
  return Boolean(m && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(m[1]));
}

/**
 * 高频口头语/语气词。
 *
 * 口径是「出现在多少条**不同**消息里」（文档频率），不是出现总次数 ——
 * 否则一个人连刷 20 遍同一个词就能把它顶成"全群习惯"。
 *
 * ⚠️ 单字片段必须单独开一条通道（minTokenChars = 1）：
 *    真实群聊里最常见的"口头语"其实是单字 —— 草 / 哈 / 6 / ？。
 *    早期实现统一下限 2 个字，结果在一个 400 条样本的活跃群里**一个词都没学出来**
 *    （只有"评价""https"这种偶尔冒出来的词能过阈值），"口头语提示"这项功能等于空转。
 *    单字只在语气通道里收，且门槛更高、数量更少（默认 5 个），
 *    免得"我""的"这类字混进来。
 *
 * @param {number} [minTokenChars=2] 允许的最短片段（1 = 连单字语气词也收）
 */
function tokenStats(texts, { minDocRatio = 0.04, minDocCount = 3, limit = 12, minTokenChars = 2, maxTokenChars = 8, exclude = null } = {}) {
  const docs = new Map();   // token -> 出现过的消息条数
  const total = texts.length;
  if (!total) return [];
  for (const raw of texts) {
    const t = cleanText(raw);
    if (!t) continue;
    const seen = new Set();
    // 分词与 2 字片段两条路都走，统一在下面按长度筛（catchPhrases 能补出
    // 分词器拿不到的中文组合，两者互补，不是二选一）
    for (const piece of [...words(t), ...catchPhrases(t)]) {
      const tok = squeeze(piece);
      if (exclude && exclude.has(tok)) continue;
      if (!isInteresting(tok, minTokenChars, maxTokenChars)) continue;
      if (tok.length === 2 && total > 60) continue;   // 长样本里 2 字片段太容易偶然命中
      seen.add(tok);
    }
    for (const tok of seen) docs.set(tok, (docs.get(tok) || 0) + 1);
  }

  const minCount = Math.max(minDocCount, Math.ceil(total * minDocRatio));
  return [...docs.entries()]
    .filter(([, c]) => c >= minCount)
    .map(([token, count]) => ({ token, count, ratio: Math.round((count / total) * 100) / 100 }))
    // 文档频率优先；同频率时**短词优先**（更口语）
    .sort((a, b) => b.count - a.count || a.token.length - b.token.length || a.token.localeCompare(b.token))
    .slice(0, limit)
    .map(({ token, ratio }) => ({ token, ratio }));
}

// ───────────────────────────── 机器人自己的表现 ─────────────────────────────

/**
 * 把机器人最近说过的话和群里的习惯比一比，找出**明确的**偏差。
 *
 * 只输出能一句话说清、且改起来没歧义的偏差（太长 / 太短 / 标点风格不对）。
 * 不放"感觉不够活泼"这种判断 —— 那需要理解语义，而本插件不调用模型。
 *
 * ⚠️ 样本口径（踩过的坑）：这里必须拿**最近的**发言（store 窗口尾部的那些），
 *    并且数量封顶。早期实现拿的是"存档里全部 self 消息"，一个 1400 条的群里
 *    混着机器人几天前的发言，算出来的平均值既不代表现在、也把"偏差"判断冲淡成
 *    "大体合拍，继续保持" —— 等于这段提醒白写。样本不足就什么都不说，宁可不说。
 */
function compareSelf(selfRows, group, { maxRows = 20, minRows = 3 } = {}) {
  const recent = (Array.isArray(selfRows) ? selfRows : []).slice(-maxRows);
  const texts = recent.map((m) => String(m.text || '').trim()).filter(Boolean);
  const lens = texts.filter(isMeaningful).map((t) => t.length);
  if (texts.length < minRows) return { n: texts.length, issues: [] };

  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const groupMean = Number(group?.meanChars) || 0;
  const groupMedian = Number(group?.medianChars) || 0;
  const issues = [];

  if (lens.length >= minRows && groupMean > 0) {
    if (mean > groupMean * 1.8 && mean > groupMean + 8) {
      issues.push(`你最近平均每条 ${Math.round(mean)} 字，群里平均只有 ${Math.round(groupMean)} 字 —— 偏长，说短一点。`);
    } else if (mean < groupMean * 0.45 && groupMean > 10) {
      issues.push(`你最近平均每条 ${Math.round(mean)} 字，群里平均 ${Math.round(groupMean)} 字 —— 偏短，像在敷衍，可以说完整点。`);
    } else if (groupMedian > 0 && mean > Math.max(groupMedian * 3, groupMedian + 15)) {
      issues.push(`群里多数消息只有 ${Math.round(groupMedian)} 字左右，你最近平均 ${Math.round(mean)} 字 —— 你这个偏长的那一头有点多，多拆成几条短的。`);
    }
  }

  const noEnd = Number(group?.punct?.noEndPct) || 0;
  const dotPct = Math.round((texts.filter((t) => /[。]/.test(t)).length / texts.length) * 100);
  if (noEnd >= 70 && dotPct >= 40) {
    issues.push('群里绝大多数消息句末不带句号，你却经常带 —— 这是最像"机器在说话"的地方，去掉。');
  } else if (noEnd <= 30 && Number(group?.punct?.dotPct) >= 45 && dotPct <= 15) {
    issues.push('这个群习惯句末带句号，你却几乎不带 —— 补上会更像群里的人。');
  }

  const selfEmoji = Math.round((texts.filter((t) => hasEmoji(t)).length / texts.length) * 100);
  if (Number(group?.emojiPct) >= 25 && selfEmoji === 0) {
    issues.push('群里常用 emoji 点缀，你一个都没用过 —— 偶尔加一个。');
  }

  const all = texts.join('\n');
  if (/抱歉|不好意思|很高兴为您|请问有什么/.test(all)) {
    issues.push('你最近说过"抱歉/很高兴为您"这类客服腔 —— 群里没人这么说话，换成更随意的说法。');
  }

  return { n: texts.length, meanChars: Math.round(mean * 10) / 10, issues: issues.slice(0, 3) };
}

// ───────────────────────────── 语气进攻性（v1.1 夜间复盘用） ─────────────────────────────

/**
 * 贬低/攻击性用词。匹配到就算"硬冲"，不需要任何理解 —— 这是纯字面检测。
 * 刻意**不含**"卧槽/草/服了"这类群友日常语气词：那不是攻击，是口头禅，
 * 误报会把机器人学来的群味儿当成"进攻性"给修掉（本末倒置）。
 */
const AGGRESSIVE_RE = /(废物|垃圾|蠢[货死了]?|笨蛋|滚吧|滚蛋|滚远点|闭嘴|傻[逼bBxX×]|智障|脑残|弱智|白痴|恶[心]?心死|去死|有病|有什么病|妈的|你妈|看不下去了|就你这样|你也配|谁惯着你|没人要|没人权|低能|下头|恶心玩意)/;

/**
 * 顶人/压人句式：不带脏字但火药味明显的（反问连击、找茬式接话）。
 * 必须带立场词，避免把"？？？"(困惑) 和"真的？"(惊讶) 误判成攻击。
 */
const PUSHY_RE = /(就这[?？]?|急了[?？]?|破防了[?？]|绷不住了吧|你行你上|差不多得了|听不懂人话|再说一遍[?？]|要不要脸|听得懂吗|会说话吗|建议你|笑而不语|懒得理你[了]?)/;

/** 精简版截断（style-engine 不依赖 index.js 的 clip，本地实现一份）。 */
function clipText(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 扫机器人自己说过的话里有多少"进攻性"发言。
 *
 * 为什么放统计层而不是让夜间 LLM 自己数：LLM 数数不可靠（尤其"没有"这种否定结论
 * 它经常顺口就写），而这里的结论要作为硬事实写进提示词（"昨晚你有 4 条在顶人"），
 * 数字必须可复现。LLM 只负责在事实之上给"怎么改"。
 *
 * @returns {{n: number, hits: number, ratio: number, examples: string[], level: 'low'|'some'|'high', hard: number}}
 */
export function scanAggression(texts = []) {
  const list = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  const n = list.length;
  const hits = [];
  const examples = [];
  let hard = 0;
  for (const t of list) {
    const isHard = AGGRESSIVE_RE.test(t);
    const isPushy = !isHard && PUSHY_RE.test(t);
    if (!isHard && !isPushy) continue;
    if (isHard) hard += 1;
    hits.push(t);
    if (examples.length < 3) examples.push(clipText(t, 24));
  }
  const ratio = n ? Math.round((hits.length / n) * 100) / 100 : 0;
  const level = hits.length >= 5 || hard >= 2 ? 'high' : hits.length >= 2 ? 'some' : 'low';
  return { n, hits: hits.length, hard, ratio, examples, level };
}

// ───────────────────────────── 热梗/流行词匹配（v1.1） ─────────────────────────────

/**
 * 从一条热榜条目里提取可拿来匹配的词。
 * 热榜标题常带标点和话题符（"#xx#"、"，一个月就被甩"），先剥干净；
 * 太短(<2字)会到处误匹配，太长(>24字)多半是整句标题不是一个"词"，都不收。
 */
export function trendKeywords(trend) {
  const raw = [trend?.key, trend?.title, trend?.word, trend?.keyword]
    .map((s) => String(s ?? ''))
    .filter(Boolean);
  const out = [];
  for (const s of raw) {
    const t = s.replace(/[#，。！？、；：""''（）()【】\s,.!?;:'"…·~～\-—_]/g, '');
    if (t.length >= 2 && t.length <= 24) out.push(t);
  }
  return [...new Set(out)];
}

/**
 * 今天群里的消息和热榜/流行词的交集。
 *
 * 这是"联网学习"的**匹配半边**（抓取半边由 hot-trend-tracker 插件和 supplement
 * 完成，见 index.js）——先在本地比对出"今天群里聊到的东西哪些正在热榜上"，
 * 再把命中的交给夜间 LLM 决定"值不值得学、怎么接才自然"。纯字符串包含计数，
 * 不调用模型，热榜有几百条也毫秒级。
 */
export function matchTrends(trends, rows, { limit = 8 } = {}) {
  const hay = (Array.isArray(rows) ? rows : []).map((m) => String(m?.text ?? '')).join('\n');
  if (!hay || !Array.isArray(trends) || !trends.length) return [];
  const out = [];
  const seen = new Set();
  for (const tr of trends) {
    const kws = trendKeywords(tr);
    if (!kws.length) continue;
    // 用最长的关键词匹配：标题比 key 更完整，"蚌埠住了"比"蚌埠"更不容易误命中
    const kw = [...kws].sort((a, b) => b.length - a.length)[0];
    if (seen.has(kw)) continue;
    let count = 0;
    let idx = hay.indexOf(kw);
    while (idx >= 0 && count <= 50) { count += 1; idx = hay.indexOf(kw, idx + kw.length); }
    if (count > 0) {
      seen.add(kw);
      out.push({
        word: kw,
        title: clipText(tr.title || tr.key || tr.keyword || kw, 40),
        desc: clipText(tr.desc || '', 60),
        from: Array.isArray(tr.sources) ? tr.sources.join('/') : String(tr.from || 'trend'),
        count
      });
    }
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

// ───────────────────────────── 主入口 ─────────────────────────────

/**
 * 学习一个群的说话风格。
 *
 * @param {object} input
 * @param {Array}  input.rows        聊天记录条目（宿主 store.recent() 的形状；时间升序）
 * @param {Array}  [input.notes]     记忆里已有的群友印象（{ content }），样本不足时补充线索
 * @param {number} [input.sampleSize] 最多统计多少条群友消息
 * @param {number} [input.minSample]  少于这么多条群友消息就不给建议（样本太少只会学出噪音）
 * @returns {object|null} 风格档案；样本不足或读不到数据时返回 null（调用方据此保持上一次的档案）
 */
export function analyzeStyle({ rows = [], notes = [], sampleSize = 400, minSample = 30 } = {}) {  const all = (Array.isArray(rows) ? rows : []).filter((m) => m && typeof m === 'object');
  const human = all.filter((m) => !m.self && !m.isPoke);
  // 机器人自己的发言同样只取**最近**的：判断"你现在说话像不像群里"，
  // 拿几天前的发言来平均会把结论冲淡（早期版本就是这么把偏差判成"大体合拍"的）。
  const selfRows = all.filter((m) => m.self).slice(-SELF_WINDOW);

  const cap = Math.max(10, toInt(sampleSize, 400));
  // 只取最近 cap 条：风格是"最近怎么说话"，不是"这个群三年来一直怎么说话"。
  // 一次性群聊（活动/临时群）尤其明显 —— 越老的样本越误导。
  const window = human.slice(-cap);

  if (window.length < Math.max(1, toInt(minSample, 30))) return null;

  const texts = window.map((m) => String(m.text || ''));
  // 清洗一次、重复使用（标点与口头语两套统计共用同一份干净文本）：
  //   · 剥掉所有占位符/引用块 → 纯媒体消息会变成空串，随后被 isMeaningful 剔掉
  //   · 顺带省掉重复清洗的开销（400 条文本要过两遍正则）
  const clean = texts.map(cleanText).filter((t) => t && isMeaningful(t));
  const rhythm = rhythmStats(window);
  const punct = punctuationStats(clean, clean.length);

  // 记忆里的群友印象是最稳的信号之一：它本来就是"长期印象"，
  // 而且已经由模型提炼过（比原始聊天记录的噪音低），所以作为口头语的补充来源。
  const noteTexts = (Array.isArray(notes) ? notes : [])
    .map((n) => (typeof n === 'string' ? n : n?.content))
    .filter(Boolean)
    .map((s) => String(s).slice(0, 200));

  const tokens = tokenStats(clean, {});
  // 语气词通道与高频词通道**互相独立**（原因见 slangStats 的注释）：
  // 单字语气词靠白名单+叠字判定，不靠频率，所以不会被"吗/给"这类虚词顶掉。
  const slang = slangStats(clean, {});
  const noteTokens = noteTexts.length
    ? tokenStats(noteTexts, { minDocRatio: 0.12, minDocCount: 2, limit: 6 })
    : [];
  const byToken = new Map(tokens.map((t) => [t.token, t]));
  for (const t of slang) byToken.set(t.token, t);
  for (const t of noteTokens) {
    if (!byToken.has(t.token)) byToken.set(t.token, { token: t.token, ratio: t.ratio, from: 'memory' });
  }
  const wordsOut = [...byToken.values()].slice(0, 12);

  const senders = new Set(window.map((m) => String(m.senderId || '')).filter(Boolean));
  const spanMs = window.length > 1
    ? Math.max(0, Number(window[window.length - 1].ts || 0) - Number(window[0].ts || 0))
    : 0;

  const group = {
    sampleSize: window.length,
    textMessages: clean.length,   // 其中真正有文字内容的（标点/口头语统计的分母）
    senders: senders.size,
    spanDays: Math.round((spanMs / 86_400_000) * 10) / 10,
    meanChars: rhythm.meanChars,
    medianChars: rhythm.medianChars,
    p90Chars: rhythm.p90Chars,
    shortRatio: rhythm.shortRatio,
    longRatio: rhythm.longRatio,
    bucketShort: rhythm.bucketShort,
    bucketMedium: rhythm.bucketMedium,
    bucketLong: rhythm.bucketLong,
    perBurst: rhythm.perBurst,
    bursts: rhythm.bursts,
    punct,
    emojiPct: punct.emojiPct
  };

  return {
    group,
    words: wordsOut,
    notesUsed: noteTexts.length,
    self: selfRows.length >= 3 ? compareSelf(selfRows, group) : { n: selfRows.length, issues: [] },
    learnedAt: Date.now()
  };
}

// ───────────────────────────── 渲染成提示词 ─────────────────────────────

const ADOPT_LINE = {
  观察为主: '下面这些是从这个群的聊天记录里统计出来的说话习惯。**当参考**：和你平时的说法不冲突时靠过去；你自己有更想说的就说你自己的，不必为了像而变得别扭。',
  贴近推荐: '下面这些是从这个群的聊天记录里统计出来的说话习惯。**尽量照做**：长度和标点按它的来，群里怎么说你就怎么说 —— 但内容还是你自己想。',
  强模仿: '下面这些是从这个群的聊天记录里统计出来的说话习惯，**当硬规则执行**：长度区间、标点习惯、分条节奏都按它来；拿不准的时候，选更短、更口语的那个说法。'
};

/** adoptLevel 的取值里带了"（推荐）"这种给下拉框看的后缀，匹配时统一去掉。 */
function adoptText(level) {
  const key = String(level || '').replace(/[（(].*?[）)]/g, '').trim();
  return ADOPT_LINE[key] || ADOPT_LINE['贴近推荐'];
}

/** 夜间复盘产出在提示词里的保鲜期：过期的"昨晚的梗/语气要求"不再注入（梗会过气）。 */
const NIGHT_FRESH_MS = 36 * 3600 * 1000;

/**
 * 渲染成要注入模型的文本（系统提示词片段 / 本次输入末尾的小段）。
 *
 * @param {object} profile analyzeStyle 的结果
 * @param {object} opts { adoptLevel, includeWords, style: 'full' | 'compact', chatName,
 *                        night: 夜间复盘产出（v1.1，可选）, toneSoftening, memeInject }
 * @returns {string} 空串表示没有可说的（调用方据此跳过，不要塞一段空壳进提示词）
 */
export function renderStyleHint(profile, { adoptLevel = '贴近（推荐）', includeWords = true, style = 'full', chatName = '', night = null, toneSoftening = true, memeInject = true } = {}) {
  const g = profile?.group;
  if (!g || !g.sampleSize) return '';
  const who = chatName ? `「${String(chatName).slice(0, 20)}」` : '这个群';
  const lines = [];

  if (style === 'full') {
    lines.push(`【群聊语言风格 · 自动学习】`);
    lines.push(adoptText(adoptLevel));
    lines.push(`统计来源：${who}最近 ${g.sampleSize} 条群友消息`
      + `${g.textMessages && g.textMessages !== g.sampleSize ? `（其中 ${g.textMessages} 条是纯文字，图片/转发之类不计）` : ''}`
      + `${g.spanDays > 0 ? `，跨约 ${g.spanDays} 天` : ''}`
      + `${g.senders > 1 ? `，${g.senders} 个人` : ''}。不是群友的原话，不用照抄，也不要向群友提起这个统计。`);
  } else {
    lines.push('【本次发言的语言风格要求（按这个群的实际习惯统计）】');
  }

  // 长度：给区间，但**上限不能直接用分位数**。
  // 群里总有几条转贴/长文把 90 分位拉到 40~50 字，写成"多数不超过 46 字"等于
  // 鼓励机器人写小作文 —— 与"像真人"正好相反。所以上限按"常见长度 × 3"来定，
  // 再夹到 [中位+6, 分位值] 之间：既反映这个群确实比别处长，也不会放飞。
  if (g.meanChars > 0) {
    const common = Math.max(1, Math.round(g.medianChars));
    const p90 = Math.max(common + 2, Math.round(g.p90Chars));
    const upper = Math.round(Math.min(p90, Math.max(common * 3, common + 6)));
    lines.push(`· 句长：群里最常见的是 ${common} 字左右（平均 ${g.meanChars} 字），一般不超过 ${upper} 字。你发的每一条都落在这个区间里，想多说就多发几条，别写成一整段。`);
    if (g.shortRatio >= 0.4) lines.push(`· 其中 ${Math.round(g.shortRatio * 100)}% 是 6 字以内的短句 —— 短促、不完整、只接半句，在这个群是正常的，不用凑成完整句子。`);
    if (g.longRatio >= 0.3) lines.push(`· 也有 ${Math.round(g.longRatio * 100)}% 是超过 15 字的长句 —— 想展开讲的时候可以写长一点，这个群吃得下。`);
  }

  // 标点
  const p = g.punct || {};
  if (p.noEndPct >= 70) {
    lines.push(`· 标点：${p.noEndPct}% 的消息句末**什么都不带**（没有句号）。句末句号会让你一眼被看出来不是群里人 —— 去掉。`);
  } else if (p.dotPct >= 45) {
    lines.push(`· 标点：${p.dotPct}% 的消息句末带句号，这个群习惯把话写完整 —— 该带就带。`);
  } else {
    lines.push(`· 标点：群里标点用得随意（句末带标点的约 ${Math.max(p.dotPct, p.noEndPct ? 100 - p.noEndPct : 0)}%），不用刻意规范。`);
  }
  const marks = [];
  if (p.qPct >= 20) marks.push(`问号用得很多（${p.qPct}%）`);
  if (p.exPct >= 20) marks.push(`感叹号很多（${p.exPct}%）`);
  if (p.tildePct >= 10) marks.push(`爱拖波浪号「~」（${p.tildePct}%）`);
  if (p.ellipsisPct >= 10) marks.push(`爱用省略号（${p.ellipsisPct}%）`);
  if (p.commaPct <= 15) marks.push(`几乎不用逗号（${p.commaPct}%）`);
  if (marks.length) lines.push(`· 其他标点习惯：${marks.join('、')}。`);

  // 语气与节奏
  const tone = [];
  if (p.laughPct >= 8) tone.push(`常用「哈哈/草」这类笑声（${p.laughPct}% 的消息里有）`);
  if (p.repeatPct >= 12) tone.push(`爱把字拉长（"急急急""好好好"这种，${p.repeatPct}%）`);
  if (p.emojiPct >= 15) tone.push(`偶尔用 emoji 点缀（${p.emojiPct}%）`);
  if (p.bracketPct >= 8) tone.push(`爱用（笑）（doge）这种括号补一句（${p.bracketPct}%）`);
  if (tone.length) lines.push(`· 语气：${tone.join('；')}。`);

  if (g.perBurst >= 1.8) {
    lines.push(`· 分条节奏：一个人常常连着发（平均一次连发 ${g.perBurst} 条）—— 想表达两个意思就发两条，别用空格在一句里分。`);
  } else {
    lines.push(`· 分条节奏：这个群多数一条说完（平均一次 ${g.perBurst} 条）—— 没必要时不要连发。`);
  }

  if (includeWords && Array.isArray(profile.words) && profile.words.length) {
    const slang = profile.words.filter((w) => w.kind === 'slang');
    const plain = profile.words.filter((w) => w.kind !== 'slang');
    if (slang.length) {
      const list = slang.slice(0, 5).map((w) => `「${w.token}」`).join('、');
      lines.push(`· 群里的口头禅/语气词：${list}。这是这个群表达情绪的惯用说法 —— 情绪对得上的时候自然用，别连着复读、也别硬塞。`);
    }
    if (plain.length) {
      const list = plain.slice(0, 6).map((w) => w.token).join('、');
      lines.push(`· 这个群常出现的说法：${list}。当**语气参考**用：句子顺的时候自然带进去，不要硬塞、更不要为了显得像就连着复读这几个词。`);
      if (plain.some((w) => w.from === 'memory') && style === 'full') {
        lines.push('（其中一部分来自「记忆」页里已经存下的群友印象，不是原始聊天记录。）');
      }
    }
  }

  if (Array.isArray(profile.self?.issues) && profile.self.issues.length) {
    lines.push('· 需要你改的地方：');
    for (const it of profile.self.issues) lines.push(`　- ${it}`);
  }

  // ── v1.1 夜间复盘的产出（语气软化 / 活人感调整 / 梗）──────────────────────
  // 只在"新鲜期"内注入（36 小时）：昨天的梗今天再提醒就过气了，语气要求超过
  // 两天没更新也说明昨晚的整理没跑成，不该让旧话一直占着提示词。
  const nt = night && Date.now() - Number(night.at || 0) < NIGHT_FRESH_MS ? night : null;
  if (nt) {
    if (toneSoftening && nt.toneNote) {
      lines.push(`· 语气修正（昨晚复盘）：${clipText(nt.toneNote, 70)}`);
    }
    if (Array.isArray(nt.tips) && nt.tips.length) {
      const tips = nt.tips.slice(0, 2).map((t, i) => `${i + 1}${clipText(t, 34)}`).join('；');
      lines.push(`· 昨晚复盘的说话调整：${tips}。`);
    }
    if (memeInject && Array.isArray(nt.memes) && nt.memes.length) {
      const list = nt.memes.slice(0, 2)
        .map((m) => `「${clipText(m.word, 14)}」${m.how ? `（${clipText(m.how, 22)}）` : ''}`)
        .join('、');
      lines.push(`· 最近群里/网上能接的梗：${list}。对上语境才用，一次最多一个；不硬塞、不解释梗是什么，过了热度就放下。`);
    }
  }

  lines.push('· 底线不变：人设、安全规则、工具用法都照旧，这里只调**说法**，不调**说什么**。');
  return lines.join('\n');
}

/** 供排障/自检用：把档案压成一行摘要。 */
export function summarizeProfile(profile) {
  const g = profile?.group;
  if (!g) return '（还没有档案）';
  return `${g.sampleSize} 条 / 平均 ${g.meanChars} 字 / 中位 ${g.medianChars} / 句末无标点 ${g.punct?.noEndPct ?? 0}%`
    + ` / 连发 ${g.perBurst} / 口头语 ${(profile.words || []).length} 个`;
}

/** 测试与排障用的内部导出。 */
export const __internals = { cleanText, words, catchPhrases, tokenStats, punctuationStats, rhythmStats, isInteresting, squeeze, hasEmoji, scanAggression, trendKeywords, matchTrends };

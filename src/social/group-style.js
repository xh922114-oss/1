// 群风格自适应 —— 从 QQAgent（MIT）`plugins/adaptive-group-style` 移植的**适配层**。
//
// 合并组 G1（见 docs/guides/QQAGENT_MIGRATION.md）：QQAgent 那边它是"确定性型插件"
// （hooks + 动态 promptSections），同类的还有群长期规则与黑话表；本仓库已经有两套更完整的
// 同类机制（`src/slang-learner.js` 的黑话表 + `src/social/group-rules.js` 的群长期规则），
// 所以这里**只补它独有的那部分**：从本地聊天记录统计出来的「这个群怎么说话」（句长/标点/节奏/口头语），
// 并和黑话表一起在每轮唤醒提示词里注入。
//
// 统计引擎原样搬自上游（`./group-style-engine.js`，算法与阈值未改），本文件只负责：
//   · 把 dsh-qq 的消息窗口换成引擎认的行形状（{ self, isPoke, text, senderId, ts }）；
//   · 按会话缓存档案（风格是"最近怎么说话"，不必每条消息都重算）；
//   · 给桥接一个"拿不到就给空串"的入口（学不出来时绝不能挡正常发言）。

import { analyzeStyle, renderStyleHint, summarizeProfile, scanAggression } from './group-style-engine.js';

export { scanAggression, summarizeProfile };

/** 默认配置（cap 与采样上限：窗口最多留这么多条群友消息）。 */
export const STYLE_DEFAULTS = Object.freeze({
  enabled: true,
  /** 最多统计多少条群友消息（只取最近这些条） */
  sampleSize: 400,
  /** 少于这么多条就不给建议（样本太少只会学出噪音） */
  minSample: 30,
  /** 模仿程度：观察为主 / 贴近（推荐）/ 强模仿 */
  adoptLevel: '贴近（推荐）',
  /** 档案保鲜期（分钟）：过多久重新统计一次 */
  learnMinutes: 30,
  /** 每次注入的字符上限（护栏：风格段会随每条消息发送） */
  maxChars: 900,
});

/** 把 dsh-qq 的消息窗口转成统计引擎认的行。 */
export function toStyleRows(窗口, { self = false } = {}) {
  return (Array.isArray(窗口) ? 窗口 : [])
    .filter((m) => m && typeof m === 'object' && typeof m.text === 'string' && m.text)
    .map((m) => ({
      self: m.self === true || self === true,
      isPoke: false,
      text: String(m.text),
      senderId: String(m.sender ?? m.senderId ?? ''),
      ts: Number(m.time ?? m.ts ?? 0) || 0,
    }));
}

/**
 * 统计一个会话的风格并渲染成提示词片段。
 *
 * @param {object} 输入
 * @param {Array}  输入.rows       群友消息（`toStyleRows` 的输出或同形状数组）
 * @param {Array}  [输入.notes]    记忆里已有的群友印象（{ content } 或字符串），样本不足时当补充线索
 * @param {string} [输入.chatName] 群名（只用于提示词里的自称）
 * @param {object} [输入.config]   STYLE_DEFAULTS 的覆盖项
 * @returns {{ hint: string, profile: object, summary: string } | null} 样本不足或没有可说的返回 null
 */
export function buildStyleHint({ rows = [], notes = [], chatName = '', config = {} } = {}) {
  const c = { ...STYLE_DEFAULTS, ...(config && typeof config === 'object' ? config : {}) };
  let profile = null;
  try {
    profile = analyzeStyle({
      rows,
      notes,
      sampleSize: Math.max(10, Number(c.sampleSize) || STYLE_DEFAULTS.sampleSize),
      minSample: Math.max(1, Number(c.minSample) || STYLE_DEFAULTS.minSample),
    });
  } catch {
    return null; // 统计失败不该影响正常说话
  }
  if (!profile) return null;

  // 用 compact：这段会随每条消息发送，长度必须收着（上游对"每条消息都贴"的场合也用 compact）。
  let hint = '';
  try {
    hint = renderStyleHint(profile, {
      adoptLevel: c.adoptLevel,
      includeWords: true,
      style: 'compact',
      chatName,
    });
  } catch {
    return null;
  }
  if (!hint) return null;

  const 上限 = Math.max(200, Number(c.maxChars) || STYLE_DEFAULTS.maxChars);
  if (hint.length > 上限) hint = hint.slice(0, 上限);

  let summary = '';
  try {
    summary = summarizeProfile(profile);
  } catch {
    summary = '';
  }
  return { hint, profile, summary };
}

/** 风格档案缓存：按会话 key 存，过了保鲜期重算。 */
export function createStyleCache({ ttlMs = STYLE_DEFAULTS.learnMinutes * 60_000, now = Date.now } = {}) {
  const 表 = new Map(); // key -> { at, 值 }
  return {
    /** 命中且没过期就复用；否则用 `算()` 重新算（算失败返回 null，且不写缓存）。 */
    get(key, 算) {
      const 旧 = 表.get(key);
      const t = now();
      if (旧 && t - 旧.at < ttlMs) return 旧.值;
      let 值 = null;
      try {
        值 = 算();
      } catch {
        值 = null;
      }
      if (值) 表.set(key, { at: t, 值 });
      return 值;
    },
    delete(key) { 表.delete(key); },
    clear() { 表.clear(); },
    size() { return 表.size; },
  };
}

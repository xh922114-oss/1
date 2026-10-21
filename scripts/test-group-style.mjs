// 群风格自适应（迁移自 QQAgent adaptive-group-style）离线测试。
//
// 验什么：
//   1. 消息窗口 → 统计行的形状转换（sender/time/text → senderId/ts/text）；
//   2. 样本不足时**什么都不给**（宁可不注入，也不要拿噪音教模型说话）；
//   3. 样本够了能学出这个群的特征（句长/标点/口头语），且注入文本带"底线不变"那句；
//   4. 缓存按会话隔离、过期重算；
//   5. 引擎本身的进攻性用语检测仍可用（原样移植的那部分）。
//
// 跑法：node scripts/test-group-style.mjs
import assert from 'node:assert';
import { buildStyleHint, createStyleCache, toStyleRows, scanAggression, STYLE_DEFAULTS } from '../src/social/group-style.js';

let 过了 = 0;
const ok = (label) => { 过了 += 1; console.log(`✅ ${label}`); };

/** 造一批"短句 + 不带句末标点 + 爱说「真的假的」"的群友消息（引擎应该学得出来）。 */
function 造消息(n, { 长句 = false } = {}) {
  const 出 = [];
  for (let i = 0; i < n; i += 1) {
    const text = i % 4 === 0
      ? '真的假的'
      : 长句
        ? `第${i}条：今天那个事情我还是觉得有点离谱，你们怎么看`
        : `好耶${i}`;
    出.push({ sender: `群友${i % 5}`, text, time: 1_700_000_000_000 + i * 1000 });
  }
  return 出;
}

// ── 行转换 ────────────────────────────────────────────────────────────────
const 行 = toStyleRows(造消息(3));
assert.equal(行.length, 3);
assert.deepEqual(Object.keys(行[0]).sort(), ['isPoke', 'self', 'senderId', 'text', 'ts']);
assert.equal(行[0].senderId, '群友0');
assert.equal(行[0].self, false);
assert.deepEqual(toStyleRows([{ text: '' }, null, { sender: 'a', text: 'x' }]).length, 1, '空文本与坏条目被剔掉');
assert.equal(toStyleRows(造消息(2), { self: true })[0].self, true, '整批标记为自己发的');
ok('窗口 → 统计行：形状正确、坏条目剔掉、self 可标');

// ── 样本不足 ──────────────────────────────────────────────────────────────
assert.equal(buildStyleHint({ rows: toStyleRows(造消息(5)) }), null, '少于 minSample 条 → 不给建议');
assert.equal(buildStyleHint({ rows: [] }), null, '空样本 → null');
assert.equal(buildStyleHint({ rows: toStyleRows(造消息(40)), config: { minSample: 100 } }), null, 'minSample 可上调');
ok('样本不足不给建议（默认 30 条起）');

// ── 学得出来 + 注入文案 ────────────────────────────────────────────────────
const 结果 = buildStyleHint({ rows: toStyleRows(造消息(60)), chatName: '测试群' });
assert.ok(结果 && 结果.hint, '样本够了应该给出提示词片段');
assert.match(结果.hint, /【本次发言的语言风格要求/, 结果.hint);
assert.match(结果.hint, /底线不变/, '必须带「只调说法、不调说什么」那句');
assert.match(结果.hint, /句长|标点|分条节奏/, '至少要有句长/标点/节奏中的一项');
assert.ok(结果.hint.length <= STYLE_DEFAULTS.maxChars, `长度受 maxChars 约束（${结果.hint.length}）`);
assert.equal(结果.profile.group.sampleSize, 60);
assert.ok(结果.summary && 结果.summary.length > 0, '摘要给日志用');
ok('样本足够：学出风格并渲染成提示词片段（含底线声明）');

// 长句群 vs 短句群应该学出不同的句长口径
const 长句群 = buildStyleHint({ rows: toStyleRows(造消息(60, { 长句: true })) });
assert.ok(长句群.profile.group.meanChars > 结果.profile.group.meanChars, '长句群的平均句长应更大');
ok('不同群学出不同口径（长句群 meanChars 更大）');

// maxChars 是硬护栏
const 短护栏 = buildStyleHint({ rows: toStyleRows(造消息(60)), config: { maxChars: 200 } });
assert.ok(短护栏.hint.length <= 200, String(短护栏.hint.length));
ok('maxChars 收紧后长度立刻受约束');

// ── 缓存 ──────────────────────────────────────────────────────────────────
let 时钟 = 1000;
let 算了 = 0;
const 缓存 = createStyleCache({ ttlMs: 1000, now: () => 时钟 });
const 算 = () => { 算了 += 1; return { hint: 'x' }; };
缓存.get('group:1', 算);
缓存.get('group:1', 算);
assert.equal(算了, 1, '保鲜期内不重算');
缓存.get('group:2', 算);
assert.equal(算了, 2, '不同会话各算一次');
时钟 += 2000;
缓存.get('group:1', 算);
assert.equal(算了, 3, '过了保鲜期重算');
assert.equal(缓存.size(), 2);
缓存.delete('group:1');
assert.equal(缓存.size(), 1);
缓存.clear();
assert.equal(缓存.size(), 0);
assert.equal(createStyleCache().get('k', () => { throw new Error('炸了'); }) ?? null, null, '算失败返回 null 而不是抛出去');
ok('缓存：按会话隔离、保鲜期、删/清、算失败不抛');

// ── 原样移植的进攻性用语检测仍可用 ─────────────────────────────────────────
// 注意用词表里真实存在的说法（AGGRESSIVE_RE / PUSHY_RE 是上游定的，本次没改）：
// 「闭嘴」「你就是个废物」命中硬词，「你就这?」命中推搡类。
const 进攻 = scanAggression(['闭嘴', '今天天气不错', '你就这?', '你就是个废物']);
assert.equal(进攻.n, 4, JSON.stringify(进攻));
assert.ok(进攻.hits >= 3, `应识别出至少 3 条，实际 ${进攻.hits}`);
assert.ok(进攻.hard >= 2, `硬词应识别出至少 2 条，实际 ${进攻.hard}`);
assert.ok(['some', 'high'].includes(进攻.level), 进攻.level);
assert.equal(scanAggression(['今天天气不错']).hits, 0, '正常聊天不该误报');
ok('引擎的 scanAggression 原样可用');

console.log(`\n🎉 群风格自适应测试通过（${过了} 组断言）`);

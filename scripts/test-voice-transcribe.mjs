// 入站语音转文字（迁移自 QQAgent 的 speech-to-text-qq）离线测试。
//
// 验什么：
//   1. 正常转写：请求形状对（动作名 / message_id / 令牌头）；
//   2. 网关说"这条没有语音"（retcode=100）→ 不算故障，返回空文本；
//   3. 超时 / 网络错 / 网关 500 → 一律返回 ok:false 且不抛异常（绝不能影响消息投递）；
//   4. 空 message_id / 空地址 / 没有 fetch 时不发请求；
//   5. 渲染：空文本 → `[语音]`，有文本 → `[语音：…]`，超长截断、空白折叠。
//
// 跑法：node scripts/test-voice-transcribe.mjs
import assert from 'node:assert';
import { fetchPttText, recordLabel, DEFAULT_PTT_TIMEOUT_MS } from '../src/voice-transcribe.js';

let 过了 = 0;
const ok = (label) => { 过了 += 1; console.log(`✅ ${label}`); };

/** 造一个记录调用参数的假 fetch。 */
function 造Fetch(应答, { throwOn = null } = {}) {
  const 调用 = [];
  const impl = async (url, init) => {
    调用.push({ url, init, body: JSON.parse(init.body), auth: init.headers.authorization ?? '' });
    if (throwOn) throw new Error(throwOn);
    return { ok: 应答.ok !== false, status: 应答.status ?? 200, json: async () => 应答.body };
  };
  return { impl, 调用 };
}

// ── 正常路径 ──────────────────────────────────────────────────────────────
{
  const { impl, 调用 } = 造Fetch({ body: { status: 'ok', retcode: 0, data: { text: '  今天晚上打本吗  ' } } });
  const 结果 = await fetchPttText({ messageId: 12345, httpUrl: 'http://127.0.0.1:3000/', token: 'tk', fetchImpl: impl });
  assert.equal(结果.ok, true);
  assert.equal(结果.text, '今天晚上打本吗', '两边空白要修掉');
  assert.equal(调用.length, 1);
  assert.equal(调用[0].url, 'http://127.0.0.1:3000/fetch_ptt_text', '结尾斜杠要归一化');
  assert.deepEqual(调用[0].body, { message_id: '12345' }, 'message_id 要转成字符串');
  assert.equal(调用[0].auth, 'Bearer tk');
  ok('正常转写：动作名/参数/令牌都对');
}

// ── 没有转写（retcode=100）─────────────────────────────────────────────────
{
  const { impl } = 造Fetch({ body: { status: 'failed', retcode: 100, wording: '消息中不包含语音' } });
  const 结果 = await fetchPttText({ messageId: '1', httpUrl: 'http://x', fetchImpl: impl });
  assert.equal(结果.ok, false);
  assert.equal(结果.text, '');
  assert.match(结果.error, /retcode=100/);
  ok('「消息中不包含语音」按普通失败处理（有原因、无异常）');
}

// ── 各种失败都不抛 ────────────────────────────────────────────────────────
{
  const 超时 = 造Fetch({}, { throwOn: 'The operation was aborted due to timeout' });
  const a = await fetchPttText({ messageId: '1', httpUrl: 'http://x', fetchImpl: 超时.impl });
  assert.equal(a.ok, false); assert.match(a.error, /timeout/);

  const 五百 = 造Fetch({ ok: false, status: 500, body: { status: 'failed', retcode: -1 } });
  const b = await fetchPttText({ messageId: '1', httpUrl: 'http://x', fetchImpl: 五百.impl });
  assert.equal(b.ok, false);

  const 坏Json = { impl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) };
  const c = await fetchPttText({ messageId: '1', httpUrl: 'http://x', fetchImpl: 坏Json.impl });
  assert.equal(c.ok, false);
  ok('超时 / 网关 500 / 坏 JSON 一律返回失败而**不抛异常**');
}

// ── 参数缺失时不发请求 ────────────────────────────────────────────────────
{
  let 发过 = 0;
  const 计数 = async () => { 发过 += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  assert.equal((await fetchPttText({ messageId: '', httpUrl: 'http://x', fetchImpl: 计数 })).ok, false);
  assert.equal((await fetchPttText({ messageId: '1', httpUrl: '', fetchImpl: 计数 })).ok, false);
  assert.equal((await fetchPttText({ messageId: '1', httpUrl: 'http://x', fetchImpl: null })).ok, false);
  assert.equal(发过, 0, '缺参数时一个请求都不该发');
  assert.equal(DEFAULT_PTT_TIMEOUT_MS, 8000);
  ok('缺 message_id / 地址 / fetch 时直接返回失败，不发请求');
}

// ── 渲染 ──────────────────────────────────────────────────────────────────
assert.equal(recordLabel(''), '[语音]', '空转写回落到原来的占位');
assert.equal(recordLabel('   '), '[语音]');
assert.equal(recordLabel(null), '[语音]');
assert.equal(recordLabel('在吗'), '[语音：在吗]');
assert.equal(recordLabel('一\n二\t三'), '[语音：一 二 三]', '换行/制表符折成空格');
assert.equal(recordLabel('x'.repeat(500)).length, 200 + '[语音：]'.length, '超长截断');
ok('渲染：空→[语音]、有文本→[语音：…]、折叠空白、超长截断');

console.log(`\n🎉 入站语音转文字测试通过（${过了} 组断言）`);

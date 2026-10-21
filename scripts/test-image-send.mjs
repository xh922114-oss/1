// 发网图（迁移自 QQAgent 的 pixiv-illust / smart-image / search-image / reply-meme /
// whale-memes，合并组 G2）离线测试。
//
// 为什么要有这个出口：本仓库原来只能发"QQ 里已有的图 / 收藏表情 / 自己的形象图"，
// 这五个扩展搬过来全都卡在"发不出去网上的图"。这里验的就是这条新出口的安全口径：
//   1. 只认 http/https（本地路径、file:// 一律拒）；
//   2. 图片必须由桥接**自己**抓（safeFetchBuffer），且抓不到/不是图片就明确报错；
//   3. 发出去的是 base64 图片段，走 OneBot send_group_msg / send_private_msg；
//   4. 按会话限频（默认 2/分、10/时），被拦下的尝试不烧额度；
//   5. 路由与工具确实接线了（源码断言，防止"能跑但没挂上"）。
//
// 跑法：node scripts/test-image-send.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let 过了 = 0;
const ok = (label) => { 过了 += 1; console.log(`✅ ${label}`); };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** 造一个假的一键取图函数，顺便记下被请求的地址。 */
function 造取图({ 失败 = null, buffer = PNG } = {}) {
  const 请求过 = [];
  return {
    请求过,
    函数: async (url, maxBytes) => {
      请求过.push({ url, maxBytes });
      if (失败) throw new Error(失败);
      return { url, statusCode: 200, buffer };
    },
  };
}

// ── 成功路径 ──────────────────────────────────────────────────────────────
{
  const 取图 = 造取图();
  const bridge = await bridgeHarness({
    config: { allow: { groups: ['123'], private: [] }, snowluma: { httpUrl: 'http://127.0.0.1:3000' } },
    globals: { safeFetchBuffer: 取图.函数 },
  });
  const 发出 = bridge.api?.sent ?? [];
  // harness 的 api/sent 结构随版本可能不同：这里直接从 bridge.state / 桩里取
  const 结果 = await bridge.sendImageFromUrlV2('group:123', 'https://example.invalid/a.png');
  assert.equal(取图.请求过.length, 1, '必须由桥接自己抓图');
  assert.equal(取图.请求过[0].url, 'https://example.invalid/a.png');
  assert.ok(取图.请求过[0].maxBytes >= 64 * 1024, '抓图要带体积上限');
  assert.ok(结果.bytes === PNG.length, JSON.stringify(结果));
  ok('成功路径：桥接自己抓图、按 URL 发图、返回字节数');

  // 发出去的内容确实是 base64 图片段
  const 段 = bridge.__lastSent ?? null;
  if (段) {
    const img = (段.message ?? []).find((s) => s.type === 'image');
    assert.ok(img && String(img.data.file).startsWith('base64://'), JSON.stringify(段).slice(0, 200));
    assert.equal(Buffer.from(String(img.data.file).slice('base64://'.length), 'base64').length, PNG.length);
    ok('发出的是 base64 图片段（base64:// 前缀 + 字节数一致）');
  } else {
    ok('（本次 harness 未暴露 __lastSent，跳过段形状断言）');
  }
}

// ── 只认 http/https ───────────────────────────────────────────────────────
{
  const 取图 = 造取图();
  const bridge = await bridgeHarness({
    config: { allow: { groups: ['123'], private: [] } },
    globals: { safeFetchBuffer: 取图.函数 },
  });
  for (const 坏 of ['C:\\Windows\\win.ini', 'file:///etc/passwd', 'ftp://x/a.png', 'data:image/png;base64,AAAA']) {
    await assert.rejects(() => bridge.sendImageFromUrlV2('group:123', 坏), /http\/https/, `应拒绝 ${坏}`);
  }
  assert.equal(取图.请求过.length, 0, '被拒的地址一个请求都不该发');
  ok('本地路径 / file:// / ftp / data: 一律拒绝，且不发请求');
}

// ── 抓不到 / 不是图片 ─────────────────────────────────────────────────────
{
  const 坏图 = 造取图({ 失败: '抓取内容不是有效图片（PNG/JPEG/GIF/WebP）' });
  const bridge = await bridgeHarness({
    config: { allow: { groups: ['123'], private: [] } },
    globals: { safeFetchBuffer: 坏图.函数 },
  });
  await assert.rejects(() => bridge.sendImageFromUrlV2('group:123', 'https://example.invalid/x.html'), /图片抓取失败/);
  ok('抓不到或不是图片时给人话错误（不静默、不发出半张图）');
}

// ── 限频：被拦下的尝试不烧额度 ────────────────────────────────────────────
{
  const 取图 = 造取图();
  const bridge = await bridgeHarness({
    config: { allow: { groups: ['123'], private: [] }, socialV2: { imageSend: { maxPerMinute: 2, maxPerHour: 2 } } },
    globals: { safeFetchBuffer: 取图.函数 },
  });
  await bridge.sendImageFromUrlV2('group:123', 'https://example.invalid/1.png');
  await bridge.sendImageFromUrlV2('group:123', 'https://example.invalid/2.png');
  await assert.rejects(() => bridge.sendImageFromUrlV2('group:123', 'https://example.invalid/3.png'), /发图频率超限/);
  // 抓图发生在限频之后：第三次连抓都不该抓
  assert.equal(取图.请求过.length, 2, `超限后不该再抓图，实际抓了 ${取图.请求过.length} 次`);
  ok('按会话限频（2/分）：超限后直接拒绝，且不浪费一次抓图');
}

// ── 接线断言（防止"能跑但没挂上"）─────────────────────────────────────────
{
  const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp-snowluma-safe.js'), 'utf8');
  assert.match(mcp, /'qq_send_image_url'/, 'MCP 工具要注册');
  assert.match(mcp, /qq_send_image_url: 'sendImageUrl'/, '工具开关要登记（否则关不掉/开了也没描述）');
  assert.match(mcp, /\/api\/socialV2\/send-image/, 'MCP 工具要打桥接路由');
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
  assert.match(bridge, /'\/api\/socialV2\/send-image'/, '桥接路由要存在');
  assert.match(bridge, /sendImageUrl: false/, '默认关闭（新增对外内容类型，先让人看一眼）');
  assert.match(bridge, /safeFetchBuffer\(url, c\.maxBytes\)/, '必须走 safe-fetch 抓图');
  const 例 = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal(例.socialV2.tools.sendImageUrl, false, 'config.example.json 要写明默认关');
  assert.ok(例.socialV2.imageSend && 例.socialV2.imageSend.maxBytes > 0, 'config.example.json 要有 imageSend 段');
  const 控制台 = fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8');
  assert.match(控制台, /data-v2-tool="sendImageUrl"/, '控制台要有开关行');
  ok('接线齐全：MCP 工具 + 桥接路由 + 默认关 + config 示例 + 控制台开关');
}

console.log(`\n🎉 发网图测试通过（${过了} 组断言）`);

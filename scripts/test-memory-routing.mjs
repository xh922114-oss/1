// 记忆分流（私聊 → fish-memory / 群聊 → mnemon）离线测试。
//
// 验什么：
//   1. 归一化：缺字段/类型不对时回落默认值，不会把"没配置"变成"全关"或"全开"；
//   2. store 判定：配置里的私聊 → fish；群 → mnemon；别的私聊 → none；
//   3. 提示词那一行：只在对应会话出现，且写清"哪个库优先"（避免模型两边都写）；
//   4. fish-memory 配置写入：幂等、保留别人的会话、坏文件当空对象重来；
//   5. 工具闸门：只放行 remember / mnemon_remember / mnemon_recall，删除与管理面仍被拒；
//   6. 接线：桥接每轮提示词真的带这一行、且 ensureSession 会去开记忆档。
//
// 跑法：node scripts/test-memory-routing.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MEMORY_ROUTING_DEFAULTS,
  normalizeMemoryRouting,
  memoryStoreFor,
  memoryRoutingLine,
  fishMemoryConfigPath,
  enableFishMemorySession,
} from '../src/memory-routing.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let 过了 = 0
const ok = (label) => { 过了 += 1; console.log(`✅ ${label}`) }

// ── 归一化 ────────────────────────────────────────────────────────────────
const 默认 = normalizeMemoryRouting(undefined)
assert.deepEqual(默认, { ...MEMORY_ROUTING_DEFAULTS, fishChats: [...MEMORY_ROUTING_DEFAULTS.fishChats] })
assert.equal(normalizeMemoryRouting({ enabled: 'no' }).enabled, true, '只有显式 false 才关')
assert.equal(normalizeMemoryRouting({ enabled: false }).enabled, false)
assert.deepEqual(normalizeMemoryRouting({ fishChats: ['  private:1  ', ''] }).fishChats, ['private:1'], '去空白、去空项')
assert.deepEqual(normalizeMemoryRouting({ fishChats: 'private:1' }).fishChats, [...MEMORY_ROUTING_DEFAULTS.fishChats], '类型不对回落默认')
assert.equal(normalizeMemoryRouting({ mnemonScope: 'whatever' }).mnemonScope, 'groups')
assert.equal(normalizeMemoryRouting({ mnemonScope: 'off' }).mnemonScope, 'off')
ok('归一化：默认值 / 类型回落 / 显式关闭')

// ── store 判定 ────────────────────────────────────────────────────────────
const 配置 = { enabled: true, fishChats: ['private:2456904811'], mnemonScope: 'groups', mnemonSpace: 'QQ 群聊记忆' }
assert.equal(memoryStoreFor('private:2456904811', 配置), 'fish')
assert.equal(memoryStoreFor('group:1128664189', 配置), 'mnemon')
assert.equal(memoryStoreFor('private:999', 配置), 'none', '其它私聊不归这两个库')
assert.equal(memoryStoreFor('group:1', { ...配置, mnemonScope: 'off' }), 'none', 'mnemonScope=off 时不归 mnemon')
assert.equal(memoryStoreFor('group:1', { ...配置, enabled: false }), 'none', '总开关关掉后一律 none')
ok('store 判定：私聊→fish、群→mnemon、其它→none、开关可关')

// ── 提示词那一行 ──────────────────────────────────────────────────────────
const 私聊行 = memoryRoutingLine('private:2456904811', 配置)
assert.match(私聊行, /fish-memory/)
assert.match(私聊行, /`remember`/)
assert.match(私聊行, /`qq_memory_\*` 只当/, '必须明确说短期笔记，不然模型两边都写')
const 群行 = memoryRoutingLine('group:1128664189', 配置)
assert.match(群行, /mnemon/)
assert.match(群行, /QQ 群聊记忆/, '点名 Memory Space')
assert.equal(memoryRoutingLine('private:999', 配置), '', '不归它的会话一个字都不加')
ok('提示词：私聊/群各一条、点名库与空间、其它会话不加')

// ── fish-memory 配置写入 ─────────────────────────────────────────────────
{
  const 临时 = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dsh-fishmem-'))
  const env = { DSH_HOME: 临时 }
  assert.equal(fishMemoryConfigPath(env), path.join(临时, 'fish-memory-config.json'))

  // 文件不存在 → 新建
  const a = enableFishMemorySession('session-A', { env })
  assert.equal(a.changed, true)
  assert.equal(a.path, path.join(临时, 'fish-memory-config.json'))
  // 再来一次 → 幂等，不重写
  assert.equal(enableFishMemorySession('session-A', { env }).changed, false)
  // 别的会话要保留
  const 文件 = path.join(临时, 'fish-memory-config.json')
  const 内容 = JSON.parse(fs.readFileSync(文件, 'utf8'))
  assert.deepEqual(内容.sessions, { 'session-A': true })
  enableFishMemorySession('session-B', { env })
  const 内容2 = JSON.parse(fs.readFileSync(文件, 'utf8'))
  assert.deepEqual(内容2.sessions, { 'session-A': true, 'session-B': true }, '已有会话不能被覆盖')
  // 坏文件 → 当空对象重来（不把整个插件配置炸掉）
  fs.writeFileSync(文件, '{ 这不是 json', 'utf8')
  const c = enableFishMemorySession('session-C', { env })
  assert.equal(c.changed, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(文件, 'utf8')).sessions, { 'session-C': true })
  // 没有会话 id → 不动文件
  const d = enableFishMemorySession('', { env })
  assert.equal(d.changed, false)
  assert.match(d.reason, /没有会话 id/)
  fs.rmSync(临时, { recursive: true, force: true })
}
ok('fish-memory 配置：幂等、保留他人会话、坏文件降级、空 id 不写')

// ── 工具闸门 ─────────────────────────────────────────────────────────────
{
  const 源 = fs.readFileSync(path.join(ROOT, 'plugins/qq-agent-presets/qq-tool-restrict.mjs'), 'utf8')
  for (const 名 of ['remember', 'mnemon_memory_bodies', 'mnemon_memory_body_create', 'mnemon_remember', 'mnemon_recall']) {
    assert.ok(源.includes(`'${名}'`), `${名} 要在放行名单里`)
  }
  assert.match(源, /if \(SAFE_MEMORY_TOOLS\.has\(name\)\) return/, 'guard 要真的放行')
  for (const 危险 of ['mnemon_forget', 'mnemon_document_manage', 'mnemon_view_action', 'mnemon_memory_body_update', 'mnemon_memory_body_merge', 'mnemon_link']) {
    assert.ok(!源.includes(`'${危险}'`), `${危险} 不能进放行名单`)
  }
}
ok('闸门：放行 remember / 查空间 / 建空间 / remember / recall，删除与管理面仍拒')

// ── 接线断言 ─────────────────────────────────────────────────────────────
{
  const 桥 = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8')
  assert.match(桥, /memoryRoutingLine\(key, cfg\.memoryRouting\)/, '唤醒提示词要带记忆归属行')
  assert.match(桥, /memoryRouteLine/, 'base 里要拼进去')
  assert.match(桥, /enableFishMemorySession\(sid\)/, 'ensureSession 要打开 fish 记忆档')
  assert.match(桥, /cfg\.memoryRouting = normalizeMemoryRouting\(cfg\.memoryRouting\)/, '启动时要归一化配置')
  const 例 = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'))
  assert.deepEqual(例.memoryRouting.fishChats, ['private:2456904811'], 'config 示例要写默认的私聊')
  assert.equal(例.memoryRouting.mnemonScope, 'groups')
}
ok('接线：提示词行 + ensureSession 开档 + 配置归一化 + 配置示例')

console.log(`\n🎉 记忆分流测试通过（${过了} 组断言）`)

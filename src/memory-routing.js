// QQ 会话的记忆分流：私聊进 fish-memory、群聊进 mnemon。
//
// 为什么放在桥接里：这两个记忆插件都由 DSH 宿主层挂载，但 QQ 会话的"会话/群"这一层只有桥接知道。
// 桥接能做两件插件本身做不到的事：
//   1. 把某个私聊的 DSH **会话 id** 打开成 fish-memory 的记忆档（fish-memory 只认会话 id，
//      默认全关，见 fish-memory 的 `sessions{sid:bool}`）；
//   2. 在每轮唤醒提示词里告诉模型"这次的记忆该写哪"（插件之间互相不知道对方存在）。
//
// 设计取舍（与 docs/guides/QQAGENT_MIGRATION.md 一致）：
//   · fish-memory 只开**指定私聊**；其它会话保持默认关，不会悄悄多出一个 remember 工具。
//   · mnemon 是宿主全局的，不按会话隔离；所以这里只给"写哪"的指令，不假装能做隔离。
//   · qq_memory_* 不删：它是本仓库自己的会话短期记忆（每轮注入，便宜），两个插件都在它之上。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 默认配置（`config.json` 的 `memoryRouting` 段，全部可关）。 */
export const MEMORY_ROUTING_DEFAULTS = Object.freeze({
  /** 总开关：关掉 = 不写 fish-memory 配置、也不加路由提示词 */
  enabled: true,
  /** 这些会话的长期记忆归 fish-memory（写 key，例如 "private:2456904811"） */
  fishChats: ['private:2456904811'],
  /** 群聊记忆归 mnemon（'groups' = 所有群；'off' = 不提示）。内容限定为**跑团游玩存档** */
  mnemonScope: 'groups',
  /** mnemon 里跑团存档所在的 Memory Space 名字（仅用于提示词里点名，可不填） */
  mnemonSpace: '桌游游玩存档',
  /** 该空间的 id（已知时填上，提示词会直接点名，省得模型每次去查） */
  mnemonSpaceId: '',
})

/** 归一化配置：字段缺失/类型不对时回落到默认值。 */
export function normalizeMemoryRouting(原始) {
  const 源 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始) ? 原始 : {}
  const 列表 = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : null)
  return {
    enabled: 源.enabled !== false,
    fishChats: 列表(源.fishChats) ?? [...MEMORY_ROUTING_DEFAULTS.fishChats],
    mnemonScope: 源.mnemonScope === 'off' ? 'off' : 'groups',
    mnemonSpace: typeof 源.mnemonSpace === 'string' ? 源.mnemonSpace.trim() : MEMORY_ROUTING_DEFAULTS.mnemonSpace,
    mnemonSpaceId: typeof 源.mnemonSpaceId === 'string' ? 源.mnemonSpaceId.trim() : '',
  }
}

/** 这个会话的记忆归谁：'fish' | 'mnemon' | 'none'。 */
export function memoryStoreFor(key, 配置 = MEMORY_ROUTING_DEFAULTS) {
  const c = normalizeMemoryRouting(配置)
  if (!c.enabled) return 'none'
  const k = String(key ?? '')
  if (c.fishChats.includes(k)) return 'fish'
  if (c.mnemonScope !== 'off' && k.startsWith('group:')) return 'mnemon'
  return 'none'
}

/**
 * 每轮唤醒提示词里那一行「记忆归属」。
 *
 * 为什么要写这么死：QQ 人格卡里本来就有"用 qq_memory_append 记"的旧指令（迁移自 QQAgent），
 * 不明确说"以哪个为准"，模型会两边都写、或者只写便宜的那个。
 */
export function memoryRoutingLine(key, 配置 = MEMORY_ROUTING_DEFAULTS) {
  const 归 = memoryStoreFor(key, 配置)
  if (归 === 'fish') {
    return '【记忆归属】这个会话的长期记忆用 `remember` 工具（fish-memory，一句一条，重要度 0~1）；'
      + '`qq_memory_*` 只当本次会话的短期笔记，别拿它存"以后还要用"的事。'
  }
  if (归 === 'mnemon') {
    // 群聊只存**跑团游玩存档**，不存普通闲聊（用户口径：「QQ群聊就保存桌游游玩存档就行」）。
    const c = normalizeMemoryRouting(配置)
    // 空间可能还不存在（mnemon 不会自动建）。分两种情况说清楚，别让模型自己猜：
    //   · 已知空间 id → 直接写进去；
    //   · 不知道 → 先查（只读），没有就建一个，建完用返回的 id 写。
    const 指定 = c.mnemonSpaceId
      ? `（Memory Space id：${c.mnemonSpaceId}，\`mnemon_remember\` 带上 memoryBodyId）`
      : (c.mnemonSpace
        ? `（先 \`mnemon_memory_bodies\` 查有没有「${c.mnemonSpace}」这个空间；没有就用 \`mnemon_memory_body_create\` 建一个同名的，之后 \`mnemon_remember\` 带上它的 memoryBodyId）`
        : '')
    return `【记忆归属】群里的长期记忆只存**跑团游玩存档**（进度、关键抉择与后果、登场 NPC、伏笔与未结线索），`
      + `不要存普通闲聊。写进 mnemon${指定}：用 \`mnemon_remember\` 一条记一件事；要回忆先用 \`mnemon_recall\` 查。`
      + '`qq_memory_*` 只当本群短期笔记，不要拿它存长期事实。'
  }
  return ''
}

/** fish-memory 的配置文件路径（与插件自己算的一致：$DSH_HOME 或 ~/.dsh）。 */
export function fishMemoryConfigPath(环境 = process.env) {
  const 根 = String(环境.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
  return path.join(根, 'fish-memory-config.json')
}

/**
 * 把一个 DSH 会话 id 打开成 fish-memory 的记忆档（读-改-写它自己的配置文件）。
 *
 * 为什么改文件而不是打它的 HTTP 路由：路由挂在 DSH 宿主的 webServer 上，
 * 端口要运行时发现、而且它没有鉴权；配置文件是它每 3 秒轮询重读的**权威来源**，
 * 格式也很小（`{ sessions: { <sid>: true } }`），读到坏文件就当空对象重来。
 *
 * @returns {{ changed: boolean, path: string, reason?: string }}
 */
export function enableFishMemorySession(sessionId, { env = process.env, readFile = fs.readFileSync, writeFile = fs.writeFileSync, mkdir = fs.mkdirSync } = {}) {
  const 文件 = fishMemoryConfigPath(env)
  const sid = String(sessionId ?? '').trim()
  if (!sid) return { changed: false, path: 文件, reason: '没有会话 id' }
  let 配置 = {}
  try {
    const 原文 = readFile(文件, 'utf8')
    配置 = JSON.parse(原文 || '{}')
    if (!配置 || typeof 配置 !== 'object' || Array.isArray(配置)) 配置 = {}
  } catch {
    配置 = {}
  }
  const 表 = 配置.sessions && typeof 配置.sessions === 'object' && !Array.isArray(配置.sessions) ? { ...配置.sessions } : {}
  if (表[sid] === true) return { changed: false, path: 文件 }
  表[sid] = true
  配置.sessions = 表
  try {
    mkdir(path.dirname(文件), { recursive: true })
    writeFile(文件, JSON.stringify(配置, null, 2), 'utf8')
    return { changed: true, path: 文件 }
  } catch (错误) {
    return { changed: false, path: 文件, reason: String(错误?.message ?? 错误) }
  }
}

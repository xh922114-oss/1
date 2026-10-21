# 从 QQAgent 迁移到 dsh-qq：逐项判定与落地清单

> 对象：**QQAgent**（`D:\QQAgent`，独立 Electron QQ 机器人，自研插件系统）→ **本仓库 dsh-qq**（QQ ↔ DSH 桥接）。
> 判定口径：**能在这套架构里忠实落地的就迁，落不了地的逐条写清理由**，不硬凑。
> 迁移时间：2026-10-21；QQAgent 侧版本 `0.4.0`，本仓库从 `1.0.3` 起（第一轮 → v1.1.0，插件轮 → v1.2.0，见 [CHANGELOG](../../CHANGELOG.md)）。
> 出处与许可：QQAgent 以 MIT 发布（作者 Kondius），迁移过来的数据表与算法文件头都标了出处。

---

## 一、一句话结论

QQAgent 那 28 个扩展里，**多数能力本仓库已经有更完整的实现**（记忆、黑话、表情包、语音、主动搭话、
人格卡、管理通道、令牌账本），真正缺的只有几类：**模型信息（价目 / 看图判定）、可复核的掷骰、
跑团主持人人格、群风格自适应、把网上的图发出去、入站语音转文字**。

本次迁移分两轮落地：第一轮是"不用动运行时"的四样（模型价目表、看图判定表、掷骰工具、守秘人人格卡）；
第二轮把**插件**也迁了，并按"功能相同就合并"的原则，把 18 个插件归成 **11 个合并组**
（见第二节·补），其中三组真正落了代码：**群风格自适应（G1）、发网图（G2）、入站语音转文字（G8）**。

剩下的（分享卡片解析、定时内容源、账号对外写操作）**没有迁**，理由与将来的落点写在第四节 ——
它们要么会动到安全边界，要么得改入站消息链路，不该顺手塞进来。

## 二、迁移落地的四件事

| 落地物 | 文件 | 开关 / 用法 | 回归测试 |
| --- | --- | --- | --- |
| 模型价目表（140 个模型） | `src/model-prices-table.js`（生成文件）+ `src/model-prices.js` 合并 | 默认生效；`config.json` 的 `pricing.models` 覆盖项优先 | `scripts/test-token-usage.mjs` |
| 逐模型峰谷倍率 | `src/model-prices.js` 的 `ratesAt()` | 迁移行自带 `peakMultiplier`（非 DeepSeek 系为 1） | 同上 |
| 看图判定表（54 模型 + 21 渠道） | `src/model-vision-table.js`（生成文件）+ `src/dsh-model.js` | 默认**不生效**；开 `config.json` → `dsh.visionFromReference: true` 才参与 | `scripts/test-dsh-model.mjs` |
| 掷骰与检定工具 | `src/dice.js` + `src/mcp-snowluma-safe.js` 的 `qq_roll_dice` / `qq_check` | 默认开；控制台「二代工具开关」或 `socialV2.tools.rollDice: false` 关掉 | `scripts/test-dice.mjs` |
| 跑团主持人人格卡 | `roles/守秘人.md`（4788 字符） | 群里说「进入角色扮演：守秘人」或控制台点选 | `scripts/test-role-card.mjs` |

## 二·补、插件迁移：18 个插件 → 11 个合并组

QQAgent 的插件是"确定性型"（靠 `providers` / `hooks` 生效），本仓库没有这两种扩展点，
所以不能一比一搬。按**功能**归并后只有 11 组，其中 3 组真正落地、4 组由现有实现覆盖、
4 组明确舍弃。合并的理由写在"为什么这样归"一列。

| 合并组 | 并进来的插件（原个数） | 这是什么功能 | 判定 |
| --- | --- | --- | --- |
| **G1 群风格** | `adaptive-group-style`（1） | 统计本群句长/标点/节奏/口头语，每轮发言前注入 | ✅ **已迁移**（统计引擎原样移植 + 桥接注入） |
| **G2 发网图** | `pixiv-illust`（1）+ 同类 4 个 skill（`smart-image` / `search-image` / `reply-meme` / `whale-memes`） | "找一张图并发出去" | ✅ **已迁移**（新增 `qq_send_image_url`；图源交给 `web_search`/`web_fetch`） |
| **G3 入站语音转文字** | `speech-to-text-qq`（1） | 别人发的语音 → 文字，进上下文 | ✅ **已迁移**（默认关；拿不到就还是 `[语音]`） |
| **G4 记忆与上下文** | `conversation-memory`、`trpg-compaction`、`token-saver`、`trpg-reply-guard`（4） | 记住人、压缩上下文、省 token、抢救弱回复 | ⏭ 由现有实现覆盖（会话记忆 + 人物库 / DSH 压缩 / 注册期工具开关 + 结果裁剪 / 二代一切皆工具） |
| **G5 表情与贴图** | `sticker-memory`（1） | 记住表情含义、不重复看图 | ⏭ 由现有实现覆盖（`qq_sticker_note` + 按需看图 + 表情库注入） |
| **G6 主动搭话** | `silence-ping`（1） | 闲置时决定要不要主动开口 | ⏭ 由现有实现覆盖（`socialV2.proactive` 闲置随机唤醒） |
| **G7 人格守卫** | `persona-guard` + `persona-guard_1`（2，同 id 字节级重复） | 防止角色卡悄悄改人格 | ⏭ 合并为一条并舍弃：本仓库人格来自 `roles/*.md`，AI 没有文件工具，病灶不存在 |
| **G8 主人识别** | `owner-identity`（1） | 按 QQ 号认定管理员并切规则 | ⏭ 由现有实现覆盖（`ownerQQ` + 管理通道 + 模式分级） |
| **G9 账号对外写操作** | `mood-qzone`、`qq-self`（2） | 改签名/发空间/改资料/换头像 | ❌ 舍弃：需要新增 `set_self_longnick`/`send_qzone_msg`/`set_qq_avatar` 这类**对外写**动作，超出动作子集 |
| **G10 分享卡片解析** | `share-card`（1） | 解析分享链接/卡片进上下文（另含自动同意好友请求） | 🕒 未迁（可迁的是解析部分，落点见第四节第 2 条；自动同意请求不做） |
| **G11 定时内容源** | `bili-daily`、`hot-trend-tracker`（2） | 定时抓推荐/热搜，发群或进知识库 | 🕒 未迁：本仓库没有 cron（只有闲置随机唤醒），落点见第四节第 3 条 |

> 账目对得上：18 个插件（含 1 个重复）→ 11 组 = 3 组已迁移 + 4 组由现有实现覆盖 + 2 组待做 + 2 组舍弃（G7 合并后舍弃、G9 舍弃）。

### G1 群风格自适应（`adaptive-group-style`）

- **迁了什么**：QQAgent 的 `style-engine.js`（纯统计层，**不 import 任何宿主模块**）原样搬进
  `src/social/group-style-engine.js`，算法与阈值一个字没改；新增适配层
  `src/social/group-style.js`（消息窗口 → 统计行 → 档案缓存 → 提示词片段）。
- **为什么能原样搬**：上游这个文件本来就是为了"换宿主"写的（文件头三条设计约束写得很清楚），
  输入输出都是普通对象 —— 换宿主只是换喂进来的数据形状。
- **接在哪**：桥接单独维护一份风格样本窗口（与黑话窗口分开，默认 400 条），
  在 `withSlangContext()` 里作为**独立一段**注入，排在黑话表之后、本轮消息之前；
  末尾保留上游那句"底线不变：人设、安全规则、工具用法都照旧，这里只调**说法**" ——
  与本仓库"人格层/仿真层分工"完全一致。
- **闸门与默认值**：`socialV2.style`（`enabled` 默认 `true`、`sampleSize: 400`、`minSample: 30`、
  `adoptLevel: '贴近（推荐）'`、`learnMinutes: 30`、`maxChars: 900`）。
  样本不足（少于 `minSample` 条）时**什么都不注入** —— 宁可不说，也不拿噪音教模型说话。
- **与上游的差别**：上游的"夜间复盘（语气软化/梗）"没有迁 —— 那需要另一个定时学习会话，
  属于 G11 那类定时能力；上游的 `chatKeys` 也没有迁（本仓库用白名单群 + 开关）。
- **测试**：`scripts/test-group-style.mjs`（窗口→行、样本不足不注入、学出风格、口径差异、
  `maxChars` 硬护栏、缓存隔离与保鲜、进攻性用语检测）。

### G2 发网图（`pixiv-illust` + 4 个配图 skill 合并）

- **真正的缺口**：本仓库原来只能发"QQ 消息里已有的图 / 收藏表情 / 自己的形象图"，
  **发不出去网上的图** —— 所以那 5 个"找图发图"的扩展搬过来全都卡在出口上。
- **补的是出口，不是图源**：新增 `qq_send_image_url`（MCP 工具）+ `/api/socialV2/send-image`（桥接路由），
  图源交给已有的 `web_search` / `web_fetch`（模型自己拿到图片直链再发）。
  这样一次迁移同时解决了 5 个扩展，还不需要把 Pixiv/搜图的脆弱抓取逻辑搬进来。
- **安全口径**（与发语音/发表情同构，逐条对着 `safe-fetch.js` 的能力做）：
  - 只认 `http/https`（本地路径、`file://`、`data:`、`ftp` 一律拒）；
  - 图片**由桥接自己抓**（`safeFetchBuffer`：DNS 固定、禁内网/链路本地/CGNAT、逐跳重定向校验、
    体积上限、只认 PNG/JPEG/GIF/WebP 魔数），**绝不把 URL 交给网关去抓**；
  - 发送走 `sendChain`（与文字/表情同序）、过 `captureSendGuard`（会话/模式/白名单）、
    出站审计、静默模式拦截、与文本共用发送限频；
  - 额外的按会话限频 `socialV2.imageSend`（默认 **2/分、10/时**，单张 8 MB）——
    被拦下的尝试不烧额度，也不浪费一次抓图；
  - **默认关闭**（`socialV2.tools.sendImageUrl: false`）：新增的对外内容类型，值得先看一眼再开。
- **测试**：`scripts/test-image-send.mjs`（成功路径、只认 http(s)、抓不到/不是图片给人话、
  限频且不浪费抓图、路由与工具接线齐全）。

### G3 入站语音转文字（`speech-to-text-qq`）

- **迁的是什么**：上游把 QQ 侧自带的语音转写（OneBot `fetch_ptt_text`）写进消息存档；
  本仓库原来只在自己发完语音做回读实验时用过这个动作（注释里写明"自己发的语音不会产生转写"，
  正好说明它是给**别人发的**语音用的 —— 也就是入站场景）。
- **怎么接**：`segmentsToText()` 的 `record` 段支持 `options.resolveRecordText`，
  入站渲染时按 `message_id` 问一次转写（同一条语音在两次渲染里共用一次请求，缓存 10 分钟），
  拿到就渲染成 `[语音：…]`，拿不到仍是 `[语音]`。
- **闸门与默认值**：`socialV2.voice.transcribeIncoming`（**默认 `false`**）、
  `transcribeTimeoutMs`（默认 8000ms）。**默认关**的原因写在代码注释里：
  这条链路没有在真实 QQ 上验证过（要真有人发语音才能验），且它会为每条语音多发一次网关请求；
  超时/报错一律静默降级，失败原因只进桥接日志。
- **测试**：`scripts/test-voice-transcribe.mjs`（请求形状、`retcode=100` 按失败处理、
  超时/500/坏 JSON 不抛、缺参数不发请求、渲染与截断）。

### 1. 模型价目表（140 个模型）

- **迁了什么**：QQAgent `src/model-prices.js` 的 `OFFICIAL_PRICES` —— 140 个模型的
  输入/输出/缓存命中价（元 / 百万 token）、逐模型峰谷倍率、以及每条的价格来源分级
  （`official` = 取自厂商官方定价页；`derived` = 官方页拿不到、按公告折算）。
- **怎么接的**：迁移行铺底，本仓库自己维护的 5 条 DeepSeek 行**覆盖同名项**（口径以本仓库为准）。
  迁移行一律带 `reference: true`，账本把这部分金额标成「官方参考价」——**走中转站时实际单价通常与官方不同**，
  不能当真账。
- **为什么值得**：本仓库原来的表只有 5 条 DeepSeek 行，任何别的模型都按 flash 兜底价估算并标 `estimated`。
  现在这 140 个模型能算准参考价，控制台的「当前生效的价目表」也能看到逐模型峰谷倍率。
- **没有迁的**：QQAgent 的图片计费口径（`image.maxTokensPerImage` 等）只作为注释保留 ——
  本仓库的账本没有「图片 token」这个桶，加桶要改 `token-ledger.js` 的计费模型，属于另一件事。

### 2. 看图判定表（能不能看图）

- **迁了什么**：QQAgent `src/model-vision-docs.js` 的 `MODEL_DOCS`（54 条模型级判定，33 条"能看图"）
  与 `PROVIDER_DOCS`（21 条渠道级判定）。
- **为什么默认关**：本仓库原有的 `KNOWN_VISION` 只认「提供方/模型」这一对，理由是
  **命名相同 ≠ 端点相同**（`src/dsh-model.js` 里写得很清楚）。QQAgent 的模型级判定是跨渠道的，
  直接生效会把这条安全性质悄悄推翻。所以做成 `dsh.visionFromReference`（默认 `false`）。
- **打开后的行为**：命中"不能看图"就精确提示（而不是笼统的"未知"），命中"能看图"就把图片真的交给模型；
  控制台的「看图能力」手动开关**永远优先**于这两张表。

### 3. 掷骰与检定（`qq_roll_dice` / `qq_check`）

- **迁了什么**：QQAgent `skills/trpg-dice` 的全部算法与输出文案 ——
  骰点表达式（`3d6+2` / `2d20kh1` / `4d6dl1`）、COC 7 版检定（奖励骰 / 惩罚骰 / 六级成功等级 /
  大失败口径 / 可选 `fumbleFree`）、DND 5e 检定（优势 / 劣势 / DC / 自然 20 与 1）、暗骰。
- **为什么必须是 MCP 工具**：`qq-chat` / `qq-chat-v2` 预设**不挂任何本地工具**
  （RULES.md 第 48 行），脚本、pwsh 在群会话里根本不可用；所以本仓库里"模型能调用的能力"只能是 MCP 工具。
  顺带这也满足 QQAgent 的原意：**骰子必须由程序用密码学随机数掷出，模型编不了数字**。
- **和原版的两处差别**（都在文件头注明）：QQAgent 的 `chatKeys`（只在指定会话生效）没有迁，
  本仓库用白名单群 + 工具开关管这件事；随机源做成可注入，离线测试因此能给出确定的点数。
- **Token 成本**：两个工具的描述会随每次请求发送（约 200 字符），默认开是因为跑团离不开它；
  不跑团的部署可以在控制台一键关掉（注册期生效，关掉就不占上下文）。

### 4. 跑团主持人人格卡（`roles/守秘人.md`）

- **迁了什么**：QQAgent `personas/trpg-gm.md`（291 行）的精华，按本仓库 `roles/README.md` 的规范重写：
  只留「你是谁 / 怎么带团 / 怎么说话」，**删掉了所有工具调用语法与分条机制**（那是仿真提示词层的活），
  并从 17.9 KB 压到 **4788 字符**（默认注入上限 6000，推荐区间 3000~5000）。
- **保留的核心**：掷骰铁律（不许编数字）、**NPC 必须每回合自己行动**（原卡最重的一节）、
  群聊跑团"等所有玩家表态再一次性结算"、COC 六级成功的叙事信息量、DND DC 参考、
  「是，而且……」「失败前进」、不替玩家做决定、公平、开场与收尾、边界。
- **用法**：`/role 守秘人` 或控制台「人格与角色」点选。工具名只提到 `qq_roll_dice` / `qq_check` 两个
  计算工具（两种模式通用），没有写任何分条/发送机制。

## 三、逐项判定（QQAgent 18 个插件 + 10 个 skill）

判定含义：**已覆盖** = 本仓库有更完整的实现，不迁；**已迁移** = 本次落地；**舍弃** = 落不了地，
理由见"为什么"；**待做** = 值得迁但需要动其它链路，方案见第四节。

### 插件（`plugins/`，确定性型：providers / hooks）

| QQAgent 插件 | 它干什么 | 判定 | 为什么 |
| --- | --- | --- | --- |
| `adaptive-group-style` | 从本地历史学群风格、夜间趋势摘要注入 prompt | **已迁移**（合并组 G1） | 纯统计层原样移植成 `src/social/group-style-engine.js`，适配层 `social/group-style.js` 在每轮唤醒时注入；夜间复盘那部分归 G11（需定时器） |
| `bili-daily` | 定时拉 B 站个性化推荐并发群 | 未迁（合并组 G11） | 本仓库没有 cron；要做得新增定时器 + 唤醒 reason，且必须走白名单审计管线（不能用它自带的 `send_group_msg` 绕过） |
| `conversation-memory` | 分层记忆 + 每轮注入碎片 + 后台整理 | 已覆盖 | 本仓库有两层且更完整：会话记忆 `state/social-v2.json`（`qq_memory_*`）+ 人物档案 `state/social/people.json`（`qq_get_person` / `qq_note_person`，带可见范围策略） |
| `hot-trend-tracker` | 定时抓热搜/热梗成本地卡片 | 未迁（合并组 G11） | 同"没有定时器"；它的消费方工具 `hot_brief` 在 QQAgent 里就已经缺失。G11 与 `bili-daily` 合并成"定时内容源" |
| `mood-qzone` | 定时改自己 QQ 签名 / 发空间说说 | 舍弃（合并组 G9） | 需要 `set_self_longnick` / `send_qzone_msg` 这类**对外写**动作，本仓库动作子集里没有（也不该顺手加）；与 `qq-self` 同组 |
| `owner-identity` | 按 QQ 号认定主人并切主人人格 | 已覆盖（合并组 G8） | `ownerQQ` + 管理通道 + 模式分级更硬：身份只认 QQ 号、模式变更只能由桥接执行（RULES.md 第 8~9 行） |
| `persona-guard` + `persona-guard_1`（同 id、字节级重复） | 防角色卡把人格悄悄改掉，快照/还原 | 合并后舍弃（合并组 G7） | 两份 `index.js` 完全相同、`id` 也一样，QQAgent 自己就会撞名；它治的是"角色卡直接写 QQAgent 配置文件"，而本仓库人格来自 `roles/*.md`、AI **没有文件工具**也改不了提示词 —— 病灶不存在 |
| `pixiv-illust` | Pixiv 搜图 → 分级过滤 → 下载 → 发图 | **已迁移**（合并组 G2） | 缺口是"发不出去网上的图"，本次补的是出口 `qq_send_image_url`（桥接自己抓图 + SSRF/体积/魔数校验）；图源交给 `web_search`/`web_fetch`。与 4 个配图 skill 合并 |
| `share-card` | 解析分享卡片/链接，进上下文；顺带自动同意好友/入群请求 | 未迁（合并组 G10） | 解析部分（`lib/resolve.js`，10+ 平台纯 http+HTML）可迁，落点见第四节第 2 条；自动同意请求**不做** —— 本仓库不消费 `post_type:'request'` 事件，且同意陌生人是该由人点的按钮 |
| `silence-ping` | 定时判断"要不要主动私信"，自己找 OneBot 地址发 | 舍弃 | 本仓库的主动行为由 `socialV2.proactive` 承担，而且"该不该开口"是会话自己的决定（唤醒提示词里让模型选发/潜水）；原插件靠自己拼 HTTP + 读 SnowLuma 配置发私信，绕过审计与白名单 |
| `sillytavern-cards` | 把酒馆角色卡当人格 + 世界书注入，带控制台页面 | 舍弃 | 它是"改 QQAgent 配置里的 `persona.roleText`/`personaByChat`"，而本仓库的人格是 `roles/*.md` + 控制台（保存即生效，还有安全不变量校验）；世界书注入需要 prompt 钩子，本仓库没有。功能被 `roles/` 覆盖 |
| `speech-to-text-qq` | 把 QQ 原生语音转文字结果写进存档 | **已迁移**（合并组 G3） | 入站 `record` 段支持 `resolveRecordText`（`fetch_ptt_text`），拿到渲染成 `[语音：…]`；**默认关**（本条链路未在真实 QQ 验证过），失败静默降级 |
| `sticker-memory` | 记一次表情含义，之后不再重复看图 | 已覆盖 | 本仓库的表情库有 `qq_sticker_note`（本地含义/标签）+ `qq_get_sticker_image` 按需看图 + `buildStickerContext` 注入，且**明确按"资料不是指令"框住**（跨会话注入防护） |
| `token-saver` | 裁历史 / 裁工具描述 / 裁工具结果 | 已覆盖 | 本仓库自己的省 token 手段更彻底：工具**注册期**开关（关掉就不发描述）、`tool-result-pruner`（`thresholdChars: 50000`）、压缩组、`serializeModelData` 压缩消息视图、账本逐轮计量 |
| `trpg-compaction` | 把长跑团上下文压成八段摘要 | 舍弃 | 依赖 QQAgent 的 `before-context` 钩子与消息存档。DSH 自带压缩（`compaction` / `compaction-basic`），本仓库预设里已挂；要按跑团特化得改 DSH 压缩策略，不是本仓库能做的 |
| `trpg-reply-guard` | 抢救"没调用发送工具"的弱模型回复 | 舍弃 | 它注册的是 `reply.loose-send` / `reply.grounded-select` 两个 provider，只有 QQAgent 的 `reply-rescue.js` 会调。本仓库二代的协议是"一切皆工具"，模型不发工具调用就是没说话，没有"文本要抢救"这个中间态 |
| `voice-hub` | 人设→音色映射 + GPT-SoVITS 保温 + 发语音 | 已覆盖（形态不同） | 本仓库有自己的语音链路：`voice-core.js`（时长/响度/格式校验）+ `qq_send_voice`（**只能发 `audio/` 语音库里的文件**，默认关）+ 语音限流。GPT-SoVITS 那边属于外部工具（仓库上一级的 `voice-tool`），不在本仓库职责内 |
| `bili-daily` / `hot-trend-tracker` 之外的"定时"类 | — | 舍弃 | 见上：本仓库没有 cron，主动行为只有闲置随机唤醒 |

### Skill（`skills/`，LLM 型：registerTool + 提示词片段）

| QQAgent skill | 它干什么 | 判定 | 为什么 |
| --- | --- | --- | --- |
| `trpg-dice` | 掷骰 + COC/DND 检定 | **已迁移** | 见第二节第 3 条：`src/dice.js` + `qq_roll_dice` / `qq_check`，算法与文案原样移植，随机源换成可注入以便测试 |
| `agent-reach` | 本地 CLI 读网页 / B 站搜索 / RSS | 舍弃 | 三个工具的核心是 fetch + 正则剥 HTML，本仓库已有 SSRF 加固的 `mcp__web-search-safe__web_search` / `web_fetch`（`safe-fetch.js`：禁内网、逐跳校验、限量读取）。原 skill 还硬编码了一个 `D:\qqagent\...\agent-reach.exe` 路径，迁过来只会多一条绕开安全网的通路 |
| `bilibili` | CDP 驱动真浏览器操作 B 站账号（登录/刷视频/评论） | 舍弃 | 11 个工具 + Edge/Chrome CDP + cookie 文件 + 二维码经 `ctx.sender` 发图。**本仓库不发"网上的图"**，也不该让群会话去驱动一个登录着真人账号的浏览器（RULES.md 第 48 行：群会话无本地工具） |
| `heybox` | 同上，小黑盒 | 舍弃 | 同上（且"把草稿/分享发到群里"这件事本身可以由模型用发送工具做） |
| `qq-self` | 自主改空间/资料/头像 | 舍弃 | 依赖 `set_self_longnick` / `send_qzone_msg` / `set_qq_avatar`，本仓库动作子集里没有；对外写账号资料属于账号操作，不是聊天 |
| `reply-meme` | 按关键词/情绪挑梗图发出去 | **已迁移**（合并组 G2） | 并进 G2：发图出口是 `qq_send_image_url`；"按情绪挑图"由图源（搜索/网页）+ 模型判断完成 |
| `search-image` | 关键词搜图发图 | **已迁移**（合并组 G2） | 并进 G2（图源 apihz → 改为 `web_search` 拿直链 + `qq_send_image_url` 发送） |
| `smart-image` | 多源找图 + Pixiv/ACG 兜底 | **已迁移**（合并组 G2） | 并进 G2；注意"只返回图片 URL 的文字工具在 QQ 里等于没用"，所以必须连发送通路一起做 —— 本次正是这么做的 |
| `whale-memes` | 按情绪挑梗鲸表情包发出去 | 已覆盖（合并组 G5） | 本仓库表情链路更懂 QQ（收藏同步、一条一张、可引用可 @、备注作资料注入、收藏限流）；"梗鲸图库"如需保留，用 G2 的发图出口 + 直链即可 |
| `account-pool` | 多个 LLM 端点轮换 + 权重 + 冷却 | 舍弃 | 它实现的是 QQAgent `llm.endpoint-pick` 契约；本仓库的模型由 DSH 的 `session.selectModel` 决定，没有可插的端点池。真要轮换是 DSH provider 层的事 |

### 模型信息

| QQAgent 的模型信息 | 判定 | 落点 |
| --- | --- | --- |
| 官方价目表（140 模型：输入/输出/缓存命中，元/百万 token） | **已迁移** | `src/model-prices-table.js` + `src/model-prices.js` |
| 逐模型峰谷价（QQAgent 只有 DeepSeek 系有） | **已迁移** | 迁移行的 `peakMultiplier`（非 DeepSeek 系为 1，即不涨价） |
| 视觉能力判定（54 模型 + 21 渠道） | **已迁移**（默认关） | `src/model-vision-table.js` + `config.json` → `dsh.visionFromReference` |
| 渠道与模型清单（2 个渠道 / 41 个模型 id） | 舍弃 | 那是 QQAgent 自己的渠道配置（含中转站网关地址与密钥）。本仓库的模型来自 DSH 的模型目录（`session.modelCatalog`），渠道与密钥归 DSH 的 provider 配置管。密钥**不迁移** |
| 默认模型 / 备用模型链 / 温度 / 思考档位 | 舍弃 | 本仓库由 `config.json` 的 `dsh.{provider,model,reasoningEffort}` + 控制台联动下拉决定，并且会拿 DSH 目录做硬校验；QQAgent 的"备用模型链"在 DSH 侧没有对应概念 |
| 图片计费口径（`image.maxTokensPerImage` 等） | 部分迁移 | 作为注释留在价目表里；账本没有图片桶，要算图片钱得先改 `token-ledger.js` 的计费模型 |

## 四、没有迁、但值得做的四件事（含落点）

按"改动面从小到大"排；每一条都写清**放哪个文件、过哪道闸门、哪些测试要跟着改**。

### 1. 让机器人能发"网上找的图"（Pixiv / ACG / 搜索图源）

这是 QQAgent 那批 skill 里**最值钱、也是本仓库唯一真正缺的**能力。
现状：本仓库能发的图只有三种——QQ 消息里已有的图、表情收藏、自己的形象图；
出站消息段类型只有 text / at / reply / image(表情) / record，**没有"按 URL 或本地路径发图"的通路**。

建议落点（与语音同构，照抄 `qq_send_voice` 的安全模型最省事）：

1. `src/bridge.js`：新增 `/api/send/image`（或挂在既有发送端点上加 `imageUrl` 段），
   必须过 `allow.groups/private` 白名单 + `auditAndSend` + 发送限流；
2. 取图**只经 `src/safe-fetch.js`**（http/https、禁内网/CGNAT/带凭据 URL、逐跳校验、限量读取），
   加体积/像素/张数上限（可照 `socialV2.media` 的 8 MB / 64 MP / 5 张）；
3. `src/mcp-snowluma-safe.js`：新增 `qq_send_image_url`（flag `sendImageUrl`），
   **默认关**（与 `sendVoice` 一致 —— 这是对外发送新内容类型，值得让人先看一眼再开）；
4. 图源做成**只读**工具（`qq_find_image`：lolicon / 搜索图源），返回候选 URL 交给发送工具，
   两个动作分开就天然带上了"模型先看到图再决定发不发"；
5. 测试：`test-audit-security-mcp.mjs`（白名单/SSRF）、`test-media-search.mjs`、`test-mcp-servers-stdio.mjs`，
   以及 RULES.md 第 52 行的发送工具清单要补上这个新工具。

**不做成"返回 URL 的文字工具"的理由**：QQ 里发一条图片链接对群友毫无意义，等于没有这个能力。

### 2. 分享卡片 / 链接解析（QQAgent `share-card` 的 `lib/resolve.js`）

现状：入站 `json` 段只渲染成 `[卡片消息]`，标题与链接都丢了。
落点：`src/bridge.js` 的 `segmentsToText()` / `extractMediaFromSegments()`（`bridge.js:1331`、`1414`）——
把解析结果**追加进消息文本**（走 `safe-fetch` 抓取，失败就保留 `[卡片消息]`），
不要做成"模型再去调一次工具"，那样每张卡片都会多一次往返。
测试：`test-audit-bridge.mjs`（段渲染）、`test-media-search.mjs`。

### 3. 定时推送（QQAgent `bili-daily` / `hot-trend-tracker`）

现状：主动行为只有闲置随机唤醒，且 `schedule_*` 类工具被 restrict 名单挡住。
落点：桥接自己起一个定时器 → 构造一次 `reason: 'proactiveCheck'` 之外的专用唤醒
（新 reason 要同时改 `TIMER_WAKE_REASONS`、唤醒限频 `maxWakePerHour`、以及 v2 唤醒提示词的尾部文案）。
**不建议**把 DSH 的 `schedule_*` 工具开放给群会话：那等于给了群会话一个本地调度能力，与第 48 行的边界冲突。

### 4. 入站语音转文字（QQAgent `speech-to-text-qq`）

现状：入站 `record` 段渲染成 `[语音]`；`fetch_ptt_text` 本仓库已在用（`bridge.js:1958`、`6145`，只为自己发的语音做回读）。
落点：入站渲染时对 `record` 段调一次 `fetch_ptt_text`，拿到文字就渲染成
`[语音：<转写>]`，拿不到就仍是 `[语音]`（SnowLuma 对**别人**发的语音是否回转写需要实测，
`fetch_ptt_text` 在群里不一定给结果——这一条要先做一次真实环境探针，别照文档写死）。

## 五、怎么验证这次迁移

```bash
# 全量离线回归（不发 QQ、不用生产凭据）
npm run test:audit

# 各块迁移的测试
node scripts/test-dice.mjs              # 掷骰：表达式 / COC 六级 / DND 优势劣势 / 暗骰
node scripts/test-token-usage.mjs       # 价目表：合并、峰谷、参考价标记
node scripts/test-dsh-model.mjs         # 看图判定：默认不生效 + 开关打开后的行为
node scripts/test-role-card.mjs         # 人格卡：解析 + 注入上限
node scripts/test-group-style.mjs       # G1 群风格：样本门槛 / 渲染 / 缓存
node scripts/test-image-send.mjs        # G2 发网图：协议白名单 / 抓图 / 限频 / 接线
node scripts/test-voice-transcribe.mjs  # G3 入站语音：请求形状 / 失败降级 / 渲染

# 改了 preset / 控制台后（本次没改 preset，不必跑）
node scripts/build-agent-preset-patches.mjs && node scripts/setup-dsh.mjs
```

改动生效方式：

| 改的东西 | 生效方式 |
| --- | --- |
| 价目表 / 看图判定 | 重启桥接（`config.json` 级） |
| `socialV2.tools.rollDice` / `sendImageUrl`（工具开关） | **重启 DSH**（工具清单在注册期读取） |
| `socialV2.style`（群风格） | 重启桥接（样本窗口随之重建） |
| `socialV2.voice.transcribeIncoming` | 重启桥接 |
| `socialV2.imageSend`（发图限频/体积） | 重启桥接 |
| `roles/守秘人.md` | 立即生效（人格层每条消息注入） |
| `dsh.visionFromReference` | 重启桥接 |

## 六、取舍原则（写给下一个迁移的人）

1. **能不过安全边界，就不动安全边界**。本仓库把"群会话没有本地工具、发送必过白名单、
   联网只走 SSRF 加固的 MCP"当成硬不变量（RULES.md 第 46~57 行）。凡是需要给群会话开一个
   新出口的迁移，都要单独设计闸门与测试，不能顺手开。
2. **有更完整的实现就不迁**。记忆、表情、黑话、语音、主动搭话这些，本仓库都比 QQAgent 做得深，
   迁过来只会换来两套并存的状态。
3. **提示词是最好迁的资产**。QQAgent 的价值很大一部分在文案与规则里（掷骰铁律、NPC 行动、
   失败前进），这些不依赖任何运行时，本次已经分别落进 `roles/守秘人.md`（人格层）与工具描述（能力层）。
4. **数据要留出处与可信度标记**。价目表的 `source`、看图表的 `note`、`reference: true` 都保留着 ——
   迁移的数据最怕的是"看起来像真的"，而这些标记让"这是参考价 / 这是断言不是探测"一直挂在数据上。

# v1.2.0 发布说明 —— 插件迁移（功能相同的合并）

发布日期：2026-10-21 ｜ 上一版：[v1.1.0](RELEASE_NOTES_v1.1.0.md)

v1.1.0 迁的是"不用动运行时"的四样（价目表 / 看图判定 / 掷骰 / 守秘人人格卡）。
这一版迁的是**插件**：QQAgent 的 18 个插件按功能归成 **11 个合并组**，其中三组落了代码。

逐项判定与合并表：[docs/guides/QQAGENT_MIGRATION.md](../guides/QQAGENT_MIGRATION.md)（第二节·补）。

## 三个合并组落了地

| 合并组 | 并进来的 | 落地物 | 默认 |
| --- | --- | --- | --- |
| **G1 群风格** | `adaptive-group-style` | `src/social/group-style-engine.js`（原样移植）+ `group-style.js`（适配层）+ 每轮提示词注入 | 开（`socialV2.style`） |
| **G2 发网图** | `pixiv-illust` + `smart-image` / `search-image` / `reply-meme` / `whale-memes` | `qq_send_image_url` + `/api/socialV2/send-image` | **关**（`socialV2.tools.sendImageUrl`） |
| **G3 入站语音转文字** | `speech-to-text-qq` | `src/voice-transcribe.js` + `segmentsToText` 的 `record` 富化 | **关**（`socialV2.voice.transcribeIncoming`） |

### 为什么这三组能迁

- **G1 能原样搬**：上游那个统计引擎本来就是为"换宿主"写的（文件头写明不 import 任何宿主模块），
  算法与阈值一字未改；本仓库只需要喂给它消息窗口，并在拼每轮提示词时插一段。
- **G2 缺的是出口不是图源**：本仓库原来发不出"网上的图"，所以那 5 个扩展搬过来全卡在这一步。
  补上出口后，图源交给已有的 `web_search` / `web_fetch` —— 一次迁移解决 5 个扩展，还不用搬脆弱的抓取逻辑。
- **G3 走的是同一个协议动作**：本仓库早就在用 `fetch_ptt_text`（只是用于回读自己发的语音）；
  入站语音的转写正是它本来的用途。默认关是因为**没在真实 QQ 上验证过**，失败会静默降级成 `[语音]`。

## 其余 8 组：为什么不动代码

| 组 | 成员 | 判定 |
| --- | --- | --- |
| 记忆与上下文 | `conversation-memory`、`trpg-compaction`、`token-saver`、`trpg-reply-guard` | 现有实现更完整（会话记忆 + 人物库 / DSH 压缩 / 注册期工具开关 + 结果裁剪 / 二代一切皆工具） |
| 表情与贴图 | `sticker-memory` | 现有直方更强（`qq_sticker_note` + 按需看图 + 表情库注入 + 跨会话注入防护） |
| 主动搭话 | `silence-ping` | `socialV2.proactive` 闲置随机唤醒；"该不该开口"由会话自己决定 |
| 主人识别 | `owner-identity` | `ownerQQ` + 管理通道 + 模式分级更硬（身份只认 QQ 号） |
| 人格守卫 | `persona-guard` + `persona-guard_1`（同 id 重复） | 病灶不存在：人格来自 `roles/*.md`，AI 没有文件工具 |
| 分享卡片 | `share-card` | 解析部分可迁（落点见迁移文档第四节第 2 条）；自动同意好友请求不做 |
| 定时内容源 | `bili-daily`、`hot-trend-tracker` | 本仓库没有 cron（只有闲置随机唤醒），落点见第四节第 3 条 |
| 账号对外写 | `mood-qzone`、`qq-self` | 需要 `set_self_longnick` / `send_qzone_msg` / `set_qq_avatar` 这类对外写动作，超出动作子集 |

## 安全上的三个坚持

1. **不新增对外写动作**：G2 只是"发一张图"，目标仍走白名单 + 限频 + 审计 + 静默拦截；
   图片由桥接自己抓（禁内网、逐跳校验、只认图片魔数、限量），**绝不把 URL 交给网关去抓**。
2. **默认关掉可疑面**：发网图、入站语音转写都默认关；打开它们的成本与后果写在配置与文档里。
3. **宁可不说，也不注入噪音**：群风格样本不足（默认 30 条）时什么都不注入；
   语音转写拿不到就还是 `[语音]`；风格段上限 900 字符，超了截断。

## 升级

```bash
npm ci
# 重启桥接（群风格 / 语音转写 / 发图限频生效）
# 要让 qq_send_image_url 出现在模型工具表里：重启 DSH（工具清单在注册期读取），然后在控制台打开开关
```

- 数据格式没有变化，`config.json`、`state/` 原样沿用。
- 新配置项都可选：`socialV2.style.*`（默认开）、`socialV2.imageSend.*`（默认限频 2/分、10/时）、
  `socialV2.tools.sendImageUrl`（默认关）、`socialV2.voice.transcribeIncoming`（默认关）。
- 版本号 1.1.0 → 1.2.0（新增能力，语义化次版本）。

## 验证清单

```bash
npm run test:audit                     # 64 个离线脚本（本次新增 3 个）
node scripts/test-group-style.mjs      # G1：样本门槛 / 渲染 / 缓存
node scripts/test-image-send.mjs       # G2：协议白名单 / 抓图 / 限频 / 接线
node scripts/test-voice-transcribe.mjs # G3：请求形状 / 失败降级 / 渲染
```

本次仍然没有改预设（`dsh/agent-presets/`），不需要重跑 `build-agent-preset-patches.mjs`；
控制台只多了一个工具开关行。

## 许可

统计引擎与算法仍以 MIT 授权（上游作者 Kondius），出处写在文件头与 [NOTICE.md](../../NOTICE.md)。

# v1.3.0 发布说明 —— 人设迁移 + 记忆分流

发布日期：2026-10-21 ｜ 上一版：[v1.2.0](RELEASE_NOTES_v1.2.0.md)

这一版把你 QQAgent 里的**人设**搬成 `roles/*.md`，并把**记忆**按你的要求分成两个库：
私聊 `2456904811` 进 dsh-fish-memory，群聊进 dsh-mnemon。
逐项说明见 [docs/guides/QQAGENT_MIGRATION.md](../guides/QQAGENT_MIGRATION.md)（三·补、三·补2）。

## 人设：5 张卡

| 卡 | 来源 | 字数 | 需要 `role.maxInjectChars` |
| --- | --- | --- | --- |
| `小鲸鱼-默认人设.md` | `persona.roleText` | 2667 | 不用调 |
| `小鲸鱼-群友版.md` | `personaByChat["private:3247230872"]`（`3334802338` 同内容） | 6259 | ≥ 6500 |
| `小鲸鱼-私人版.md` | `personaByChat["private:2456904811"]` | 13973 | ≥ 14000 |
| `八奈见杏菜.md` | `customPersonas[0]` | 8988 | ≥ 9000 |
| `守秘人-原版.md` | `personaByChat["group:1128664189"]` + 本群规则 | 8398 | ≥ 8500 |
| `守秘人.md`（原有精简卡） | 我上一轮整理 | 4788 | 不用调 |

- 正文忠实保留，只把 **QQAgent 的工具名**换成这儿的真实工具名（`qq_send_message`、`qq_memory_*`、
  `qq_roll_dice`/`qq_check`、`mcp__web-search-safe__*` 等），否则人设里会写着一堆调不动的名字。
- **涩涩版没有迁**：它是露骨性描写的人格卡，我不代为生成。原文在
  `D:\QQAgent\data\config.json` 的 `personaByChat["group:1073022225"].roleText`，
  你在控制台「人格与角色」新建一张贴进去就行。
- 超 6000 的卡会被 `role.maxInjectChars` 截断（默认 6000）。这些卡在 QQAgent 里本来就是每条消息
  全量注入的，调大上限的成本与当时一致；不想付就用精简卡。

## 记忆：两个库，各管一半

| 会话 | 长期记忆 | 怎么落地 |
| --- | --- | --- |
| `private:2456904811` | **dsh-fish-memory** | 桥接把这个会话的 DSH session id 写进 `fish-memory-config.json` 的 `sessions[sid]=true`（插件默认全关，只开这一个），插件自己按会话注入 `【你记得的事】` |
| `group:*` | **dsh-mnemon**（空间「QQ 群聊记忆」） | 每轮提示词点名该库与空间；模型用 `mnemon_remember` 写、`mnemon_recall` 读；空间不存在时先 `mnemon_memory_body_create` |
| 其它私聊 | 本仓库的 `qq_memory_*` | 不加提示词行 |

配置 `memoryRouting`（都可关）：

```json
"memoryRouting": {
  "enabled": true,
  "fishChats": ["private:2456904811"],
  "mnemonScope": "groups",
  "mnemonSpace": "QQ 群聊记忆",
  "mnemonSpaceId": ""
}
```

## 环境侧：装了什么、没装成什么

- ✅ `dsh-fish-memory@1.1.9` 已装进 desktop profile：
  `vendor/dsh-fish-memory-1.1.9.tgz` + `dependencies` + `dsh.profile.bundles`。
  （`github:` 依赖要 `git ls-remote github.com`，这台机器不通，所以用本地 tarball 走 `file:` 依赖。）
  原三个文件备份在 `D:\deepseek\_migrate\profile-backup\`。
- ⚠️ mnemon 的「QQ 群聊记忆」空间**没建成**：本会话的 Mnemon 视图没有写授权，建空间被 Host 拒绝。
  两条路：等群里第一次写记忆时模型自己建（`mnemon_memory_body_create` 已放行），
  或你在 Mnemon 界面手动建一个，再把 id 填进 `mnemonSpaceId`（省掉模型每次查/建）。

## 三个代价 / 风险（提前说清）

1. **mnemon 不按群隔离**：所有群共用一个空间，跨群召回可能发生。要隔离就每群一个空间 + 按 key 填 id。
2. **fish-memory 每轮注入**：召回文本上限 6 条 / 800 字，并且每次注入都会写一次该会话的 JSON。
   只开一个会话，代价可控。
3. **提示词多一行**（约 40~80 token/轮），只加在归这两个库的会话上。

## 升级

```bash
npm ci
# 1) 重启 DSH（加载 dsh-fish-memory + 刷新工具清单）
# 2) 重启桥接（读 memoryRouting）
# 3) 需要大卡的话：config.json 里把 role.maxInjectChars 调到表里的值
# 4) 可选：在 Mnemon 界面建「QQ 群聊记忆」空间，把 id 填进 memoryRouting.mnemonSpaceId
```

## 验证

```bash
npm run test:audit                 # 65 个离线脚本（新增 test-memory-routing）
node scripts/test-memory-routing.mjs
node scripts/test-role-card.mjs    # 人格卡能解析、不超硬上限
```

本次仍然没有改预设（`dsh/agent-presets/`），不需要重跑 `build-agent-preset-patches.mjs`；
改的是工具闸门（`plugins/qq-agent-presets/qq-tool-restrict.mjs`），重装/重启 DSH 即生效。

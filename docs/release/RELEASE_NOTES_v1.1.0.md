# v1.1.0 发布说明 —— 从 QQAgent 迁移

发布日期：2026-10-21 ｜ 上一版：[v1.0.3](RELEASE_NOTES_v1.0.3.md)

这一版没有新的 QQ 动作、没有新的网络出口、没有放宽任何白名单：**只是把另一个 QQ 机器人
（[QQAgent](https://github.com/K0nd1us/QQ-agent)，MIT）里"我们确实缺、而且搬得过来"的四样东西搬了过来**，
其余 18 个插件 + 10 个 skill 逐条判定为什么舍弃。

完整的逐项判定、舍弃理由与"还想迁的四件事怎么落点"，见
[docs/guides/QQAGENT_MIGRATION.md](../guides/QQAGENT_MIGRATION.md)。

## 一句话：迁了什么

| 迁移物 | 落点 | 默认状态 |
| --- | --- | --- |
| 模型官方价目表（140 个模型 / 元每百万 token）+ 逐模型峰谷倍率 | `src/model-prices-table.js` → `src/model-prices.js` | 生效 |
| 「能不能看图」判定表（54 模型级 + 21 渠道级） | `src/model-vision-table.js` → `src/dsh-model.js` | **关**（要开 `dsh.visionFromReference`） |
| 掷骰与检定（COC 7 / DND 5e / 暗骰） | `src/dice.js` → `qq_roll_dice` / `qq_check` | 开（`socialV2.tools.rollDice`） |
| 跑团主持人人格卡（4788 字符） | `roles/守秘人.md` | 用人格时生效 |

## 为什么大多数没迁

QQAgent 的大部分能力，本仓库已经有更完整的实现：记忆（人物库 + 会话记忆）、表情包（收藏/备注/生成）、
黑话学习（独立的 DSH 学习会话 + 管理员确认）、语音（语音库 + 限流 + 只能发库内文件）、
主动搭话（闲置随机唤醒 + 唤醒限频）、人格（`roles/*.md` 两层提示词）、管理通道（模式分级 + 审批 + TOTP + 审计）、
省 token（工具注册期开关 + 结果裁剪 + 压缩）、账本（逐轮逐模型计价）。

真正缺的四件事（图源搜索与"发网图"、分享卡片解析、定时推送、入站语音转文字）都需要动到**本仓库的边界**，
所以这一版只写清落点、没有顺手塞进来：

- **发网图**要新开一个出站内容类型 → 必须照 `qq_send_voice` 的安全模型做（白名单 + SSRF 加固 + 体积/张数上限 + 默认关）；
- **分享卡片解析**要改入站消息渲染；**语音转文字**要先用真实环境探针确认 `fetch_ptt_text` 对别人发的语音给不给结果；
- **定时推送**要新增唤醒 reason，且不能让群会话拿到 DSH 的 `schedule_*` 工具（那是本地调度能力，与"群会话无本地工具"冲突）。

## 升级

```bash
npm ci
# 重启桥接（价目表 / 看图开关 / 人格生效）
# 要让 qq_roll_dice 与 qq_check 出现在模型工具表里：重启 DSH（工具清单在注册期读取）
```

- 数据格式没有变化，`config.json`、`state/`、`interface-platform/state/` 原样沿用。
- 新配置项都可选：`socialV2.tools.rollDice`（默认 `true`）、`dsh.visionFromReference`（默认 `false`）。
- 价目表版本标记变为 `2026-11-04+qqagent-2026-09-03`（桥接口径 + 迁移表的核对时间）。

## 验证清单

```bash
npm run test:audit            # 全量离线回归（含新增 test-dice.mjs）
node scripts/test-token-usage.mjs
node scripts/test-dsh-model.mjs
node scripts/test-role-card.mjs
```

本次没有改预设（`dsh/agent-presets/`）与 `public/console.html` 的结构，**不需要**重跑
`scripts/build-agent-preset-patches.mjs`；控制台只多了一个工具开关行。

## 许可

迁移内容仍以 MIT 授权，出处写在每个文件的文件头与 [NOTICE.md](../../NOTICE.md)；
两个生成文件（价目表、看图判定表）请连同出处一起改。

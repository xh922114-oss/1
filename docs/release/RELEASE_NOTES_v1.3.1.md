# v1.3.1 发布说明 —— 按会话选人设 + 群聊记忆收窄为跑团存档

发布日期：2026-10-21 ｜ 上一版：[v1.3.0](RELEASE_NOTES_v1.3.0.md)

两处口径修正，都是按你的实际用法收紧的。

## 1. 人设：按会话选卡（`role.byChat`）

v1.3.0 只做到了"卡放进 `roles/`"，切人设还是全局的 —— 一换所有群一起变。这一版补上按会话选：

```json
"role": {
  "maxInjectChars": 14000,
  "byChat": {
    "private:2456904811": "小鲸鱼-私人版",
    "private:3247230872": "小鲸鱼-群友版",
    "private:3334802338": "小鲸鱼-群友版",
    "group:1128664189": "守秘人-原版"
  }
}
```

查找顺序：**精确 key → `group:*` / `private:*` 通配 → `state/current-role.json` 全局角色**。
没配 `byChat` 的会话行为完全不变；`maxInjectChars` 按最大的那张卡给（私人版 13973 → 14000）。

## 2. 群聊记忆：只存桌游游玩存档

按你说的「QQ群聊就保存桌游游玩存档就行」，群聊那一行提示词现在是：

> 【记忆归属】群里的长期记忆只存**跑团游玩存档**（进度、关键抉择与后果、登场 NPC、伏笔与未结线索），
> 不要存普通闲聊。写进 mnemon（…「桌游游玩存档」…）

默认空间名也从「QQ 群聊记忆」改成「**桌游游玩存档**」——它现在是一个**跑团存档库**，不是群聊闲聊库。
私聊 `2456904811` 仍然走 dsh-fish-memory，不变。

## 还差你两步（我这边做不了）

1. **mnemon 空间没建成**：本会话的 Mnemon 视图没有写授权，`mnemon_memory_body_create` 被 Host 拒绝
   （两次都是 `Source Action is not offered`）。两条路：
   - 你在 **Mnemon 界面 → Memory System → Memory Spaces → 新建**，名字填「桌游游玩存档」，
     然后把 id 填进部署目录 `config.json` 的 `memoryRouting.mnemonSpaceId`（省掉模型每次"查/建"）；
   - 或者不管：群里第一次要写跑团存档时，模型会用已放行的 `mnemon_memory_body_create` 自己建。
2. **按会话人设的运行时配置**：本机没有找到 dsh-qq 的部署目录（没有 `config.json` / `state/`、
   也没有在跑的 `bridge.js`），所以上面的 JSON 请你贴到部署目录的 `config.json` 里；仓库里的
   `config.example.json` 只有空 `byChat: {}` 模板。

## 升级

```bash
npm ci
# 重启桥接（读 role.byChat / memoryRouting）
```

## 验证

```bash
npm run test:audit                 # 65 个离线脚本
node scripts/test-role-card.mjs    # 含「精确 key → 通配 → 全局回落」
node scripts/test-memory-routing.mjs
```

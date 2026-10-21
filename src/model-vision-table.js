// 从 QQAgent 迁移的「能不能看图」判定表。**生成文件，勿手改**。
//
// 来源：QQAgent（MIT）的 `src/model-vision-docs.js`（MODEL_DOCS / PROVIDER_DOCS）。
// 语义与 src/dsh-model.js 的 KNOWN_VISION 一致：**是断言，不是探测** ——
// 没有任何环节会去问端点收不收图；声明错了的代价是请求中途被拒。
//
// ⚠ 与 KNOWN_VISION 的关键差别：这里的**模型级**判定是跨渠道的（「这个名字的模型能看图」），
//   而 dsh-qq 原有的 KNOWN_VISION 只认「提供方/模型」这一对。命名相同 ≠ 端点相同，
//   所以模型级判定默认**不生效**，要显式打开 config.json 的 `dsh.visionFromReference`。
//   渠道级那张表（VISIONS_BY_ROUTE）的键是 QQAgent 自己的渠道 id，换到 DSH 的渠道名上
//   多半对不上，保留只为追溯来源。
//
// 核对时间 2026-09（QQAgent 注释里逐条写了来源）。模型能力会变；
// 控制台的「看图能力」手动开关永远优先于这两张表。

/** 迁移表的数据版本。 */
export const MIGRATED_VISION_VERSION = '2026-09';

/** 渠道级判定：'提供方/模型' → { vision, note }（键沿用 QQAgent 的渠道 id）。 */
export const VISIONS_BY_ROUTE = {
  "qwen-token-plan-cn/qwen3.8-max": { vision: true, note: "官方：Qwen3.8-Max 为多模态旗舰，支持图片/视频输入（单图最高 1600 万像素）。来源：platform.qianwenai.com、help.aliyun.com/zh/model-studio/vision" },
  "xiaomi-token-plan-cn/mimo-v2.5-pro": { vision: false, note: "MiMo-V2.5-Pro 无原生视觉（GitHub XiaomiMiMo/MiMo-Code#309：pro image:false）；Token Plan 网关亦返回 \"No endpoints found that support image input\"。来源：github.com/XiaomiMiMo/MiMo-Code/issues/309" },
  "xiaomi/mimo-v2.5-pro-ultraspeed": { vision: true, note: "MiMo-V2.5 基座为原生全模态（图/视频/音频理解），官方提供图片理解 API 文档。来源：mimo.xiaomi.com/mimo-v2-5、mimo.mi.com/docs 图片理解" },
  "opencode-go/deepseek-v4-flash": { vision: true, note: "DeepSeek-V4-Flash 自 2026-09 起支持图片输入（官方视觉能力并入主模型，独立视觉模型 deepseek-v4-flash-vision-exp 仍保留）。来源：api-docs.deepseek.com/zh-cn/guides/vision + 官方 API 实测（2026-09-10，文档滞后：文档仍写仅 vision-exp 收图）" },
  "opencode-go/deepseek-v4-pro": { vision: false, note: "DeepSeek V4 Pro 官方能力清单未包含图片输入；V4 系列官方视觉模型是独立的 deepseek-v4-flash-vision-exp。OpenCode Go 上游亦拒绝图片请求（探测 400）。来源：api-docs.deepseek.com、在线探测" },
  "a6api/glm-5.3-flash": { vision: true, note: "GLM-5.3-Flash 为 GLM-5 系列首个原生多模态模型，支持图片/视频输入。来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash" },
  "a6api/DeepSeek-V4-Flash-0731": { vision: false, note: "日期快照能力冻结在 07-31：不支持图片输入。主模型 deepseek-v4-flash 自 2026-09 起已支持图片，看图请换主模型。来源：api-docs.deepseek.com" },
  "a6api/deepseek-v4-pro-0813": { vision: false, note: "DeepSeek V4 Pro 正式版（0813）官方能力清单未包含图片输入；V4 系列视觉模型是独立的 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "a6api/gemini-3.7-flash": { vision: true, note: "Gemini 3.7 Flash 原生多模态：文本/图片/视频/音频/PDF 输入。来源：ai.google.dev/gemini-api/docs/models/gemini-3.7-flash、deepmind.google" },
  "a6api/gpt-5.6-sol": { vision: true, note: "GPT-5.6 Sol 支持文本+图片输入（多模态）。来源：openai.com/index/previewing-gpt-5-6-sol、artificialanalysis.ai 对比" },
  "a6api/grok-4.6": { vision: true, note: "Grok 4.6 支持 text and image input。来源：x.ai/news/grok-4-6、tryfriday.ai/blog/grok-4-6-vs-gpt-5-6-sol" },
  "a6apiforclaude/claude-fable-5": { vision: true, note: "Claude Fable 5 支持视觉（图表/PDF/图片理解）。注意：A6API 的 anthropic 协议转换可能不透传图片，实际使用请验证。来源：anthropic.com/claude/fable、platform.claude.com/docs 视觉" },
  "a6apiforclaude/glm-5.3-flash": { vision: true, note: "GLM-5.3-Flash 原生多模态。来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash" },
  "openrouter/z-ai/glm-5.3-flash": { vision: true, note: "GLM-5.3-Flash 原生多模态，支持图片/视频输入。来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash" },
  "local-8787/hy4-preview": { vision: false, note: "混元 Hy4 preview 为语言模型，不具备原生多模态；本机网关探测接受图片可能来自网关转接，效果不保证。来源：凤凰网 Hy4 preview 报道、workbuddy.cn 更新日志" },
  "local-8787/hy4-preview-x": { vision: false, note: "混元 Hy4 preview 系列为语言模型，不具备原生多模态。来源：凤凰网 Hy4 preview 报道" },
  "local-8787/glm-5.3-flash": { vision: true, note: "GLM-5.3-Flash 原生多模态。来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash" },
  "local-8787/deepseek-v4-flash": { vision: true, note: "DeepSeek-V4-Flash 自 2026-09 起支持图片输入（视觉能力并入主模型）。来源：api-docs.deepseek.com/zh-cn/guides/vision + 官方 API 实测（2026-09-10，文档滞后：文档仍写仅 vision-exp 收图）" },
  "local-8787/deepseek-v4-pro": { vision: false, note: "DeepSeek V4 Pro 官方能力清单未包含图片输入；V4 系列视觉模型是独立的 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "nvidia/deepseek-ai/deepseek-v4-pro-0813": { vision: false, note: "DeepSeek V4 Pro 正式版（0813）官方能力清单未包含图片输入；V4 系列视觉模型是独立的 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "nvidia/deepseek-ai/deepseek-v4-flash-0731": { vision: false, note: "DeepSeek-V4-Flash 为纯文本模型。来源：docs.cloudbase.net、api-docs.deepseek.com" },
};

/** 模型级判定：模型名 → { vision, note }（跨渠道，默认不生效）。 */
export const VISIONS_BY_MODEL = {
  "deepseek-chat": { vision: true, note: "deepseek-chat 为 deepseek-v4-flash 的滚动别名，自 2026-09 起随主模型支持图片输入。来源：api-docs.deepseek.com" },
  "deepseek-reasoner": { vision: false, note: "DeepSeek 推理模型，无图片输入。来源：api-docs.deepseek.com" },
  "deepseek-v4-flash": { vision: true, note: "DeepSeek-V4-Flash 自 2026-09 起支持图片输入（官方视觉能力并入主模型）。来源：api-docs.deepseek.com/zh-cn/guides/vision + 官方 API 实测（2026-09-10，文档滞后：文档仍写仅 vision-exp 收图）" },
  "deepseek-flash": { vision: true, note: "中转站别名（指向 deepseek-v4-flash），随主模型支持图片输入。来源：官方 API 实测 2026-09-10" },
  "deepseek-v4-flash-0731": { vision: false, note: "日期快照能力冻结在 07-31：不支持图片输入。主模型 deepseek-v4-flash 自 2026-09 起已支持图片。来源：api-docs.deepseek.com" },
  "deepseek-v4-flash-vision-exp": { vision: true, note: "DeepSeek 官方视觉模型，支持图片输入（URL/base64）。来源：api-docs.deepseek.com/zh-cn/news/news260821" },
  "deepseek-v4-pro": { vision: false, note: "DeepSeek V4 Pro 官方能力清单未包含图片输入；V4 系列首个官方视觉模型是 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com、36kr.com/p/3949138682379651" },
  "deepseek-v4-pro-0813": { vision: false, note: "DeepSeek V4 Pro 正式版（0813）官方能力清单未包含图片输入；看图请用 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "deepseek-ai/deepseek-v4-pro-0813": { vision: false, note: "DeepSeek V4 Pro 正式版（0813）官方能力清单未包含图片输入；V4 系列视觉模型是独立的 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "deepseek-ai/deepseek-v4-flash-0731": { vision: false, note: "DeepSeek-V4-Flash-0731 为纯文本模型。来源：docs.cloudbase.net" },
  "gpt-5.6-sol": { vision: true, note: "GPT-5.6 Sol 支持文本+图片输入（多模态）。来源：openai.com/index/previewing-gpt-5-6-sol" },
  "gpt-5.6-terra": { vision: true, note: "GPT-5.6 系列为多模态模型，支持图片输入。来源：openai.com/index/previewing-gpt-5-6-sol" },
  "gpt-5.6-luna": { vision: true, note: "GPT-5.6 系列为多模态模型，支持图片输入。来源：openai.com/index/previewing-gpt-5-6-sol" },
  "gpt-4-vision-preview": { vision: true, note: "OpenAI 视觉模型。来源：platform.openai.com/docs" },
  "gpt-4o": { vision: true, note: "GPT-4o 原生多模态，支持图片输入。来源：platform.openai.com/docs" },
  "gpt-4o-mini": { vision: true, note: "GPT-4o mini 原生多模态，支持图片输入。来源：platform.openai.com/docs" },
  "claude-fable-5": { vision: true, note: "Claude Fable 5 为视觉模型，支持图片/图表/PDF 理解。来源：anthropic.com/claude/fable" },
  "claude-opus-4-8": { vision: true, note: "Claude Opus 4.8 支持图片输入。来源：platform.claude.com/docs" },
  "glm-5.3-flash": { vision: true, note: "GLM-5.3-Flash 为 GLM-5 系列首个原生多模态模型，支持图片/视频输入。来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash" },
  "glm-4.6v-flash": { vision: true, note: "GLM-4.6V-Flash 为视觉语言模型，支持图片输入。来源：docs.bigmodel.cn" },
  "glm-4.6v-flash-web": { vision: true, note: "GLM-4.6V-Flash-WEB 为视觉语言模型，支持图文混合输入。来源：docs.bigmodel.cn" },
  "glm-4v": { vision: true, note: "GLM-4V 系列为视觉语言模型。来源：docs.bigmodel.cn" },
  "qwen3.8-max": { vision: true, note: "Qwen3.8-Max 为多模态旗舰，支持图片/视频输入。来源：platform.qianwenai.com、help.aliyun.com/zh/model-studio/vision" },
  "qwen-vl-max": { vision: true, note: "Qwen-VL 系列为视觉语言模型。来源：help.aliyun.com/zh/model-studio/vision" },
  "qwen-vl-plus": { vision: true, note: "Qwen-VL 系列为视觉语言模型。来源：help.aliyun.com/zh/model-studio/vision" },
  "qwen2.5-vl-72b-instruct": { vision: true, note: "Qwen2.5-VL 为视觉语言模型。来源：help.aliyun.com/zh/model-studio/vision" },
  "hunyuan-turbo-vision": { vision: true, note: "混元新一代视觉语言旗舰大模型，支持图片输入。来源：cloud.tencent.com/product/hunyuan" },
  "hunyuan-vision": { vision: true, note: "混元多模态模型，支持图片输入。来源：cloud.tencent.com/product/hunyuan" },
  "hunyuan-turbos": { vision: false, note: "混元 TurboS 为文本模型。来源：cloud.tencent.com/product/hunyuan" },
  "hunyuan-turbo-latest": { vision: false, note: "混元 Turbo 最新版为文本模型；看图请用 hunyuan-turbo-vision。来源：cloud.tencent.com/product/hunyuan" },
  "hunyuan-large-longcontext": { vision: false, note: "混元 Large LongContext 为文本模型。来源：cloud.tencent.com/product/hunyuan" },
  "hy4-preview": { vision: false, note: "混元 Hy4 preview 为语言模型，无原生视觉。来源：凤凰网 Hy4 preview 报道" },
  "hy4-preview-x": { vision: false, note: "混元 Hy4 preview 系列为语言模型，无原生视觉。来源：凤凰网 Hy4 preview 报道" },
  "kimi-k3": { vision: true, note: "Kimi K3 原生支持图片理解。来源：Moonshot AI 官方开源公告" },
  "kimi-k2.5": { vision: false, note: "Kimi K2.5 为文本模型；K3 起原生支持图片理解。来源：Moonshot AI 官方公告" },
  "kimi-k2.7-code": { vision: false, note: "Kimi K2.7 Code 为代码文本模型。来源：Moonshot AI 官方公告" },
  "minimax-m2": { vision: false, note: "MiniMax M2 为编程/智能体文本模型，无原生视觉；看图用 MiniMax-VL-01 或 M2.1 系列。来源：MiniMax 开发者文档" },
  "minimax-m2.1": { vision: true, note: "MiniMax M2.1 系列支持图像理解。来源：MiniMax 开发者文档" },
  "minimax-vl-01": { vision: true, note: "MiniMax-VL-01 为官方视觉语言模型。来源：MiniMax 开发者文档" },
  "abab6.5s": { vision: false, note: "MiniMax abab6.5s 为纯文本模型。来源：MiniMax 开发者文档" },
  "abab6.5s-chat": { vision: false, note: "MiniMax abab6.5s 为纯文本模型。来源：MiniMax 开发者文档" },
  "m2.7": { vision: false, note: "MiniMax M2.7 为纯文本模型。来源：MiniMax 开发者文档" },
  "embo-01": { vision: false, note: "MiniMax embo-01 为纯文本模型。来源：MiniMax 开发者文档" },
  "grok-4.6": { vision: true, note: "Grok 4.6 支持 text and image input。来源：x.ai/news/grok-4-6" },
  "grok-4": { vision: true, note: "Grok 4 支持图片输入。来源：x.ai" },
  "grok-4.1": { vision: true, note: "Grok 4.1 支持图片输入。来源：x.ai" },
  "gemini-3.7-flash": { vision: true, note: "Gemini 3.7 Flash 原生多模态：文本/图片/视频/音频/PDF。来源：ai.google.dev/gemini-api/docs/models/gemini-3.7-flash" },
  "gemini-3-pro": { vision: true, note: "Gemini 3 Pro 原生多模态，支持图片输入。来源：ai.google.dev" },
  "gemini-2.5-flash": { vision: true, note: "Gemini 2.5 Flash 原生多模态。来源：ai.google.dev" },
  "gemini-2.5-pro": { vision: true, note: "Gemini 2.5 Pro 原生多模态。来源：ai.google.dev" },
  "mimo-v2.5-pro-ultraspeed": { vision: true, note: "MiMo-V2.5 基座为原生全模态，官方提供图片理解 API。来源：mimo.xiaomi.com/mimo-v2-5、mimo.mi.com/docs" },
  "mimo-v2.5-pro": { vision: false, note: "MiMo-V2.5-Pro 无原生视觉（GitHub XiaomiMiMo/MiMo-Code#309）。来源：github.com/XiaomiMiMo/MiMo-Code/issues/309" },
  "nvidia/deepseek-ai/deepseek-v4-pro-0813": { vision: false, note: "DeepSeek V4 Pro 正式版（0813）官方能力清单未包含图片输入；V4 系列视觉模型是独立的 deepseek-v4-flash-vision-exp。来源：api-docs.deepseek.com" },
  "nvidia/deepseek-ai/deepseek-v4-flash-0731": { vision: false, note: "DeepSeek-V4-Flash-0731 为纯文本模型。来源：docs.cloudbase.net" },
};

export const MIGRATED_VISION_ROUTE_COUNT = 21;
export const MIGRATED_VISION_MODEL_COUNT = 54;

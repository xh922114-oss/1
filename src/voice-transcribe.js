// 入站语音转文字 —— 迁移自 QQAgent（MIT）的 `plugins/speech-to-text-qq`。
//
// 上游怎么做的：它挂在宿主钩子上，把 QQ 侧**自带的**语音转写结果（OneBot 动作
// `fetch_ptt_text`）写进消息存档，这样模型看到的就不是一个光秃秃的 `[语音]`。
// 本仓库原来只在"发完语音做回读实验"时用过这个动作（见 bridge.js 的注释：
// **自己发出去的**语音不会产生转写，retcode=100「消息中不包含语音」）——
// 也就是说这个动作本来就是给"别人发的语音"用的，正好是入站场景。
//
// ⚠ 这条链路**没有在本机对真实 QQ 验证过**（要真的有人发语音才能验），所以：
//   · 默认关闭（`socialV2.voice.transcribeIncoming`，默认 false）；
//   · 拿不到转写、超时、报错一律**静默降级**成原来的 `[语音]`，绝不影响消息投递；
//   · 失败原因只进桥接日志，不发给模型（模型不需要知道我们试过）。
//
// 时间/数量都收着：单次 8 秒超时；同一会话同一 message_id 只问一次（桥接侧缓存）。

/** 默认超时：够慢的网关回话，又不至于把入站投递拖到群里看得出来。 */
export const DEFAULT_PTT_TIMEOUT_MS = 8000;

/**
 * 问网关要一条语音的转写文本。**永不抛异常**（返回 { ok, text, error }）。
 *
 * @param {object} 输入
 * @param {string} 输入.messageId 语音消息的 message_id（OneBot 要的就是它）
 * @param {string} 输入.httpUrl   OneBot HTTP 根地址
 * @param {string} [输入.token]   访问令牌（可空）
 * @param {Function} [输入.fetchImpl] 便于测试注入
 * @param {number} [输入.timeoutMs]
 * @returns {Promise<{ ok: boolean, text: string, error?: string }>}
 */
export async function fetchPttText({
  messageId,
  httpUrl,
  token = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PTT_TIMEOUT_MS,
} = {}) {
  const id = String(messageId ?? '').trim();
  if (!id) return { ok: false, text: '', error: '没有 message_id' };
  const base = String(httpUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, text: '', error: '没有配置 OneBot HTTP 地址' };
  if (typeof fetchImpl !== 'function') return { ok: false, text: '', error: '没有可用的 fetch' };

  try {
    const res = await fetchImpl(`${base}/fetch_ptt_text`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message_id: id }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.status !== 'ok' || body?.retcode !== 0) {
      // retcode=100「消息中不包含语音」是"这条没有转写"的正常回答，不是故障
      return { ok: false, text: '', error: `retcode=${body?.retcode ?? '?'} ${body?.wording ?? ''}`.trim() };
    }
    const text = String(body?.data?.text ?? '').trim();
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: '', error: String(error?.message ?? error) };
  }
}

/**
 * 把转写文本渲染成消息里的占位符。空文本（或没转写）返回原来的 `[语音]`。
 * 长度收在 200 字符以内：语音转写偶尔会抽风吐一大段，别让它挤掉真正的上下文。
 */
export function recordLabel(text, { maxChars = 200 } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '[语音]';
  return `[语音：${t.slice(0, maxChars)}]`;
}

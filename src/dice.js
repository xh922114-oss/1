// TRPG 掷骰与检定 —— 从 QQAgent（MIT）`skills/trpg-dice/index.js` 移植。
// 迁移判定与取舍见 docs/guides/QQAGENT_MIGRATION.md。
//
// 为什么必须由程序掷：跑团里骰子是唯一的真相来源。模型自己编数字有两个致命问题——
//   1) 不可复核：玩家问「你掷的多少」，它只能说个大概，或者前后矛盾；
//   2) 有倾向性：剧情需要时它会「刚好」掷出想要的结果（大成功/大失败随剧情走）。
// 所以这里所有随机都走 crypto.randomInt，模型只负责转述结果。
//
// 与原版的两处差别（都是 DSH 这边没有对应东西，不是偷工减料）：
//   · QQAgent 的 `chatKeys`（只在指定会话生效）没有迁移 —— dsh-qq 用白名单群 + 工具开关管这件事；
//   · 随机源做成可注入（`rand`），这样离线测试能给出确定的骰子点数。
//
// 覆盖两种主流规则：
//   COC 7 版：技能检定（含奖励骰/惩罚骰、成功等级划分、大失败判定）
//   DND 5e： 检定（含优势/劣势、自然 20/1、对抗 DC）
// 另外支持通用骰点表达式（3d6+2、4d6dl1 等），给伤害骰和杂项用。
import { randomInt } from 'node:crypto';

/** 默认随机源：区间 [min, max)，与 QQAgent 一样用密码学随机数。 */
const defaultRand = (min, max) => randomInt(min, max);

/**
 * 解析骰点表达式。
 * 语法：NdM[khX|klX|dhX|dlX] [+|- K]*
 *   N 骰子个数（省略为 1，上限 100）；M 骰面（2~1000）
 *   khX 取最高 X 颗 / klX 取最低 X 颗 / dhX 去掉最高 X 颗 / dlX 去掉最低 X 颗
 *   修饰符可叠加（如 +2-1）；纯数字按固定值处理
 * @throws Error 表达式格式不对或超出范围
 */
export function parseFormula(raw) {
  const text = String(raw).replace(/\s+/g, '');
  if (/^\d+$/.test(text)) return { count: 0, sides: 0, fixed: Number(text), mods: [] };

  const m = /^(\d*)d(\d+)((?:kh|kl|dh|dl)\d+)?((?:[+-]\d+)*)$/i.exec(text);
  if (!m) throw new Error(`格式不对：${raw}`);

  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count < 1 || count > 100) throw new Error('骰子个数要在 1~100 之间');
  if (sides < 2 || sides > 1000) throw new Error('骰面要在 2~1000 之间');

  const keep = m[3] ? m[3].toLowerCase() : null;
  const mods = m[4] ? (m[4].match(/[+-]\d+/g) || []).map(Number) : [];
  return { count, sides, fixed: null, keep, mods };
}

/**
 * 掷一次骰点表达式。
 * @returns {{ dice: number[], total: number, modifierText: string, modifierBracket: string, keptNote: string }}
 */
export function rollFormula(parsed, rand = defaultRand) {
  const modSum = parsed.mods.reduce((a, b) => a + b, 0);
  const modifierBracket = parsed.mods.length
    ? parsed.mods.map((n) => (n >= 0 ? ` + ${n}` : ` - ${-n}`)).join('')
    : '';

  if (parsed.fixed !== null) {
    return { dice: [], total: parsed.fixed + modSum, modifierText: modifierBracket, modifierBracket, keptNote: '' };
  }

  const rolls = [];
  for (let i = 0; i < parsed.count; i++) rolls.push(rand(1, parsed.sides + 1));

  let kept = rolls.slice();
  let keptNote = '';

  if (parsed.keep) {
    const km = /^(kh|kl|dh|dl)(\d+)$/.exec(parsed.keep);
    if (km) {
      const kind = km[1];
      const n = Math.min(Number(km[2]), rolls.length);
      const indexed = rolls.map((v, i) => ({ v, i }));
      if (kind === 'kh') {
        kept = indexed.sort((a, b) => b.v - a.v).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.v);
        keptNote = `取最高 ${n} 颗`;
      } else if (kind === 'kl') {
        kept = indexed.sort((a, b) => a.v - b.v).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.v);
        keptNote = `取最低 ${n} 颗`;
      } else if (kind === 'dh') {
        kept = indexed.sort((a, b) => a.v - b.v).slice(0, Math.max(0, rolls.length - n)).sort((a, b) => a.i - b.i).map((x) => x.v);
        keptNote = `去掉最高 ${n} 颗`;
      } else {
        kept = indexed.sort((a, b) => b.v - a.v).slice(0, Math.max(0, rolls.length - n)).sort((a, b) => a.i - b.i).map((x) => x.v);
        keptNote = `去掉最低 ${n} 颗`;
      }
    }
  }

  const sum = kept.reduce((a, b) => a + b, 0);
  return {
    dice: kept,
    total: sum + modSum,
    modifierText: modifierBracket,
    modifierBracket,
    keptNote: keptNote && rolls.length > kept.length ? `${keptNote}（原始 ${rolls.join('/')}）` : keptNote
  };
}

/**
 * 通用掷骰（伤害骰、随机表、掉落、杂项）。
 * @param {{ formula: string, label?: string, hidden?: boolean, showBreakdown?: boolean }} args
 * @param {(min:number,max:number)=>number} [rand]
 * @returns {{ text: string, total?: number, dice?: number[], error?: string }}
 */
export function rollDice({ formula, label = '', hidden = false, showBreakdown = true } = {}, rand = defaultRand) {
  const text = String(formula ?? '').trim();
  if (!text) return { error: '缺少 formula：请给出骰点表达式，如 1d100。' };

  let parsed;
  try {
    parsed = parseFormula(text);
  } catch (error) {
    return { error: `骰点表达式看不懂：${error.message}。示例：1d100、3d6、2d20kh1、4d6dl1、3d8+2` };
  }

  const result = rollFormula(parsed, rand);
  const 用途 = String(label ?? '').trim();
  const 明细 = showBreakdown && result.dice.length
    ? `（${result.dice.join(' + ')}${hidden ? result.modifierText : result.modifierBracket}）`
    : '';

  if (hidden) {
    return {
      text: `【暗骰·玩家不可见】${用途 ? 用途 + '：' : ''}${text} = ${result.total}${明细}`
        + '\n这是暗骰，不要向群友透露点数或结果，自己用叙事体现即可。',
      total: result.total,
      dice: result.dice,
      hidden: true
    };
  }
  return {
    text: `🎲 ${用途 ? 用途 + '｜' : ''}${text} = ${result.total}${明细}`
      + `${result.keptNote ? `\n${result.keptNote}` : ''}`,
    total: result.total,
    dice: result.dice
  };
}

/**
 * COC 7 版检定。
 *
 * 奖励/惩罚骰规则：个位骰固定一颗，十位骰掷 (1 + |奖励数|) 颗；奖励取最低的十位，
 * 惩罚取最高的十位。个位 0 且十位 0 → 结果是 100（而不是 0）。
 * 成功等级：大成功 = 1；极难成功 ≤ 技能值/5；困难成功 ≤ 技能值/2；常规成功 ≤ 技能值；
 * 大失败 = 96~100（技能值 ≥50）或 100（技能值 <50，开了 fumbleFree 则 96~100）。
 */
export function cocCheck(args = {}, { rand = defaultRand, showBreakdown = true, fumbleFree = false } = {}) {
  const skill = Number(args.skill);
  if (!Number.isFinite(skill) || skill < 1 || skill > 999) {
    return { error: 'COC 检定需要 skill（技能值，如 60）。' };
  }
  const bonus = Math.min(2, Math.max(-2, Math.round(Number(args.bonusDice) || 0)));
  const skillName = String(args.skillName ?? '').trim();
  const reason = String(args.reason ?? '').trim();

  const tensRolls = [];
  for (let i = 0; i < 1 + Math.abs(bonus); i++) tensRolls.push(rand(0, 10));
  const units = rand(0, 10);

  const chosenTens = bonus > 0 ? Math.min(...tensRolls) : bonus < 0 ? Math.max(...tensRolls) : tensRolls[0];
  let roll = chosenTens * 10 + units;
  if (roll === 0) roll = 100;

  const hard = Math.floor(skill / 2);
  const extreme = Math.floor(skill / 5);

  let level; let levelIcon; let success;
  if (roll === 1) { level = '大成功'; levelIcon = '💥'; success = true; }
  else if (roll <= extreme) { level = '极难成功'; levelIcon = '🌟'; success = true; }
  else if (roll <= hard) { level = '困难成功'; levelIcon = '✨'; success = true; }
  else if (roll <= skill) { level = '常规成功'; levelIcon = '✅'; success = true; }
  else {
    const fumbleFloor = (skill < 50 && fumbleFree !== true) ? 100 : 96;
    if (roll >= fumbleFloor) { level = '大失败'; levelIcon = '💀'; success = false; }
    else { level = '失败'; levelIcon = '❌'; success = false; }
  }

  const bonusText = bonus > 0 ? `（奖励骰 ×${bonus}）` : bonus < 0 ? `（惩罚骰 ×${Math.abs(bonus)}）` : '';
  const tensNote = showBreakdown
    ? (bonus !== 0
      ? `｜十位 ${tensRolls.join('/')} → 取 ${chosenTens}${bonus > 0 ? '（低）' : '（高）'}，个位 ${units}`
      : `｜十位 ${chosenTens}，个位 ${units}`)
    : '';

  const head = `${levelIcon} ${skillName ? skillName + ' ' : ''}${reason ? reason + '｜' : ''}D100 = ${roll} / 技能 ${skill}${bonusText}`;
  const tail = `结果：${level}${tensNote}`;

  let tip = '';
  if (level === '大成功') tip = '\n（大成功：给出超预期的额外收益，别只当普通成功处理）';
  else if (level === '极难成功') tip = '\n（极难成功：信息完整、行动漂亮，可给额外细节）';
  else if (level === '困难成功') tip = '\n（困难成功：达成目的，细节略少）';
  else if (level === '常规成功') tip = '\n（常规成功：达成基本目的，不给额外情报）';
  else if (level === '大失败') tip = '\n（大失败：按规则给严重后果，别心软改成普通失败）';

  return { text: `${head}\n${tail}${tip}`, roll, level, success, skill };
}

/**
 * DND 5e 检定：d20 + 调整值 ≥ DC 即成功；自然 20 / 自然 1 单独标记。
 * @param {{ modifier?: number, dc?: number, advantage?: boolean, disadvantage?: boolean,
 *           skillName?: string, reason?: string }} args
 */
export function dndCheck(args = {}, { rand = defaultRand, showBreakdown = true, critRange = 'nat20' } = {}) {
  const modifier = Math.round(Number(args.modifier) || 0);
  const dc = Number.isFinite(Number(args.dc)) ? Number(args.dc) : 15;
  const adv = args.advantage === true;
  const dis = args.disadvantage === true;
  const skillName = String(args.skillName ?? '').trim();
  const reason = String(args.reason ?? '').trim();

  if (adv && dis) {
    return { error: '优势和劣势不能同时为 true：两者同时存在时按规则相互抵消，请只传其中一个（或都不传）。' };
  }

  const rolls = [];
  for (let i = 0; i < (adv || dis ? 2 : 1); i++) rolls.push(rand(1, 21));
  const nat = adv ? Math.max(...rolls) : dis ? Math.min(...rolls) : rolls[0];
  const total = nat + modifier;
  const success = total >= dc;
  const isNat20 = nat === 20;
  const isNat1 = nat === 1;

  const advText = adv ? '（优势）' : dis ? '（劣势）' : '';
  const rollNote = showBreakdown
    ? (rolls.length > 1
      ? `｜d20: ${rolls.join('/')} → 取 ${nat}${adv ? '（高）' : '（低）'}`
      : `｜d20: ${nat}`)
    : '';
  const modText = modifier === 0 ? '' : modifier > 0 ? ` + ${modifier}` : ` - ${-modifier}`;

  let icon = success ? '✅' : '❌';
  let verdict = success ? '成功' : '失败';
  if (critRange !== 'off' && isNat20) { icon = '💥'; verdict = '大成功（自然 20）'; }
  else if (isNat1) { icon = '💀'; verdict = '大失败（自然 1）'; }

  const head = `${icon} ${skillName ? skillName + ' ' : ''}${reason ? reason + '｜' : ''}D20${advText} = ${total}（DC ${dc}）`;
  return { text: `${head}\n结果：${verdict}${rollNote}${modText}`, roll: nat, total, dc, success, verdict };
}

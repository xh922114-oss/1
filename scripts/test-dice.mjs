// 掷骰工具（从 QQAgent 迁移）离线测试。
//
// 验什么：
//   1. 骰点表达式解析与取值（用注入的假随机源，点数完全可预期）；
//   2. COC 七级判定 + 奖励骰/惩罚骰 + 大失败口径；
//   3. DND 优势/劣势、DC、自然 20/1；
//   4. 暗骰不泄露规则；
//   5. 错误输入给出人话（而不是抛异常或编结果）。
//
// 跑法：node scripts/test-dice.mjs
import assert from 'node:assert';
import { parseFormula, rollFormula, rollDice, cocCheck, dndCheck } from '../src/dice.js';

let 过了 = 0;
const ok = (label) => { 过了 += 1; console.log(`✅ ${label}`); };

// 固定序列的假随机源：按给定序列依次吐出点数，用完后从头再来。
const 序列 = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
// 造一个「每次骰子都出 n」的随机源（区间统一 [min, max)，所以直接返回 n 即可）
const 恒为 = (n) => () => n;

// ── 表达式解析 ────────────────────────────────────────────────────────────
assert.deepEqual(parseFormula('5'), { count: 0, sides: 0, fixed: 5, mods: [] }, '纯数字 = 固定值');
assert.deepEqual(parseFormula('3d6+2-1'), { count: 3, sides: 6, fixed: null, keep: null, mods: [2, -1] });
assert.equal(parseFormula('2d20kh1').keep, 'kh1');
assert.equal(parseFormula('4D6DL1').keep, 'dl1', '大小写不敏感');
assert.throws(() => parseFormula('张三'), /格式不对/);
assert.throws(() => parseFormula('0d6'), /骰子个数/);
assert.throws(() => parseFormula('101d6'), /骰子个数/);
assert.throws(() => parseFormula('1d1'), /骰面/);
assert.throws(() => parseFormula('1d1001'), /骰面/);
ok('表达式解析：固定值 / 取高去低 / 范围校验');

// ── 掷骰取值 ──────────────────────────────────────────────────────────────
const 三骰 = rollFormula(parseFormula('3d6+2'), 序列([3, 4, 5]));
assert.equal(三骰.total, 14, '3d6+2 = 3+4+5+2');
assert.deepEqual(三骰.dice, [3, 4, 5]);
assert.equal(三骰.modifierBracket, ' + 2');

const 取高 = rollFormula(parseFormula('2d20kh1'), 序列([7, 18]));
assert.equal(取高.total, 18, '2d20kh1 取最高');
const 去低 = rollFormula(parseFormula('4d6dl1'), 序列([2, 2, 1, 4]));
assert.equal(去低.total, 8, '4d6dl1 去掉最低（2+2+4）');
assert.match(去低.keptNote, /去掉最低 1 颗（原始 2\/2\/1\/4）/);
const 固定 = rollFormula(parseFormula('10'), 序列([1]));
assert.equal(固定.total, 10, '纯数字按固定值处理（原版不支持「固定值 + 加值」写法，这里保持一致）');
assert.throws(() => parseFormula('10+3'), /格式不对/, '固定值不能带加值（与 QQAgent 原版一致）');
ok('掷骰取值：求和 / 取高 / 去低 / 固定值，明细可复核');

// ── rollDice 输出 ─────────────────────────────────────────────────────────
const 明 = rollDice({ formula: '1d100', label: '侦查' }, 恒为(70));
assert.match(明.text, /^🎲 侦查｜1d100 = 70（70）$/, 明.text);
const 不显明细 = rollDice({ formula: '1d100', showBreakdown: false }, 恒为(70));
assert.equal(不显明细.text, '🎲 1d100 = 70', '关掉明细只留总值');
const 暗 = rollDice({ formula: '1d100', label: 'NPC 察觉', hidden: true }, 恒为(9));
assert.match(暗.text, /^【暗骰·玩家不可见】NPC 察觉：1d100 = 9/);
assert.match(暗.text, /不要向群友透露点数或结果/, '暗骰必须写明不许外泄');
assert.equal(暗.hidden, true);
assert.match(rollDice({ formula: 'd' }, 恒为(1)).error, /看不懂/, '坏表达式给人话');
assert.match(rollDice({}, 恒为(1)).error, /缺少 formula/);
ok('通用掷骰：明细开关 / 暗骰 / 错误提示');

// ── COC 检定 ──────────────────────────────────────────────────────────────
// 十位数与个位数分开取：bonus=0 时先取十位再取个位。
const coc = (args, tens, units, opts = {}) => {
  const seq = 序列([tens, units]);
  return cocCheck(args, { rand: seq, ...opts });
};
assert.equal(coc({ skill: 60 }, 0, 1).roll, 1, '十位 0 个位 1 → 1');
assert.equal(coc({ skill: 60 }, 0, 1).level, '大成功');
assert.equal(coc({ skill: 60 }, 0, 0).roll, 100, '十位与个位都为 0 → 100（不是 0）');
assert.equal(coc({ skill: 60 }, 0, 0).level, '大失败');
assert.equal(coc({ skill: 60 }, 1, 2).roll, 12);
assert.equal(coc({ skill: 60 }, 1, 2).level, '极难成功', '12 ≤ 60/5=12');
assert.equal(coc({ skill: 60 }, 2, 5).level, '困难成功', '25 ≤ 30');
assert.equal(coc({ skill: 60 }, 5, 5).level, '常规成功', '55 ≤ 60');
assert.equal(coc({ skill: 60 }, 6, 5).level, '失败', '65 > 60 但 < 96');
assert.equal(coc({ skill: 60 }, 9, 6).level, '大失败', '96 起算大失败');
assert.equal(coc({ skill: 40 }, 9, 6).level, '失败', '技能值 <50 时 96 不算大失败（规则书口径）');
assert.equal(coc({ skill: 40 }, 9, 6, { fumbleFree: true }).level, '大失败', '开了 fumbleFree 才把 96~100 都算大失败');
// 奖励骰：十位掷两颗取低；惩罚骰取高
const 奖励 = cocCheck({ skill: 50, bonusDice: 1 }, { rand: 序列([8, 3, 4]) });
assert.match(奖励.text, /十位 8\/3 → 取 3（低）/, 奖励.text);
assert.equal(奖励.roll, 34);
const 惩罚 = cocCheck({ skill: 50, bonusDice: -1 }, { rand: 序列([8, 3, 4]) });
assert.match(惩罚.text, /十位 8\/3 → 取 8（高）/, 惩罚.text);
assert.equal(惩罚.roll, 84);
assert.match(cocCheck({ skill: 60, skillName: '侦查', reason: '找暗门' }, { rand: 恒为(2) }).text, /✨ 侦查 找暗门｜D100 = 22 \/ 技能 60/);
assert.match(cocCheck({ skill: 1000 }, { rand: 序列([9, 9]) }).error ?? '', /技能值/, '技能值越界给人话');
assert.match(cocCheck({}, { rand: 序列([9, 9]) }).error ?? '', /技能值/, '缺 skill 给人话');
ok('COC 检定：六级成功等级 / 100 的边界 / 奖励惩罚骰 / fumbleFree');

// ── DND 检定 ──────────────────────────────────────────────────────────────
const dnd = (args, rolls, opts = {}) => dndCheck(args, { rand: 序列(rolls), ...opts });
assert.equal(dnd({ modifier: 5, dc: 15 }, [9]).total, 14);
assert.equal(dnd({ modifier: 5, dc: 15 }, [9]).success, false);
assert.equal(dnd({ modifier: 5, dc: 15 }, [10]).success, true);
assert.equal(dnd({ modifier: 0, dc: 20 }, [20]).verdict, '大成功（自然 20）');
assert.equal(dnd({ modifier: 0, dc: 20 }, [1]).verdict, '大失败（自然 1）');
assert.equal(dnd({ modifier: 0, dc: 20 }, [20], { critRange: 'off' }).verdict, '成功', 'critRange=off 不特别标记自然 20');
assert.equal(dnd({ modifier: 0, dc: 15, advantage: true }, [7, 18]).roll, 18, '优势取高');
assert.equal(dnd({ modifier: 0, dc: 15, disadvantage: true }, [7, 18]).roll, 7, '劣势取低');
assert.match(dnd({ modifier: 3, dc: 12, advantage: true }, [7, 18]).text, /｜d20: 7\/18 → 取 18（高）/);
assert.match(dnd({ advantage: true, disadvantage: true }, [1]).error, /不能同时/, '优势劣势互斥给人话');
ok('DND 检定：DC / 自然 20 与 1 / 优势劣势 / critRange');

console.log(`\n🎉 掷骰工具测试通过（${过了} 组断言）`);

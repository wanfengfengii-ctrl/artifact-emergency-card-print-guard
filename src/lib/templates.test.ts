import { describe, expect, it } from 'vitest';
import { LIMITS, RISK_LEVELS, type CardData } from '../types';
import { codePointLength, normalizeField, validateCard } from './validation';
import { RECOMMENDED_STEPS, hasAnyNonEmptyStep, resolveTemplateApply } from './templates';

const confirmYes = () => true;
const confirmNo = () => false;

/** 套用结果必须为 applied，并窄化出步骤数组。 */
function expectApplied(risk: (typeof RISK_LEVELS)[number], steps: readonly string[], confirm = confirmYes) {
  const outcome = resolveTemplateApply(risk, steps, confirm);
  expect(outcome.kind).toBe('applied');
  if (outcome.kind !== 'applied') throw new Error('unreachable');
  return outcome.steps;
}

describe('风险等级到推荐步骤的完整映射', () => {
  it('三个风险等级全部有模板，无遗漏、无多余键', () => {
    expect(Object.keys(RECOMMENDED_STEPS).sort()).toEqual([...RISK_LEVELS].sort());
    for (const level of RISK_LEVELS) {
      expect(RECOMMENDED_STEPS[level].length).toBeGreaterThan(0);
    }
  });

  it('每种模板均满足现有条数限制（1—8 条）', () => {
    for (const level of RISK_LEVELS) {
      const count = RECOMMENDED_STEPS[level].length;
      expect(count).toBeGreaterThanOrEqual(LIMITS.steps.min);
      expect(count).toBeLessThanOrEqual(LIMITS.steps.max);
    }
  });

  it('每种模板的每条步骤均满足码点限制（trim 后 1—80 个码点）', () => {
    for (const level of RISK_LEVELS) {
      for (const step of RECOMMENDED_STEPS[level]) {
        const len = codePointLength(normalizeField(step));
        expect(len).toBeGreaterThanOrEqual(LIMITS.step.min);
        expect(len).toBeLessThanOrEqual(LIMITS.step.max);
      }
    }
  });
});

describe('hasAnyNonEmptyStep', () => {
  it('全部为空或仅空白时视为无内容', () => {
    expect(hasAnyNonEmptyStep([''])).toBe(false);
    expect(hasAnyNonEmptyStep(['', '   ', '　'])).toBe(false);
  });

  it('任一步骤有非空内容即视为已有填写', () => {
    expect(hasAnyNonEmptyStep(['', '先断电'])).toBe(true);
  });
});

describe('resolveTemplateApply 覆盖确认两条分支', () => {
  it('未选择风险等级时不可用，且不触发确认', () => {
    let confirmCalled = false;
    const outcome = resolveTemplateApply('', ['已有步骤'], () => {
      confirmCalled = true;
      return true;
    });
    expect(outcome.kind).toBe('unavailable');
    expect(confirmCalled).toBe(false);
  });

  it('无任一非空步骤时直接套用，不触发确认', () => {
    let confirmCalled = false;
    const outcome = resolveTemplateApply('优先抢救', ['', '  '], () => {
      confirmCalled = true;
      return true;
    });
    expect(outcome.kind).toBe('applied');
    expect(confirmCalled).toBe(false);
  });

  it('已有非空步骤且确认覆盖：返回该风险等级的完整模板副本', () => {
    const steps = expectApplied('稳定转移', ['现场已写一步']);
    expect(steps).toEqual([...RECOMMENDED_STEPS['稳定转移']]);
    expect(steps).not.toBe(RECOMMENDED_STEPS['稳定转移']);
  });

  it('已有非空步骤但取消确认：cancelled，不带出任何步骤', () => {
    const outcome = resolveTemplateApply('原位防护', ['现场已写一步'], confirmNo);
    expect(outcome.kind).toBe('cancelled');
    expect('steps' in outcome).toBe(false);
  });

  it('返回的步骤数组可自由增删改，不污染模板', () => {
    const steps = expectApplied('优先抢救', []);
    steps.push('现场补充一步');
    steps[0] = '改写第一步';
    expect(RECOMMENDED_STEPS['优先抢救']).toHaveLength(5);
    expect(RECOMMENDED_STEPS['优先抢救'][0]).toBe('切断库房电源，确认无漏电风险后进入');
  });
});

describe('套用后进入既有校验链路', () => {
  it('三种模板套用后的完整表单均通过 validateCard', () => {
    for (const level of RISK_LEVELS) {
      const steps = expectApplied(level, []);
      const data: CardData = {
        name: '青釉瓷罐',
        location: '一号库房 A 区 3 排',
        risk: level,
        steps,
      };
      expect(validateCard(data).valid).toBe(true);
    }
  });

  it('套用后在现场改坏内容仍由原校验报错（模板不绕过校验）', () => {
    const steps = expectApplied('优先抢救', []);
    steps[0] = '步'.repeat(81);
    const data: CardData = {
      name: '青釉瓷罐',
      location: '一号库房 A 区 3 排',
      risk: '优先抢救',
      steps,
    };
    const result = validateCard(data);
    expect(result.valid).toBe(false);
    expect(result.errors.step_0).toMatch(/80/);
  });
});

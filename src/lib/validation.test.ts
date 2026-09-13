import { describe, expect, it } from 'vitest';
import { codePointLength, normalizeField, validateCard } from './validation';
import { EMPTY_DATA } from '../types';

const validData = () => ({
  name: '青釉瓷罐',
  location: '一号库房 A 区 3 排',
  risk: '优先抢救' as const,
  steps: ['先断开附近电源', '用防水布遮盖后转移'],
});

describe('codePointLength', () => {
  it('按 Unicode 码点计数，emoji 代理对计为 1', () => {
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('库房')).toBe(2);
    expect(codePointLength('a😀b')).toBe(3);
  });
});

describe('normalizeField', () => {
  it('去除首尾各类空白', () => {
    expect(normalizeField('  瓷罐  ')).toBe('瓷罐');
    expect(normalizeField('　瓷罐\t\n')).toBe('瓷罐');
  });
});

describe('validateCard', () => {
  it('合法数据通过校验', () => {
    expect(validateCard(validData()).valid).toBe(true);
  });

  it('名称按 trim 后校验码点长度（1—40）', () => {
    const tooLong = '字'.repeat(41);
    expect(validateCard({ ...validData(), name: tooLong }).errors.name).toMatch(/40/);
    expect(validateCard({ ...validData(), name: '   ' }).errors.name).toBeTruthy();
    expect(validateCard({ ...validData(), name: '  瓷罐  ' }).errors.name).toBeUndefined();
    const emojiName = '😀'.repeat(40);
    expect(validateCard({ ...validData(), name: emojiName }).errors.name).toBeUndefined();
  });

  it('库位长度 1—24', () => {
    expect(validateCard({ ...validData(), location: '位'.repeat(25) }).errors.location).toMatch(/24/);
    expect(validateCard({ ...validData(), location: '' }).errors.location).toBeTruthy();
  });

  it('风险等级仅允许三个枚举值', () => {
    expect(validateCard({ ...validData(), risk: '' }).errors.risk).toBeTruthy();
    // @ts-expect-error 故意传入非法值
    expect(validateCard({ ...validData(), risk: '随便搬走' }).errors.risk).toBeTruthy();
    for (const risk of ['稳定转移', '原位防护'] as const) {
      expect(validateCard({ ...validData(), risk }).errors.risk).toBeUndefined();
    }
  });

  it('步骤 1—8 条，每条 1—80 码点', () => {
    expect(validateCard({ ...validData(), steps: [] }).errors.steps).toBeTruthy();
    expect(validateCard({ ...validData(), steps: Array(9).fill('x') }).errors.steps).toBeTruthy();
    expect(validateCard({ ...validData(), steps: ['   '] }).errors.step_0).toMatch(/80/);
    expect(validateCard({ ...validData(), steps: ['步'.repeat(81)] }).errors.step_0).toMatch(/80/);
    const ok = validateCard({ ...validData(), steps: Array(8).fill('步'.repeat(80)) });
    expect(ok.valid).toBe(true);
  });

  it('空表单全部报错', () => {
    const result = validateCard(EMPTY_DATA);
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(3);
  });
});

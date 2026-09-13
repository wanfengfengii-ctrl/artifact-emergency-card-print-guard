import { LIMITS, RISK_LEVELS, type CardData, type RiskLevel } from '../types';

/** 以 Unicode 码点计数（正确处理代理对，如 emoji 按 1 个码点计）。 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** 去除首尾空白（ECMAScript 空白定义）。 */
export function normalizeField(value: string): string {
  return value.trim();
}

export type ErrorMap = Partial<Record<'name' | 'location' | 'risk' | 'steps' | `step_${number}`, string>>;

export interface ValidationResult {
  valid: boolean;
  errors: ErrorMap;
}

export function validateCard(data: CardData): ValidationResult {
  const errors: ErrorMap = {};

  const name = normalizeField(data.name);
  const nameLen = codePointLength(name);
  if (nameLen < LIMITS.name.min || nameLen > LIMITS.name.max) {
    errors.name = `藏品名称需为 ${LIMITS.name.min}—${LIMITS.name.max} 个码点（当前 ${nameLen}）`;
  }

  const location = normalizeField(data.location);
  const locationLen = codePointLength(location);
  if (locationLen < LIMITS.location.min || locationLen > LIMITS.location.max) {
    errors.location = `库位需为 ${LIMITS.location.min}—${LIMITS.location.max} 个码点（当前 ${locationLen}）`;
  }

  if (!RISK_LEVELS.includes(data.risk as RiskLevel)) {
    errors.risk = '请选择风险等级';
  }

  if (data.steps.length < LIMITS.steps.min || data.steps.length > LIMITS.steps.max) {
    errors.steps = `处置步骤需为 ${LIMITS.steps.min}—${LIMITS.steps.max} 条（当前 ${data.steps.length}）`;
  }
  data.steps.forEach((raw, index) => {
    const len = codePointLength(normalizeField(raw));
    if (len < LIMITS.step.min || len > LIMITS.step.max) {
      errors[`step_${index}`] = `第 ${index + 1} 步需为 ${LIMITS.step.min}—${LIMITS.step.max} 个码点（当前 ${len}）`;
    }
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

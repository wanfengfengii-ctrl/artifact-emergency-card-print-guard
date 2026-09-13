export type RiskLevel = '优先抢救' | '稳定转移' | '原位防护';

export const RISK_LEVELS: readonly RiskLevel[] = ['优先抢救', '稳定转移', '原位防护'];

export interface CardData {
  name: string;
  location: string;
  risk: RiskLevel | '';
  steps: string[];
}

export const LIMITS = {
  name: { min: 1, max: 40 },
  location: { min: 1, max: 24 },
  steps: { min: 1, max: 8 },
  step: { min: 1, max: 80 },
} as const;

export const CARD_MM = { width: 148, height: 210, safe: 10 } as const;

export const EMPTY_DATA: CardData = {
  name: '',
  location: '',
  risk: '',
  steps: [''],
};

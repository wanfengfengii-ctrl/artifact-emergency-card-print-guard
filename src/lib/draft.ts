import { RISK_LEVELS, type CardData, type RiskLevel } from '../types';

/**
 * 本机草稿：把完整 CardData 连同格式版本与更新时间写入 localStorage，
 * 供刷新或临时关页后自动恢复。存储键带应用前缀，格式版本用于日后迁移。
 */
export const DRAFT_STORAGE_KEY = 'relic-emergency-card:draft';
export const DRAFT_FORMAT_VERSION = 1;

export interface DraftEnvelope {
  /** 草稿格式版本，不等于当前版本视为损坏（不灌入表单）。 */
  version: number;
  /** 最近一次保存时间（ISO 8601）。 */
  updatedAt: string;
  data: CardData;
}

/** 面向用户的中文反馈，三类失败可区分。 */
export const DRAFT_MESSAGES = {
  unavailable: '本机存储不可用，草稿无法自动保存；当前页面仍可正常编辑。',
  quota: '本机存储空间不足（配额超限），草稿保存失败；当前页面仍可正常编辑。',
  corrupt: '检测到已损坏的草稿数据，已忽略且未载入表单；当前页面仍可正常编辑。',
  clearFailed: '本机草稿删除失败，旧草稿可能在重新打开页面后再次出现；当前页面仍可正常编辑。',
} as const;

export type DraftLoadResult =
  | { kind: 'none' }
  | { kind: 'ok'; draft: DraftEnvelope }
  | { kind: 'corrupt' }
  | { kind: 'unavailable' };

export type DraftSaveResult = { kind: 'ok' } | { kind: 'quota' } | { kind: 'unavailable' };

/**
 * 校验草稿负载的对象结构、字段类型与风险枚举。
 * 只保证形状合法，内容是否超长度等仍交由 validateCard 在恢复后判定。
 */
export function isValidCardData(value: unknown): value is CardData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string') return false;
  if (typeof v.location !== 'string') return false;
  if (typeof v.risk !== 'string') return false;
  if (v.risk !== '' && !RISK_LEVELS.includes(v.risk as RiskLevel)) return false;
  if (!Array.isArray(v.steps)) return false;
  return v.steps.every((step) => typeof step === 'string');
}

/** 校验完整草稿信封：版本、可解析的保存时间与合法的 CardData。 */
export function isValidDraftEnvelope(value: unknown): value is DraftEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== DRAFT_FORMAT_VERSION) return false;
  if (typeof v.updatedAt !== 'string' || Number.isNaN(Date.parse(v.updatedAt))) return false;
  return isValidCardData(v.data);
}

/**
 * 读取 localStorage。访问 window.localStorage 本身在部分浏览器
 * （禁用 Cookie/隐私模式）会抛 SecurityError，此处统一归一为 null。
 */
export function getDefaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 各浏览器配额错误的常见形态（含旧版 code 约定）。 */
function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; code?: unknown };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
    e.code === 22 || // 旧版 QUOTA_EXCEEDED_ERR
    e.code === 1014 // 旧版 Firefox
  );
}

/**
 * 读取草稿。无草稿、损坏（JSON 非法或结构/枚举不符）与存储不可用分别返回，
 * 损坏数据绝不随结果带出，调用方不得灌入表单。
 */
export function loadDraft(storage: Storage | null): DraftLoadResult {
  if (!storage) return { kind: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidDraftEnvelope(parsed) ? { kind: 'ok', draft: parsed } : { kind: 'corrupt' };
  } catch {
    return { kind: 'corrupt' };
  }
}

/** 写入草稿。配额超限与其他存储失败分开报告，便于给出可区分提示。 */
export function saveDraft(storage: Storage | null, data: CardData, now: Date = new Date()): DraftSaveResult {
  if (!storage) return { kind: 'unavailable' };
  const envelope: DraftEnvelope = {
    version: DRAFT_FORMAT_VERSION,
    updatedAt: now.toISOString(),
    data,
  };
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(envelope));
    return { kind: 'ok' };
  } catch (err) {
    return { kind: isQuotaError(err) ? 'quota' : 'unavailable' };
  }
}

export type DraftClearResult = { kind: 'ok' } | { kind: 'failed' };

/**
 * 删除草稿并回读确认确实已删除。
 * 删除抛错、回读抛错或旧值仍在（静默失败）时返回 failed，
 * 调用方必须提示用户：旧草稿未被删除，重开页面后会再次出现。
 */
export function clearDraft(storage: Storage | null): DraftClearResult {
  if (!storage) return { kind: 'failed' };
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
    return storage.getItem(DRAFT_STORAGE_KEY) === null ? { kind: 'ok' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

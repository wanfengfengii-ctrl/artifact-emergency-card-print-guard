import { describe, expect, it } from 'vitest';
import {
  DRAFT_FORMAT_VERSION,
  DRAFT_STORAGE_KEY,
  clearDraft,
  isValidCardData,
  loadDraft,
  saveDraft,
} from './draft';
import { validateCard } from './validation';
import type { CardData } from '../types';

/** 注入用的内存 Storage，行为与浏览器 localStorage 对齐。 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

/** setItem 按指定错误失败的存储，用于模拟配额超限/存储不可用。 */
class ThrowingStorage extends MemoryStorage {
  constructor(private readonly failure: unknown) {
    super();
  }

  override setItem(): never {
    throw this.failure;
  }
}

const sampleData = (): CardData => ({
  name: '青釉瓷罐',
  location: '一号库房 A 区 3 排',
  risk: '优先抢救',
  steps: ['先断开附近电源', '用防水布遮盖后转移'],
});

const SAVED_AT = new Date('2026-09-13T10:30:00.000Z');

describe('saveDraft / loadDraft 往返', () => {
  it('无草稿时返回 none', () => {
    expect(loadDraft(new MemoryStorage()).kind).toBe('none');
  });

  it('保存后完整恢复 CardData，并带格式版本与更新时间', () => {
    const storage = new MemoryStorage();
    const data = sampleData();
    expect(saveDraft(storage, data, SAVED_AT).kind).toBe('ok');

    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const envelope = JSON.parse(raw!) as { version: unknown; updatedAt: unknown };
    expect(envelope.version).toBe(DRAFT_FORMAT_VERSION);
    expect(envelope.updatedAt).toBe(SAVED_AT.toISOString());

    const result = loadDraft(storage);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.draft.data).toEqual(data);
      expect(result.draft.updatedAt).toBe(SAVED_AT.toISOString());
    }
  });

  it('存储为 null 或读写抛错时报告 unavailable，不中断流程', () => {
    expect(loadDraft(null).kind).toBe('unavailable');
    expect(saveDraft(null, sampleData()).kind).toBe('unavailable');

    class GetThrowingStorage extends MemoryStorage {
      override getItem(): string | null {
        throw new DOMException('denied', 'SecurityError');
      }
    }
    expect(loadDraft(new GetThrowingStorage()).kind).toBe('unavailable');
    expect(saveDraft(new ThrowingStorage(new DOMException('denied', 'SecurityError')), sampleData()).kind).toBe(
      'unavailable',
    );
  });

  it('配额超限单独报告 quota（含各浏览器错误形态）', () => {
    const cases: unknown[] = [
      new DOMException('full', 'QuotaExceededError'),
      new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'),
      Object.assign(new Error('full'), { code: 22 }),
      Object.assign(new Error('full'), { code: 1014 }),
    ];
    for (const failure of cases) {
      expect(saveDraft(new ThrowingStorage(failure), sampleData()).kind).toBe('quota');
    }
  });
});

describe('损坏草稿隔离', () => {
  it('JSON 非法时报告 corrupt，不带出任何数据', () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, '{oops');
    const result = loadDraft(storage);
    expect(result.kind).toBe('corrupt');
    expect('draft' in result).toBe(false);
  });

  it('结构、字段类型或风险枚举不符均视为损坏', () => {
    const badPayloads: unknown[] = [
      null,
      'text',
      { version: DRAFT_FORMAT_VERSION, updatedAt: SAVED_AT.toISOString() }, // 缺 data
      { version: 999, updatedAt: SAVED_AT.toISOString(), data: sampleData() }, // 版本不符
      { version: DRAFT_FORMAT_VERSION, updatedAt: 'not-a-date', data: sampleData() },
      { version: DRAFT_FORMAT_VERSION, updatedAt: SAVED_AT.toISOString(), data: { ...sampleData(), name: 42 } },
      { version: DRAFT_FORMAT_VERSION, updatedAt: SAVED_AT.toISOString(), data: { ...sampleData(), risk: '随便搬走' } },
      { version: DRAFT_FORMAT_VERSION, updatedAt: SAVED_AT.toISOString(), data: { ...sampleData(), steps: '一步' } },
      {
        version: DRAFT_FORMAT_VERSION,
        updatedAt: SAVED_AT.toISOString(),
        data: { ...sampleData(), steps: ['正常', 7] },
      },
    ];
    for (const payload of badPayloads) {
      const storage = new MemoryStorage();
      storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      expect(loadDraft(storage).kind).toBe('corrupt');
    }
  });

  it('损坏草稿之后的成功保存使其恢复为可读草稿', () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, '{broken');
    expect(loadDraft(storage).kind).toBe('corrupt');
    expect(saveDraft(storage, sampleData(), SAVED_AT).kind).toBe('ok');
    const result = loadDraft(storage);
    expect(result.kind).toBe('ok');
  });
});

describe('clearDraft', () => {
  it('清空后回到无草稿状态', () => {
    const storage = new MemoryStorage();
    saveDraft(storage, sampleData(), SAVED_AT);
    expect(loadDraft(storage).kind).toBe('ok');
    clearDraft(storage);
    expect(loadDraft(storage).kind).toBe('none');
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('存储不可用或删除抛错时静默忽略', () => {
    expect(() => clearDraft(null)).not.toThrow();
    class RemoveThrowingStorage extends MemoryStorage {
      override removeItem(): void {
        throw new DOMException('denied', 'SecurityError');
      }
    }
    expect(() => clearDraft(new RemoveThrowingStorage())).not.toThrow();
  });
});

describe('isValidCardData', () => {
  it('接受空表单与合法风险枚举', () => {
    expect(isValidCardData({ name: '', location: '', risk: '', steps: [''] })).toBe(true);
    for (const risk of ['优先抢救', '稳定转移', '原位防护']) {
      expect(isValidCardData({ name: 'a', location: 'b', risk, steps: ['s'] })).toBe(true);
    }
  });
});

describe('恢复数据进入原校验链路', () => {
  it('恢复的合法草稿通过 validateCard', () => {
    const storage = new MemoryStorage();
    saveDraft(storage, sampleData(), SAVED_AT);
    const result = loadDraft(storage);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(validateCard(result.draft.data).valid).toBe(true);
    }
  });

  it('结构合法但内容越限的草稿恢复后由原校验报错', () => {
    const storage = new MemoryStorage();
    const tooLong = { ...sampleData(), name: '字'.repeat(41) };
    saveDraft(storage, tooLong, SAVED_AT);
    const result = loadDraft(storage);
    expect(result.kind).toBe('ok'); // 结构合法，允许恢复
    if (result.kind === 'ok') {
      const validation = validateCard(result.draft.data);
      expect(validation.valid).toBe(false);
      expect(validation.errors.name).toMatch(/40/);
    }
  });
});

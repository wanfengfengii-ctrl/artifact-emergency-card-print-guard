import { afterEach, describe, expect, it } from 'vitest';
import { printCard } from './print';

describe('printCard', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('环境不支持打印时抛出明确中文错误', async () => {
    delete (globalThis as { window?: unknown }).window;
    await expect(printCard()).rejects.toThrow(/不支持浏览器打印/);
  });

  it('print 抛错时给出明确的失败提示', async () => {
    (globalThis as { window?: unknown }).window = {
      print: () => {
        throw new Error('blocked');
      },
    };
    await expect(printCard()).rejects.toThrow(/打印调用失败/);
  });

  it('print 正常调用时不抛错', async () => {
    let called = false;
    (globalThis as { window?: unknown }).window = {
      print: () => {
        called = true;
      },
    };
    await expect(printCard()).resolves.toBeUndefined();
    expect(called).toBe(true);
  });
});

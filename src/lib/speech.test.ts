import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSpeechAdapter, describeSpeechError } from './speech';

interface FakeUtterance {
  text: string;
  lang: string;
  onend: ((event: { type: string }) => void) | null;
  onerror: ((event: { type: string; error?: string }) => void) | null;
}

interface FakeSpeechSynthesis {
  spoken: FakeUtterance[];
  cancelCount: number;
  speak(utterance: FakeUtterance): void;
  cancel(): void;
}

interface FakeWindow {
  SpeechSynthesisUtterance?: new (text: string) => FakeUtterance;
  speechSynthesis?: FakeSpeechSynthesis;
}

function createFakeWindow(): FakeWindow {
  const synthesis: FakeSpeechSynthesis = {
    spoken: [],
    cancelCount: 0,
    speak(u) {
      this.spoken.push(u);
    },
    cancel() {
      this.cancelCount += 1;
    },
  };
  class Utterance implements FakeUtterance {
    text: string;
    lang = '';
    onend: FakeUtterance['onend'] = null;
    onerror: FakeUtterance['onerror'] = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  return { SpeechSynthesisUtterance: Utterance, speechSynthesis: synthesis };
}

describe('createBrowserSpeechAdapter 能力探测', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('无 window / 缺少 speechSynthesis 时 supported 为 false，方法为安全空操作', () => {
    delete (globalThis as { window?: unknown }).window;
    const adapter = createBrowserSpeechAdapter();
    expect(adapter.supported).toBe(false);
    expect(() => adapter.speak('x', { onEnd: () => {}, onError: () => {} })).not.toThrow();
    expect(() => adapter.cancel()).not.toThrow();
  });

  it('只注入了空对象（无 SpeechSynthesisUtterance 构造器）时不支持', () => {
    const partial = { speechSynthesis: { speak() {}, cancel() {} } } as unknown as FakeWindow;
    const adapter = createBrowserSpeechAdapter(partial);
    expect(adapter.supported).toBe(false);
  });

  it('能力齐全时 supported 为 true', () => {
    const adapter = createBrowserSpeechAdapter(createFakeWindow());
    expect(adapter.supported).toBe(true);
  });
});

describe('createBrowserSpeechAdapter 合成与回调', () => {
  it('speak 提交带 zh-CN 语言的 Utterance，end 事件回调 onEnd', () => {
    const win = createFakeWindow();
    const adapter = createBrowserSpeechAdapter(win);
    const onEnd = vi.fn();
    const onError = vi.fn();
    adapter.speak('藏品名称：青釉瓷罐', { onEnd, onError });

    const spoken = win.speechSynthesis!.spoken;
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text).toBe('藏品名称：青釉瓷罐');
    expect(spoken[0]!.lang).toBe('zh-CN');

    spoken[0]!.onend!({ type: 'end' });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('error 事件把错误类型转成明确中文后回调 onError', () => {
    const win = createFakeWindow();
    const adapter = createBrowserSpeechAdapter(win);
    const onEnd = vi.fn();
    const onError = vi.fn();
    adapter.speak('库位：一号库房', { onEnd, onError });
    win.speechSynthesis!.spoken[0]!.onerror!({ type: 'error', error: 'network' });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('网络异常'));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('同一段落 end 与 error 只结算一次（先到先得，重复事件忽略）', () => {
    const win = createFakeWindow();
    const adapter = createBrowserSpeechAdapter(win);
    const onEnd = vi.fn();
    const onError = vi.fn();
    adapter.speak('风险等级：优先抢救', { onEnd, onError });
    const u = win.speechSynthesis!.spoken[0]!;
    u.onend!({ type: 'end' });
    u.onerror!({ type: 'error', error: 'canceled' }); // 迟到事件
    u.onend!({ type: 'end' }); // 重复结束
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel 透传到浏览器 speechSynthesis.cancel', () => {
    const win = createFakeWindow();
    const adapter = createBrowserSpeechAdapter(win);
    adapter.cancel();
    expect(win.speechSynthesis!.cancelCount).toBe(1);
  });
});

describe('describeSpeechError', () => {
  it('各类错误都给出明确中文反馈，未知错误有兜底', () => {
    expect(describeSpeechError('network')).toContain('网络');
    expect(describeSpeechError('not-allowed')).toContain('拒绝');
    expect(describeSpeechError('canceled')).toContain('中断');
    expect(describeSpeechError('synthesis-failed')).toContain('语音合成失败');
    expect(describeSpeechError(undefined)).toContain('语音合成失败');
  });
});

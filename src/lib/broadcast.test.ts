import { describe, expect, it, vi } from 'vitest';
import {
  buildBroadcastQueue,
  createBroadcastPlayer,
  describeBroadcastBlockers,
  type BroadcastSegment,
  type BroadcastState,
} from './broadcast';
import type { CardData } from '../types';
import { createBrowserSpeechAdapter } from './speech';
import type { SpeechAdapter } from './speech';

const CARD: CardData = {
  name: '  青釉瓷罐  ',
  location: '一号库房 A 区 3 排',
  risk: '优先抢救',
  steps: ['切断库房电源，确认无漏电风险后进入', '   ', '穿戴防护手套转移文物', ''],
};

/** 可控的语音适配器：记录每次合成/取消，并由测试手动触发结束或失败。 */
interface FakeAdapter extends SpeechAdapter {
  texts: string[];
  cancelCount: number;
  endCurrent: () => void;
  failCurrent: (message?: string) => void;
  pending: number;
}

function createFakeAdapter(supported = true): FakeAdapter {
  let callbacks: { onEnd: () => void; onError: (message: string) => void } | null = null;
  const api: FakeAdapter = {
    supported,
    texts: [],
    cancelCount: 0,
    pending: 0,
    speak(text, cbs) {
      api.texts.push(text);
      api.pending += 1;
      callbacks = cbs;
    },
    cancel() {
      api.cancelCount += 1;
      callbacks = null;
      api.pending = 0;
    },
    endCurrent() {
      const cbs = callbacks;
      callbacks = null;
      api.pending -= 1;
      cbs?.onEnd();
    },
    failCurrent(message = '语音合成失败，播报已停止；修改数据后可重新发起。') {
      const cbs = callbacks;
      callbacks = null;
      api.pending -= 1;
      cbs?.onError(message);
    },
  };
  return api;
}

function collectStates() {
  const states: BroadcastState[] = [];
  return {
    states,
    onUpdate: (s: BroadcastState) => states.push(s),
    last: () => states[states.length - 1]!,
  };
}

describe('buildBroadcastQueue 快照转播报队列', () => {
  it('按藏品名称、库位、风险等级、步骤的顺序生成固定队列', () => {
    const queue = buildBroadcastQueue(CARD);
    expect(queue.map((s) => s.kind)).toEqual(['name', 'location', 'risk', 'step', 'step']);
    expect(queue.map((s) => s.text)).toEqual([
      '藏品名称：青釉瓷罐',
      '库位：一号库房 A 区 3 排',
      '风险等级：优先抢救',
      '第 1 步：切断库房电源，确认无漏电风险后进入',
      '第 2 步：穿戴防护手套转移文物',
    ]);
    expect(queue[0]!.label).toBe('藏品名称');
    expect(queue[3]!.label).toBe('第 1 步');
    expect(queue[3]!.stepIndex).toBe(1);
    expect(queue[4]!.stepIndex).toBe(2);
  });

  it('名称与库位按去首尾空白后的内容朗读，风险为空时不生成该段', () => {
    const queue = buildBroadcastQueue({ ...CARD, risk: '' });
    expect(queue.some((s) => s.kind === 'risk')).toBe(false);
    expect(queue[0]!.text).toBe('藏品名称：青釉瓷罐');
  });

  it('空步骤过滤：纯空白步骤被丢弃，序号按实际朗读顺序连续编号', () => {
    const queue = buildBroadcastQueue(CARD);
    const steps = queue.filter((s) => s.kind === 'step');
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.stepIndex)).toEqual([1, 2]);
    expect(steps[0]!.text).toBe('第 1 步：切断库房电源，确认无漏电风险后进入');
    expect(steps[1]!.text).toBe('第 2 步：穿戴防护手套转移文物');
  });

  it('中间步骤清空后，后续步骤序号提前，空行不发声', () => {
    const queue = buildBroadcastQueue({
      ...CARD,
      steps: ['第一步保留', '', '第二步实际内容', '   '],
    });
    const steps = queue.filter((s) => s.kind === 'step');
    expect(steps.map((s) => s.text)).toEqual(['第 1 步：第一步保留', '第 2 步：第二步实际内容']);
  });

  it('返回的是独立快照：构造后再修改入参数据不影响已生成队列', () => {
    const data: CardData = { ...CARD, steps: [...CARD.steps] };
    const queue = buildBroadcastQueue(data);
    const before = queue.map((s) => s.text);
    data.name = '被改坏的名称';
    data.steps.push('构造后新增的步骤');
    data.steps[0] = '构造后改写的步骤';
    expect(queue.map((s) => s.text)).toEqual(before);
  });

  it('全部字段为空时得到空队列', () => {
    expect(buildBroadcastQueue({ name: '  ', location: '', risk: '', steps: ['', '   '] })).toEqual([]);
  });
});

describe('describeBroadcastBlockers 不可启动原因', () => {
  it('无校验错误时返回空数组', () => {
    expect(describeBroadcastBlockers({})).toEqual([]);
  });

  it('按界面顺序汇总基础字段与具体出错步骤', () => {
    const reasons = describeBroadcastBlockers({
      risk: '请选择风险等级',
      step_2: '超长',
      name: '名称为空',
      step_0: '为空',
    });
    expect(reasons).toEqual(['藏品名称', '风险等级', '第 1 步内容', '第 3 步内容']);
  });
});

describe('createBroadcastPlayer 逐段推进', () => {
  it('逐段提交合成，结束回调推进下标，全部结束进入 done', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    expect(speech.texts).toHaveLength(1);
    expect(tracker.last().status).toBe('playing');
    expect(tracker.last().currentIndex).toBe(0);
    expect(tracker.last().queue).toHaveLength(5);

    speech.endCurrent(); // → 库位
    expect(tracker.last().currentIndex).toBe(1);
    speech.endCurrent(); // → 风险等级
    expect(tracker.last().currentIndex).toBe(2);
    speech.endCurrent(); // → 步骤 1
    expect(speech.texts[3]).toBe('第 1 步：切断库房电源，确认无漏电风险后进入');
    speech.endCurrent(); // → 步骤 2
    expect(tracker.last().currentIndex).toBe(4);
    expect(speech.texts).toHaveLength(5);
    speech.endCurrent(); // 队列末尾

    expect(tracker.last().status).toBe('done');
    expect(tracker.last().currentIndex).toBe(5);
    expect(tracker.last().message).toBeNull();
    expect(speech.texts).toEqual([
      '藏品名称：青釉瓷罐',
      '库位：一号库房 A 区 3 排',
      '风险等级：优先抢救',
      '第 1 步：切断库房电源，确认无漏电风险后进入',
      '第 2 步：穿戴防护手套转移文物',
    ]);
  });

  it('空队列立即完成，不调用合成', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });
    player.start({ name: '', location: '', risk: '', steps: [''] });
    expect(tracker.last().status).toBe('done');
    expect(speech.texts).toHaveLength(0);
  });

  it('播报期间修改原始数据不改变本轮队列，下次启动才采用新内容', () => {
    const speech = createFakeAdapter();
    const player = createBroadcastPlayer({ speech });
    const data: CardData = { ...CARD, steps: [...CARD.steps] };

    player.start(data);
    expect(speech.texts[0]).toBe('藏品名称：青釉瓷罐');
    // 播报进行中修改表单数据。
    data.name = '直播期间改的新名称';
    data.steps[0] = '直播期间改的新步骤';
    speech.endCurrent();
    speech.endCurrent();
    speech.endCurrent();
    speech.endCurrent();
    speech.endCurrent();
    // 本轮朗读的仍是启动时快照。
    expect(speech.texts.every((t) => !t.includes('直播期间'))).toBe(true);
    expect(speech.texts).toContain('藏品名称：青釉瓷罐');

    // 下一轮启动采用新内容。
    player.start(data);
    expect(speech.texts.at(-1)).toBe('藏品名称：直播期间改的新名称');
  });
});

describe('createBroadcastPlayer 取消契约', () => {
  it('停止立即取消余下队列、回到待播状态，迟到的结束回调不再推进', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    speech.endCurrent(); // 推进到库位段
    expect(tracker.last().currentIndex).toBe(1);

    player.stop();
    expect(speech.cancelCount).toBeGreaterThanOrEqual(1);
    expect(tracker.last().status).toBe('idle');
    expect(tracker.last().queue).toEqual([]);
    expect(tracker.last().currentIndex).toBe(0);

    const spokenSoFar = speech.texts.length;
    // 浏览器对被取消分段迟到补发的结束回调：必须被丢弃，不重启、不推进。
    speech.endCurrent();
    expect(speech.texts).toHaveLength(spokenSoFar);
    expect(tracker.last().status).toBe('idle');

    // 停止后可重新启动新一轮。
    player.start(CARD);
    expect(tracker.last().status).toBe('playing');
    expect(tracker.last().currentIndex).toBe(0);
    expect(speech.texts).toHaveLength(spokenSoFar + 1);
  });

  it('待播/完成状态下停止是幂等空操作，不额外取消', () => {
    const speech = createFakeAdapter();
    const player = createBroadcastPlayer({ speech });
    player.stop();
    expect(speech.cancelCount).toBe(0);

    player.start(CARD);
    player.stop();
    const cancels = speech.cancelCount;
    player.stop();
    expect(speech.cancelCount).toBe(cancels);
  });
});

describe('createBroadcastPlayer 重复启动不叠加', () => {
  it('播放中再次启动被忽略：不开新队列、不重复合成', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    const textsAtStart = [...speech.texts];
    player.start({ ...CARD, name: '另一个完全不同的名称' });
    expect(speech.texts).toEqual(textsAtStart);
    expect(speech.texts.some((t) => t.includes('另一个完全不同'))).toBe(false);

    speech.endCurrent();
    expect(speech.texts.at(-1)).toBe('库位：一号库房 A 区 3 排');
  });
});

describe('createBroadcastPlayer 失败中止与重试', () => {
  it('任一分段失败：取消后续、停在失败段并给出明确反馈', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    speech.endCurrent(); // 名称完成，开始库位段
    speech.failCurrent('语音服务网络异常，播报已停止；修改数据后可重新发起。');

    const terminal = tracker.last();
    expect(terminal.status).toBe('error');
    expect(terminal.currentIndex).toBe(1);
    expect(terminal.message).toContain('网络异常');
    // 失败后不再提交任何后续分段。
    expect(speech.texts).toHaveLength(2);
    // 失败也清空浏览器侧残留队列。
    expect(speech.cancelCount).toBeGreaterThanOrEqual(1);

    // 迟到回调不得翻盘。
    speech.endCurrent();
    expect(tracker.last().status).toBe('error');
  });

  it('失败后用户可重新发起，新一轮从头朗读', () => {
    const speech = createFakeAdapter();
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    speech.failCurrent();
    expect(tracker.last().status).toBe('error');

    player.start(CARD);
    expect(tracker.last().status).toBe('playing');
    expect(tracker.last().currentIndex).toBe(0);
    expect(speech.texts.at(-1)).toBe('藏品名称：青釉瓷罐');

    while (tracker.last().status !== 'done') speech.endCurrent();
    expect(tracker.last().status).toBe('done');
  });

  it('浏览器不支持语音时不调用合成，直接给出不支持反馈', () => {
    const speech = createFakeAdapter(false);
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech, onUpdate: tracker.onUpdate });

    player.start(CARD);
    expect(tracker.last().status).toBe('error');
    expect(tracker.last().message).toMatch(/不支持语音合成/);
    expect(speech.texts).toHaveLength(0);
  });

  it('真实适配器在原生 speak 同步抛错时把播放器带入失败态，而非卡住', () => {
    class Utterance {
      text: string;
      lang = '';
      onend = null;
      onerror = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const adapter = createBrowserSpeechAdapter({
      SpeechSynthesisUtterance: Utterance as never,
      speechSynthesis: {
        speak: () => {
          throw new Error('boom');
        },
        cancel: () => {},
      },
    });
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech: adapter, onUpdate: tracker.onUpdate });
    expect(() => player.start(CARD)).not.toThrow();
    expect(tracker.last().status).toBe('error');
    expect(tracker.last().message).toContain('boom');
  });
});

describe('createBroadcastPlayer 状态快照', () => {
  it('每次 onUpdate 收到的都是独立拷贝，订阅方不污染内部队列', () => {
    const speech = createFakeAdapter();
    const seen: BroadcastState[] = [];
    const player = createBroadcastPlayer({ speech, onUpdate: (s) => seen.push(s) });
    player.start(CARD);
    const emitted = seen[0]!;
    (emitted.queue as BroadcastSegment[]).splice(0, emitted.queue.length);
    speech.endCurrent();
    expect(seen.at(-1)!.queue).toHaveLength(5);
  });

  it('onUpdate 缺省时播放器仍可独立工作（注入可选）', () => {
    const speech = createFakeAdapter();
    const player = createBroadcastPlayer({ speech });
    expect(() => {
      player.start(CARD);
      speech.endCurrent();
      player.stop();
    }).not.toThrow();
    expect(player.getState().status).toBe('idle');
  });
});

describe('createBroadcastPlayer 与真实浏览器适配器的取消协作', () => {
  it('stop 后浏览器以 canceled/error 事件迟到通知时不显示为失败', () => {
    // 模拟 Chrome：cancel() 会让在飞分段补发 onerror({error:"canceled"})。
    const pending: Array<{ onend: () => void; onerror: (e: { error: string }) => void }> = [];
    const browserAdapter: SpeechAdapter = {
      supported: true,
      speak: vi.fn((_text: string, cbs) => {
        pending.push({ onend: cbs.onEnd, onerror: (e) => cbs.onError(e.error) });
      }) as SpeechAdapter['speak'],
      cancel: () => {
        const late = pending.pop();
        late?.onerror({ error: 'canceled' });
      },
    };
    const tracker = collectStates();
    const player = createBroadcastPlayer({ speech: browserAdapter, onUpdate: tracker.onUpdate });

    player.start(CARD);
    player.stop();
    expect(tracker.last().status).toBe('idle');
    expect(tracker.last().message).toBeNull();
  });
});

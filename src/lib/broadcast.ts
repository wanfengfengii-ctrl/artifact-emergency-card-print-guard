import type { CardData } from '../types';
import { normalizeField, type ErrorMap } from './validation';
import { SPEECH_UNSUPPORTED_MESSAGE, type SpeechAdapter } from './speech';

/**
 * 逐段语音播报。
 *
 * 数据链路（与现场诉求一一对应）：
 * - 点击“开始播报”时，从**当时的有效卡片快照**经纯函数 buildBroadcastQueue
 *   生成一段段固定队列（藏品名称 → 库位 → 风险等级 → 带序号的非空步骤）；
 * - 队列在播放器内自持一份字符串拷贝，播报期间继续编辑表单只改 React 状态，
 *   本轮队列文本不受影响，下次“开始播报”才重新取快照；
 * - 播放器通过可注入的 SpeechAdapter 提交合成，凭结束回调逐段推进、
 *   错误回调立即中止后续；“停止播报”调用适配器 cancel 并让一切迟到回调失效。
 */

export type BroadcastKind = 'name' | 'location' | 'risk' | 'step';

export interface BroadcastSegment {
  /** 段落在队列内的稳定标识。 */
  id: string;
  kind: BroadcastKind;
  /** 界面进度展示用的短标签（如“藏品名称”“第 3 步”）。 */
  label: string;
  /** 实际送入语音合成的完整文本。 */
  text: string;
  /** 步骤段落的播报序号（从 1 开始）；其余段落为 null。 */
  stepIndex: number | null;
}

/**
 * 由卡片快照构造固定播报队列（纯函数）：
 * 依次为藏品名称、库位、风险等级，随后是**去首尾空白后非空**的步骤，
 * 步骤按实际朗读顺序从 1 连续编号（空步骤被过滤，不发声、不占位）。
 * 返回全新数组与字符串，不引用入参，调用方之后如何修改 data 都与本队列无关。
 */
export function buildBroadcastQueue(data: CardData): BroadcastSegment[] {
  const segments: BroadcastSegment[] = [];

  const name = normalizeField(data.name);
  if (name.length > 0) {
    segments.push({ id: 'name', kind: 'name', label: '藏品名称', text: `藏品名称：${name}`, stepIndex: null });
  }

  const location = normalizeField(data.location);
  if (location.length > 0) {
    segments.push({ id: 'location', kind: 'location', label: '库位', text: `库位：${location}`, stepIndex: null });
  }

  if (data.risk !== '') {
    segments.push({ id: 'risk', kind: 'risk', label: '风险等级', text: `风险等级：${data.risk}`, stepIndex: null });
  }

  let spokenNo = 0;
  data.steps.forEach((raw) => {
    const step = normalizeField(raw);
    if (step.length === 0) return; // 空步骤过滤：不朗读、不占序号
    spokenNo += 1;
    segments.push({
      id: `step-${spokenNo}`,
      kind: 'step',
      label: `第 ${spokenNo} 步`,
      text: `第 ${spokenNo} 步：${step}`,
      stepIndex: spokenNo,
    });
  });

  return segments;
}

/** 表单字段中文名，按界面从上到下排列，用于汇总不可启动原因。 */
const FIELD_LABELS: ReadonlyArray<{ key: keyof ErrorMap; label: string }> = [
  { key: 'name', label: '藏品名称' },
  { key: 'location', label: '库位' },
  { key: 'risk', label: '风险等级' },
  { key: 'steps', label: '处置步骤条数' },
];

/**
 * 汇总当前表单不能启动播报的原因（去首尾空白等口径与字段校验一致）。
 * 返回空数组表示表单已通过字段校验、可以启动。
 * 依次列出：三个基础字段、步骤条数、再按位置列出每条非法步骤，
 * 让负责人在免持场景前能一次看清要补什么。
 */
export function describeBroadcastBlockers(errors: ErrorMap): string[] {
  const reasons: string[] = [];
  for (const { key, label } of FIELD_LABELS) {
    const message = errors[key];
    if (message) reasons.push(label);
  }
  const stepIndices: number[] = [];
  for (const key of Object.keys(errors)) {
    if (key.startsWith('step_')) {
      const index = Number(key.slice('step_'.length));
      if (Number.isInteger(index)) stepIndices.push(index);
    }
  }
  // 错误对象的键序不保证按位置，这里统一按步骤先后排列。
  stepIndices.sort((a, b) => a - b);
  for (const index of stepIndices) reasons.push(`第 ${index + 1} 步内容`);
  return reasons;
}

export type BroadcastStatus = 'idle' | 'playing' | 'done' | 'error';

export interface BroadcastState {
  status: BroadcastStatus;
  /** 本轮固定队列；idle（含停止后）为空，播放/完成/失败期间保持快照内容不变。 */
  queue: readonly BroadcastSegment[];
  /** 正在朗读段落在 queue 中的下标；无队列时为 0。 */
  currentIndex: number;
  /** 失败等面向用户的明确中文反馈；无反馈时为 null。 */
  message: string | null;
}

const IDLE_STATE: BroadcastState = { status: 'idle', queue: [], currentIndex: 0, message: null };

export interface BroadcastPlayer {
  getState(): BroadcastState;
  /** 以当前快照启动一轮新播报；播放中重复调用为幂等空操作，绝不叠加声音。 */
  start(data: CardData): void;
  /** 立即取消当前朗读与余下队列，回到待播状态；非播放中调用幂等。 */
  stop(): void;
}

export interface CreatePlayerOptions {
  speech: SpeechAdapter;
  /** 每次状态变化（含逐段推进）时收到一份不可变快照。 */
  onUpdate?: (state: BroadcastState) => void;
}

/**
 * 构造播报器。逐段推进、失败中止与取消契约全部内聚于此，
 * 不依赖 React；界面只订阅状态、转发点击。
 */
export function createBroadcastPlayer({ speech, onUpdate }: CreatePlayerOptions): BroadcastPlayer {
  let state: BroadcastState = IDLE_STATE;
  // 每一轮启动取一个新代号；stop/失败也令代号失效，
  // 浏览器在 cancel 后迟到的 end/error 回调凭代号比对被丢弃。
  let runToken = 0;

  const emit = () => {
    onUpdate?.({ ...state, queue: [...state.queue] });
  };

  const playSegment = (token: number, queue: readonly BroadcastSegment[], index: number) => {
    if (token !== runToken) return; // 本轮已被停止/失败/新启动取代
    if (index >= queue.length) {
      state = { ...state, status: 'done', currentIndex: index, message: null };
      emit();
      return;
    }
    state = { ...state, status: 'playing', currentIndex: index, message: null };
    emit();
    speech.speak(queue[index]!.text, {
      onEnd: () => {
        if (token !== runToken) return; // 迟到回调：绝不推进已取消的队列
        playSegment(token, queue, index + 1);
      },
      onError: (message) => {
        if (token !== runToken) return;
        runToken += 1; // 终结本轮，忽略该段之后任何迟到回调
        speech.cancel(); // 清空浏览器侧可能残留的排队语音
        state = {
          status: 'error',
          queue,
          currentIndex: index,
          message: message || '语音合成失败，播报已停止；修改数据后可重新发起。',
        };
        emit();
      },
    });
  };

  return {
    getState: () => state,

    start(data) {
      // 播放中重复启动：直接忽略，保证不多开一条发声链。
      if (state.status === 'playing') return;

      if (!speech.supported) {
        runToken += 1;
        state = { status: 'error', queue: [], currentIndex: 0, message: SPEECH_UNSUPPORTED_MESSAGE };
        emit();
        return;
      }

      const queue = buildBroadcastQueue(data);
      runToken += 1;
      const token = runToken;
      // 先清掉浏览器侧任何残留（如外部页面遗留），再开始本轮，杜绝叠加。
      speech.cancel();
      state = { status: 'playing', queue, currentIndex: 0, message: null };
      playSegment(token, queue, 0);
    },

    stop() {
      if (state.status !== 'playing') return; // 幂等：非播放中无事可做
      runToken += 1; // 让在飞分段的 end/error 立刻失效
      speech.cancel(); // 立即停止发声并清空余下队列
      state = IDLE_STATE;
      emit();
    },
  };
}

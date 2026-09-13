/**
 * 浏览器语音适配器：把 Web Speech API（SpeechSynthesis）封装成
 * 「合成一段、等待结束或错误」的最小接口，供播报器注入使用。
 *
 * 设计要点：
 * - 适配层只与浏览器打交道：speak 负责提交一段合成，结束/失败通过
 *   注入的回调上抛，播报器据此逐段推进或中止；
 * - cancel 立即停止当前发声并清空浏览器队列；
 * - 每次 speak 前由播报器保证先 cancel，重复启动不会叠加声音。
 */

export interface SpeakCallbacks {
  /** 当前分段正常朗读结束。 */
  onEnd: () => void;
  /** 当前分段朗读失败（含底层 error 事件）。 */
  onError: (message: string) => void;
}

export interface SpeechAdapter {
  /** 浏览器是否具备语音合成能力（存在 speechSynthesis 且 speak 可用）。 */
  readonly supported: boolean;
  /** 朗读一段文本；必须在结束或失败时恰好调用 callbacks 中的一个。 */
  speak(text: string, callbacks: SpeakCallbacks): void;
  /** 立即取消当前朗读与浏览器中排队的其余语音。 */
  cancel(): void;
}

/** 浏览器不支持语音合成时的统一中文反馈。 */
export const SPEECH_UNSUPPORTED_MESSAGE = '当前浏览器不支持语音合成，无法播报应急卡内容。';

/** 归一化底层 SpeechSynthesisErrorEvent 的错误类型为中文说明。 */
export function describeSpeechError(error: string | undefined): string {
  switch (error) {
    case 'canceled':
    case 'interrupted':
      // 主动 cancel（停止播报/新一轮启动）由播报器在调用前作废本轮代号，
      // 此回调会被丢弃；只有外部意外中断（代号仍有效）才会展示本提示。
      return '语音播报被中断，已停止；修改数据后可重新发起。';
    case 'not-allowed':
    case 'service-not-allowed':
      return '语音播报被浏览器或系统策略拒绝，请检查权限后重试。';
    case 'network':
      return '语音服务网络异常，播报已停止；修改数据后可重新发起。';
    case 'synthesis-failed':
    case 'synthesis-unavailable':
    default:
      return '语音合成失败，播报已停止；修改数据后可重新发起。';
  }
}

/** SpeechSynthesis 的最小结构声明（仅用到的成员）。 */
interface MinimalSpeechSynthesis {
  speak(utterance: { text: string }): void;
  cancel(): void;
}

interface MinimalSpeechSynthesisEvent {
  readonly type: string;
  readonly error?: string;
}

interface MinimalSpeechSynthesisUtterance {
  text: string;
  lang: string;
  onend: ((event: MinimalSpeechSynthesisEvent) => void) | null;
  onerror: ((event: MinimalSpeechSynthesisEvent) => void) | null;
}

interface MinimalWindow {
  SpeechSynthesisUtterance?: new (text: string) => MinimalSpeechSynthesisUtterance;
  speechSynthesis?: MinimalSpeechSynthesis;
}

/**
 * 基于 window.speechSynthesis 的默认适配器。
 * 浏览器不支持时 supported 为 false，speak/cancel 均为安全空操作。
 */
export function createBrowserSpeechAdapter(win: MinimalWindow = typeof window === 'undefined' ? {} : (window as object as MinimalWindow)): SpeechAdapter {
  const synthesis = win.speechSynthesis;
  const UtteranceCtor = win.SpeechSynthesisUtterance;
  const supported = typeof synthesis?.speak === 'function' && typeof synthesis?.cancel === 'function' && typeof UtteranceCtor === 'function';

  if (!supported) {
    return {
      supported: false,
      speak() {},
      cancel() {},
    };
  }

  return {
    supported: true,
    speak(text, callbacks) {
      let utterance: MinimalSpeechSynthesisUtterance;
      try {
        utterance = new UtteranceCtor!(text);
      } catch (err) {
        callbacks.onError(`语音合成初始化失败：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      utterance.lang = 'zh-CN';
      let settled = false;
      utterance.onend = () => {
        // 主动 cancel 在部分浏览器也会触发 end（而非 error），以 settled 去重，
        // 且取消语义由播报器的 stop 决定，这里仅在未收尾时上抛结束。
        if (settled) return;
        settled = true;
        callbacks.onEnd();
      };
      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        callbacks.onError(describeSpeechError(event.error));
      };
      try {
        synthesis!.speak(utterance);
      } catch (err) {
        // 原生 speak 同步抛错时同样走失败契约，避免播放器停在该段无回调。
        if (settled) return;
        settled = true;
        callbacks.onError(
          `语音合成调用失败：${err instanceof Error ? err.message : String(err)}；修改数据后可重新发起。`,
        );
      }
    },
    cancel() {
      synthesis!.cancel();
    },
  };
}

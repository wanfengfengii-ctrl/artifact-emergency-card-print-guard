import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card } from './components/Card';
import { DRAFT_MESSAGES, clearDraft, getDefaultStorage, loadDraft, saveDraft } from './lib/draft';
import { collectBoundaries, measureCard, measureTopCorrection, type OverflowResult } from './lib/layout';
import { printCard } from './lib/print';
import { moveStep, type StepMoveDirection } from './lib/reorder';
import { resolveTemplateApply } from './lib/templates';
import { codePointLength, normalizeField, validateCard } from './lib/validation';
import { EMPTY_DATA, LIMITS, RISK_LEVELS, type CardData } from './types';

/** 草稿保存时间的展示格式（本地时区、24 小时制）。 */
function formatDraftTime(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false });
}

export function App() {
  const [data, setData] = useState<CardData>(EMPTY_DATA);
  // 旧结论在每次编辑时立即撤销：null 表示尚无结论。
  const [overflow, setOverflow] = useState<OverflowResult | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  // 本机草稿的最近保存时间（恢复自存储或本会话自动保存）；null 表示当前无已存草稿。
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  // 当前保存时间是否来自“恢复旧草稿”（区别于本会话自动保存，仅用于提示措辞）。
  const [draftFromRestore, setDraftFromRestore] = useState(false);
  // 存储不可用/配额超限/草稿损坏的可区分提示。
  const [draftError, setDraftError] = useState<string | null>(null);
  // 步骤换位后的简短状态消息（说明被移动步骤的新序号）；其他编辑时清除。
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // 各步骤输入框的引用，换位后把焦点落回被移动步骤对应的文本框。
  const stepInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  // 已应用的顶部补偿量，避免重复写样式。
  const correctionRef = useRef(0);
  // 挂载时解析一次本机存储；null 表示存储不可用（自动保存时会重试解析）。
  const storageRef = useRef<Storage | null>(null);
  // 用户首次输入后才自动保存；恢复草稿与清空重置不算编辑。
  const dirtyRef = useRef(false);

  const validation = validateCard(data);

  /**
   * 依据真实布局完成一次完整测量：
   * 1) 实测字形盒相对行盒的向上外溢量，写入 CSS 变量让内容整体下移
   *    （补偿随包字体行高与字体度量之差）；
   * 2) 应用后强制重排，再测全部文字/编号边界与安全区。
   * 在 useLayoutEffect 中同步完成，旧结论已在编辑时撤销，且不会闪现错判。
   */
  const remeasure = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;

    const correction = measureTopCorrection(el);
    if (Math.abs(correction - correctionRef.current) > 0.001) {
      correctionRef.current = correction;
      el.style.setProperty('--top-correction', `${correction}px`);
    }

    setOverflow(measureCard(el, collectBoundaries(el)));
  }, []);

  // 每次编辑后（DOM 提交、绘制前）重测。
  useLayoutEffect(() => {
    remeasure();
  }, [data, remeasure]);

  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const rerun = () => {
      if (!cancelled) remeasure();
    };
    fonts?.ready.then(rerun);
    // fontsource 按 unicode-range 分包，新文字触发分包加载后必须重测，
    // 否则会按后备字体留下过期结论。
    fonts?.addEventListener?.('loadingdone', rerun);
    window.addEventListener('resize', rerun);
    return () => {
      cancelled = true;
      fonts?.removeEventListener?.('loadingdone', rerun);
      window.removeEventListener('resize', rerun);
    };
  }, [remeasure]);

  // 挂载时尝试恢复本机草稿：恢复会更新 data，从而沿既有链路
  // 触发表单校验与 useLayoutEffect 的真实布局重测；失败保持空表单可编辑。
  useEffect(() => {
    const storage = getDefaultStorage();
    storageRef.current = storage;
    const result = loadDraft(storage);
    if (result.kind === 'ok') {
      setDraftSavedAt(result.draft.updatedAt);
      setDraftFromRestore(true);
      setData(result.draft.data);
    } else if (result.kind === 'corrupt') {
      setDraftError(DRAFT_MESSAGES.corrupt);
    } else if (result.kind === 'unavailable') {
      setDraftError(DRAFT_MESSAGES.unavailable);
    }
  }, []);

  // 用户首次输入后自动保存完整草稿；成功保存消除此前的存储失败提示，
  // 并把提示条时间更新为本次保存时刻。
  useEffect(() => {
    if (!dirtyRef.current) return;
    // 挂载时的存储失败可能是暂时性的：尚未解析到存储时每次保存前重试，
    // 存储恢复后即可正常保存并消除提示。
    if (storageRef.current === null) {
      storageRef.current = getDefaultStorage();
    }
    const outcome = saveDraft(storageRef.current, data);
    if (outcome.kind === 'ok') {
      setDraftSavedAt(outcome.updatedAt);
      setDraftFromRestore(false);
      setDraftError(null);
    } else {
      setDraftError(outcome.kind === 'quota' ? DRAFT_MESSAGES.quota : DRAFT_MESSAGES.unavailable);
    }
  }, [data]);

  // 换位后等待 DOM 提交，把输入焦点落回被移动步骤在其新位置上的文本框。
  const pendingFocusRef = useRef<number | null>(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    stepInputRefs.current[target]?.focus();
  }, [data]);

  /** 所有编辑共用的入口：撤销旧结论与打印错误，并标记需要自动保存。 */
  const applyEdit = (fn: (prev: CardData) => CardData) => {
    dirtyRef.current = true;
    setPrintError(null);
    setOverflow(null); // 立即撤销旧结论
    setMoveNotice(null); // 普通编辑清除上一次换位的序号提示
    setData(fn);
  };

  const update = (patch: Partial<CardData>) => {
    applyEdit((prev) => ({ ...prev, ...patch }));
  };

  const updateStep = (index: number, value: string) => {
    applyEdit((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value : s)),
    }));
  };

  const addStep = () => {
    if (data.steps.length >= LIMITS.steps.max) return;
    applyEdit((prev) => ({ ...prev, steps: [...prev.steps, ''] }));
  };

  const removeStep = (index: number) => {
    if (data.steps.length <= LIMITS.steps.min) return;
    applyEdit((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  /**
   * 上移/下移一条步骤：以当前 steps 数组为唯一顺序来源，只交换相邻两项。
   * 边界（首条上移、末条下移、只有一条）由纯函数判定为 null，
   * 此时直接返回——不经过 applyEdit，因此内容、保存时间、测量结论与
   * 打印可用性都不改变，也不产生草稿写入。
   * 有效移动沿既有编辑入口触发字段校验、草稿自动保存、卡片重新编号
   * 与安全区重测，并在 DOM 提交后把焦点落回被移动步骤的新文本框。
   */
  const moveStepAt = (index: number, direction: StepMoveDirection) => {
    const result = moveStep(data.steps, index, direction);
    if (result === null) return;
    pendingFocusRef.current = result.index;
    applyEdit((prev) => ({ ...prev, steps: result.steps }));
    // 状态消息在 applyEdit 清空状态之后再设置（同一批次渲染中保留最终值），
    // 说明被移动步骤的新序号；下次任意编辑时由 applyEdit 清除。
    setMoveNotice(`已${direction === 'up' ? '上移' : '下移'}：该步骤现在是第 ${result.index + 1} 步。`);
  };

  /**
   * 套用推荐步骤：把经审核的模板步骤带入表单，沿既有编辑链路
   * 触发字段校验、草稿自动保存、卡片渲染与安全区重测。
   * 已有非空步骤时先确认覆盖；取消确认时不触碰任何状态——
   * 步骤、保存时间、测量结论与打印可用性全部原样保留。
   */
  const handleApplyTemplate = () => {
    const outcome = resolveTemplateApply(data.risk, data.steps, () =>
      window.confirm('已有填写的处置步骤，套用推荐步骤将覆盖现有内容，确定继续吗？'),
    );
    if (outcome.kind !== 'applied') return;
    applyEdit((prev) => ({ ...prev, steps: outcome.steps }));
  };

  /**
   * 清空草稿：删除存储、重置为空表单，并撤销旧测量结论与打印错误。
   * 删除未确认成功时整体中止：保留当前填写内容与旧草稿，
   * 避免"页面已空、重开后旧草稿复活"的双重不一致，用户可重试。
   */
  const handleClearDraft = () => {
    if (!window.confirm('确定清空本机草稿并重置为空表单吗？')) return;
    if (clearDraft(storageRef.current).kind === 'failed') {
      setDraftError(DRAFT_MESSAGES.clearFailed);
      return;
    }
    dirtyRef.current = false; // 空表单不立即回写为新草稿
    setDraftSavedAt(null);
    setDraftFromRestore(false);
    setDraftError(null);
    setPrintError(null);
    setOverflow(null);
    setData(EMPTY_DATA);
  };

  const canPrint = validation.valid && overflow !== null && overflow.ok;

  const handlePrint = async () => {
    // 打印前再次实测，杜绝结论过期。
    remeasure();
    if (!cardRef.current) return;
    const result = measureCard(cardRef.current, collectBoundaries(cardRef.current));
    setOverflow(result);
    if (!result.ok || !validateCard(data).valid) return;
    setPrintError(null);
    try {
      await printCard();
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : '打印调用失败，请重试。');
    }
  };

  const nameLen = codePointLength(normalizeField(data.name));
  const locationLen = codePointLength(normalizeField(data.location));

  return (
    <main className="app">
      <section className="form-panel" aria-label="藏品信息录入">
        <h1 className="form-title">库房渗水 · 文物应急处置卡</h1>

        {(draftSavedAt !== null || draftError !== null) && (
          <div className="draft-bar" role="status" aria-live="polite">
            {draftSavedAt !== null && (
              <p className="draft-restored">
                {draftFromRestore
                  ? `已恢复草稿（保存于 ${formatDraftTime(draftSavedAt)}）`
                  : `草稿已自动保存（${formatDraftTime(draftSavedAt)}）`}
              </p>
            )}
            {draftError !== null && <p className="draft-error">{draftError}</p>}
            <button type="button" className="btn-small" onClick={handleClearDraft}>
              清空草稿
            </button>
          </div>
        )}

        <label className="field">
          <span className="field-label">
            藏品名称
            <span className="field-count">
              {nameLen}/{LIMITS.name.max}
            </span>
          </span>
          <input
            type="text"
            value={data.name}
            maxLength={100}
            placeholder="去除首尾空白后 1—40 个码点"
            onChange={(e) => update({ name: e.target.value })}
            aria-invalid={Boolean(validation.errors.name)}
          />
          {validation.errors.name && <span className="field-error">{validation.errors.name}</span>}
        </label>

        <label className="field">
          <span className="field-label">
            库位
            <span className="field-count">
              {locationLen}/{LIMITS.location.max}
            </span>
          </span>
          <input
            type="text"
            value={data.location}
            maxLength={80}
            placeholder="去除首尾空白后 1—24 个码点"
            onChange={(e) => update({ location: e.target.value })}
            aria-invalid={Boolean(validation.errors.location)}
          />
          {validation.errors.location && <span className="field-error">{validation.errors.location}</span>}
        </label>

        <fieldset className="field">
          <legend className="field-label">风险等级</legend>
          <div className="risk-options">
            {RISK_LEVELS.map((level) => (
              <label key={level} className="risk-option">
                <input
                  type="radio"
                  name="risk"
                  value={level}
                  checked={data.risk === level}
                  onChange={() => update({ risk: level })}
                />
                {level}
              </label>
            ))}
          </div>
          {validation.errors.risk && <span className="field-error">{validation.errors.risk}</span>}
        </fieldset>

        <div className="field">
          <span className="field-label">
            处置步骤（{data.steps.length}/{LIMITS.steps.max}）
          </span>
          <div className="template-bar">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleApplyTemplate}
              disabled={data.risk === ''}
            >
              套用推荐步骤
            </button>
            {data.risk === '' && <span className="template-hint">请先选择风险等级，再套用推荐步骤。</span>}
          </div>
          <div className="steps-edit">
            {data.steps.map((step, index) => {
              const len = codePointLength(normalizeField(step));
              return (
                <div className="step-edit" key={index}>
                  <span className="step-edit-no">{index + 1}.</span>
                  <input
                    ref={(el) => {
                      stepInputRefs.current[index] = el;
                    }}
                    type="text"
                    value={step}
                    maxLength={200}
                    placeholder={`第 ${index + 1} 步（1—${LIMITS.step.max} 个码点，当前 ${len}）`}
                    onChange={(e) => updateStep(index, e.target.value)}
                    aria-invalid={Boolean(validation.errors[`step_${index}`])}
                  />
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => moveStepAt(index, 'up')}
                    disabled={index === 0}
                    aria-label={`上移第 ${index + 1} 步`}
                    title={index === 0 ? '已是第一条，无法上移' : '向上移动一位'}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => moveStepAt(index, 'down')}
                    disabled={index === data.steps.length - 1}
                    aria-label={`下移第 ${index + 1} 步`}
                    title={index === data.steps.length - 1 ? '已是最后一条，无法下移' : '向下移动一位'}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => removeStep(index)}
                    disabled={data.steps.length <= LIMITS.steps.min}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
          {moveNotice && (
            <p className="move-notice" role="status" aria-live="polite">
              {moveNotice}
            </p>
          )}
          {validation.errors.steps && <span className="field-error">{validation.errors.steps}</span>}
          <button type="button" className="btn-secondary" onClick={addStep} disabled={data.steps.length >= LIMITS.steps.max}>
            + 添加步骤
          </button>
        </div>

        <div className="verdict" role="status" aria-live="polite">
          {!validation.valid && <p className="verdict-bad">表单未通过校验，请先修正上述输入。</p>}
          {validation.valid && overflow === null && <p className="verdict-wait">正在测量版式…</p>}
          {validation.valid && overflow !== null && !overflow.ok && (
            <p className="verdict-bad">
              内容越过安全区
              {overflow.edges.length > 0 ? `（${overflow.edges.join('、')}边缘）` : ''}
              ，打印已禁用：
              <br />
              {overflow.violations.map((v) => (
                <span key={v} className="verdict-item">
                  · {v}
                  <br />
                </span>
              ))}
            </p>
          )}
          {validation.valid && overflow !== null && overflow.ok && (
            <p className="verdict-ok">全部文字及编号边界均在安全区内，可以打印。</p>
          )}
          {printError && <p className="verdict-bad">{printError}</p>}
        </div>

        <button type="button" className="btn-primary" onClick={handlePrint} disabled={!canPrint}>
          打印应急卡
        </button>
      </section>

      <section className="preview-panel" aria-label="卡片预览">
        <Card ref={cardRef} data={data} />
      </section>
    </main>
  );
}

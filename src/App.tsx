import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './components/Card';
import { collectBoundaries, measureCard, type OverflowResult } from './lib/layout';
import { printCard } from './lib/print';
import { codePointLength, normalizeField, validateCard } from './lib/validation';
import { EMPTY_DATA, LIMITS, RISK_LEVELS, type CardData } from './types';

export function App() {
  const [data, setData] = useState<CardData>(EMPTY_DATA);
  // 旧结论在每次编辑时立即撤销：null 表示尚无结论。
  const [overflow, setOverflow] = useState<OverflowResult | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const validation = validateCard(data);

  const remeasure = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    setOverflow(measureCard(el, collectBoundaries(el)));
  }, []);

  // 每次编辑后（DOM 提交）重测；字体加载完成后亦重测，确保按真实字形测量。
  useEffect(() => {
    remeasure();
  }, [data, remeasure]);

  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => {
      if (!cancelled) remeasure();
    });
    // fontsource 按 unicode-range 分包，新文字触发分包加载后必须重测，
    // 否则会按后备字体留下过期结论。
    const onFontLoaded = () => {
      if (!cancelled) remeasure();
    };
    fonts?.addEventListener?.('loadingdone', onFontLoaded);
    const onResize = () => remeasure();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      fonts?.removeEventListener?.('loadingdone', onFontLoaded);
      window.removeEventListener('resize', onResize);
    };
  }, [remeasure]);

  const update = (patch: Partial<CardData>) => {
    setPrintError(null);
    setOverflow(null); // 立即撤销旧结论
    setData((prev) => ({ ...prev, ...patch }));
  };

  const updateStep = (index: number, value: string) => {
    setPrintError(null);
    setOverflow(null);
    setData((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value : s)),
    }));
  };

  const addStep = () => {
    if (data.steps.length >= LIMITS.steps.max) return;
    setPrintError(null);
    setOverflow(null);
    setData((prev) => ({ ...prev, steps: [...prev.steps, ''] }));
  };

  const removeStep = (index: number) => {
    if (data.steps.length <= LIMITS.steps.min) return;
    setPrintError(null);
    setOverflow(null);
    setData((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
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
          <div className="steps-edit">
            {data.steps.map((step, index) => {
              const len = codePointLength(normalizeField(step));
              return (
                <div className="step-edit" key={index}>
                  <span className="step-edit-no">{index + 1}.</span>
                  <input
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
                    onClick={() => removeStep(index)}
                    disabled={data.steps.length <= LIMITS.steps.min}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
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

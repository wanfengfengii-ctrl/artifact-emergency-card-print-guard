import { forwardRef } from 'react';
import type { CardData } from '../types';

interface CardProps {
  data: CardData;
}

/**
 * A5 纵向 148×210mm 纸质卡片。
 * 所有需参与安全区测量的文本边界均标注 data-measure。
 * 步骤的编号与正文分别标注，以覆盖悬挂缩进下的编号边界。
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ data }, ref) {
  const steps = data.steps.map((s) => s.trim()).filter((s) => s.length > 0);

  return (
    <div className="card" ref={ref} aria-label="文物应急处置卡预览">
      <div className="card-guide" aria-hidden="true" />
      <div className="card-inner">
        <h1 className="card-title" data-measure="主标题“文物应急处置卡”">
          文物应急处置卡
        </h1>

        <p className="card-line" data-measure="藏品名称">
          <span className="card-label">藏品名称：</span>
          <span className="card-value">{data.name.trim()}</span>
        </p>

        <p className="card-line" data-measure="库位">
          <span className="card-label">库位：</span>
          <span className="card-value">{data.location.trim()}</span>
        </p>

        <p className="card-line" data-measure="风险等级">
          <span className="card-label">风险等级：</span>
          <span className="card-value">{data.risk}</span>
        </p>

        <h2 className="card-subtitle" data-measure="小标题“处置步骤”">
          处置步骤
        </h2>

        <ol className="card-steps">
          {steps.map((step, index) => (
            <li className="card-step" key={index}>
              <span className="step-marker" data-measure={`第${index + 1}步编号`}>
                {index + 1}.
              </span>
              <span className="step-text" data-measure={`第${index + 1}步正文`}>
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});

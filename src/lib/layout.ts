import { CARD_MM } from '../types';

/**
 * 安全区（卡片坐标，单位毫米）：
 * 四边各留 10mm，贴边（等于边界）判定为合格。
 */
export interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const SAFE_AREA: SafeArea = {
  left: CARD_MM.safe,
  top: CARD_MM.safe,
  right: CARD_MM.width - CARD_MM.safe,
  bottom: CARD_MM.height - CARD_MM.safe,
};

export interface Boundary {
  /** 测量对象说明，用于越界提示。 */
  label: string;
  /** 视口坐标系下的矩形（真实文字行片段或编号矩形）。 */
  rect: DOMRect | DOMRectReadOnly;
}

export type OverflowEdge = '上' | '下' | '左' | '右';

export interface OverflowResult {
  ok: boolean;
  /** 越界边缘（去重，保持顺序）。 */
  edges: OverflowEdge[];
  /** 每个越界项的说明（按对象与边缘去重）。 */
  violations: string[];
}

const PX_PER_MM = 96 / 25.4;

/** 亚像素容差（px）：吸收浏览器取整误差，真实越界远大于此值。 */
const EPS_PX = 0.5;

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

/**
 * 依据浏览器实际布局测量：以卡片盒子的实际渲染矩形为基准，
 * 将 10mm 安全区换算到视口坐标系，逐一比较各文字/编号边界。
 * 贴边（相等，忽略亚像素取整）合格，严格越过才判定越界。
 */
export function measureCard(cardEl: HTMLElement, boundaries: Boundary[]): OverflowResult {
  const cardRect = cardEl.getBoundingClientRect();
  const scaleX = cardRect.width / CARD_MM.width;
  const scaleY = cardRect.height / CARD_MM.height;

  const safeViewport = {
    left: cardRect.left + SAFE_AREA.left * scaleX,
    top: cardRect.top + SAFE_AREA.top * scaleY,
    right: cardRect.left + SAFE_AREA.right * scaleX,
    bottom: cardRect.top + SAFE_AREA.bottom * scaleY,
  };

  const edgesSet = new Set<OverflowEdge>();
  const violationsSet = new Set<string>();

  for (const { label, rect } of boundaries) {
    // 空元素（不渲染的占位）不参与测量。
    if (rect.width === 0 && rect.height === 0) continue;

    const hit: OverflowEdge[] = [];
    if (rect.left < safeViewport.left - EPS_PX) hit.push('左');
    if (rect.right > safeViewport.right + EPS_PX) hit.push('右');
    if (rect.top < safeViewport.top - EPS_PX) hit.push('上');
    if (rect.bottom > safeViewport.bottom + EPS_PX) hit.push('下');

    if (hit.length > 0) {
      hit.forEach((e) => edgesSet.add(e));
      violationsSet.add(`${label}越过安全区${hit.join('、')}边缘`);
    }
  }

  return {
    ok: violationsSet.size === 0,
    edges: [...edgesSet],
    violations: [...violationsSet],
  };
}

/**
 * 收集卡片内带 data-measure 属性元素的“真实文字边界”，按视觉行给出。
 *
 * 水平方向：用 Range 选中元素内容后取 getClientRects，浏览器按实际排版
 * 返回每个文字行片段的矩形，其左右边界是文字真实到达处。直接使用块级
 * 元素的 getBoundingClientRect 会得到铺满整行内容宽的行盒，短文字也会
 * 误判为贴到右边缘。
 *
 * 垂直方向：Range/内联矩形是字形盒，受字体 ascent/descent 影响会高于
 * 规范声明的行高（8mm/5.6mm）。上下边界改以块级宿主的行盒为准：
 * 首行行盒顶即块内容顶，每行高为声明行高，保证贴边判定符合版式定义。
 */
export function collectBoundaries(cardEl: HTMLElement): Boundary[] {
  const result: Boundary[] = [];

  cardEl.querySelectorAll<HTMLElement>('[data-measure]').forEach((el) => {
    const label = el.dataset.measure ?? el.textContent ?? '文本';

    const host = (el.closest<HTMLElement>('.card-title,.card-line,.card-subtitle,.card-step') ??
      el) as HTMLElement;
    const hostRect = host.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(host).lineHeight) || hostRect.height;

    const range = document.createRange();
    range.selectNodeContents(el);
    const fragments = range.getClientRects();

    if (fragments.length === 0) {
      const rect = el.getBoundingClientRect();
      if (rect.width !== 0 || rect.height !== 0) result.push({ label, rect });
      return;
    }

    // 同一视觉行的多个内联片段（如“标签”+“值”）其矩形顶边相同，按此分组合并。
    const groups = new Map<number, { left: number; right: number; top: number }>();
    for (const frag of fragments) {
      if (frag.width === 0 && frag.height === 0) continue;
      const key = Math.round(frag.top * 4);
      const prev = groups.get(key);
      if (prev) {
        prev.left = Math.min(prev.left, frag.left);
        prev.right = Math.max(prev.right, frag.right);
        prev.top = Math.min(prev.top, frag.top);
      } else {
        groups.set(key, { left: frag.left, right: frag.right, top: frag.top });
      }
    }

    const lines = [...groups.values()].sort((a, b) => a.top - b.top);
    lines.forEach((line, index) => {
      const top = hostRect.top + index * lineHeight;
      result.push({
        label,
        rect: new DOMRect(line.left, top, line.right - line.left, lineHeight),
      });
    });
  });

  return result;
}

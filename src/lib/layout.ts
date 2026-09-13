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
  /** 视口坐标系下的矩形，四边均为浏览器实测的文字行片段边界。 */
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

interface TextLine {
  label: string;
  /** 同一视觉行内合并后的实测片段矩形（四边均为真实字形盒边界）。 */
  rect: DOMRect;
  /** 该行所属的排版宿主与行序号，用于推算行盒位置。 */
  host: HTMLElement;
  lineIndex: number;
}

const HOST_SELECTOR = '.card-title,.card-line,.card-subtitle,.card-step';

/**
 * 收集卡片内带 data-measure 元素的“真实文字边界”，按视觉行给出。
 *
 * 四边都使用 Range.getClientRects() 的实测片段矩形：
 * - 水平方向：块级元素的 getBoundingClientRect 是铺满整行的行盒，
 *   短文字也会误报贴到右边缘；片段矩形的左右端才是文字真实到达处。
 * - 垂直方向：片段矩形是浏览器按字体度量绘制的字形盒，可能高于声明
 *   行高并向上/向下伸出行盒——这正是必须被检出的真实边界，不能用
 *   按行高重建的行盒代替（否则主标题字形越过安全区上缘会漏检）。
 *
 * 同一视觉行的多个内联片段（如“标签：”+“值”）按 top 分组合并。
 */
export function collectBoundaries(cardEl: HTMLElement): Boundary[] {
  return collectTextLines(cardEl).map(({ label, rect }) => ({ label, rect }));
}

/** @internal 供顶部字形补偿量计算复用。 */
export function collectTextLines(cardEl: HTMLElement): TextLine[] {
  const result: TextLine[] = [];

  cardEl.querySelectorAll<HTMLElement>('[data-measure]').forEach((el) => {
    const label = el.dataset.measure ?? el.textContent ?? '文本';
    const host = (el.closest<HTMLElement>(HOST_SELECTOR) ?? el) as HTMLElement;

    const range = document.createRange();
    range.selectNodeContents(el);
    const fragments = range.getClientRects();

    if (fragments.length === 0) {
      const rect = el.getBoundingClientRect();
      if (rect.width !== 0 || rect.height !== 0) {
        result.push({ label, rect: DOMRect.fromRect(rect), host, lineIndex: 0 });
      }
      return;
    }

    const groups = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    for (const frag of fragments) {
      if (frag.width === 0 && frag.height === 0) continue;
      const key = Math.round(frag.top * 4);
      const prev = groups.get(key);
      if (prev) {
        prev.left = Math.min(prev.left, frag.left);
        prev.right = Math.max(prev.right, frag.right);
        prev.top = Math.min(prev.top, frag.top);
        prev.bottom = Math.max(prev.bottom, frag.bottom);
      } else {
        groups.set(key, { left: frag.left, right: frag.right, top: frag.top, bottom: frag.bottom });
      }
    }

    const lines = [...groups.entries()].sort((a, b) => a[1].top - b[1].top);
    lines.forEach(([, g], lineIndex) => {
      result.push({
        label,
        host,
        lineIndex,
        rect: new DOMRect(g.left, g.top, g.right - g.left, g.bottom - g.top),
      });
    });
  });

  return result;
}

/**
 * 纯函数：由各行的行盒顶与实测字形盒顶计算需要向下补偿的像素量。
 * 字形盒向上伸出本行行盒（字体 ascent 大于行高半行距）时取最大外溢。
 */
export function computeTopCorrection(items: ReadonlyArray<{ lineBoxTop: number; rectTop: number }>): number {
  let max = 0;
  for (const { lineBoxTop, rectTop } of items) {
    const spill = lineBoxTop - rectTop;
    if (spill > max) max = spill;
  }
  return max;
}

/**
 * 实测当前字体下字形盒相对行盒的向上外溢量（px）。
 * 调用方据此把卡片内容整体下移，保证标准版式中字形盒也落在安全区内；
 * 字体分包加载完成后需重新计算。
 */
export function measureTopCorrection(cardEl: HTMLElement): number {
  const hostCache = new Map<HTMLElement, { top: number; lineHeight: number }>();
  const hostBox = (host: HTMLElement) => {
    let box = hostCache.get(host);
    if (!box) {
      const rect = host.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(host).lineHeight) || rect.height;
      box = { top: rect.top, lineHeight };
      hostCache.set(host, box);
    }
    return box;
  };

  return computeTopCorrection(
    collectTextLines(cardEl).map(({ host, lineIndex, rect }) => {
      const box = hostBox(host);
      return { lineBoxTop: box.top + lineIndex * box.lineHeight, rectTop: rect.top };
    }),
  );
}

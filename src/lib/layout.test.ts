import { describe, expect, it } from 'vitest';
import { CARD_MM } from '../types';
import { SAFE_AREA, computeTopCorrection, measureCard, mmToPx, pxToMm } from './layout';

const SCALE = 96 / 25.4;

function fakeCard() {
  return {
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        right: CARD_MM.width * SCALE,
        bottom: CARD_MM.height * SCALE,
        width: CARD_MM.width * SCALE,
        height: CARD_MM.height * SCALE,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  } as HTMLElement;
}

function rect(leftMm: number, topMm: number, rightMm: number, bottomMm: number): DOMRect {
  const l = mmToPx(leftMm);
  const t = mmToPx(topMm);
  const r = mmToPx(rightMm);
  const b = mmToPx(bottomMm);
  return {
    left: l,
    top: t,
    right: r,
    bottom: b,
    width: r - l,
    height: b - t,
    x: l,
    y: t,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('安全区常量', () => {
  it('四边各 10mm，贴边即边界', () => {
    expect(SAFE_AREA).toEqual({ left: 10, top: 10, right: 138, bottom: 200 });
  });

  it('毫米与像素换算', () => {
    expect(pxToMm(mmToPx(25.4))).toBeCloseTo(25.4);
  });
});

describe('computeTopCorrection', () => {
  it('字形盒未伸出行盒时无需补偿', () => {
    expect(
      computeTopCorrection([
        { lineBoxTop: 100, rectTop: 100 },
        { lineBoxTop: 130, rectTop: 131 },
      ]),
    ).toBe(0);
  });

  it('取各行向上外溢量的最大值', () => {
    expect(
      computeTopCorrection([
        { lineBoxTop: 100, rectTop: 98 }, // 上溢 2px
        { lineBoxTop: 130.23, rectTop: 128.23 }, // 上溢 2px
        { lineBoxTop: 160, rectTop: 159 }, // 上溢 1px
      ]),
    ).toBeCloseTo(2);
  });
});

describe('measureCard', () => {
  it('全部边界在安全区内判定合格', () => {
    const result = measureCard(fakeCard(), [
      { label: '标题', rect: rect(10, 10, 80, 18) },
      { label: '正文', rect: rect(10, 20, 130, 190) },
    ]);
    expect(result.ok).toBe(true);
    expect(result.edges).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it('贴边（恰好等于安全区边界）判定合格', () => {
    const result = measureCard(fakeCard(), [{ label: '正文', rect: rect(10, 10, 138, 200) }]);
    expect(result.ok).toBe(true);
  });

  it('越过右边缘标明“右”', () => {
    const result = measureCard(fakeCard(), [{ label: '长文本', rect: rect(10, 10, 138.2, 18) }]);
    expect(result.ok).toBe(false);
    expect(result.edges).toEqual(['右']);
    expect(result.violations[0]).toContain('右边缘');
    expect(result.violations[0]).toContain('长文本');
  });

  it('越过下边缘标明“下”', () => {
    const result = measureCard(fakeCard(), [{ label: '末步', rect: rect(10, 198, 60, 200.5) }]);
    expect(result.ok).toBe(false);
    expect(result.edges).toEqual(['下']);
  });

  it('越过左、上边缘分别标明', () => {
    const result = measureCard(fakeCard(), [
      { label: '编号', rect: rect(9.8, 10, 14, 15.6) },
      { label: '标题', rect: rect(10, 9.8, 50, 18) },
    ]);
    expect(result.ok).toBe(false);
    expect(result.edges).toEqual(['左', '上']);
  });

  it('同时越过多边时全部标明并去重', () => {
    const result = measureCard(fakeCard(), [
      { label: '甲', rect: rect(9, 10, 139, 201) },
      { label: '乙', rect: rect(9, 10, 139, 201) },
    ]);
    expect(result.edges.sort()).toEqual(['下', '右', '左']);
    expect(result.violations).toHaveLength(2);
  });

  it('零尺寸占位元素不参与测量', () => {
    const result = measureCard(fakeCard(), [{ label: '空', rect: rect(0, 0, 0, 0) }]);
    expect(result.ok).toBe(true);
  });

  it('卡片发生屏幕缩放时按实际渲染比例换算', () => {
    const scaledCard = {
      getBoundingClientRect: () =>
        ({
          left: 200,
          top: 100,
          width: CARD_MM.width * SCALE * 0.5,
          height: CARD_MM.height * SCALE * 0.5,
          right: 200 + CARD_MM.width * SCALE * 0.5,
          bottom: 100 + CARD_MM.height * SCALE * 0.5,
        }) as DOMRect,
    } as HTMLElement;
    // 安全区左边在视口中 = 200 + 10mm * (0.5*SCALE)
    const safeLeftPx = 200 + mmToPx(10) * 0.5;
    const bad = {
      left: safeLeftPx - 1,
      top: 100 + mmToPx(10),
      right: safeLeftPx + 10,
      bottom: 100 + mmToPx(20),
      width: 11,
      height: mmToPx(10),
      x: safeLeftPx - 1,
      y: 100 + mmToPx(10),
      toJSON: () => ({}),
    } as DOMRect;
    const result = measureCard(scaledCard, [{ label: '缩放下文本', rect: bad }]);
    expect(result.ok).toBe(false);
    expect(result.edges).toEqual(['左']);
  });
});

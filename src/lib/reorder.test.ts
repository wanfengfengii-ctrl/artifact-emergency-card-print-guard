import { describe, expect, it } from 'vitest';
import { moveStep } from './reorder';

describe('moveStep 相邻换位', () => {
  it('up：与上一条交换，并返回新位置', () => {
    const result = moveStep(['甲', '乙', '丙'], 2, 'up');
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual(['甲', '丙', '乙']);
    expect(result!.index).toBe(1);
  });

  it('down：与下一条交换，并返回新位置', () => {
    const result = moveStep(['甲', '乙', '丙'], 0, 'down');
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual(['乙', '甲', '丙']);
    expect(result!.index).toBe(1);
  });

  it('连续移动：每条完整文本随其条目一起移动，不丢不改', () => {
    let steps = ['一', '二二', '三三三', '四四四四'];
    // 第 1 条连续下移两次：一 → 第 2 → 第 3
    let r = moveStep(steps, 0, 'down')!;
    expect(r.index).toBe(1);
    steps = r.steps;
    r = moveStep(steps, 1, 'down')!;
    expect(r.index).toBe(2);
    steps = r.steps;
    expect(steps).toEqual(['二二', '三三三', '一', '四四四四']);
    // 再把它移回顶部
    r = moveStep(steps, 2, 'up')!;
    steps = r.steps;
    r = moveStep(steps, 1, 'up')!;
    steps = r.steps;
    expect(steps).toEqual(['一', '二二', '三三三', '四四四四']);
  });

  it('换位可在数组往返后回到原顺序', () => {
    const original = ['甲', '乙', '丙', '丁'];
    const moved = moveStep(original, 3, 'up')!.steps;
    expect(moveStep(moved, 2, 'down')!.steps).toEqual(original);
  });
});

describe('moveStep 边界：返回 null 且不产生新数组', () => {
  it('首条上移返回 null', () => {
    expect(moveStep(['甲', '乙'], 0, 'up')).toBeNull();
  });

  it('末条下移返回 null', () => {
    expect(moveStep(['甲', '乙'], 1, 'down')).toBeNull();
  });

  it('只有一条时上移、下移均返回 null（两入口均不可用）', () => {
    expect(moveStep(['独苗'], 0, 'up')).toBeNull();
    expect(moveStep(['独苗'], 0, 'down')).toBeNull();
  });

  it('下标越界（负数、超出长度、非整数）返回 null', () => {
    expect(moveStep(['甲', '乙'], -1, 'up')).toBeNull();
    expect(moveStep(['甲', '乙'], 2, 'down')).toBeNull();
    expect(moveStep(['甲', '乙'], 0.5, 'up')).toBeNull();
  });

  it('被禁用的操作不改原数组，调用方据此可做到无写入', () => {
    const steps = ['甲', '乙', '丙'] as const;
    expect(moveStep(steps, 0, 'up')).toBeNull();
    expect(moveStep(steps, 2, 'down')).toBeNull();
    expect([...steps]).toEqual(['甲', '乙', '丙']);
  });

  it('正常换位不修改入参数组（以当前数组为唯一来源，返回副本）', () => {
    const steps = ['甲', '乙', '丙'];
    const result = moveStep(steps, 0, 'down');
    expect(steps).toEqual(['甲', '乙', '丙']);
    expect(result!.steps).not.toBe(steps);
  });
});

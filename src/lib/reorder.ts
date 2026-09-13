export type StepMoveDirection = 'up' | 'down';

export interface StepMoveResult {
  /** 交换后该步骤所在的新位置（数组下标，即 CardData.steps 中的实际位置）。 */
  index: number;
  /** 交换后的新数组；原数组保持不变。 */
  steps: string[];
}

/**
 * 以当前 CardData.steps 数组为唯一顺序来源，把第 index 条与相邻一条交换：
 * - up：与上一条交换（index - 1）；
 * - down：与下一条交换（index + 1）。
 * 一次只交换相邻两项。
 *
 * 以下边界情形返回 null：首条上移、末条下移、只有一条、下标越界。
 * 调用方必须据此直接退出，不进入既有编辑入口——因此不会触发字段校验、
 * 草稿写入、卡片重新编号或安全区重测，内容、保存时间、测量结论与
 * 打印可用性全部原样保留。
 */
export function moveStep(
  steps: readonly string[],
  index: number,
  direction: StepMoveDirection,
): StepMoveResult | null {
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= steps.length) return null;
  const next = [...steps];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return { index: target, steps: next };
}

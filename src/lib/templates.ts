import { RISK_LEVELS, type RiskLevel } from '../types';
import { normalizeField } from './validation';

/**
 * 库房渗水场景下各风险等级经审核的推荐处置步骤。
 * Record<RiskLevel, ...> 在类型层面保证三个等级全覆盖，缺一不可；
 * 运行时的条数与码点限制由 templates.test.ts 逐一验证。
 * 内容仅供快速带入，套用后仍可按现场情况增删改。
 */
export const RECOMMENDED_STEPS: Record<RiskLevel, readonly string[]> = {
  优先抢救: [
    '切断库房电源，确认无漏电风险后进入',
    '穿戴防护手套，将受水文物转移至干燥安全区',
    '用吸水纸或无纺布轻压吸去表面明水，勿擦拭',
    '按材质分类平放于通风阴凉处自然沥水',
    '记录受损情况并拍照，立即上报保护部门',
  ],
  稳定转移: [
    '评估渗水范围与速度，划定安全转移通道',
    '按优先级将文物装入防潮转运箱并衬垫固定',
    '转移至备用库房，登记出库位置与时间',
    '监测原库房温湿度变化，安排除湿排水',
    '清点核对转移文物，确认无遗漏无新增损伤',
  ],
  原位防护: [
    '查明渗水点，用接水盘或导水槽引离藏品区',
    '用防水布遮盖柜架，底部垫高至少十厘米',
    '加强通风除湿，每小时记录温湿度',
    '巡查渗水变化，一旦扩大立即升级为转移处置',
  ],
};

/** 当前步骤中是否已有任一非空内容（trim 后判定，与校验口径一致）。 */
export function hasAnyNonEmptyStep(steps: readonly string[]): boolean {
  return steps.some((step) => normalizeField(step).length > 0);
}

export type ApplyTemplateOutcome =
  /** 生成完整步骤数组，调用方据此进入既有编辑链路（校验、自动保存、重测）。 */
  | { kind: 'applied'; steps: string[] }
  /** 用户取消覆盖确认：调用方不得改动任何状态（步骤、保存时间、测量结论、打印可用性）。 */
  | { kind: 'cancelled' }
  /** 尚未选择风险等级：入口应保持不可用，不应到达。 */
  | { kind: 'unavailable' };

/**
 * 套用推荐步骤的决策（纯函数，界面只负责提供确认回调）：
 * - 未选风险等级：unavailable；
 * - 无任一非空步骤：直接套用，无需确认；
 * - 已有非空步骤：先经 confirmOverwrite 确认，确认则覆盖，取消则 cancelled。
 * 返回的 steps 是模板副本，调用方增删改不会污染模板。
 */
export function resolveTemplateApply(
  risk: RiskLevel | '',
  currentSteps: readonly string[],
  confirmOverwrite: () => boolean,
): ApplyTemplateOutcome {
  if (!RISK_LEVELS.includes(risk as RiskLevel)) return { kind: 'unavailable' };
  if (hasAnyNonEmptyStep(currentSteps) && !confirmOverwrite()) {
    return { kind: 'cancelled' };
  }
  return { kind: 'applied', steps: [...RECOMMENDED_STEPS[risk as RiskLevel]] };
}

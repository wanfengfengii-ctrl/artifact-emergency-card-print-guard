import { expect, test, type Page } from '@playwright/test';

/**
 * 替换浏览器语音对象后的探测面：记录已提交合成的文本、取消次数，
 * 并由测试手动推进在飞分段（正常结束 / 失败），避免依赖 headless 环境
 * 是否真正具备语音合成能力。
 */
interface SpeechProbe {
  __speechLog: string[];
  __cancelCount: number;
  __endNext: () => void;
  __failNext: (error?: string) => void;
}

type ProbeWindow = Window & SpeechProbe;

/**
 * 在任何页面脚本运行前安装 speechSynthesis / SpeechSynthesisUtterance 桩。
 * cancel 时按 Chrome 行为对在飞分段补发 error= canceled，用于验证
 * “停止后迟到回调不得翻盘”。
 */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    interface PendingUtterance {
      text: string;
      lang: string;
      onend: ((event: { type: string }) => void) | null;
      onerror: ((event: { type: string; error?: string }) => void) | null;
    }
    const queue: PendingUtterance[] = [];
    const w = window as unknown as ProbeWindow;
    w.__speechLog = [];
    w.__cancelCount = 0;

    class FakeSpeechSynthesisUtterance {
      text: string;
      lang = '';
      onend: PendingUtterance['onend'] = null;
      onerror: PendingUtterance['onerror'] = null;
      constructor(text: string) {
        this.text = text;
        queue.push(this as unknown as PendingUtterance);
      }
    }

    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      FakeSpeechSynthesisUtterance;
    // Chromium 中 window.speechSynthesis 是无 setter 的访问器属性，
    // 直接赋值会被静默忽略，必须用 defineProperty 覆盖为桩。
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      writable: true,
      value: {
        speak(utterance: PendingUtterance) {
          w.__speechLog.push(utterance.text);
        },
        cancel() {
          w.__cancelCount += 1;
          const pending = queue.shift();
          if (pending && typeof pending.onerror === 'function') {
            pending.onerror({ type: 'error', error: 'canceled' });
          }
        },
      },
    });

    w.__endNext = () => {
      const pending = queue.shift();
      pending?.onend?.({ type: 'end' });
    };
    w.__failNext = (error = 'network') => {
      const pending = queue.shift();
      pending?.onerror?.({ type: 'error', error });
    };
  });
}

/** 彻底移除语音能力，模拟不支持语音合成的浏览器。 */
async function removeSpeech(page: Page) {
  await page.addInitScript(() => {
    // speechSynthesis 是挂在 Window.prototype 上的访问器，delete 无效；
    // 用取值为 undefined 的自有属性遮蔽它，SpeechSynthesisUtterance 同理覆盖。
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });
}

const endNext = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__endNext());
const failNext = (page: Page, error?: string) =>
  page.evaluate((e) => (window as unknown as ProbeWindow).__failNext(e), error);
const speechLog = (page: Page) =>
  page.evaluate(() => (window as unknown as ProbeWindow).__speechLog);
const cancelCount = (page: Page) =>
  page.evaluate(() => (window as unknown as ProbeWindow).__cancelCount);

/** 完成一份完整录入：名称、库位、风险等级 + 套用 5 条推荐步骤。 */
async function fillCompleteCard(page: Page) {
  await page.getByLabel('藏品名称').fill('青釉瓷罐');
  await page.getByLabel('库位').fill('一号库房 A 区 3 排');
  await page.getByRole('radio', { name: '优先抢救' }).check();
  await page.getByRole('button', { name: '套用推荐步骤' }).click();
  await expect(page.locator('.step-edit input')).toHaveCount(5);
}

const EXPECTED_8 = [
  '藏品名称：青釉瓷罐',
  '库位：一号库房 A 区 3 排',
  '风险等级：优先抢救',
  '第 1 步：切断库房电源，确认无漏电风险后进入',
  '第 2 步：穿戴防护手套，将受水文物转移至干燥安全区',
  '第 3 步：用吸水纸或无纺布轻压吸去表面明水，勿擦拭',
  '第 4 步：按材质分类平放于通风阴凉处自然沥水',
  '第 5 步：记录受损情况并拍照，立即上报保护部门',
];

test.describe('应急卡逐段语音播报', () => {
  test('表单未通过校验时禁止启动并说明原因；完整录入后逐段播报到结束', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');

    const startButton = page.getByRole('button', { name: '开始播报' });
    const stopButton = page.getByRole('button', { name: '停止播报' });

    // 空表单：入口禁用并说明不可启动的原因（列出缺失字段与出错步骤）。
    await expect(startButton).toBeDisabled();
    await expect(page.locator('.broadcast-blocked')).toHaveText(
      '表单尚未通过字段校验，无法开始播报：请先完善藏品名称、库位、风险等级、第 1 步内容。',
    );

    await fillCompleteCard(page);

    // 通过校验：开始入口可用，停止入口待播时不可用。
    await expect(startButton).toBeEnabled();
    await expect(stopButton).toBeDisabled();

    await startButton.click();

    // 立即进入第 1 段：开始入口在播放中禁用（重复启动不叠加声音）。
    await expect(startButton).toBeDisabled();
    await expect(stopButton).toBeEnabled();
    await expect(page.getByText(/正在播报（1\/8）：藏品名称/)).toBeVisible();
    expect(await speechLog(page)).toEqual(['藏品名称：青釉瓷罐']);

    // 逐段推进，每段进度都更新。
    await endNext(page);
    await expect(page.getByText(/正在播报（2\/8）：库位/)).toBeVisible();
    await endNext(page);
    await expect(page.getByText(/正在播报（3\/8）：风险等级/)).toBeVisible();
    // 已结束 2 段，剩余 6 段（风险等级 + 5 条步骤）逐段结束。
    for (let i = 0; i < 6; i += 1) {
      await endNext(page);
    }

    // 全部朗读结束：完成反馈、队列与实际提交合成的文本逐段一致。
    await expect(page.getByText('播报已完成，全部 8 段朗读结束。')).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(stopButton).toBeDisabled();
    expect(await speechLog(page)).toEqual(EXPECTED_8);
  });

  test('播报期间继续编辑不改变本轮固定队列，下次启动才采用新内容', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    const startButton = page.getByRole('button', { name: '开始播报' });
    await fillCompleteCard(page);

    await startButton.click();
    // 走完名称、库位两段结束回调，下一段应是启动时快照里的第 1 步原文。
    await endNext(page); // 名称结束 → 朗读库位
    await endNext(page); // 库位结束 → 朗读风险等级
    await endNext(page); // 风险等级结束 → 朗读第 1 步
    expect(await speechLog(page)).toHaveLength(4);

    // 播报进行中改写第 1 步与名称（沿既有编辑链路，也会触发草稿保存与重测）。
    await page.locator('.step-edit input').first().fill('直播期间临时改写的第一步内容');
    await page.getByLabel('藏品名称').fill('直播期间改的新名称');
    await expect(page.locator('.step-edit input').first()).toHaveValue('直播期间临时改写的第一步内容');

    // 后续朗读的仍是启动时快照：第 1 步原文已在编辑后照常朗读，编辑内容不出现。
    expect(await speechLog(page)).toHaveLength(4);
    expect((await speechLog(page))[3]).toBe('第 1 步：切断库房电源，确认无漏电风险后进入');
    for (let i = 0; i < 5; i += 1) {
      await endNext(page); // 第 1 步结束直到第 5 步结束
    }
    await expect(page.getByText('播报已完成，全部 8 段朗读结束。')).toBeVisible();
    const firstRun = await speechLog(page);
    expect(firstRun.every((text) => !text.includes('直播期间'))).toBe(true);

    // 下次启动采用新内容：名称段为新名称，步骤数仍为 5，第 1 步为改写文本。
    await startButton.click();
    expect((await speechLog(page)).at(-1)).toBe('藏品名称：直播期间改的新名称');
    await endNext(page);
    await endNext(page);
    await endNext(page);
    expect((await speechLog(page)).at(-1)).toBe('第 1 步：直播期间临时改写的第一步内容');
  });

  test('任一分段失败即停止后续并给出明确反馈，修改后可重新发起成功', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    const startButton = page.getByRole('button', { name: '开始播报' });
    const stopButton = page.getByRole('button', { name: '停止播报' });
    await fillCompleteCard(page);

    await startButton.click();
    await endNext(page); // 藏品名称正常结束，库位段开始朗读。
    expect(await speechLog(page)).toHaveLength(2);

    // 库位段合成失败（如网络异常）。
    await failNext(page, 'network');
    await expect(page.getByText(/语音服务网络异常，播报已停止/)).toBeVisible();
    await expect(stopButton).toBeDisabled();
    await expect(startButton).toBeEnabled();
    // 失败后不再提交任何后续分段，且浏览器侧队列被清空。
    expect(await speechLog(page)).toHaveLength(2);
    expect(await cancelCount(page)).toBeGreaterThan(0);

    // 迟到的结束回调不得翻盘为继续播放。
    await endNext(page);
    await expect(page.getByText(/语音服务网络异常/)).toBeVisible();
    expect(await speechLog(page)).toHaveLength(2);

    // 用户修改数据后重新发起：从名称段重新朗读，一路走到播报结束。
    await page.getByLabel('库位').fill('二号库房 B 区 2 排');
    const logAtRetry = (await speechLog(page)).length;
    await startButton.click();
    expect((await speechLog(page)).at(-1)).toBe('藏品名称：青釉瓷罐');
    for (let i = 0; i < 8; i += 1) {
      await endNext(page);
    }
    await expect(page.getByText('播报已完成，全部 8 段朗读结束。')).toBeVisible();
    expect((await speechLog(page)).length - logAtRetry).toBe(8);
    expect((await speechLog(page))[3]).toBe('库位：二号库房 B 区 2 排');
  });

  test('停止播报立即取消余下队列并回到待播状态，迟到回调不再推进', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    const startButton = page.getByRole('button', { name: '开始播报' });
    const stopButton = page.getByRole('button', { name: '停止播报' });
    await fillCompleteCard(page);

    await startButton.click();
    await endNext(page);
    expect(await speechLog(page)).toHaveLength(2);

    await stopButton.click();
    // 立即回到待播状态：停止入口禁用、开始入口恢复、提示为待播说明。
    await expect(stopButton).toBeDisabled();
    await expect(startButton).toBeEnabled();
    await expect(page.getByText(/从当前有效卡片内容生成固定队列/)).toBeVisible();
    expect(await cancelCount(page)).toBeGreaterThan(0);

    // 被取消分段的迟到结束/错误回调（桩在 cancel 时补发 canceled）不得推进或报错。
    const spokenSoFar = (await speechLog(page)).length;
    await expect(page.getByText(/正在播报|语音|网络异常/)).toHaveCount(0);
    expect(await speechLog(page)).toHaveLength(spokenSoFar);

    // 回到待播状态后可再次启动。
    await startButton.click();
    await expect(page.getByText(/正在播报（1\/8）：藏品名称/)).toBeVisible();
    expect((await speechLog(page)).at(-1)).toBe('藏品名称：青釉瓷罐');
  });

  test('浏览器不支持语音合成时禁止启动并说明，不影响录入、草稿、换位与打印可用性', async ({ page }) => {
    await removeSpeech(page);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '开始播报' })).toBeDisabled();
    await expect(page.getByText('当前浏览器不支持语音合成，无法播报应急卡内容。')).toBeVisible();

    // 其余链路不受播报能力影响：完整录入后测量合格、打印可用、换位可用。
    await fillCompleteCard(page);
    await expect(page.getByRole('button', { name: '开始播报' })).toBeDisabled();
    await expect(page.getByText('全部文字及编号边界均在安全区内，可以打印。')).toBeVisible();
    await expect(page.getByRole('button', { name: '打印应急卡' })).toBeEnabled();
    await expect(page.locator('.step-edit').nth(1).getByRole('button', { name: /上移/ })).toBeEnabled();
  });
});

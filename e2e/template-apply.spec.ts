import { expect, test } from '@playwright/test';

/** 打印调用计数（替换 window.print 后记录在页面全局上）。 */
interface PrintProbe {
  __printCalls: number;
}

/** 替换浏览器打印为计数桩，避免 headless 环境弹窗/无响应。 */
async function stubPrint(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as PrintProbe;
    w.__printCalls = 0;
    window.print = () => {
      w.__printCalls += 1;
    };
  });
}

const printCalls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as PrintProbe).__printCalls);

test.describe('套用推荐步骤', () => {
  test('选择风险等级后套用推荐步骤，现场修改后走到合格打印', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/');

    // 未选风险等级：入口禁用，并在旁说明原因。
    const applyButton = page.getByRole('button', { name: '套用推荐步骤' });
    await expect(applyButton).toBeDisabled();
    await expect(page.getByText('请先选择风险等级，再套用推荐步骤。')).toBeVisible();

    // 填写名称与库位。
    await page.getByLabel('藏品名称').fill('青釉瓷罐');
    await page.getByLabel('库位').fill('一号库房 A 区 3 排');

    // 选择风险等级后入口可用，原因说明消失。
    await page.getByRole('radio', { name: '优先抢救' }).check();
    await expect(applyButton).toBeEnabled();
    await expect(page.getByText('请先选择风险等级，再套用推荐步骤。')).toBeHidden();

    // 套用推荐步骤：模板 5 条进入表单并渲染到卡片。
    await applyButton.click();
    const stepInputs = page.locator('.step-edit input');
    await expect(stepInputs).toHaveCount(5);
    await expect(stepInputs.first()).toHaveValue('切断库房电源，确认无漏电风险后进入');
    await expect(page.locator('.card-step')).toHaveCount(5);
    await expect(page.locator('.card-step').first()).toContainText('切断库房电源');

    // 现场修改：改写一条、删除一条、追加一条。
    await stepInputs.first().fill('先切断库房西侧配电箱电源，确认无漏电后进入');
    await page.locator('.step-edit').last().getByRole('button', { name: '删除' }).click();
    await expect(stepInputs).toHaveCount(4);
    await page.getByRole('button', { name: '+ 添加步骤' }).click();
    await page.locator('.step-edit input').last().fill('在库房门口放置挡水沙袋，防止渗水扩大');
    await expect(stepInputs).toHaveCount(5);

    // 套用与修改沿既有链路进入草稿自动保存。
    await expect(page.getByText(/草稿已自动保存（/)).toBeVisible();

    // 真实字形测量合格后可打印，点击打印调用浏览器打印。
    await expect(page.getByText('全部文字及编号边界均在安全区内，可以打印。')).toBeVisible();
    const printButton = page.getByRole('button', { name: '打印应急卡' });
    await expect(printButton).toBeEnabled();
    await printButton.click();
    await expect.poll(() => printCalls(page)).toBe(1);
  });

  test('恢复旧草稿后取消覆盖确认：无写入、无界面变化', async ({ page }) => {
    const oldDraft = {
      version: 1,
      updatedAt: '2026-09-13T08:00:00.000Z',
      data: {
        name: '旧稿青花瓷瓶',
        location: '二号库房 B 区 1 排',
        risk: '稳定转移',
        steps: ['旧草稿第一步：垫高货架', '旧草稿第二步：遮盖防水布'],
      },
    };
    await stubPrint(page);
    await page.addInitScript((draft) => {
      window.localStorage.setItem('relic-emergency-card:draft', JSON.stringify(draft));
    }, oldDraft);
    await page.goto('/');

    // 旧草稿恢复：提示条、表单与卡片均为旧内容。
    await expect(page.getByText(/已恢复草稿（保存于 /)).toBeVisible();
    const stepInputs = page.locator('.step-edit input');
    await expect(stepInputs).toHaveCount(2);
    await expect(stepInputs.nth(0)).toHaveValue('旧草稿第一步：垫高货架');
    await expect(page.locator('.card-step')).toHaveCount(2);

    // 旧草稿经既有链路重测合格，打印可用。
    await expect(page.getByText('全部文字及编号边界均在安全区内，可以打印。')).toBeVisible();
    const printButton = page.getByRole('button', { name: '打印应急卡' });
    await expect(printButton).toBeEnabled();

    // 记录取消前的草稿字节与界面状态。
    const draftBefore = await page.evaluate(() => window.localStorage.getItem('relic-emergency-card:draft'));
    const draftBarText = await page.locator('.draft-bar').textContent();
    const verdictText = await page.locator('.verdict').textContent();

    // 已有非空步骤，套用前弹出确认；取消（dismiss）。
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('覆盖');
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: '套用推荐步骤' }).click();

    // 步骤原样保留（表单与卡片）。
    await expect(stepInputs).toHaveCount(2);
    await expect(stepInputs.nth(0)).toHaveValue('旧草稿第一步：垫高货架');
    await expect(stepInputs.nth(1)).toHaveValue('旧草稿第二步：遮盖防水布');
    await expect(page.locator('.card-step')).toHaveCount(2);

    // 无写入：本机草稿字节级不变。
    const draftAfter = await page.evaluate(() => window.localStorage.getItem('relic-emergency-card:draft'));
    expect(draftAfter).toBe(draftBefore);

    // 界面无变化：草稿提示条（含保存时间）、测量结论与打印可用性原样保留。
    await expect(page.locator('.draft-bar')).toHaveText(draftBarText ?? '');
    await expect(page.locator('.verdict')).toHaveText(verdictText ?? '');
    await expect(page.getByText('全部文字及编号边界均在安全区内，可以打印。')).toBeVisible();
    await expect(printButton).toBeEnabled();
    expect(await printCalls(page)).toBe(0);
  });
});

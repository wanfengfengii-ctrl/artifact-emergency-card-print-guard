/**
 * 调用浏览器打印。成功（对话框正常调起）无返回；
 * 调用失败（浏览器缺失、被拦截或抛错）时抛出带明确中文信息的错误。
 */
export async function printCard(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    throw new Error('当前环境不支持浏览器打印，无法输出卡片。');
  }
  try {
    // 部分浏览器（如旧版 WebKit）无 Promise 版，统一包裹。
    await window.print();
  } catch (err) {
    throw new Error(`打印调用失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

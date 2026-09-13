import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4173;

/**
 * 递归收集目录下所有包含共享库（.so）的目录。
 * 无 root 的环境可用 scripts/install-browser-deps.sh 把浏览器系统库
 * 解压到项目 .local-libs/；存在时注入浏览器进程的 LD_LIBRARY_PATH。
 * 已正常安装系统依赖的环境没有该目录，此逻辑不生效。
 */
function collectLibDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found = new Set<string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes('.so')) found.add(current);
    }
  };
  walk(dir);
  return [...found];
}

const localLibDirs = collectLibDirs(join(process.cwd(), '.local-libs'));
const browserEnv = { ...process.env };
if (localLibDirs.length > 0) {
  browserEnv.LD_LIBRARY_PATH = [localLibDirs.join(':'), process.env.LD_LIBRARY_PATH ?? '']
    .filter(Boolean)
    .join(':');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { env: browserEnv },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

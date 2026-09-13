import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    // e2e/ 为 Playwright 测试，由 npm run test:e2e 单独执行。
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});

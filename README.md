# 库房渗水 · 文物应急处置卡

纯前端应用：录入藏品信息，在 A5 卡片上排版“文物应急处置卡”，并在打印前
**依据浏览器实际布局测量全部文字与编号边界**，任一边界越过安全区即标明
对应边缘并禁用打印。无后端、无任何在线依赖，字体随应用打包。

- 技术栈：TypeScript + React 18 + Vite 5 + CSS Paged Media（`@page` / `@media print`）
- 测试：Vitest（单元测试 21 项）
- 部署：Docker Compose（nginx 静态页面服务 + 一次性 verify 服务）

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest 单元测试
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
npm run verify     # 一次性校验：测试 + 构建
```

## 表单规则（去首尾空白后按 Unicode 码点计数）

| 字段 | 规则 |
| --- | --- |
| 藏品名称 | 1—40 个码点 |
| 库位 | 1—24 个码点 |
| 风险等级 | 仅限“优先抢救 / 稳定转移 / 原位防护” |
| 处置步骤 | 1—8 条，每条 1—80 个码点 |

码点计数使用 `Array.from(value).length`，正确处理 emoji 等代理对字符。

## 卡片版式

- 固定 A5 纵向 **148 × 210 mm**，四边安全区各 **10 mm**。
- 字体：随包打包的 **Noto Sans SC**（`@fontsource/noto-sans-sc`，本地 woff2）。
- 安全区内自上而下左对齐：主标题 → 藏品名称 → 库位 → 风险等级 →
  “处置步骤”小标题 → 编号步骤。
- 主标题字号/行高 6/8 mm，其后空 4 mm；其余文字 4/5.6 mm；
  各信息行与步骤小标题后空 2 mm。
- 步骤采用 `1.` 格式，悬挂缩进 7 mm，条目间距 2 mm。
- 正常空白折叠、码点间自然换行（`overflow-wrap: anywhere`），
  **不截断、不缩放**；内容过长即由测量判定越界。

## 打印前安全区测量

- 每次编辑立即撤销旧结论（结论区显示“正在测量版式…”），在 DOM 提交后
  按真实布局重测；字体分包加载完成（`document.fonts` 的 `loadingdone`）
  后同样重测。
- 测量以卡片实际渲染矩形为基准，将 10 mm 安全区换算到视口坐标系，
  对每个标注 `data-measure` 的元素逐视觉行比较：
  - 水平边界取 `Range.getClientRects()` 的文字行片段真实左右端
    （块元素矩形铺满整行，不能代表短文字的边界）；
  - 垂直边界取宿主行盒（首行顶为块内容顶，按声明行高逐行计算），
    避免字形 ascent/descent 盒被误判为越界。
- 任一边界严格越过安全区即标明越界对象与边缘（上/下/左/右），
  打印按钮禁用；**贴边（恰好在安全区线上）判定为合格**。
- 合格时调用浏览器打印；调用失败给出明确中文提示。
- 打印媒体（`@page size: 148mm 210mm; margin: 0`）仅保留一张卡片，
  隐藏全部录入控件。

## Docker Compose

```bash
# 页面服务（默认 http://localhost:8080 ，可用 WEB_PORT 覆盖）
WEB_PORT=9090 docker compose up --build -d

# 一次性校验（单元测试 + 生产构建，退出即结束）
docker compose run --rm verify
```

## 目录结构

```
src/
  types.ts                 # 类型、枚举、尺寸与长度限制常量
  lib/
    validation.ts          # 码点计数与表单校验
    layout.ts              # 安全区测量、真实文字边界收集
    print.ts               # 浏览器打印调用与错误提示
  components/Card.tsx      # A5 卡片
  App.tsx                  # 录入表单 + 结论 + 打印
  styles/app.css           # 屏幕与打印样式（CSS Paged Media）
```

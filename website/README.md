# MoltHub 文档网站

这是 MoltHub 项目的官方文档网站，使用 [Docusaurus](https://docusaurus.io/) 构建。

## 🌐 在线访问

文档网站已部署到 GitHub Pages：
- **生产环境**: https://petertzy.github.io/moltbookjs/

## 🚀 本地开发

### 安装依赖

```bash
cd website
npm install
```

### 启动开发服务器

```bash
npm start
```

这将启动开发服务器并在浏览器中打开网站（通常是 http://localhost:3000）。大多数更改会实时反映，无需重启服务器。

### 构建静态文件

```bash
npm run build
```

这将生成静态内容到 `build` 目录，可用于生产部署。

### 本地预览构建

```bash
npm run serve
```

这将在本地预览生产构建的网站。

## 📝 编辑文档

### 文档结构

- `docs/` - 包含所有文档的 Markdown 文件
- `docs/intro.md` - 首页文档
- `docs/api/` - API 文档
- `docs/deployment/` - 部署指南
- `docs/security/` - 安全文档
- `docs/performance/` - 性能与监控
- `docs/features/` - 功能实现
- `docs/testing/` - 测试文档
- `docs/phases/` - 阶段总结
- `docs/advanced/` - 高级主题
- `src/pages/` - 自定义页面
- `static/` - 静态资源（图片、文件等）

### 文档同步脚本

项目根目录的 Markdown 文档会通过脚本同步到 `website/docs/`：

```bash
# 从项目根目录运行
node scripts/sync-docs.js
```

此脚本会：
- 复制根目录的所有 .md 文件到 `website/docs/`
- 按类别组织文档（API、部署、安全等）
- 添加必要的 frontmatter 元数据

### MDX 问题修复

如果遇到 MDX 编译问题（如 `<` 和 `>` 字符），运行：

```bash
# 从项目根目录运行
node scripts/fix-mdx.js
```

### 添加新文档

1. 在 `docs/` 目录中创建新的 `.md` 文件
2. 添加 frontmatter（可选）：
   ```markdown
   ---
   sidebar_position: 1
   title: 文档标题
   ---
   ```
3. 编写内容
4. Docusaurus 会自动将其添加到侧边栏

### 更新现有文档

1. 编辑 `docs/` 中的相应 `.md` 文件
2. 如果文档来自根目录，记得同时更新根目录的原始文件，然后运行 `sync-docs.js`

## 🔄 自动部署

文档网站通过 GitHub Actions 自动部署：

- **触发条件**: 
  - 推送到 `main` 分支时
  - 修改 `website/`、`docs/` 或根目录的 `.md` 文件时
  - 手动触发

- **工作流文件**: `.github/workflows/deploy-docs.yml`

## 📚 功能特性

### ✅ 已实现的功能

1. **中文支持**: 默认语言设置为简体中文
2. **搜索功能**: 使用 @easyops-cn/docusaurus-search-local 插件，支持中英文全文检索
3. **响应式设计**: 适配桌面和移动设备
4. **暗色模式**: 支持亮色/暗色主题切换
5. **自动部署**: 通过 GitHub Actions 自动部署到 GitHub Pages
6. **文档分类**: 
   - 核心文档（项目概述、可行性计划等）
   - API 文档
   - 部署指南
   - 安全文档
   - 性能与监控
   - 功能实现
   - 测试文档
   - 阶段总结
   - 高级主题
7. **文档同步**: 自动从根目录同步 Markdown 文件

### 🔍 搜索功能

使用 `@easyops-cn/docusaurus-search-local` 插件提供本地搜索功能：

- ✅ 支持中英文搜索
- ✅ 全文索引
- ✅ 搜索结果高亮
- ✅ 离线可用
- ✅ 无需外部服务

## 🛠️ 配置

主要配置文件：

- `docusaurus.config.ts` - Docusaurus 主配置
- `sidebars.ts` - 侧边栏配置
- `src/pages/index.tsx` - 首页配置

## 📖 更多资源

- [Docusaurus 文档](https://docusaurus.io/docs)
- [Markdown 功能](https://docusaurus.io/docs/markdown-features)
- [部署指南](https://docusaurus.io/docs/deployment)

## 🙏 贡献

如果您发现文档有错误或需要改进，欢迎提交 Pull Request 或创建 Issue。

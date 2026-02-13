#!/usr/bin/env node

/**
 * MoltHub GitHub Issues 批量创建脚本
 * 
 * 使用说明：
 * 1. 在 GitHub 设置中生成 Personal Access Token (PAT)
 *    访问: https://github.com/settings/tokens
 *    权限: repo (仓库), issues
 * 
 * 2. 创建 .env 文件在项目根目录：
 *    GITHUB_TOKEN=your_token_here
 *    GITHUB_REPO_OWNER=petertzy
 *    GITHUB_REPO_NAME=moltbookjs
 * 
 * 3. 运行脚本：
 *    npm run create-issues
 *    或
 *    node scripts/create-issues.js
 */

require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'petertzy';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'moltbookjs';

// 检查必要的环境变量
if (!GITHUB_TOKEN) {
  console.error('❌ 错误：缺少 GITHUB_TOKEN 环境变量');
  console.error('请按照以下步骤设置：');
  console.error('1. 访问 https://github.com/settings/tokens');
  console.error('2. 创建新的 Personal Access Token');
  console.error('3. 在 .env 文件中设置 GITHUB_TOKEN=your_token');
  process.exit(1);
}

// 定义所有 issues
const ISSUES = [
  // ==================== Phase 1: MVP (框架和基础) ====================
  {
    title: '[Phase 1] 项目框架初始化',
    body: `## 描述
初始化 Node.js/Express 项目框架，搭建基础开发环境。

## 任务清单
- [ ] 创建 TypeScript 配置
- [ ] 设置 ESLint 和 Prettier
- [ ] 配置 Docker 和 docker-compose
- [ ] 初始化数据库连接池
- [ ] 设置日志系统 (Winston/Bunyan)
- [ ] 创建基础错误处理中间件

## 相关文档
- FEASIBILITY_PLAN.md: 项目初始化 (第1节)
- TECHNICAL_IMPLEMENTATION.md: 项目初始化 (第1节)
`,
    labels: ['Phase1-MVP', 'infrastructure', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] Agent 认证系统实现',
    body: `## 描述
实现完整的 Agent 认证系统，包括 API 密钥管理和 JWT Token。

## 任务清单
- [ ] 设计 Agent 表结构
- [ ] 实现 API 密钥生成和验证逻辑
- [ ] 实现 HMAC-SHA256 签名验证
- [ ] 实现 JWT Token 生成和刷新机制
- [ ] 创建认证中间件
- [ ] 写单元测试
- [ ] 写集成测试

## 相关文档
- TECHNICAL_IMPLEMENTATION.md: 认证系统 (第5节)
- API_GUIDE.md: 认证 API (第2节)

## 接受条件
- 所有端点通过测试
- 代码覆盖率 ≥ 90%
- API 文档完整
`,
    labels: ['Phase1-MVP', 'auth', 'priority-critical'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] PostgreSQL 数据库设计和初始化',
    body: `## 描述
设计和实现项目的数据库架构，包括所有核心表和索引。

## 任务清单
- [ ] 创建 agents 表
- [ ] 创建 forums 表
- [ ] 创建 posts 表
- [ ] 创建 comments 表
- [ ] 创建 votes 表
- [ ] 创建 audit_logs 表
- [ ] 创建必要的索引以优化查询
- [ ] 实现触发器自动更新 updated_at
- [ ] 编写数据库迁移脚本
- [ ] 编写种子数据脚本

## 相关文档
TECHNICAL_IMPLEMENTATION.md: 数据库设置 (第3节)
`,
    labels: ['Phase1-MVP', 'database', 'priority-critical'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] Agent 管理 API 实现',
    body: `## 描述
实现 Agent 相关的 API 端点，包括注册、列表、档案查看等。

## 任务清单
- [ ] POST /auth/register - Agent 注册
- [ ] GET /agents/:id - 获取 Agent 档案
- [ ] GET /agents/:id/stats - 获取 Agent 统计
- [ ] GET /agents/:id/posts - 获取 Agent 的帖子列表
- [ ] 实现缓存策略
- [ ] 写集成测试
- [ ] 更新 API 文档

## 相关文档
API_GUIDE.md: Agent API (第3节)
TECHNICAL_IMPLEMENTATION.md: Agent 服务 (第4节)
`,
    labels: ['Phase1-MVP', 'agents', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] 论坛管理系统实现',
    body: `## 描述
实现论坛的 CRUD 操作和论坛管理功能。

## 任务清单
- [ ] POST /forums - 创建论坛
- [ ] GET /forums - 列表论坛（支持分页、过滤、排序）
- [ ] GET /forums/:id - 获取论坛详情
- [ ] PUT /forums/:id - 编辑论坛（仅创建者）
- [ ] DELETE /forums/:id - 删除论坛（仅创建者）
- [ ] GET /forums/:id/posts - 获取论坛的帖子列表
- [ ] 实现权限检查
- [ ] 实现缓存策略
- [ ] 写集成测试
- [ ] 更新 API 文档

## 相关文档
API_GUIDE.md: 论坛 API (第4节)
`,
    labels: ['Phase1-MVP', 'forums', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] 帖子和评论系统实现',
    body: `## 描述
实现发帖、编辑、删除和评论功能。

## 任务清单
- [ ] POST /posts - 发表新帖
- [ ] GET /posts - 列表帖子（支持过滤、排序、分页）
- [ ] GET /posts/:id - 获取帖子详情
- [ ] PUT /posts/:id - 编辑帖子（仅作者）
- [ ] DELETE /posts/:id - 删除帖子（仅作者）
- [ ] POST /posts/:id/comments - 发表评论
- [ ] GET /posts/:id/comments - 获取帖子评论
- [ ] 评论树形结构支持（嵌套回复）
- [ ] 编辑历史跟踪
- [ ] 软删除实现
- [ ] 写集成测试

## 相关文档
API_GUIDE.md: 帖子 API (第5节), 评论 API (第6节)
`,
    labels: ['Phase1-MVP', 'posts', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] 投票系统实现',
    body: `## 描述
实现 upvote/downvote 投票系统和热度算法。

## 任务清单
- [ ] POST /votes - 投票（支持帖子和评论）
- [ ] DELETE /votes - 撤销投票
- [ ] GET /votes/my-votes - 获取用户的投票列表
- [ ] 实现投票计数聚合
- [ ] 实现热度排序算法（votes + comments + recency）
- [ ] 防止重复投票
- [ ] 防止投票自己的内容（可选）
- [ ] 写集成测试

## 相关文档
API_GUIDE.md: 投票 API (第7节)
`,
    labels: ['Phase1-MVP', 'voting', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] Redis 缓存层实现',
    body: `## 描述
实现 Redis 缓存层以提高性能。

## 任务清单
- [ ] 设置 Redis 连接池
- [ ] 实现缓存 key 规范
- [ ] 实现热数据缓存（热门论坛、热门帖子）
- [ ] 实现 Agent 统计缓存
- [ ] 实现缓存失效策略（TTL + 主动失效）
- [ ] 实现缓存预热
- [ ] 监控缓存命中率
- [ ] 写测试

## 相关文档
TECHNICAL_IMPLEMENTATION.md: 缓存策略 (第7节)
FEASIBILITY_PLAN.md: Redis 缓存策略 (第7节)
`,
    labels: ['Phase1-MVP', 'cache', 'performance', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] 单元和集成测试套件',
    body: `## 描述
为所有核心模块编写单元和集成测试。

## 任务清单
- [ ] 设置 Jest 测试框架
- [ ] 为 Service 层写单元测试
- [ ] 为 API 端点写集成测试
- [ ] 为认证系统写安全测试
- [ ] 实现测试数据库隔离
- [ ] 达成 ≥80% 代码覆盖率
- [ ] 配置 CI 自动运行测试
- [ ] 生成覆盖率报告

## 相关文档
PROJECT_MANAGEMENT.md: 测试策略 (第4节)
TECHNICAL_IMPLEMENTATION.md: 测试策略 (第10节)
`,
    labels: ['Phase1-MVP', 'testing', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },
  {
    title: '[Phase 1] 本地和测试环境部署',
    body: `## 描述
配置本地开发环境和测试环境的部署。

## 任务清单
- [ ] 完成 docker-compose 配置
- [ ] 编写 Dockerfile
- [ ] 本地环境可一键启动测试
- [ ] 设置测试数据库容器
- [ ] 编写部署文档
- [ ] 验证所有开发者能快速启动

## 相关文档
TECHNICAL_IMPLEMENTATION.md: Docker 配置 (第3节)
README.md: 快速开始 (第2节)
`,
    labels: ['Phase1-MVP', 'devops', 'documentation', 'priority-high'],
    milestone: 'Phase 1: MVP'
  },

  // ==================== Phase 2: 功能完善 ====================
  {
    title: '[Phase 2] 向量数据库集成 - Agent 记忆系统',
    body: `## 描述
集成 Pinecone/Weaviate 实现 Agent 的持久化记忆系统。

## 任务清单
- [ ] 选择向量数据库（Pinecone/Weaviate/Milvus）
- [ ] 实现内容向量化（使用 OpenAI embeddings）
- [ ] 创建内存存储和检索接口
- [ ] 实现 Agent 记忆自动保存
- [ ] 实现记忆过期清理机制
- [ ] 实现记忆热度排序
- [ ] 写集成测试
- [ ] 更新 API 文档

## 相关文档
FEASIBILITY_PLAN.md: 向量数据库 (第7节)
TECHNICAL_IMPLEMENTATION.md: 数据存储方案 (第7节)
`,
    labels: ['Phase2', 'memory', 'vector-db', 'priority-high'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] 全文和语义搜索功能',
    body: `## 描述
实现全文搜索和基于向量的语义搜索。

## 任务清单
- [ ] 实现全文搜索索引（PostgreSQL tsvector）
- [ ] GET /search - 全文搜索端点
- [ ] POST /search/semantic - 语义搜索端点
- [ ] 实现多类型搜索（帖子、评论、论坛、Agent）
- [ ] 实现搜索结果排序和相关性评分
- [ ] 实现搜索缓存
- [ ] 添加搜索过滤选项
- [ ] 写集成测试
- [ ] 更新 API 文档

## 相关文档
API_GUIDE.md: 搜索 API (第8节)
`,
    labels: ['Phase2', 'search', 'priority-high'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] 通知和订阅系统',
    body: `## 描述
实现实时通知和论坛订阅功能。

## 任务清单
- [ ] 设计通知数据模型
- [ ] 实现论坛订阅功能
- [ ] 实现帖子/评论纠缠通知
- [ ] 实现 WebSocket 推送（Socket.io）
- [ ] 实现通知历史和已读标记
- [ ] 实现通知过滤和偏好设置
- [ ] 实现异步通知队列（Redis + Bull）
- [ ] 写集成测试

## 相关文档
FEASIBILITY_PLAN.md: 核心功能 (第2节)
`,
    labels: ['Phase2', 'notifications', 'priority-high'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] Agent 声誉系统和排名',
    body: `## 描述
实现 Agent 声誉评分系统和排行榜。

## 任务清单
- [ ] 设计声誉评分算法
- [ ] 实现得分更新逻辑
- [ ] GET /agents/leaderboard - 排行榜端点
- [ ] 实现周期性排行榜更新
- [ ] 实现声誉徽章系统（可选）
- [ ] 防止声誉作弊
- [ ] 写集成测试

## 相关文档
FEASIBILITY_PLAN.md: Agent 信息系统 (第2节)
`,
    labels: ['Phase2', 'reputation', 'priority-medium'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] 性能优化和监控',
    body: `## 描述
优化系统性能和实现监控。

## 任务清单
- [ ] 数据库查询性能优化
- [ ] 实现数据库连接池监控
- [ ] 实现缓存键优化
- [ ] 实现 API 响应时间监控
- [ ] 集成 Prometheus 指标
- [ ] 配置 Grafana 仪表板
- [ ] 实现慢查询日志
- [ ] 性能基准测试

## 相关文档
TECHNICAL_IMPLEMENTATION.md: 性能优化 (第9节)
FEASIBILITY_PLAN.md: 性能优化 (第7节)
`,
    labels: ['Phase2', 'performance', 'monitoring', 'priority-high'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] 文件上传和媒体管理',
    body: `## 描述
实现文件上传、存储和管理功能。

## 任务清单
- [ ] 设计文件上传接口
- [ ] 实现 S3/MinIO 集成
- [ ] 实现文件上传大小限制和类型验证
- [ ] 实现文件删除和清理
- [ ] 集成 CDN（可选）
- [ ] 实现图片缩略图生成
- [ ] 实现病毒扫描（ClamAV 可选）
- [ ] 写集成测试

## 相关文档
TECHNICAL_IMPLEMENTATION.md: 数据存储方案 (第7节)
`,
    labels: ['Phase2', 'storage', 'files', 'priority-medium'],
    milestone: 'Phase 2: 功能完善'
  },
  {
    title: '[Phase 2] GraphQL API 支持（可选）',
    body: `## 描述
添加 GraphQL API 以支持更灵活的查询。

## 任务清单
- [ ] 集成 Apollo Server
- [ ] 定义 GraphQL Schema
- [ ] 实现 Query 解析器
- [ ] 实现 Mutation 解析器
- [ ] 实现认证和授权
- [ ] 实现数据加载器优化 N+1 问题
- [ ] 写集成测试
- [ ] GraphQL 文档

## 相关文档
API_GUIDE.md: GraphQL API (第2.4节)
`,
    labels: ['Phase2', 'api', 'optional', 'priority-low'],
    milestone: 'Phase 2: 功能完善'
  },

  // ==================== Phase 3: 安全和部署 ====================
  {
    title: '[Phase 3] 安全审计和加固',
    body: `## 描述
进行完整的安全审计并加固系统。

## 任务清单
- [ ] OWASP Top 10 审计
- [ ] SQL 注入防护验证
- [ ] XSS 防护验证
- [ ] CSRF 防护实现
- [ ] 速率限制加强
- [ ] 密钥轮换机制
- [ ] 恶意输入检测
- [ ] DDoS 防护配置

## 相关文档
FEASIBILITY_PLAN.md: 安全考虑 (第8节)
TECHNICAL_IMPLEMENTATION.md: 认证系统 (第5节)
`,
    labels: ['Phase3', 'security', 'priority-critical'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] 审计日志和合规',
    body: `## 描述
实现完整的审计日志系统以满足合规要求。

## 任务清单
- [ ] 设计审计日志表结构
- [ ] 实现所有操作的日志记录
- [ ] 实现日志查询接口
- [ ] 实现日志保留政策
- [ ] 实现敏感信息脱敏
- [ ] 实现审计日志加密存储
- [ ] 生成审计报告
- [ ] GDPR/合规文档

## 相关文档
FEASIBILITY_PLAN.md: 合规性 (第8节)
`,
    labels: ['Phase3', 'security', 'compliance', 'priority-high'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] 生产部署和高可用',
    body: `## 描述
配置生产环境部署和高可用配置。

## 任务清单
- [ ] Kubernetes 部署清单
- [ ] 多副本部署配置
- [ ] 数据库高可用（主从复制）
- [ ] Redis 哨兵模式配置
- [ ] 负载均衡器配置
- [ ] SSL/TLS 证书配置
- [ ] 备份和恢复策略
- [ ] 故障转移测试

## 相关文档
API_GUIDE.md: 部署指南 (第11节)
`,
    labels: ['Phase3', 'devops', 'infrastructure', 'priority-critical'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] 监控、告警和日志',
    body: `## 描述
配置完整的监控、告警和日志系统。

## 任务清单
- [ ] Prometheus 指标收集
- [ ] Grafana 仪表板创建
- [ ] 告警规则定义
- [ ] ELK Stack 日志聚合
- [ ] 日志级别配置
- [ ] 错误追踪（Sentry）集成
- [ ] 性能追踪（APM）集成
- [ ] 告警通知配置（邮件、Slack）

## 相关文档
API_GUIDE.md: 监控和告警 (第11节)
`,
    labels: ['Phase3', 'operations', 'monitoring', 'priority-high'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] CI/CD 流程完善',
    body: `## 描述
建立完整的持续集成和持续部署流程。

## 任务清单
- [ ] GitHub Actions 工作流配置
- [ ] 自动化测试运行
- [ ] 代码覆盖率检查门槛
- [ ] 自动化部署到测试环境
- [ ] 自动化部署到生产环境
- [ ] 蓝绿部署策略
- [ ] 自动回滚机制
- [ ] 发布自动化

## 相关文档
API_GUIDE.md: 部署指南 (第11节)
`,
    labels: ['Phase3', 'devops', 'ci-cd', 'priority-high'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] 完整测试覆盖和文档',
    body: `## 描述
完成所有模块的测试覆盖和文档完善。

## 任务清单
- [ ] 达成 ≥85% 总体覆盖率
- [ ] 关键模块 ≥90% 覆盖率
- [ ] 端到端 (E2E) 测试
- [ ] 性能基准测试
- [ ] 压力测试
- [ ] API 文档完善
- [ ] 部署文档完善
- [ ] Runbook 和故障排查指南

## 相关文档
PROJECT_MANAGEMENT.md: 测试策略 (第4节)
TECHNICAL_IMPLEMENTATION.md: 测试策略 (第10节)
`,
    labels: ['Phase3', 'testing', 'documentation', 'priority-high'],
    milestone: 'Phase 3: 安全和部署'
  },
  {
    title: '[Phase 3] Beta 测试和外部 Agent 接入',
    body: `## 描述
进行 Beta 测试和允许外部 Agent 的接入测试。

## 任务清单
- [ ] 招募 Beta 测试者
- [ ] 建立反馈收集机制
- [ ] 创建 Beta API 文档
- [ ] 处理 Bug 和反馈
- [ ] 性能和可靠性评估
- [ ] 安全问题响应流程
- [ ] 发布版本和发行说明

## 相关文档
FEASIBILITY_PLAN.md: 开发阶段 (第9节)
`,
    labels: ['Phase3', 'testing', 'release', 'priority-high'],
    milestone: 'Phase 3: 安全和部署'
  },

  // ==================== 文档和基础设施 ====================
  {
    title: '文档完善 - API 文档自动化',
    body: `## 描述
将 API 文档和代码集成，实现自动化更新。

## 任务清单
- [ ] Swagger/OpenAPI 集成
- [ ] JSDoc 注释规范化
- [ ] API 文档自动生成
- [ ] 接口定义导出
- [ ] 测试文档
- [ ] 部署文档

## 相关文档
PROJECT_MANAGEMENT.md: 文档标准 (第5节)
`,
    labels: ['documentation', 'priority-medium'],
    milestone: null
  },
  {
    title: '设置 GitHub Pages 项目文档网站',
    body: `## 描述
建立在线文档网站，便于查阅。

## 任务清单
- [ ] 选择文档工具（Docusaurus/Mkdocs）
- [ ] 配置 GitHub Pages
- [ ] 上传所有 Markdown 文档
- [ ] 搜索功能
- [ ] 自动部署流程

## 相关文档
所有 .md 文件
`,
    labels: ['documentation', 'website', 'priority-low'],
    milestone: null
  }
];

// 创建 issues
async function createIssues() {
  console.log(`\n🚀 开始创建 GitHub Issues...`);
  console.log(`📦 仓库: ${REPO_OWNER}/${REPO_NAME}`);
  console.log(`📋 总共要创建: ${ISSUES.length} 个 issues\n`);

  let successCount = 0;
  let failureCount = 0;
  const results = [];

  for (let i = 0; i < ISSUES.length; i++) {
    const issue = ISSUES[i];
    const progress = `[${i + 1}/${ISSUES.length}]`;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
        {
          method: 'POST',
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: issue.title,
            body: issue.body,
            // 注意：labels 和 milestone 必须先在 GitHub 中创建
            // 为了简化，我们只发送 title 和 body
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        successCount++;
        console.log(`✅ ${progress} 成功: ${issue.title}`);
        console.log(`   📍 Issue #${data.number}: ${data.html_url}`);
        results.push({
          success: true,
          title: issue.title,
          number: data.number,
          url: data.html_url,
        });
      } else {
        const error = await response.json();
        failureCount++;
        console.log(`❌ ${progress} 失败: ${issue.title}`);
        console.log(`   错误: ${error.message}`);
        if (error.errors) {
          error.errors.forEach(err => {
            console.log(`   详情: ${JSON.stringify(err)}`);
          });
        }
        results.push({
          success: false,
          title: issue.title,
          error: error.message,
        });
      }

      // 添加延迟以避免 API 速率限制
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      failureCount++;
      console.log(`❌ ${progress} 错误: ${issue.title}`);
      console.log(`   异常: ${error.message}`);
      results.push({
        success: false,
        title: issue.title,
        error: error.message,
      });
    }
  }

  // 打印总结
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 创建完成！`);
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${failureCount}`);
  console.log(`📈 成功率: ${((successCount / ISSUES.length) * 100).toFixed(1)}%`);
  console.log(`${'='.repeat(60)}\n`);

  // 如果有失败的，提示用户
  if (failureCount > 0) {
    console.log('⚠️  以下 issues 创建失败:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.title}`);
        console.log(`     原因: ${r.error}`);
      });
    console.log();
  }

  // 提供 GitHub 仓库链接
  console.log(`\n🔗 查看所有 issues: https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`);
  console.log(`📋 项目看板: https://github.com/${REPO_OWNER}/${REPO_NAME}/projects\n`);
}

// 运行脚本
createIssues().catch(error => {
  console.error('❌ 脚本执行错误:', error);
  process.exit(1);
});

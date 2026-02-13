#!/usr/bin/env node

/**
 * Script to sync markdown files from root directory to website/docs
 * Organizes documentation into categories for better navigation
 */

const fs = require('fs');
const path = require('path');

// Mapping of files to their categories
const categoryMap = {
  // 核心文档 - Core Documentation
  core: [
    'README.md',
    'INDEX.md',
    'FEASIBILITY_PLAN.md',
    'TECHNICAL_IMPLEMENTATION.md',
    'IMPLEMENTATION_SUMMARY.md',
    'PROJECT_MANAGEMENT.md',
  ],
  
  // API 文档 - API Documentation
  api: [
    'API_GUIDE.md',
    'AUTH_EXAMPLES.md',
    'DOCUMENTATION_GUIDE.md',
  ],
  
  // 部署文档 - Deployment Documentation
  deployment: [
    'DEPLOYMENT.md',
    'CICD_GUIDE.md',
    'CICD_QUICKREF.md',
    'SETUP_GUIDE.md',
    'RUNBOOK.md',
    'TROUBLESHOOTING_GUIDE.md',
  ],
  
  // 安全文档 - Security Documentation
  security: [
    'SECURITY_CONFIGURATION.md',
    'SECURITY_SUMMARY.md',
    'SECRETS_CONFIGURATION.md',
    'GDPR_COMPLIANCE.md',
    'OWASP_TOP_10_AUDIT.md',
    'CACHE_SECURITY_SUMMARY.md',
    'SEARCH_SECURITY_SUMMARY.md',
    'REPUTATION_SECURITY_SUMMARY.md',
    'PHASE3_SECURITY_SUMMARY.md',
  ],
  
  // 性能与监控 - Performance & Monitoring
  performance: [
    'PERFORMANCE_MONITORING.md',
    'MONITORING_GUIDE.md',
    'PERFORMANCE_IMPLEMENTATION_SUMMARY.md',
  ],
  
  // 功能实现 - Feature Implementation
  features: [
    'DATABASE_IMPLEMENTATION_SUMMARY.md',
    'CACHE_IMPLEMENTATION_GUIDE.md',
    'SEARCH_IMPLEMENTATION_SUMMARY.md',
    'MEDIA_IMPLEMENTATION_SUMMARY.md',
    'NOTIFICATION_IMPLEMENTATION_SUMMARY.md',
    'REPUTATION_IMPLEMENTATION_SUMMARY.md',
    'AUDIT_IMPLEMENTATION_SUMMARY.md',
  ],
  
  // Beta 和测试 - Beta & Testing
  testing: [
    'BETA_PROGRAM.md',
    'TESTING_SUMMARY.md',
    'PHASE3_TESTING_DOCUMENTATION_SUMMARY.md',
  ],
  
  // 阶段总结 - Phase Summaries
  phases: [
    'PHASE1_SUMMARY.md',
    'PHASE1_DEPLOYMENT_SUMMARY.md',
    'PHASE3_BETA_IMPLEMENTATION_SUMMARY.md',
    'PHASE3_CICD_SUMMARY.md',
    'PHASE3_DEPLOYMENT_SUMMARY.md',
    'PHASE3_MONITORING_SUMMARY.md',
  ],
};

// Create frontmatter for a markdown file
function createFrontmatter(filename, category) {
  const title = filename
    .replace('.md', '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  const categoryTitles = {
    core: '核心文档',
    api: 'API 文档',
    deployment: '部署指南',
    security: '安全文档',
    performance: '性能与监控',
    features: '功能实现',
    testing: '测试文档',
    phases: '阶段总结',
  };
  
  return `---
id: ${filename.replace('.md', '').toLowerCase().replace(/_/g, '-')}
title: ${title}
sidebar_label: ${title}
---

`;
}

// Process a markdown file
function processMarkdownFile(sourcePath, targetPath, category) {
  let content = fs.readFileSync(sourcePath, 'utf-8');
  
  // Check if file already has frontmatter
  if (!content.startsWith('---')) {
    const filename = path.basename(sourcePath);
    const frontmatter = createFrontmatter(filename, category);
    content = frontmatter + content;
  }
  
  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  // Write the file
  fs.writeFileSync(targetPath, content, 'utf-8');
  console.log(`✓ Synced: ${path.basename(sourcePath)} -> ${targetPath.replace(process.cwd(), '.')}`);
}

// Main sync function
function syncDocs() {
  const rootDir = path.join(__dirname, '..');
  const websiteDocsDir = path.join(rootDir, 'website', 'docs');
  
  console.log('🚀 Starting documentation sync...\n');
  
  // Process each category
  Object.entries(categoryMap).forEach(([category, files]) => {
    console.log(`\n📁 Processing category: ${category}`);
    
    files.forEach(filename => {
      const sourcePath = path.join(rootDir, filename);
      
      // Skip if source doesn't exist
      if (!fs.existsSync(sourcePath)) {
        console.log(`⚠️  Skipped (not found): ${filename}`);
        return;
      }
      
      // Determine target path based on category
      let targetPath;
      if (category === 'core') {
        // Core docs go in root of docs folder
        targetPath = path.join(websiteDocsDir, filename.toLowerCase());
      } else {
        // Other categories go in subdirectories
        targetPath = path.join(websiteDocsDir, category, filename.toLowerCase());
      }
      
      processMarkdownFile(sourcePath, targetPath, category);
    });
  });
  
  console.log('\n✅ Documentation sync completed!\n');
}

// Run the sync
try {
  syncDocs();
} catch (error) {
  console.error('❌ Error syncing documentation:', error);
  process.exit(1);
}

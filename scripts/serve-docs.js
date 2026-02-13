#!/usr/bin/env node

/**
 * Documentation Server
 * 
 * Simple HTTP server to serve generated API documentation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DOCS_DIR = path.join(__dirname, '../docs/api');
const DEFAULT_FILE = 'index.html';

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown'
};

/**
 * Get content type from file extension
 * @param {string} filePath - File path
 * @returns {string} MIME type
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Serve file
 * @param {Object} res - HTTP response object
 * @param {string} filePath - File to serve
 */
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      res.end(content, 'utf-8');
    }
  });
}

/**
 * Create HTTP server
 */
const server = http.createServer((req, res) => {
  let filePath = path.join(DOCS_DIR, req.url === '/' ? DEFAULT_FILE : req.url);
  
  // Prevent directory traversal using resolved absolute paths
  const resolvedFilePath = path.resolve(filePath);
  const resolvedDocsDir = path.resolve(DOCS_DIR);
  
  if (!resolvedFilePath.startsWith(resolvedDocsDir)) {
    res.writeHead(403);
    res.end('Forbidden', 'utf-8');
    return;
  }
  
  // Check if path is a directory
  if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isDirectory()) {
    filePath = path.join(resolvedFilePath, DEFAULT_FILE);
  } else {
    filePath = resolvedFilePath;
  }
  
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  serveFile(res, filePath);
});

/**
 * Start server
 */
function start() {
  // Check if docs directory exists
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`❌ Error: Documentation directory not found: ${DOCS_DIR}`);
    console.log(`\n💡 Please generate documentation first:`);
    console.log(`   npm run docs:build`);
    process.exit(1);
  }
  
  // Check if index.html exists
  const indexPath = path.join(DOCS_DIR, DEFAULT_FILE);
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ Error: ${DEFAULT_FILE} not found in ${DOCS_DIR}`);
    console.log(`\n💡 Please generate documentation first:`);
    console.log(`   npm run docs:api`);
    process.exit(1);
  }
  
  server.listen(PORT, () => {
    console.log(`\n🚀 Documentation server started!`);
    console.log(`\n📖 Documentation available at:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\n📄 Serving files from: ${DOCS_DIR}`);
    console.log(`\n👉 Press Ctrl+C to stop the server\n`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server
start();

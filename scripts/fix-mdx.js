#!/usr/bin/env node

/**
 * Script to fix MDX compilation issues in markdown files
 * Fixes common issues like < and > characters that conflict with JSX
 */

const fs = require('fs');
const path = require('path');

function fixMDXContent(content) {
  // Replace <number with &lt;number
  content = content.replace(/(<)(\d)/g, '&lt;$2');
  
  // Replace ">number" patterns  
  content = content.replace(/(\s)>(\d)/g, '$1&gt;$2');
  
  // Replace standalone < > patterns that might be confused with JSX
  content = content.replace(/\s<\s/g, ' &lt; ');
  content = content.replace(/\s>\s/g, ' &gt; ');
  
  return content;
}

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixed = fixMDXContent(content);
    
    if (content !== fixed) {
      fs.writeFileSync(filePath, fixed, 'utf-8');
      console.log(`✓ Fixed: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    return false;
  }
}

function processDirectory(dirPath) {
  let fixedCount = 0;
  
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      fixedCount += processDirectory(fullPath);
    } else if (item.endsWith('.md')) {
      if (processFile(fullPath)) {
        fixedCount++;
      }
    }
  }
  
  return fixedCount;
}

// Main execution
const docsDir = path.join(__dirname, '..', 'website', 'docs');

console.log('🔧 Fixing MDX compilation issues...\n');

const fixedCount = processDirectory(docsDir);

console.log(`\n✅ Fixed ${fixedCount} file(s)`);

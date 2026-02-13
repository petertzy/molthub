#!/usr/bin/env node

/**
 * OpenAPI Specification Generator from JSDoc
 * 
 * This script scans source code for JSDoc @swagger annotations
 * and generates/updates the OpenAPI specification file.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OPENAPI_FILE = path.join(__dirname, '../openapi.yaml');
const SOURCE_DIRS = [
  path.join(__dirname, '../src'),
  path.join(__dirname, '../lib')
];

/**
 * Extract @swagger annotations from a file
 * @param {string} filePath - Path to source file
 * @returns {Array<Object>} Array of swagger definitions
 */
function extractSwaggerFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const swaggerAnnotations = [];
  
  // Match JSDoc blocks with @swagger tags
  const jsdocRegex = /\/\*\*[\s\S]*?@swagger[\s\S]*?\*\//g;
  const matches = content.match(jsdocRegex);
  
  if (matches) {
    matches.forEach(match => {
      // Extract YAML content after @swagger
      const swaggerRegex = /@swagger\s+([\s\S]*?)(?:\*\/|@\w+)/;
      const swaggerMatch = match.match(swaggerRegex);
      
      if (swaggerMatch && swaggerMatch[1]) {
        try {
          const yamlContent = swaggerMatch[1]
            .split('\n')
            .map(line => line.replace(/^\s*\*\s?/, ''))
            .join('\n')
            .trim();
          
          const parsed = yaml.load(yamlContent);
          if (parsed) {
            swaggerAnnotations.push(parsed);
          }
        } catch (error) {
          console.warn(`⚠️  Warning: Failed to parse @swagger in ${filePath}`);
          console.warn(`   Error: ${error.message}`);
          console.warn(`   Please check the YAML syntax in the @swagger annotation`);
        }
      }
    });
  }
  
  return swaggerAnnotations;
}

/**
 * Scan directory for source files
 * @param {string} dirPath - Directory to scan
 * @returns {Array<string>} Array of file paths
 */
function scanDirectory(dirPath) {
  const files = [];
  
  if (!fs.existsSync(dirPath)) {
    return files;
  }
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && /\.(js|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Merge swagger definitions into OpenAPI spec
 * @param {Object} spec - Existing OpenAPI spec
 * @param {Array<Object>} definitions - Swagger definitions to merge
 * @returns {Object} Updated spec
 */
function mergeSwaggerDefinitions(spec, definitions) {
  definitions.forEach(def => {
    // Merge paths
    if (def.paths) {
      spec.paths = spec.paths || {};
      Object.keys(def.paths).forEach(path => {
        spec.paths[path] = {
          ...spec.paths[path],
          ...def.paths[path]
        };
      });
    }
    
    // Merge components
    if (def.components) {
      spec.components = spec.components || {};
      ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes'].forEach(type => {
        if (def.components[type]) {
          spec.components[type] = spec.components[type] || {};
          Object.assign(spec.components[type], def.components[type]);
        }
      });
    }
    
    // Merge tags
    if (def.tags) {
      spec.tags = spec.tags || [];
      def.tags.forEach(newTag => {
        const exists = spec.tags.some(tag => tag.name === newTag.name);
        if (!exists) {
          spec.tags.push(newTag);
        }
      });
    }
  });
  
  return spec;
}

/**
 * Validate OpenAPI specification
 * @param {Object} spec - OpenAPI spec to validate
 * @returns {boolean} True if valid
 */
function validateSpec(spec) {
  const required = ['openapi', 'info', 'paths'];
  const missing = required.filter(field => !spec[field]);
  
  if (missing.length > 0) {
    console.error(`❌ Invalid OpenAPI spec. Missing fields: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
}

/**
 * Main function
 */
function main() {
  console.log('🚀 Generating OpenAPI specification from JSDoc annotations...\n');
  
  // Load existing OpenAPI spec
  let spec = {};
  if (fs.existsSync(OPENAPI_FILE)) {
    try {
      const content = fs.readFileSync(OPENAPI_FILE, 'utf8');
      spec = yaml.load(content);
      console.log('✅ Loaded existing OpenAPI spec\n');
    } catch (error) {
      console.warn(`⚠️  Warning: Could not load existing spec: ${error.message}`);
      console.log('   Creating new spec from scratch...\n');
    }
  }
  
  // Ensure basic structure
  spec.openapi = spec.openapi || '3.0.0';
  spec.info = spec.info || {
    title: 'MoltHub API',
    version: '1.0.0',
    description: 'API documentation for MoltHub'
  };
  spec.paths = spec.paths || {};
  
  // Scan source directories
  let totalFiles = 0;
  let totalAnnotations = 0;
  const allDefinitions = [];
  
  SOURCE_DIRS.forEach(sourceDir => {
    if (!fs.existsSync(sourceDir)) {
      console.log(`⚠️  Source directory not found: ${sourceDir}`);
      return;
    }
    
    console.log(`📂 Scanning: ${sourceDir}`);
    const files = scanDirectory(sourceDir);
    totalFiles += files.length;
    
    files.forEach(file => {
      const definitions = extractSwaggerFromFile(file);
      if (definitions.length > 0) {
        console.log(`   ✓ Found ${definitions.length} @swagger annotation(s) in ${path.relative(process.cwd(), file)}`);
        allDefinitions.push(...definitions);
        totalAnnotations += definitions.length;
      }
    });
  });
  
  console.log(`\n📊 Summary:`);
  console.log(`   - Files scanned: ${totalFiles}`);
  console.log(`   - @swagger annotations found: ${totalAnnotations}`);
  
  if (totalAnnotations > 0) {
    // Merge definitions into spec
    spec = mergeSwaggerDefinitions(spec, allDefinitions);
    console.log(`\n✅ Merged ${totalAnnotations} annotation(s) into OpenAPI spec`);
  } else {
    console.log(`\n⚠️  No @swagger annotations found in source code`);
    console.log(`   Using existing OpenAPI specification`);
  }
  
  // Validate spec
  if (!validateSpec(spec)) {
    process.exit(1);
  }
  
  // Write updated spec
  const yamlContent = yaml.dump(spec, {
    indent: 2,
    lineWidth: 120,
    noRefs: false
  });
  
  fs.writeFileSync(OPENAPI_FILE, yamlContent, 'utf8');
  console.log(`\n✅ OpenAPI specification updated: ${OPENAPI_FILE}`);
  console.log(`\n💡 Next steps:`);
  console.log(`   - Run: npm run docs:api`);
  console.log(`   - View: npm run docs:serve`);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { extractSwaggerFromFile, mergeSwaggerDefinitions, validateSpec };

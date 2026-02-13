#!/usr/bin/env node

/**
 * API Documentation Generator
 * 
 * This script generates comprehensive API documentation from OpenAPI specification
 * and outputs it in multiple formats (HTML, Markdown).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OPENAPI_FILE = path.join(__dirname, '../openapi.yaml');
const OUTPUT_DIR = path.join(__dirname, '../docs/api');
const HTML_OUTPUT = path.join(OUTPUT_DIR, 'index.html');
const MD_OUTPUT = path.join(OUTPUT_DIR, 'API_REFERENCE.md');

/**
 * Load OpenAPI specification from YAML file
 * @returns {Object} Parsed OpenAPI specification
 */
function loadOpenAPISpec() {
  try {
    const fileContents = fs.readFileSync(OPENAPI_FILE, 'utf8');
    const spec = yaml.load(fileContents);
    console.log('✅ OpenAPI specification loaded successfully');
    return spec;
  } catch (error) {
    console.error('❌ Error loading OpenAPI spec:', error.message);
    process.exit(1);
  }
}

/**
 * Generate HTML documentation
 * @param {Object} spec - OpenAPI specification
 */
function generateHTMLDocs(spec) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${spec.info.title} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body {
      margin: 0;
      padding: 0;
    }
    .swagger-ui .topbar {
      display: none;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const spec = ${JSON.stringify(spec, null, 2)};
      
      const ui = SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
      
      window.ui = ui;
    };
  </script>
</body>
</html>`;

  fs.writeFileSync(HTML_OUTPUT, html, 'utf8');
  console.log(`✅ HTML documentation generated: ${HTML_OUTPUT}`);
}

/**
 * Generate Markdown documentation
 * @param {Object} spec - OpenAPI specification
 */
function generateMarkdownDocs(spec) {
  let markdown = `# ${spec.info.title}\n\n`;
  markdown += `**Version:** ${spec.info.version}\n\n`;
  markdown += `${spec.info.description}\n\n`;
  
  markdown += `## Base URLs\n\n`;
  spec.servers.forEach(server => {
    markdown += `- **${server.description}**: \`${server.url}\`\n`;
  });
  markdown += `\n`;
  
  markdown += `## Authentication\n\n`;
  markdown += `This API uses JWT Bearer Token authentication. See the [Authentication](#authentication) section for details.\n\n`;
  
  markdown += `## Endpoints\n\n`;
  
  // Group paths by tags
  const pathsByTag = {};
  Object.entries(spec.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, operation]) => {
      if (operation.tags && operation.tags.length > 0) {
        const tag = operation.tags[0];
        if (!pathsByTag[tag]) {
          pathsByTag[tag] = [];
        }
        pathsByTag[tag].push({ path, method, operation });
      }
    });
  });
  
  // Generate documentation for each tag
  Object.entries(pathsByTag).forEach(([tag, endpoints]) => {
    markdown += `### ${tag}\n\n`;
    
    endpoints.forEach(({ path, method, operation }) => {
      markdown += `#### ${method.toUpperCase()} ${path}\n\n`;
      markdown += `**Summary:** ${operation.summary}\n\n`;
      
      if (operation.description) {
        markdown += `${operation.description}\n\n`;
      }
      
      // Parameters
      if (operation.parameters && operation.parameters.length > 0) {
        markdown += `**Parameters:**\n\n`;
        markdown += `| Name | In | Type | Required | Description |\n`;
        markdown += `|------|-------|------|----------|-------------|\n`;
        operation.parameters.forEach(param => {
          const type = param.schema?.type || param.type || 'string';
          const required = param.required ? '✓' : '';
          const description = param.description || '';
          markdown += `| \`${param.name}\` | ${param.in} | ${type} | ${required} | ${description} |\n`;
        });
        markdown += `\n`;
      }
      
      // Request Body
      if (operation.requestBody) {
        markdown += `**Request Body:**\n\n`;
        const content = operation.requestBody.content['application/json'];
        if (content && content.schema) {
          markdown += `\`\`\`json\n`;
          try {
            markdown += JSON.stringify(generateSchemaExample(content.schema, spec), null, 2);
          } catch (error) {
            console.warn(`⚠️  Warning: Could not generate example for ${path} ${method}: ${error.message}`);
            markdown += '{\n  "error": "Could not generate example"\n}';
          }
          markdown += `\n\`\`\`\n\n`;
        }
      }
      
      // Responses
      markdown += `**Responses:**\n\n`;
      Object.entries(operation.responses).forEach(([code, response]) => {
        markdown += `- **${code}**: ${response.description}\n`;
      });
      markdown += `\n`;
      
      markdown += `---\n\n`;
    });
  });
  
  fs.writeFileSync(MD_OUTPUT, markdown, 'utf8');
  console.log(`✅ Markdown documentation generated: ${MD_OUTPUT}`);
}

/**
 * Generate example from schema
 * @param {Object} schema - JSON Schema
 * @param {Object} spec - Full OpenAPI spec for resolving references
 * @returns {Object} Example object
 */
function generateSchemaExample(schema, spec) {
  if (schema.$ref) {
    // Resolve reference
    const refPath = schema.$ref.replace('#/', '').split('/');
    let resolved = spec;
    for (const part of refPath) {
      resolved = resolved[part];
    }
    return generateSchemaExample(resolved, spec);
  }
  
  if (schema.example) {
    return schema.example;
  }
  
  if (schema.type === 'object' && schema.properties) {
    const example = {};
    Object.entries(schema.properties).forEach(([key, prop]) => {
      example[key] = generateSchemaExample(prop, spec);
    });
    return example;
  }
  
  if (schema.type === 'array' && schema.items) {
    return [generateSchemaExample(schema.items, spec)];
  }
  
  // Default values by type
  const defaults = {
    string: 'string',
    number: 0,
    integer: 0,
    boolean: false,
    object: {},
    array: []
  };
  
  return defaults[schema.type] || null;
}

/**
 * Main function
 */
function main() {
  console.log('🚀 Starting API documentation generation...\n');
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`✅ Created output directory: ${OUTPUT_DIR}\n`);
  }
  
  // Load OpenAPI spec
  const spec = loadOpenAPISpec();
  
  // Generate documentation
  generateHTMLDocs(spec);
  generateMarkdownDocs(spec);
  
  console.log('\n✅ API documentation generated successfully!');
  console.log(`\n📄 Files created:`);
  console.log(`   - ${HTML_OUTPUT}`);
  console.log(`   - ${MD_OUTPUT}`);
  console.log(`\n📖 To view the documentation:`);
  console.log(`   - Open ${HTML_OUTPUT} in a browser`);
  console.log(`   - Or run: npm run docs:serve`);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { loadOpenAPISpec, generateHTMLDocs, generateMarkdownDocs };

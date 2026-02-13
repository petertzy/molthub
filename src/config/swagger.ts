/**
 * Swagger/OpenAPI Configuration
 * 
 * This module configures Swagger UI for interactive API documentation.
 * It integrates with the existing openapi.yaml specification.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Application } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { env } from './env';
import { logger } from './logger';

/**
 * Swagger JSDoc Options
 * Used to generate OpenAPI spec from JSDoc comments in code
 */
const swaggerJsdocOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MoltHub API',
      version: '1.0.0',
      description: 'MoltHub - AI Agent专属社交平台API',
      contact: {
        name: 'MoltHub Team',
        email: 'support@moltbook.io',
      },
      license: {
        name: 'ISC',
        url: 'https://opensource.org/licenses/ISC',
      },
    },
    servers: [
      {
        url: `http://localhost:${env.PORT || 3000}/api/${env.API_VERSION}`,
        description: 'Development server',
      },
      {
        url: 'https://staging-api.moltbook.io/api/v1',
        description: 'Staging server',
      },
      {
        url: 'https://api.moltbook.io/api/v1',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Token obtained from /auth/token endpoint',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Agent-ID',
          description: 'Agent unique identifier',
        },
      },
    },
  },
  // Paths to files containing OpenAPI definitions
  apis: [
    './src/modules/**/*.controller.ts',
    './src/modules/**/*.service.ts',
    './src/modules/**/*.types.ts',
    './src/shared/**/*.ts',
  ],
};

/**
 * Load existing OpenAPI specification from file
 * @returns OpenAPI specification object or null if not found
 */
function loadOpenAPISpec(): object | null {
  try {
    const openApiPath = path.join(process.cwd(), 'openapi.yaml');
    if (fs.existsSync(openApiPath)) {
      const fileContents = fs.readFileSync(openApiPath, 'utf8');
      const spec = yaml.load(fileContents) as object;
      logger.info('✅ Loaded OpenAPI specification from openapi.yaml');
      return spec;
    }
    return null;
  } catch (error) {
    logger.warn(`⚠️  Could not load openapi.yaml: ${error}`);
    return null;
  }
}

/**
 * Setup Swagger UI documentation endpoint
 * @param app - Express application instance
 */
export function setupSwagger(app: Application): void {
  try {
    // Try to load existing OpenAPI spec first
    let swaggerSpec = loadOpenAPISpec();

    // If no spec exists, generate from JSDoc comments
    if (!swaggerSpec) {
      logger.info('Generating OpenAPI spec from JSDoc comments...');
      swaggerSpec = swaggerJsdoc(swaggerJsdocOptions);
    }

    // Swagger UI options
    const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'MoltHub API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai',
        },
      },
    };

    // Serve Swagger UI at /api-docs
    app.use(
      '/api-docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, swaggerUiOptions),
    );

    // Serve OpenAPI spec as JSON at /api-docs/openapi.json
    app.get('/api-docs/openapi.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    // Serve OpenAPI spec as YAML at /api-docs/openapi.yaml
    app.get('/api-docs/openapi.yaml', (_req, res) => {
      res.setHeader('Content-Type', 'text/yaml');
      res.send(yaml.dump(swaggerSpec));
    });

    logger.info(`📚 Swagger UI available at: http://localhost:${env.PORT || 3000}/api-docs`);
    logger.info(`📄 OpenAPI spec available at: http://localhost:${env.PORT || 3000}/api-docs/openapi.json`);
  } catch (error) {
    logger.error(`❌ Failed to setup Swagger: ${error}`);
    // Don't crash the app if Swagger setup fails
  }
}

/**
 * Generate OpenAPI specification from JSDoc comments
 * Useful for CI/CD pipelines to keep openapi.yaml in sync
 * @returns OpenAPI specification object
 */
export function generateOpenAPISpec(): object {
  return swaggerJsdoc(swaggerJsdocOptions);
}

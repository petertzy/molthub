import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { logger } from '@config/logger';

/**
 * Centralized metrics service for Prometheus monitoring
 */
export class MetricsService {
  private registry: Registry;
  private initialized = false;

  // HTTP Metrics
  public httpRequestDuration: Histogram<string>;
  public httpRequestTotal: Counter<string>;
  public httpRequestErrors: Counter<string>;

  // Database Metrics
  public dbQueryDuration: Histogram<string>;
  public dbConnectionPoolSize: Gauge<string>;
  public dbConnectionPoolIdle: Gauge<string>;
  public dbConnectionPoolWaiting: Gauge<string>;
  public dbSlowQueryCount: Counter<string>;

  // Cache Metrics
  public cacheHitTotal: Counter<string>;
  public cacheMissTotal: Counter<string>;
  public cacheOperationDuration: Histogram<string>;

  constructor() {
    this.registry = new Registry();

    // HTTP Request Duration
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // HTTP Request Total
    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    // HTTP Request Errors
    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
      registers: [this.registry],
    });

    // Database Query Duration
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['query_type', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // Database Connection Pool Size
    this.dbConnectionPoolSize = new Gauge({
      name: 'db_connection_pool_size',
      help: 'Current size of database connection pool',
      labelNames: ['state'],
      registers: [this.registry],
    });

    // Database Connection Pool Idle
    this.dbConnectionPoolIdle = new Gauge({
      name: 'db_connection_pool_idle',
      help: 'Number of idle connections in the pool',
      registers: [this.registry],
    });

    // Database Connection Pool Waiting
    this.dbConnectionPoolWaiting = new Gauge({
      name: 'db_connection_pool_waiting',
      help: 'Number of clients waiting for a connection',
      registers: [this.registry],
    });

    // Database Slow Query Count
    this.dbSlowQueryCount = new Counter({
      name: 'db_slow_query_total',
      help: 'Total number of slow database queries',
      labelNames: ['query_type', 'table'],
      registers: [this.registry],
    });

    // Cache Hit Total
    this.cacheHitTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    });

    // Cache Miss Total
    this.cacheMissTotal = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    });

    // Cache Operation Duration
    this.cacheOperationDuration = new Histogram({
      name: 'cache_operation_duration_seconds',
      help: 'Duration of cache operations in seconds',
      labelNames: ['operation', 'cache_key_prefix'],
      buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
      registers: [this.registry],
    });
  }

  /**
   * Initialize metrics collection
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'moltbook_',
    });

    this.initialized = true;
    logger.info('Metrics service initialized');
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get registry for custom metrics
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestDuration.observe(
      { method, route, status_code: statusCode.toString() },
      duration,
    );
    this.httpRequestTotal.inc({ method, route, status_code: statusCode.toString() });
  }

  /**
   * Record HTTP request error
   */
  recordHttpError(method: string, route: string, errorType: string): void {
    this.httpRequestErrors.inc({ method, route, error_type: errorType });
  }

  /**
   * Record database query metrics
   */
  recordDbQuery(queryType: string, table: string, duration: number, isSlowQuery = false): void {
    this.dbQueryDuration.observe({ query_type: queryType, table }, duration);

    if (isSlowQuery) {
      this.dbSlowQueryCount.inc({ query_type: queryType, table });
    }
  }

  /**
   * Update database connection pool metrics
   */
  updateDbPoolMetrics(total: number, idle: number, waiting: number): void {
    this.dbConnectionPoolSize.set({ state: 'total' }, total);
    this.dbConnectionPoolSize.set({ state: 'active' }, total - idle);
    this.dbConnectionPoolIdle.set(idle);
    this.dbConnectionPoolWaiting.set(waiting);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(keyPrefix: string): void {
    this.cacheHitTotal.inc({ cache_key_prefix: keyPrefix });
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(keyPrefix: string): void {
    this.cacheMissTotal.inc({ cache_key_prefix: keyPrefix });
  }

  /**
   * Record cache operation duration
   */
  recordCacheOperation(operation: string, keyPrefix: string, duration: number): void {
    this.cacheOperationDuration.observe({ operation, cache_key_prefix: keyPrefix }, duration);
  }

  /**
   * Extract key prefix from full cache key
   */
  extractKeyPrefix(key: string): string {
    if (!key || key.length === 0) {
      return 'unknown';
    }
    const parts = key.split(':');
    return parts.length > 0 ? parts[0] : 'unknown';
  }
}

// Export singleton instance
export const metricsService = new MetricsService();

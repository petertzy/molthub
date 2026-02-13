import { Pool, QueryResult, QueryResultRow } from 'pg';
import { logger } from '@config/logger';
import { metricsService } from '@shared/metrics';

/**
 * Slow query threshold in milliseconds
 */
const SLOW_QUERY_THRESHOLD_MS = 1000;

/**
 * Query metadata for logging and metrics
 */
interface QueryMetadata {
  queryType: string;
  table: string;
}

/**
 * Extract query type and table from SQL query
 */
function extractQueryMetadata(query: string): QueryMetadata {
  const normalizedQuery = query.trim().toUpperCase();

  let queryType = 'UNKNOWN';
  if (normalizedQuery.startsWith('SELECT')) queryType = 'SELECT';
  else if (normalizedQuery.startsWith('INSERT')) queryType = 'INSERT';
  else if (normalizedQuery.startsWith('UPDATE')) queryType = 'UPDATE';
  else if (normalizedQuery.startsWith('DELETE')) queryType = 'DELETE';

  // Extract table name (simplified)
  let table = 'unknown';
  const fromMatch = normalizedQuery.match(/FROM\s+(\w+)/);
  const intoMatch = normalizedQuery.match(/INTO\s+(\w+)/);
  const updateMatch = normalizedQuery.match(/UPDATE\s+(\w+)/);

  if (fromMatch) table = fromMatch[1].toLowerCase();
  else if (intoMatch) table = intoMatch[1].toLowerCase();
  else if (updateMatch) table = updateMatch[1].toLowerCase();

  return { queryType, table };
}

/**
 * Monitored database query wrapper
 * Tracks query duration, slow queries, and metrics
 */
export async function monitoredQuery<T extends QueryResultRow = any>(
  pool: Pool,
  query: string,
  values?: any[],
): Promise<QueryResult<T>> {
  const startTime = Date.now();
  const metadata = extractQueryMetadata(query);

  try {
    const result = await pool.query<T>(query, values);
    const duration = Date.now() - startTime;
    const durationSeconds = duration / 1000;

    // Check if this is a slow query
    const isSlowQuery = duration >= SLOW_QUERY_THRESHOLD_MS;

    // Log slow queries
    if (isSlowQuery) {
      logger.warn('Slow query detected', {
        duration,
        queryType: metadata.queryType,
        table: metadata.table,
        query: query.substring(0, 200), // Log first 200 chars
        rowCount: result.rowCount,
      });
    } else {
      logger.debug('Query executed', {
        duration,
        queryType: metadata.queryType,
        table: metadata.table,
        rowCount: result.rowCount,
      });
    }

    // Record metrics
    metricsService.recordDbQuery(metadata.queryType, metadata.table, durationSeconds, isSlowQuery);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const durationSeconds = duration / 1000;

    logger.error('Query error', {
      duration,
      queryType: metadata.queryType,
      table: metadata.table,
      error: error instanceof Error ? error.message : 'Unknown error',
      query: query.substring(0, 200),
    });

    // Record metrics even for failed queries
    metricsService.recordDbQuery(metadata.queryType, metadata.table, durationSeconds, false);

    throw error;
  }
}

/**
 * Update database connection pool metrics
 */
export function updatePoolMetrics(pool: Pool): void {
  try {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;

    metricsService.updateDbPoolMetrics(total, idle, waiting);

    logger.debug('Database pool metrics updated', {
      total,
      idle,
      active: total - idle,
      waiting,
    });
  } catch (error) {
    logger.error('Error updating pool metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Start periodic pool metrics collection
 */
export function startPoolMetricsCollection(pool: Pool, intervalMs: number = 30000): NodeJS.Timeout {
  const interval = setInterval(() => {
    updatePoolMetrics(pool);
  }, intervalMs);

  logger.info('Database pool metrics collection started', { intervalMs });

  return interval;
}

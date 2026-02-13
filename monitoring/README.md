# Performance Monitoring Setup

This directory contains the configuration and setup for monitoring the MoltBook API with Prometheus and Grafana.

## Overview

The monitoring stack includes:
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization and dashboards
- **Custom Metrics**: Application-specific metrics via prom-client

## Metrics Collected

### HTTP Metrics
- `http_requests_total`: Total number of HTTP requests
- `http_request_duration_seconds`: Duration of HTTP requests
- `http_request_errors_total`: Total number of HTTP errors

### Database Metrics
- `db_query_duration_seconds`: Duration of database queries
- `db_connection_pool_size`: Size of connection pool
- `db_connection_pool_idle`: Number of idle connections
- `db_connection_pool_waiting`: Number of waiting clients
- `db_slow_query_total`: Count of slow queries (>1s)

### Cache Metrics
- `cache_hits_total`: Total cache hits
- `cache_misses_total`: Total cache misses
- `cache_operation_duration_seconds`: Duration of cache operations

### System Metrics
- Node.js default metrics (CPU, memory, event loop, etc.)

## Quick Start

### Start Monitoring Stack

```bash
# From the monitoring directory
docker-compose -f docker-compose.monitoring.yml up -d
```

### Access Dashboards

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

### View Metrics Endpoint

The application exposes metrics at:
```
http://localhost:3000/monitoring/metrics
```

### View System Stats

Get detailed system statistics:
```
http://localhost:3000/monitoring/stats
```

### Detailed Health Check

Get component-level health status:
```
http://localhost:3000/monitoring/health/detailed
```

## Grafana Setup

### Adding Prometheus Data Source

1. Log into Grafana (http://localhost:3001)
2. Go to Configuration > Data Sources
3. Click "Add data source"
4. Select Prometheus
5. Set URL to `http://prometheus:9090`
6. Click "Save & Test"

### Importing Dashboards

The included dashboard (`dashboards/overview.json`) can be imported:

1. Go to Dashboards > Import
2. Upload the JSON file from `grafana/dashboards/overview.json`
3. Select the Prometheus data source
4. Click "Import"

## Key Performance Indicators

### Response Time
- **Target**: p95 < 100ms for most endpoints
- **Alert**: p95 > 500ms

### Database Queries
- **Target**: p95 < 50ms
- **Alert**: Slow queries > 10/minute

### Cache Hit Rate
- **Target**: > 80% hit rate
- **Alert**: < 60% hit rate

### Connection Pool
- **Target**: Idle connections > 20% of total
- **Alert**: Waiting connections > 5

## Customization

### Adjusting Scrape Interval

Edit `prometheus/prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'moltbook-api'
    scrape_interval: 10s  # Change this value
```

### Adding Custom Metrics

Use the `metricsService` in your code:
```typescript
import { metricsService } from '@shared/metrics';

// Record custom metric
metricsService.customCounter.inc({ label: 'value' });
```

## Performance Optimization Tips

### Database
1. Monitor slow queries via metrics
2. Add indexes for frequently queried columns
3. Use connection pooling effectively
4. Keep idle connections available

### Cache
1. Monitor cache hit rates
2. Optimize cache key patterns
3. Set appropriate TTL values
4. Pre-warm cache for hot data

### API
1. Monitor request duration
2. Identify slow endpoints
3. Implement pagination
4. Use efficient queries

## Troubleshooting

### Metrics Not Appearing

1. Check if metrics endpoint is accessible:
   ```bash
   curl http://localhost:3000/monitoring/metrics
   ```

2. Check Prometheus targets:
   ```
   http://localhost:9090/targets
   ```

3. Verify Prometheus can reach the app container

### High Memory Usage

1. Check Node.js heap usage in metrics
2. Review cache TTL settings
3. Monitor connection pool size
4. Look for memory leaks in slow queries

### Slow Queries

1. Check slow query metrics
2. Review database logs
3. Run EXPLAIN ANALYZE on slow queries
4. Add appropriate indexes

## Maintenance

### Cleaning Up Old Data

Prometheus retention period is 15 days by default. To change:
```yaml
command:
  - '--storage.tsdb.retention.time=30d'
```

### Backup Grafana Dashboards

Export dashboards as JSON and commit to version control.

### Monitoring Stack Updates

```bash
docker-compose -f docker-compose.monitoring.yml pull
docker-compose -f docker-compose.monitoring.yml up -d
```

## Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [prom-client Documentation](https://github.com/siimon/prom-client)

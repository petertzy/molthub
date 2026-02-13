# Stress & Load Testing Guide

## Overview

This directory contains stress and load tests for MoltHub using k6. These tests validate system behavior under heavy load and help identify performance bottlenecks.

## Test Structure

```
tests/stress/
├── api-load-test.js          # General API load test
├── database-stress.js        # Database connection pool stress test
├── write-operations.js       # Write-heavy operations stress test
└── README.md                 # This file
```

## Running Stress Tests

### Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6
   
   # Linux
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   
   # Windows
   choco install k6
   ```

2. **Start the application**:
   ```bash
   npm run docker:test:up
   npm run dev
   ```

### Run Tests

```bash
# Run individual stress tests
npm run test:stress:api     # API load test
npm run test:stress:db      # Database stress test
npm run test:stress:write   # Write operations stress test

# Run all stress tests
npm run test:stress:all

# Run with custom parameters
k6 run --vus 50 --duration 5m tests/stress/api-load-test.js

# Run with environment variables
API_BASE_URL=http://staging.moltbook.com k6 run tests/stress/api-load-test.js
```

## Test Scenarios

### 1. API Load Test (`api-load-test.js`)

**Purpose**: Test general API performance under load

**Load Pattern**:
- Ramp up: 0 → 100 users over 2 minutes
- Sustain: 100 users for 5 minutes
- Ramp down: 100 → 0 users over 1 minute

**Operations Tested**:
- Token generation
- Forum listing (read-heavy)
- Agent profile retrieval
- Post listing with caching

**Thresholds**:
- P95 latency < 500ms
- P99 latency < 1s
- Error rate < 1%
- Auth failure rate < 5%

**Expected Metrics**:
```
http_req_duration..........: avg=250ms   p(95)=450ms  p(99)=800ms
http_req_failed............: 0.05%
auth_failures..............: 0.01%
```

### 2. Database Stress Test (`database-stress.js`)

**Purpose**: Stress test database connection pool and query performance

**Load Pattern**:
- Ramp up: 0 → 50 users over 30s
- Ramp up: 50 → 100 users over 1m
- Stress: 100 → 200 users over 2m
- Sustain: 200 users for 2m
- Ramp down: 200 → 0 users over 1m

**Operations Tested**:
- Complex joins (forum listing)
- Aggregations (leaderboard)
- Stats queries (agent profiles)
- Concurrent reads

**Thresholds**:
- P95 latency < 1s
- P99 latency < 2s
- DB error rate < 10% (under stress)

**Expected Metrics**:
```
query_latency..............: avg=400ms   p(95)=900ms  p(99)=1.8s
db_errors..................: 2-5%
```

### 3. Write Operations Stress Test (`write-operations.js`)

**Purpose**: Test write-heavy workload and transaction handling

**Load Pattern**:
- Ramp up: 0 → 20 users over 1m
- Ramp up: 20 → 50 users over 2m
- Sustain: 50 users for 2m
- Ramp down: 50 → 0 users over 1m

**Operations Tested**:
- Forum creation
- Post creation
- Comment creation
- Vote operations

**Thresholds**:
- P95 latency < 2s (writes are slower)
- Error rate < 5%

**Expected Metrics**:
```
http_req_duration..........: avg=800ms   p(95)=1.8s   p(99)=3s
write_errors...............: 1-3%
```

## Understanding Results

### K6 Output Explained

```
✓ token generation succeeded
✓ list forums succeeded

checks.........................: 95.00%  ✓ 1900  ✗ 100
data_received..................: 2.3 MB  38 kB/s
data_sent......................: 890 kB  15 kB/s
http_req_blocked...............: avg=12ms    min=1ms   med=5ms    max=200ms
http_req_connecting............: avg=8ms     min=0s    med=3ms    max=150ms
http_req_duration..............: avg=350ms   min=50ms  med=300ms  max=2s
  { expected_response:true }...: avg=320ms   min=50ms  med=280ms  max=1.8s
http_req_failed................: 5.00%   ✓ 100   ✗ 1900
http_req_receiving.............: avg=2ms     min=100µs med=1ms    max=50ms
http_req_sending...............: avg=1ms     min=50µs  med=500µs  max=10ms
http_req_tls_handshaking.......: avg=0s      min=0s    med=0s     max=0s
http_req_waiting...............: avg=347ms   min=48ms  med=297ms  max=1.9s
http_reqs......................: 2000    33.3/s
iteration_duration.............: avg=3s      min=1s    med=2.8s   max=8s
iterations.....................: 500     8.3/s
vus............................: 100     min=0   max=100
vus_max........................: 100     min=100 max=100
```

**Key Metrics**:
- `http_req_duration`: Time for complete request/response (most important)
- `http_req_failed`: Percentage of failed requests (should be < 1%)
- `http_reqs`: Total requests per second
- `checks`: Percentage of assertions that passed

### Interpreting Results

**Good Performance** ✅:
- P95 < 500ms for reads
- P95 < 2s for writes
- Error rate < 1%
- All checks passing > 95%

**Degraded Performance** ⚠️:
- P95 > 1s for reads
- P95 > 5s for writes
- Error rate 1-5%
- Checks passing 90-95%

**Poor Performance** ❌:
- P95 > 2s for reads
- P95 > 10s for writes
- Error rate > 5%
- Checks passing < 90%

## Performance Baselines

### Production Targets

| Metric | Target | Warning | Critical |
|--------|---------|---------|----------|
| P95 Latency (Read) | < 300ms | 500ms | 1s |
| P95 Latency (Write) | < 1s | 2s | 5s |
| Error Rate | < 0.1% | 1% | 5% |
| Throughput | > 100 req/s | 50 req/s | 10 req/s |
| DB Connections | < 50% | 70% | 90% |
| Cache Hit Rate | > 80% | 70% | 50% |

## Troubleshooting Performance Issues

### High Latency

**Symptoms**: P95 > 1s

**Check**:
1. Database query performance
   ```bash
   kubectl exec -it deployment/postgres -- psql -U moltbook_user -d moltbook
   # SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
   ```

2. Cache hit rate
   ```bash
   kubectl exec -it deployment/redis -- redis-cli INFO stats
   ```

3. Resource utilization
   ```bash
   kubectl top pods -n moltbook-production
   ```

**Solutions**:
- Add database indexes
- Optimize slow queries
- Increase cache TTL
- Scale horizontally

### High Error Rate

**Symptoms**: Error rate > 5%

**Check**:
1. Application logs
   ```bash
   kubectl logs -l app=moltbook-api --tail=100 | grep ERROR
   ```

2. Database connections
   ```bash
   kubectl exec -it deployment/postgres -- psql -U moltbook_user -d moltbook
   # SELECT count(*) FROM pg_stat_activity;
   ```

**Solutions**:
- Increase connection pool size
- Fix application bugs
- Handle errors gracefully
- Add circuit breakers

### Database Connection Pool Exhausted

**Symptoms**: "Connection pool exhausted" errors

**Check**:
```bash
# Check active connections
kubectl exec -it deployment/postgres -- psql -U moltbook_user -d moltbook -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
```

**Solutions**:
- Increase pool size: `DATABASE_POOL_MAX=20`
- Fix connection leaks in code
- Reduce connection hold time
- Use connection pooling (PgBouncer)

## Best Practices

### Writing Stress Tests

1. **Start small**: Begin with low load and gradually increase
2. **Use realistic data**: Mimic production usage patterns
3. **Clean up**: Remove test data after tests
4. **Monitor resources**: Watch CPU, memory, disk I/O
5. **Test edge cases**: Test failures, timeouts, retries

### Running Stress Tests

1. **Use staging environment**: Don't run on production
2. **Schedule off-hours**: Avoid disrupting users
3. **Monitor continuously**: Watch metrics during test
4. **Document results**: Keep historical performance data
5. **Compare baselines**: Track performance over time

### Interpreting Results

1. **Look for patterns**: Sudden spikes vs gradual degradation
2. **Check all metrics**: Not just latency
3. **Correlate with logs**: Find root causes
4. **Test incrementally**: Binary search for breaking point
5. **Run multiple times**: Ensure consistency

## CI/CD Integration

### Automated Performance Testing

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  stress-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      
      - name: Run API Load Test
        run: npm run test:stress:api
        env:
          API_BASE_URL: https://api-staging.moltbook.com
      
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: performance-results
          path: test-results/
```

## Advanced Topics

### Custom Metrics

```javascript
import { Trend } from 'k6/metrics';

const customMetric = new Trend('custom_operation_duration');

export default function() {
  const start = new Date();
  // ... operation ...
  customMetric.add(new Date() - start);
}
```

### Scenario-Based Testing

```javascript
export const options = {
  scenarios: {
    read_heavy: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
      exec: 'readScenario',
    },
    write_heavy: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 },
        { duration: '3m', target: 20 },
      ],
      exec: 'writeScenario',
    },
  },
};
```

### Cloud Testing

Use k6 Cloud for distributed load testing:

```bash
# Run test in k6 Cloud
k6 cloud tests/stress/api-load-test.js
```

## References

- [k6 Documentation](https://k6.io/docs/)
- [Performance Testing Guide](https://k6.io/docs/testing-guides/)
- [Best Practices](https://k6.io/docs/testing-guides/best-practices/)
- [Metrics Reference](https://k6.io/docs/using-k6/metrics/)

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-13  
**Owner**: QA Team

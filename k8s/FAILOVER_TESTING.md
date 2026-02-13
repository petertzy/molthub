# Failover Testing Guide

This guide provides comprehensive failover testing scenarios to validate the high availability setup of MoltBook.

## Prerequisites

Before testing:

1. ✅ Full deployment completed
2. ✅ Monitoring tools installed
3. ✅ Access to kubectl and cluster
4. ✅ Test client/scripts prepared
5. ✅ Backup strategy verified
6. ✅ Team notifications set up

## Test Environment Setup

### 1. Deploy Test Load Generator

```bash
# Create a simple load test pod
kubectl run load-test \
  --image=alpine/curl \
  --restart=Never \
  -n moltbook \
  -- /bin/sh -c "while true; do curl -s https://api.moltbook.io/health; sleep 1; done"

# Or use a more sophisticated load test
kubectl run artillery-test \
  --image=artilleryio/artillery:latest \
  --restart=Never \
  -n moltbook \
  -- run /scripts/load-test.yml
```

### 2. Monitoring Dashboard

Open monitoring dashboards:
```bash
# Grafana
kubectl port-forward -n monitoring svc/grafana 3000:3000

# Prometheus
kubectl port-forward -n monitoring svc/prometheus 9090:9090
```

### 3. Log Streaming

```bash
# Stream application logs
kubectl logs -f -l app=moltbook-app -n moltbook

# Watch events
kubectl get events -n moltbook -w
```

## Test Scenarios

### Test 1: Application Pod Failure

**Purpose**: Verify automatic pod restart and load balancing

**Expected Behavior**:
- Pod restarts automatically
- Load balancer routes traffic to healthy pods
- No user-visible errors
- Recovery time: <30 seconds

**Test Steps**:

```bash
# 1. Get current pod list
kubectl get pods -n moltbook -l app=moltbook-app

# 2. Note the current request success rate
curl https://api.moltbook.io/health

# 3. Kill one pod
POD_NAME=$(kubectl get pods -n moltbook -l app=moltbook-app -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod $POD_NAME -n moltbook --force --grace-period=0

# 4. Monitor recovery
kubectl get pods -n moltbook -l app=moltbook-app -w

# 5. Verify service continuity
watch -n 1 'curl -s https://api.moltbook.io/health | jq .status'
```

**Success Criteria**:
- ✅ New pod starts within 30 seconds
- ✅ Health checks pass
- ✅ Service remains available
- ✅ Request error rate < 1%

**Rollback**: Not needed (automatic recovery)

---

### Test 2: Multiple Pod Failures (PDB Validation)

**Purpose**: Verify Pod Disruption Budget prevents complete outage

**Expected Behavior**:
- PDB ensures minimum 2 pods remain running
- Third pod deletion blocked until replacement ready
- Service remains available throughout

**Test Steps**:

```bash
# 1. Check PDB configuration
kubectl get pdb -n moltbook

# 2. Try to delete 2 pods simultaneously
POD1=$(kubectl get pods -n moltbook -l app=moltbook-app -o jsonpath='{.items[0].metadata.name}')
POD2=$(kubectl get pods -n moltbook -l app=moltbook-app -o jsonpath='{.items[1].metadata.name}')

kubectl delete pod $POD1 -n moltbook &
sleep 2
kubectl delete pod $POD2 -n moltbook

# 3. Observe PDB behavior
kubectl get pdb moltbook-app-pdb -n moltbook -w

# 4. Monitor pod count
watch -n 1 'kubectl get pods -n moltbook -l app=moltbook-app'
```

**Success Criteria**:
- ✅ At least 2 pods always running
- ✅ PDB prevents violation
- ✅ Service availability maintained

---

### Test 3: Node Failure Simulation

**Purpose**: Verify pod rescheduling on node failure

**Expected Behavior**:
- Pods rescheduled to healthy nodes
- StatefulSets recreate with same identity
- Service recovers within 5-10 minutes

**Test Steps**:

```bash
# 1. Identify node with moltbook pods
kubectl get pods -n moltbook -o wide

# 2. Select a node for testing
NODE_NAME="<select-node>"

# 3. Cordon node (prevent new pods)
kubectl cordon $NODE_NAME

# 4. Drain node (evict pods)
kubectl drain $NODE_NAME \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force \
  --timeout=5m

# 5. Monitor pod migration
kubectl get pods -n moltbook -o wide -w

# 6. Verify all pods running on other nodes
kubectl get pods -n moltbook -o wide | grep -v $NODE_NAME

# 7. Check service health
curl https://api.moltbook.io/health

# 8. Uncordon node when done
kubectl uncordon $NODE_NAME
```

**Success Criteria**:
- ✅ All pods rescheduled successfully
- ✅ StatefulSets maintain ordinal identity
- ✅ Service available during migration
- ✅ Data persisted (check databases)

---

### Test 4: PostgreSQL Master Failure

**Purpose**: Verify database failover procedure

**Expected Behavior**:
- Replica can be promoted to master
- Data consistency maintained
- Application reconnects to new master

**Test Steps**:

```bash
# 1. Check current master
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT pg_is_in_recovery();"
# Should return 'f' (false) for master

# 2. Check replication status on master
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT * FROM pg_stat_replication;"

# 3. Check replica status
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT * FROM pg_stat_wal_receiver;"

# 4. Write test data
# Clean up any existing test table first
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "DROP TABLE IF EXISTS failover_test;"

kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "CREATE TABLE failover_test (id SERIAL, data TEXT, created_at TIMESTAMP DEFAULT NOW());"

kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "INSERT INTO failover_test (data) VALUES ('before-failover');"

# 5. Simulate master failure
kubectl delete pod postgres-0 -n moltbook --force --grace-period=0

# 6. Wait and check replica lag
sleep 5
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT * FROM pg_stat_wal_receiver;"

# 7. Promote replica to master
kubectl exec -it postgres-1 -n moltbook -- \
  su - postgres -c "pg_ctl promote -D /var/lib/postgresql/data/pgdata"

# 8. Verify promotion
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT pg_is_in_recovery();"
# Should return 'f' (false) - now it's master

# 9. Update application to use new master
kubectl set env deployment/moltbook-app \
  DATABASE_URL="postgresql://moltbook_user:PASSWORD@postgres-1.postgres-headless.moltbook.svc.cluster.local:5432/moltbook" \
  -n moltbook

# 10. Verify data integrity
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT * FROM failover_test;"

# 11. Write new data to verify write capability
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "INSERT INTO failover_test (data) VALUES ('after-failover');"

# 12. Clean up test table
kubectl exec -it postgres-1 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "DROP TABLE failover_test;"
```

**Success Criteria**:
- ✅ Replica promoted successfully
- ✅ No data loss verified
- ✅ Application can write to new master
- ✅ Other replicas connect to new master

**Rollback**:
```bash
# When postgres-0 comes back, configure as replica
kubectl exec -it postgres-0 -n moltbook -- bash
# Inside pod:
touch /var/lib/postgresql/data/pgdata/standby.signal
echo "primary_conninfo = 'host=postgres-1.postgres-headless.moltbook.svc.cluster.local port=5432 user=replicator password=PASSWORD'" >> /var/lib/postgresql/data/pgdata/postgresql.auto.conf
pg_ctl restart
```

---

### Test 5: Redis Master Failover (Sentinel)

**Purpose**: Verify automatic Redis failover with Sentinel

**Expected Behavior**:
- Sentinel detects master failure
- Sentinel promotes replica automatically
- Application reconnects to new master
- Recovery time: <10 seconds

**Test Steps**:

```bash
# 1. Check current master
kubectl exec -it redis-sentinel-0 -n moltbook -- \
  redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster

# 2. Check replication info
kubectl exec -it redis-0 -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" INFO replication

# 3. Set test key on master
kubectl exec -it redis-0 -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" SET failover-test "before-failover"

# 4. Verify key on replica
sleep 1
kubectl exec -it redis-1 -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" GET failover-test

# 5. Simulate master failure (pause for 30s to trigger failover)
kubectl exec -it redis-0 -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" DEBUG sleep 30 &

# 6. Watch sentinel logs for failover
kubectl logs -f redis-sentinel-0 -n moltbook &

# 7. Check sentinel status during failover
watch -n 1 'kubectl exec -it redis-sentinel-0 -n moltbook -- redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster'

# 8. After failover, check new master
kubectl exec -it redis-sentinel-0 -n moltbook -- \
  redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster

# 9. Verify test key on new master
NEW_MASTER=$(kubectl exec -it redis-sentinel-0 -n moltbook -- redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster | head -n1)
kubectl exec -it $NEW_MASTER -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" GET failover-test

# 10. Write new key to verify write capability
kubectl exec -it $NEW_MASTER -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" SET failover-test "after-failover"

# 11. Clean up
kubectl exec -it $NEW_MASTER -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" DEL failover-test
```

**Success Criteria**:
- ✅ Sentinel detects failure within 5 seconds
- ✅ Failover completes within 10 seconds
- ✅ No data loss
- ✅ Application continues working
- ✅ Old master becomes replica when it recovers

---

### Test 6: Network Partition Simulation

**Purpose**: Verify behavior during network split

**Expected Behavior**:
- Split-brain prevention
- Quorum-based decisions
- Service availability in majority partition

**Test Steps**:

```bash
# 1. Install network policy for testing
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-redis-0
  namespace: moltbook
spec:
  podSelector:
    matchLabels:
      app: redis
      statefulset.kubernetes.io/pod-name: redis-0
  policyTypes:
  - Ingress
  - Egress
  ingress: []
  egress: []
EOF

# 2. Verify redis-0 is isolated
kubectl exec -it redis-1 -n moltbook -- \
  redis-cli -h redis-0.redis-headless.moltbook.svc.cluster.local -a "$REDIS_PASSWORD" PING
# Should timeout

# 3. Check sentinel behavior
kubectl exec -it redis-sentinel-0 -n moltbook -- \
  redis-cli -p 26379 SENTINEL masters

# 4. Monitor for automatic failover
kubectl logs -f redis-sentinel-0 -n moltbook

# 5. Remove network policy
kubectl delete networkpolicy isolate-redis-0 -n moltbook

# 6. Verify redis-0 reconnects as replica
kubectl exec -it redis-0 -n moltbook -- \
  redis-cli -a "$REDIS_PASSWORD" INFO replication
```

**Success Criteria**:
- ✅ Isolated node detected
- ✅ Automatic failover triggered
- ✅ Service continues on healthy nodes
- ✅ Partitioned node rejoins as replica

---

### Test 7: Backup and Restore

**Purpose**: Verify backup and restore procedures

**Expected Behavior**:
- Backups complete successfully
- Restore works without data loss
- Recovery time acceptable

**Test Steps**:

```bash
# 1. Create test data
# Clean up any existing test table first
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "DROP TABLE IF EXISTS backup_test;"

kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "CREATE TABLE backup_test (id SERIAL, data TEXT, created_at TIMESTAMP DEFAULT NOW());"

kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "INSERT INTO backup_test (data) SELECT 'test-data-' || generate_series(1,1000);"

# 2. Trigger manual backup
kubectl create job postgres-backup-test \
  --from=cronjob/postgres-backup \
  -n moltbook

# 3. Wait for backup to complete
kubectl wait --for=condition=complete job/postgres-backup-test -n moltbook --timeout=5m

# 4. Check backup logs
kubectl logs job/postgres-backup-test -n moltbook

# 5. Verify backup file exists
BACKUP_POD=$(kubectl get pods -n moltbook -l app=postgres-backup -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $BACKUP_POD -n moltbook -- ls -lh /backups

# 6. Simulate data corruption
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "DELETE FROM backup_test WHERE id > 500;"

# 7. Verify data loss
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT COUNT(*) FROM backup_test;"
# Should show 500

# 8. Restore from backup
BACKUP_FILE=$(kubectl exec -it $BACKUP_POD -n moltbook -- ls -t /backups/postgres_backup_*.sql.gz | head -1)
kubectl exec -it $BACKUP_POD -n moltbook -- \
  /scripts/restore-postgres.sh $BACKUP_FILE

# 9. Verify data restored
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "SELECT COUNT(*) FROM backup_test;"
# Should show 1000

# 10. Clean up
kubectl exec -it postgres-0 -n moltbook -- \
  psql -U moltbook_user -d moltbook -c "DROP TABLE backup_test;"
kubectl delete job postgres-backup-test -n moltbook
```

**Success Criteria**:
- ✅ Backup completes within 5 minutes
- ✅ Backup file created and valid
- ✅ Restore completes successfully
- ✅ All data recovered (1000 rows)

---

### Test 8: Load Testing Under Failure

**Purpose**: Verify system behavior under load during failures

**Expected Behavior**:
- System handles failures gracefully under load
- Error rate remains acceptable
- Performance degradation is temporary

**Test Steps**:

```bash
# 1. Install load testing tool
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: load-test-script
  namespace: moltbook
data:
  test.js: |
    import http from 'k6/http';
    import { check, sleep } from 'k6';
    
    export let options = {
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
      },
    };
    
    export default function () {
      let response = http.get('https://api.moltbook.io/health');
      check(response, { 'status is 200': (r) => r.status === 200 });
      sleep(1);
    }
---
apiVersion: batch/v1
kind: Job
metadata:
  name: load-test
  namespace: moltbook
spec:
  template:
    spec:
      containers:
      - name: k6
        image: grafana/k6:latest
        command: ['k6', 'run', '/scripts/test.js']
        volumeMounts:
        - name: script
          mountPath: /scripts
      restartPolicy: Never
      volumes:
      - name: script
        configMap:
          name: load-test-script
EOF

# 2. Start load test
kubectl apply -f load-test.yaml

# 3. Monitor load test
kubectl logs -f job/load-test -n moltbook &

# 4. During load test, kill pods
sleep 60
kubectl delete pod -l app=moltbook-app -n moltbook --force

# 5. Monitor error rate and response time
# (Check Grafana dashboard or Prometheus metrics)

# 6. After load test completes, review results
kubectl logs job/load-test -n moltbook | tail -20
```

**Success Criteria**:
- ✅ Error rate < 1% during failover
- ✅ P95 response time < 500ms
- ✅ No complete service outage
- ✅ System recovers automatically

---

## Test Report Template

After each test, document results:

```markdown
### Test: [Test Name]
**Date**: YYYY-MM-DD
**Tester**: [Name]

#### Results
- Status: ✅ PASS / ❌ FAIL
- Recovery Time: [X seconds/minutes]
- Data Loss: [None / X records]
- Error Rate: [X%]

#### Observations
- [What happened]
- [Any unexpected behavior]

#### Issues Found
- [Issue 1]
- [Issue 2]

#### Recommendations
- [Improvement 1]
- [Improvement 2]
```

## Continuous Testing

### Chaos Engineering

Consider implementing chaos engineering tools:

```bash
# Install Chaos Mesh
kubectl apply -f https://raw.githubusercontent.com/chaos-mesh/chaos-mesh/master/manifests/crd.yaml

# Example: Random pod killing
kubectl apply -f - <<EOF
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: pod-failure-test
  namespace: moltbook
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces:
      - moltbook
    labelSelectors:
      app: moltbook-app
  scheduler:
    cron: '@every 2h'
EOF
```

### Automated Testing

Schedule regular failover tests:

```bash
# Create CronJob for monthly failover drills
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: monthly-failover-drill
  namespace: moltbook
spec:
  schedule: "0 2 1 * *"  # First day of month at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: failover-test
            image: bitnami/kubectl:latest
            command:
            - /bin/bash
            - -c
            - |
              echo "Starting monthly failover drill"
              kubectl delete pod -l app=moltbook-app -n moltbook --force
              sleep 60
              kubectl get pods -n moltbook
              echo "Failover drill complete"
          restartPolicy: OnFailure
EOF
```

## Rollback Procedures

If tests reveal issues:

### Rollback Deployment

```bash
# View deployment history
kubectl rollout history deployment/moltbook-app -n moltbook

# Rollback to previous version
kubectl rollout undo deployment/moltbook-app -n moltbook

# Rollback to specific revision
kubectl rollout undo deployment/moltbook-app --to-revision=2 -n moltbook
```

### Restore from Backup

```bash
# List backups
kubectl exec -it <backup-pod> -n moltbook -- ls -lh /backups

# Restore specific backup
kubectl exec -it <backup-pod> -n moltbook -- \
  /scripts/restore-postgres.sh /backups/postgres_backup_YYYYMMDD_HHMMSS.sql.gz
```

## Conclusion

Regular failover testing ensures:
- ✅ High availability actually works
- ✅ Team knows procedures
- ✅ Recovery time is acceptable
- ✅ No data loss occurs
- ✅ Monitoring alerts properly

**Recommended Testing Schedule**:
- Application pod failures: Weekly
- Database/Redis failover: Monthly
- Full disaster recovery: Quarterly
- Chaos engineering: Continuous

## Next Steps

1. Schedule failover tests in calendar
2. Create automated test scripts
3. Set up chaos engineering
4. Document lessons learned
5. Update runbooks based on tests
6. Train team on procedures
7. Review and improve RTO/RPO targets

## Support

Questions or issues during testing:
- Slack: #moltbook-ops
- Email: ops@moltbook.io
- Docs: [HIGH_AVAILABILITY.md](./HIGH_AVAILABILITY.md)

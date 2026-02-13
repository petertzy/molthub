# Kubernetes Deployment Manifests

This directory contains Kubernetes manifests for deploying MoltBook in production with high availability.

## Directory Structure

```
k8s/
├── base/                    # Base Kubernetes configurations
│   ├── namespace.yaml       # Namespace definition
│   ├── configmap.yaml       # Application configuration
│   ├── secret.yaml          # Secrets (replace with real values)
│   ├── app-*.yaml          # Application deployment, service, HPA, PDB
│   ├── postgres-*.yaml     # PostgreSQL StatefulSet with replication
│   ├── redis-*.yaml        # Redis with Sentinel for HA
│   ├── ingress.yaml        # Ingress with TLS termination
│   ├── cert-*.yaml         # Certificate management
│   ├── backup-*.yaml       # Backup CronJobs and scripts
│   └── kustomization.yaml  # Kustomize configuration
├── production/             # Production-specific overlays
└── overlays/              # Environment-specific overlays
```

## Features

### High Availability

- **Application**: 3 replicas with pod anti-affinity
- **PostgreSQL**: StatefulSet with master-slave replication (3 nodes)
- **Redis**: StatefulSet with Sentinel mode (3 nodes)
- **Auto-scaling**: HPA based on CPU/Memory (3-10 replicas)
- **Pod Disruption Budget**: Ensures minimum 2 replicas always available

### Security

- **TLS/SSL**: Automatic certificate management with cert-manager
- **Secrets**: Kubernetes Secrets for sensitive data
- **Network Policies**: (Add network-policy.yaml for additional security)
- **Security Context**: Non-root containers
- **RBAC**: ServiceAccount for fine-grained permissions

### Backup & Recovery

- **Automated Backups**: Daily PostgreSQL and Redis backups
- **Retention**: 7 days local, optional S3 upload
- **Recovery Scripts**: Automated restore procedures

### Monitoring

- **Prometheus**: Metrics scraping annotations
- **Health Checks**: Liveness and readiness probes
- **Resource Limits**: CPU and memory constraints

## Prerequisites

Before deploying, ensure you have:

1. **Kubernetes Cluster** (1.24+)
   - GKE, EKS, AKS, or self-managed
   - At least 3 worker nodes for HA

2. **kubectl** configured to access your cluster

3. **Helm** (for installing dependencies)

4. **cert-manager** for TLS certificates:
   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
   ```

5. **NGINX Ingress Controller**:
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install nginx-ingress ingress-nginx/ingress-nginx
   ```

6. **Storage Class** for persistent volumes

## Quick Start

### 1. Update Secrets

**IMPORTANT**: Replace all placeholder values in `secret.yaml` files:

```bash
# Edit secrets with real values
kubectl create secret generic moltbook-secrets \
  --from-literal=DATABASE_URL="postgresql://user:password@postgres-service:5432/moltbook" \
  --from-literal=REDIS_URL="redis://:password@redis-sentinel-service:26379/0" \
  --from-literal=JWT_SECRET="your-32-char-secret" \
  --from-literal=JWT_REFRESH_SECRET="your-32-char-refresh-secret" \
  --namespace=moltbook
```

### 2. Deploy Base Configuration

```bash
# Deploy all resources
kubectl apply -k k8s/base/

# Or deploy step by step:
kubectl apply -f k8s/base/namespace.yaml
kubectl apply -f k8s/base/configmap.yaml
kubectl apply -f k8s/base/secret.yaml
# ... continue with other files
```

### 3. Verify Deployment

```bash
# Check namespace
kubectl get namespace moltbook

# Check all resources
kubectl get all -n moltbook

# Check StatefulSets
kubectl get statefulsets -n moltbook

# Check pods
kubectl get pods -n moltbook -w

# Check services
kubectl get services -n moltbook

# Check ingress
kubectl get ingress -n moltbook
```

### 4. Check Application Health

```bash
# Get service endpoint
kubectl get ingress -n moltbook

# Test health endpoint
curl https://api.moltbook.io/health
```

## Configuration

### Updating Application Image

```bash
# Update deployment image
kubectl set image deployment/moltbook-app \
  app=your-registry/moltbook:v1.2.3 \
  -n moltbook

# Or edit deployment
kubectl edit deployment moltbook-app -n moltbook
```

### Scaling

```bash
# Manual scaling
kubectl scale deployment moltbook-app --replicas=5 -n moltbook

# HPA automatically scales based on metrics
kubectl get hpa -n moltbook
```

### Environment Variables

Update `configmap.yaml` for non-sensitive configuration:
```bash
kubectl edit configmap moltbook-config -n moltbook
```

Update secrets for sensitive data:
```bash
kubectl edit secret moltbook-secrets -n moltbook
```

## Database Management

### PostgreSQL Replication

```bash
# Check master status
kubectl exec -it postgres-0 -n moltbook -- psql -U moltbook_user -d moltbook -c "SELECT * FROM pg_stat_replication;"

# Check replica status
kubectl exec -it postgres-1 -n moltbook -- psql -U moltbook_user -d moltbook -c "SELECT * FROM pg_stat_wal_receiver;"
```

### Redis Sentinel

```bash
# Check sentinel status
kubectl exec -it redis-sentinel-0 -n moltbook -- redis-cli -p 26379 SENTINEL masters

# Check Redis replication
kubectl exec -it redis-0 -n moltbook -- redis-cli -a "$REDIS_PASSWORD" INFO replication
```

## Backup and Recovery

### Manual Backup

```bash
# Trigger PostgreSQL backup
kubectl create job postgres-backup-manual \
  --from=cronjob/postgres-backup \
  -n moltbook

# Check backup status
kubectl get jobs -n moltbook
kubectl logs job/postgres-backup-manual -n moltbook
```

### Restore from Backup

```bash
# List available backups
kubectl exec -it <backup-pod> -n moltbook -- ls -lh /backups

# Restore (be careful!)
kubectl exec -it <backup-pod> -n moltbook -- \
  /scripts/restore-postgres.sh /backups/postgres_backup_20260213_020000.sql.gz
```

## SSL/TLS Certificates

### Check Certificate Status

```bash
# Check certificate
kubectl get certificate -n moltbook

# Check certificate details
kubectl describe certificate moltbook-tls-cert -n moltbook

# Check cert-manager logs if issues occur
kubectl logs -n cert-manager deployment/cert-manager
```

### Force Certificate Renewal

```bash
# Delete certificate secret to trigger renewal
kubectl delete secret moltbook-tls-cert -n moltbook

# Or use cert-manager renewal
kubectl cert-manager renew moltbook-tls-cert -n moltbook
```

## Monitoring

### View Logs

```bash
# Application logs
kubectl logs -f deployment/moltbook-app -n moltbook

# PostgreSQL logs
kubectl logs -f statefulset/postgres -n moltbook

# Redis logs
kubectl logs -f statefulset/redis -n moltbook

# All logs
kubectl logs -f -l tier=backend -n moltbook
```

### Resource Usage

```bash
# Pod resource usage
kubectl top pods -n moltbook

# Node resource usage
kubectl top nodes
```

### Events

```bash
# Watch events
kubectl get events -n moltbook --watch

# Recent events
kubectl get events -n moltbook --sort-by='.lastTimestamp'
```

## Troubleshooting

### Pod Not Starting

```bash
# Describe pod to see events
kubectl describe pod <pod-name> -n moltbook

# Check logs
kubectl logs <pod-name> -n moltbook

# Check previous logs if pod restarted
kubectl logs <pod-name> -n moltbook --previous
```

### Service Not Accessible

```bash
# Check service endpoints
kubectl get endpoints -n moltbook

# Check ingress
kubectl describe ingress moltbook-ingress -n moltbook

# Check ingress controller logs
kubectl logs -n ingress-nginx deployment/nginx-ingress-controller
```

### Database Connection Issues

```bash
# Test database connectivity
kubectl run -it --rm debug --image=postgres:16-alpine --restart=Never -n moltbook -- \
  psql -h postgres-service -U moltbook_user -d moltbook

# Check database service
kubectl get svc postgres-service -n moltbook
```

### Certificate Issues

```bash
# Check certificate status
kubectl describe certificate -n moltbook

# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Check ingress annotations
kubectl describe ingress moltbook-ingress -n moltbook
```

## Maintenance

### Rolling Updates

```bash
# Update image with zero downtime
kubectl set image deployment/moltbook-app \
  app=moltbook:v1.2.0 \
  -n moltbook

# Watch rollout status
kubectl rollout status deployment/moltbook-app -n moltbook

# Rollback if needed
kubectl rollout undo deployment/moltbook-app -n moltbook
```

### Draining Nodes

```bash
# Safely drain node for maintenance
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Uncordon node after maintenance
kubectl uncordon <node-name>
```

## Cleanup

```bash
# Delete all resources in namespace
kubectl delete namespace moltbook

# Or delete specific resources
kubectl delete -k k8s/base/
```

## Production Checklist

Before deploying to production:

- [ ] Replace all default secrets with strong, randomly generated values
- [ ] Configure proper storage classes for persistent volumes
- [ ] Set up backup retention policy and test restore procedures
- [ ] Configure monitoring and alerting (Prometheus, Grafana)
- [ ] Set up log aggregation (ELK, Loki, CloudWatch)
- [ ] Configure network policies for additional security
- [ ] Set resource quotas for the namespace
- [ ] Configure pod security policies/standards
- [ ] Set up disaster recovery procedures
- [ ] Document runbooks for common operations
- [ ] Test failover scenarios
- [ ] Configure CI/CD pipeline for automated deployments
- [ ] Set up DNS records for your domain
- [ ] Update email in cert-manager issuer
- [ ] Configure rate limiting and DDoS protection
- [ ] Set up automated security scanning

## Support

For issues or questions:
- Check logs: `kubectl logs -f -l app=moltbook-app -n moltbook`
- Check events: `kubectl get events -n moltbook`
- Review documentation: [DEPLOYMENT.md](../DEPLOYMENT.md)
- Contact: admin@moltbook.io

## License

Copyright © 2026 MoltHub Team

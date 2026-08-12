# Kubernetes Readiness

**Generated:** 2026-07-03T11:05:44.318Z  
**Manifests:** 11 files in deploy/k8s/

| Component | Present | Files |
|-----------|---------|-------|
| hpa | ✓ | backend-deployment.yaml, backend-hpa.yaml |
| ingress | ✓ | ingress-loadbalancer.yaml |
| redis | ✓ | redis-cluster.yaml |
| postgres | ✓ | postgres-primary.yaml, postgres-replica.yaml, postgresql-ha.yaml |
| pgbouncer | ✓ | pgbouncer-deployment.yaml |
| secrets | ✓ | backend-deployment.yaml |
| rollingDeploy | ✓ | backend-deployment.yaml |
| queueWorkers | ✓ | queue-workers.yaml |

**Manifest audit score:** 100%

**Note:** Manifest presence verified from repo. Live cluster deployment NOT verified in this run (no kubeconfig).

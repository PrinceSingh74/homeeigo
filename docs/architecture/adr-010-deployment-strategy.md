# ADR-010: Deployment Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Release Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

HOMIGO backend deploys to Google Cloud Run in `asia-south1` with digest-pinned container images, Secret Manager integration, and Cloud SQL connectivity. Phase 0 certification required reproducible deploys from clean git SHAs without dirty worktree contamination.

Stages C and D established the deployment chain from commit to serving revision.

---

## Problem

Ad-hoc deployments introduce:

1. **Non-reproducible artifacts** — images not traceable to git SHA.
2. **Schema/application skew** — migrations applied without matching container.
3. **Event flag accidents** — outbox enabled before schema ready.
4. **Production/staging cross-contamination** — wrong secrets or database targets.

---

## Decision

### Digest-pinned deployment chain

```
Git SHA (clean worktree)
  → Cloud Build / artifact registry tag backend:<short-sha>
  → Digest-pinned image sha256:...
  → gcloud run deploy homigo-backend-staging
  → Revision homigo-backend-staging-NNNNN-xxx
  → 100% traffic to certified revision
```

**Certified example (Phase 0 final):**

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| IMAGE_DIGEST | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| REVISION | `homigo-backend-staging-00029-pbn` |

### Deployment scripts

| Script | Purpose |
|--------|---------|
| `deploy/scripts/staging-gcp-deploy.ps1` | Standard staging deploy @ CommitSha |
| `deploy/scripts/staging-gcp-deploy-stage-d.ps1` | Stage D flags + incremental `-OutboxOnly` option |
| `deploy/scripts/staging-gcp-provision.ps1` | Initial provisioning |

### Deployment principles

1. **Clean worktree required** for build source — dirty `D:\homigo` excluded from certification (Step 8 chain of custody).
2. **No unnecessary rebuild** when certified digest already serves (Step 6).
3. **Migration jobs** via Cloud Run Job `homigo-staging-migrate-*` — separate from traffic shift.
4. **Incremental rollout** for Stage D: outbox first (`-OutboxOnly`), then consumers.
5. **Identity verification** post-deploy: revision digest matches expected SHA.

### Cloud Run configuration (staging certified)

| Parameter | Value |
|-----------|-------|
| minScale | 2 |
| maxScale | 4 |
| APP_ENV | staging |
| SQL annotation | `homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803` |

### Rollback

Revert traffic to prior digest-pinned revision via deploy script with known-good SHA (documented in `stage-d-certification-status.md`: rollback to `e459175` restores events OFF baseline).

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Deploy from dirty local tree** | Certification invalid — Step 8 rejects |
| **`:latest` floating tag** | No digest traceability |
| **Blue-green with separate services** | Complexity exceeds Phase 0 needs; revision rollback sufficient |
| **Kubernetes/GKE** | Cloud Run already provisioned and certified |
| **Terraform-only deploy without scripts** | Scripts exist and were used in certification |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Full artifact traceability | Requires disciplined clean worktree workflow |
| Revision-level rollback | Cloud Run revision accumulation |
| Separate migrate jobs | Two-step deploy process |
| Incremental event enablement | Multiple deploy passes for Stage D |

---

## Consequences

**Positive:**
- Step 5: exact-commit deploy PASS @ `262befa`; Step 6: digest-pinned `e459175`.
- Step 8: chain of custody git→digest→revision verified.
- Step 9: identity match on `00029-pbn` without redeploy.

**Negative:**
- Production deploy script/path not certified in Phase 0.
- Live GCP alert policy redeploy from updated JSON deferred (Step 6 note).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 5 deployment | `docs/evidence/stage-c-step-5/exact-commit-deployment-certification.md` |
| Step 6 final | `docs/evidence/stage-c-step-6/step-6-final-certification.md` |
| Step 8 chain of custody | `docs/evidence/stage-d-step-8/step-8-integration-certification.md` |
| Step 9 identity | `docs/evidence/stage-d-step-9/step-9-event-flags-certification.md` |
| Stage D runbook | `docs/evidence/stage-d/stage-d-runbook.md` |
| Release identity | `docs/evidence/stage-g-soak/stage-g-release-identity.json` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Production deploy script + checklist | Pre-prod | ADR-012 |
| Automated identity gate in CI | Release Engineering | Block deploy on digest mismatch |
| Canary traffic split | Scale phase | Cloud Run traffic splitting |
| GitOps (Argo/Flux) | Platform | Evaluate after production stable |

---

## Related ADRs

ADR-011 (Staging Certification) · ADR-012 (Production Promotion) · ADR-010 rollback detail in [ROLLBACK-RUNBOOK.md](../operations/ROLLBACK-RUNBOOK.md)

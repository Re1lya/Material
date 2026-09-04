# ModelDeployment v2 smoke — 2026-09-04

## Result

- Start request commit `7c280dbeabcd652e6caddc4ccb7b7b717d58d596` was
  merged as `05f762c973a9c19fe5e924098d590f5de59ee97f`.
- Argo synchronized the v2 request; Crossplane selected
  `modeldeployment-qwen38-ray-v2`.
- Ray head and one TP=2 worker became Ready on `a3-server-00`; the worker was
  allocated `Ascend910-10,Ascend910-11`.
- The cache Job completed in 31 seconds, the runtime image was already present,
  and the user verified a real inference conversation inside the runtime.
- Observed control-plane timing was short: Argo operation about 1 second,
  Crossplane/RayCluster creation within a few seconds and Pods Ready in about
  25 seconds. Most remaining startup time was Ray Serve/vLLM model loading.

## Dashboard defects found

- The status backend built the model probe URL without the Serve port. It
  requested port 80 and returned `ECONNREFUSED`, while the generated
  `qwen38-27b-serve-svc` correctly exposed named port `serve` on 8000. The
  Dashboard therefore remained `Deploying / Serving pending` after inference
  was actually usable.
- Dashboard Stop was enabled only for normalized status `Running`; a Running
  desired state with a failed health probe could not be stopped from that page.
- During the PR/merge-to-Argo interval the live XR remained Stopped, so the page
  could temporarily show Stopped and re-enable Start. The desired Git revision,
  request ID and live generation need an explicit in-flight operation state.

## Stop and cleanup

- The Running Window was closed before Stop.
- Stop commit `f4d5f28a54c920fd22f89032508190f96a11bdd2` passed the
  production main-push PipelineRun and Argo synchronized the same revision.
- The XR returned to `modeldeployment-stopped-v2`, Stopped,
  Synced/Ready=True and zero requested NPU.
- RayService, RayCluster, head and worker Pods, PVC and Job were removed.
- One Completed cache Pod had no ownerReference and blocked the terminating
  PVC. The exact completed Pod was deleted manually; the Retain PV and cached
  data were preserved in Released state for the next validated reclaim.
- Final Dashboard API state was Stopped with no unavailable modules.

## Next implementation scope

1. Derive the probe URL from the named Serve port and include `:8000`; also
   declare the port on the stable Service contract.
2. Permit Stop whenever desiredState is Running, including Deploying, Serving
   pending and Failed states.
3. Preserve an in-flight lifecycle state from request creation through Argo/XR
   convergence so Start cannot be submitted twice.
4. Automatically remove orphaned terminal cache Pods without deleting the
   retained model cache data.
5. After those correctness fixes, move the approved mutable deployment
   parameters and operation history into Backstage PostgreSQL and optimize the
   measured Git/Tekton/Argo handoff delays. Multi-instance serving is deferred.

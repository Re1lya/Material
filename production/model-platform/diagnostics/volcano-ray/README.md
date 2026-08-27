# Volcano Ray TP=2 head-skip probe

This bounded probe separates two independent questions:

1. A CPU-only Ray head carries `huawei.com/skip-ascend-plugin: enabled`; it does **not** request an NPU.
2. The Ray worker genuinely requests two Ascend910 devices and is statically constrained to physical chips 8 and 9.
3. Both pods select `accelerator-type: module-a3-16`, the actual A3 node label
   required for MindX/Volcano to use the A3 16-card topology policy.

It does not mount a model or start vLLM.  It is therefore a scheduler/device-plugin test rather than a Qwen deployment.  Run the script only after `npu-smi info` confirms chips 8 and 9 are idle; Kubernetes cannot see host-Docker NPU use.

The script records RayCluster/PodGroup state, events, node state, Volcano scheduler logs and Ascend device-plugin logs, then deletes its RayCluster and namespace even on failure.  The evidence is written outside the repository under `~/qwen38-diagnostics/` by default.

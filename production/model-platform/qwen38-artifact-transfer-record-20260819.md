# Qwen3.8-27B 制品复制记录

记录日期：2026-08-19  
范围：只读检查 A3 主机、复制模型和 OCI 镜像到 Artifact Keeper；不启动或
修改 Kubernetes 推理工作负载。

## 来源与身份

来源主机为 `a3-server-00`（`admin@110.123.0.3`）。已确认的模型目录和
镜像归档为：

```text
model source:  /home/models/Qwen3.8-27B-w8a8
image archive: /home/models/vllm-images/vllm-ascend-qwen3.8-a3.tar
runtime tag:  quay.io/ascend/vllm-ascend:qwen3.8-a3
container path: /models/Qwen3.8-27B-w8a8
```

模型目录包含 26 个文件、`32152070926` bytes，其中包括 10 个 Safetensors
分片。目录中的 README 和配置记录为 Qwen3.8-27B、ModelSlim W8A8、
ModelSlim commit `173fc3787b496d4ef2e1e995bbf17c19f65a2083`；目录是已经完成
量化的 A3 快照，因此 GitOps ModelVersion 使用 `source.type: a3-preloaded`。
关联的 ModelScope immutable revision 为
`e823e888ae179eb3be02c1a48899c4f828371376`，但本次没有在集群中重新下载或
量化 BF16 源。

## Artifact Keeper 模型制品

模型写入 `model-artifacts` 仓库的不可变前缀：

```text
qwen3.8-27b/w8a8/e823e888ae179eb3be02c1a48899c4f828371376/msmodelslim-w8a8-a3-f2afa9e2
```

发布的 `manifest.json` 的规范摘要为：

```text
sha256:f2afa9e2f328d9efb78bc88d526413783304c4706a508f0da1db456aeac5c20f
```

清单正文 SHA256 为
`1ce09b147ed76edadcbf0d3a36d6a6a755ba4e5cc565eab9222aecb54271eb7f`。
上传后从 Artifact Keeper 逐项读取 27 个对象（26 个文件加 manifest），
元数据、大小和摘要校验为 `27/27`，manifest 正文和规范摘要均匹配。

上传使用 Artifact Keeper 原生可恢复分块接口：创建 upload session，按
64 MiB `Content-Range` 分块 PATCH，最后调用 `complete`。没有再次使用会把
整个多 GiB 请求缓存在 Backend 内存中的直接 PUT 路径；该路径曾触发 4 GiB
Backend OOM，因此被明确排除。

## Artifact Keeper OCI 镜像

原始归档 SHA256 为：

```text
e3301cd9c573bc8af2ff03a4401503611c3667d1a489c52273c23b7094fc6db7
```

镜像归档加载后确认架构为 Linux/ARM64，Docker config digest 为
`sha256:41dab489874e4983324d9d960a6c57f8bd45ebb5172a3b7672bd64461f9d96b`。
Artifact Keeper 中的运行时镜像引用固定为：

```text
110.120.0.3:30670/container-images/vllm-ascend@sha256:a27a79c2021cdda071eb207c169a5dd44537d22df11ccd7b62b52de117ceac14
```

镜像 manifest、config 和 15 个 layer（共 16 个 blob）均通过 HEAD/摘要
校验。缓存下载器使用的 ARM64 镜像也已固定为：

```text
110.120.0.3:30670/container-images/model-cache@sha256:2c38a8bb8be05414a5afebdd88fde3c2032098d0d1edb3f3e005f0adb6d78e13
```

## 运行边界

- 复制过程只访问 Artifact Keeper 和 A3 文件；没有在 `gpu-server-00` 创建
  PVC、缓存 Job、RayService、Service、Deployment 或 Pod。
- A3 上已有 Docker/vLLM 服务、进程、NPU 设备和模型源文件保持原状；没有
  stop、restart、删除或覆盖操作。
- Git 中只提交路径、摘要和公开运行时参数；Artifact Keeper/Gitea Token
  均为临时运行凭据，未写入仓库、清单或本记录。
- 本次 Artifact Keeper 三个 `qwen38-*-temp-20260819` Token、Gitea 临时写入
  Bot/Admin Token 已在复制、推送和校验完成后撤销；Argo 的只读仓库 Token
  保留在其现有 Kubernetes Secret 中。
- 当前制品只完成“可复用的不可变发布”验证，没有开始模型推理。后续只有
  经过人工评审的 `desiredState: Running` 变更才能进入缓存和 NPU 门禁。

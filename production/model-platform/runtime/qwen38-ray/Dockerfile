ARG BASE_IMAGE=110.120.0.3:30670/container-images/vllm-ascend@sha256:a27a79c2021cdda071eb207c169a5dd44537d22df11ccd7b62b52de117ceac14
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="Qwen3.8 A3 Ray Serve LLM runtime" \
      org.opencontainers.image.description="The validated Qwen3.8 A3 runtime with the missing Ray 2.48 LLM dependencies added offline" \
      platform.example.com.ray-version="2.48.0" \
      platform.example.com.python-version="3.12.13"

USER root

COPY requirements.lock /opt/qwen38-ray/requirements.lock
COPY wheelhouse/ /opt/qwen38-ray/wheelhouse/
COPY validate_runtime.py /opt/qwen38-ray/validate_runtime.py

RUN cd /opt/qwen38-ray/wheelhouse \
    && sha256sum --check SHA256SUMS \
    && /usr/local/python3.12.13/bin/python3 -m pip install \
         --no-cache-dir \
         --no-index \
         --find-links=/opt/qwen38-ray/wheelhouse \
         --requirement=/opt/qwen38-ray/requirements.lock \
    && /usr/local/python3.12.13/bin/python3 \
         /opt/qwen38-ray/validate_runtime.py --mode build \
    && rm -rf /opt/qwen38-ray/wheelhouse

# The cache image is CPU-only and contains no model weights or NPU runtime.
# BASE_IMAGE is mandatory so the build cannot silently pull a floating public
# image. Publish the resulting image to Artifact Keeper and use its digest in
# the Crossplane release contract.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root

COPY model-cache-fetch.py /opt/model-cache/model-cache-fetch.py
RUN chmod 0555 /opt/model-cache/model-cache-fetch.py \
    && mkdir -p /cache \
    && chown -R 65532:65532 /opt/model-cache /cache

USER 65532:65532
ENTRYPOINT ["python3", "/opt/model-cache/model-cache-fetch.py"]

# Build with an already mirrored, immutable ARM64/AMD64 CPU base image.  The
# build intentionally has no default: a release cannot accidentally pull a
# floating public image.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY requirements.lock /tmp/requirements.lock
RUN python3 -m pip install --no-cache-dir --requirement /tmp/requirements.lock \
    && rm -f /tmp/requirements.lock

COPY modelscope_import.py /opt/model-import/modelscope_import.py
RUN chmod 0555 /opt/model-import/modelscope_import.py \
    && mkdir -p /var/lib/model-import \
    && chown -R 65532:65532 /opt/model-import /var/lib/model-import

USER 65532:65532
WORKDIR /var/lib/model-import
ENTRYPOINT ["python3", "/opt/model-import/modelscope_import.py"]

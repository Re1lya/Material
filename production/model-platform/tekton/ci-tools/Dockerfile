FROM 110.120.0.3:8889/library/python:3.12-slim@sha256:cab2dbf575e971934a81e4622f5aba17aa7929719bd7e31033a3a83b97fd0464 AS base
FROM 110.120.0.3:8889/kubectl:v1.35.0@sha256:3aa73a9c4cf5a830a02ee108238011b7f8d9084b9b88432b7851e489420bacc6 AS kubectl

FROM base
RUN sed -i \
      -e 's|http://deb.debian.org/debian|https://mirrors.ustc.edu.cn/debian|g' \
      -e 's|http://deb.debian.org/debian-security|https://mirrors.ustc.edu.cn/debian-security|g' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir \
         -i https://mirrors.aliyun.com/pypi/simple/ \
         check-jsonschema==0.38.0
COPY --from=kubectl /bin/kubectl /usr/local/bin/kubectl
USER 65532:65532

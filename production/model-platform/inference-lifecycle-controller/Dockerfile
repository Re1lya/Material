FROM 110.120.0.3:30670/container-images/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd

WORKDIR /opt/inference-lifecycle-controller
COPY --chown=65532:65532 controller.py ./controller.py

USER 65532:65532
ENTRYPOINT ["python3", "/opt/inference-lifecycle-controller/controller.py"]

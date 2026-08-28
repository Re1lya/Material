"""A deliberately empty Dagster location for the first platform foundation.

The upstream KCC location also registers historical Ray and NPU-capable jobs.
Loading it in the first control-plane release would make those jobs visible in
the UI before their resource/RBAC controls are migrated.  This location keeps
the webserver and daemon observable while exposing no executable job.

The later CPU-staging release replaces this module with a separately reviewed,
allow-listed location.  It must not import the legacy KCC definitions directly.
"""

from dagster import Definitions


defs = Definitions()

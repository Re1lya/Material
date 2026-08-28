# Historical DataPipelineRunRequest validator

`data-pipeline-run-request.schema.json` and
`validate-data-pipeline-run-requests.py` are retained as evidence of the
audit-first Git-only request design considered before the K12 CPU cutover.

They are not currently wired into `validate-model-platform-config`. Production
K12 CPU runs now use the authenticated, allow-listed Backstage backend to call
the approved Dagster job directly, as recorded in
`../../../data-pipeline/k12-cpu-backstage-cutover-record-20260828.md`.

Do not add this validator back to the active Tekton Pipeline without a new
review of the request ownership, dispatcher, schema and rollback model.

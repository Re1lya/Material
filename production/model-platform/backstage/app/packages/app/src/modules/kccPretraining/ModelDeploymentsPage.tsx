import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import CachedIcon from '@material-ui/icons/Cached';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import StopIcon from '@material-ui/icons/Stop';
import { Content, Page } from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';
import { fetchDeployments } from './modelDeployments/api';
import {
  actionState,
  failureReason,
  pipelineStages,
  stageState,
  statusTone,
} from './modelDeployments/status';
import type {
  Deployment,
  DeploymentsResponse,
  DeploymentStatus,
} from './modelDeployments/types';

const useStyles = makeStyles(theme => ({
  content: {
    boxSizing: 'border-box',
    margin: 0,
    maxWidth: 'none',
    padding: theme.spacing(3, 4, 6),
    width: '100%',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
  },
  headerActions: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1) },
  flow: {
    alignItems: 'center',
    border: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
    padding: theme.spacing(1.5, 2),
  },
  panel: { border: `1px solid ${theme.palette.divider}`, height: '100%' },
  panelHeader: {
    borderBottom: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
  },
  panelBody: { padding: theme.spacing(2) },
  filters: {
    display: 'flex',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1.5),
  },
  list: {
    display: 'grid',
    gap: theme.spacing(1),
    maxHeight: '68vh',
    overflowY: 'auto',
  },
  card: {
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 9,
    cursor: 'pointer',
    padding: theme.spacing(1.5),
    textAlign: 'left',
    width: '100%',
  },
  selected: {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
  },
  cardRow: {
    alignItems: 'flex-start',
    display: 'flex',
    justifyContent: 'space-between',
  },
  cardMeta: {
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
  },
  cardChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.spacing(1.25),
  },
  summaryGrid: {
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  summary: {
    background: '#f6f7f9',
    borderRadius: 7,
    minHeight: 100,
    padding: theme.spacing(1.5),
  },
  summaryLabel: { color: theme.palette.text.secondary, fontSize: '0.72rem' },
  summaryValue: {
    fontSize: '0.82rem',
    fontWeight: 700,
    overflowWrap: 'anywhere',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    margin: theme.spacing(2, 0),
  },
  section: {
    borderTop: `1px solid ${theme.palette.divider}`,
    paddingTop: theme.spacing(2),
  },
  pipeline: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, minmax(72px, 1fr))',
    overflowX: 'auto',
  },
  step: { minWidth: 72, textAlign: 'center' },
  stepDot: {
    alignItems: 'center',
    background: '#dfe3e8',
    borderRadius: '50%',
    color: '#60666e',
    display: 'inline-flex',
    height: 23,
    justifyContent: 'center',
    width: 23,
  },
  done: { background: '#148356', color: '#fff' },
  active: { background: theme.palette.primary.main, color: '#fff' },
  failed: { background: theme.palette.error.main, color: '#fff' },
  detailsGrid: { marginTop: theme.spacing(2) },
  subcard: {
    border: `1px solid ${theme.palette.divider}`,
    height: '100%',
    padding: theme.spacing(1.5),
  },
  kv: { display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)' },
  key: {
    borderTop: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    padding: theme.spacing(1, 0),
  },
  value: {
    borderTop: `1px solid ${theme.palette.divider}`,
    overflowWrap: 'anywhere',
    padding: theme.spacing(1, 0),
  },
  event: {
    borderLeft: '3px solid #9db0c9',
    marginTop: theme.spacing(1),
    paddingLeft: theme.spacing(1),
  },
  unavailable: {
    background: '#fff6df',
    border: '1px solid #efd48b',
    marginBottom: theme.spacing(1),
    padding: theme.spacing(1),
  },
  stale: { color: theme.palette.warning.main },
  empty: {
    color: theme.palette.text.secondary,
    padding: theme.spacing(6),
    textAlign: 'center',
  },
}));

function templateHref(template: string, deployment: Deployment) {
  return `/create/templates/default/${template}?formData=${encodeURIComponent(
    JSON.stringify({ deploymentName: deployment.name }),
  )}`;
}

function statusLabel(status: DeploymentStatus) {
  return status === 'Unknown' ? 'Unknown status' : status;
}

function pipelineClass(state: string, classes: ReturnType<typeof useStyles>) {
  if (state === 'done') return classes.done;
  if (state === 'active') return classes.active;
  if (state === 'failed') return classes.failed;
  return '';
}

function pipelineMark(state: string, index: number) {
  if (state === 'done') return '✓';
  if (state === 'failed') return '!';
  return index + 1;
}

export const ModelDeploymentsPage = () => {
  const classes = useStyles();
  const [data, setData] = useState<DeploymentsResponse>({});
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController>();

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const next = await fetchDeployments(requestController.signal);
      setData(next);
      setError(undefined);
      setStale(false);
      setSelected(current => {
        if (current && next.deployments?.some(item => item.name === current)) {
          return current;
        }
        return next.deployments?.[0]?.name;
      });
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setError(cause instanceof Error ? cause.message : 'Refresh failed');
        setStale(true);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 8000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const deployments = useMemo(
    () =>
      (data.deployments ?? []).filter(item => {
        const matchesStatus = filter === 'All' || item.status === filter;
        const text = `${item.name} ${item.modelVersionRef ?? ''} ${
          item.runtimeProfileRef ?? ''
        }`.toLowerCase();
        return matchesStatus && text.includes(query.trim().toLowerCase());
      }),
    [data.deployments, filter, query],
  );
  const detail =
    (data.deployments ?? []).find(item => item.name === selected) ??
    deployments[0];
  const actions = detail ? actionState(detail) : undefined;
  const failure = detail ? failureReason(detail) : undefined;
  const modules = detail?.unavailable ?? data.unavailable ?? {};

  return (
    <Page themeId="tool">
      <Content className={classes.content}>
        <Box className={classes.header}>
          <Box>
            <Typography variant="h4">模型推理部署</Typography>
            <Typography color="textSecondary">
              统一查看 ModelDeployment 的申请、发布、运行、停止和回滚状态。
            </Typography>
          </Box>
          <Box className={classes.headerActions}>
            <Button component="a" href="/model-recipes" variant="outlined">
              模型目录
            </Button>
            <Button
              color="primary"
              component="a"
              href="/model-recipes"
              startIcon={<AddIcon />}
              variant="contained"
            >
              New deployment
            </Button>
            <Button disabled>Runtime profiles</Button>
            <Button onClick={() => void refresh()} startIcon={<CachedIcon />}>
              Refresh
            </Button>
          </Box>
        </Box>

        <Paper className={classes.flow} elevation={0}>
          <Box>
            <b>
              ModelDeployment → Gitea → Tekton → Argo → Crossplane → KubeRay
            </b>
            <Typography color="textSecondary" variant="body2">
              未知状态不会显示为成功；Start和Stop继续通过受限GitOps执行。
            </Typography>
          </Box>
          <Chip
            label={`${
              data.deployments?.length ?? 0
            } deployments · model-serving`}
            size="small"
          />
        </Paper>

        <Grid container spacing={2}>
          <Grid item lg={5} xs={12}>
            <Paper className={classes.panel}>
              <Box className={classes.panelHeader}>
                <Typography variant="h5">部署实例</Typography>
                <Typography color="textSecondary" variant="body2">
                  动态状态、运行配置和当前阶段
                </Typography>
              </Box>
              <Box className={classes.panelBody}>
                <Box className={classes.filters}>
                  <TextField
                    fullWidth
                    inputProps={{ 'aria-label': 'Search deployment or model' }}
                    label="Search deployment or model"
                    onChange={event => setQuery(event.target.value)}
                    size="small"
                    value={query}
                    variant="outlined"
                  />
                  <TextField
                    onChange={event => setFilter(event.target.value)}
                    select
                    size="small"
                    value={filter}
                    variant="outlined"
                  >
                    {[
                      'All',
                      'Running',
                      'Pending',
                      'Validating',
                      'Deploying',
                      'Stopping',
                      'Stopped',
                      'Failed',
                      'Unknown',
                    ].map(value => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                {error && (
                  <Typography className={classes.stale} variant="body2">
                    Refresh failed: {error}; showing last successful data.
                  </Typography>
                )}
                <Box className={classes.list}>
                  {loading && !(data.deployments?.length ?? 0) ? (
                    <Box className={classes.empty}>Loading deployments…</Box>
                  ) : (
                    deployments.map(item => (
                      <Paper
                        aria-label={`Deployment ${item.name}`}
                        className={`${classes.card} ${
                          item.name === detail?.name ? classes.selected : ''
                        }`}
                        component="button"
                        key={item.name}
                        onClick={() => setSelected(item.name)}
                        variant="outlined"
                      >
                        <Box className={classes.cardRow}>
                          <Box>
                            <b>{item.name}</b>
                            <Typography
                              className={classes.cardMeta}
                              variant="body2"
                            >
                              {item.modelVersionRef ?? 'Unknown model'}
                            </Typography>
                          </Box>
                          <Chip
                            color={statusTone(item.status)}
                            label={statusLabel(item.status)}
                            size="small"
                          />
                        </Box>
                        <Box className={classes.cardChips}>
                          <Chip
                            label={item.runtimeProfileRef ?? 'Unknown profile'}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            label={`${item.npu?.requested ?? 0} NPU requested`}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            label={item.phase ?? 'Unknown phase'}
                            size="small"
                          />
                        </Box>
                        <Typography
                          className={classes.cardMeta}
                          variant="caption"
                        >
                          {item.requestId ??
                            item.git?.revision ??
                            'No active request'}
                        </Typography>
                      </Paper>
                    ))
                  )}
                  {!loading && deployments.length === 0 && (
                    <Box className={classes.empty}>
                      No deployments match the filter.
                    </Box>
                  )}
                </Box>
              </Box>
            </Paper>
          </Grid>

          <Grid item lg={7} xs={12}>
            <Paper className={classes.panel}>
              {!detail ? (
                <Box className={classes.empty}>Select a deployment.</Box>
              ) : (
                <>
                  <Box className={classes.panelHeader}>
                    <Box className={classes.cardRow}>
                      <Box>
                        <Typography variant="h5">
                          Deployment details · {detail.name}
                        </Typography>
                        <Typography color="textSecondary">
                          {detail.modelVersionRef ?? 'Unknown model'} ·{' '}
                          {detail.runtimeProfileRef ?? 'Unknown profile'}
                        </Typography>
                      </Box>
                      <Chip
                        color={statusTone(detail.status)}
                        label={statusLabel(detail.status)}
                      />
                    </Box>
                  </Box>
                  <Box className={classes.panelBody}>
                    {Object.entries(modules).map(([module, message]) => (
                      <Paper
                        className={classes.unavailable}
                        elevation={0}
                        key={module}
                      >
                        {module} unavailable: {message}
                      </Paper>
                    ))}
                    {stale && (
                      <Paper className={classes.unavailable} elevation={0}>
                        Status is stale because the latest refresh failed.
                      </Paper>
                    )}
                    <Box className={classes.summaryGrid}>
                      {[
                        ['Status', statusLabel(detail.status)],
                        ['Current phase', detail.phase ?? 'Unknown'],
                        [
                          'Placement',
                          detail.npu?.actualDevices?.join(', ') ||
                            'Not allocated',
                        ],
                        [
                          'Runtime',
                          `${detail.ray?.readyWorkers ?? 0}/${
                            detail.ray?.requestedWorkers ?? 0
                          } workers`,
                        ],
                        [
                          'Endpoint',
                          detail.serve?.endpoint ??
                            `Service ${
                              detail.serve?.serviceStatus ?? 'Unknown'
                            }`,
                        ],
                      ].map(([key, value]) => (
                        <Box className={classes.summary} key={key}>
                          <Typography className={classes.summaryLabel}>
                            {key}
                          </Typography>
                          <Typography className={classes.summaryValue}>
                            {value}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    <Box className={classes.actions}>
                      <Button
                        color="primary"
                        component="a"
                        disabled={!actions?.canStart}
                        href={templateHref('start-model-inference', detail)}
                        startIcon={<PlayArrowIcon />}
                        variant="contained"
                      >
                        Start inference
                      </Button>
                      <Button
                        color="secondary"
                        component="a"
                        disabled={!actions?.canStop}
                        href={templateHref('stop-model-inference', detail)}
                        startIcon={<StopIcon />}
                        variant="outlined"
                      >
                        Stop inference
                      </Button>
                      <Button disabled>Update · Coming soon</Button>
                      <Button disabled>Rollback · Coming soon</Button>
                      <Button disabled>Logs · Coming soon</Button>
                    </Box>
                    <Box className={classes.section}>
                      <Box className={classes.cardRow}>
                        <Typography variant="h6">
                          Deployment pipeline
                        </Typography>
                        <Typography color="textSecondary" variant="caption">
                          {detail.tekton?.pipelineRun ??
                            'No associated PipelineRun'}
                        </Typography>
                      </Box>
                      <Box className={classes.pipeline}>
                        {pipelineStages.map((stage, index) => {
                          const state = stageState(detail, index);
                          return (
                            <Box className={classes.step} key={stage}>
                              <span
                                className={`${classes.stepDot} ${pipelineClass(
                                  state,
                                  classes,
                                )}`}
                              >
                                {pipelineMark(state, index)}
                              </span>
                              <Typography variant="caption">
                                <b>{stage}</b>
                              </Typography>
                              <Typography
                                color="textSecondary"
                                variant="caption"
                              >
                                {state}
                              </Typography>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                    <Box className={classes.section}>
                      <Typography variant="h6">Stage timeline</Typography>
                      {(detail.timeline ?? []).map(entry => (
                        <Typography color="textSecondary" key={entry.name} variant="body2">
                          {entry.name}: {entry.startedAt ?? 'Waiting'}
                          {entry.durationSeconds === undefined
                            ? ''
                            : ` · ${entry.durationSeconds}s`}
                        </Typography>
                      ))}
                      {(detail.timeline?.length ?? 0) === 0 && (
                        <Typography color="textSecondary" variant="body2">
                          Timeline data is not available yet.
                        </Typography>
                      )}
                    </Box>
                    <Grid className={classes.detailsGrid} container spacing={2}>
                      <Grid item md={7} xs={12}>
                        <Paper className={classes.subcard} elevation={0}>
                          <Typography variant="h6">
                            Configuration and release
                          </Typography>
                          <Box className={classes.kv} mt={1}>
                            {[
                              [
                                'Git pull request',
                                detail.git?.pullRequest
                                  ? `#${detail.git.pullRequest} · ${detail.git.state}`
                                  : 'Unavailable',
                              ],
                              [
                                'Tekton',
                                detail.tekton?.pipelineRun ?? 'Unavailable',
                              ],
                              [
                                'Argo CD',
                                `${detail.argo?.sync ?? 'Unknown'} / ${
                                  detail.argo?.health ?? 'Unknown'
                                }`,
                              ],
                              [
                                'Crossplane',
                                `${
                                  detail.crossplane?.synced
                                    ? 'Synced'
                                    : 'Not synced'
                                } / ${
                                  detail.crossplane?.ready
                                    ? 'Ready'
                                    : 'Not ready'
                                }`,
                              ],
                              [
                                'Composition',
                                detail.compositionRef ?? 'Unknown',
                              ],
                              [
                                'Ray clusters',
                                detail.ray?.clusters?.join(', ') || 'None',
                              ],
                              [
                                'Serve',
                                `${
                                  detail.serve?.modelStatus ?? 'Unknown'
                                } / Service ${
                                  detail.serve?.serviceStatus ?? 'Unknown'
                                }`,
                              ],
                              [
                                'Gateway',
                                detail.serve?.gatewayStatus ?? 'NotConfigured',
                              ],
                            ].flatMap(([key, value]) => [
                              <Typography
                                className={classes.key}
                                key={`${key}-key`}
                                variant="body2"
                              >
                                {key}
                              </Typography>,
                              <Typography
                                className={classes.value}
                                key={`${key}-value`}
                                variant="body2"
                              >
                                {value}
                              </Typography>,
                            ])}
                          </Box>
                          {failure && (
                            <Box mt={2}>
                              <Typography color="error">
                                Failure: {failure}
                              </Typography>
                            </Box>
                          )}
                        </Paper>
                      </Grid>
                      <Grid item md={5} xs={12}>
                        <Paper className={classes.subcard} elevation={0}>
                          <Typography variant="h6">
                            Health and recent events
                          </Typography>
                          <Typography variant="body2">
                            Model: {detail.serve?.modelStatus ?? 'Unknown'}
                          </Typography>
                          <Typography variant="body2">
                            Service: {detail.serve?.serviceStatus ?? 'Unknown'}
                          </Typography>
                          <Typography variant="body2">
                            NPU:{' '}
                            {detail.npu?.actualDevices?.join(', ') || 'None'}
                          </Typography>
                          {(detail.recentEvents ?? []).map((event, index) => (
                            <Box
                              className={classes.event}
                              key={`${event.time}-${index}`}
                            >
                              <Typography variant="body2">
                                <b>{event.reason ?? event.type ?? 'Event'}</b>
                              </Typography>
                              <Typography
                                color="textSecondary"
                                variant="caption"
                              >
                                {event.message ?? 'No message'} ·{' '}
                                {event.time ?? 'Unknown time'}
                              </Typography>
                            </Box>
                          ))}
                          {(detail.recentEvents?.length ?? 0) === 0 && (
                            <Typography color="textSecondary" variant="body2">
                              No related events.
                            </Typography>
                          )}
                        </Paper>
                      </Grid>
                    </Grid>
                  </Box>
                </>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

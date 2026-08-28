import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@material-ui/core';
import AccountTreeIcon from '@material-ui/icons/AccountTree';
import AutorenewIcon from '@material-ui/icons/Autorenew';
import LockIcon from '@material-ui/icons/Lock';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import StorageIcon from '@material-ui/icons/Storage';
import {
  Content,
  ContentHeader,
  InfoCard,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { fetchApiRef, identityApiRef, useApi } from '@backstage/core-plugin-api';
import { makeStyles } from '@material-ui/core/styles';
import { useCallback, useEffect, useState } from 'react';

type Run = {
  runId?: string;
  pipelineName?: string;
  status?: string;
  startTime?: number | null;
  endTime?: number | null;
};

type PipelineStatus = {
  enabled?: boolean;
  namespace?: string;
  release?: {
    image?: string;
    sourceCommit?: string;
  };
  foundation?: {
    phase?: 'not-deployed' | 'unavailable' | 'ready';
    message?: string;
  };
  runtime?: {
    phase?: 'unavailable' | 'ready';
    message?: string;
  };
  dagster?: {
    phase?: 'not-configured' | 'unavailable' | 'ready';
    url?: string;
    message?: string;
  };
  execution?: {
    mode?: string;
    jobName?: string;
    profileName?: string;
    manifestPrefix?: string;
    outputPrefix?: string;
    message?: string;
  };
};

type ApiErrorBody = { error?: string | { message?: string } };

const useStyles = makeStyles(theme => ({
  content: {
    boxSizing: 'border-box',
    margin: 0,
    maxWidth: 'none',
    padding: theme.spacing(3, 5, 6, 3),
    width: '100%',
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(2, 2, 5),
    },
  },
  notice: {
    borderLeft: `4px solid ${theme.palette.info.main}`,
    padding: theme.spacing(1.5),
  },
  card: { height: '100%' },
  form: { display: 'grid', gap: theme.spacing(1.5) },
  muted: { color: theme.palette.text.secondary },
  row: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(1.25),
    marginBottom: theme.spacing(1.25),
  },
  icon: { color: theme.palette.primary.main, marginTop: 2 },
  run: {
    alignItems: 'center',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'space-between',
    padding: theme.spacing(1, 0),
  },
}));

function apiError(status: number, body: ApiErrorBody | undefined): string {
  const detail = typeof body?.error === 'string' ? body.error : body?.error?.message;
  if (status === 401) return '登录会话不可用。请重新登录 Backstage 后重试。';
  return detail ?? `HTTP ${status}`;
}

async function api<T>(
  authenticatedFetch: typeof fetch,
  getCredentials: () => Promise<{ token?: string }>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { token } = await getCredentials();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await authenticatedFetch(
    new URL(`/api/data-pipeline${path}`, window.location.origin).toString(),
    { ...init, headers },
  );
  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // HTTP status is a safe fallback when the backend did not return JSON.
    }
    throw new Error(apiError(response.status, body));
  }
  return (await response.json()) as T;
}

function phaseColor(phase: string | undefined): 'default' | 'primary' | 'secondary' {
  return phase === 'ready' ? 'primary' : phase === 'not-deployed' ? 'secondary' : 'default';
}

function displayTime(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleString();
}

/**
 * The page intentionally does not call Kubernetes, Ray or Dagster from the
 * browser. Its backend owns the narrow read-only proxy and may only create a
 * allow-listed launch request for the existing K12 Stage 1 Dagster job.
 */
export const DataPipelinePage = () => {
  const classes = useStyles();
  const fetchApi = useApi(fetchApiRef);
  const identityApi = useApi(identityApiRef);
  const [status, setStatus] = useState<PipelineStatus>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState('');
  const [requestName, setRequestName] = useState('backstage-stage1-sample');
  const [manifestRef, setManifestRef] = useState(
    's3://k12-cleaned-corpus/cpu-smoke/manifests/stage1_test_10.json',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const current = await api<PipelineStatus>(
        fetchApi.fetch,
        () => identityApi.getCredentials(),
        '/status',
      );
      setStatus(current);
      if (current.dagster?.phase === 'ready') {
        const response = await api<{ items?: Run[] }>(
          fetchApi.fetch,
          () => identityApi.getCredentials(),
          '/runs',
        );
        setRuns(response.items ?? []);
      } else {
        setRuns([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Data pipeline status request failed'));
    } finally {
      setLoading(false);
    }
  }, [fetchApi, identityApi]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function requestCpuRun() {
    setMessage('');
    try {
      const result = await api<{
        runId?: string;
        status?: string;
        jobName?: string;
        outputPrefix?: string;
      }>(
        fetchApi.fetch,
        () => identityApi.getCredentials(),
        '/runs',
        {
          method: 'POST',
          body: JSON.stringify({
            requestName,
            manifestRef,
            profile: 'k12-stage1-clean-v1',
          }),
        },
      );
      setMessage(
        result.runId
          ? `已启动 ${result.jobName ?? 'K12 Stage 1'}：${result.runId}，输出 ${result.outputPrefix ?? '待更新'}。`
          : 'K12 CPU 运行已提交。',
      );
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '创建运行申请失败');
    }
  }

  if (loading && !status) return <Progress />;
  if (error && !status) return <ResponseErrorPanel error={error} />;

  const dagsterReady = status?.dagster?.phase === 'ready';
  const requestAvailable =
    status?.enabled &&
    status?.foundation?.phase === 'ready' &&
    status?.runtime?.phase === 'ready' &&
    status?.dagster?.phase === 'ready';

  return (
    <Page themeId="tool">
      <Content className={classes.content}>
        <ContentHeader title="K12 Data Pipeline">
          <Chip
            color="secondary"
            icon={<LockIcon />}
            label="CPU staging only · NPU disabled"
            variant="outlined"
          />
          <Button startIcon={<AutorenewIcon />} onClick={() => void load()}>
            Refresh
          </Button>
        </ContentHeader>
        <Paper className={classes.notice} elevation={0} role="note">
          <Typography variant="body2">
            本页面展示正式 K12 CPU release，并仅允许启动既有的
            cleanjopbstage1_10。浏览器不能传入镜像、Kubernetes、Ray 或 NPU 参数；
            后端会固定源数据、Stage 1 版本、CPU 资源和输出前缀。
          </Typography>
          {message && <Typography variant="body2">{message}</Typography>}
        </Paper>

        <Grid container spacing={2} style={{ marginTop: 16 }}>
          <Grid item xs={12} md={7}>
            <InfoCard title="Release and control-plane status" className={classes.card}>
              <Box className={classes.row}>
                <AccountTreeIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">K12 Dagster release</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    {status?.foundation?.message ?? 'Status unavailable'}
                  </Typography>
                </Box>
                <Chip
                  color={phaseColor(status?.foundation?.phase)}
                  label={status?.foundation?.phase ?? 'unknown'}
                  size="small"
                />
              </Box>
              <Box className={classes.row}>
                <AccountTreeIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">CPU Ray runtime</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    {status?.runtime?.message ?? 'CPU Ray status unavailable'}
                  </Typography>
                </Box>
                <Chip
                  color={phaseColor(status?.runtime?.phase)}
                  label={status?.runtime?.phase ?? 'unknown'}
                  size="small"
                />
              </Box>
              <Box className={classes.row}>
                <StorageIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">Pinned release input</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    {status?.release?.image ?? 'No release image reported'}
                  </Typography>
                  <Typography variant="body2" className={classes.muted}>
                    source {status?.release?.sourceCommit ?? 'not configured'}
                  </Typography>
                </Box>
              </Box>
              <Box className={classes.row}>
                <OpenInNewIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">Dagster observability</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    {status?.dagster?.message ?? 'Dagster is not configured'}
                  </Typography>
                </Box>
                <Chip
                  color={phaseColor(status?.dagster?.phase)}
                  label={status?.dagster?.phase ?? 'unknown'}
                  size="small"
                />
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={5}>
            <InfoCard title="Launch K12 Stage 1 CPU run" className={classes.card}>
              <Typography variant="body2" className={classes.muted}>
                固定 Job：{status?.execution?.jobName ?? 'cleanjopbstage1_10'}；
                固定 Profile：{status?.execution?.profileName ?? 'k12-stage1-clean-v1'}。
                仅允许批准的 10 文档 manifest，输出限制在平台 smoke prefix。
              </Typography>
              <Box className={classes.form} mt={2}>
                <TextField
                  label="Request name"
                  size="small"
                  value={requestName}
                  onChange={event => setRequestName(event.target.value)}
                />
                <TextField
                  label="Selection manifest reference"
                  size="small"
                  value={manifestRef}
                  onChange={event => setManifestRef(event.target.value)}
                />
                <Button
                  color="primary"
                  disabled={!requestAvailable}
                  onClick={() => void requestCpuRun()}
                  startIcon={<PlayArrowIcon />}
                  variant="contained"
                >
                  Launch controlled K12 CPU run
                </Button>
                {!requestAvailable && (
                  <Typography variant="caption" className={classes.muted}>
                    K12 Dagster、CPU Ray runtime 和 Dagster API 必须全部 Ready。
                  </Typography>
                )}
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12}>
            <InfoCard title="Recent Dagster runs" className={classes.card}>
              {!dagsterReady ? (
                <Typography className={classes.muted}>
                  K12 Dagster 尚未就绪，因此不会读取运行记录。
                </Typography>
              ) : runs.length === 0 ? (
                <Typography className={classes.muted}>No runs returned.</Typography>
              ) : (
                runs.map(run => (
                  <Box className={classes.run} key={run.runId}>
                    <Box>
                      <Typography variant="subtitle2">{run.pipelineName ?? 'Dagster run'}</Typography>
                      <Typography variant="body2" className={classes.muted}>
                        {run.runId} · started {displayTime(run.startTime)} · ended {displayTime(run.endTime)}
                      </Typography>
                    </Box>
                    <Chip label={run.status ?? 'unknown'} size="small" />
                  </Box>
                ))
              )}
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

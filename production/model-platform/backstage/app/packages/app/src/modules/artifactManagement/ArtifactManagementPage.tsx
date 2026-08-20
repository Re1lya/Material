import {
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@material-ui/core';
import AddCircleOutlineIcon from '@material-ui/icons/AddCircleOutline';
import AutorenewIcon from '@material-ui/icons/Autorenew';
import LockIcon from '@material-ui/icons/Lock';
import PublishIcon from '@material-ui/icons/Publish';
import VpnKeyIcon from '@material-ui/icons/VpnKey';
import {
  Content,
  ContentHeader,
  InfoCard,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useCallback, useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';

type Repository = {
  key?: string;
  name?: string;
  format?: string;
  repo_type?: string;
  quota_bytes?: number | null;
  size_bytes?: number | null;
  used_bytes?: number | null;
};

type PipelineRun = {
  name?: string;
  createdAt?: string;
  status?: {
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    startTime?: string;
    completionTime?: string;
  };
};

type ManagementResponse = {
  enabled?: boolean;
  tokenRevealAvailable?: boolean;
  allowedFormats?: string[];
  maxQuotaBytes?: number;
  repositories?: Repository[];
};

const useStyles = makeStyles(theme => ({
  content: { paddingBottom: theme.spacing(4) },
  notice: {
    borderLeft: `4px solid ${theme.palette.info.main}`,
    padding: theme.spacing(1.5),
  },
  card: { height: '100%' },
  form: { display: 'grid', gap: theme.spacing(1.5) },
  muted: { color: theme.palette.text.secondary },
  code: {
    background: theme.palette.background.default,
    display: 'block',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    overflowX: 'auto',
    padding: theme.spacing(1),
    wordBreak: 'break-all',
  },
  run: {
    alignItems: 'center',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'space-between',
    padding: theme.spacing(1, 0),
  },
}));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/artifact-management${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep the HTTP status when the backend did not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 'B';
  for (const candidate of units) {
    size /= 1024;
    unit = candidate;
    if (size < 1024) break;
  }
  return `${size.toFixed(1)} ${unit}`;
}

function runState(run: PipelineRun): string {
  const condition = run.status?.conditions?.find(item => item.type === 'Succeeded');
  if (!condition) return 'Running';
  if (condition.status === 'True') return 'Succeeded';
  if (condition.status === 'False') return `Failed${condition.reason ? ` (${condition.reason})` : ''}`;
  return 'Running';
}

export const ArtifactManagementPage = () => {
  const classes = useStyles();
  const [management, setManagement] = useState<ManagementResponse>();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState('');
  const [repositoryKey, setRepositoryKey] = useState('platform-demo');
  const [repositoryName, setRepositoryName] = useState('Platform demo artifacts');
  const [repositoryFormat, setRepositoryFormat] = useState('generic');
  const [repositoryQuota, setRepositoryQuota] = useState('10737418240');
  const [tokenRepository, setTokenRepository] = useState('');
  const [tokenName, setTokenName] = useState('backstage-ci');
  const [tokenPermission, setTokenPermission] = useState('read');
  const [tokenTtl, setTokenTtl] = useState('30');
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [publishRepository, setPublishRepository] = useState('model-artifacts');
  const [artifactPath, setArtifactPath] = useState('model/file.bin');
  const [sourceRef, setSourceRef] = useState('staging://approved/source/file.bin');
  const [checksum, setChecksum] = useState('');
  const [totalSize, setTotalSize] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const repositoryResponse = await api<ManagementResponse>('/repositories');
      setManagement(repositoryResponse);
      setRepositories(repositoryResponse.repositories ?? []);
      setTokenRepository(repositoryResponse.repositories?.[0]?.key ?? '');
      try {
        const runResponse = await api<{ items?: PipelineRun[] }>('/publish-runs');
        setRuns(runResponse.items ?? []);
      } catch {
        // The dedicated artifact-publish namespace is an opt-in rollout gate;
        // keep the management page usable while its status API is unavailable.
        setRuns([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Artifact management request failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function createRepository() {
    setMessage('');
    try {
      await api('/repositories', {
        method: 'POST',
        body: JSON.stringify({
          key: repositoryKey,
          name: repositoryName,
          format: repositoryFormat,
          quotaBytes: repositoryQuota ? Number(repositoryQuota) : undefined,
        }),
      });
      setMessage(`Repository ${repositoryKey} created.`);
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Repository creation failed');
    }
  }

  async function createToken() {
    setMessage('');
    setOneTimeToken('');
    try {
      const result = await api<{ token?: string }>('/tokens', {
        method: 'POST',
        body: JSON.stringify({
          repositoryKey: tokenRepository,
          name: tokenName,
          permission: tokenPermission,
          ttlDays: Number(tokenTtl),
        }),
      });
      setOneTimeToken(result.token ?? '');
      setMessage('Token created. Copy it now; it will not be shown again.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Token creation failed');
    }
  }

  async function startPublish() {
    setMessage('');
    try {
      await api('/publish-runs', {
        method: 'POST',
        body: JSON.stringify({
          repositoryKey: publishRepository,
          artifactPath,
          sourceRef,
          checksumSha256: checksum,
          totalSize: Number(totalSize),
          idempotencyKey,
        }),
      });
      setMessage('Tekton artifact publish accepted. Refreshing status shortly.');
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Tekton publish request failed');
    }
  }

  if (loading && !management) return <Progress />;
  if (error && !management) return <ResponseErrorPanel error={error} />;

  return (
    <Page themeId="tool">
      <ContentHeader title="Artifact & CI management">
        <Chip
          color="secondary"
          icon={<LockIcon />}
          label="Restricted MVP · no browser file upload"
          variant="outlined"
        />
        <Button startIcon={<AutorenewIcon />} onClick={() => void load()}>
          Refresh
        </Button>
      </ContentHeader>
      <Content className={classes.content}>
        <Paper className={classes.notice} elevation={0} role="note">
          <Typography variant="body2">
            Backstage 只提交仓库、Token 和发布任务元数据。大文件由受控 staging 源和
            Tekton 分片上传到 Artifact Keeper；页面不会把模型文件代理经过浏览器，也不会
            直接创建 Kubernetes、Ray 或 NPU 工作负载。
          </Typography>
          {message && <Typography variant="body2">{message}</Typography>}
        </Paper>

        <Grid container spacing={2} style={{ marginTop: 16 }}>
          <Grid item xs={12} md={6}>
            <InfoCard title="Artifact Keeper repositories" className={classes.card}>
              {repositories.length === 0 ? (
                <Typography className={classes.muted}>No repositories returned or management is disabled.</Typography>
              ) : (
                repositories.map(repository => (
                  <Box className={classes.run} key={repository.key}>
                    <Box>
                      <Typography variant="subtitle2">{repository.key}</Typography>
                      <Typography variant="body2" className={classes.muted}>
                        {repository.format} · {repository.repo_type ?? 'local'} · used {formatBytes(repository.used_bytes ?? repository.size_bytes)}
                      </Typography>
                    </Box>
                    <Chip label={formatBytes(repository.quota_bytes)} size="small" />
                  </Box>
                ))
              )}
              <Box className={classes.form} mt={2}>
                <Typography variant="subtitle2">Create allow-listed local repository</Typography>
                <TextField label="Key" value={repositoryKey} onChange={event => setRepositoryKey(event.target.value)} size="small" />
                <TextField label="Name" value={repositoryName} onChange={event => setRepositoryName(event.target.value)} size="small" />
                <Select value={repositoryFormat} onChange={event => setRepositoryFormat(String(event.target.value))} variant="outlined" fullWidth>
                  {(management?.allowedFormats ?? ['generic', 'huggingface', 'docker']).map(format => <MenuItem value={format} key={format}>{format}</MenuItem>)}
                </Select>
                <TextField label="Quota bytes (optional)" value={repositoryQuota} onChange={event => setRepositoryQuota(event.target.value)} size="small" />
                <Button variant="contained" color="primary" startIcon={<AddCircleOutlineIcon />} onClick={() => void createRepository()} disabled={!management?.enabled}>
                  Create repository
                </Button>
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <InfoCard title="Repository-scoped Token" className={classes.card}>
              <Typography variant="body2" className={classes.muted}>
                只允许 read 或 read+write，自动绑定一个仓库，最多 {management?.maxQuotaBytes ? `${Math.round((management.maxQuotaBytes / 1024 ** 3) * 10) / 10} GiB quota` : 'configured quota'}；delete、admin、通配仓库均不可创建。
              </Typography>
              <Box className={classes.form} mt={2}>
                <TextField label="Repository key" value={tokenRepository} onChange={event => setTokenRepository(event.target.value)} size="small" />
                <TextField label="Token name" value={tokenName} onChange={event => setTokenName(event.target.value)} size="small" />
                <Select value={tokenPermission} onChange={event => setTokenPermission(String(event.target.value))} variant="outlined" fullWidth>
                  <MenuItem value="read">read</MenuItem>
                  <MenuItem value="write">read + write</MenuItem>
                </Select>
                <TextField label="TTL days" value={tokenTtl} onChange={event => setTokenTtl(event.target.value)} size="small" />
                <Button variant="contained" color="primary" startIcon={<VpnKeyIcon />} onClick={() => void createToken()} disabled={!management?.enabled || !management?.tokenRevealAvailable}>
                  Create one-time Token
                </Button>
                {!management?.enabled && <Typography variant="caption" className={classes.muted}>Management is not enabled in the backend config.</Typography>}
                {management?.enabled && !management.tokenRevealAvailable && <Typography variant="caption" className={classes.muted}>One-time Token reveal remains disabled until stable HTTPS and an explicit production policy are enabled.</Typography>}
                {oneTimeToken && <Paper className={classes.code} elevation={0}>{oneTimeToken}</Paper>}
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12}>
            <InfoCard title="Tekton artifact publish" className={classes.card}>
              <Typography variant="body2" className={classes.muted}>
                sourceRef 必须是受控的 <code>staging://</code> 引用；Pipeline 会校验大小和 SHA256，创建 Artifact Keeper 上传会话，分片上传并完成校验。
              </Typography>
              <Grid container spacing={1} style={{ marginTop: 8 }}>
                <Grid item xs={12} md={4}><TextField fullWidth label="Repository key" value={publishRepository} onChange={event => setPublishRepository(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={8}><TextField fullWidth label="Artifact path" value={artifactPath} onChange={event => setArtifactPath(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={4}><TextField fullWidth label="Source ref" value={sourceRef} onChange={event => setSourceRef(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={4}><TextField fullWidth label="Total bytes" value={totalSize} onChange={event => setTotalSize(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={4}><TextField fullWidth label="SHA256" value={checksum} onChange={event => setChecksum(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={8}><TextField fullWidth label="Idempotency key" value={idempotencyKey} onChange={event => setIdempotencyKey(event.target.value)} size="small" /></Grid>
                <Grid item xs={12} md={4}><Button fullWidth variant="contained" color="primary" startIcon={<PublishIcon />} onClick={() => void startPublish()} disabled={!management?.enabled}>Start publish PipelineRun</Button></Grid>
              </Grid>
              <Box mt={3}>
                <Typography variant="subtitle2">Recent PipelineRuns</Typography>
                {runs.length === 0 ? <Typography variant="body2" className={classes.muted}>No artifact publish runs found.</Typography> : runs.map(run => <Box className={classes.run} key={run.name}><Typography variant="body2">{run.name}</Typography><Chip label={runState(run)} size="small" color={runState(run) === 'Succeeded' ? 'primary' : 'default'} /></Box>)}
              </Box>
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

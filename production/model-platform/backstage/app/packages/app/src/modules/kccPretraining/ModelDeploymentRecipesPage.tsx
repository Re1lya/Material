import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  InputAdornment,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import SearchIcon from '@material-ui/icons/Search';
import StopIcon from '@material-ui/icons/Stop';
import { Content, Page } from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';

type RuntimeVariant = {
  id: string;
  title: string;
  hardware: string;
  node: string;
  accelerator: string;
  cardIds: string[];
  image: string;
  modelPath: string;
  modelName: string;
  healthPath: string;
  inferencePath: string;
  npuPerWorker: number;
  workerReplicas: number;
  serving?: {
    tensorParallelSize?: number;
    dataParallelSize?: number;
    pipelineParallelSize?: number;
    maxModelLen?: number;
    maxNumSeqs?: number;
    maxNumBatchedTokens?: number;
    gpuMemoryUtilization?: number;
    prefixCaching?: boolean;
    mtpTokens?: number;
    compilationMode?: string;
    maxOngoingRequests?: number;
  };
};

type ModelRecipe = {
  id: string;
  title: string;
  provider: string;
  description: string;
  modelId: string;
  revision: string;
  repository: string;
  artifactPath: string;
  fileCount: number;
  sizeBytes: number;
  format: string;
  quantization: string;
  manifestDigest: string;
  variants: RuntimeVariant[];
};

const modelCatalog: ModelRecipe[] = [
  {
    id: 'qwen3.8-27b-w8a8',
    title: 'Qwen3.8-27B W8A8',
    provider: 'Qwen',
    description:
      'Quantized 27B instruction model prepared for high-throughput Ray and vLLM inference on Ascend accelerators.',
    modelId: 'Qwen/Qwen3.8-27B',
    revision: 'e823e888ae179eb3be02c1a48899c4f828371376',
    repository: 'model-artifacts',
    artifactPath:
      'qwen3.8-27b/w8a8/e823e888ae179eb3be02c1a48899c4f828371376/msmodelslim-w8a8-a3-f2afa9e2',
    fileCount: 26,
    sizeBytes: 32152070926,
    format: 'Safetensors',
    quantization: 'W8A8',
    manifestDigest:
      'sha256:f2afa9e2f328d9efb78bc88d526413783304c4706a508f0da1db456aeac5c20f',
    variants: [
      {
        id: 'qwen38-w8a8-ray-ascend-910b3-v1',
        title: 'Ascend 910B3 · 8 NPU',
        hardware: 'Ascend 910B3',
        node: 'gpu-server-00',
        accelerator: '910B3',
        cardIds: [],
        image:
          '110.120.0.3:30670/container-images/vllm-ascend@sha256:a27a79c2021cdda071eb207c169a5dd44537d22df11ccd7b62b52de117ceac14',
        modelPath: '/models/Qwen3.8-27B-w8a8',
        modelName: 'qwen3.8-27b-w8a8',
        healthPath: '/health',
        inferencePath: '/v1/chat/completions',
        npuPerWorker: 8,
        workerReplicas: 0,
      },
      {
        id: 'qwen38-w8a8-ray-ascend-910b3-tp2-v1',
        title: 'Ascend 910B3 · 2 NPU',
        hardware: 'Ascend 910B3',
        node: 'gpu-server-00',
        accelerator: '910B3',
        cardIds: [],
        image:
          '110.120.0.3:30670/container-images/vllm-ascend@sha256:a27a79c2021cdda071eb207c169a5dd44537d22df11ccd7b62b52de117ceac14',
        modelPath: '/models/Qwen3.8-27B-w8a8',
        modelName: 'qwen3.8-27b-w8a8',
        healthPath: '/health',
        inferencePath: '/v1/chat/completions',
        npuPerWorker: 2,
        workerReplicas: 0,
        serving: {
          tensorParallelSize: 2,
          dataParallelSize: 1,
          pipelineParallelSize: 1,
          maxModelLen: 32768,
          maxNumSeqs: 64,
          maxNumBatchedTokens: 8192,
          gpuMemoryUtilization: 0.9,
          prefixCaching: true,
          mtpTokens: 3,
          compilationMode: 'FULL_DECODE_ONLY',
          maxOngoingRequests: 64,
        },
      },
    ],
  },
];

const useStyles = makeStyles(theme => ({
  content: {
    boxSizing: 'border-box',
    margin: 0,
    maxWidth: 'none',
    padding: theme.spacing(3, 4, 6),
    width: '100%',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2, 2, 5) },
  },
  topBar: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(2),
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2.5),
    [theme.breakpoints.down('sm')]: {
      alignItems: 'stretch',
      flexDirection: 'column',
    },
  },
  pageTitle: { fontWeight: 800, letterSpacing: '-0.035em' },
  intro: {
    color: theme.palette.text.secondary,
    lineHeight: 1.65,
    marginTop: theme.spacing(0.75),
    maxWidth: 820,
  },
  search: {
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    minWidth: 340,
    padding: theme.spacing(0.5, 1.5),
    [theme.breakpoints.down('sm')]: { minWidth: 0, width: '100%' },
  },
  sectionHeader: {
    alignItems: 'center',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.5),
    paddingBottom: theme.spacing(1),
  },
  sectionLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  modelCard: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 14,
    boxShadow: 'none',
    cursor: 'pointer',
    height: '100%',
    transition:
      'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
    '&:hover': {
      borderColor: theme.palette.primary.main,
      boxShadow: '0 10px 24px rgba(45, 82, 160, 0.10)',
      transform: 'translateY(-2px)',
    },
  },
  modelCardContent: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 210,
    padding: theme.spacing(2),
    '&:last-child': { paddingBottom: theme.spacing(2) },
  },
  modelHeader: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(1.25),
  },
  modelAvatar: {
    background: 'linear-gradient(145deg, #2267d8, #6759d8)',
    color: '#fff',
    fontSize: '0.85rem',
    fontWeight: 800,
    height: 34,
    width: 34,
  },
  modelName: { fontSize: '1rem', fontWeight: 800, lineHeight: 1.25 },
  provider: {
    color: theme.palette.text.secondary,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.72rem',
    marginTop: 2,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: theme.spacing(1.5),
  },
  compactChip: {
    background: '#fbfcfe',
    borderColor: '#dce3ee',
    color: '#53647d',
    height: 23,
    '& .MuiChip-label': {
      fontSize: '0.68rem',
      paddingLeft: 8,
      paddingRight: 8,
    },
  },
  description: {
    color: theme.palette.text.secondary,
    display: '-webkit-box',
    fontSize: '0.79rem',
    lineHeight: 1.55,
    marginTop: theme.spacing(2),
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
  },
  cardAction: {
    alignItems: 'center',
    color: theme.palette.primary.main,
    display: 'flex',
    fontSize: '0.78rem',
    fontWeight: 700,
    marginTop: 'auto',
    paddingTop: theme.spacing(1.5),
  },
  empty: {
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: 14,
    marginTop: theme.spacing(2),
    padding: theme.spacing(4),
    textAlign: 'center',
  },
  breadcrumbBar: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
  },
  detailHeader: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2.5),
  },
  detailAvatar: {
    background: 'linear-gradient(145deg, #2267d8, #6759d8)',
    color: '#fff',
    fontSize: '1.2rem',
    fontWeight: 800,
    height: 58,
    width: 58,
  },
  detailModelId: {
    color: theme.palette.text.secondary,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: 500,
  },
  detailDescription: {
    color: theme.palette.text.secondary,
    lineHeight: 1.55,
    marginTop: theme.spacing(0.5),
    maxWidth: 980,
  },
  deploymentPreview: {
    alignItems: 'center',
    background: '#f6f8fb',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 14,
    display: 'flex',
    gap: theme.spacing(2),
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
    padding: theme.spacing(2),
    [theme.breakpoints.down('sm')]: {
      alignItems: 'stretch',
      flexDirection: 'column',
    },
  },
  previewCode: {
    color: '#27344a',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    marginTop: 4,
  },
  deployButton: {
    borderRadius: 10,
    minWidth: 170,
    padding: theme.spacing(1.25, 2.5),
  },
  configPanel: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 14,
    overflow: 'hidden',
  },
  configRow: {
    alignItems: 'flex-start',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'grid',
    gap: theme.spacing(2),
    gridTemplateColumns: '150px minmax(0, 1fr)',
    padding: theme.spacing(1.75, 2),
    '&:last-child': { borderBottom: 0 },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1),
    },
  },
  configLabel: {
    color: '#50617a',
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.08em',
    paddingTop: 9,
    textTransform: 'uppercase',
  },
  optionGroup: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0.75) },
  option: {
    borderColor: '#d6deea',
    borderRadius: 10,
    color: '#53647d',
    fontSize: '0.76rem',
    minHeight: 34,
    minWidth: 0,
    padding: theme.spacing(0.6, 1.25),
    textTransform: 'none',
  },
  optionSelected: {
    background: '#edf5ff',
    borderColor: '#1787ff',
    boxShadow: '0 0 0 1px rgba(23, 135, 255, 0.18)',
    color: '#0b63c5',
    fontWeight: 700,
  },
  optionHelp: {
    color: theme.palette.text.secondary,
    fontSize: '0.73rem',
    marginTop: 7,
  },
  sidePanel: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 14,
    padding: theme.spacing(2),
    position: 'sticky',
    top: theme.spacing(2),
  },
  summaryRow: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'space-between',
    padding: theme.spacing(1.15, 0),
  },
  summaryLabel: { color: theme.palette.text.secondary, fontSize: '0.78rem' },
  summaryValue: {
    fontSize: '0.8rem',
    fontWeight: 700,
    maxWidth: '65%',
    overflowWrap: 'anywhere',
    textAlign: 'right',
  },
  field: { marginTop: theme.spacing(1.5) },
  error: { color: theme.palette.error.main, display: 'block', marginTop: 6 },
}));

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 18)}...${digest.slice(-8)}`;
}

type ChoiceProps<T extends string | number | boolean> = {
  label: string;
  value: T;
  selected: T;
  onSelect: (value: T) => void;
  classes: ReturnType<typeof useStyles>;
};

function Choice<T extends string | number | boolean>({
  label,
  value,
  selected,
  onSelect,
  classes,
}: ChoiceProps<T>) {
  return (
    <Button
      className={`${classes.option} ${
        selected === value ? classes.optionSelected : ''
      }`}
      onClick={() => onSelect(value)}
      variant="outlined"
    >
      {label}
    </Button>
  );
}

type LiveDeployment = {
  name?: string;
  desiredState?: string;
  modelVersionRef?: string;
  runtimeProfileRef?: string;
  phase?: string;
};

type LiveDeploymentResponse = {
  observedAt: string;
  deployments: LiveDeployment[];
  resources: Record<string, unknown[]>;
};

export const ModelDeploymentRecipesPage = () => {
  const classes = useStyles();
  const [catalog, setCatalog] = useState<ModelRecipe[]>(modelCatalog);
  const [liveStatus, setLiveStatus] = useState<LiveDeploymentResponse>();
  const [query, setQuery] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [selectedVariantId, setSelectedVariantId] = useState(
    'qwen38-w8a8-ray-ascend-910b3-tp2-v1',
  );
  const [deploymentName, setDeploymentName] = useState('qwen38-27b');
  const [replicas, setReplicas] = useState(1);
  const [tensorParallelSize, setTensorParallelSize] = useState(2);
  const [dataParallelSize, setDataParallelSize] = useState(1);
  const [pipelineParallelSize, setPipelineParallelSize] = useState(1);
  const [maxModelLen, setMaxModelLen] = useState(32768);
  const [maxNumSeqs, setMaxNumSeqs] = useState(64);
  const [maxNumBatchedTokens, setMaxNumBatchedTokens] = useState(8192);
  const [memoryUtilization, setMemoryUtilization] = useState(0.9);
  const [prefixCaching, setPrefixCaching] = useState(true);
  const [mtpTokens, setMtpTokens] = useState(3);
  const [maxOngoingRequests, setMaxOngoingRequests] = useState(64);
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [visibility, setVisibility] = useState<'internal' | 'private'>(
    'internal',
  );

  useEffect(() => {
    let mounted = true;
    if (typeof fetch !== 'function')
      return () => {
        mounted = false;
      };
    fetch('/api/model-platform/catalog')
      .then(response => {
        if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
        return response.json() as Promise<{ models?: ModelRecipe[] }>;
      })
      .then(payload => {
        if (mounted && payload.models?.length) setCatalog(payload.models);
      })
      .catch(() => undefined);
    fetch('/api/model-platform/deployments')
      .then(response => {
        if (!response.ok) throw new Error(`status HTTP ${response.status}`);
        return response.json() as Promise<LiveDeploymentResponse>;
      })
      .then(payload => {
        if (mounted) setLiveStatus(payload);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const selectedModel = catalog.find(model => model.id === selectedModelId);
  const selectedVariant = selectedModel?.variants.find(
    variant => variant.id === selectedVariantId,
  );
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return catalog;
    return catalog.filter(model =>
      [
        model.title,
        model.provider,
        model.modelId,
        model.quantization,
        model.format,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [catalog, query]);

  const applyVariant = (variant: RuntimeVariant) => {
    setSelectedVariantId(variant.id);
    setTensorParallelSize(
      variant.serving?.tensorParallelSize ?? Math.max(variant.npuPerWorker, 1),
    );
    setDataParallelSize(variant.serving?.dataParallelSize ?? 1);
    setPipelineParallelSize(variant.serving?.pipelineParallelSize ?? 1);
    setMaxModelLen(variant.serving?.maxModelLen ?? 32768);
    setMaxNumSeqs(variant.serving?.maxNumSeqs ?? 64);
    setMaxNumBatchedTokens(variant.serving?.maxNumBatchedTokens ?? 8192);
    setMemoryUtilization(variant.serving?.gpuMemoryUtilization ?? 0.9);
    setPrefixCaching(variant.serving?.prefixCaching ?? true);
    setMtpTokens(variant.serving?.mtpTokens ?? 0);
    setMaxOngoingRequests(
      variant.serving?.maxOngoingRequests ?? variant.serving?.maxNumSeqs ?? 64,
    );
  };

  const openModel = (model: ModelRecipe) => {
    const preferred =
      model.variants.find(variant => variant.serving) ?? model.variants[0];
    setSelectedModelId(model.id);
    applyVariant(preferred);
  };

  if (!selectedModel || !selectedVariant) {
    return (
      <Page themeId="tool">
        <Content className={classes.content}>
          <Box className={classes.topBar}>
            <Box>
              <Typography className={classes.pageTitle} variant="h3">
                Model recipes
              </Typography>
              <Typography className={classes.intro} variant="body1">
                Choose a model, select the resources it needs, and configure the
                inference profile for your service.
              </Typography>
            </Box>
            <Paper className={classes.search} elevation={0}>
              <TextField
                fullWidth
                onChange={event => setQuery(event.target.value)}
                placeholder="Search models or providers..."
                value={query}
                InputProps={{
                  disableUnderline: true,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
            </Paper>
          </Box>
          <Box className={classes.sectionHeader}>
            <Typography className={classes.sectionLabel}>
              Available models
            </Typography>
            <Typography color="textSecondary" variant="caption">
              {filteredModels.length} model
              {filteredModels.length === 1 ? '' : 's'}
            </Typography>
          </Box>
          <Grid container spacing={2}>
            {filteredModels.map(model => (
              <Grid item key={model.id} xs={12} sm={6} md={4} xl={3}>
                <Card
                  className={classes.modelCard}
                  elevation={0}
                  onClick={() => openModel(model)}
                >
                  <CardContent className={classes.modelCardContent}>
                    <Box className={classes.modelHeader}>
                      <Avatar className={classes.modelAvatar}>
                        {model.provider.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography className={classes.modelName}>
                          {model.title}
                        </Typography>
                        <Typography className={classes.provider}>
                          {model.provider}
                        </Typography>
                      </Box>
                    </Box>
                    <Box className={classes.tagRow}>
                      {[
                        formatSize(model.sizeBytes),
                        model.quantization,
                        model.format,
                        `${model.variants.length} profiles`,
                      ].map(tag => (
                        <Chip
                          className={classes.compactChip}
                          key={tag}
                          label={tag}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Box>
                    <Typography className={classes.description}>
                      {model.description}
                    </Typography>
                    <Box className={classes.cardAction}>
                      Configure model <ChevronRightIcon fontSize="small" />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          {filteredModels.length === 0 && (
            <Paper className={classes.empty} elevation={0}>
              <Typography>No models match this search.</Typography>
            </Paper>
          )}
        </Content>
      </Page>
    );
  }

  const validDeploymentName = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(
    deploymentName,
  );
  const requestFormData = encodeURIComponent(
    JSON.stringify({
      deploymentName,
      projectRef: 'model-serving',
      modelVersionRef: selectedModel.id,
      runtimeProfileRef: selectedVariant.id,
      visibility,
      requestedTensorParallelSize: tensorParallelSize,
      requestedDataParallelSize: dataParallelSize,
      requestedPipelineParallelSize: pipelineParallelSize,
      requestedReplicas: replicas,
      requestedMaxModelLen: maxModelLen,
      requestedMaxNumSeqs: maxNumSeqs,
      requestedMaxNumBatchedTokens: maxNumBatchedTokens,
      requestedGpuMemoryUtilization: memoryUtilization,
      requestedPrefixCaching: prefixCaching,
      requestedMtpTokens: mtpTokens,
      requestedMaxOngoingRequests: maxOngoingRequests,
      priority,
    }),
  );
  const requestHref = `/create/templates/default/request-model-deployment?formData=${requestFormData}`;
  const liveDeployment =
    liveStatus?.deployments.find(
      deployment => deployment.name === deploymentName,
    ) ??
    liveStatus?.deployments.find(
      deployment => deployment.modelVersionRef === selectedModel.id,
    );
  const lifecycleDeploymentName = liveDeployment?.name ?? deploymentName;
  const startFormData = encodeURIComponent(
    JSON.stringify({
      deploymentName: lifecycleDeploymentName,
      startReason: 'Started from the model recipes page',
    }),
  );
  const stopFormData = encodeURIComponent(
    JSON.stringify({
      deploymentName: lifecycleDeploymentName,
      stopReason: 'Stopped from the model recipes page',
    }),
  );
  let lifecycleAction;
  if (liveDeployment?.desiredState === 'Stopped') {
    lifecycleAction = {
      color: 'primary' as const,
      href: `/create/templates/default/start-model-inference?formData=${startFormData}`,
      icon: <PlayArrowIcon />,
      label: 'Start inference',
    };
  } else if (liveDeployment?.desiredState === 'Running') {
    lifecycleAction = {
      color: 'secondary' as const,
      href: `/create/templates/default/stop-model-inference?formData=${stopFormData}`,
      icon: <StopIcon />,
      label: 'Stop inference',
    };
  }
  const totalNpu = selectedVariant.npuPerWorker * replicas;
  const tpChoices = [1, 2, 4, 8].filter(
    value => value * pipelineParallelSize <= selectedVariant.npuPerWorker,
  );
  const ppChoices = [1, 2].filter(
    value => value * tensorParallelSize <= selectedVariant.npuPerWorker,
  );
  const dpChoices = [1, 2, 4].filter(value => value <= replicas);

  const row = (label: string, content: JSX.Element, help?: string) => (
    <Box className={classes.configRow}>
      <Typography className={classes.configLabel}>{label}</Typography>
      <Box>
        {content}
        {help && <Typography className={classes.optionHelp}>{help}</Typography>}
      </Box>
    </Box>
  );

  return (
    <Page themeId="tool">
      <Content className={classes.content}>
        <Box className={classes.breadcrumbBar}>
          <Breadcrumbs aria-label="breadcrumb">
            <Button
              onClick={() => setSelectedModelId(undefined)}
              startIcon={<ArrowBackIcon />}
            >
              Models
            </Button>
            <Typography color="textPrimary">{selectedModel.title}</Typography>
          </Breadcrumbs>
          {liveDeployment && (
            <Chip
              label={
                liveDeployment.desiredState ?? liveDeployment.phase ?? 'Created'
              }
              size="small"
            />
          )}
        </Box>
        <Box className={classes.detailHeader}>
          <Avatar className={classes.detailAvatar}>
            {selectedModel.provider.slice(0, 1).toUpperCase()}
          </Avatar>
          <Box>
            <Typography className={classes.pageTitle} variant="h3">
              <span className={classes.detailModelId}>
                {selectedModel.provider}/
              </span>
              {selectedModel.title}
            </Typography>
            <Typography className={classes.detailDescription}>
              {selectedModel.description}
            </Typography>
            <Box className={classes.tagRow}>
              {[
                selectedModel.quantization,
                selectedModel.format,
                formatSize(selectedModel.sizeBytes),
                `${selectedModel.fileCount} files`,
                'Ray + vLLM',
              ].map(tag => (
                <Chip key={tag} label={tag} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        </Box>

        <Paper className={classes.deploymentPreview} elevation={0}>
          <Box>
            <Typography variant="subtitle2">Deployment preview</Typography>
            <Typography className={classes.previewCode}>
              {selectedVariant.title} · {replicas} replica
              {replicas === 1 ? '' : 's'} · {totalNpu} NPU · TP{' '}
              {tensorParallelSize} · {maxModelLen.toLocaleString()} context
            </Typography>
          </Box>
          <Button
            className={classes.deployButton}
            color={lifecycleAction?.color ?? 'primary'}
            component="a"
            disabled={!validDeploymentName}
            href={lifecycleAction?.href ?? requestHref}
            startIcon={lifecycleAction?.icon ?? <PlayArrowIcon />}
            variant="contained"
          >
            {lifecycleAction?.label ?? 'Deploy model'}
          </Button>
        </Paper>

        <Grid container spacing={2}>
          <Grid item xs={12} lg={9}>
            <Paper className={classes.configPanel} elevation={0}>
              {row(
                'Hardware',
                <Box className={classes.optionGroup}>
                  {selectedModel.variants.map(variant => (
                    <Choice
                      classes={classes}
                      key={variant.id}
                      label={variant.title}
                      onSelect={() => applyVariant(variant)}
                      selected={selectedVariant.id}
                      value={variant.id}
                    />
                  ))}
                </Box>,
                'Select the accelerator profile and NPU count per replica.',
              )}
              {row(
                'Replicas',
                <Box className={classes.optionGroup}>
                  {[1, 2, 4].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${value} replica${value === 1 ? '' : 's'}`}
                      onSelect={nextReplicas => {
                        setReplicas(nextReplicas);
                        if (dataParallelSize > nextReplicas) {
                          setDataParallelSize(nextReplicas);
                        }
                      }}
                      selected={replicas}
                      value={value}
                    />
                  ))}
                </Box>,
                `Total requested capacity: ${totalNpu} NPU.`,
              )}
              {row(
                'Parallel strategy',
                <Box className={classes.optionGroup}>
                  {tpChoices.map(value => (
                    <Choice
                      classes={classes}
                      key={`tp-${value}`}
                      label={`Tensor parallel · TP ${value}`}
                      onSelect={setTensorParallelSize}
                      selected={tensorParallelSize}
                      value={value}
                    />
                  ))}
                  {ppChoices.map(value => (
                    <Choice
                      classes={classes}
                      key={`pp-${value}`}
                      label={`Pipeline · PP ${value}`}
                      onSelect={setPipelineParallelSize}
                      selected={pipelineParallelSize}
                      value={value}
                    />
                  ))}
                  {dpChoices.map(value => (
                    <Choice
                      classes={classes}
                      key={`dp-${value}`}
                      label={`Data parallel · DP ${value}`}
                      onSelect={setDataParallelSize}
                      selected={dataParallelSize}
                      value={value}
                    />
                  ))}
                </Box>,
                'Tensor parallel splits each model replica across local NPUs.',
              )}
              {row(
                'Context length',
                <Box className={classes.optionGroup}>
                  {[8192, 16384, 32768].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${value / 1024}K tokens`}
                      onSelect={setMaxModelLen}
                      selected={maxModelLen}
                      value={value}
                    />
                  ))}
                </Box>,
              )}
              {row(
                'Concurrency',
                <Box className={classes.optionGroup}>
                  {[16, 32, 64].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${value} sequences`}
                      onSelect={setMaxNumSeqs}
                      selected={maxNumSeqs}
                      value={value}
                    />
                  ))}
                </Box>,
                'Higher concurrency improves throughput and uses more memory.',
              )}
              {row(
                'Batch tokens',
                <Box className={classes.optionGroup}>
                  {[2048, 4096, 8192].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={value.toLocaleString()}
                      onSelect={setMaxNumBatchedTokens}
                      selected={maxNumBatchedTokens}
                      value={value}
                    />
                  ))}
                </Box>,
              )}
              {row(
                'Memory target',
                <Box className={classes.optionGroup}>
                  {[0.8, 0.85, 0.9].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${Math.round(value * 100)}%`}
                      onSelect={setMemoryUtilization}
                      selected={memoryUtilization}
                      value={value}
                    />
                  ))}
                </Box>,
              )}
              {row(
                'Features',
                <Box className={classes.optionGroup}>
                  <Choice
                    classes={classes}
                    label="Prefix caching on"
                    onSelect={setPrefixCaching}
                    selected={prefixCaching}
                    value
                  />
                  <Choice
                    classes={classes}
                    label="Prefix caching off"
                    onSelect={setPrefixCaching}
                    selected={prefixCaching}
                    value={false}
                  />
                  {[0, 1, 3].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={value === 0 ? 'MTP off' : `MTP ${value}`}
                      onSelect={setMtpTokens}
                      selected={mtpTokens}
                      value={value}
                    />
                  ))}
                </Box>,
              )}
              {row(
                'Max ongoing requests',
                <Box className={classes.optionGroup}>
                  {[16, 32, 64].map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${value} requests`}
                      onSelect={setMaxOngoingRequests}
                      selected={maxOngoingRequests}
                      value={value}
                    />
                  ))}
                </Box>,
                'A bounded queue limit passed to Ray Serve with the same structured contract.',
              )}
              {row(
                'Service',
                <Box className={classes.optionGroup}>
                  {(['internal', 'private'] as const).map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={
                        value === 'internal'
                          ? 'Internal endpoint'
                          : 'Private endpoint'
                      }
                      onSelect={setVisibility}
                      selected={visibility}
                      value={value}
                    />
                  ))}
                  {(['low', 'normal', 'high'] as const).map(value => (
                    <Choice
                      classes={classes}
                      key={value}
                      label={`${value[0].toUpperCase()}${value.slice(
                        1,
                      )} priority`}
                      onSelect={setPriority}
                      selected={priority}
                      value={value}
                    />
                  ))}
                </Box>,
              )}
            </Paper>
          </Grid>

          <Grid item xs={12} lg={3}>
            <Paper className={classes.sidePanel} elevation={0}>
              <Typography variant="h6">Deployment</Typography>
              <TextField
                className={classes.field}
                error={!validDeploymentName}
                fullWidth
                helperText={
                  validDeploymentName
                    ? 'Used as the service name'
                    : 'Use lowercase letters, numbers, and hyphens'
                }
                label="Name"
                onChange={event => setDeploymentName(event.target.value)}
                value={deploymentName}
                variant="outlined"
              />
              <Box mt={1.5}>
                {[
                  ['Model', selectedModel.title],
                  ['Hardware', selectedVariant.title],
                  [
                    'Capacity',
                    `${replicas} × ${selectedVariant.npuPerWorker} NPU`,
                  ],
                  [
                    'Parallelism',
                    `TP ${tensorParallelSize} / PP ${pipelineParallelSize}`,
                  ],
                  ['Artifact', selectedModel.repository],
                ].map(([label, value]) => (
                  <Box key={label}>
                    <Divider />
                    <Box className={classes.summaryRow}>
                      <Typography className={classes.summaryLabel}>
                        {label}
                      </Typography>
                      <Typography className={classes.summaryValue}>
                        {value}
                      </Typography>
                    </Box>
                  </Box>
                ))}
                <Divider />
                <Box className={classes.summaryRow}>
                  <Typography className={classes.summaryLabel}>
                    Manifest
                  </Typography>
                  <Tooltip title={selectedModel.manifestDigest}>
                    <Typography className={classes.summaryValue}>
                      {shortDigest(selectedModel.manifestDigest)}
                    </Typography>
                  </Tooltip>
                </Box>
              </Box>
              <Button
                className={classes.field}
                color={lifecycleAction?.color ?? 'primary'}
                component="a"
                disabled={!validDeploymentName}
                fullWidth
                href={lifecycleAction?.href ?? requestHref}
                startIcon={lifecycleAction?.icon ?? <PlayArrowIcon />}
                variant="contained"
              >
                {lifecycleAction?.label ?? 'Deploy model'}
              </Button>
              {!validDeploymentName && (
                <Typography className={classes.error} variant="caption">
                  Enter a valid deployment name to continue.
                </Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

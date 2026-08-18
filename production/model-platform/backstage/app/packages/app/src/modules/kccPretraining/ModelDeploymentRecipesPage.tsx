import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import CloudDoneIcon from '@material-ui/icons/CloudDone';
import CodeIcon from '@material-ui/icons/Code';
import DeveloperBoardIcon from '@material-ui/icons/DeveloperBoard';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import MemoryIcon from '@material-ui/icons/Memory';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import SearchIcon from '@material-ui/icons/Search';
import StorageIcon from '@material-ui/icons/Storage';
import VerifiedUserIcon from '@material-ui/icons/VerifiedUser';
import {
  Content,
  ContentHeader,
  InfoCard,
  Page,
} from '@backstage/core-components';
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
    id: 'qwen3.6-27b-w8a8-20260806',
    title: 'Qwen3.6-27B W8A8',
    provider: 'Qwen',
    description:
      'Verified internal artifact for Ascend A3 serving. The catalog snapshot contains the full 24-file safetensors model.',
    modelId: 'platform-team/qwen3.6-27b-w8a8',
    revision: '20260806.1',
    repository: 'model-artifacts',
    artifactPath: 'Qwen3.6-27B-w8a8',
    fileCount: 24,
    sizeBytes: 36446991473,
    format: 'Hugging Face / safetensors',
    quantization: 'W8A8',
    manifestDigest:
      'sha256:9ecf94c8084062b613ca8eb4e76074c29fabc51644682e3d8708edc9737ea610',
    variants: [
      {
        id: 'qwen36-w8a8-ascend-a3-v1',
        title: 'W8A8 / ServingROM P-D / Ascend A3',
        hardware: 'Ascend A3',
        node: 'a3-server-00',
        accelerator: 'Ascend910',
        cardIds: ['10', '11', '12', '13', '14', '15'],
        image:
          '110.120.0.3:8889/infra/qwen36-pd-worker@sha256:0c9a4668e0c15f862fee733ab5c5b721e8f88985dd9cfa6f33404b976b15eadb',
        modelPath: '/models/Qwen3.6-27B-w8a8',
        modelName: 'qwen36-27b-w8a8',
        healthPath: '/healthcheck',
        inferencePath: '/v1/chat/completions',
      },
    ],
  },
];

const useStyles = makeStyles(theme => ({
  content: {
    paddingBottom: theme.spacing(4),
  },
  hero: {
    background: 'linear-gradient(120deg, #102a43 0%, #164e63 100%)',
    borderRadius: theme.shape.borderRadius,
    color: '#f7fbff',
    padding: theme.spacing(3),
  },
  heroTitle: {
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  heroCopy: {
    color: '#c6d9e5',
    maxWidth: 760,
  },
  heroActions: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  heroButton: {
    color: '#f7fbff',
    borderColor: '#9fd3de',
  },
  stat: {
    height: '100%',
    padding: theme.spacing(2),
  },
  statLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: '1.7rem',
    fontWeight: 700,
    lineHeight: 1.2,
    marginTop: theme.spacing(0.5),
  },
  sectionHeader: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    margin: theme.spacing(3, 0, 1.5),
  },
  modelCard: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  modelCardTop: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(1.5),
  },
  modelAvatar: {
    background: '#153e75',
    color: '#d6edff',
    fontWeight: 700,
  },
  modelTitle: {
    fontWeight: 700,
  },
  modelDescription: {
    color: theme.palette.text.secondary,
    minHeight: 66,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(1.5),
  },
  modelMeta: {
    borderTop: `1px solid ${theme.palette.divider}`,
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    marginTop: theme.spacing(2),
    paddingTop: theme.spacing(1.5),
  },
  metaValue: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  openRecipe: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: theme.spacing(2),
  },
  detailHero: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(2),
  },
  detailAvatar: {
    background: '#153e75',
    color: '#d6edff',
    fontSize: '1.4rem',
    fontWeight: 700,
    height: theme.spacing(7),
    width: theme.spacing(7),
  },
  detailTitle: {
    fontWeight: 700,
  },
  muted: {
    color: theme.palette.text.secondary,
  },
  fieldGroup: {
    marginTop: theme.spacing(2),
  },
  cardPicker: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  plan: {
    background: '#101820',
    color: '#d8e2e8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.78rem',
    lineHeight: 1.65,
    overflowX: 'auto',
    padding: theme.spacing(1.5),
    whiteSpace: 'pre-wrap',
  },
  warning: {
    background: '#fff8e1',
    borderLeft: `4px solid ${theme.palette.warning.main}`,
    padding: theme.spacing(1.5),
  },
  success: {
    background: '#edf7ed',
    borderLeft: `4px solid ${theme.palette.success.main}`,
    padding: theme.spacing(1.5),
  },
  recipeRow: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  },
  recipeIcon: {
    color: theme.palette.primary.main,
    marginTop: 2,
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.78rem',
  },
}));

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 18)}...${digest.slice(-8)}`;
}

/**
 * Read-only projection of the committed ModelVersion/ModelRuntimeProfile
 * catalog. A deployment request leaves this page through the Backstage
 * Scaffolder and becomes a reviewed Gitea ModelDeployment PR; this component
 * never writes Kubernetes or NPU state.
 */
export const ModelDeploymentRecipesPage = () => {
  const classes = useStyles();
  const [query, setQuery] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [selectedVariantId, setSelectedVariantId] = useState(
    'qwen36-w8a8-ascend-a3-v1',
  );
  const [selectedCards, setSelectedCards] = useState([
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
  ]);
  const [deploymentName, setDeploymentName] = useState('qwen36-w8a8-demo');
  const [showPlan, setShowPlan] = useState(false);

  const selectedModel = modelCatalog.find(
    model => model.id === selectedModelId,
  );
  const selectedVariant = selectedModel?.variants.find(
    variant => variant.id === selectedVariantId,
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return modelCatalog;
    }
    return modelCatalog.filter(model =>
      [model.title, model.provider, model.modelId, model.quantization]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);

  const validDeploymentName = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(
    deploymentName,
  );
  const validCardSelection =
    selectedVariant !== undefined &&
    selectedCards.length === selectedVariant.cardIds.length;

  const openModel = (model: ModelRecipe) => {
    setSelectedModelId(model.id);
    setSelectedVariantId(model.variants[0].id);
    setSelectedCards(model.variants[0].cardIds);
    setShowPlan(false);
  };

  const toggleCard = (cardId: string) => {
    setSelectedCards(current =>
      current.includes(cardId)
        ? current.filter(id => id !== cardId)
        : [...current, cardId].sort(),
    );
  };

  const renderCatalog = () => (
    <>
      <Page themeId="tool">
        <ContentHeader title="Model deployment recipes">
          <Chip
            color="primary"
            icon={<CloudDoneIcon />}
            label="Gitea ModelVersion catalog · read-only"
            variant="outlined"
          />
          <Chip label="Deploy through reviewed PR" variant="outlined" />
        </ContentHeader>
        <Content className={classes.content}>
          <Paper className={classes.hero} elevation={0}>
            <Typography className={classes.heroTitle} variant="h4">
              Pick a verified model, then resolve its hardware recipe.
            </Typography>
            <Typography className={classes.heroCopy} variant="body1">
              This page reads the committed ModelVersion and ModelRuntimeProfile
              shape. Choose an Artifact Keeper artifact to review its runtime
              contract; a request is written to Gitea and remains Stopped until
              Tekton validation, human review and an explicit Argo CD sync.
            </Typography>
            <div className={classes.heroActions}>
              <Button
                className={classes.heroButton}
                color="inherit"
                href="/catalog/default/component/gitea"
                startIcon={<CodeIcon />}
                variant="outlined"
              >
                Open GitOps catalog
              </Button>
              <Typography variant="caption">
                Source: committed Gitea catalog
              </Typography>
            </div>
          </Paper>

          <Grid container spacing={2} style={{ marginTop: 16 }}>
            <Grid item xs={12} sm={4}>
              <Paper className={classes.stat} elevation={1}>
                <Typography className={classes.statLabel}>
                  Verified models
                </Typography>
                <Typography className={classes.statValue}>
                  {modelCatalog.length}
                </Typography>
                <Typography variant="body2" className={classes.muted}>
                  From the current GitOps catalog snapshot
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper className={classes.stat} elevation={1}>
                <Typography className={classes.statLabel}>
                  Compatible recipes
                </Typography>
                <Typography className={classes.statValue}>
                  {modelCatalog.reduce(
                    (total, model) => total + model.variants.length,
                    0,
                  )}
                </Typography>
                <Typography variant="body2" className={classes.muted}>
                  Runtime profiles with verified hardware
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper className={classes.stat} elevation={1}>
                <Typography className={classes.statLabel}>
                  Deployment gate
                </Typography>
                <Typography className={classes.statValue}>PR + Sync</Typography>
                <Typography variant="body2" className={classes.muted}>
                  Stopped XR first; no direct NPU allocation
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <div className={classes.sectionHeader}>
            <div>
              <Typography variant="h5">Verified artifacts</Typography>
              <Typography variant="body2" className={classes.muted}>
                Select a model to open its deployment recipe.
              </Typography>
            </div>
            <TextField
              label="Search models"
              onChange={event => setQuery(event.target.value)}
              value={query}
              variant="outlined"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </div>

          <Grid container spacing={2}>
            {filteredModels.map(model => (
              <Grid item key={model.id} xs={12} md={6} lg={4}>
                <Card className={classes.modelCard} elevation={2}>
                  <CardContent>
                    <Box className={classes.modelCardTop}>
                      <Avatar className={classes.modelAvatar}>Q</Avatar>
                      <Box flex={1}>
                        <Box display="flex" flexWrap="wrap" gridGap={8}>
                          <Chip
                            color="primary"
                            icon={<VerifiedUserIcon />}
                            label="Verified"
                            size="small"
                          />
                          <Chip
                            label={model.provider}
                            size="small"
                            variant="outlined"
                          />
                        </Box>
                        <Typography
                          className={classes.modelTitle}
                          gutterBottom
                          variant="h6"
                        >
                          {model.title}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography
                      className={classes.modelDescription}
                      variant="body2"
                    >
                      {model.description}
                    </Typography>
                    <Box className={classes.tagRow}>
                      <Chip
                        label={model.format}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={model.quantization}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={`${model.variants.length} hardware recipe`}
                        size="small"
                      />
                    </Box>
                    <Box className={classes.modelMeta}>
                      <Box>
                        <Typography className={classes.statLabel}>
                          Files
                        </Typography>
                        <Typography className={classes.metaValue}>
                          {model.fileCount}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography className={classes.statLabel}>
                          Size
                        </Typography>
                        <Typography className={classes.metaValue}>
                          {formatSize(model.sizeBytes)}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography className={classes.statLabel}>
                          Revision
                        </Typography>
                        <Typography className={classes.metaValue}>
                          {model.revision}
                        </Typography>
                      </Box>
                    </Box>
                    <Box className={classes.openRecipe}>
                      <Typography variant="caption" className={classes.muted}>
                        {model.repository}/{model.artifactPath}
                      </Typography>
                      <Button
                        color="primary"
                        endIcon={<ChevronRightIcon />}
                        onClick={() => openModel(model)}
                        variant="contained"
                      >
                        Open recipe
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          {filteredModels.length === 0 && (
            <Paper elevation={0} style={{ marginTop: 16, padding: 24 }}>
              <Typography>No verified model matches this search.</Typography>
            </Paper>
          )}

          <Box mt={3}>
            <Paper className={classes.warning} elevation={0}>
              <Typography variant="body2">
                <strong>Read-only boundary:</strong> the card is a committed
                catalog snapshot. The request path is declarative: the
                Scaffolder backend creates a constrained Gitea PR, Tekton checks
                it, and Argo CD/Crossplane are the only deployment writers.
              </Typography>
            </Paper>
          </Box>
        </Content>
      </Page>
    </>
  );

  if (!selectedModel || !selectedVariant) {
    return renderCatalog();
  }

  const recipePlan = `modelVersionRef: ${selectedModel.id}
runtimeProfileRef: ${selectedVariant.id}
namespace: model-serving
node: ${selectedVariant.node}
cards: [${selectedCards.join(', ')}]
accelerator: huawei.com/${selectedVariant.accelerator}
modelPath: ${selectedVariant.modelPath}
replicas: 0
compositionRef: modeldeployment-runtime-zero-v1alpha1
desiredState: Stopped
mode: declarative-gitops`;

  return (
    <Page themeId="tool">
      <ContentHeader title="Model deployment recipe">
        <Button
          onClick={() => {
            setSelectedModelId(undefined);
          }}
          startIcon={<ArrowBackIcon />}
        >
          Back to catalog
        </Button>
        <Chip label="Gitea PR required" variant="outlined" />
      </ContentHeader>
      <Content className={classes.content}>
        <Breadcrumbs aria-label="breadcrumb" style={{ marginBottom: 16 }}>
          <Typography color="textSecondary">Model recipes</Typography>
          <Typography color="textPrimary">{selectedModel.title}</Typography>
        </Breadcrumbs>

        <Paper className={classes.hero} elevation={0}>
          <Box className={classes.detailHero}>
            <Avatar className={classes.detailAvatar}>Q</Avatar>
            <Box>
              <Typography className={classes.heroTitle} variant="h4">
                {selectedModel.title}
              </Typography>
              <Typography className={classes.heroCopy} variant="body1">
                {selectedModel.description}
              </Typography>
              <Box className={classes.tagRow}>
                <Chip label="Artifact Keeper" size="small" />
                <Chip label={selectedModel.quantization} size="small" />
                <Chip label={selectedVariant.hardware} size="small" />
                <Chip label="Recipe verified" size="small" />
              </Box>
            </Box>
          </Box>
        </Paper>

        <Grid container spacing={2} style={{ marginTop: 16 }}>
          <Grid item xs={12} md={7}>
            <InfoCard title="Artifact and compatibility">
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography className={classes.statLabel}>
                    Model ID
                  </Typography>
                  <Typography className={classes.code}>
                    {selectedModel.modelId}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography className={classes.statLabel}>
                    Revision
                  </Typography>
                  <Typography>{selectedModel.revision}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography className={classes.statLabel}>
                    Artifact path
                  </Typography>
                  <Typography className={classes.code}>
                    {selectedModel.repository}/{selectedModel.artifactPath}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography className={classes.statLabel}>
                    Manifest
                  </Typography>
                  <Tooltip title={selectedModel.manifestDigest}>
                    <Typography className={classes.code}>
                      {shortDigest(selectedModel.manifestDigest)}
                    </Typography>
                  </Tooltip>
                </Grid>
              </Grid>
              <Divider style={{ margin: '20px 0' }} />
              <Box className={classes.recipeRow}>
                <StorageIcon className={classes.recipeIcon} />
                <Box>
                  <Typography variant="subtitle2">
                    Artifact Keeper readiness
                  </Typography>
                  <Typography variant="body2" className={classes.muted}>
                    {selectedModel.fileCount} files,{' '}
                    {formatSize(selectedModel.sizeBytes)}, verified by manifest
                    and file checksums.
                  </Typography>
                </Box>
              </Box>
              <Box className={classes.recipeRow}>
                <CodeIcon className={classes.recipeIcon} />
                <Box>
                  <Typography variant="subtitle2">Serving contract</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    Health: {selectedVariant.healthPath} | Inference:{' '}
                    {selectedVariant.inferencePath}
                  </Typography>
                </Box>
              </Box>
            </InfoCard>

            <Box mt={2}>
              <InfoCard title="Hardware and variant">
                <FormControl fullWidth variant="outlined">
                  <InputLabel id="hardware-profile-label">Hardware</InputLabel>
                  <Select
                    labelId="hardware-profile-label"
                    label="Hardware"
                    value={selectedVariant.id}
                    onChange={event => {
                      setSelectedVariantId(event.target.value as string);
                    }}
                  >
                    <MenuItem value={selectedVariant.id}>
                      {selectedVariant.hardware} / {selectedVariant.node} /
                      verified
                    </MenuItem>
                  </Select>
                </FormControl>
                <Box mt={2}>
                  <FormControl fullWidth variant="outlined">
                    <InputLabel id="runtime-variant-label">
                      Runtime variant
                    </InputLabel>
                    <Select
                      labelId="runtime-variant-label"
                      label="Runtime variant"
                      value={selectedVariant.id}
                      onChange={event => {
                        setSelectedVariantId(event.target.value as string);
                      }}
                    >
                      {selectedModel.variants.map(variant => (
                        <MenuItem key={variant.id} value={variant.id}>
                          {variant.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
                <Box className={classes.fieldGroup}>
                  <Typography variant="subtitle2">Certified cards</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    The current recipe is certified for all six physical IDs on{' '}
                    {selectedVariant.node}. Card selection is preview-only.
                  </Typography>
                  <Box className={classes.cardPicker}>
                    {selectedVariant.cardIds.map(cardId => {
                      const selected = selectedCards.includes(cardId);
                      return (
                        <Button
                          color={selected ? 'primary' : 'default'}
                          key={cardId}
                          onClick={() => toggleCard(cardId)}
                          variant={selected ? 'contained' : 'outlined'}
                        >
                          NPU {cardId}
                        </Button>
                      );
                    })}
                  </Box>
                  {!validCardSelection && (
                    <Typography color="error" variant="caption">
                      Select all six certified cards for this runtime recipe.
                    </Typography>
                  )}
                </Box>
              </InfoCard>
            </Box>
          </Grid>

          <Grid item xs={12} md={5}>
            <InfoCard title="Deployment settings">
              <TextField
                fullWidth
                helperText="DNS-label name used by the future ModelDeployment request"
                label="Deployment name"
                onChange={event => {
                  setDeploymentName(event.target.value);
                }}
                value={deploymentName}
                variant="outlined"
              />
              <Box mt={2}>
                <TextField
                  disabled
                  fullWidth
                  helperText="Pinned by the reviewed ModelDeployment contract"
                  label="Namespace"
                  value="model-serving"
                  variant="outlined"
                />
              </Box>
              <Box mt={2}>
                <TextField
                  disabled
                  fullWidth
                  helperText="Current runtime profile is Recreate, one replica"
                  label="Replica strategy"
                  value="Recreate / 1 replica"
                  variant="outlined"
                />
              </Box>
              <Box className={classes.fieldGroup}>
                <Box className={classes.recipeRow}>
                  <DeveloperBoardIcon className={classes.recipeIcon} />
                  <Box>
                    <Typography variant="subtitle2">
                      Resolved resources
                    </Typography>
                    <Typography variant="body2" className={classes.muted}>
                      64 CPU / 256 GiB / {selectedCards.length} NPU
                    </Typography>
                  </Box>
                </Box>
                <Box className={classes.recipeRow}>
                  <MemoryIcon className={classes.recipeIcon} />
                  <Box>
                    <Typography variant="subtitle2">Placement</Typography>
                    <Typography variant="body2" className={classes.muted}>
                      {selectedVariant.node} / {selectedVariant.accelerator}
                    </Typography>
                  </Box>
                </Box>
              </Box>
              <Divider style={{ margin: '20px 0' }} />
              <Paper className={classes.warning} elevation={0}>
                <Typography variant="body2">
                  <strong>GitOps boundary.</strong> The button opens the
                  constrained Scaffolder template. It creates a stopped
                  ModelDeployment file and Gitea PR; it does not call the
                  Kubernetes API or allocate an NPU.
                </Typography>
              </Paper>
              <div className={classes.actionRow}>
                <Button
                  color="primary"
                  disabled={!validDeploymentName || !validCardSelection}
                  fullWidth
                  component="a"
                  href="/create/templates/default/request-model-deployment"
                  startIcon={<PlayArrowIcon />}
                  variant="contained"
                >
                  Create Gitea deployment request
                </Button>
                <Button
                  fullWidth
                  onClick={() => setShowPlan(current => !current)}
                  startIcon={<CodeIcon />}
                  variant="outlined"
                >
                  {showPlan ? 'Hide resolved recipe' : 'Show resolved recipe'}
                </Button>
              </div>
              {!validDeploymentName && (
                <Typography color="error" variant="caption">
                  Deployment name must be a lowercase DNS label.
                </Typography>
              )}
            </InfoCard>

            <Box mt={2}>
              <Paper className={classes.success} elevation={0} role="status">
                <Typography variant="subtitle2">
                  Next: review the generated ModelDeployment PR
                </Typography>
                <Typography variant="body2">
                  Tekton validates the catalog references and immutable digest.
                  After merge, an operator performs the Argo CD sync; Crossplane
                  then reconciles the selected Composition.
                </Typography>
              </Paper>
            </Box>
          </Grid>
        </Grid>

        {showPlan && (
          <Box mt={2}>
            <InfoCard title="Resolved recipe preview">
              <Paper className={classes.plan} elevation={0}>
                {recipePlan}
              </Paper>
              <Box className={classes.recipeRow}>
                <InfoOutlinedIcon className={classes.recipeIcon} />
                <Typography variant="body2" className={classes.muted}>
                  These fields map to the allow-listed ModelVersion,
                  ModelRuntimeProfile and stopped ModelDeployment contract. The
                  page never sends them directly to Kubernetes.
                </Typography>
              </Box>
            </InfoCard>
          </Box>
        )}
      </Content>
    </Page>
  );
};

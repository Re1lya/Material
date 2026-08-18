import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@material-ui/core';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import LockIcon from '@material-ui/icons/Lock';
import StorageIcon from '@material-ui/icons/Storage';
import VerifiedUserIcon from '@material-ui/icons/VerifiedUser';
import {
  Content,
  ContentHeader,
  InfoCard,
  Page,
} from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles(theme => ({
  content: {
    paddingBottom: theme.spacing(4),
  },
  notice: {
    borderLeft: `4px solid ${theme.palette.info.main}`,
    padding: theme.spacing(1.5),
  },
  card: {
    height: '100%',
  },
  row: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
  },
  icon: {
    color: theme.palette.primary.main,
    marginTop: 2,
  },
  muted: {
    color: theme.palette.text.secondary,
  },
  locked: {
    background: theme.palette.warning.light,
    border: `1px solid ${theme.palette.warning.main}`,
    padding: theme.spacing(1.5),
  },
  contract: {
    background: '#101820',
    color: '#d8e2e8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    overflowX: 'auto',
    padding: theme.spacing(1.5),
    whiteSpace: 'pre-wrap',
  },
}));

const releaseSteps = [
  'ModelScope revision',
  'CPU-only importer',
  'Artifact Keeper manifest',
  'Gitea ModelVersion',
  'Tekton → Argo → Crossplane',
];

/**
 * Model release status page. It deliberately does not pretend to be a
 * training controller: ModelScope import and ModelSlim quantization are
 * reviewed build jobs, while Kubernetes/Ray/NPU activation is a separate
 * ModelDeployment release.
 */
export const KccPretrainingPage = () => {
  const classes = useStyles();

  return (
    <Page themeId="tool">
      <ContentHeader title="KCC Pretraining">
        <Chip
          color="secondary"
          icon={<LockIcon />}
          label="Release pipeline · read-only"
          variant="outlined"
        />
      </ContentHeader>
      <Content className={classes.content}>
        <Paper className={classes.notice} elevation={0} role="note">
          <Typography variant="body2">
            当前页面只展示模型发布契约，不启动预训练、量化、Ray、Kubernetes 或
            NPU 工作负载。ModelScope 下载和 ModelSlim W8A8
            量化由隔离的构建任务完成， 产出不可变 Artifact Keeper 制品后再提交
            ModelVersion。
          </Typography>
        </Paper>

        <Grid container spacing={2} style={{ marginTop: 16 }}>
          <Grid item xs={12} md={7}>
            <InfoCard title="Model release handoff" className={classes.card}>
              <Stepper activeStep={-1} alternativeLabel>
                {releaseSteps.map(step => (
                  <Step key={step}>
                    <StepLabel>{step}</StepLabel>
                  </Step>
                ))}
              </Stepper>
              <Box className={classes.locked} mt={2}>
                <Typography variant="body2">
                  当前没有已审核的 Qwen3.8 ModelScope revision 或 W8A8
                  manifest， 因此不会创建 importer Job、PVC、RayService 或 NPU
                  请求。
                </Typography>
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={5}>
            <InfoCard title="Current gate" className={classes.card}>
              <Box className={classes.row}>
                <VerifiedUserIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">Artifact gate</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    Waiting for an immutable ModelScope revision and manifest
                    digest.
                  </Typography>
                </Box>
              </Box>
              <Box className={classes.row}>
                <StorageIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">Runtime gate</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    A PVC is only a rebuildable cache; Artifact Keeper remains
                    the model source of truth.
                  </Typography>
                </Box>
              </Box>
              <Box className={classes.row}>
                <CloudUploadIcon className={classes.icon} />
                <Box>
                  <Typography variant="subtitle2">GitOps gate</Typography>
                  <Typography variant="body2" className={classes.muted}>
                    ModelVersion, RuntimeProfile and ModelDeployment are
                    reviewed in Gitea before Tekton and Argo CD can act.
                  </Typography>
                </Box>
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12}>
            <InfoCard title="Release contract">
              <Paper className={classes.contract} elevation={0}>
                {`source.type: modelscope\nsource.modelId: Qwen/Qwen3.8-27B\nquantization: BF16 → ModelSlim W8A8\nartifact.repository: model-artifacts\nartifact.manifestDigest: required (sha256)\nnext object: ModelVersion in Gitea\nactivation: ModelDeployment desiredState=Stopped first`}
              </Paper>
              <Box mt={2} display="flex" gridGap={8} flexWrap="wrap">
                <Button
                  color="primary"
                  href="/catalog/default/component/gitea"
                  variant="outlined"
                >
                  查看 Gitea GitOps 目录
                </Button>
                <Button
                  color="primary"
                  href="/model-recipes"
                  variant="contained"
                >
                  查看部署 Recipe
                </Button>
              </Box>
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};

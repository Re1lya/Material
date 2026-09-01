import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import DeveloperBoardIcon from '@material-ui/icons/DeveloperBoard';
import MemoryIcon from '@material-ui/icons/Memory';
import { KccPretrainingPage } from './KccPretrainingPage';
import { ModelDeploymentRecipesPage } from './ModelDeploymentRecipesPage';
import { ModelDeploymentsPage } from './ModelDeploymentsPage';

const trainingRouteRef = createRouteRef();
const modelRecipesRouteRef = createRouteRef();
const modelDeploymentsRouteRef = createRouteRef();

const kccPretrainingPage = PageBlueprint.make({
  name: 'training',
  params: {
    path: '/kcc-pretraining',
    routeRef: trainingRouteRef,
    title: 'KCC Pretraining',
    icon: <MemoryIcon fontSize="inherit" />,
    loader: async () => <KccPretrainingPage />,
  },
});

const modelDeploymentPage = PageBlueprint.make({
  name: 'model-deployment',
  params: {
    path: '/model-recipes',
    routeRef: modelRecipesRouteRef,
    title: 'Model Deployment',
    icon: <DeveloperBoardIcon fontSize="inherit" />,
    loader: async () => <ModelDeploymentRecipesPage />,
  },
});

const modelDeploymentsDashboardPage = PageBlueprint.make({
  name: 'model-deployments-dashboard',
  params: {
    path: '/model-deployments',
    routeRef: modelDeploymentsRouteRef,
    title: 'Model Deployments',
    icon: <DeveloperBoardIcon fontSize="inherit" />,
    loader: async () => <ModelDeploymentsPage />,
  },
});

export const kccPretrainingPlugin = createFrontendPlugin({
  pluginId: 'kcc-pretraining',
  title: 'KCC and Model Deployment',
  icon: <MemoryIcon fontSize="inherit" />,
  routes: {
    root: trainingRouteRef,
    modelRecipes: modelRecipesRouteRef,
    modelDeployments: modelDeploymentsRouteRef,
  },
  extensions: [kccPretrainingPage, modelDeploymentPage, modelDeploymentsDashboardPage],
});

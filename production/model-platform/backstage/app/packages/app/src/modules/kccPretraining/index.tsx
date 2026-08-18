import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import DeveloperBoardIcon from '@material-ui/icons/DeveloperBoard';
import MemoryIcon from '@material-ui/icons/Memory';
import { KccPretrainingPage } from './KccPretrainingPage';
import { ModelDeploymentRecipesPage } from './ModelDeploymentRecipesPage';

const trainingRouteRef = createRouteRef();
const modelRecipesRouteRef = createRouteRef();

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

export const kccPretrainingPlugin = createFrontendPlugin({
  pluginId: 'kcc-pretraining',
  title: 'KCC and Model Deployment',
  icon: <MemoryIcon fontSize="inherit" />,
  routes: {
    root: trainingRouteRef,
    modelRecipes: modelRecipesRouteRef,
  },
  extensions: [kccPretrainingPage, modelDeploymentPage],
});

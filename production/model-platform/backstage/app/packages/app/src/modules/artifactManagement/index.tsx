import { createFrontendPlugin, createRouteRef, PageBlueprint } from '@backstage/frontend-plugin-api';
import StorageIcon from '@material-ui/icons/Storage';
import { ArtifactManagementPage } from './ArtifactManagementPage';

const rootRouteRef = createRouteRef();

const page = PageBlueprint.make({
  name: 'artifact-management',
  params: {
    path: '/artifact-management',
    routeRef: rootRouteRef,
    title: 'Artifact & CI management',
    icon: <StorageIcon fontSize="inherit" />,
    loader: async () => <ArtifactManagementPage />,
  },
});

export const artifactManagementPlugin = createFrontendPlugin({
  pluginId: 'artifact-management',
  title: 'Artifact & CI management',
  icon: <StorageIcon fontSize="inherit" />,
  routes: { root: rootRouteRef },
  extensions: [page],
});

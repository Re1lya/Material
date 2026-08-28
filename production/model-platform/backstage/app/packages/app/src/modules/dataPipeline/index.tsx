import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import AccountTreeIcon from '@material-ui/icons/AccountTree';
import { DataPipelinePage } from './DataPipelinePage';

const rootRouteRef = createRouteRef();

const page = PageBlueprint.make({
  name: 'data-pipeline',
  params: {
    path: '/data-pipeline',
    routeRef: rootRouteRef,
    title: 'K12 Data Pipeline',
    icon: <AccountTreeIcon fontSize="inherit" />,
    loader: async () => <DataPipelinePage />,
  },
});

export const dataPipelinePlugin = createFrontendPlugin({
  pluginId: 'data-pipeline',
  title: 'K12 Data Pipeline',
  icon: <AccountTreeIcon fontSize="inherit" />,
  routes: { root: rootRouteRef },
  extensions: [page],
});

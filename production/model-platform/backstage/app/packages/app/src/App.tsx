import { createApp } from '@backstage/frontend-defaults';
import { SignInPage } from '@backstage/core-components';
import { OAuth2 } from '@backstage/core-app-api';
import {
  configApiRef,
  createApiRef,
  discoveryApiRef,
  oauthRequestApiRef,
} from '@backstage/core-plugin-api';
import {
  ApiBlueprint,
  createFrontendModule,
} from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import { navModule } from './modules/nav';

const giteaAuthApiRef = createApiRef<OAuth2>({ id: 'auth.gitea' });

const giteaAuthModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    ApiBlueprint.make({
      name: 'gitea-auth',
      params: defineParams =>
        defineParams({
          api: giteaAuthApiRef,
          deps: {
            configApi: configApiRef,
            discoveryApi: discoveryApiRef,
            oauthRequestApi: oauthRequestApiRef,
          },
          factory: ({ configApi, discoveryApi, oauthRequestApi }) =>
            OAuth2.create({
              configApi,
              discoveryApi,
              oauthRequestApi,
              environment: configApi.getOptionalString('auth.environment'),
              provider: {
                id: 'oidc',
                title: 'Gitea',
                icon: () => null,
              },
              defaultScopes: ['openid', 'profile', 'email'],
            }),
        }),
    }),
    SignInPageBlueprint.make({
      params: {
        loader: async () => props =>
          (
            <SignInPage
              {...props}
              provider={{
                id: 'gitea-auth-provider',
                title: 'Gitea',
                message: 'Sign in using the internal Gitea account',
                apiRef: giteaAuthApiRef,
              }}
            />
          ),
      },
    }),
  ],
});

export default createApp({
  features: [
    catalogPlugin,
    kubernetesPlugin,
    scaffolderPlugin,
    navModule,
    giteaAuthModule,
  ],
});

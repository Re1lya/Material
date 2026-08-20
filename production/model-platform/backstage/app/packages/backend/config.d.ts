export interface Config {
  modelPlatform: {
    gitea: {
      apiBaseUrl: string;
      owner: string;
      repository: string;
      baseBranch: string;
      /** @visibility secret */
      token: string;
      allowedInitiators: string[];
      allowedModelVersions: string[];
      allowedRuntimeProfiles: string[];
      artifactKeeperBaseUrl: string;
      stoppedCompositionRef: string;
    };
    /**
     * Restricted Artifact Keeper and Tekton management surface. This is
     * optional so older/read-only Backstage releases keep starting until the
     * dedicated provisioner Secret and HTTPS endpoint are approved.
     */
    artifactManagement?: {
      enabled?: boolean;
      artifactKeeperBaseUrl?: string;
      /** @visibility secret */
      provisionToken?: string;
      allowedInitiators?: string[];
      allowedRepositoryPrefixes?: string[];
      allowedFormats?: string[];
      maxQuotaBytes?: number;
      tokenMaxTtlDays?: number;
      allowOneTimeTokenReveal?: boolean;
      publishEventListenerUrl?: string;
      publishNamespace?: string;
    };
  };
}

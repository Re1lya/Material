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
    };
  };
}

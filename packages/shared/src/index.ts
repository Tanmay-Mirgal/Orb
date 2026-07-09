export enum DeploymentStatus {
  QUEUED = 'QUEUED',
  BUILDING = 'BUILDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface JobPayload {
  deploymentId: string;
  projectId: string;
  githubRepositoryName: string;
  githubRepositoryId: number;
  branch: string;
  commitHash?: string;
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
  environmentVariables: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  userId: string;
  createdAt: Date;
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  commitHash?: string;
  commitMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

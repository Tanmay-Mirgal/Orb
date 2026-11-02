import type { PackageManager } from 'shared';

/**
 * Dockerfile generation ("buildpacks-lite"). Pure functions so they can be unit-tested and reviewed.
 *
 * Security notes:
 *  - user commands never appear inside the Dockerfile text; they are written to shell scripts under
 *    `.orb-build/` and executed with `sh`, so a hostile command cannot inject Dockerfile instructions;
 *  - build-time secrets are mounted with BuildKit `--mount=type=secret` (never ARG/ENV), so they do not
 *    end up in image layers or `docker history`;
 *  - runtime images run as an unprivileged user.
 */

export interface GeneratedBuild {
  /** Relative path -> file content, written into `<workspace>/.orb-build/`. */
  files: Record<string, string>;
  dockerfile: string;
}

export interface NodeSpec {
  nodeMajor: number;
  packageManager: PackageManager;
  /** Directory (relative to the repo root, '' = root) of the app. */
  rootDirectory: string;
  /** Directory where dependencies are installed ('' = repo root). Differs from rootDirectory in monorepos. */
  installDirectory: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  outputDirectory: string;
  port: number;
}

const SECRET_MOUNT = '--mount=type=secret,id=orb_env,target=/run/orb-env';

const SOURCE_ENV = `if [ -f /run/orb-env ]; then set -a; . /run/orb-env; set +a; fi`;

function script(dir: string, command: string): string {
  const cd = dir ? `cd "/app/${dir}"` : 'cd /app';
  return ['#!/bin/sh', 'set -e', SOURCE_ENV, cd, `echo "$ ${command.replace(/(["$`\\])/g, '\\$1')}"`, command, ''].join('\n');
}

function appDir(root: string): string {
  return root ? `/app/${root}` : '/app';
}

function nodeBuildStage(spec: NodeSpec): { files: Record<string, string>; lines: string[] } {
  const files: Record<string, string> = {
    'install.sh': script(spec.installDirectory, spec.installCommand || 'npm install'),
  };
  const lines = [
    `FROM node:${spec.nodeMajor}-slim AS build`,
    'ENV CI=true NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/app/.orb-corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    'RUN corepack enable',
    'WORKDIR /app',
    'COPY . /app',
    `RUN ${SECRET_MOUNT} sh /app/.orb-build/install.sh`,
  ];
  if (spec.buildCommand) {
    files['build.sh'] = script(spec.rootDirectory, spec.buildCommand);
    lines.push(`RUN ${SECRET_MOUNT} sh /app/.orb-build/build.sh`);
  }
  return { files, lines };
}

/** Node static site: build in a container, then export only the output directory with `--output type=local`. */
export function nodeStaticBuild(spec: NodeSpec): GeneratedBuild {
  const { files, lines } = nodeBuildStage(spec);
  const out = [appDir(spec.rootDirectory), spec.outputDirectory && spec.outputDirectory !== '.' ? `/${spec.outputDirectory}` : ''].join('');
  const dockerfile = [
    '# syntax=docker/dockerfile:1.7',
    ...lines,
    'FROM scratch AS export',
    `COPY --from=build ${out}/ /`,
    '',
  ].join('\n');
  return { files, dockerfile };
}

/** Node web service / worker. Runs `start` as the unprivileged `node` user. */
export function nodeServiceBuild(spec: NodeSpec): GeneratedBuild {
  const { files, lines } = nodeBuildStage(spec);
  const dockerfile = [
    '# syntax=docker/dockerfile:1.7',
    ...lines,
    `FROM node:${spec.nodeMajor}-slim AS runtime`,
    `ENV NODE_ENV=production PORT=${spec.port} HOSTNAME=0.0.0.0 COREPACK_HOME=/app/.orb-corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0`,
    'RUN corepack enable',
    'COPY --from=build --chown=node:node /app /app',
    `WORKDIR ${appDir(spec.rootDirectory)}`,
    'USER node',
    `EXPOSE ${spec.port}`,
    `CMD ["sh", "-c", ${JSON.stringify(spec.startCommand)}]`,
    '',
  ].join('\n');
  return { files, dockerfile };
}

export interface PythonSpec {
  rootDirectory: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  port: number;
}

export function pythonServiceBuild(spec: PythonSpec): GeneratedBuild {
  const files: Record<string, string> = { 'install.sh': script(spec.rootDirectory, spec.installCommand) };
  const lines = [
    '# syntax=docker/dockerfile:1.7',
    'FROM python:3.12-slim',
    `ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=${spec.port}`,
    'RUN useradd --create-home --uid 1000 app',
    'WORKDIR /app',
    'COPY --chown=app:app . /app',
    `RUN ${SECRET_MOUNT} sh /app/.orb-build/install.sh`,
  ];
  if (spec.buildCommand) {
    files['build.sh'] = script(spec.rootDirectory, spec.buildCommand);
    lines.push(`RUN ${SECRET_MOUNT} sh /app/.orb-build/build.sh`);
  }
  lines.push(
    `WORKDIR ${appDir(spec.rootDirectory)}`,
    'USER app',
    `EXPOSE ${spec.port}`,
    `CMD ["sh", "-c", ${JSON.stringify(spec.startCommand)}]`,
    '',
  );
  return { files, dockerfile: lines.join('\n') };
}

export interface GoSpec {
  rootDirectory: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  port: number;
}

export function goServiceBuild(spec: GoSpec): GeneratedBuild {
  const src = spec.rootDirectory ? `/src/${spec.rootDirectory}` : '/src';
  const files: Record<string, string> = {
    'install.sh': ['#!/bin/sh', 'set -e', SOURCE_ENV, `cd "${src}"`, spec.installCommand || 'go mod download', ''].join('\n'),
    'build.sh': ['#!/bin/sh', 'set -e', SOURCE_ENV, `cd "${src}"`, 'export CGO_ENABLED=0', spec.buildCommand || 'go build -o app .', ''].join('\n'),
  };
  const dockerfile = [
    '# syntax=docker/dockerfile:1.7',
    'FROM golang:1 AS build',
    'WORKDIR /src',
    'COPY . /src',
    `RUN ${SECRET_MOUNT} sh /src/.orb-build/install.sh`,
    `RUN ${SECRET_MOUNT} sh /src/.orb-build/build.sh`,
    'FROM alpine:3.20',
    'RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 1000 app',
    `ENV PORT=${spec.port}`,
    `COPY --from=build --chown=app:app ${src}/app /app/app`,
    'WORKDIR /app',
    'USER app',
    `EXPOSE ${spec.port}`,
    `CMD ["sh", "-c", ${JSON.stringify(spec.startCommand || './app')}]`,
    '',
  ].join('\n');
  return { files, dockerfile };
}

export const DOCKERIGNORE = ['.git', 'node_modules', '**/node_modules', '.next/cache', '**/*.log', ''].join('\n');

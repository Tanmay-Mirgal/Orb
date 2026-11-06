import type { ZodType } from 'zod';
import { connectorEnabled } from 'core';
import { emitPlanLimitEvent } from 'database';
import { cpNotFound, cpValidation, getAction } from 'shared';
import type { ActionInput } from 'shared';
import { db } from '@/lib/db';
import { PlanLimitError } from '../api';
import { getRedis } from '../infra';
import { HANDLERS, startWaitForDeployment, type ActionContext, type SyncActionName } from './actions';
import { connectAuthed, requireScope } from './auth';
import { ConnectResponse, readBodyText } from './http';
import { readIdempotencyKey, requestHash, withIdempotency, type StoredResponse } from './idempotency';
import { advanceOperation, createOperation, loadOperation, operationView, pollUrl } from './operations';
import { ignoreUnknownFields, parseInput } from './validate';

/** `plan.limit_reached`, at most once per team and limit kind every 10 minutes. Best effort: it never fails the request. */
async function reportPlanLimit(orgId: string, userId: string, err: PlanLimitError): Promise<void> {
  if (!connectorEnabled()) return;
  try {
    const kind = err.kind ?? 'other';
    const first = await getRedis().set(`cp1:planlimit:${orgId}:${kind}`, '1', 'EX', 600, 'NX');
    if (first) await emitPlanLimitEvent(db, orgId, { limit: err.limit ?? null, kind }, { kind: 'connector', userId });
  } catch {
    /* ignore */
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `POST /api/connect/v1/actions/{name}` with `{ "input": { … } }`.
 * Order matters: authenticate, scope, shape of the request, input, idempotency, then the action itself.
 */
export const actionRoute = connectAuthed<{ name: string }>({}, async ({ req, params, auth, requestId }) => {
  const def = getAction(params.name);
  if (!def) throw cpNotFound('Action');
  for (const scope of def.scopes) requireScope(auth, scope);

  const ignore = ignoreUnknownFields(req);
  const text = await readBodyText(req);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw cpValidation('Request body must be valid JSON');
  }
  if (!isObject(body)) throw cpValidation('Request body must be a JSON object like { "input": { … } }');
  const unknown = Object.keys(body).filter((k) => k !== 'input');
  if (unknown.length > 0 && !ignore) {
    throw cpValidation(`Unknown field: ${unknown[0]}`, unknown.map((path) => ({ path, message: 'Unknown field; send the action input under "input"' })));
  }
  const input: unknown = parseInput(def.input as unknown as ZodType<unknown>, body.input ?? {}, ignore);
  const ctx: ActionContext = { auth, requestId };

  const execute = async (): Promise<StoredResponse> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof PlanLimitError) await reportPlanLimit(auth.org.id, auth.userId, err);
      throw err;
    }
  };
  const run = async (): Promise<StoredResponse> => {
    if (def.async) {
      const started = await startWaitForDeployment(ctx, input as ActionInput<'projects.waitForDeployment'>);
      const op = await createOperation(auth, def.name, started.input, started.deadlineAt);
      return { status: 202, body: { operation: { id: op.id, status: 'pending', pollUrl: pollUrl(op.id) } } };
    }
    const handler = HANDLERS[def.name as SyncActionName] as (c: ActionContext, i: unknown) => Promise<Record<string, unknown>>;
    return { status: 200, body: { output: await handler(ctx, input) } };
  };

  const key = readIdempotencyKey(req);
  if (!key) {
    const result = await execute();
    return new ConnectResponse(result.body, { status: result.status });
  }
  const { result, replay } = await withIdempotency(auth.connector.grantId, key, requestHash(def.name, input), execute);
  return new ConnectResponse(result.body, { status: result.status, headers: replay ? { 'Idempotent-Replay': 'true' } : {} });
});

/** `GET /api/connect/v1/operations/{id}`: needs the scope of the action that started it. */
export const operationRoute = connectAuthed<{ id: string }>({}, async ({ auth, params }) => {
  const op = await loadOperation(auth, params.id);
  const def = getAction(op.action);
  for (const scope of def?.scopes ?? []) requireScope(auth, scope);
  return operationView(await advanceOperation(auth, op));
});

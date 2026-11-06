import type { ActorSpec } from 'database';
import type { AuthContext } from './context';

/** Who is named as the actor of the connector events a request causes. */
export const actorOf = (auth: AuthContext): ActorSpec => ({ kind: auth.via === 'connector' ? 'connector' : 'user', userId: auth.userId });

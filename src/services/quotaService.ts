import { Redis } from "ioredis";

import type { QuotaResult, QuotaResultMap, SessionQuota } from "../types/jobs";

// ─── Script Lua: Decremento atómico de cupo ───────────────────────────────────
// Recibe: KEYS[1] = clave Redis (session:quota:{sessionId})
// Retorna: "ok" | "no-quota" | "not-found"
//
// La atomicidad de Lua garantiza que si dos workers ejecutan este script
// simultáneamente sobre la misma clave, solo uno de ellos podrá decrementar
// el cupo. Redis ejecuta scripts Lua en un solo hilo (single-threaded).
const DECREMENT_QUOTA_SCRIPT = `
local raw = redis.call('GET', KEYS[1])

if raw == false then
    return 'not-found'
end

local data = cjson.decode(raw)

if data['chairsAvailable'] <= 0 then
    return 'no-quota'
end

data['chairsAvailable'] = data['chairsAvailable'] - 1
data['registered']      = data['registered'] + 1

redis.call('SET', KEYS[1], cjson.encode(data))

return 'ok'
`;

// ─── Script Lua: Incremento atómico de cupo ───────────────────────────────────
// Recibe: KEYS[1] = clave Redis (session:quota:{sessionId})
// Retorna: "ok" | "not-found"
const INCREMENT_QUOTA_SCRIPT = `
local raw = redis.call('GET', KEYS[1])

if raw == false then
    return 'not-found'
end

local data = cjson.decode(raw)

data['chairsAvailable'] = data['chairsAvailable'] + 1
data['registered']      = data['registered'] - 1

if data['registered'] < 0 then
    data['registered'] = 0
end

redis.call('SET', KEYS[1], cjson.encode(data))

return 'ok'
`;

// ─── Script Lua: Rollback de decremento ──────────────────────────────────────
// Idéntico al incremento: revierte chairsAvailable+1 / registered-1
const ROLLBACK_QUOTA_SCRIPT = INCREMENT_QUOTA_SCRIPT;


const buildQuotaKey = ( sessionId: string ): string =>
	`session:quota:${sessionId}`;

// ─── Decremento atómico ───────────────────────────────────────────────────────
export const decrementQuotaAtomic = async (
	redis: Redis,
	sessionIds: string[]
): Promise<QuotaResultMap> => {

	const resultMap: QuotaResultMap = new Map();

	// Se ejecuta cada script de forma independiente por sessionId
	// para mantener la granularidad de errores por sesión
	const promises = sessionIds.map( async ( sessionId ) => {
		const key    = buildQuotaKey( sessionId );
		const result = await redis.eval( DECREMENT_QUOTA_SCRIPT, 1, key ) as string;

		resultMap.set( sessionId, result as QuotaResult );
	});

	await Promise.all( promises );

	return resultMap;
};

// ─── Rollback de decremento ───────────────────────────────────────────────────
export const rollbackQuotaDecrement = async (
	redis: Redis,
	sessionIds: string[]
): Promise<void> => {

	const promises = sessionIds.map( ( sessionId ) => {
		const key = buildQuotaKey( sessionId );
		return redis.eval( ROLLBACK_QUOTA_SCRIPT, 1, key );
	});

	await Promise.all( promises );
};

// ─── Incremento atómico (desinscripción) ─────────────────────────────────────
export const incrementQuotaAtomic = async (
	redis: Redis,
	sessionIds: string[]
): Promise<void> => {

	const promises = sessionIds.map( ( sessionId ) => {
		const key = buildQuotaKey( sessionId );
		return redis.eval( INCREMENT_QUOTA_SCRIPT, 1, key );
	});

	await Promise.all( promises );
};

// ─── Lectura de cupo (opcional para debug/validación) ────────────────────────
export const getSessionQuota = async (
	redis: Redis,
	sessionId: string
): Promise<SessionQuota | null> => {

	const raw = await redis.get( buildQuotaKey( sessionId ) );

	if ( raw === null ) return null;

	try {
		return JSON.parse( raw ) as SessionQuota;
	} catch {
		return null;
	}
};

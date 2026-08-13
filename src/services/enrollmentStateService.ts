import { Redis } from "ioredis";

import type { EnrollmentState, EnrollmentStateStatus } from "../types/jobs";


const buildEnrollmentKey = ( studentId: string, periodId: string ): string =>
	`student:enrollment:${studentId}:${periodId}`;


// ─── Leer estado ─────────────────────────────────────────────────────────────
export const getEnrollmentState = async (
	redis: Redis,
	studentId: string,
	periodId: string
): Promise<EnrollmentState | null> => {

	const raw = await redis.get( buildEnrollmentKey( studentId, periodId ) );

	if ( raw === null ) return null;

	try {
		return JSON.parse( raw ) as EnrollmentState;
	} catch {
		return null;
	}
};

// ─── Escribir estado completo ─────────────────────────────────────────────────
export const setEnrollmentState = async (
	redis       : Redis,
	state       : EnrollmentState,
	ttlSeconds  : number
): Promise<void> => {
	const key = buildEnrollmentKey( state.studentId, state.periodId );

	await redis.set( key, JSON.stringify( state ), "EX", ttlSeconds );
};

// ─── Actualizar sesiones inscritas (para UNENROLL) ────────────────────────────
// Lee el estado actual, elimina las sessionIds removidas y guarda de vuelta
export const updateSessionsInState = async (
	redis       : Redis,
	studentId   : string,
	periodId    : string,
	addIds      : string[],
	removeIds   : string[],
	ttlSeconds  : number
): Promise<void> => {
	const key       = buildEnrollmentKey( studentId, periodId );
	const existing  = await getEnrollmentState( redis, studentId, periodId );
	const removeSet = new Set( removeIds );

	const currentSessions: string[] = existing?.enrolledSessions ?? [];

	const updatedSessions = [
		...currentSessions.filter( ( id ) => !removeSet.has( id ) ),
		...addIds,
	];

	const status: EnrollmentStateStatus = updatedSessions.length === 0
		? "FAILED"
		: "SUCCESS";

	const updatedState: EnrollmentState = {
		studentId,
		periodId,
		status,
		timestamp        : new Date().toISOString(),
		enrolledSessions : updatedSessions,
		failedSessions   : existing?.failedSessions ?? [],
		errorMessage     : null,
	};

	await redis.set( key, JSON.stringify( updatedState ), "EX", ttlSeconds );
};

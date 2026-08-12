import { Job } from "bullmq";

import { EnrollmentStatus, Prisma } from "../generated/prisma/client";

import {
    decrementQuotaAtomic,
    rollbackQuotaDecrement
}                               from "../services/quotaService";
import type {
	EnrollSessionsPayload,
	EnrollmentState,
	EnrollmentStateStatus,
}                               from "../types/jobs";
import { prisma }               from "../config/prisma";
import { redis }                from "../config/redis";
import { env }                  from "../config/env";
import { setEnrollmentState }   from "../services/enrollmentStateService";


export const enrollProcessor = async ( job: Job<EnrollSessionsPayload> ): Promise<void> => {
	const { email, periodId, ticketId, sessionIds } = job.data;

	console.log(
		`[enrollProcessor] Processing job ${ job.id } — student email: ${ email }, sessions: ${ sessionIds.length }`
	);

	// Buscar al estudiante por su email único para obtener su studentId
	const student = await prisma.student.findUnique({
		where : { email },
	});

	if ( !student ) {
		console.error( `[enrollProcessor] Student with email ${ email } not found.` );
		throw new Error( `Student with email ${ email } not found` );
	}

	const studentId = student.id;

	// ── 1. Decrementar cupos atómicamente en Redis ────────────────────────────
	// El script Lua garantiza que no hay race condition si otro worker
	// intenta inscribir la misma session en el mismo instante.

	const quotaResults = await decrementQuotaAtomic( redis, sessionIds );

	const sessionsOk   : string[] = [];
	const sessionsFail : string[] = [];

	for ( const [ sessionId, result ] of quotaResults ) {
		if ( result === "ok" ) {
			sessionsOk.push( sessionId );
		} else {
			sessionsFail.push( sessionId );
		}
	}

	console.log( `[enrollProcessor] Job ${ job.id } — quota results: ok=${ sessionsOk.length }, failed=${ sessionsFail.length }` );

	// ── 2. Persistir en PostgreSQL (solo los que pasaron cupo) ────────────────
	if ( sessionsOk.length > 0 ) {
		try {
			await prisma.$transaction( async ( tx: Prisma.TransactionClient ) => {
				// Crear con PROCESSING
				await tx.enrollment.createMany({
					data: sessionsOk.map( ( sessionId ) => ({
						ticketId,
						sessionId,
						studentId,
						status: EnrollmentStatus.PROCESSING,
					})),
					skipDuplicates: true,
				});

				// Actualizar a CONFIRMED en la misma transacción
				await tx.enrollment.updateMany({
					where : { ticketId, sessionId: { in: sessionsOk } },
					data  : { status: EnrollmentStatus.CONFIRMED },
				});
			});

		} catch ( dbError ) {
			// ── Rollback en Redis ante fallo de DB ────────────────────────────
			console.error(
				`[enrollProcessor] Job ${job.id} — DB transaction failed, rolling back Redis quota for ${sessionsOk.length} sessions.`,
				dbError
			);

			await rollbackQuotaDecrement( redis, sessionsOk );

			// Marcar todo como FAILED en Redis y relanzar para BullMQ retry
			await setEnrollmentState(
				redis,
				{
					studentId,
					periodId,
					status           : "FAILED",
					timestamp        : new Date().toISOString(),
					enrolledSessions : [],
					failedSessions   : sessionIds,
					errorMessage     : "Database transaction failed. Will retry.",
				},
				env.ENROLLMENT_STATE_TTL
			);

			// Relanzar el error para que BullMQ aplique el backoff y reintente
			throw dbError;
		}
	}

	// ── 3. Determinar status global y escribir estado en Redis ────────────────

	let status          : EnrollmentStateStatus;
	let errorMessage    : string | null = null;

	if ( sessionsOk.length > 0 && sessionsFail.length === 0 ) {
		status = "SUCCESS";
	} else if ( sessionsOk.length > 0 && sessionsFail.length > 0 ) {
		status          = "PARTIAL";
		errorMessage    = `Sin cupo disponible en ${sessionsFail.length} sesión(es).`;
	} else {
		status          = "FAILED";
		errorMessage    = "Sin cupo disponible en todas las sesiones solicitadas.";
	}

	const finalState: EnrollmentState = {
		studentId,
		periodId,
		status,
		timestamp        : new Date().toISOString(),
		enrolledSessions : sessionsOk,
		failedSessions   : sessionsFail,
		errorMessage,
	};

	await setEnrollmentState( redis, finalState, env.ENROLLMENT_STATE_TTL );

	console.log(
		`[enrollProcessor] Job ${job.id} completed — status: ${status}`
	);
};

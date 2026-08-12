import { Job } from "bullmq";

import { Prisma } from "../generated/prisma/client";

import { prisma }                       from "../config/prisma";
import { redis }                        from "../config/redis";
import { env }                          from "../config/env";
import { incrementQuotaAtomic }         from "../services/quotaService";
import { updateSessionsInState }        from "../services/enrollmentStateService";
import type { UnenrollSessionsPayload } from "../types/jobs";


export const unenrollProcessor = async ( job: Job<UnenrollSessionsPayload> ): Promise<void> => {
	const { email, periodId, sessionIds } = job.data;

	console.log( `[unenrollProcessor] Processing job ${ job.id } — student email: ${ email }, sessions: ${ sessionIds.length }` );

	// Buscar al estudiante por su email único para obtener su studentId
	const student = await prisma.student.findUnique({
		where : { email },
	});

	if ( !student ) {
		console.error( `[unenrollProcessor] Student with email ${ email } not found.` );
		throw new Error( `Student with email ${ email } not found` );
	}

	const studentId = student.id;

	// ── 1. Eliminar registros en PostgreSQL (fuente de verdad primaria) ───────
	// Si esto falla, BullMQ reintentará con backoff exponencial.
	// Redis NO se modifica hasta que la DB confirme el borrado.
	await prisma.$transaction( async ( tx: Prisma.TransactionClient ) => {
		await tx.enrollment.deleteMany({
			where: {
				studentId,
				sessionId : { in: sessionIds },
			},
		});
	});

	console.log( `[unenrollProcessor] Job ${job.id} — ${sessionIds.length} enrollment(s) deleted from DB.` );

	// ── 2. Liberar cupos en Redis post-confirmación de DB ─────────────────────
	await incrementQuotaAtomic( redis, sessionIds );

	console.log( `[unenrollProcessor] Job ${job.id} — quota released for ${sessionIds.length} session(s).` );

	// ── 3. Actualizar estado del alumno en Redis ──────────────────────────────
	await updateSessionsInState(
		redis,
		studentId,
		periodId,
		[],           // addIds: ninguna sesión nueva
		sessionIds,   // removeIds: las sesiones que se dieron de baja
		env.ENROLLMENT_STATE_TTL
	);

	console.log(
		`[unenrollProcessor] Job ${job.id} completed — student ${studentId} enrollment state updated.`
	);
};

import { Job } from "bullmq";

import { Prisma } from "../generated/prisma/client";

import { prisma }                       from "../config/prisma";
import { redis }                        from "../config/redis";
import { env }                          from "../config/env";
import { incrementQuotaAtomic }         from "../services/quotaService";
import { updateSessionsInState }        from "../services/enrollmentStateService";
import type { UnenrollSessionsPayload } from "../types/jobs";


export const unenrollProcessor = async ( job: Job<UnenrollSessionsPayload> ): Promise<void> => {
	const { studentId, periodId, sessionIds } = job.data;

	console.log( `[unenrollProcessor] Processing job ${job.id} — student: ${studentId}, sessions: ${sessionIds.length}` );

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

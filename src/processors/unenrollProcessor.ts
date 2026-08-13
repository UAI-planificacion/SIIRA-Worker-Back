import { Job } from "bullmq";

import { Prisma } from "../generated/prisma/client";

import { prisma }               from "../config/prisma";
import { redis }                from "../config/redis";
import { env }                  from "../config/env";
import { incrementQuotaAtomic } from "../services/quotaService";
import { updateSessionsInState } from "../services/enrollmentStateService";
import type {
	UnenrollSessionsPayload,
}                               from "../types/jobs";
import { notifyCore }           from "../services/notificationService";
import {
	EnrollmentActionType,
	EnrollmentNotifyStatus,
}                               from "../services/dto/notify-enrollment.dto";


export const unenrollProcessor = async ( job: Job<UnenrollSessionsPayload> ): Promise<void> => {
	const { email, periodId, ticketId, sessionIds } = job.data;

	console.log( `[unenrollProcessor] Processing job ${ job.id } — student email: ${ email }, session: ${ sessionIds[ 0 ] }` );

	// Buscar al estudiante por su email único para obtener su studentId
	const student = await prisma.student.findUnique( {
		where : { email },
	} );

	if ( !student ) {
		console.error( `[unenrollProcessor] Student with email ${ email } not found.` );
		throw new Error( `Student with email ${ email } not found` );
	}

	const studentId = student.id;
	const sessionId = sessionIds[ 0 ];

	if ( !sessionId ) {
		console.error( `[unenrollProcessor] Job ${ job.id } has no sessionId.` );
		return;
	}

	let ssec       = "";
	let wasDeleted = false;

	// ── 1. Eliminar registros en PostgreSQL primero ───────────────────────────
	try {
		await prisma.$transaction( async ( tx: Prisma.TransactionClient ) => {
			const session = await tx.session.findUnique( {
				where  : { id: sessionId },
				select : {
					id      : true,
					section : {
						select: {
							code    : true,
							subject : {
								select: {
									id: true,
								},
							},
						},
					},
				},
			} );

			// Eliminar matrícula en PostgreSQL
			const deleteResult = await tx.enrollment.deleteMany( {
				where: {
					studentId,
					sessionId,
				},
			} );

			// Solo incrementar cupos si realmente se eliminó una matrícula
			if ( deleteResult.count > 0 ) {
				await tx.session.update( {
					where : { id: sessionId },
					data  : {
						chairsAvailable: {
							increment: 1,
						},
						quota: {
							increment: 1,
						},
					},
				} );

				ssec       = session ? `${ session.section.subject.id }-${ session.section.code }` : "";
				wasDeleted = true;
			}
		} );
	} catch ( dbError ) {
		console.error( `[unenrollProcessor] Job ${ job.id } — DB transaction failed.`, dbError );
		throw dbError;
	}

	console.log( `[unenrollProcessor] Job ${ job.id } — unenrollment processed in DB. Was deleted: ${ wasDeleted }` );

	// ── 2. Sincronizar cupos y estado del alumno en Redis ─────────────────────
	if ( wasDeleted ) {
		await incrementQuotaAtomic( redis, [ sessionId ] );
	}

	await updateSessionsInState(
		redis,
		studentId,
		periodId,
		[],             // addIds: ninguna sesión nueva
		[ sessionId ],   // removeIds: la sesión que se dio de baja
		env.ENROLLMENT_STATE_TTL
	);

	// ── 3. Notificar a siira-core-back ─────────────────────────────────────────
	await notifyCore( {
		ticketId,
		studentId,
		sessionId,
		actionType : EnrollmentActionType.UNENROLL,
		status     : EnrollmentNotifyStatus.SUCCESS,
		ssec,
	} );

	console.log( `[unenrollProcessor] Job ${ job.id } completed — student ${ studentId } enrollment state updated and core notified.` );
};

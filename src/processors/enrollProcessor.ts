import { Job } from "bullmq";

import { EnrollmentStatus, Prisma } from "../generated/prisma/client";

import { decrementQuotaAtomic }     from "../services/quotaService";
import type {
	EnrollSessionsPayload,
	EnrollmentState,
	EnrollmentStateStatus,
}                                   from "../types/jobs";
import { prisma }                   from "../config/prisma";
import { redis }                    from "../config/redis";
import { env }                      from "../config/env";
import { setEnrollmentState }       from "../services/enrollmentStateService";
import { notifyCore }               from "../services/notificationService";
import {
	EnrollmentActionType,
	EnrollmentNotifyStatus,
}                                   from "../services/dto/notify-enrollment.dto";


export const enrollProcessor = async ( job: Job<EnrollSessionsPayload> ): Promise<void> => {
	const { email, periodId, ticketId, sessionIds } = job.data;

	console.log( `[enrollProcessor] Processing job ${ job.id } — student email: ${ email }, session: ${ sessionIds[ 0 ] }` );

	const student = await prisma.student.findUnique( {
		where : { email },
	} );

	if ( !student ) {
		console.error( `[enrollProcessor] Student with email ${ email } not found.` );
		throw new Error( `Student with email ${ email } not found` );
	}

	const studentId = student.id;
	const sessionId = sessionIds[ 0 ];

	if ( !sessionId ) {
		console.error( `[enrollProcessor] Job ${ job.id } has no sessionId.` );
		return;
	}

	let ssec            = "";
	let success         = false;
	const sessionsOk    : string[] = [];
	const sessionsFail  : string[] = [];

	// ── 1. Base de datos primero ──────────────────────────────────────────────
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

			if ( session ) {
				// Decrementar en la base de datos
				await tx.session.update( {
					where : { id: sessionId },
					data  : {
						chairsAvailable: {
							decrement: 1,
						},
						quota: {
							decrement: 1,
						},
					},
				} );

				// Crear matrícula confirmada
				await tx.enrollment.create( {
					data: {
						ticketId,
						sessionId,
						studentId,
						status: EnrollmentStatus.CONFIRMED,
					},
				} );

				ssec    = `${ session.section.subject.id }-${ session.section.code }`;
				success = true;
				sessionsOk.push( sessionId );
			} else {
				sessionsFail.push( sessionId );
			}
		} );
	} catch ( dbError ) {
		console.error( `[enrollProcessor] Job ${ job.id } — DB transaction failed.`, dbError );

		// Marcar todo como FAILED en Redis y relanzar el error
		await setEnrollmentState(
			redis,
			{
				studentId,
				periodId,
				status           : "FAILED",
				timestamp        : new Date().toISOString(),
				enrolledSessions : [],
				failedSessions   : [ sessionId ],
				errorMessage     : "Database transaction failed. Will retry.",
			},
			env.ENROLLMENT_STATE_TTL
		);

		throw dbError;
	}

	// ── 2. Sincronizar con Redis ──────────────────────────────────────────────
	if ( success ) {
		await decrementQuotaAtomic( redis, [ sessionId ] );
	}

	const status : EnrollmentStateStatus = success ? "SUCCESS" : "FAILED";
	const errorMessage = success ? null : "Sin cupo disponible.";

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

	// ── 3. Notificar a siira-core-back ─────────────────────────────────────────
	await notifyCore( {
		ticketId,
		studentId,
		sessionId,
		actionType : EnrollmentActionType.ENROLL,
		status     : success ? EnrollmentNotifyStatus.SUCCESS : EnrollmentNotifyStatus.FAILED,
		ssec,
	} );

	console.log( `[enrollProcessor] Job ${ job.id } completed — status: ${ status }` );
};

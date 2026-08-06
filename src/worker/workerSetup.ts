import { Worker, Job } from "bullmq";


import type {
	EnrollSessionsPayload,
	UnenrollSessionsPayload,
}                               from "../types/jobs";
import { redis }                from "../config/redis";
import { env }                  from "../config/env";
import { enrollProcessor }      from "../processors/enrollProcessor";
import { unenrollProcessor }    from "../processors/unenrollProcessor";


const QUEUE_NAME = "siira-enrollment-queue";


export const createWorker = (): Worker => {
	const worker = new Worker(
		QUEUE_NAME,
		async ( job: Job ) => {
			switch ( job.name ) {
				case "ENROLL_SECTIONS":
					return enrollProcessor( job as Job<EnrollSessionsPayload> );

				case "UNENROLL_SECTIONS":
					return unenrollProcessor( job as Job<UnenrollSessionsPayload> );

				default:
					throw new Error( `[Worker] Unknown job type: "${job.name}"` );
			}
		},
		{
			connection  : redis,
			concurrency : env.WORKER_CONCURRENCY,
		}
	);

	// ── Listeners de eventos ──────────────────────────────────────────────────
	worker.on( "completed", ( job: Job ) => {
		console.log( `[Worker] ✓ Job ${job.id} (${job.name}) completed successfully.` );
	});

	worker.on( "failed", ( job: Job | undefined, error: Error ) => {
		const jobInfo = job ? `${job.id} (${job.name}) — attempt ${job.attemptsMade}` : "unknown";
		console.error( `[Worker] ✗ Job ${jobInfo} failed:`, error.message );
	});

	worker.on( "stalled", ( jobId: string ) => {
		console.warn( `[Worker] ⚠ Job ${jobId} stalled — será re-encolado automáticamente.` );
	});

	worker.on( "error", ( error: Error ) => {
		console.error( "[Worker] Connection error:", error.message );
	});

	console.log(
		`[Worker] Started on queue "${QUEUE_NAME}" with concurrency ${env.WORKER_CONCURRENCY}.`
	);

	return worker;
};

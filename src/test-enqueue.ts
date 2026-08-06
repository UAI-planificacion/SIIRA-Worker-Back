import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "./config/env";


const redisConnection = new Redis({
	host                 : env.REDIS_HOST,
	port                 : env.REDIS_PORT,
	password             : env.REDIS_PASSWORD,
	maxRetriesPerRequest : null,
});


const testQueue = new Queue( "siira-enrollment-queue", {
	connection: redisConnection,
});


const run = async (): Promise<void> => {
	console.log( "Enqueuing test job..." );

	const jobId = `test-enroll-${Date.now()}`;

	// Job de prueba para simular una inscripción
	await testQueue.add(
		"ENROLL_SECTIONS",
		{
			studentId  : "student-001",
			periodId   : "period-001",
			ticketId   : `ticket-${Date.now()}`,
			sessionIds : [ "session-001", "session-002" ],
		},
		{
			jobId,
			attempts : 3,
			backoff  : {
				type  : "exponential",
				delay : 1000,
			},
		}
	);

	console.log( `Test job enqueued with ID: ${jobId}` );
	await redisConnection.quit();
};


run().catch( ( error ) => {
	console.error( "Failed to enqueue job:", error );
	redisConnection.quit();
});

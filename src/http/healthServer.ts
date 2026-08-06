import Fastify, {
    FastifyInstance,
    FastifyRequest,
    FastifyReply
}                   from "fastify";
import { Worker }   from "bullmq";

import { redis }  from "../config/redis";
import { prisma } from "../config/prisma";
import { env }    from "../config/env";


interface HealthResponse {
	status    : "ok" | "degraded";
	redis     : "connected" | "error";
	database  : "connected" | "error";
	uptime    : number;
	timestamp : string;
}

interface MetricsResponse {
	workerConcurrency : number;
	queueName         : string;
	redisHost         : string;
	redisPort         : number;
	uptime            : number;
	timestamp         : string;
}


export const createHealthServer = ( worker: Worker ): FastifyInstance => {
	const app = Fastify({ logger: false });

	// ── GET /health ───────────────────────────────────────────────────────────
	app.get( "/health", async (
		_request : FastifyRequest,
		reply    : FastifyReply
	): Promise<void> => {
		let redisStatus   : "connected" | "error"   = "connected";
		let databaseStatus: "connected" | "error"   = "connected";

		try {
			await redis.ping();
		} catch {
			redisStatus = "error";
		}

		try {
			await prisma.$queryRaw`SELECT 1`;
		} catch {
			databaseStatus = "error";
		}

		const overallStatus = ( redisStatus === "connected" && databaseStatus === "connected" )
			? "ok"
			: "degraded";

		const httpCode = overallStatus === "ok" ? 200 : 503;

		const response: HealthResponse = {
			status    : overallStatus,
			redis     : redisStatus,
			database  : databaseStatus,
			uptime    : process.uptime(),
			timestamp : new Date().toISOString(),
		};

		return reply.status( httpCode ).send( response );
	});

	// ── GET /metrics ──────────────────────────────────────────────────────────
	app.get( "/metrics", async (
		_request : FastifyRequest,
		reply    : FastifyReply
	): Promise<void> => {

		const response: MetricsResponse = {
			workerConcurrency : env.WORKER_CONCURRENCY,
			queueName         : "siira-enrollment-queue",
			redisHost         : env.REDIS_HOST,
			redisPort         : env.REDIS_PORT,
			uptime            : process.uptime(),
			timestamp         : new Date().toISOString(),
		};

		return reply.status( 200 ).send( response );
	});


	return app;
};

import { env }                from "./config/env";
import { redis }              from "./config/redis";
import { prisma }             from "./config/prisma";
import { createWorker }       from "./worker/workerSetup";
import { createHealthServer } from "./http/healthServer";


const bootstrap = async (): Promise<void> => {
	console.log( "[Bootstrap] Starting SIIRA-Worker-Back..." );

	// ── 1. Conectar Prisma ────────────────────────────────────────────────────
	await prisma.$connect();
	console.log( "[Bootstrap] Prisma connected to PostgreSQL." );

	// ── 2. Inicializar Worker BullMQ ──────────────────────────────────────────
	const worker = createWorker();

	// ── 3. Inicializar servidor de health checks ──────────────────────────────
	const healthServer = createHealthServer( worker );

	await healthServer.listen({ port: env.PORT, host: "0.0.0.0" });
	console.log( `[Bootstrap] Health server listening on port ${env.PORT}.` );

	// ── 4. Graceful Shutdown ──────────────────────────────────────────────────
	// Orden: Worker → Redis → Prisma → Fastify
	// El Worker.close() espera a que los jobs en curso terminen antes de cerrarse.

	const shutdown = async ( signal: string ): Promise<void> => {
		console.log( `\n[Shutdown] Received ${signal}. Closing gracefully...` );

		try {
			await worker.close();
			console.log( "[Shutdown] Worker closed — all in-flight jobs completed." );
		} catch ( error ) {
			console.error( "[Shutdown] Error closing worker:", error );
		}

		try {
			await redis.quit();
			console.log( "[Shutdown] Redis connection closed." );
		} catch ( error ) {
			console.error( "[Shutdown] Error closing Redis:", error );
		}

		try {
			await prisma.$disconnect();
			console.log( "[Shutdown] Prisma disconnected from PostgreSQL." );
		} catch ( error ) {
			console.error( "[Shutdown] Error disconnecting Prisma:", error );
		}

		try {
			await healthServer.close();
			console.log( "[Shutdown] Health server closed." );
		} catch ( error ) {
			console.error( "[Shutdown] Error closing health server:", error );
		}

		console.log( "[Shutdown] Goodbye." );
		process.exit( 0 );
	};


	process.on( "SIGTERM", () => shutdown( "SIGTERM" ) );
	process.on( "SIGINT",  () => shutdown( "SIGINT" ) );

	// ── 5. Manejo de errores no capturados ────────────────────────────────────
	process.on( "uncaughtException", ( error: Error ) => {
		console.error( "[Process] Uncaught exception:", error );
		shutdown( "uncaughtException" );
	});

	process.on( "unhandledRejection", ( reason: unknown ) => {
		console.error( "[Process] Unhandled rejection:", reason );
		shutdown( "unhandledRejection" );
	});

	console.log( "[Bootstrap] SIIRA-Worker-Back is ready and processing jobs." );
};


bootstrap().catch( ( error: Error ) => {
	console.error( "[Bootstrap] Fatal startup error:", error.message );
	process.exit( 1 );
});

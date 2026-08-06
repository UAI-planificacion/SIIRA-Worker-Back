import { Redis } from "ioredis";

import { env } from "./env";


const tlsConfig = env.REDIS_TLS
	? { servername: env.REDIS_HOST }
	: undefined;


const redisOptions = {
	host                : env.REDIS_HOST,
	port                : env.REDIS_PORT,
	password            : env.REDIS_PASSWORD,
	connectTimeout      : 10000,
	maxRetriesPerRequest: null,
	tls                 : tlsConfig,
	retryStrategy       : ( times: number ): number => {
		const delay = Math.min( times * 50, 2000 );
		return delay;
	},
};


export const redis = new Redis( redisOptions );


redis.on( "connect", () => {
	console.log( "[Redis] Client connected successfully." );
});


redis.on( "error", ( error: Error ) => {
	console.error( "[Redis] Client error:", error.message );
});

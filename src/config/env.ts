import * as dotenv from "dotenv";


dotenv.config();


interface Env {
	DATABASE_URL         : string;
	REDIS_HOST           : string;
	REDIS_PORT           : number;
	REDIS_PASSWORD       : string | undefined;
	REDIS_TLS            : boolean;
	WORKER_CONCURRENCY   : number;
	PORT                 : number;
	ENROLLMENT_STATE_TTL : number;
	CORE_BACK_URL        : string;
}


const getRequiredString = ( key: string ): string => {
	const value = process.env[ key ];

	if ( !value ) {
		throw new Error( `Missing required environment variable: ${key}` );
	}

	return value;
};


const getOptionalString = ( key: string ): string | undefined => {
	return process.env[ key ] || undefined;
};


const getNumber = ( key: string, defaultValue: number ): number => {
	const value = process.env[ key ];

	if ( !value ) return defaultValue;

	const parsed = parseInt( value, 10 );

	if ( isNaN( parsed ) ) {
		throw new Error( `Environment variable ${key} must be a valid number, got: "${value}"` );
	}

	return parsed;
};


export const env: Env = {
	DATABASE_URL         : getRequiredString( "DATABASE_URL" ),
	REDIS_HOST           : getRequiredString( "REDIS_HOST" ),
	REDIS_PORT           : getNumber( "REDIS_PORT", 6379 ),
	REDIS_PASSWORD       : getOptionalString( "REDIS_PASSWORD" ),
	REDIS_TLS            : process.env.REDIS_TLS === "true",
	WORKER_CONCURRENCY   : getNumber( "WORKER_CONCURRENCY", 10 ),
	PORT                 : getNumber( "PORT", 4001 ),
	ENROLLMENT_STATE_TTL : getNumber( "ENROLLMENT_STATE_TTL", 86400 ),
	CORE_BACK_URL        : getOptionalString( "CORE_BACK_URL" ) || "http://localhost:5050",
};


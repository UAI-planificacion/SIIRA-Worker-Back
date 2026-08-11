import * as http  from "http";
import * as https from "https";

import { env } from "../config/env";


export interface NotificationPayload {
	ticketId   : string;
	studentId  : string;
	sessionIds : string[];
	actionType : "ENROLL" | "UNENROLL";
	status     : "SUCCESS" | "FAILED" | "PARTIAL";
}


export const notifyCore = async ( payload: NotificationPayload ): Promise<void> => {
	const urlStr   = `${ env.CORE_BACK_URL }/study-plan/notify-enrollment`;
	const postData = JSON.stringify( payload );

	return new Promise( ( resolve ) => {
		const client = urlStr.startsWith( "https" ) ? https : http;
		const req    = client.request(
			urlStr,
			{
				method  : "POST",
				headers : {
					"Content-Type"   : "application/json",
					"Content-Length" : Buffer.byteLength( postData ),
				},
			},
			( res ) => {
				res.on( "data", () => {} );
				res.on( "end", () => {
					if ( res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ) {
						console.log( `[notifyCore] Notification sent successfully for ticket ${ payload.ticketId }` );
					} else {
						console.error( `[notifyCore] Core returned error: ${ res.statusCode }` );
					}
					resolve();
				} );
			}
		);

		req.on( "error", ( err ) => {
			console.error( `[notifyCore] Error notifying Core:`, err.message );
			resolve(); // Resolve to avoid stalling the worker
		} );

		req.write( postData );
		req.end();
	} );
};

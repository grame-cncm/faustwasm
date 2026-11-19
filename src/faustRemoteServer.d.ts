import type * as http from 'http';
import type * as https from 'https';

export declare const createFaustRemoteServer: (options: {
    root: string;
    cert?: string | Buffer;
    key?: string | Buffer;
}) => http.Server | https.Server;

export default createFaustRemoteServer;

import type * as http from 'http';
import type * as https from 'https';

/**
 * The host's end of a room's relay, for a host in the server's process: the
 * same as `FaustRelayPort` in the remote control library.
 */
export interface FaustRemoteRelayPort {
    send(text: string): void;
    close(): void;
    onmessage: ((text: string) => void) | null;
    onclose: (() => void) | null;
}

export type FaustRemoteServer = (http.Server | https.Server) & {
    /**
     * Be a room's relaying host from this process; give the port to
     * `FaustRemoteHost.acceptRelay`. Throws if the room has another token.
     */
    hostRoom(room: string, token: string): FaustRemoteRelayPort;
    /**
     * A plain HTTP listener that serves only the relay, and only to hosts
     * (`role: 'host'`), for a host on this computer outside Node, such as a
     * native Faust application, which then needs no TLS. Requests with an
     * `Origin` or from another address than loopback are refused. Listen on
     * `127.0.0.1`; it is closed with the server.
     */
    hostListener(): http.Server;
};

export declare const createFaustRemoteServer: (options: {
    root: string;
    cert?: string | Buffer;
    key?: string | Buffer;
    allowOrigins?: string[];
}) => FaustRemoteServer;

export default createFaustRemoteServer;

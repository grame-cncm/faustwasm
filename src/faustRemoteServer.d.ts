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
};

export declare const createFaustRemoteServer: (options: {
    root: string;
    cert?: string | Buffer;
    key?: string | Buffer;
    allowOrigins?: string[];
}) => FaustRemoteServer;

export default createFaustRemoteServer;

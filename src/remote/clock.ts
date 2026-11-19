/**
 * The offset between a remote control's clock and its host's, estimated from
 * ping/pong exchanges as NTP does.
 *
 * For one exchange, `t0` and `t3` are read by the remote control when it sends
 * the ping and receives the pong, `t1` and `t2` by the host when it receives
 * the ping and sends the pong; each side reads its own `performance.now()`:
 *
 *     round trip  δ = (t3 - t0) - (t2 - t1)
 *     offset      θ = ((t1 - t0) + (t2 - t3)) / 2     host time = local time + θ
 *
 * θ is exact when the two legs take the same time, and wrong by half their
 * difference otherwise; queueing lengthens one leg, so the exchange with the
 * shortest round trip is the one to trust. The estimator keeps the last
 * `window` exchanges and answers with that one's offset: it follows a slow
 * drift between the clocks and ignores a congested exchange.
 */
export class FaustRemoteClock {
    private readonly samples: { rtt: number; offset: number }[] = [];

    constructor(private readonly window = 16) {}

    /** Record one exchange. Ignored if its timestamps cannot be right. */
    add(t0: number, t1: number, t2: number, t3: number) {
        const rtt = t3 - t0 - (t2 - t1);
        if (!(rtt >= 0) || !(t2 >= t1)) return;
        this.samples.push({ rtt, offset: (t1 - t0 + (t2 - t3)) / 2 });
        if (this.samples.length > this.window) this.samples.shift();
    }

    /** The exchange the estimate rests on: the shortest round trip kept. */
    private best() {
        let best: { rtt: number; offset: number } | null = null;
        for (const sample of this.samples)
            if (!best || sample.rtt < best.rtt) best = sample;
        return best;
    }

    /** Host time minus local time, in milliseconds; null before any exchange. */
    get offset(): number | null {
        return this.best()?.offset ?? null;
    }

    /** Shortest round trip kept, in milliseconds; NaN before any exchange. */
    get rtt(): number {
        return this.best()?.rtt ?? NaN;
    }

    /** The round trips kept, oldest first. */
    get rtts(): number[] {
        return this.samples.map((sample) => sample.rtt);
    }
}

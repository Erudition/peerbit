import {
	LSession as SSession,
	LibP2POptions as SLibP2POptions,
} from "@peerbit/libp2p-test-utils";
import {
	DirectStream,
	waitForPeers as waitForPeersStreams,
} from "@peerbit/stream";
import {
	Libp2pCreateOptions,
	Libp2pExtendServices,
	Libp2pCreateOptionsWithServices,
} from "peerbit";
import { DirectBlock } from "@peerbit/blocks";
import { DirectSub } from "@peerbit/pubsub";
import { Peerbit } from "peerbit";
import { ProgramClient } from "@peerbit/program";
import { mplex } from "@libp2p/mplex";

export type LibP2POptions = SLibP2POptions<Libp2pExtendServices>;

type CreateOptions = { libp2p?: Libp2pCreateOptions; directory?: string };
export class LSession {
	private session: SSession<Libp2pExtendServices>;
	private _peers: Peerbit[];
	constructor(session: SSession<Libp2pExtendServices>, peers: Peerbit[]) {
		this.session = session;
		this._peers = peers;
	}

	public get peers(): ProgramClient[] {
		return this._peers;
	}

	async connect(groups?: ProgramClient[][]) {
		await this.session.connect(groups?.map((x) => x.map((y) => y)));
		return;
	}
	async stop() {
		await Promise.all(this._peers.map((x) => x.stop()));
		await Promise.all(this._peers.map((x) => x.libp2p.stop())); // beacuse we initialize libp2p externally, we have to close externally
	}

	static async connected(n: number, options?: CreateOptions | CreateOptions[]) {
		const session = await LSession.disconnected(n, options);
		await session.connect();
		// TODO types
		await waitForPeersStreams(
			...session.peers.map((x) => x.services.blocks as any as DirectStream<any>)
		);
		return session;
	}

	static async disconnected(
		n: number,
		options?: CreateOptions | CreateOptions[]
	) {
		const m = (o?: CreateOptions): Libp2pCreateOptionsWithServices => {
			return {
				...o?.libp2p,
				services: {
					blocks: (c) => new DirectBlock(c),
					pubsub: (c) => new DirectSub(c, { canRelayMessage: true }),
					...o?.libp2p?.services,
				},
				streamMuxers: [mplex({ disconnectThreshold: 10 })],
			};
		};
		let optionsWithServices:
			| Libp2pCreateOptionsWithServices
			| Libp2pCreateOptionsWithServices[] = Array.isArray(options)
			? options.map(m)
			: m(options);
		const session = await SSession.disconnected(n, optionsWithServices);
		return new LSession(
			session,
			(await Promise.all(
				session.peers.map((x, ix) =>
					Array.isArray(options)
						? Peerbit.create({ libp2p: x, directory: options[ix]?.directory })
						: Peerbit.create({ libp2p: x, directory: options?.directory })
				)
			)) as Peerbit[]
		);
	}
}

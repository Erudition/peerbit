import type { PeerId as Libp2pPeerId } from "@libp2p/interface/peer-id";
import { Blocks } from "@peerbit/blocks-interface";
import { PubSub } from "@peerbit/pubsub-interface";
import { Ed25519PublicKey, Identity, Keychain } from "@peerbit/crypto";
import type { SimpleLevel } from "@peerbit/lazy-level";
import { Multiaddr } from "@multiformats/multiaddr";
import { Address } from "./address.js";
import { CanOpen, Manageable, OpenOptions } from "./handler.js";

export interface Client<T extends Manageable<any>> {
	peerId: Libp2pPeerId;
	identity: Identity<Ed25519PublicKey>;
	getMultiaddrs: () => Multiaddr[];
	dial(address: string | Multiaddr | Multiaddr[]): Promise<boolean>;
	services: {
		pubsub: PubSub;
		blocks: Blocks;
	};
	memory: SimpleLevel;
	keychain: Keychain;
	start(): Promise<void>;
	stop(): Promise<void>;
	open<S extends T & CanOpen<Args>, Args = any>(
		program: S | Address,
		options?: OpenOptions<Args, S>
	): Promise<S>;
}

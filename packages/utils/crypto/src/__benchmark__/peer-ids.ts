import B from "benchmark";
import { Ed25519Keypair, Ed25519PublicKey } from "../ed25519.js";
import { createEd25519PeerId } from "@libp2p/peer-id-factory";
import { deserialize, serialize } from "@dao-xyz/borsh";
import { peerIdFromBytes, peerIdFromKeys } from "@libp2p/peer-id";
//node --loader ts-node/esm ./src/__benchmark__/peer-ids.ts

const keypair = await Ed25519Keypair.create();
const peerId = await createEd25519PeerId();
const peerIdPublicKey = await peerIdFromKeys(peerId.publicKey);
const suite = new B.Suite("ed25519");
suite
	.add("PublicSignKey", {
		fn: async () => {
			deserialize(serialize(keypair.publicKey), Ed25519PublicKey);
		},
	})
	.add("PeerId ", {
		fn: () => {
			peerIdFromBytes(peerIdPublicKey.toBytes());
		},
	})
	.on("error", (error: any) => {
		throw error;
	})
	.on("cycle", (event: any) => {
		console.log(String(event.target));
	})
	.run();

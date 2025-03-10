import B from "benchmark";
import { LSession } from "@peerbit/libp2p-test-utils";
import { DirectSub } from "../index.js";
import crypto from "crypto";
import { waitForPeers } from "@peerbit/stream";
import { tcp } from "@libp2p/tcp";

// Run with "node --loader ts-node/esm ./src/__benchmark__/index.ts"
// size: 1kb x 1,722 ops/sec ±1.89% (82 runs sampled)
// size: 1000kb x 107 ops/sec ±2.02% (85 runs sampled)

const session = await LSession.disconnected(4, {
	transports: [tcp()],
	services: {
		pubsub: (c) =>
			new DirectSub(c, {
				canRelayMessage: true,
				emitSelf: true,
				connectionManager: {
					autoDial: false,
				},
			}),
	},
});

await session.connect([
	[session.peers[0], session.peers[1]],
	[session.peers[1], session.peers[2]],
	[session.peers[2], session.peers[3]],
]);

/* 
┌─┐
│1│
└┬┘
┌▽┐
│2│
└┬┘
┌▽┐
│3│
└┬┘
┌▽┐
│4│
└─┘

 */

const TOPIC = "world";
session.peers[session.peers.length - 1].services.pubsub.subscribe(TOPIC);
await waitForPeers(
	session.peers[0].services.pubsub,
	session.peers[1].services.pubsub
);
await waitForPeers(
	session.peers[1].services.pubsub,
	session.peers[2].services.pubsub
);
await waitForPeers(
	session.peers[2].services.pubsub,
	session.peers[3].services.pubsub
);
let suite = new B.Suite();
let listener: ((msg: any) => any) | undefined = undefined;
const msgMap: Map<string, { resolve: () => any }> = new Map();
const msgIdFn = (msg: Uint8Array) =>
	crypto.createHash("sha1").update(msg.subarray(0, 20)).digest("base64");

const sizes = [1e3, 1e6];
for (const size of sizes) {
	suite = suite.add("size: " + size / 1e3 + "kb", {
		defer: true,
		fn: (deferred) => {
			const small = crypto.randomBytes(size); // 1kb
			msgMap.set(msgIdFn(small), deferred);
			session.peers[0].services.pubsub.publish(small, { topics: [TOPIC] });
		},
		setup: () => {
			listener = (msg) => {
				msgMap.get(msgIdFn(msg.detail.data))!.resolve();
			};

			session.peers[session.peers.length - 1].services.pubsub.addEventListener(
				"data",
				listener
			);
			msgMap.clear();
		},
		teardown: () => {
			session.peers[
				session.peers.length - 1
			].services.pubsub.removeEventListener("data", listener);
		},
	});
}
suite
	.on("cycle", (event: any) => {
		console.log(String(event.target));
	})
	.on("error", (e) => {
		console.error(e);
		throw e;
	})
	.on("complete", function (this: any, ...args: any[]) {
		session.stop();
	})
	.run({ async: true });

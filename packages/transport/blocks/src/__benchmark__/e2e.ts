import B from "benchmark";
import { LSession } from "@peerbit/libp2p-test-utils";
import { waitForPeers } from "@peerbit/stream";
import { delay } from "@peerbit/time";
import crypto from "crypto";
import { DirectBlock, stringifyCid } from "../index.js";
import { createBlock, getBlockValue } from "../block.js";
import { tcp } from "@libp2p/tcp";

// Run with "node --loader ts-node/esm ./src/__benchmark__/e2e.ts"
// size: 1kb x 827 ops/sec ±2.03% (87 runs sampled)
// size: 1000kb x 40.51 ops/sec ±4.09% (62 runs sampled)

const session: LSession<{ blocks: DirectBlock }> = await LSession.disconnected(
	4,
	{
		transports: [tcp()],
		services: {
			blocks: (c) => new DirectBlock(c),
		},
	}
);

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

await session.connect([
	[session.peers[0], session.peers[1]],
	[session.peers[1], session.peers[2]],
	[session.peers[2], session.peers[3]],
]);

await session.connect();
await waitForPeers(
	session.peers[0].services.blocks,
	session.peers[1].services.blocks
);
await waitForPeers(
	session.peers[1].services.blocks,
	session.peers[2].services.blocks
);
await waitForPeers(
	session.peers[2].services.blocks,
	session.peers[3].services.blocks
);
await delay(3000);

const largeRandom: Uint8Array[] = [];
for (let i = 0; i < 100; i++) {
	largeRandom.push(crypto.randomBytes(1e6));
}

const smallRandom: Uint8Array[] = [];
const t1 = +new Date();
for (let i = 0; i < 1000; i++) {
	smallRandom.push(crypto.randomBytes(1e3));
}

const sizes = [1e3, 1e6];
let suite = new B.Suite("_", { minSamples: 1, initCount: 1, maxTime: 5 });
for (const size of sizes) {
	suite = suite.add("size: " + size / 1e3 + "kb", {
		defer: true,
		async: true,
		fn: async (deferred) => {
			{
				const rng = crypto.randomBytes(size);
				const cid = await session.peers[0].services.blocks.put(rng);
				await session.peers[session.peers.length - 1].services.blocks.get(
					stringifyCid(cid)
				);
				deferred.resolve();
			}
		},
	});
}
suite
	.on("cycle", (event: any) => {
		console.log(String(event.target));
	})
	.on("complete", function (this: any, ...args: any[]) {
		session.stop();
	})
	.run({ async: true });

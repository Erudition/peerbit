import B from "benchmark";
import { deserialize, field, option, serialize, variant } from "@dao-xyz/borsh";
import { LSession } from "@peerbit/test-utils";
import { ProgramClient } from "@peerbit/program";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { Program } from "@peerbit/program";
import { Replicator, SharedLog, Args } from "../index.js";

// Run with "node --loader ts-node/esm ./src/__benchmark__/index.ts"

@variant("document")
class Document {
	@field({ type: "string" })
	id: string;

	@field({ type: option("string") })
	name?: string;

	@field({ type: option("u64") })
	number?: bigint;

	@field({ type: Uint8Array })
	bytes: Uint8Array;

	constructor(opts: Document) {
		if (opts) {
			this.id = opts.id;
			this.name = opts.name;
			this.number = opts.number;
			this.bytes = opts.bytes;
		}
	}
}

@variant("test_shared_log")
class TestStore extends Program<Args<Document>> {
	@field({ type: SharedLog })
	logs: SharedLog<Document>;

	constructor(properties?: { logs: SharedLog<Document> }) {
		super();
		this.logs = properties?.logs || new SharedLog();
	}

	async open(options?: Args<Document>): Promise<void> {
		await this.logs.open({
			...options,
			encoding: {
				decoder: (bytes) => deserialize(bytes, Document),
				encoder: (data) => serialize(data),
			},
		});
	}
}

const peersCount = 1;
const session = await LSession.connected(peersCount);

const store = new TestStore({
	logs: new SharedLog<Document>({
		id: new Uint8Array(32),
	}),
});

const client: ProgramClient = session.peers[0];
await client.open<TestStore, Args<Document>>(store, {
	args: {
		role: new Replicator(),
		trim: { type: "length" as const, to: 100 },
		onChange: (change) => {
			change.added.forEach(async (entry) => {
				const doc = await entry.getPayloadValue();
				resolver.get(doc.id)!();
				resolver.delete(doc.id);
			});
		},
	},
});

const resolver: Map<string, () => void> = new Map();
const suite = new B.Suite();
suite
	.add("put", {
		fn: async (deferred) => {
			const doc = new Document({
				id: uuid(),
				name: "hello",
				number: 1n,
				bytes: crypto.randomBytes(1200),
			});
			resolver.set(doc.id, () => {
				deferred.resolve();
			});
			await store.logs.append(doc, { meta: { next: [] } });
		},

		minSamples: 300,
		defer: true,
	})
	.on("cycle", (event: any) => {
		console.log(String(event.target));
	})
	.on("error", (err) => {
		throw err;
	})
	.on("complete", async function (this: any, ...args: any[]) {
		await store.drop();
		await session.stop();
	})
	.run();

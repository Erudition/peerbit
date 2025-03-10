import assert from "assert";
import { Entry, EntryType } from "../entry.js";
import { Log } from "../log.js";
import { compare } from "@peerbit/uint8arrays";
import { LSession, createStore } from "@peerbit/test-utils";
import { Ed25519Keypair } from "@peerbit/crypto";
import LazyLevel from "@peerbit/lazy-level";

const last = (arr: any[]) => {
	return arr[arr.length - 1];
};

const checkedStorage = async (log: Log<any>) => {
	for (const value of await log.values.toArray()) {
		expect(await log.storage.has(value.hash)).toBeTrue();
	}
};

describe("join", function () {
	let session: LSession;

	let signKey: Ed25519Keypair,
		signKey2: Ed25519Keypair,
		signKey3: Ed25519Keypair,
		signKey4: Ed25519Keypair;
	beforeAll(async () => {
		const keys: Ed25519Keypair[] = [
			await Ed25519Keypair.create(),
			await Ed25519Keypair.create(),
			await Ed25519Keypair.create(),
			await Ed25519Keypair.create(),
		];
		keys.sort((a, b) => {
			return compare(a.publicKey.publicKey, b.publicKey.publicKey);
		});
		signKey = keys[0];
		signKey2 = keys[1];
		signKey3 = keys[2];
		signKey4 = keys[3];
		session = await LSession.connected(3);
		await session.peers[1].services.blocks.waitFor(session.peers[0].peerId);
		await session.peers[2].services.blocks.waitFor(session.peers[0].peerId);
		await session.peers[2].services.blocks.waitFor(session.peers[1].peerId);
	});

	afterAll(async () => {
		await session.stop();
	});

	describe("join", () => {
		let log1: Log<Uint8Array>,
			log2: Log<Uint8Array>,
			log3: Log<Uint8Array>,
			log4: Log<Uint8Array>;

		beforeEach(async () => {
			const logOptions = {};
			log1 = new Log<Uint8Array>();
			await log1.open(session.peers[0].services.blocks, signKey, logOptions);
			log2 = new Log<Uint8Array>();
			let log2Cache = new LazyLevel(createStore());
			await log2Cache.open();
			await log2.open(session.peers[1].services.blocks, signKey2, {
				...logOptions,
				cache: log2Cache,
			});
			log3 = new Log<Uint8Array>();
			await log3.open(session.peers[2].services.blocks, signKey3, logOptions);
			log4 = new Log<Uint8Array>();
			await log4.open(
				session.peers[2].services.blocks, // [2] because we cannot create more than 3 peers when running tests in CI
				signKey4,
				logOptions
			);
		});

		it("joins logs", async () => {
			const items1: Entry<Uint8Array>[] = [];
			const items2: Entry<Uint8Array>[] = [];
			const items3: Entry<Uint8Array>[] = [];
			const amount = 100;

			for (let i = 1; i <= amount; i++) {
				const prev1 = last(items1);
				const prev2 = last(items2);
				const prev3 = last(items3);
				const n1 = await Entry.create({
					store: session.peers[0].services.blocks,
					identity: {
						...signKey,
						sign: async (data: Uint8Array) => await signKey.sign(data),
					},
					meta: {
						gidSeed: Buffer.from("X" + i),
						next: prev1 ? [prev1] : undefined,
					},
					data: new Uint8Array([0, i]),
				});
				const n2 = await Entry.create({
					store: session.peers[0].services.blocks,
					identity: {
						...signKey2,
						sign: async (data: Uint8Array) => await signKey2.sign(data),
					},
					meta: {
						next: prev2 ? [prev2, n1] : [n1],
					},
					data: new Uint8Array([1, i]),
				});
				const n3 = await Entry.create({
					store: session.peers[1].services.blocks,
					identity: {
						...signKey3,
						sign: async (data: Uint8Array) => await signKey3.sign(data),
					},
					data: new Uint8Array([2, i]),
					meta: {
						next: prev3 ? [prev3, n1, n2] : [n1, n2],
					},
				});

				items1.push(n1);
				items2.push(n2);
				items3.push(n3);
			}

			// Here we're creating a log from entries signed by A and B
			// but we accept entries from C too
			const logA = await Log.fromEntry(
				session.peers[0].services.blocks,
				signKey3,
				last(items2),
				{ timeout: 3000 }
			);

			// Here we're creating a log from entries signed by peer A, B and C
			// "logA" accepts entries from peer C so we can join logs A and B
			const logB = await Log.fromEntry(
				session.peers[1].services.blocks,
				signKey3,
				last(items3),
				{ timeout: 3000 }
			);
			expect(logA.length).toEqual(items2.length + items1.length);
			expect(logB.length).toEqual(
				items3.length + items2.length + items1.length
			);

			expect((await logA.getHeads()).length).toEqual(1);
			await logA.join(await logB.getHeads());

			expect(logA.length).toEqual(
				items3.length + items2.length + items1.length
			);
			// The last Entry<T>, 'entryC100', should be the only head
			// (it points to entryB100, entryB100 and entryC99)
			expect((await logA.getHeads()).length).toEqual(1);

			await checkedStorage(logA);
			await checkedStorage(logB);
		});

		it("will update cache", async () => {
			// Expect log2 to use memory cache
			expect(log2.headsIndex.headsCache).toBeDefined();

			await log1.append(new Uint8Array([0, 1]));
			await log2.join(await log1.getHeads());
			await log2.load();
			expect(await log2.getHeads()).toHaveLength(1);
			expect(await log2.values.length).toEqual(1);
		});

		it("joins only unique items", async () => {
			await log1.append(new Uint8Array([0, 1]));
			await log2.append(new Uint8Array([1, 0]));
			await log1.append(new Uint8Array([0, 2]));
			await log2.append(new Uint8Array([1, 1]));
			await log1.join(await log2.getHeads());
			await log1.join(await log2.getHeads());

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
			];

			expect(log1.length).toEqual(4);
			expect(
				(await log1.toArray()).map(
					(e) => new Uint8Array(e.payload.getValue(log1.encoding))
				)
			).toEqual(expectedData);

			const item = last(await log1.toArray());
			expect(item.next.length).toEqual(1);
			expect((await log1.getHeads()).length).toEqual(2);
		});

		describe("cut", () => {
			let fetchEvents: number;
			let fetchHashes: Set<string>;
			let fromMultihash: any;
			beforeAll(() => {
				fetchEvents = 0;
				fetchHashes = new Set();
				fromMultihash = Entry.fromMultihash;

				// TODO monkeypatching might lead to sideeffects in other tests!
				Entry.fromMultihash = (s, h, o) => {
					fetchHashes.add(h);
					fetchEvents += 1;
					return fromMultihash(s, h, o);
				};
			});
			afterAll(() => {
				fetchHashes = new Set();
				fetchEvents = 0;
				Entry.fromMultihash = fromMultihash;
			});

			it("joins cut", async () => {
				const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
				const { entry: b1 } = await log2.append(new Uint8Array([1, 0]), {
					meta: {
						next: [a1],
						type: EntryType.CUT,
					},
				});
				const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
				await log1.join(await log2.getHeads());
				expect((await log1.toArray()).map((e) => e.hash)).toEqual([
					a1.hash,
					b1.hash,
					a2.hash,
				]);
				const { entry: b2 } = await log2.append(new Uint8Array([1, 0]), {
					meta: {
						next: [a2],
						type: EntryType.CUT,
					},
				});
				await log1.join(await log2.getHeads());
				expect((await log1.getHeads()).map((e) => e.hash)).toEqual([
					b1.hash,
					b2.hash,
				]);
				expect((await log1.toArray()).map((e) => e.hash)).toEqual([
					b1.hash,
					b2.hash,
				]);
			});

			it("will not reset if joining conflicting", async () => {
				const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
				const b1 = await Entry.create({
					data: new Uint8Array([1, 0]),
					meta: {
						type: EntryType.CUT,
						next: [a1],
					},
					identity: log1.identity,
					store: log1.storage,
				});
				const b2 = await Entry.create({
					data: new Uint8Array([1, 1]),
					meta: {
						type: EntryType.APPEND,
						next: [a1],
					},
					identity: log1.identity,
					store: log1.storage,
				});

				// We need to store a1 somewhere else, becuse log1 will temporarely delete the block since due to the merge order
				// TODO make this work even though there is not a third party helping
				await log2.storage.get(a1.hash, { replicate: true });
				expect(await log2.storage.get(a1.hash)).toBeDefined();
				await log1.join([b1, b2]);
				expect((await log1.toArray()).map((e) => e.hash)).toEqual([
					a1.hash,
					b1.hash,
					b2.hash,
				]);
			});

			it("will not reset if joining conflicting (reversed)", async () => {
				const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
				const b1 = await Entry.create({
					data: new Uint8Array([1, 0]),
					meta: {
						type: EntryType.APPEND,
						next: [a1],
					},
					identity: log1.identity,
					store: log1.storage,
				});
				const b2 = await Entry.create({
					data: new Uint8Array([1, 1]),
					meta: {
						type: EntryType.CUT,
						next: [a1],
					},
					identity: log1.identity,
					store: log1.storage,
				});
				await log1.join([b1, b2]);
				expect((await log1.toArray()).map((e) => e.hash)).toEqual([
					a1.hash,
					b1.hash,
					b2.hash,
				]);
			});

			it("joining multiple resets", async () => {
				const { entry: a1 } = await log2.append(new Uint8Array([0, 1]));
				const { entry: b1 } = await log2.append(new Uint8Array([1, 0]), {
					meta: {
						next: [a1],
						type: EntryType.CUT,
					},
				});
				const { entry: b2 } = await log2.append(new Uint8Array([1, 1]), {
					meta: {
						next: [a1],
						type: EntryType.CUT,
					},
				});

				expect((await log2.getHeads()).map((x) => x.hash)).toEqual([
					b1.hash,
					b2.hash,
				]);
				fetchEvents = 0;
				await log1.join(await log2.getHeads());
				expect(fetchEvents).toEqual(0); // will not fetch a1 since b1 and b2 is CUT (no point iterating to nexts)
				expect((await log1.toArray()).map((e) => e.hash)).toEqual([
					b1.hash,
					b2.hash,
				]);
			});
		});

		it("joins heads", async () => {
			const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
			const { entry: b1 } = await log2.append(new Uint8Array([1, 0]), {
				meta: { next: [a1] },
			});

			expect(log1.length).toEqual(1);
			expect(log2.length).toEqual(1);

			await log1.join(await log2.getHeads());
			const expectedData = [new Uint8Array([0, 1]), new Uint8Array([1, 0])];
			expect(log1.length).toEqual(2);
			expect(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);

			const item = last(await log1.toArray());
			expect(item.next.length).toEqual(1);
			expect((await log1.getHeads()).map((x) => x.hash)).toEqual([b1.hash]);
		});

		it("joins concurrently", async () => {
			let expectedData: Uint8Array[] = [];
			let len = 2;
			let entries: Entry<any>[] = [];
			for (let i = 0; i < len; i++) {
				expectedData.push(new Uint8Array([i]));
				entries.push((await log2.append(new Uint8Array([i]))).entry);
			}
			let promises: Promise<any>[] = [];
			for (let i = 0; i < len; i++) {
				promises.push(log1.join([entries[i]]));
			}

			await Promise.all(promises);

			expect(log1.length).toEqual(len);
			expect(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);

			const item = last(await log1.toArray());
			let allHeads = await log1.getHeads();
			expect(allHeads.length).toEqual(1);
			expect(item.next.length).toEqual(1);
		});

		it("joins with extra references", async () => {
			const e1 = await log1.append(new Uint8Array([0, 1]));
			const e2 = await log1.append(new Uint8Array([0, 2]));
			const e3 = await log1.append(new Uint8Array([0, 3]));
			expect(log1.length).toEqual(3);
			await log2.join([e1.entry, e2.entry, e3.entry]);
			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([0, 2]),
				new Uint8Array([0, 3]),
			];
			expect(log2.length).toEqual(3);
			expect(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);
			const item = last(await log1.toArray());
			expect(item.next.length).toEqual(1);
			expect((await log1.getHeads()).length).toEqual(1);
		});

		it("joins logs two ways", async () => {
			const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
			const { entry: b1 } = await log2.append(new Uint8Array([1, 0]));
			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			const { entry: b2 } = await log2.append(new Uint8Array([1, 1]));
			await log1.join(await log2.getHeads());
			await log2.join(await log1.getHeads());

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
			];

			expect(await log1.getHeads()).toContainAllValues([a2, b2]);
			expect(await log2.getHeads()).toContainAllValues([a2, b2]);
			expect(a2.next).toContainAllValues([a1.hash]);
			expect(b2.next).toContainAllValues([b1.hash]);

			expect((await log1.toArray()).map((e) => e.hash)).toEqual(
				(await log2.toArray()).map((e) => e.hash)
			);
			expect(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);
			expect(
				(await log2.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);
		});

		it("joins logs twice", async () => {
			const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
			const { entry: b1 } = await log2.append(new Uint8Array([1, 0]));
			await log2.join(await log1.getHeads());
			expect(log2.length).toEqual(2);
			expect(await log2.getHeads()).toContainAllValues([a1, b1]);

			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			const { entry: b2 } = await log2.append(new Uint8Array([1, 1]));
			await log2.join(await log1.getHeads());

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
			];

			expect(
				(await log2.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);
			expect(log2.length).toEqual(4);

			expect(await log1.getHeads()).toContainAllValues([a2]);
			expect(await log2.getHeads()).toContainAllValues([a2, b2]);
		});

		it("joins 2 logs two ways", async () => {
			await log1.append(new Uint8Array([0, 1]));
			await log2.append(new Uint8Array([1, 0]));
			await log2.join(await log1.getHeads());
			await log1.join(await log2.getHeads());
			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			const { entry: b2 } = await log2.append(new Uint8Array([1, 1]));
			await log2.join(await log1.getHeads());

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
			];

			expect(log2.length).toEqual(4);
			assert.deepStrictEqual(
				(await log2.toArray()).map((e) => new Uint8Array(e.payload.getValue())),
				expectedData
			);

			expect(await log1.getHeads()).toContainAllValues([a2]);
			expect(await log2.getHeads()).toContainAllValues([a2, b2]);
		});

		it("joins 2 logs two ways and has the right heads at every step", async () => {
			await log1.append(new Uint8Array([0, 1]));
			expect((await log1.getHeads()).length).toEqual(1);
			expect((await log1.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([0, 1])
			);

			await log2.append(new Uint8Array([1, 0]));
			expect((await log2.getHeads()).length).toEqual(1);
			expect((await log2.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([1, 0])
			);

			await log2.join(await log1.getHeads());
			expect((await log2.getHeads()).length).toEqual(2);
			expect((await log2.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([1, 0])
			);
			expect((await log2.getHeads())[1].payload.getValue()).toEqual(
				new Uint8Array([0, 1])
			);

			await log1.join(await log2.getHeads());
			expect((await log1.getHeads()).length).toEqual(2);
			expect((await log1.getHeads())[1].payload.getValue()).toEqual(
				new Uint8Array([1, 0])
			);
			expect((await log1.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([0, 1])
			);

			await log1.append(new Uint8Array([0, 2]));
			expect((await log1.getHeads()).length).toEqual(1);
			expect((await log1.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([0, 2])
			);

			await log2.append(new Uint8Array([1, 1]));
			expect((await log2.getHeads()).length).toEqual(1);
			expect((await log2.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([1, 1])
			);

			await log2.join(await log1.getHeads());
			expect((await log2.getHeads()).length).toEqual(2);
			expect((await log2.getHeads())[0].payload.getValue()).toEqual(
				new Uint8Array([1, 1])
			);
			expect((await log2.getHeads())[1].payload.getValue()).toEqual(
				new Uint8Array([0, 2])
			);
		});

		it("joins 4 logs to one", async () => {
			// order determined by identity's publicKey
			await log1.append(new Uint8Array([0, 1]));
			await log2.append(new Uint8Array([1, 0]));
			await log3.append(new Uint8Array([2, 0]));
			await log4.append(new Uint8Array([3, 0]));
			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			const { entry: b2 } = await log2.append(new Uint8Array([1, 1]));
			const { entry: c2 } = await log3.append(new Uint8Array([2, 1]));
			const { entry: d2 } = await log4.append(new Uint8Array([3, 1]));
			await log1.join(await log2.getHeads());
			await log1.join(await log3.getHeads());
			await log1.join(await log4.getHeads());

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([2, 0]),
				new Uint8Array([3, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
				new Uint8Array([2, 1]),
				new Uint8Array([3, 1]),
			];

			expect(log1.length).toEqual(8);
			expect(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			).toEqual(expectedData);

			expect(await log1.getHeads()).toContainAllValues([a2, b2, c2, d2]);
		});

		it("joins 4 logs to one is commutative", async () => {
			await log1.append(new Uint8Array([0, 1]));
			await log1.append(new Uint8Array([0, 2]));
			await log2.append(new Uint8Array([1, 0]));
			await log2.append(new Uint8Array([1, 1]));
			await log3.append(new Uint8Array([2, 0]));
			await log3.append(new Uint8Array([2, 1]));
			await log4.append(new Uint8Array([3, 0]));
			await log4.append(new Uint8Array([3, 1]));
			await log1.join(await log2.getHeads());
			await log1.join(await log3.getHeads());
			await log1.join(await log4.getHeads());
			await log2.join(await log1.getHeads());
			await log2.join(await log3.getHeads());
			await log2.join(await log4.getHeads());

			expect(log1.length).toEqual(8);
			assert.deepStrictEqual(
				(await log1.toArray()).map((e) => new Uint8Array(e.payload.getValue())),
				(await log2.toArray()).map((e) => new Uint8Array(e.payload.getValue()))
			);
		});

		it("joins logs and updates clocks", async () => {
			const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
			const { entry: b1 } = await log2.append(new Uint8Array([1, 0]));
			await log2.join(await log1.getHeads());
			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			const { entry: b2 } = await log2.append(new Uint8Array([1, 1]));

			expect(a2.meta.clock.id).toEqual(signKey.publicKey.bytes);
			expect(b2.meta.clock.id).toEqual(signKey2.publicKey.bytes);
			expect(
				a2.meta.clock.timestamp.compare(a1.meta.clock.timestamp)
			).toBeGreaterThan(0);
			expect(
				b2.meta.clock.timestamp.compare(b1.meta.clock.timestamp)
			).toBeGreaterThan(0);

			await log3.join(await log1.getHeads());

			await log3.append(new Uint8Array([2, 0]));
			const { entry: c2 } = await log3.append(new Uint8Array([2, 1]));
			await log1.join(await log3.getHeads());
			await log1.join(await log2.getHeads());
			await log4.append(new Uint8Array([3, 0]));
			const { entry: d2 } = await log4.append(new Uint8Array([3, 1]));
			await log4.join(await log2.getHeads());
			await log4.join(await log1.getHeads());
			await log4.join(await log3.getHeads());
			const { entry: d3 } = await log4.append(new Uint8Array([3, 2]));
			expect(d3.gid).toEqual(
				[a1.gid, a2.gid, b2.gid, c2.gid, d2.gid].sort()[0]
			);
			await log4.append(new Uint8Array([3, 3]));
			await log1.join(await log4.getHeads());
			await log4.join(await log1.getHeads());
			const { entry: d5 } = await log4.append(new Uint8Array([3, 4]));
			expect(d5.gid).toEqual(
				[a1.gid, a2.gid, b2.gid, c2.gid, d2.gid, d3.gid, d5.gid].sort()[0]
			);

			const { entry: a5 } = await log1.append(new Uint8Array([0, 4]));
			expect(a5.gid).toEqual(
				[a1.gid, a2.gid, b2.gid, c2.gid, d2.gid, d3.gid, d5.gid].sort()[0]
			);

			await log4.join(await log1.getHeads());
			const { entry: d6 } = await log4.append(new Uint8Array([3, 5]));
			expect(d5.gid).toEqual(a5.gid);
			expect(d6.gid).toEqual(a5.gid);

			const expectedData = [
				{
					payload: new Uint8Array([0, 1]),
					gid: a1.gid,
				},
				{
					payload: new Uint8Array([1, 0]),
					gid: b1.gid,
				},

				{
					payload: new Uint8Array([0, 2]),
					gid: a2.gid,
				},
				{
					payload: new Uint8Array([1, 1]),
					gid: b2.gid,
				},
				{
					payload: new Uint8Array([2, 0]),
					gid: a1.gid,
				},
				{
					payload: new Uint8Array([2, 1]),
					gid: c2.gid,
				},
				{
					payload: new Uint8Array([3, 0]),
					gid: d2.gid,
				},
				{
					payload: new Uint8Array([3, 1]),
					gid: d2.gid,
				},
				{
					payload: new Uint8Array([3, 2]),
					gid: d3.gid,
				},
				{
					payload: new Uint8Array([3, 3]),
					gid: d3.gid,
				},
				{
					payload: new Uint8Array([3, 4]),
					gid: d5.gid,
				},
				{
					payload: new Uint8Array([0, 4]),
					gid: a5.gid,
				},
				{
					payload: new Uint8Array([3, 5]),
					gid: d6.gid,
				},
			];

			const transformed = (await log4.toArray()).map((e) => {
				return {
					payload: new Uint8Array(e.payload.getValue()),
					gid: e.gid,
				};
			});

			expect(log4.length).toEqual(13);
			expect(transformed).toEqual(expectedData);
		});

		it("joins logs from 4 logs", async () => {
			const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
			await log1.join(await log2.getHeads());
			const { entry: b1 } = await log2.append(new Uint8Array([1, 0]));
			await log2.join(await log1.getHeads());
			const { entry: a2 } = await log1.append(new Uint8Array([0, 2]));
			await log2.append(new Uint8Array([1, 1]));

			await log1.join(await log3.getHeads());
			// Sometimes failes because of clock ids are random TODO Fix
			expect(
				(await log1.getHeads())[(await log1.getHeads()).length - 1].gid
			).toEqual(a1.gid);
			expect(a2.meta.clock.id).toEqual(signKey.publicKey.bytes);
			expect(
				a2.meta.clock.timestamp.compare(a1.meta.clock.timestamp)
			).toBeGreaterThan(0);

			await log3.join(await log1.getHeads());
			expect(
				(await log3.getHeads())[(await log3.getHeads()).length - 1].gid
			).toEqual(a1.gid); // because longest

			await log3.append(new Uint8Array([2, 0]));
			await log3.append(new Uint8Array([2, 1]));
			await log1.join(await log3.getHeads());
			await log1.join(await log2.getHeads());
			await log4.append(new Uint8Array([3, 0]));
			await log4.append(new Uint8Array([3, 1]));
			await log4.join(await log2.getHeads());
			await log4.join(await log1.getHeads());
			await log4.join(await log3.getHeads());
			await log4.append(new Uint8Array([3, 2]));
			const { entry: d4 } = await log4.append(new Uint8Array([3, 3]));

			expect(d4.meta.clock.id).toEqual(signKey4.publicKey.bytes);

			const expectedData = [
				new Uint8Array([0, 1]),
				new Uint8Array([1, 0]),
				new Uint8Array([0, 2]),
				new Uint8Array([1, 1]),
				new Uint8Array([2, 0]),
				new Uint8Array([2, 1]),
				new Uint8Array([3, 0]),
				new Uint8Array([3, 1]),
				new Uint8Array([3, 2]),
				new Uint8Array([3, 3]),
			];

			expect(log4.length).toEqual(10);
			assert.deepStrictEqual(
				(await log4.toArray()).map((e) => new Uint8Array(e.payload.getValue())),
				expectedData
			);
		});

		describe("entry-with-references", () => {
			let fetchCounter = 0;
			let joinEntryCounter = 0;
			let fromMultihashOrg: any;
			beforeAll(() => {
				fromMultihashOrg = Entry.fromMultihash;
				Entry.fromMultihash = (s, h, o) => {
					fetchCounter += 1;
					return fromMultihashOrg(s, h, o);
				};
			});
			afterAll(() => {
				Entry.fromMultihash = fromMultihashOrg;
			});

			beforeEach(() => {
				const joinEntryFn = log2["joinEntry"].bind(log2);
				log2["joinEntry"] = (e, n, s, o) => {
					joinEntryCounter += 1;
					return joinEntryFn(e, n, s, o);
				};
				fetchCounter = 0;
				joinEntryCounter = 0;
			});

			it("joins with references", async () => {
				const { entry: a1 } = await log1.append(new Uint8Array([0, 1]));
				const { entry: a2 } = await log1.append(new Uint8Array([0, 2]), {
					meta: { next: [a1] },
				});
				await log2.join([{ entry: a2, references: [a1] }]);
				expect(log2.values.length).toEqual(2);
				expect(fetchCounter).toEqual(0); // no fetches since all entries where passed
				expect(joinEntryCounter).toEqual(2);
			});
		});
		// TODO move this into the prune test file
		describe("join and prune", () => {
			beforeEach(async () => {
				await log1.append(new Uint8Array([0, 1]));
				await log2.append(new Uint8Array([1, 0]));
				await log1.append(new Uint8Array([0, 2]));
				await log2.append(new Uint8Array([1, 1]));
			});

			it("joins only specified amount of entries - one entry", async () => {
				await log1.join(await log2.getHeads());
				await log1.trim({ type: "length", to: 1 });

				const expectedData = [new Uint8Array([1, 1])];
				const lastEntry = last(await log1.toArray());

				expect(log1.length).toEqual(1);
				assert.deepStrictEqual(
					(await log1.toArray()).map(
						(e) => new Uint8Array(e.payload.getValue())
					),
					expectedData
				);
				expect(lastEntry.next.length).toEqual(1);
			});

			it("joins only specified amount of entries - two entries", async () => {
				await log1.join(await log2.getHeads());
				await log1.trim({ type: "length", to: 2 });

				const expectedData = [new Uint8Array([0, 2]), new Uint8Array([1, 1])];
				const lastEntry = last(await log1.toArray());

				expect(log1.length).toEqual(2);
				expect(
					(await log1.toArray()).map(
						(e) => new Uint8Array(e.payload.getValue())
					)
				).toEqual(expectedData);
				expect(lastEntry.next.length).toEqual(1);
			});

			it("joins only specified amount of entries - three entries", async () => {
				await log1.join(await log2.getHeads());
				await log1.trim({ type: "length", to: 3 });

				const expectedData = [
					new Uint8Array([1, 0]),
					new Uint8Array([0, 2]),
					new Uint8Array([1, 1]),
				];
				const lastEntry = last(await log1.toArray());

				expect(log1.length).toEqual(3);
				expect(
					(await log1.toArray()).map(
						(e) => new Uint8Array(e.payload.getValue())
					)
				).toEqual(expectedData);
				expect(lastEntry.next.length).toEqual(1);
			});

			it("joins only specified amount of entries - (all) four entries", async () => {
				await log1.join(await log2.getHeads());
				await log1.trim({ type: "length", to: 4 });

				const expectedData = [
					new Uint8Array([0, 1]),
					new Uint8Array([1, 0]),
					new Uint8Array([0, 2]),
					new Uint8Array([1, 1]),
				];
				const lastEntry = last(await log1.toArray());

				expect(log1.length).toEqual(4);
				expect(
					(await log1.toArray()).map(
						(e) => new Uint8Array(e.payload.getValue())
					)
				).toEqual(expectedData);
				expect(lastEntry.next.length).toEqual(1);
			});
		});
	});
});

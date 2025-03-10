import { field, fixedArray, serialize, variant } from "@dao-xyz/borsh";
import {
	Documents,
	DocumentIndex,
	SearchRequest,
	StringMatch,
} from "@peerbit/document";
import { PublicSignKey } from "@peerbit/crypto";
import { concat } from "uint8arrays";
import { RPC } from "@peerbit/rpc";
import { sha256Sync } from "@peerbit/crypto";

export type RelationResolver = {
	resolve: (
		key: PublicSignKey,
		db: Documents<IdentityRelation>
	) => Promise<IdentityRelation[]>;
	next: (relation: IdentityRelation) => PublicSignKey;
};

export const getFromByTo: RelationResolver = {
	resolve: async (to: PublicSignKey, db: Documents<IdentityRelation>) => {
		return Promise.all(
			await db.index.search(
				new SearchRequest({
					query: [
						new StringMatch({
							key: "to",
							value: to.hashcode(),
						}),
					],
				}),
				{
					local: true,
					remote: false,
				}
			)
		);
	},
	next: (relation) => relation.from,
};

export const getToByFrom: RelationResolver = {
	resolve: async (from: PublicSignKey, db: Documents<IdentityRelation>) => {
		return Promise.all(
			await db.index.search(
				new SearchRequest({
					query: [
						new StringMatch({
							key: "from",
							value: from.hashcode(),
						}),
					],
				}),
				{
					local: true,
					remote: false,
				}
			)
		);
	},
	next: (relation) => relation.to,
};

export async function* getPathGenerator(
	from: PublicSignKey,
	db: Documents<IdentityRelation>,
	resolver: RelationResolver
) {
	let iter = [from];
	const visited = new Set();
	while (iter.length > 0) {
		const newIter: PublicSignKey[] = [];
		for (const value of iter) {
			const results = await resolver.resolve(value, db);
			for (const result of results) {
				if (result instanceof IdentityRelation) {
					if (visited.has(result.id)) {
						return;
					}
					visited.add(result.id);
					yield result;

					newIter.push(resolver.next(result));
				}
			}
		}
		iter = newIter;
	}
}

/**
 * Get path, to target.
 * @param start
 * @param target
 * @param db
 * @returns
 */
export const hasPathToTarget = async (
	start: PublicSignKey,
	target: (key: PublicSignKey) => boolean,
	db: Documents<IdentityRelation>,
	resolver: RelationResolver
): Promise<boolean> => {
	if (!db) {
		throw new Error("Not initalized");
	}

	const current = start;
	if (target(current)) {
		return true;
	}

	const iterator = getPathGenerator(current, db, resolver);
	for await (const relation of iterator) {
		if (target(relation.from)) {
			return true;
		}
	}
	return false;
};

@variant(0)
export abstract class AbstractRelation {
	@field({ type: fixedArray("u8", 32) })
	id: Uint8Array;
}

@variant(0)
export class IdentityRelation extends AbstractRelation {
	@field({ type: PublicSignKey })
	_from: PublicSignKey;

	@field({ type: PublicSignKey })
	_to: PublicSignKey;

	constructor(properties?: {
		to: PublicSignKey; // signed by truster
		from: PublicSignKey;
	}) {
		super();
		if (properties) {
			this._from = properties.from;
			this._to = properties.to;
			this.initializeId();
		}
	}

	get from(): PublicSignKey {
		return this._from;
	}

	get to(): PublicSignKey {
		return this._to;
	}

	initializeId() {
		this.id = IdentityRelation.id(this.to, this.from);
	}

	static id(to: PublicSignKey, from: PublicSignKey) {
		return sha256Sync(concat([serialize(to), serialize(from)]));
	}
}

export const hasPath = async (
	start: PublicSignKey,
	end: PublicSignKey,
	db: Documents<IdentityRelation>,
	resolver: RelationResolver
): Promise<boolean> => {
	return hasPathToTarget(start, (key) => end.equals(key), db, resolver);
};

export const getRelation = async (
	from: PublicSignKey,
	to: PublicSignKey,
	db: Documents<IdentityRelation>
): Promise<IdentityRelation | undefined> => {
	return db.index.get(new IdentityRelation({ from, to }).id);
};

export const createIdentityGraphStore = (id?: Uint8Array) =>
	new Documents<IdentityRelation>({
		index: new DocumentIndex({
			query: new RPC(),
		}),
		id,
	});

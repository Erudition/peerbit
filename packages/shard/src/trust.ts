import { deserialize, field, serialize, variant } from "@dao-xyz/borsh";
import { BinaryDocumentStore } from "@dao-xyz/orbit-db-bdocstore";
import { IPFSInstanceExtended } from "./node";
import { Shard } from "./shard";
import { DBInterface, SingleDBInterface } from "./interface";

import { PublicKey } from "./key";
import { BinaryDocumentStoreOptions } from "./stores";
export const TRUSTEE_KEY = 'trustee';

@variant(0)
export class P2PTrustRelation {

    /*  @field({ type: PublicKey })
     truster: PublicKey  *///  Dont need this becaause its going to be signed with truster anyway (bc orbitdb)

    @field({ type: PublicKey })
    [TRUSTEE_KEY]: PublicKey  // the key to trust

    /* @field({ type: 'String' }) 
    signature: string */ // Dont need this because its going to be signed anyway (bc orbitdb)

    constructor(props?: P2PTrustRelation) {
        if (props) {
            Object.assign(this, props)
        }
    }

}



@variant(0) // We prepend with 0 if we in the future would have an other trust setup
export class P2PTrust extends DBInterface {

    @field({ type: PublicKey })
    rootTrust: PublicKey

    @field({ type: SingleDBInterface })
    db: SingleDBInterface<P2PTrustRelation, BinaryDocumentStore<P2PTrustRelation>>

    cid?: string;

    constructor(props?: {
        rootTrust: PublicKey
        db: SingleDBInterface<P2PTrustRelation, BinaryDocumentStore<P2PTrustRelation>>;
    } | {
        rootTrust: PublicKey
    }) {
        super();
        if (props) {
            Object.assign(this, props)
        }
        if (!this.db) {
            this.db = new SingleDBInterface({
                name: 'trust',
                storeOptions: new BinaryDocumentStoreOptions({
                    indexBy: TRUSTEE_KEY,
                    objectType: P2PTrustRelation.name
                })
            })
        }
    }

    get initialized(): boolean {
        return this.db.initialized
    }

    close() {
        this.db.close();
    }

    async init(shard: Shard<any>) {
        shard.peer.options.behaviours.typeMap[P2PTrustRelation.name] = P2PTrustRelation;
        await this.db.init(shard);
    }


    async load(waitForReplicationEventsCount = 0): Promise<void> {
        await this.db.load(waitForReplicationEventsCount);
    }


    async addTrust(trustee: PublicKey) {
        await this.db.db.put(new P2PTrustRelation({
            trustee
        }));
    }

    async save(node: IPFSInstanceExtended): Promise<string> {
        if (!this.db.initialized || !this.rootTrust) {
            throw new Error("Not initialized");
        }

        let arr = serialize(this);
        let addResult = await node.add(arr)
        let pinResult = await node.pin.add(addResult.cid)
        this.cid = pinResult.toString();
        return this.cid;
    }


    static async loadFromCID(cid: string, node: IPFSInstanceExtended): Promise<P2PTrust> {
        let arr = await node.cat(cid);
        for await (const obj of arr) {
            let der = deserialize(Buffer.from(obj), P2PTrust);
            der.cid = cid;
            return der;
        }
    }

    get replicationTopic() {
        if (!this.cid) {
            throw new Error("Not initialized, replication topic requires known cid");
        }
        return this.cid + '_' + 'replication'
    }


    /**
     * Follow trust path back to trust root.
     * Trust root is always trusted.
     * Hence if
     * Root trust A trust B trust C
     * C is trusted by Root
     * @param trustee 
     * @returns true, if trusted
     */
    isTrusted(trustee: PublicKey): boolean {

        /**
         * TODO: Currently very inefficient
         */
        return isTrusted(this.rootTrust, trustee, this.db);
    }



}

export const isTrusted = (rootTrust: PublicKey, trustee: PublicKey, db: SingleDBInterface<P2PTrustRelation, BinaryDocumentStore<P2PTrustRelation>>): boolean => {

    /**
     * TODO: Currently very inefficient
     */
    if (!db) {
        throw new Error("Not initalized")
    }
    if (trustee.equals(rootTrust)) {
        return true;
    }
    let currentTrustee = trustee;
    let visited = new Set<string>();
    while (true) {
        let trust = db.db.index.get(currentTrustee.toString(), true) as LogEntry<P2PTrustRelation>;
        if (!trust) {
            return false;
        }

        // TODO: could be multiple but we just follow one path for now
        if (currentTrustee == trust.payload.value.trustee) {
            return false;
        }

        // Assumed message is signed
        let truster = PublicKey.from(trust.identity);

        if (truster.equals(rootTrust)) {
            return true;
        }
        let key = truster.toString();
        if (visited.has(key)) {
            return false; // we are in a loop, abort
        }
        visited.add(key);
        currentTrustee = truster; // move upwards in trust tree
    }
}


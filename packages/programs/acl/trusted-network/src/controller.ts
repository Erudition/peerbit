import { deserialize, field, serialize, variant, vec } from "@dao-xyz/borsh";
import { Documents, Operation, PutOperation } from "@dao-xyz/peerbit-document";
import { Entry } from "@dao-xyz/ipfs-log";
import { LogIndex, LogQueryRequest } from "@dao-xyz/peerbit-logindex";
import { createHash } from "crypto";
import { IPFSAddress, Key, OtherKey, PublicSignKey, SignKey } from "@dao-xyz/peerbit-crypto";
import type { PeerId } from '@libp2p/interface-peer-id';
import { DeleteOperation } from "@dao-xyz/peerbit-document";
import { IdentityRelation, createIdentityGraphStore, getPathGenerator, hasPath, getFromByTo, getToByFrom, getRelation } from "./identity-graph";
import { BinaryPayload } from "@dao-xyz/peerbit-bpayload";
import { Program } from '@dao-xyz/peerbit-program';
import { CanRead, DQuery } from "@dao-xyz/peerbit-query";
import { waitFor } from "@dao-xyz/peerbit-time";
import { AddOperationOptions } from "@dao-xyz/peerbit-store";

const canAppendByRelation = async (entry: Entry<Operation<IdentityRelation>>, isTrusted?: (key: PublicSignKey) => Promise<boolean>): Promise<boolean> => {

    // verify the payload 
    const operation = await entry.getPayloadValue();
    if (operation instanceof PutOperation || operation instanceof DeleteOperation) {
        /*  const relation: Relation = operation.value || deserialize(operation.data, Relation); */

        const key = await entry.getPublicKey();
        if (operation instanceof PutOperation) {
            // TODO, this clause is only applicable when we modify the identityGraph, but it does not make sense that the canAppend method does not know what the payload will
            // be, upon deserialization. There should be known in the `canAppend` method whether we are appending to the identityGraph.

            const relation: BinaryPayload = operation._value || deserialize(operation.data, BinaryPayload);
            operation._value = relation;

            if (relation instanceof IdentityRelation) {
                if (!relation.from.equals(key)) {
                    return false;
                }
            }

            // else assume the payload is accepted
        }

        if (isTrusted) {
            const trusted = await isTrusted(key);
            return trusted
        }
        else {
            return true;
        }
    }

    else {
        return false;
    }
}

@variant("relations")
export class RelationContract extends Program {

    @field({ type: Documents })
    relationGraph: Documents<IdentityRelation>

    constructor(props?: {
        id?: string
    }) {
        super(props)
        if (props) {
            this.relationGraph = createIdentityGraphStore({ ...props, id: this.id });
        }
    }

    async canAppend(entry: Entry<Operation<IdentityRelation>>): Promise<boolean> {
        return canAppendByRelation(entry)
    }


    async setup(options?: { canRead?: CanRead }) {
        await this.relationGraph.setup({ type: IdentityRelation, canAppend: this.canAppend.bind(this), canRead: options?.canRead }) // self referencing access controller
    }


    async addRelation(to: PublicSignKey, options?: AddOperationOptions<Operation<IdentityRelation>>) {
        /*  trustee = PublicKey.from(trustee); */
        await this.relationGraph.put(new IdentityRelation({
            to: to,
            from: options?.identity?.publicKey || this.relationGraph.store.identity.publicKey
        }), options);
    }
}

/**
 * Not shardeable since we can not query trusted relations, because this would lead to a recursive problem where we then need to determine whether the responder is trusted or not
 */

@variant("trusted_network")
export class TrustedNetwork extends Program {

    @field({ type: PublicSignKey })
    rootTrust: PublicSignKey

    @field({ type: Documents })
    trustGraph: Documents<IdentityRelation>

    @field({ type: LogIndex })
    logIndex: LogIndex;

    constructor(props?: {
        id?: string,
        rootTrust: PublicSignKey,
        logIndex?: LogIndex
    }) {
        super(props);
        if (props) {
            this.trustGraph = createIdentityGraphStore({ ...props, id: this.id });
            this.rootTrust = props.rootTrust;
            this.logIndex = props.logIndex || new LogIndex({ query: new DQuery() });
        }
    }


    async setup() {
        await this.trustGraph.setup({ type: IdentityRelation, canAppend: this.canAppend.bind(this), canRead: this.canRead.bind(this) }) // self referencing access controller
        await this.logIndex.setup({ store: this.trustGraph.store })
    }

    async canAppend(entry: Entry<Operation<IdentityRelation>>): Promise<boolean> {

        return canAppendByRelation(entry, async (key) => await this.isTrusted(key))
    }

    async canRead(key?: SignKey): Promise<boolean> {
        if (!key) {
            return false;
        }
        return await this.isTrusted(key);
    }

    async add(trustee: PublicSignKey | PeerId): Promise<IdentityRelation | undefined> {
        const existingRelation = this.getRelation(trustee, this.trustGraph.store.identity.publicKey)
        if (!existingRelation) {
            const relation = new IdentityRelation({
                to: trustee instanceof Key ? trustee : new IPFSAddress({ address: trustee.toString() }),
                from: this.trustGraph.store.identity.publicKey
            });
            await this.trustGraph.put(relation);
            return relation;
        }
        return existingRelation.value;
    }

    async hasRelation(trustee: PublicSignKey | PeerId, truster = this.rootTrust) {
        return !!(await this.getRelation(trustee, truster))
    }
    getRelation(trustee: PublicSignKey | PeerId, truster = this.rootTrust) {
        return getRelation(truster, trustee instanceof Key ? trustee : new IPFSAddress({ address: trustee.toString() }), this.trustGraph);
    }



    /**
     * Follow trust path back to trust root.
     * Trust root is always trusted.
     * Hence if
     * Root trust A trust B trust C
     * C is trusted by Root
     * @param trustee 
     * @param truster, the truster "root", if undefined defaults to the root trust
     * @returns true, if trusted
     */
    async isTrusted(trustee: PublicSignKey | OtherKey, truster: PublicSignKey = this.rootTrust): Promise<boolean> {

        if (trustee.equals(this.rootTrust)) {
            return true;
        }
        if (this.trustGraph.store.replicate) {
            return this._isTrustedLocal(trustee, truster)
        }
        else {
            let trusted = false;
            this.logIndex.query.query(new LogQueryRequest({ queries: [] }), async (heads, from) => {
                if (!from) {
                    return;
                }

                const logs = await Promise.all(heads.heads.map(h => this.trustGraph.store._replicator._replicateLog(h)));

                await this.trustGraph.store.updateStateFromLogs(logs);

                const isTrustedSender = await this._isTrustedLocal(from, truster);
                if (!isTrustedSender) {
                    return;
                }


                const isTrustedTrustee = await this._isTrustedLocal(trustee, truster);
                if (isTrustedTrustee) {
                    trusted = true;
                }
            })

            try {
                await waitFor(() => trusted)
                return trusted;
            } catch (error) {
                return false;
            }

        }

    }

    async _isTrustedLocal(trustee: PublicSignKey | OtherKey, truster: PublicSignKey = this.rootTrust): Promise<boolean> {
        const trustPath = await hasPath(trustee, truster, this.trustGraph, getFromByTo);
        return !!trustPath
    }

    async getTrusted(): Promise<PublicSignKey[]> {
        let current = this.rootTrust;
        const participants: PublicSignKey[] = [current];
        let generator = getPathGenerator(current, this.trustGraph, getToByFrom);
        for await (const next of generator) {
            participants.push(next.to);
        }
        return participants;

    }

    hashCode(): string {
        return createHash('sha1').update(serialize(this)).digest('hex')
    }

}


import { WaitForPeer } from "@peerbit/stream-interface";

export type GetOptions = {
	timeout?: number;
	replicate?: boolean;
};
export type PutOptions = {
	timeout?: number;
};

type MaybePromise<T> = Promise<T> | T;

export interface Blocks extends WaitForPeer {
	put(bytes: Uint8Array): MaybePromise<string>;
	has(cid: string): MaybePromise<boolean>;
	get(cid: string, options?: GetOptions): MaybePromise<Uint8Array | undefined>;
	rm(cid: string): MaybePromise<void>;
}

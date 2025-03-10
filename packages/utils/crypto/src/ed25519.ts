import { field, fixedArray, variant } from "@dao-xyz/borsh";
import { PrivateSignKey, PublicSignKey, Keypair } from "./key.js";
import { equals } from "@peerbit/uint8arrays";
import { Identity, Signer, SignWithKey } from "./signer.js";
import { SignatureWithKey } from "./signature.js";
import { toHexString } from "./utils.js";
import { peerIdFromKeys } from "@libp2p/peer-id";
import { supportedKeys } from "@libp2p/crypto/keys";
import { coerce } from "./bytes.js";
import sodium from "libsodium-wrappers";
import type { Ed25519PeerId, PeerId } from "@libp2p/interface/peer-id";
import { sign } from "./ed25519-sign.js";
import { PreHash } from "./prehash.js";
import { concat } from "uint8arrays";

@variant(0)
export class Ed25519PublicKey extends PublicSignKey {
	@field({ type: fixedArray("u8", 32) })
	publicKey: Uint8Array;

	constructor(properties: { publicKey: Uint8Array }) {
		super();
		this.publicKey = properties.publicKey;
		if (properties.publicKey.length !== 32) {
			throw new Error("Expecting key to have length 32");
		}
	}

	equals(other: PublicSignKey): boolean {
		if (other instanceof Ed25519PublicKey) {
			return equals(this.publicKey, other.publicKey);
		}
		return false;
	}
	toString(): string {
		return "ed25119p/" + toHexString(this.publicKey);
	}

	toPeerId(): Promise<PeerId> {
		return peerIdFromKeys(
			new supportedKeys["ed25519"].Ed25519PublicKey(this.publicKey).bytes
		);
	}

	/* Don't use keyobject for publicKeys becuse it takes longer time to derive it compare to verifying with sodium
	private keyObject: any;
	get keyObject() {
		return (
			this._keyObject ||
			(this._keyObject = crypto.createPublicKey({
				format: "der",
				type: "spki",
				key: toDER(this.publicKey),
			}))
		);
	} */
	static fromPeerId(id: PeerId) {
		if (!id.publicKey) {
			throw new Error("Missing public key");
		}
		if (id.type === "Ed25519") {
			return new Ed25519PublicKey({
				publicKey: coerce(id.publicKey!.slice(4)),
			});
		}
		throw new Error("Unsupported key type: " + id.type);
	}
}

@variant(0)
export class Ed25519PrivateKey extends PrivateSignKey {
	@field({ type: fixedArray("u8", 32) })
	privateKey: Uint8Array;

	constructor(properties: { privateKey: Uint8Array }) {
		super();

		if (properties.privateKey.length !== 32) {
			throw new Error("Expecting key to have length 32");
		}

		this.privateKey = properties.privateKey;
	}

	equals(other: Ed25519PrivateKey): boolean {
		if (other instanceof Ed25519PrivateKey) {
			return equals(this.privateKey, other.privateKey);
		}
		return false;
	}

	toString(): string {
		return "ed25119s/" + toHexString(this.privateKey);
	}

	keyObject: any; // crypto.KeyObject;

	static fromPeerID(id: PeerId) {
		if (!id.privateKey) {
			throw new Error("Missing privateKey key");
		}
		if (id.type === "Ed25519") {
			return new Ed25519PrivateKey({
				privateKey: coerce(id.privateKey!.slice(4, 36)),
			});
		}
		throw new Error("Unsupported key type: " + id.type);
	}
}

@variant(0)
export class Ed25519Keypair extends Keypair implements Identity {
	@field({ type: Ed25519PublicKey })
	publicKey: Ed25519PublicKey;

	@field({ type: Ed25519PrivateKey })
	privateKey: Ed25519PrivateKey;

	constructor(properties: {
		publicKey: Ed25519PublicKey;
		privateKey: Ed25519PrivateKey;
	}) {
		super();
		this.privateKey = properties.privateKey;
		this.publicKey = properties.publicKey;
	}

	static async create(): Promise<Ed25519Keypair> {
		await sodium.ready;
		const generated = sodium.crypto_sign_keypair();
		const kp = new Ed25519Keypair({
			publicKey: new Ed25519PublicKey({
				publicKey: generated.publicKey,
			}),
			privateKey: new Ed25519PrivateKey({
				privateKey: generated.privateKey.slice(0, 32), // Only the private key part (?)
			}),
		});

		return kp;
	}

	sign(
		data: Uint8Array,
		prehash: PreHash = PreHash.NONE
	): Promise<SignatureWithKey> {
		return sign(data, this, prehash);
	}

	signer(prehash: PreHash): SignWithKey {
		return async (data: Uint8Array) => {
			return this.sign(data, prehash);
		};
	}

	equals(other: Keypair) {
		if (other instanceof Ed25519Keypair) {
			return (
				this.publicKey.equals(other.publicKey) &&
				this.privateKey.equals(other.privateKey)
			);
		}
		return false;
	}

	static fromPeerId(peerId: PeerId | Ed25519PeerId) {
		return new Ed25519Keypair({
			privateKey: Ed25519PrivateKey.fromPeerID(peerId),
			publicKey: Ed25519PublicKey.fromPeerId(peerId),
		});
	}

	_privateKeyPublicKey: Uint8Array; // length 64
	get privateKeyPublicKey(): Uint8Array {
		return (
			this._privateKeyPublicKey ||
			(this._privateKeyPublicKey = concat([
				this.privateKey.privateKey,
				this.publicKey.publicKey,
			]))
		);
	}

	toPeerId(): Promise<PeerId> {
		return peerIdFromKeys(
			new supportedKeys["ed25519"].Ed25519PublicKey(this.publicKey.publicKey)
				.bytes,
			new supportedKeys["ed25519"].Ed25519PrivateKey(
				this.privateKeyPublicKey,
				this.publicKey.publicKey
			).bytes
		);
	}
}

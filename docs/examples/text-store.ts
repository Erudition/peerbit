import { Peerbit } from "peerbit";
import { Program } from "@peerbit/program";
import { PublicSignKey } from "@peerbit/crypto";
import {
	Range,
	DString,
	StringOperation,
	TransactionContext,
} from "@peerbit/string";
import { field, variant } from "@dao-xyz/borsh";

@variant("collaborative_text") // You have to give the program a unique name
class CollaborativeText extends Program {
	@field({ type: DString })
	string: DString; // distributed string

	constructor() {
		super();
		this.string = new DString({});
	}

	async open() {
		await this.string.open({
			canPerform: this.canPerform,
			canRead: this.canRead,
		});
	}

	async canPerform(
		operation: StringOperation,
		context: TransactionContext
	): Promise<boolean> {
		// .. acl logic writers
		return true;
	}

	async canRead(identity?: PublicSignKey): Promise<boolean> {
		// .. acl logic for readers
		return true;
	}
}

// ...

const peer = await Peerbit.create();
const document = await peer.open(new CollaborativeText());
console.log(document.address!.toString()); /// this address can be opened by another peer

//  ...
await document.string.add("hello", new Range({ offset: 0n, length: 5n }));
await document.string.add("world", new Range({ offset: 6n, length: 5n }));

expect(await document.string.getValue()).toEqual("hello world");

await peer.stop();

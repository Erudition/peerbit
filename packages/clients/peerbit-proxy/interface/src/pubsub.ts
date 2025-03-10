import { SimpleLevel } from "@peerbit/lazy-level";
import type { PeerId } from "@libp2p/interface/peer-id";
import { getPublicKeyFromPeerId } from "@peerbit/crypto";
import {
	DataEvent,
	PubSub,
	PubSubEvents,
	SubscriptionEvent,
	UnsubcriptionEvent,
	type PublishOptions,
	SubscriptionData,
} from "@peerbit/pubsub-interface";
import { field, variant, vec, option, deserialize } from "@dao-xyz/borsh";
import { PublicSignKey } from "@peerbit/crypto";
import { Message } from "./message.js";
import { Message as StreamMessage } from "@peerbit/stream-interface";

import { CustomEvent } from "@libp2p/interface/events";

@variant(6)
export abstract class PubSubMessage extends Message {}

@variant(0)
export class REQ_GetSubscribers extends PubSubMessage {
	@field({ type: "string" })
	topic: string;

	constructor(topic: string) {
		super();
		this.topic = topic;
	}
}

@variant(1)
export class RESP_GetSubscribers extends PubSubMessage {
	@field({ type: option(vec(SubscriptionData)) })
	data?: SubscriptionData[];

	constructor(map?: Map<string, SubscriptionData>) {
		super();
		if (map) {
			this.data = [];
			for (const [k, v] of map.entries()) {
				this.data.push(v);
			}
		}
	}

	_map: Map<string, SubscriptionData> | null | undefined;
	get map() {
		if (this._map !== undefined) {
			return this._map;
		}
		if (this.data) {
			const map = new Map();
			for (const [i, data] of this.data.entries()) {
				map.set(data.publicKey.hashcode(), data);
			}
			return (this._map = map);
		} else {
			return (this._map = null);
		}
	}
}

@variant(2)
export class REQ_RequestSubscribers extends PubSubMessage {
	@field({ type: "string" })
	topic: string;

	constructor(topic: string) {
		super();
		this.topic = topic;
	}
}

@variant(3)
export class RESP_RequestSubscribers extends PubSubMessage {}

@variant(4)
export class REQ_Publish extends PubSubMessage {
	@field({ type: Uint8Array })
	data: Uint8Array;

	@field({ type: option(vec("string")) })
	topics?: string[];

	@field({ type: option(vec("string")) })
	to?: string[]; // (string | PublicSignKey | Libp2pPeerId)[];

	@field({ type: "bool" })
	strict: boolean;

	constructor(data: Uint8Array, options?: PublishOptions) {
		super();
		this.data = data;
		this.topics = options?.topics;
		this.to = options?.to?.map((x) =>
			typeof x === "string"
				? x
				: x instanceof PublicSignKey
				? x.hashcode()
				: getPublicKeyFromPeerId(x).hashcode()
		);
		this.strict = options?.strict || false;
	}
}

@variant(5)
export class RESP_Publish extends PubSubMessage {
	@field({ type: Uint8Array })
	messageId: Uint8Array;

	constructor(messageId: Uint8Array) {
		super();
		this.messageId = messageId;
	}
}

@variant(6)
export class REQ_Subscribe extends PubSubMessage {
	@field({ type: "string" })
	topic: string;

	@field({ type: option(Uint8Array) })
	data?: Uint8Array;

	constructor(topic: string, options?: { data?: Uint8Array }) {
		super();
		this.topic = topic;
		this.data = options?.data;
	}
}

@variant(7)
export class RESP_Subscribe extends PubSubMessage {}

@variant(8)
export class REQ_Unsubscribe extends PubSubMessage {
	constructor(topic: string, options?: { force?: boolean; data?: Uint8Array }) {
		super();
		this.topic = topic;
		this.force = options?.force;
		this.data = options?.data;
	}
	@field({ type: "string" })
	topic: string;

	@field({ type: option("bool") })
	force?: boolean;

	@field({ type: option(Uint8Array) })
	data?: Uint8Array;
}

@variant(9)
export class RESP_Unsubscribe extends PubSubMessage {
	@field({ type: "bool" })
	value: boolean;

	constructor(value: boolean) {
		super();
		this.value = value;
	}
}

@variant(10)
export class REQ_PubsubWaitFor extends PubSubMessage {
	@field({ type: PublicSignKey })
	publicKey: PublicSignKey;

	constructor(publicKey: PeerId | PublicSignKey) {
		super();
		this.publicKey =
			publicKey instanceof PublicSignKey
				? publicKey
				: getPublicKeyFromPeerId(publicKey);
	}
}

@variant(11)
export class RESP_PubsubWaitFor extends PubSubMessage {}

@variant(12)
export class REQ_AddEventListener extends PubSubMessage {
	@field({ type: "string" })
	type: keyof PubSubEvents;

	@field({ type: Uint8Array })
	emitMessageId: Uint8Array;

	constructor(type: keyof PubSubEvents, emitMessageId: Uint8Array) {
		super();
		this.type = type;
		this.emitMessageId = emitMessageId;
	}
}

@variant(13)
export class RESP_AddEventListener extends PubSubMessage {}

@variant(14)
export class REQ_RemoveEventListener extends PubSubMessage {
	@field({ type: "string" })
	type: keyof PubSubEvents;

	constructor(type: keyof PubSubEvents) {
		super();
		this.type = type;
	}
}

@variant(15)
export class RESP_RemoveEventListener extends PubSubMessage {}

@variant(16)
export class RESP_EmitEvent extends PubSubMessage {
	@field({ type: "string" })
	type: keyof PubSubEvents;

	@field({ type: Uint8Array })
	data: Uint8Array;

	constructor(type: keyof PubSubEvents, data: Uint8Array) {
		super();
		this.type = type;
		this.data = data;
	}
}

@variant(17)
export class REQ_DispatchEvent extends PubSubMessage {
	@field({ type: "string" })
	type: keyof PubSubEvents;

	@field({ type: Uint8Array })
	data: Uint8Array;

	constructor(type: keyof PubSubEvents, data: Uint8Array) {
		super();
		this.type = type;
		this.data = data;
	}
}

@variant(18)
export class RESP_DispatchEvent extends PubSubMessage {
	@field({ type: "bool" })
	value: boolean;
	constructor(value: boolean) {
		super();
		this.value = value;
	}
}

@variant(19)
export class REQ_EmitSelf extends PubSubMessage {}

@variant(20)
export class RESP_EmitSelf extends PubSubMessage {
	@field({ type: "bool" })
	value: boolean;
	constructor(value: boolean) {
		super();
		this.value = value;
	}
}

export const createCustomEventFromType = (
	type: keyof PubSubEvents,
	data: Uint8Array
) => {
	if (type === "data") {
		return new CustomEvent<DataEvent>("data", {
			detail: deserialize(data, DataEvent),
		});
	} else if (type === "message") {
		return new CustomEvent<StreamMessage>("message", {
			detail: deserialize(data, StreamMessage),
		});
	} else if (type === "peer:reachable") {
		return new CustomEvent<PublicSignKey>("peer:reachable", {
			detail: deserialize(data, PublicSignKey),
		});
	} else if (type === "peer:unreachable") {
		return new CustomEvent<PublicSignKey>("peer:unreachable", {
			detail: deserialize(data, PublicSignKey),
		});
	} else if (type === "subscribe") {
		return new CustomEvent<SubscriptionEvent>("subscribe", {
			detail: deserialize(data, SubscriptionEvent),
		});
	} else if (type === "unsubscribe") {
		return new CustomEvent<UnsubcriptionEvent>("subscribe", {
			detail: deserialize(data, UnsubcriptionEvent),
		});
	} else throw new Error("Unsupported event type: " + String(type));
};

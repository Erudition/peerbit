import rmrf from "rimraf";
import { waitFor } from "@dao-xyz/peerbit-time";
import { jest } from "@jest/globals";
import { Peerbit } from "../peer";

import { EventStore } from "./utils/stores/event-store";
// @ts-ignore
import { v4 as uuid } from "uuid";

// Include test utilities
import { LSession } from "@dao-xyz/peerbit-test-utils";
import { DEFAULT_BLOCK_TRANSPORT_TOPIC } from "@dao-xyz/peerbit-block";

const orbitdbPath1 = "./orbitdb/tests/replication-topic/1";
const orbitdbPath2 = "./orbitdb/tests/replication-topic/2";
const dbPath1 = "./orbitdb/tests/replication-topic/1/db1";
const dbPath2 = "./orbitdb/tests/replication-topic/2/db2";

describe(`Replication topic`, function () {
    let session: LSession;
    let orbitdb1: Peerbit, orbitdb2: Peerbit, eventStore: EventStore<string>;

    let timer: any;

    beforeAll(async () => {
        session = await LSession.connected(2, [DEFAULT_BLOCK_TRANSPORT_TOPIC]);
    });

    afterAll(async () => {
        await session.stop();
    });

    beforeEach(async () => {
        clearInterval(timer);

        rmrf.sync(orbitdbPath1);
        rmrf.sync(orbitdbPath2);
        rmrf.sync(dbPath1);
        rmrf.sync(dbPath2);

        orbitdb1 = await Peerbit.create(session.peers[0], {
            directory: orbitdbPath1,
        });
        orbitdb2 = await Peerbit.create(session.peers[1], {
            directory: orbitdbPath2,
        });
    });

    afterEach(async () => {
        clearInterval(timer);
        if (eventStore) {
            await eventStore.drop();
        }
        if (orbitdb1) await orbitdb1.stop();

        if (orbitdb2) await orbitdb2.stop();
    });

    it("replicates database of 1 entry", async () => {
        const topic = uuid();
        orbitdb2.subscribeToTopic(topic, true);

        eventStore = new EventStore<string>({});
        eventStore = await orbitdb1.open(eventStore, {
            topic: topic,
        });
        eventStore.add("hello");
        await waitFor(
            () =>
                (
                    orbitdb2.programs
                        .get(topic)
                        ?.get(eventStore.address!.toString())
                        ?.program as EventStore<string>
                )?.store?.oplog.values.length === 1
        );
    });
});

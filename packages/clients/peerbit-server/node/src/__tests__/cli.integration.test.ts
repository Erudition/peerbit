// This more like a playground as of now
// No tests yet,
import { LSession } from "@peerbit/test-utils";
import { jest } from "@jest/globals";
import { execSync, exec, ChildProcess } from "child_process";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { waitForResolved } from "@peerbit/time";
import fs from "fs";
import readline from "readline";
import { v4 as uuid } from "uuid";
import { Ed25519Keypair } from "@peerbit/crypto";
import { Trust } from "../trust";
import { getTrustPath } from "../config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const modulesPath = path.join(__dirname, "./tmp/cli-test/modules");

const runCommandAsync = (args): ProcessWithOut => {
	const cmd = `node --loader ts-node/esm ${path.join(
		__dirname,
		"../",
		"bin.ts"
	)} ${args}`;
	const p = exec(
		cmd /* , { env: { ...process.env, "PEERBIT_MODULES_PATH": modulesPath } } */
	);
	return getProcessWithOut(p);
};

const runCommand = (args): string => {
	const cmd = `node --loader ts-node/esm ${path.join(
		__dirname,
		"../",
		"bin.ts"
	)} ${args}`;
	return execSync(cmd).toString();
};

const LOCAL_REMOTE_NAME = "local-remote";

type ProcessWithOut = {
	process: ChildProcess;
	out: string[];
	err: string[];
	outSinceWrite: string[];
	write: (line: string) => void;
};

const getProcessWithOut = (p: ChildProcess): ProcessWithOut => {
	let out: string[] = [];
	let err: string[] = [];
	let outSinceWrite: string[] = [];
	const rl = readline.createInterface({
		input: p.stdout!,
	});

	p.stderr!.on("data", (d: string) => {
		d.split("\n").forEach((x) => err.push(x));
	});
	rl.on("line", (d) => {
		if (d.trim().length > 0) {
			out.push(d.trim());
			outSinceWrite.push(d.trim());
		}
	});
	/* 	p.stdout!.on('data', (d: string) => {
			//d.split("\n").forEach(x => out.push(x))
		}); */
	let write = (line: string) => {
		outSinceWrite.splice(0, outSinceWrite.length);
		p.stdin!.write(line + "\n");
	};
	return {
		process: p,
		out,
		err,
		write,
		outSinceWrite,
	};
};

const countPeerIds = (out: string[]): number => {
	return out.filter((x) => x.includes("12D3")).length;
};

const debugProcess = (p: ProcessWithOut) => {
	console.log(
		"DEBUG PROCESS:\n" +
			p.out.join("\n") +
			"\n--------------\n" +
			p.err.join("\n")
	);
};

describe("cli", () => {
	let session: LSession;
	jest.setTimeout(60 * 1000);
	let processes: ProcessWithOut[];
	let configDirectory: string;
	let PORT = 9993;

	const start = async (extraArgs: string = "") => {
		const cmd = runCommandAsync(
			`start --reset --port-api ${PORT} --port-node 0 --directory ${configDirectory} ${extraArgs}`
		);
		processes.push(cmd);
		try {
			await waitForResolved(() => expect(cmd.out.length).toBeGreaterThan(0));
		} catch (error) {
			console.log("Never resolved start:\n" + cmd.err.join("\n"));
			throw error;
		}
		addRemote(LOCAL_REMOTE_NAME, "http://localhost:" + PORT);
		await waitForResolved(() =>
			expect(
				runCommand(
					`remote connect ${LOCAL_REMOTE_NAME} --directory ${configDirectory}`
				)
			)
		);
		return cmd;
	};

	const addRemote = (
		remote: string = LOCAL_REMOTE_NAME,
		address: string = "http://localhost:" + PORT
	): void => {
		execSync(
			`node --loader ts-node/esm ${path.join(
				__dirname,
				"../",
				"bin.ts"
			)} remote add ${remote} ${address} --directory ${configDirectory}`
		);
	};

	const connect = (remote: string = LOCAL_REMOTE_NAME): ProcessWithOut => {
		const p = getProcessWithOut(
			exec(
				`node --loader ts-node/esm ${path.join(
					__dirname,
					"../",
					"bin.ts"
				)} remote connect ${remote} --directory ${configDirectory}`
			)
		);
		processes.push(p);
		return p;
	};

	beforeAll(async () => {
		//	execSync(`cd ${path.join(__dirname, '../../../', 'test-lib')} && npm pack`)
		session = await LSession.connected(1);
	});

	beforeEach(() => {
		PORT += 1; // TODO if we don't do this, tests fail in github actions (process.exit does not release ports quick enough (?))
		processes = [];
		configDirectory = path.join(__dirname, "./tmp/cli-test/config", uuid());
	});

	afterEach(async () => {
		for (const p of processes) {
			p.process.kill();
		}
		if (fs.existsSync(modulesPath)) {
			fs.rmSync(modulesPath, { recursive: true, force: true });
		}

		if (fs.existsSync(configDirectory)) {
			fs.rmSync(configDirectory, { recursive: true, force: true });
		}
	});

	afterAll(async () => {
		await session.stop();
	});

	const checkPeerId = async (terminal?: ProcessWithOut) => {
		const t = terminal || connect();
		await waitForResolved(() => expect(t.out.length).toBeGreaterThan(0)); // wait for ready
		t.write("peer id");
		try {
			await waitForResolved(
				() => expect(countPeerIds(t.outSinceWrite)).toBeGreaterThan(0),
				{ delayInterval: 500, timeout: 10 * 1000 }
			);
		} catch (error) {
			debugProcess(t);
			throw error;
		}
	};

	describe("starts", () => {
		it("no-args", async () => {
			await start();
			await checkPeerId();
		});

		it("grant-access", async () => {
			const kp1 = await Ed25519Keypair.create();
			const kp2 = await Ed25519Keypair.create();

			await start(
				`--grant-access ${(await kp1.toPeerId()).toString()} --grant-access ${(
					await kp2.toPeerId()
				).toString()}`
			);
			const trust = new Trust(getTrustPath(configDirectory));
			expect(trust.trusted).toContainAllValues([
				kp1.publicKey.hashcode(),
				kp2.publicKey.hashcode(),
			]);
		});
	});

	describe("remote", () => {
		it("rejets on invalid remote", async () => {
			let rejected = false;
			try {
				runCommand("remote add test xyz");
			} catch (error) {
				rejected = true;
				expect(error?.toString().includes("Error: Failed to add remote"));
			}
			expect(rejected).toBeTrue();
		});

		it("add valid remote", async () => {
			await start();
			runCommand(
				`remote add xyz123 http://localhost:${PORT}  --directory ${configDirectory}`
			);
			const terminal = await connect("xyz123");
			await checkPeerId(terminal);
		});

		describe("connect", () => {
			const GROUP_A = "GROUP_A";
			beforeEach(async () => {
				await start();
				runCommand(
					`remote add a http://localhost:${PORT} --group ${GROUP_A} --directory ${configDirectory}`
				);
				runCommand(
					`remote add b http://localhost:${PORT} --directory ${configDirectory}`
				);
			});

			it("connect to multiple by name", async () => {
				const terminal = await connect("a b");
				terminal.out.splice(0, terminal.out.length);
				terminal.write("peer id");
				await waitForResolved(() =>
					expect(countPeerIds(terminal.out)).toEqual(2)
				);
			});

			it("connect to all", async () => {
				const terminal = await connect("--all");
				terminal.out.splice(0, terminal.out.length);
				terminal.write("peer id");
				await waitForResolved(
					() => expect(countPeerIds(terminal.out)).toEqual(3) // a, b, LOCAL_REMOTE
				);
			});

			it("connect to group", async () => {
				const terminal = await connect("--group " + GROUP_A);
				terminal.out.splice(0, terminal.out.length);
				terminal.write("peer id");
				await waitForResolved(() =>
					expect(countPeerIds(terminal.out)).toEqual(1)
				);
			});
		});

		describe("restart", () => {
			afterEach(async () => {
				const terminal = connect();
				terminal.write("stop"); // we have to do this because else we create detached processes during restart
				try {
					await waitForResolved(() =>
						expect(processes[0].out[processes[0].out.length - 1]).toEqual(
							"Shutting down node"
						)
					);
				} catch (error) {
					console.log(
						"TERMINAL: Never resolved start:\n" +
							terminal.out.join("\n") +
							"\n--------------\n" +
							terminal.err.join("\n")
					);
					console.log(
						"SERVER: Never resolved start:\n" +
							processes[0].out.join("\n") +
							"\n--------------\n" +
							processes[0].err.join("\n")
					);

					throw error;
				}
			});

			it("can restart", async () => {
				const s = await start();
				const terminal = connect();
				await checkPeerId();

				terminal.write("restart");
				await waitForResolved(() =>
					expect(
						s.out.filter((x) => x.includes("Starting node with address(es)"))
					).toHaveLength(2)
				);
				await checkPeerId();
			});

			//TODO too slow to run in CI?
			/* it("re-opens on restart", async () => {
				const server = await start();
				const terminal = connect();
				terminal.write(`install ${path.join(__dirname, "test.tgz")}`);
				await waitForResolved(() =>
					expect(
						terminal.outSinceWrite.find((x) =>
							x.includes("New programs available")
						)
					).toBeDefined()
				);
				terminal.write("program open --variant permissioned_string");
				await waitForResolved(() =>
					expect(
						terminal.outSinceWrite.find((x) =>
							x.includes("Started program with address:")
						)
					).toBeDefined()
				);
				terminal.write("restart");

				await waitForResolved(() =>
					expect(
						server.out.filter((x) =>
							x.includes("Starting node with address(es)")
						)
					).toHaveLength(2)
				);

				terminal.write("program ls");
				await waitForResolved(() =>
					expect(
						terminal.outSinceWrite.find((x) =>
							x.includes("Running programs (1):")
						)
					).toBeDefined()
				);
			}); */
		});
	});

	/* Can we make this test run faster?
	 it('install dependency remote', async () => {
		await start()
		const install = runCommand("install @peerbit/test-lib")
	})

 */
});

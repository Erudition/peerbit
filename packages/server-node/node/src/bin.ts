#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
import { cli } from "./cli.mjs"; // we have to do this because the shebang does not convert .js to .mjs
cli();

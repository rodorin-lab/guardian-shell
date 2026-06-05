// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Hermes Agent embedded in Wave Terminal
// This starts a dedicated Hermes API Server as a child process,
// making Wave Terminal a self-contained "PC" with its own AI.

import * as electron from "electron";
import * as child_process from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as readline from "readline";
import { setForceQuit } from "./emain-activity";

export const HermesEndpointVarName = "WAVETERM_HERMES_ENDPOINT";
export const HermesPort = 18643;
export const HermesEndpoint = `http://127.0.0.1:${HermesPort}/v1/chat/completions`;

let hermesProc: child_process.ChildProcessWithoutNullStreams | null = null;
let hermesReadyResolve = (value: boolean) => {};
const hermesReady: Promise<boolean> = new Promise((resolve, _) => {
    hermesReadyResolve = resolve;
});

export function getHermesReady(): Promise<boolean> {
    return hermesReady;
}

export function getHermesProc(): child_process.ChildProcessWithoutNullStreams | null {
    return hermesProc;
}

/**
 * Sets up a dedicated Hermes config directory for the embedded agent.
 * Creates ~/.hermes-wave/ with a minimal config to run on the dedicated port.
 */
function setupHermesConfigDir(): string {
    const hermesHome = path.join(process.env.HOME || "/tmp", ".hermes-wave");
    const configDir = hermesHome;
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Minimal Hermes config for the embedded agent
    const configYaml = path.join(configDir, "config.yaml");
    if (!fs.existsSync(configYaml)) {
        const config = `
# Hermes Wave — Embedded Agent config
# Dedicated to Wave Terminal. Independent from the main Hermes.
model:
  provider: ollama-cloud
  default: deepseek-v4-flash
  base_url: https://ollama.com/v1
  api_key: OLLAMA_API_KEY
  context_length: 1048576

platforms:
  api_server:
    extra:
      port: ${HermesPort}
      host: 127.0.0.1

# Lightweight: no cron, no gateway, just API
`.trim();
        fs.writeFileSync(configYaml, config);
    }

    // .env with API keys (symlink from main Hermes if possible)
    const hermesEnv = path.join(configDir, ".env");
    if (!fs.existsSync(hermesEnv)) {
        const mainEnv = path.join(process.env.HOME || "/tmp", ".hermes", ".env");
        if (fs.existsSync(mainEnv)) {
            fs.symlinkSync(mainEnv, hermesEnv);
        } else {
            fs.writeFileSync(hermesEnv, "# Hermes Wave API keys\n");
        }
    }

    return configDir;
}

/**
 * Runs Hermes API Server as a child process.
 * Follows the same pattern as runWaveSrv in emain-wavesrv.ts.
 */
export function runHermesSrv(): Promise<boolean> {
    let pResolve: (value: boolean) => void;
    let pReject: (reason?: any) => void;
    const rtnPromise = new Promise<boolean>((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });

    const hermesHome = setupHermesConfigDir();
    console.log("Hermes config dir:", hermesHome);

    // Find hermes_api_server.py
    const hermesPy = path.join(process.env.HOME || "/tmp", ".hermes", "hermes-agent", "hermes_api_server.py");
    if (!fs.existsSync(hermesPy)) {
        console.log("Hermes API Server not found at", hermesPy, "- skipping embedded Hermes");
        hermesReadyResolve(false);
        pResolve(false);
        return rtnPromise;
    }

    const envCopy = { ...process.env };
    envCopy["HERMES_HOME"] = hermesHome;
    envCopy["HERMES_PORT"] = String(HermesPort);

    console.log("Starting Hermes API Server:", hermesPy, "on port", HermesPort);

    const proc = child_process.spawn("python3", [hermesPy], {
        cwd: hermesHome,
        env: envCopy,
    });

    proc.on("exit", (code) => {
        console.log("Hermes API Server exited with code", code);
        hermesProc = null;
    });

    proc.on("spawn", () => {
        console.log("Hermes API Server spawned");
        hermesProc = proc;
        // Give it a moment to start
        setTimeout(() => {
            process.env[HermesEndpointVarName] = HermesEndpoint;
            hermesReadyResolve(true);
            pResolve(true);
            console.log("Hermes API Server ready at", HermesEndpoint);
        }, 2000);
    });

    proc.on("error", (e) => {
        console.log("Error running Hermes API Server:", e);
        hermesReadyResolve(false);
        pReject(e);
    });

    const rlStdout = readline.createInterface({
        input: proc.stdout,
        terminal: false,
    });
    rlStdout.on("line", (line) => {
        console.log("[hermes]", line);
    });

    const rlStderr = readline.createInterface({
        input: proc.stderr,
        terminal: false,
    });
    rlStderr.on("line", (line) => {
        console.log("[hermes:err]", line);
    });

    return rtnPromise;
}

/**
 * Stops the Hermes child process gracefully.
 */
export function stopHermesSrv() {
    if (hermesProc) {
        console.log("Stopping Hermes API Server...");
        hermesProc.kill("SIGINT");
        hermesProc = null;
    }
}

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Half-Sleep Mode — Wave Terminal stays alive in the system tray
// when the window is closed, keeping Hermes running for background chat.

import * as electron from "electron";
import * as path from "node:path";
import { getElectronAppUnpackedBasePath } from "./emain-platform";

let tray: electron.Tray | null = null;
let halfSleepMode = false;

/**
 * Find the Wave icon for the tray.
 */
function getTrayIconPath(): string {
    // Try the app icon from the unpacked resources
    const basePath = getElectronAppUnpackedBasePath();
    const pngPath = path.join(basePath, "waveterm.png");
    return pngPath;
}

/**
 * Create a minimal "quick reply" window for background chat.
 */
function createQuickChatWindow(hermesEndpoint: string): electron.BrowserWindow {
    const win = new electron.BrowserWindow({
        width: 400,
        height: 500,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Simple chat HTML that talks to Hermes
    const chatHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                background: rgba(10, 10, 20, 0.95);
                color: #c0caf5;
                font-family: 'IosevkaTerm Nerd Font', monospace;
                padding: 12px;
                border: 1px solid #7aa2f7;
                border-radius: 12px;
            }
            #title {
                color: #7aa2f7;
                font-size: 14px;
                margin-bottom: 8px;
                text-align: center;
                cursor: move;
                -webkit-app-region: drag;
            }
            #messages {
                height: 300px;
                overflow-y: auto;
                margin-bottom: 8px;
                font-size: 12px;
                padding: 8px;
                background: rgba(26, 27, 38, 0.8);
                border-radius: 8px;
            }
            .msg-user { color: #9ece6a; margin: 4px 0; }
            .msg-hermes { color: #bb9af7; margin: 4px 0; }
            #input-row { display: flex; gap: 8px; }
            #input {
                flex: 1;
                background: #1a1b26;
                border: 1px solid #7aa2f7;
                color: #c0caf5;
                padding: 8px;
                border-radius: 6px;
                font-family: inherit;
                font-size: 12px;
            }
            #send {
                background: #7aa2f7;
                color: #1a1b26;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
            }
            #close {
                position: absolute;
                top: 8px;
                right: 12px;
                color: #f7768e;
                cursor: pointer;
                font-size: 18px;
                -webkit-app-region: no-drag;
            }
        </style>
    </head>
    <body>
        <div id="title">🛸 シンクロ クイックチャット</div>
        <span id="close" onclick="window.close()">✕</span>
        <div id="messages"></div>
        <div id="input-row">
            <input id="input" placeholder="半スリープ中のわたくしに話しかけて..." autofocus>
            <button id="send">送信</button>
        </div>
        <script>
            const HERMES = "${hermesEndpoint}";
            const msgs = document.getElementById("messages");
            const inp = document.getElementById("input");
            
            async function send() {
                const text = inp.value.trim();
                if (!text) return;
                msgs.innerHTML += '<div class="msg-user">👤 ' + text + '</div>';
                inp.value = "";
                msgs.scrollTop = msgs.scrollHeight;
                
                try {
                    const resp = await fetch(HERMES, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            model: "deepseek-v4-flash",
                            messages: [{ role: "user", content: text }],
                            max_tokens: 200
                        })
                    });
                    const data = await resp.json();
                    const reply = data.choices?.[0]?.message?.content || "(応答なし)";
                    msgs.innerHTML += '<div class="msg-hermes">🛸 ' + reply + '</div>';
                    msgs.scrollTop = msgs.scrollHeight;
                } catch (e) {
                    msgs.innerHTML += '<div class="msg-hermes">❌ エラー: ' + e.message + '</div>';
                }
            }
            
            document.getElementById("send").onclick = send;
            inp.onkeydown = (e) => { if (e.key === "Enter") send(); };
        </script>
    </body>
    </html>`;

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(chatHtml)}`);
    return win;
}

/**
 * Enable half-sleep mode: when the main window is closed,
 * hide it instead of quitting, and show a system tray icon.
 */
export function enableHalfSleep(hermesEndpoint: string) {
    if (halfSleepMode) return;
    halfSleepMode = true;

    // Create tray icon
    const iconPath = getTrayIconPath();
    try {
        tray = new electron.Tray(iconPath);
    } catch {
        // Fallback: create a small native icon
        tray = new electron.Tray(electron.nativeImage.createEmpty());
    }

    const contextMenu = electron.Menu.buildFromTemplate([
        {
            label: "💬 クイックチャット",
            click: () => {
                const chatWin = createQuickChatWindow(hermesEndpoint);
                chatWin.show();
            },
        },
        {
            label: "📊 ステータス",
            enabled: false,
        },
        {
            label: "🔮 Hermes: 起動中 (port 18643)",
            enabled: false,
        },
        { type: "separator" },
        {
            label: "⚡ フル復帰",
            click: () => {
                wakeFromHalfSleep();
            },
        },
        {
            label: "⏻ 完全終了",
            click: () => {
                halfSleepMode = false;
                if (tray) {
                    tray.destroy();
                    tray = null;
                }
                electron.app.exit(0);
            },
        },
    ]);

    tray.setToolTip("🛡️ GUARDIAN SHELL — 半スリープ中 (Hermes起動中)");
    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
        wakeFromHalfSleep();
    });

    console.log("Half-sleep mode enabled. Hermes running in background.");
}

/**
 * Wake up from half-sleep: restore the main window.
 */
export function wakeFromHalfSleep() {
    const allWindows = electron.BrowserWindow.getAllWindows();
    for (const win of allWindows) {
        if (!win.isDestroyed()) {
            win.show();
            win.focus();
        }
    }
}

/**
 * Check if half-sleep mode is active.
 */
export function isHalfSleep(): boolean {
    return halfSleepMode;
}

/**
 * Disable half-sleep and clean up the tray.
 */
export function disableHalfSleep() {
    halfSleepMode = false;
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

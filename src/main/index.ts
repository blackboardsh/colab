import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Screen,
	Tray,
	Updater,
	Utils,
} from "electrobun";

import { type WorkspaceRPC } from "../renderers/ivde/rpc";

import { basename, dirname, join, relative } from "path";
import path from "path";

import * as biome from "./peerDependencies/biome";
import * as bun from "./peerDependencies/bun";
import * as git from "./peerDependencies/git";
import * as node from "./peerDependencies/node";
import * as typescript from "./peerDependencies/typescript";

import { cpSync } from "fs";
import { copy } from "fs-extra";
import { writeFile } from "fs/promises";
import {
	APP_PATH,
	BIOME_BINARY_PATH,
	BIOME_PACKAGE_PATH,
	BUN_BINARY_PATH,
	BUN_DEPS_FOLDER,
	BUN_PATH,
	COLAB_DEPS_PATH,
	COLAB_ENV_PATH,
	COLAB_HOME_FOLDER,
	COLAB_PROJECTS_FOLDER,
	COLAB_MODELS_PATH,
	GIT_BINARY_PATH,
	LLAMA_CPP_BINARY_PATH,
	TSSERVER_PATH,
	TYPESCRIPT_PACKAGE_PATH,
} from "./consts/paths";
import { formatFile } from "./utils/formatUtils";
import { tsServerRequest } from "./utils/tsServerUtils";
import { execSpawnSync } from "./utils/processUtils";

import db, { type CurrentDocumentTypes } from "./goldfishdb/db";

import { COLAB_GOLDFISHDB_PATH } from "./consts/paths";
import {
	broadcastToAllWindows,
	broadcastToAllWindowsInWorkspace,
	broadcastToWindow,
	sendToFocusedWindow,
	setFocusedWindow,
	clearFocusedWindow,
	workspaceWindows,
} from "./workspaceWindows";

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from "fs";

import type { Subprocess } from "bun";
import { type PostMessageShowContextMenu } from "../shared/types/types";
import type { PreviewFileTreeType } from "../shared/types/types";
import { makeFileNameSafe } from "../shared/utils/files";
import {
	closeProjectDirectoryWatcher,
	removeProjectDirectoryWatcher,
	watchProjectDirectories,
} from "./FileWatcher";
import { track } from "./utils/analytics";
import {
	findAllInFolder,
	findFilesInFolder,
	findFirstNestedGitRepo,
	getUniqueNewName,
	// parentNodePath,
	// readSlateConfigFile,
	safeDeleteFileOrFolder,
	safeTrashFileOrFolder,
	syncDevlink,
} from "./utils/fileUtils";
import {
	gitAdd,
	gitApply,
	gitCheckIsRepoInTree,
	gitCheckIsRepoRoot,
	gitCheckout,
	gitCommit,
	gitCommitAmend,
	gitDiff,
	gitStageHunkFromPatch,
	gitStageSpecificLines,
	gitStageMonacoChange,
	gitUnstageMonacoChange,
	gitCreatePatchFromLines,
	gitLog,
	gitReset,
	gitRevert,
	gitRevParse,
	gitShow,
	gitStashApply,
	gitStashCreate,
	gitStashList,
	gitStashPop,
	gitStashShow,
	gitStatus,
	initGit,
	gitClone,
	gitValidateUrl,
	gitRemote,
	gitAddRemote,
	gitFetch,
	gitPull,
	gitPush,
	gitBranch,
	gitCheckoutBranch,
	gitRevList,
	gitMergeBase,
	gitLogRemoteOnly,
	gitCreateBranch,
	gitDeleteBranch,
	gitTrackRemoteBranch,
	getGitConfig,
	setGitConfig,
	checkGitHubCredentials,
	storeGitHubCredentials,
	removeGitHubCredentials,
} from "./utils/gitUtils";
import { terminalManager } from "./utils/terminalManager";
// import { terminalManagerPty as terminalManager } from "./utils/terminalManagerPty";
import { getFaviconForUrl } from "./utils/urlUtils";
import { pluginManager, searchPlugins, getPackageInfo } from "./plugins";

const localInfo = await Updater.getLocalInfo();

const channel = localInfo.channel;
const appName = localInfo.name;
const version = localInfo.version;
const hash = localInfo.hash;

track.appOpen({ channel, appName, version, hash });

// This is a main process cache of the state sent to windows
// ie: if a window is created after the state is updated they should
// also know if there's an update.
const updateCache: {
	// YYY - replace any types
	status: any | null;
	info: any | null;
	progress: any | null;
	downloadedFile: boolean;
	error: null | {
		message: string;
		stack: string;
	};
} = {
	status: null,
	info: null,
	progress: null,
	downloadedFile: false,
	error: null,
};

// START SETUP

// install peer dependencies
// node.install();
typescript.install();
biome.install();
// Note: llama-cli is bundled with the app, not downloaded

// Activate all enabled plugins
pluginManager.activateAllEnabled().catch((e) => {
	console.warn("Failed to activate plugins on startup:", e);
});

// Wire up plugin terminal commands to terminal manager
terminalManager.setPluginCommandHandlers(
	(commandLine) => pluginManager.getTerminalCommand(commandLine),
	(commandLine, terminalId, cwd, write) =>
		pluginManager.executeTerminalCommand(commandLine, terminalId, cwd, write),
);

// Wire up built-in 'edit' command to terminal manager
terminalManager.setEditCommandHandler(async (args, terminalId, cwd, write) => {
	for (const arg of args) {
		// Expand ~ to home directory
		let expandedArg = arg;
		if (arg.startsWith("~/")) {
			expandedArg = path.join(process.env.HOME || "", arg.slice(2));
		} else if (arg === "~") {
			expandedArg = process.env.HOME || "";
		}

		// Resolve path relative to terminal's current directory
		const filePath = path.isAbsolute(expandedArg)
			? expandedArg
			: path.join(cwd, expandedArg);

		// Check if file/folder exists
		const exists = existsSync(filePath);
		const isDir = exists && statSync(filePath).isDirectory();

		if (isDir) {
			// For directories, add as project
			const folderName = basename(filePath);
			write(`Adding project: ${folderName}\r\n`);
			sendToFocusedWindow("openFolderAsProject", { folderPath: filePath });
		} else {
			// For files (existing or new)
			if (!exists) {
				// Create the file if it doesn't exist
				try {
					writeFileSync(filePath, "", { encoding: "utf-8" });
					write(`Created: ${filePath}\r\n`);
				} catch (err) {
					write(`\x1b[31mError creating file: ${err.message}\x1b[0m\r\n`);
					continue;
				}
			}

			write(`Opening: ${arg}\r\n`);
			sendToFocusedWindow("openFileInEditor", {
				filePath,
				createIfNotExists: false,
			});
		}
	}
	return true;
});

// END SETUP
const checkForUpdate = async () => {
	try {
		updateCache.status = "checking-for-update";
		broadcastToAllWindows("updateStatus", updateCache);

		const updateInfo = await Electrobun.Updater.checkForUpdate();

		track.checkForUpdate({
			hash: updateInfo.hash,
			version: updateInfo.version,
			updateAvailable: updateInfo.updateAvailable,
			updateReady: updateInfo.updateReady,
		});

		if (updateInfo.error) {
			updateCache.status = "error";
			updateCache.error = {
				message: updateInfo.error,
				stack: "",
			};
			broadcastToAllWindows("updateStatus", updateCache);
		} else if (updateInfo.updateAvailable) {
			console.log("update available");
			// todo (yoav): add a button to the UI to trigger this
			// await Electrobun.Updater.downloadUpdate();
			// const newUpdate = updateInfo.hash !== updateCache.info?.hash;

			updateCache.status = "update-available";
			updateCache.info = updateInfo;
			broadcastToAllWindows("updateStatus", updateCache);

			// if (newUpdate) {
			await Electrobun.Updater.downloadUpdate();

			if (Electrobun.Updater.updateInfo().updateReady) {
				console.log("update app");
				updateCache.status = "update-downloaded";
				updateCache.downloadedFile = true;

				broadcastToAllWindows("updateStatus", updateCache);
				// await Electrobun.Updater.applyUpdate();
			} else {
				updateCache.status = "update-not-downloaded";
				updateCache.downloadedFile = false;

				broadcastToAllWindows("updateStatus", updateCache);
			}
			// }
		} else {
			updateCache.status = "update-not-available";
			updateCache.info = updateInfo;
			broadcastToAllWindows("updateStatus", updateCache);
		}
	} catch (err) {
		updateCache.status = "error";

		updateCache.error = {
			message: err.message,
			stack: err.stack?.toString() || "",
		};
		broadcastToAllWindows("updateStatus", updateCache);
	}
};

// let state = {};

let toggleWorkspace: (workspaceId: string) => void;

// function createAboutWindow() {
//   new BrowserWindow({
//     frame: {
//       width: 800,
//       height: 800,
//       x: 0,
//       y: 0,
//     },
//     title: "Acknowledgements",
//     url: "views://assets/licenses.html",
//   });
// }

function createAboutWindow(url: string) {
	new BrowserWindow({
		frame: {
			width: 800,
			height: 800,
			x: 0,
			y: 0,
		},
		title: "About",
		url,
	});
}

function deleteProject(workspaceId: string, projectId: string) {
	removeProjectDirectoryWatcher(projectId);
	db.collection("projects").remove(projectId);

	const workspace = db.collection("workspaces").queryById(workspaceId).data;
	if (workspace) {
		db.collection("workspaces").update(workspaceId, {
			projectIds: workspace.projectIds.filter(
				(projectIds) => projectIds !== projectId,
			),
		});
	}

	broadcastToAllWindowsInWorkspace(workspaceId, "deleteProject", {
		projectId,
	});
}

// Built-in global shortcuts that should work even when webview has focus
// These map accelerator strings to their key components for broadcasting
const builtInShortcuts: Array<{
	accelerator: string;
	key: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
	action?: string; // Optional action for menu items that have custom handling
}> = [
	// Cmd+T - new browser tab
	{
		accelerator: "t",
		key: "t",
		ctrl: false,
		shift: false,
		alt: false,
		meta: true,
		action: "new-browser-tab",
	},
	// Cmd+P - open command palette (file search)
	{
		accelerator: "p",
		key: "p",
		ctrl: false,
		shift: false,
		alt: false,
		meta: true,
		action: "open-command-palette",
	},
	// Cmd+Shift+P - open command palette (commands)
	{
		accelerator: "cmd+shift+p",
		key: "p",
		ctrl: false,
		shift: true,
		alt: false,
		meta: true,
	},
	// Cmd+Shift+F - find all in folder
	{
		accelerator: "cmd+shift+f",
		key: "f",
		ctrl: false,
		shift: true,
		alt: false,
		meta: true,
	},
	// Cmd+W - close tab
	{
		accelerator: "w",
		key: "w",
		ctrl: false,
		shift: false,
		alt: false,
		meta: true,
	},
	// Cmd+Shift+W - close window
	{
		accelerator: "cmd+shift+w",
		key: "w",
		ctrl: false,
		shift: true,
		alt: false,
		meta: true,
	},
	// Ctrl+Tab - next tab (won't work when webview focused, but standard shortcut)
	{
		accelerator: "ctrl+tab",
		key: "Tab",
		ctrl: true,
		shift: false,
		alt: false,
		meta: false,
	},
	// Ctrl+Shift+Tab - previous tab
	{
		accelerator: "ctrl+shift+tab",
		key: "Tab",
		ctrl: true,
		shift: true,
		alt: false,
		meta: false,
	},
];

// Track registered plugin shortcuts to avoid duplicates
let registeredPluginShortcuts: Set<string> = new Set();

// Convert plugin key format to Electrobun accelerator format
// Plugin format: "ctrl+shift+m" or "cmd+p"
// Electrobun format: "cmd+p", "cmd+shift+m", etc.
function convertToAccelerator(keyStr: string): string {
	const parts = keyStr.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	const hasCmd = parts.includes("cmd") || parts.includes("meta");
	const hasCtrl = parts.includes("ctrl");
	const hasShift = parts.includes("shift");
	const hasAlt = parts.includes("alt");

	// Build accelerator string
	const modifiers: string[] = [];
	if (hasCmd) modifiers.push("cmd");
	if (hasCtrl) modifiers.push("ctrl");
	if (hasAlt) modifiers.push("alt");
	if (hasShift) modifiers.push("shift");

	if (modifiers.length > 0) {
		return `${modifiers.join("+")}+${key}`;
	}
	return key;
}

// Function to update the application menu with current shortcuts
function updateApplicationMenu() {
	// Build plugin shortcuts menu items (visible so accelerators register)
	const pluginShortcutItems = Array.from(registeredPluginShortcuts).map(
		(keyStr) => {
			const accelerator = convertToAccelerator(keyStr);
			console.log(`Plugin shortcut: ${keyStr} -> accelerator: ${accelerator}`);
			return {
				type: "normal" as const,
				label: `Plugin: ${keyStr}`,
				action: `plugin-shortcut:${keyStr}`,
				accelerator: accelerator,
			};
		},
	);

	ApplicationMenu.setApplicationMenu([
		{
			label: "co(lab)",
			submenu: [{ role: "quit", accelerator: "cmd+q" }],
		},
		{
			label: "File",
			submenu: [
				{
					type: "normal",
					label: "Open File...",
					action: "open-file",
					accelerator: "cmd+o",
				},
				{
					type: "normal",
					label: "Open Folder...",
					action: "open-folder",
					accelerator: "cmd+shift+o",
				},
				{ type: "separator" },
				{
					type: "normal",
					label: "New Browser Tab",
					action: "new-browser-tab",
					accelerator: "cmd+t",
				},
				{
					type: "normal",
					label: "Close Tab",
					action: "close-tab",
					accelerator: "cmd+w",
				},
				{
					type: "normal",
					label: "Close Window",
					action: "close-window",
					accelerator: "cmd+shift+w",
				},
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ role: "delete" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{
					type: "normal",
					label: "Next Tab",
					action: "global-shortcut:ctrl+tab",
					accelerator: "ctrl+tab",
				},
				{
					type: "normal",
					label: "Previous Tab",
					action: "global-shortcut:ctrl+shift+tab",
					accelerator: "ctrl+shift+tab",
				},
			],
		},
		{
			label: "Tools",
			submenu: [
				{
					type: "normal",
					label: "Command Palette",
					action: "open-command-palette",
					accelerator: "cmd+p",
				},
				{
					type: "normal",
					label: "Command Palette (Commands)",
					action: "global-shortcut:cmd+shift+p",
					accelerator: "cmd+shift+p",
				},
				{
					type: "normal",
					label: "Find in Files",
					action: "global-shortcut:cmd+shift+f",
					accelerator: "cmd+shift+f",
				},
				// Add plugin shortcuts here if any exist
				...(pluginShortcutItems.length > 0
					? [{ type: "separator" as const }, ...pluginShortcutItems]
					: []),
			],
		},
		{
			label: "Settings",
			submenu: [
				{
					type: "normal",
					label: "Plugins",
					action: "plugin-marketplace",
				},
				{
					type: "normal",
					label: "Llama Settings",
					action: "llama-settings",
				},
				{
					type: "normal",
					label: "Colab Settings",
					action: "colab-settings",
				},
				{
					type: "normal",
					label: "Workspace Settings",
					action: "workspace-settings",
				},
			],
		},
		{
			role: "help",
			label: "Help",
			submenu: [
				{
					type: "normal",
					label: "Terms of Service",
					action: "terms-of-service",
				},
				{
					type: "normal",
					label: "Privacy Statement",
					action: "privacy-statement",
				},
				{
					type: "normal",
					label: "Acknowledgements",
					action: "acknowledgements",
				},
			],
		},
	]);
}

// Helper to parse key strings like "ctrl+shift+m" for menu accelerators
function parseKeyStringForMenu(keyStr: string): {
	key: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
} {
	const parts = keyStr.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	return {
		key,
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
		meta: parts.includes("meta") || parts.includes("cmd"),
	};
}

// Function to sync plugin keybindings to the application menu
async function syncPluginKeybindings() {
	try {
		const keybindings = pluginManager.getKeybindings();
		const newShortcuts = new Set<string>();

		for (const kb of keybindings) {
			// Convert plugin key format to accelerator format
			// Plugin format: "ctrl+shift+m" or "cmd+p"
			// Accelerator format: same, but we need to track them
			newShortcuts.add(kb.key);
		}

		// Only update menu if shortcuts changed
		const hasChanges =
			newShortcuts.size !== registeredPluginShortcuts.size ||
			[...newShortcuts].some((s) => !registeredPluginShortcuts.has(s));

		if (hasChanges) {
			console.log("Plugin keybindings changed:", Array.from(newShortcuts));
			registeredPluginShortcuts = newShortcuts;
			updateApplicationMenu();
		}
	} catch (err) {
		console.warn("Failed to sync plugin keybindings:", err);
	}
}

// Initial menu setup
updateApplicationMenu();

// Sync plugin keybindings periodically (every 5 seconds)
setInterval(syncPluginKeybindings, 5000);

// Initial sync after plugins are loaded
setTimeout(syncPluginKeybindings, 1000);

ApplicationMenu.on("application-menu-clicked", (e) => {
	const { action } = e.data;

	if (action === "terms-of-service") {
		createAboutWindow("https://colab.dev/terms-of-service");
	} else if (action === "privacy-statement") {
		createAboutWindow("https://colab.dev/privacy");
	} else if (action === "acknowledgements") {
		createAboutWindow("views://assets/licenses.html");
	} else if (action === "open-file") {
		// Open file dialog and send file to editor
		(async () => {
			const files = await Utils.openFileDialog({
				startingFolder: process.env.HOME || "/",
				allowedFileTypes: "",
				canChooseFiles: true,
				canChooseDirectory: false,
				allowsMultipleSelection: true,
			});
			for (const filePath of files) {
				sendToFocusedWindow("openFileInEditor", {
					filePath,
					createIfNotExists: false,
				});
			}
		})();
	} else if (action === "open-folder") {
		// Open folder dialog and add as project
		(async () => {
			const folders = await Utils.openFileDialog({
				startingFolder: process.env.HOME || "/",
				allowedFileTypes: "",
				canChooseFiles: false,
				canChooseDirectory: true,
				allowsMultipleSelection: false,
			});
			for (const folderPath of folders) {
				sendToFocusedWindow("openFolderAsProject", { folderPath });
			}
		})();
	} else if (action === "open-command-palette") {
		// Send to focused window only (not all windows)
		sendToFocusedWindow("openCommandPalette", {});
	} else if (action === "new-browser-tab") {
		sendToFocusedWindow("newBrowserTab", {});
	} else if (action === "close-tab") {
		sendToFocusedWindow("closeCurrentTab", {});
	} else if (action === "close-window") {
		sendToFocusedWindow("closeCurrentWindow", {});
	} else if (action === "plugin-marketplace") {
		sendToFocusedWindow("openSettings", { settingsType: "plugin-marketplace" });
	} else if (action === "llama-settings") {
		sendToFocusedWindow("openSettings", { settingsType: "llama-settings" });
	} else if (action === "colab-settings") {
		sendToFocusedWindow("openSettings", { settingsType: "global-settings" });
	} else if (action === "workspace-settings") {
		sendToFocusedWindow("openSettings", { settingsType: "workspace-settings" });
	} else if (action.startsWith("global-shortcut:")) {
		// Handle global shortcuts that need to work when webview has focus
		const accelerator = action.replace("global-shortcut:", "");
		const shortcut = builtInShortcuts.find(
			(s) => s.accelerator === accelerator,
		);
		if (shortcut) {
			sendToFocusedWindow("handleGlobalShortcut", {
				key: shortcut.key,
				ctrl: shortcut.ctrl,
				shift: shortcut.shift,
				alt: shortcut.alt,
				meta: shortcut.meta,
			});
		}
	} else if (action.startsWith("plugin-shortcut:")) {
		// Handle plugin shortcuts
		const keyStr = action.replace("plugin-shortcut:", "");
		const parsed = parseKeyStringForMenu(keyStr);
		sendToFocusedWindow("handleGlobalShortcut", {
			key: parsed.key,
			ctrl: parsed.ctrl,
			shift: parsed.shift,
			alt: parsed.alt,
			meta: parsed.meta,
		});
	}
});

const tray = new Tray({
	title: `co(lab)${channel !== "stable" ? `-${channel}` : ""}`,
	image: "views://assets/icon_32x32@2x.png",
	template: false,
	width: 18,
	height: 18,
});

tray.on("tray-clicked", (e) => {
	const { action } = e.data;

	if (action.startsWith("toggle-workspace:")) {
		const workspaceId = action.split(":")[1];
		toggleWorkspace(workspaceId);
	} else if (action === "create-workspace") {
		// Use setTimeout to make workspace creation asynchronous and avoid blocking the main thread
		setTimeout(() => {
			createWorkspace();
			updateTrayMenu();
		}, 0);
		return; // Early return to skip the immediate updateTrayMenu call
	} else if (action === "reset-database") {
		console.log("resetting database", COLAB_GOLDFISHDB_PATH);
		// Note: this is defined internally to goldfish, we just use it
		const DB_FILE = join(COLAB_GOLDFISHDB_PATH, "goldfish.db");
		writeFileSync(DB_FILE, "");
	} else if (action === "check-for-update") {
		checkForUpdate();
	} else if (action === "quit-and-install-update") {
		track.installUpdateNow({ triggeredBy: "user" });
		cleanupLlamaProcesses();
		Electrobun.Updater.applyUpdate();
	} else if (action === "quit") {
		Electrobun.Utils.quit();
	}

	updateTrayMenu();
});

// Get the db ids for workspace and window from the electrobun window id
const broadcastToElectrobunWindow = (nativeWindowId, method, opts) => {
	let workspaceId;
	let windowId;

	Object.keys(workspaceWindows).find((_workspaceId) => {
		return Object.keys(workspaceWindows[_workspaceId]).find((winId) => {
			// console.log(workspaceWindows[workspaceId][winId]);
			const nativeWindow = workspaceWindows[_workspaceId][winId].win;

			if (nativeWindow.id === nativeWindowId) {
				workspaceId = _workspaceId;
				windowId = winId;
				return true;
			}
		});
	});

	if (workspaceId && windowId) {
		broadcastToWindow(workspaceId, windowId, method, opts);
	}
};

// TODO: new tab via cmd+click are handled in the browser to maintain preload.js status.
// but we should also handle other types of popups somehow here. maybe just have a log somewhere so people can manually open them
// if they want.
// Electrobun.events.on("new-window-open", (e) => {
//   console.log('new-window-open: ', e)

//   const webviewId = e.data.id;
//   const targetUrl = e.data.detail.url;

//   const webview = BrowserView.getById(webviewId)
//   const windowId = webview.windowId;

//   console.log('webview: ', webviewId, 'in window: ', windowId, 'to: ', targetUrl)

//   broadcastToElectrobunWindow(windowId, 'openUrlInNewTab', {url: targetUrl})

// })

// Download events from webviews
Electrobun.events.on("download-started", (e) => {
	const { id: webviewId, detail } = e.data;
	const { filename, path } = detail;
	console.log(`Download started: ${filename} -> ${path}`);

	// Find which window this webview belongs to and broadcast to it
	const webview = Electrobun.BrowserView.getById(webviewId);
	if (webview) {
		broadcastToElectrobunWindow(webview.windowId, "downloadStarted", {
			filename,
			path,
		});
	}
});

Electrobun.events.on("download-progress", (e) => {
	const { id: webviewId, detail } = e.data;
	const { progress } = detail;

	// Find which window this webview belongs to and broadcast to it
	const webview = Electrobun.BrowserView.getById(webviewId);
	if (webview) {
		broadcastToElectrobunWindow(webview.windowId, "downloadProgress", {
			progress,
		});
	}
});

Electrobun.events.on("download-completed", (e) => {
	const { id: webviewId, detail } = e.data;
	const { filename, path } = detail;
	console.log(`Download completed: ${filename} -> ${path}`);

	// Find which window this webview belongs to and broadcast to it
	const webview = Electrobun.BrowserView.getById(webviewId);
	if (webview) {
		broadcastToElectrobunWindow(webview.windowId, "downloadCompleted", {
			filename,
			path,
		});
	}
});

Electrobun.events.on("download-failed", (e) => {
	const { id: webviewId, detail } = e.data;
	const { filename, path, error } = detail;
	console.log(`Download failed: ${filename} - ${error}`);

	// Find which window this webview belongs to and broadcast to it
	const webview = Electrobun.BrowserView.getById(webviewId);
	if (webview) {
		broadcastToElectrobunWindow(webview.windowId, "downloadFailed", {
			filename,
			path,
			error,
		});
	}
});

Electrobun.events.on("context-menu-clicked", (e) => {
	const action = e.data.action;
	const data = e.data.data || {};

	if (action === "focus_tab") {
		const { workspaceId, windowId, tabId } = data;
		broadcastToWindow(workspaceId, windowId, "focusTab", { tabId });
	} else if (action === "open_new_tab") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "openNewTab", { nodePath });
	} else if (action === "open_as_text") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "openAsText", { nodePath });
	} else if (action === "show_node_settings") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "showNodeSettings", { nodePath });
	} else if (action === "add_child_node") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", { nodePath });
	} else if (action === "add_child_file") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", {
			nodePath,
			nodeType: "file",
		});
	} else if (action === "add_child_folder") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", {
			nodePath,
			nodeType: "dir",
		});
	} else if (action === "add_child_web") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", {
			nodePath,
			nodeType: "web",
		});
	} else if (action === "add_child_agent") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", {
			nodePath,
			nodeType: "agent",
		});
	} else if (action === "create_preload_file") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "createSpecialFile", {
			nodePath,
			fileType: "preload",
		});
	} else if (action === "create_context_file") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "createSpecialFile", {
			nodePath,
			fileType: "context",
		});
	} else if (action === "new_terminal") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "newTerminal", { nodePath });
	} else if (action === "init_git_in_folder") {
		const { nodePath } = data;
		initGit(nodePath).then(() => {
			//   setNodeExpanded(node.path, true);
		});
	} else if (action === "clone_repo_to_folder") {
		const { workspaceId, windowId, nodePath } = data;
		broadcastToWindow(workspaceId, windowId, "addChildNode", {
			nodePath,
			nodeType: "repo",
		});
	} else if (action === "copy_path_to_clipboard") {
		const { workspaceId, windowId, nodePath } = data;
		console.log("copy path to clipboard", nodePath);
		broadcastToWindow(workspaceId, windowId, "copyToClipboard", {
			text: nodePath,
		});
	} else if (action === "open_node_in_finder") {
		const { nodePath } = data;
		console.log("open node in folder", nodePath);

		Utils.showItemInFolder(nodePath);
	} else if (action === "remove_project_from_colab") {
		const { workspaceId, windowId, projectId } = data;
		console.log("remove_project_from_colab", projectId);
		deleteProject(workspaceId, projectId);
	} else if (action === "fully_delete_project_from_disk_and_colab") {
		const { workspaceId, windowId, projectId } = data;
		console.log("fully_delete_project_from_disk_and_colab", projectId);
		const { data: _project } = db.collection("projects").queryById(projectId);
		const path = _project?.path;
		deleteProject(workspaceId, projectId);
		if (path) {
			safeTrashFileOrFolder(path);
		}
	} else if (action === "fully_delete_node_from_disk") {
		const { workspaceId, windowId, nodePath, projectId } = data;
		console.log("fully_delete_node_from_disk", nodePath, projectId);

		// If this is a project node, also remove it from the database
		if (projectId) {
			deleteProject(workspaceId, projectId);
		}

		safeTrashFileOrFolder(nodePath);
	} else if (action === "plugin_context_menu_item") {
		const { itemId, filePath } = data;
		console.log("plugin_context_menu_item", itemId, filePath);

		// Execute the plugin context menu handler
		pluginManager.executeContextMenuItem(itemId, { filePath }).catch((err) => {
			console.error("Failed to execute plugin context menu item:", err);
		});
	} else if (action === "split_pane_container") {
		const { workspaceId, windowId, pathToPane, direction } = data;

		broadcastToWindow(workspaceId, windowId, "splitPaneContainer", {
			pathToPane,
			direction,
		});
	} else if (action === "remove_open_file") {
		const { workspaceId, windowId, filePath } = data;
		// This is handled in the renderer - broadcast the event
		broadcastToWindow(workspaceId, windowId, "removeOpenFile", { filePath });
	} else if (action === "open_open_file") {
		const { workspaceId, windowId, filePath } = data;
		// Open the file in the editor
		broadcastToWindow(workspaceId, windowId, "openFileInEditor", {
			filePath,
			createIfNotExists: false,
		});
	}
});

// TODO: There's a bun bug where updateInfo() sometimes returns undefined according to typescript
// you have to manually call a second checkForUpdates to get it to update properly
// revisit after upgrading to the latest bun
const canQuitAndInstall = () => {
	return Electrobun.Updater.updateInfo()?.updateReady;
};

let findAllProcesses: (Subprocess | null)[] = [];
let findFilesProcesses: (Subprocess | null)[] = [];
let findFilesTimeout: ReturnType<typeof setTimeout> | undefined;

const updateTrayMenu = () => {
	const workspaces = db.collection("workspaces").query()?.data || {};

	const trayMenu = [
		...workspaces.map((workspace) => {
			return {
				label: workspace.name || "",
				checked: Boolean(workspace.visible && workspace.windows?.length),
				action: `toggle-workspace:${workspace.id}`,
			};
		}),
		{
			type: "divider",
		},
		{
			label: "Create New Workspace",
			action: "create-workspace",
		},
		{
			type: "divider",
		},
		{
			label: "Emergency Stuff",
			submenu: [
				{
					label: "Reset Database",
					action: "reset-database",
				},
			],
		},
		{
			type: "divider",
		},
		{
			label: "Check for update",
			action: "check-for-update",
		},
		{
			hidden: !canQuitAndInstall(),
			label: `Quit and install Update (${updateCache.info?.version})`,
			action: "quit-and-install-update",
		},
		{
			type: "divider",
		},
		{
			type: "normal",
			label: "Quit",
			action: "quit",
		},
	];

	tray.setMenu(trayMenu);
};

// todo: move this to another file, and update the tray whenever the workspaces or updates change

updateTrayMenu();

function getRandomHexColor() {
	const hexChars = "0123456789ABCDEF";
	let color = "#";
	for (let i = 0; i < 6; i++) {
		color += hexChars[Math.floor(Math.random() * 16)];
	}
	return color;
}

const createWorkspace = () => {
	const { data: workspaces } = db.collection("workspaces").query();

	const newWorkspace = db.collection("workspaces").insert({
		name: `workspace-${workspaces.length + 1}`,
		color: getRandomHexColor(),
		// todo (yoav): implement default values in goldfishdb
		visible: true,
		projectIds: [],
		windows: [],
	});

	createWindow(newWorkspace.id);
};

const openWorkspaceWindows = (
	workspace: CurrentDocumentTypes["workspaces"],
) => {
	if (!workspace.windows?.length) {
		const newWindow = createWindow(workspace.id);
	} else {
		workspace.windows.forEach((window) => {
			const newWindow = createWindow(workspace.id, window);
		});
	}
};

const hideWorkspaceWindows = (
	workspace: CurrentDocumentTypes["workspaces"],
) => {
	const windows = Object.values(workspaceWindows[workspace.id]);

	windows.forEach(({ win, id }) => {
		workspaceWindows[workspace.id][id].status = "hiding";
		// Since the window's close handler won't be fired we need to allow unloading here
		// XXX - will-prevent-unload
		// win.webContents.on("will-prevent-unload", (e) => {
		//   e.preventDefault();
		// });
		win.close();
	});
};

type WindowConfigType = NonNullable<
	CurrentDocumentTypes["workspaces"]["windows"]
>[0];

const getWorkspaceForWindow = (windowId: number) => {
	const { data: workspaces } = db.collection("workspaces").query();

	return workspaces?.find((workspace) => {
		return workspace.windows.find((win) => {
			console.log("win: ", win, windowId);
			return win.id === String(windowId);
		});
	});
};

// If window is not provided then it will create a new window for the workspace
const createWindow = (
	workspaceId: string,
	window?: WindowConfigType,
	offset?: { x: number; y: number },
) => {
	// console.log("---> createWindow", window);
	if (!window) {
		const workspace = db.collection("workspaces").queryById(workspaceId).data;

		if (!workspace) {
			return;
		}

		const existingWindows = workspace.windows || [];

		// Calculate position with optional offset from current windows
		const baseX = offset?.x || 0;
		const baseY = offset?.y || 0;

		const updatedWorkspace = db.collection("workspaces").update(workspaceId, {
			// todo (yoav): [blocking] we absolutely must have typing for this structure here
			windows: [
				...existingWindows,
				{
					id: `${workspace.id}.${Date.now()}`,
					ui: {
						showSidebar: true,
						sidebarWidth: 250,
					},
					position: {
						x: baseX,
						y: baseY,
						width: 1500,
						height: 900,
					},
					expansions: [],
					// todo (yoav): [blocking] since this is not typed in the schema
					// there's no check for the shape of this object
					rootPane: {
						id: "root",
						type: "pane",
						tabIds: [],
						currentTab: null, // tab id
					},
					tabs: {},
					currentPaneId: "root",
				},
			],
		});

		window = updatedWorkspace.windows?.[updatedWorkspace.windows.length - 1];
	}

	// console.log("---> createWindow 2", window);

	if (!window) {
		return;
	}

	const windowId = window.id;

	// const mainWindow = new BrowserWindow({
	//   titleBarStyle: "hiddenInset",
	//   movable: true,
	//   resizable: true,
	//   minimizable: true,
	//   maximizable: true,
	//   backgroundColor: "#1e1e1e",

	//   frame: false,
	//   width: window.position.width,
	//   height: window.position.height,
	//   x: window.position.x || undefined,
	//   y: window.position.y || undefined,
	//   webPreferences: {
	//     nodeIntegration: true,
	//     contextIsolation: false,
	//     webSecurity: false,
	//     scrollBounce: false,
	//     backgroundThrottling: false,
	//     disableDialogs: true,
	//     spellcheck: false,
	//     zoomFactor: 1,
	//     webviewTag: true,
	//   },
	// });

	const WorkspaceRPC = BrowserView.defineRPC<WorkspaceRPC>({
		maxRequestTime: 5000,
		handlers: {
			requests: {
				getInitialState: () => {
					// Set this window as focused when it requests initial state
					setFocusedWindow(workspaceId, windowId);
					console.log("getInitialState - calling fetchProjects...");
					const data = fetchProjects() || {};
					console.log("getInitialState - received data:", data);

					return {
						windowId: windowId,
						buildVars: localInfo,
						paths: {
							APP_PATH,
							COLAB_HOME_FOLDER,
							COLAB_PROJECTS_FOLDER,
							COLAB_DEPS_PATH,
							COLAB_ENV_PATH,
							BUN_BINARY_PATH,
							BIOME_BINARY_PATH,
							TSSERVER_PATH,
							GIT_BINARY_PATH,
							BUN_PATH,
							BUN_DEPS_FOLDER,
							TYPESCRIPT_PACKAGE_PATH,
							BIOME_PACKAGE_PATH,
						},
						peerDependencies: {
							bun: {
								installed: bun.isInstalled(),
								version: bun.getVersion(),
							},
							// node: {
							//   installed: node.isInstalled(),
							//   version: node.getVersion(),
							// },
							typescript: {
								installed: typescript.isInstalled(),
								version: typescript.getVersion(),
							},
							biome: {
								installed: biome.isInstalled(),
								version: biome.getVersion(),
							},
							git: {
								installed: git.isInstalled(),
								version: git.getVersion(),
							},
						},
						...data,
					};
				},

				newPreviewNode: ({ candidateName }) => {
					const nodeName = getUniqueNewName(
						COLAB_PROJECTS_FOLDER || "",
						"new-project",
					);

					const newNode: PreviewFileTreeType = {
						type: "dir",
						name: nodeName,
						path: join(COLAB_PROJECTS_FOLDER || "", nodeName),
						previewChildren: [],
						isExpanded: false,
						slate: {
							v: 1,
							name: "",
							url: "",
							icon: "",
							type: "project",
							config: {},
						},
					};

					return newNode;
				},
				addProject: ({ projectName, path }) => {
					const workspace = db
						.collection("workspaces")
						.queryById(workspaceId).data;

					if (!workspace) {
						return { success: false, error: "Workspace not found" };
					}

					const insertedProject = db
						.collection("projects")
						.insert({ name: projectName, path });

					// todo (yoav): update should take a function
					db.collection("workspaces").update(workspaceId, {
						projectIds: [...(workspace.projectIds || []), insertedProject.id],
					});

					fetchAndSendProjects();

					return { success: true, projectId: insertedProject.id };
				},
				showContextMenu: ({ menuItems }) => {
					Electrobun.ContextMenu.showContextMenu(menuItems);
				},
				getFaviconForUrl: ({ url }) => {
					console.log("get favicon request", url);
					return getFaviconForUrl(url);
				},
				copy: ({ src, dest }) => {
					return copy(src, dest);
				},
				gitShow: ({ repoRoot, options }) => {
					return gitShow(repoRoot, options);
				},
				gitCommit: ({ repoRoot, msg }) => {
					return gitCommit(repoRoot, msg);
				},
				gitCommitAmend: ({ repoRoot, msg }) => {
					return gitCommitAmend(repoRoot, msg);
				},
				gitAdd: ({ repoRoot, files }) => {
					return gitAdd(repoRoot, files);
				},
				gitLog: ({ repoRoot, options, limit, skip }) => {
					return gitLog(repoRoot, options, limit, skip);
				},
				gitStatus: ({ repoRoot }) => {
					return gitStatus(repoRoot);
				},
				gitDiff: ({ repoRoot, options }) => {
					return gitDiff(repoRoot, options);
				},
				gitCheckout: ({ repoRoot, hash }) => {
					return gitCheckout(repoRoot, hash);
				},
				gitCheckIsRepoRoot: ({ repoRoot }) => {
					return gitCheckIsRepoRoot(repoRoot);
				},
				gitCheckIsRepoInTree: ({ repoRoot }) => {
					return gitCheckIsRepoInTree(repoRoot);
				},
				findFirstNestedGitRepo: ({ searchPath, timeoutMs }) => {
					return findFirstNestedGitRepo(searchPath, timeoutMs);
				},
				gitRevParse: ({ repoRoot, options }) => {
					return gitRevParse(repoRoot, options);
				},
				gitReset: ({ repoRoot, options }) => {
					return gitReset(repoRoot, options);
				},
				gitRevert: ({ repoRoot, commitHash, options }) => {
					return gitRevert(repoRoot, commitHash, options);
				},
				gitApply: ({ repoRoot, options, patch }) => {
					return gitApply(repoRoot, options, patch);
				},
				gitStageHunkFromPatch: ({ repoRoot, patch }) => {
					return gitStageHunkFromPatch(repoRoot, patch);
				},
				gitStageSpecificLines: ({ repoRoot, filePath, startLine, endLine }) => {
					return gitStageSpecificLines(repoRoot, filePath, startLine, endLine);
				},
				gitStageMonacoChange: ({
					repoRoot,
					filePath,
					originalContent,
					targetChange,
					modifiedContent,
				}) => {
					return gitStageMonacoChange(
						repoRoot,
						filePath,
						originalContent,
						targetChange,
						modifiedContent,
					);
				},
				gitUnstageMonacoChange: ({
					repoRoot,
					filePath,
					originalContent,
					targetChange,
					stagedContent,
				}) => {
					return gitUnstageMonacoChange(
						repoRoot,
						filePath,
						originalContent,
						targetChange,
						stagedContent,
					);
				},
				gitCreatePatchFromLines: ({
					repoRoot,
					filePath,
					startLine,
					endLine,
				}) => {
					return gitCreatePatchFromLines(
						repoRoot,
						filePath,
						startLine,
						endLine,
					);
				},
				gitStashList: ({ repoRoot }) => {
					return gitStashList(repoRoot);
				},
				gitStashCreate: ({ repoRoot, message, options }) => {
					return gitStashCreate(repoRoot, message, options);
				},
				gitStashApply: ({ repoRoot, stashName }) => {
					return gitStashApply(repoRoot, stashName);
				},
				gitStashPop: ({ repoRoot, stashName }) => {
					return gitStashPop(repoRoot, stashName);
				},
				gitStashShow: ({ repoRoot, stashName }) => {
					return gitStashShow(repoRoot, stashName);
				},
				gitRemote: ({ repoRoot }) => {
					return gitRemote(repoRoot);
				},
				gitFetch: ({ repoRoot, remote, options }) => {
					return gitFetch(repoRoot, remote, options);
				},
				gitPull: ({ repoRoot, remote, branch, options }) => {
					return gitPull(repoRoot, remote, branch, options);
				},
				gitPush: ({ repoRoot, remote, branch, options }) => {
					return gitPush(repoRoot, remote, branch, options);
				},
				gitBranch: ({ repoRoot, options }) => {
					return gitBranch(repoRoot, options);
				},
				gitCheckoutBranch: ({ repoRoot, branch, options }) => {
					return gitCheckoutBranch(repoRoot, branch, options);
				},
				gitRevList: ({ repoRoot, options }) => {
					return gitRevList(repoRoot, options);
				},
				gitMergeBase: ({ repoRoot, refs }) => {
					return gitMergeBase(repoRoot, refs);
				},
				gitLogRemoteOnly: ({ repoRoot, localBranch, remoteBranch }) => {
					return gitLogRemoteOnly(repoRoot, localBranch, remoteBranch);
				},
				gitClone: ({ repoPath, gitUrl, createMainBranch }) => {
					return gitClone(repoPath, gitUrl, createMainBranch);
				},
				gitValidateUrl: ({ gitUrl }) => {
					return gitValidateUrl(gitUrl);
				},
				getGitConfig: () => {
					return getGitConfig();
				},
				setGitConfig: ({ name, email }) => {
					return setGitConfig(name, email);
				},
				checkGitHubCredentials: () => {
					return checkGitHubCredentials();
				},
				storeGitHubCredentials: ({ username, token }) => {
					return storeGitHubCredentials(username, token);
				},
				removeGitHubCredentials: () => {
					return removeGitHubCredentials();
				},
				gitCreateBranch: ({ repoRoot, branchName, options }) => {
					return gitCreateBranch(repoRoot, branchName, options);
				},
				gitDeleteBranch: ({ repoRoot, branchName, options }) => {
					return gitDeleteBranch(repoRoot, branchName, options);
				},
				gitTrackRemoteBranch: ({ repoRoot, branchName, remoteName }) => {
					return gitTrackRemoteBranch(repoRoot, branchName, remoteName);
				},
				gitAddRemote: ({ repoRoot, remoteName, remoteUrl }) => {
					return gitAddRemote(repoRoot, remoteName, remoteUrl);
				},
				syncWorkspace: (data) => {
					const { workspace: _workspace } = data;

					db.collection("workspaces").update(_workspace.id, _workspace);

					return;
				},
				syncAppSettings: (data) => {
					const { appSettings } = data;

					// Get existing settings (there should be only one record)
					const existingSettings =
						db.collection("appSettings").query()?.data || [];

					if (existingSettings.length > 0) {
						// Update the first (and should be only) settings record
						const existingId = existingSettings[0].id;
						db.collection("appSettings").update(existingId, {
							...existingSettings[0],
							...appSettings,
						});
					} else {
						// No settings exist yet, create the first one
						// This should only happen if analytics.ts hasn't run yet
						db.collection("appSettings").insert({
							distinctId: String(Date.now() + Math.random()), // Same pattern as analytics.ts
							...appSettings,
						});
					}

					return;
				},
				openFileDialog: ({
					startingFolder,
					allowedFileTypes,
					canChooseFiles,
					canChooseDirectory,
					allowsMultipleSelection,
				}) => {
					return Utils.openFileDialog({
						startingFolder,
						allowedFileTypes,
						canChooseFiles,
						canChooseDirectory,
						allowsMultipleSelection,
					});
				},
				findAllInWorkspace: ({ query }) => {
					const workspace = db
						.collection("workspaces")
						.queryById(workspaceId).data;

					if (!workspace) {
						return [];
					}

					// Kill any existing find all processes immediately
					findAllProcesses.forEach((process) => {
						process?.kill();
					});
					findAllProcesses = [];

					if (!query) {
						return [];
					}

					// Batch results to reduce RPC message flooding
					// This gives cancellations a better chance to interrupt
					const resultBatches: Map<string, any[]> = new Map();
					let batchTimeout: Timer | null = null;
					let totalResultCount = 0;
					const MAX_TOTAL_RESULTS = 1000; // Stop after collecting 1000 results total

					const flushBatches = () => {
						resultBatches.forEach((results, projectId) => {
							if (results.length > 0) {
								sendToMainWindow("findAllInFolderResult", {
									query,
									projectId,
									results,
								});
							}
						});
						resultBatches.clear();
					};

					// Start new searches for each project
					findAllProcesses = workspace.projectIds.map((projectId) => {
						const project = db.collection("projects").queryById(projectId).data;

						if (!project || !project.path) {
							return null;
						}

						// Initialize batch for this project
						resultBatches.set(projectId, []);

						return findAllInFolder(project.path, query, (result) => {
							// Stop accepting results if we've hit the limit
							if (totalResultCount >= MAX_TOTAL_RESULTS) {
								// Kill all processes once we have enough results
								findAllProcesses.forEach((process) => {
									process?.kill();
								});
								return;
							}

							const batch = resultBatches.get(projectId);
							if (batch) {
								batch.push(result);
								totalResultCount++;

								// Send first result immediately for instant feedback
								if (batch.length === 1 && !batchTimeout) {
									sendToMainWindow("findAllInFolderResult", {
										query,
										projectId,
										results: [...batch],
									});
									batch.length = 0; // Clear batch
									return;
								}

								// Send batches every 100ms or when batch reaches 50 results
								if (batch.length >= 50) {
									sendToMainWindow("findAllInFolderResult", {
										query,
										projectId,
										results: [...batch],
									});
									batch.length = 0; // Clear batch
								} else {
									// Throttle sends to every 100ms
									if (batchTimeout) {
										clearTimeout(batchTimeout);
									}
									batchTimeout = setTimeout(flushBatches, 100);
								}
							}
						});
					});

					return [];
				},
				findFilesInWorkspace: ({ query }) => {
					const workspace = db
						.collection("workspaces")
						.queryById(workspaceId).data;

					if (!workspace) {
						return [];
					}

					// Cancel previous debounce timeout
					if (findFilesTimeout) {
						clearTimeout(findFilesTimeout);
					}

					// Debounce: wait for fast typers to finish typing
					findFilesTimeout = setTimeout(() => {
						findFilesProcesses.forEach((process) => {
							process?.kill();
						});

						if (!query) {
							return [];
						}

						findFilesProcesses = workspace.projectIds.map((projectId) => {
							const project = db
								.collection("projects")
								.queryById(projectId).data;

							if (!project || !project.path) {
								return null;
							}

							return findFilesInFolder(project.path, query, (result) => {
								sendToMainWindow("findFilesInWorkspaceResult", {
									query,
									projectId: projectId,
									results: [result],
								});
							});
						});
					}, 400);

					return [];
				},
				cancelFileSearch: () => {
					findFilesProcesses.forEach((process) => {
						process?.kill();
					});
					findFilesProcesses = [];
					return true;
				},
				cancelFindAll: () => {
					findAllProcesses.forEach((process) => {
						process?.kill();
					});
					findAllProcesses = [];
					return true;
				},
				getNode: ({ path }) => {
					if (!existsSync(path)) {
						return null;
					}

					try {
						const name = path.split("/").pop();

						if (!name) {
							return null;
						}

						const stat = statSync(path);

						if (stat.isDirectory()) {
							// todo (yoav): consider filtering out nodes that aren't
							// files or folders
							const children = readdirSync(path);

							return {
								name,
								type: "dir",
								path,
								children,
							};
						}
						if (stat.isFile()) {
							return {
								name,
								type: "file",
								path,
								persistedContent: "",
								isDirty: false,
								model: null,
								editors: {},
							};
						}
					} catch (err) {
						console.error("error building file tree: ", err, path);
						return null;
					}

					return null;
				},
				readSlateConfigFile: ({ path }) => {
					try {
						if (existsSync(path)) {
							if (!statSync(path).isFile()) {
								return null;
							}

							const slateJson = readFileSync(path, "utf-8");
							const slate = JSON.parse(slateJson);

							// todo (yoav): [blocking] add versioning and migration flow here
							return slate;
						}
					} catch (err) {
						// todo (yoav): report this error to the user
						console.error(err);
					}
				},
				readFile: async ({ path }) => {
					try {
						const fs = await import("fs/promises");

						// Check if file exists and get size
						const stats = await fs.stat(path);
						const fileSizeBytes = stats.size;

						// Define limits
						const MAX_INITIAL_LOAD_BYTES = 10 * 1024 * 1024; // 10MB
						const BINARY_CHECK_BYTES = 8000; // Check first 8KB for binary content

						// Skip binary detection for known text file extensions
						const ext = path.split(".").pop()?.toLowerCase() || "";
						const knownTextExtensions = new Set([
							"ts",
							"tsx",
							"js",
							"jsx",
							"mjs",
							"cjs",
							"html",
							"htm",
							"css",
							"scss",
							"less",
							"json",
							"jsonc",
							"yaml",
							"yml",
							"toml",
							"ini",
							"xml",
							"svg",
							"md",
							"mdx",
							"txt",
							"log",
							"sh",
							"bash",
							"zsh",
							"fish",
							"py",
							"rb",
							"go",
							"rs",
							"java",
							"kt",
							"swift",
							"c",
							"cpp",
							"h",
							"hpp",
							"cs",
							"php",
							"r",
							"lua",
							"pl",
							"scala",
							"zig",
							"sql",
							"graphql",
							"gql",
							"proto",
							"lock",
							"env",
							"gitignore",
							"dockerignore",
						]);
						const isKnownText = knownTextExtensions.has(ext);

						if (!isKnownText) {
							// Read a sample to check if binary
							const fileHandle = await fs.open(path, "r");
							const sampleBuffer = Buffer.alloc(
								Math.min(BINARY_CHECK_BYTES, fileSizeBytes),
							);
							await fileHandle.read(sampleBuffer, 0, sampleBuffer.length, 0);
							await fileHandle.close();

							// Check for binary content (null bytes or high percentage of non-printable chars)
							let nonPrintableCount = 0;
							let nullByteFound = false;
							for (let i = 0; i < sampleBuffer.length; i++) {
								const byte = sampleBuffer[i];
								if (byte === 0) {
									nullByteFound = true;
									break;
								}
								// Count non-printable characters (excluding common whitespace)
								if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
									nonPrintableCount++;
								}
							}

							const nonPrintableRatio = nonPrintableCount / sampleBuffer.length;
							const isBinary = nullByteFound || nonPrintableRatio > 0.3;

							if (isBinary) {
								return {
									textContent: "",
									isBinary: true,
									totalBytes: fileSizeBytes,
								};
							}
						}

						// For text files, check if we need partial loading
						if (fileSizeBytes > MAX_INITIAL_LOAD_BYTES) {
							// Load only the first chunk
							const fileHandle = await fs.open(path, "r");
							const partialBuffer = Buffer.alloc(MAX_INITIAL_LOAD_BYTES);
							await fileHandle.read(
								partialBuffer,
								0,
								MAX_INITIAL_LOAD_BYTES,
								0,
							);
							await fileHandle.close();

							const partialContent = partialBuffer.toString("utf-8");

							return {
								textContent: partialContent,
								isBinary: false,
								loadedBytes: MAX_INITIAL_LOAD_BYTES,
								totalBytes: fileSizeBytes,
							};
						}

						// File is small enough, load it all
						const contents = await fs.readFile(path, "utf-8");
						return {
							textContent: contents,
							isBinary: false,
							loadedBytes: fileSizeBytes,
							totalBytes: fileSizeBytes,
						};
					} catch (err: any) {
						console.error("Error reading file:", err);
						return {
							textContent: "",
							error: err?.message || "Failed to read file",
						};
					}
				},
				writeFile: ({ path, value }) => {
					try {
						writeFileSync(path, value);
						return {
							success: true,
						};
					} catch (err: any) {
						return {
							success: false,
							error: err?.message || "",
						};
					}
				},
				touchFile: async ({ path, contents }) => {
					if (!existsSync(path)) {
						try {
							await writeFile(path, contents || "");
							return {
								success: true,
							};
						} catch (err: any) {
							return {
								success: false,
								error: err?.message || "",
							};
						}
					}

					return {
						success: false,
						error: "File already exists",
					};
				},
				rename: ({ oldPath, newPath }) => {
					try {
						renameSync(oldPath, newPath);
						return {
							success: true,
						};
					} catch (err: any) {
						return {
							success: false,
							error: err?.message || "",
						};
					}
				},
				exists: ({ path }) => {
					return existsSync(path);
				},
				showInFinder: ({ path }) => {
					Utils.showItemInFolder(path);
				},
				mkdir: ({ path }) => {
					try {
						mkdirSync(path);
						return {
							success: true,
						};
					} catch (err: any) {
						return {
							success: false,
							error: err?.message || "",
						};
					}
				},
				isFolder: ({ path }) => {
					return statSync(path).isDirectory();
				},
				getUniqueNewName: ({ parentPath, baseName }) => {
					return getUniqueNewName(parentPath, baseName);
				},
				makeFileNameSafe: ({ candidateFilename }) => {
					return makeFileNameSafe(candidateFilename);
				},
				safeDeleteFileOrFolder: ({ absolutePath }) => {
					console.log("syncRpc safeDeleteFileOrFolder", absolutePath);
					return safeDeleteFileOrFolder(absolutePath);
				},
				execSpawnSync: (
					{ cmd, args, opts } = { cmd: "", args: [], opts: {} },
				) => {
					if (!cmd) {
						throw new Error("cmd is required");
					}

					// Use bundled bun for bun/bunx commands
					let actualCmd = cmd;
					let actualArgs = args;
					if (cmd === "bun" || cmd === "bunx") {
						actualCmd = BUN_BINARY_PATH;
						// bunx is just "bun x"
						if (cmd === "bunx") {
							actualArgs = ["x", ...args];
						}
					}

					const result = execSpawnSync(actualCmd, actualArgs, opts);

					// Return full result with stdout, stderr, and exitCode
					return result;
				},
				safeTrashFileOrFolder: ({ path }) => {
					return safeTrashFileOrFolder(path);
				},
				createTerminal: ({ cwd, shell }) => {
					console.log(
						`RPC createTerminal called with cwd: ${cwd}, shell: ${shell}, windowId: ${windowId}`,
					);
					return terminalManager.createTerminal(cwd, shell, 80, 24, windowId);
				},
				writeToTerminal: ({ terminalId, data }) => {
					return terminalManager.writeToTerminal(terminalId, data);
				},
				resizeTerminal: ({ terminalId, cols, rows }) => {
					return terminalManager.resizeTerminal(terminalId, cols, rows);
				},
				killTerminal: ({ terminalId }) => {
					return terminalManager.killTerminal(terminalId);
				},
				getTerminalCwd: ({ terminalId }) => {
					return terminalManager.getTerminalCwd(terminalId);
				},
				llamaCompletion: async ({
					model,
					prompt,
					options,
				}: {
					model: string;
					prompt: string;
					options?: {
						temperature?: number;
						top_p?: number;
						max_tokens?: number;
						repeat_penalty?: number;
						stop?: string[];
					};
				}) => {
					// Initialize process tracker if it doesn't exist
					const processTracker = (globalThis.llamaProcesses =
						globalThis.llamaProcesses || new Map());

					// IMMEDIATELY kill all existing processes to favor the newest request
					console.log(
						`🔥 Killing ${processTracker.size} existing llama processes`,
					);
					for (const [id, existingProc] of processTracker.entries()) {
						try {
							// Try SIGTERM first
							existingProc.kill("SIGTERM");
							// Force kill with SIGKILL immediately (don't wait)
							setTimeout(() => {
								try {
									if (!existingProc.killed) {
										existingProc.kill("SIGKILL");
									}
								} catch (e) {
									// Process already dead
								}
							}, 100); // Only wait 100ms before force kill
						} catch (e) {
							// Silently ignore kill errors
						}
					}
					processTracker.clear();

					// Nuclear option: kill ALL llama-cli processes on the system
					try {
						const result = Bun.spawn(["pkill", "-f", "llama-cli"], {
							stdout: "ignore",
							stderr: "ignore",
						});
						await result.exited;
					} catch (e) {
						// Ignore pkill errors (no processes found, etc.)
					}

					let proc = null;
					try {
						// First, check for local llama.cpp models in COLAB_MODELS_PATH
						let modelPath: string | null = null;

						// Check if this is a direct .gguf filename in our models directory
						const localModelPath = path.join(
							COLAB_MODELS_PATH,
							model.endsWith(".gguf") ? model : `${model}.gguf`,
						);
						if (existsSync(localModelPath)) {
							modelPath = localModelPath;
							console.log(`Found local model: ${model} at ${modelPath}`);
						} else {
							// Also check without adding .gguf suffix (in case model name already includes it)
							const directModelPath = path.join(COLAB_MODELS_PATH, model);
							if (existsSync(directModelPath)) {
								modelPath = directModelPath;
								console.log(`Found local model: ${model} at ${modelPath}`);
							}
						}

						// Only use models from COLAB_MODELS_PATH

						if (!modelPath) {
							console.error(
								`Model not found: ${model} (checked ${COLAB_MODELS_PATH})`,
							);
							return {
								ok: false,
								status: 404,
								data: { error: `Model not found: ${model}` },
							};
						}

						console.log(`Resolved model "${model}" to path: ${modelPath}`);

						// Build the llama-cli command arguments
						const args = [
							"--model",
							modelPath, // Use resolved model path
							"--prompt",
							prompt,
							"--temperature",
							String(options?.temperature || 0.7), // Increase temperature to avoid edge cases
							"--n-predict",
							String(options?.max_tokens || 48), // Use n-predict instead of max-tokens
							"--top-p",
							String(options?.top_p || 0.95), // Slightly higher top-p
							"--repeat-penalty",
							String(options?.repeat_penalty || 1.1), // Slightly higher repeat penalty
							"--quiet", // Suppress verbose model loading output
						];

						// Add stop tokens
						// if (options?.stop && options.stop.length > 0) {
						//   for (const stopToken of options.stop) {
						//     args.push('--stop', stopToken);
						//   }
						// } else {
						//   // Default stop tokens for traditional code completion
						//   args.push('--stop', '\n');
						//   args.push('--stop', '\n\n');
						//   args.push('--stop', ';');
						//   args.push('--stop', '}');
						//   args.push('--stop', ')');
						//   args.push('--stop', ']');
						//   args.push('--stop', '<|endoftext|>');
						//   args.push('--stop', '<|im_end|>');
						// }

						// Use the peer dependency llama-cli binary
						const llamaCliBinary = LLAMA_CPP_BINARY_PATH;

						console.log(`Executing: ${llamaCliBinary} ${args.join(" ")}`);

						// Spawn llama-cli process with stderr suppressed for verbose output
						proc = Bun.spawn([llamaCliBinary, ...args], {
							stdout: "pipe",
							stderr: "ignore", // Suppress verbose llama.cpp output to terminal
						});

						// Store this process globally so it can be killed by future requests
						const requestId = Date.now();
						processTracker.set(requestId, proc);

						// Wait for completion with timeout
						const result = await Promise.race([
							proc.exited,
							new Promise(
								(_, reject) =>
									setTimeout(() => {
										// Kill the process on timeout
										try {
											proc.kill();
										} catch (e) {
											console.warn(
												"Failed to kill timed-out llama-cli process:",
												e,
											);
										}
										reject(new Error("llama-cli completion timeout"));
									}, 45000), // 45 second timeout (increased for VM)
							),
						]);

						// Clean up process tracker
						processTracker.delete(requestId);

						if (proc.exitCode !== 0) {
							console.error("llama-cli exited with code:", proc.exitCode);
							return {
								ok: false,
								error: `llama-cli process failed with exit code: ${proc.exitCode}`,
							};
						}

						// Read stdout (stderr is ignored to suppress verbose output)
						const stdout = await new Response(proc.stdout).text();
						const response = stdout.trim();

						// Check if the process actually succeeded
						if (result && result.exitCode !== 0) {
							console.error("llama-cli exited with code:", result.exitCode);
							return {
								ok: false,
								error: `llama-cli exited with code ${result.exitCode}`,
							};
						}

						return {
							ok: true,
							response: response,
						};
					} catch (error) {
						console.error("llama-cli completion error:", error);

						// Clean up process if it exists
						if (proc) {
							try {
								proc.kill();
							} catch (e) {
								console.warn("Failed to kill llama-cli process on error:", e);
							}
						}

						return {
							ok: false,
							error: error.message,
						};
					}
				},
				llamaListModels: async () => {
					const fs = await import("fs");
					const path = await import("path");

					try {
						const models: Array<{
							name: string;
							path: string;
							size: number;
							modified: string;
							source: "llama" | "legacy";
						}> = [];

						// Check llama.cpp models in COLAB_MODELS_PATH
						if (fs.existsSync(COLAB_MODELS_PATH)) {
							const files = fs.readdirSync(COLAB_MODELS_PATH);
							for (const file of files) {
								if (file.endsWith(".gguf")) {
									const filePath = path.join(COLAB_MODELS_PATH, file);
									const stats = fs.statSync(filePath);
									// Only include files larger than 100MB (actual models, not test files)
									if (stats.size > 100 * 1024 * 1024) {
										models.push({
											name: file.replace(".gguf", ""),
											path: filePath,
											size: stats.size,
											modified: stats.mtime.toISOString(),
											source: "llama",
										});
									}
								}
							}
						}

						// Only use llama.cpp models from COLAB_MODELS_PATH
						return {
							ok: true,
							models: models.sort((a, b) =>
								b.modified.localeCompare(a.modified),
							),
						};
					} catch (error) {
						return {
							ok: false,
							models: [],
							error: error instanceof Error ? error.message : "Unknown error",
						};
					}
				},
				llamaInstallModel: async ({ modelRef }: { modelRef: string }) => {
					const path = await import("path");
					const fs = await import("fs");

					try {
						// Parse Hugging Face URL (e.g., hf://Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/qwen2.5-coder-7b-instruct-q4_k_m.gguf)
						if (!modelRef.startsWith("hf://")) {
							return {
								ok: false,
								error: "Only Hugging Face models (hf://) are supported",
							};
						}

						const hfPath = modelRef.slice(5); // Remove 'hf://' prefix
						const pathParts = hfPath.split("/");

						if (pathParts.length < 3) {
							return {
								ok: false,
								error: "Invalid Hugging Face model reference",
							};
						}

						const [user, repo, ...fileParts] = pathParts;
						const fileName = fileParts.join("/");
						const localFileName = path.basename(fileName);
						const localFilePath = path.join(COLAB_MODELS_PATH, localFileName);

						console.log(
							`Using llama.cpp to download: ${user}/${repo}/${fileName}`,
						);
						console.log(`Saving to: ${localFilePath}`);

						// Ensure models directory exists
						if (!fs.existsSync(COLAB_MODELS_PATH)) {
							fs.mkdirSync(COLAB_MODELS_PATH, { recursive: true });
						}

						// Check if file already exists
						if (fs.existsSync(localFilePath)) {
							const stats = fs.statSync(localFilePath);
							if (stats.size > 1024 * 1024) {
								// At least 1MB
								console.log(`Model already exists: ${localFileName}`);
								return { ok: true, message: "Model already downloaded" };
							}
						}

						// Construct download URL for Hugging Face
						const downloadUrl = `https://huggingface.co/${user}/${repo}/resolve/main/${fileName}`;
						console.log(`Download URL: ${downloadUrl}`);

						// Initialize download tracking
						const downloadId = `${user}-${repo}-${path.basename(fileName)}`;
						if (!globalThis.modelDownloads) {
							globalThis.modelDownloads = new Map();
						}

						// Start download in background (don't await)
						const downloadPromise = (async () => {
							globalThis.modelDownloads.set(downloadId, {
								status: "downloading",
								progress: 0,
								fileName: localFileName,
							});

							try {
								// Use Bun's native fetch API for better progress tracking
								const response = await fetch(downloadUrl);

								if (!response.ok) {
									throw new Error(`HTTP error! status: ${response.status}`);
								}

								// Get the total size from headers
								const contentLength = response.headers.get("content-length");
								const totalBytes = contentLength
									? parseInt(contentLength, 10)
									: 0;

								// Create write stream
								const fileStream = Bun.file(localFilePath).writer();

								// Read the response body as a stream
								const reader = response.body?.getReader();
								if (!reader) {
									throw new Error("No response body");
								}

								let downloadedBytes = 0;

								while (true) {
									const { done, value } = await reader.read();
									if (done) break;

									// Write chunk to file
									await fileStream.write(value);

									// Update progress
									downloadedBytes += value.byteLength;
									if (totalBytes > 0) {
										const progress = Math.floor(
											(downloadedBytes / totalBytes) * 100,
										);
										globalThis.modelDownloads.set(downloadId, {
											status: "downloading",
											progress,
											fileName: localFileName,
											downloadedBytes,
											totalBytes,
										});
									}
								}

								// Close the file stream
								await fileStream.end();

								// Verify file was written successfully
								const stats = fs.statSync(localFilePath);
								if (stats.size > 1024 * 1024) {
									// At least 1MB
									console.log(
										`Model downloaded successfully: ${localFileName} (${stats.size} bytes)`,
									);

									globalThis.modelDownloads.set(downloadId, {
										status: "completed",
										progress: 100,
										fileName: localFileName,
										downloadedBytes: stats.size,
										totalBytes: stats.size,
									});
									console.log(`Model download completed: ${localFileName}`);
								} else {
									fs.unlinkSync(localFilePath);
									throw new Error(
										`Download failed - file too small (${stats.size} bytes)`,
									);
								}
							} catch (error) {
								console.error(`Download failed for ${localFileName}:`, error);

								// Clean up partial file if it exists
								if (fs.existsSync(localFilePath)) {
									try {
										fs.unlinkSync(localFilePath);
									} catch (e) {
										// Ignore cleanup errors
									}
								}

								globalThis.modelDownloads.set(downloadId, {
									status: "failed",
									progress: 0,
									fileName: localFileName,
									error:
										error instanceof Error ? error.message : "Unknown error",
								});
							}
						})();

						// Don't await the download, return immediately
						return { ok: true, downloading: true, downloadId };
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : "Unknown error",
						};
					}
				},
				llamaDownloadStatus: async ({
					downloadId,
				}: {
					downloadId?: string;
				}) => {
					try {
						if (!globalThis.modelDownloads) {
							return { ok: true, downloads: {} };
						}

						if (downloadId) {
							// Return status for specific download
							const status = globalThis.modelDownloads.get(downloadId);
							return { ok: true, status };
						} else {
							// Return all active downloads
							const downloads: Record<string, any> = {};
							for (const [id, status] of globalThis.modelDownloads.entries()) {
								downloads[id] = status;
							}
							return { ok: true, downloads };
						}
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : "Unknown error",
						};
					}
				},
				llamaRemoveModel: async ({ modelPath }: { modelPath: string }) => {
					const fs = await import("fs");

					try {
						if (fs.existsSync(modelPath)) {
							fs.unlinkSync(modelPath);
							return { ok: true };
						} else {
							return { ok: false, error: "Model file not found" };
						}
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to remove model",
						};
					}
				},

				// Plugin system handlers
				pluginSearch: async ({ query, size, from }) => {
					return searchPlugins({ query, size, from });
				},

				pluginGetInfo: async ({ packageName, version }) => {
					return getPackageInfo(packageName, version);
				},

				pluginInstall: async ({ packageName, version }) => {
					try {
						const plugin = await pluginManager.installPlugin(
							packageName,
							version,
						);
						return {
							ok: true,
							plugin: {
								name: plugin.name,
								version: plugin.version,
								state: plugin.state,
								enabled: plugin.enabled,
							},
						};
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to install plugin",
						};
					}
				},

				pluginUninstall: async ({ packageName }) => {
					try {
						await pluginManager.uninstallPlugin(packageName);
						return { ok: true };
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to uninstall plugin",
						};
					}
				},

				pluginActivate: async ({ packageName }) => {
					try {
						await pluginManager.activatePlugin(packageName);
						return { ok: true };
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to activate plugin",
						};
					}
				},

				pluginDeactivate: async ({ packageName }) => {
					try {
						await pluginManager.deactivatePlugin(packageName);
						return { ok: true };
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to deactivate plugin",
						};
					}
				},

				pluginSetEnabled: async ({ packageName, enabled }) => {
					try {
						await pluginManager.setPluginEnabled(packageName, enabled);
						return { ok: true };
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to update plugin",
						};
					}
				},

				pluginGetInstalled: () => {
					return pluginManager.getInstalledPlugins().map((p) => ({
						name: p.name,
						version: p.version,
						displayName: p.manifest.displayName,
						description: p.manifest.description,
						state: p.state,
						enabled: p.enabled,
						installedAt: p.installedAt,
						updatedAt: p.updatedAt,
						isLocal: p.isLocal,
						localPath: p.localPath,
					}));
				},

				pluginExecuteCommand: async ({ commandId, args }) => {
					try {
						const result = await pluginManager.executeCommand(
							commandId,
							...(args || []),
						);
						return { ok: true, result };
					} catch (error) {
						return {
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to execute command",
						};
					}
				},
				pluginGetPreloadScripts: () => {
					return pluginManager.getAllPreloadScripts();
				},
				pluginGetCompletions: async (params) => {
					return pluginManager.getCompletions(params.language, {
						linePrefix: params.linePrefix,
						lineText: params.lineText,
						lineNumber: params.lineNumber,
						column: params.column,
						filePath: params.filePath,
						triggerCharacter: params.triggerCharacter,
					});
				},
				pluginGetStatusBarItems: () => {
					return pluginManager.getStatusBarItems();
				},
				pluginGetFileDecoration: async ({ filePath }) => {
					const decoration = await pluginManager.getFileDecoration(filePath);
					return decoration || null;
				},
				pluginGetContextMenuItems: ({ context }) => {
					return pluginManager.getContextMenuItems(context);
				},
				pluginExecuteContextMenuItem: async ({
					itemId,
					filePath,
					selection,
				}) => {
					await pluginManager.executeContextMenuItem(itemId, {
						filePath,
						selection,
					});
					return { ok: true };
				},
				pluginGetKeybindings: () => {
					return pluginManager.getKeybindings();
				},
				pluginGetSettingsSchemas: () => {
					return pluginManager.getPluginsWithSettings();
				},
				pluginGetSettingsSchema: ({ pluginName }) => {
					return pluginManager.getPluginSettingsSchema(pluginName);
				},
				pluginGetSettingsValues: ({ pluginName }) => {
					return pluginManager.getPluginSettingsValues(pluginName);
				},
				pluginSetSettingValue: ({ pluginName, key, value }) => {
					pluginManager.setPluginSettingValue(pluginName, key, value);
					return { ok: true };
				},
				pluginHasSettings: ({ pluginName }) => {
					return pluginManager.hasPluginSettings(pluginName);
				},
				pluginGetEntitlements: ({ pluginName }) => {
					return pluginManager.getPluginEntitlements(pluginName);
				},
				pluginGetSettingValidationStatuses: ({ pluginName }) => {
					return pluginManager.getPluginSettingValidationStatuses(pluginName);
				},
				// Plugin state (arbitrary data)
				pluginGetState: ({ pluginName }) => {
					return pluginManager.getPluginState(pluginName);
				},
				pluginGetStateValue: ({ pluginName, key }) => {
					return pluginManager.getPluginStateValue(pluginName, key);
				},
				pluginSetStateValue: ({ pluginName, key, value }) => {
					pluginManager.setPluginStateValue(pluginName, key, value);
					return { ok: true };
				},
				// Settings messaging (for custom settings components)
				pluginSendSettingsMessage: ({ pluginName, message }) => {
					console.log(
						"[Main] pluginSendSettingsMessage received:",
						pluginName,
						message,
					);
					pluginManager.sendSettingsMessage(pluginName, message);
					return { ok: true };
				},
				pluginGetPendingSettingsMessages: ({ pluginName }) => {
					return pluginManager.getAndClearPendingSettingsMessages(pluginName);
				},
				pluginGetAllSlates: () => {
					return pluginManager.getAllSlates().map((s) => ({
						id: s.config.id,
						pluginName: s.pluginName,
						name: s.config.name,
						description: s.config.description,
						icon: s.config.icon,
						patterns: s.config.patterns,
						component: s.config.component,
						folderHandler: s.config.folderHandler,
					}));
				},
				pluginFindSlateForFile: ({ filePath }) => {
					const slate = pluginManager.findSlateForFile(filePath);
					if (!slate) return null;
					return {
						id: slate.config.id,
						pluginName: slate.pluginName,
						name: slate.config.name,
						description: slate.config.description,
						icon: slate.config.icon,
						patterns: slate.config.patterns,
						component: slate.config.component,
						folderHandler: slate.config.folderHandler,
					};
				},
				pluginFindSlateForFolder: ({ folderPath }) => {
					const slate = pluginManager.findSlateForFolder(folderPath);
					if (!slate) return null;
					return {
						id: slate.config.id,
						pluginName: slate.pluginName,
						name: slate.config.name,
						description: slate.config.description,
						icon: slate.config.icon,
						patterns: slate.config.patterns,
						component: slate.config.component,
						folderHandler: slate.config.folderHandler,
					};
				},
				// Slate instance lifecycle - mount/unmount/events
				pluginMountSlate: async ({ slateId, filePath, windowId }) => {
					// The render callback will be handled via messages
					// We store pending renders and the renderer polls for them
					const renders: Array<{ html?: string; script?: string }> = [];
					const instanceId = await pluginManager.mountSlate(
						slateId,
						filePath,
						(message) => {
							renders.push({ html: message.html, script: message.script });
						},
						windowId,
					);
					return { instanceId, initialRenders: renders };
				},
				pluginUnmountSlate: async ({ instanceId }) => {
					await pluginManager.unmountSlate(instanceId);
					return { ok: true };
				},
				pluginSlateEvent: async ({ instanceId, eventType, payload }) => {
					await pluginManager.sendSlateEvent(instanceId, eventType, payload);
					return { ok: true };
				},
				pluginGetSlateInstance: ({ instanceId }) => {
					return pluginManager.getSlateInstance(instanceId) || null;
				},
				pluginGetPendingSlateRenders: ({ instanceId }) => {
					return pluginManager.getAndClearPendingSlateRenders(instanceId);
				},
			},

			messages: {
				"*": (messageName, payload) => {
					// console.log(
					//   "bun onmessage from workspace window",
					//   messageName,
					//   payload
					// );
				},
				removeProjectDirectoryWatcher: ({ projectId }) => {
					removeProjectDirectoryWatcher(projectId);
				},
				closeProjectDirectoryWatcher: ({ projectId }) => {
					closeProjectDirectoryWatcher(projectId);
				},
				tsServerRequest: ({ command, args, metadata }) => {
					tsServerRequest(command, args, metadata);
				},
				formatFile: ({ path }) => {
					formatFile(path);
				},
				createWindow: ({ offset } = {}) => {
					createWindow(workspaceId, undefined, offset);
				},
				closeWindow: () => {
					mainWindow.close();
				},
				openDashWebsite: () => {
					if (!Utils.openExternal("https://blackboard.sh/dash/?utm_source=colab&utm_medium=app&utm_campaign=colab_to_dash")) {
						console.error("Could not open the Dash website in the default browser.");
					}
				},
				openBunnyWindow: ({ screenX, screenY }) => {
					openBunnyWindow(screenX, screenY);
				},
				createWorkspace: () => {
					// Use setTimeout to make workspace creation asynchronous and avoid blocking the main thread
					setTimeout(() => {
						createWorkspace();
					}, 0);
				},
				hideWorkspace: () => {
					toggleWorkspace(workspaceId);
				},
				installUpdateNow: () => {
					track.installUpdateNow({ triggeredBy: "user" });
					cleanupLlamaProcesses();
					Electrobun.Updater.applyUpdate();
				},
				addToken: ({ name, url, endpoint, token }) => {
					setTimeout(() => {
						const insertedToken = db
							.collection("tokens")
							.insert({ name, url, endpoint, token });

						fetchAndSendProjects();
					}, 0);
				},
				editProject: ({ projectId, projectName, path }) => {
					setTimeout(() => {
						const updatedProject = db.collection("projects").update(projectId, {
							name: projectName,
							path,
						});
						fetchAndSendProjects();
					}, 0);
				},
				deleteToken: ({ tokenId }) => {
					setTimeout(() => {
						db.collection("tokens").remove(tokenId);
						fetchAndSendProjects();
					}, 0);
				},
				updateWorkspace: (data) => {
					setTimeout(() => {
						db.collection("workspaces").update(workspaceId, data);
						// todo (yoav): it's dumb that we have to manually re-send this data, there should be an auto-subscribed
						// mechanism that refreshes it here, and or syncs it with the front-end data store
						fetchAndSendProjects();
					}, 0);
				},
				deleteWorkspace: () => {
					// todo (yoav): this should really be a unit tested db method in a single place
					// and re-used below
					const { data: _workspace } = db
						.collection("workspaces")
						.queryById(workspaceId);
					Object.values(workspaceWindows[workspaceId]).forEach(({ win }) => {
						win.close();
					});
					delete workspaceWindows[workspaceId];
					_workspace?.projectIds?.forEach((projectId) => {
						db.collection("projects").remove(projectId);
					});
					db.collection("workspaces").remove(workspaceId);
				},
				deleteWorkspaceCompletely: () => {
					const { data: _workspace } = db
						.collection("workspaces")
						.queryById(workspaceId);
					Object.values(workspaceWindows[workspaceId]).forEach(({ win }) => {
						win.close();
					});
					delete workspaceWindows[workspaceId];
					_workspace?.projectIds?.forEach((projectId) => {
						const { data: _project } = db
							.collection("projects")
							.queryById(projectId);
						const path = _project?.path;
						if (path) {
							safeTrashFileOrFolder(path);
						}
						db.collection("projects").remove(projectId);
					});
					db.collection("workspaces").remove(workspaceId);
				},
				removeProjectFromColabOnly: ({ projectId }) => {
					setTimeout(() => {
						deleteProject(workspaceId, projectId);
						fetchAndSendProjects();
					}, 0);
				},
				fullyDeleteProjectFromDiskAndColab: ({ projectId }) => {
					setTimeout(() => {
						const { data: _project } = db
							.collection("projects")
							.queryById(projectId);
						const path = _project?.path;
						deleteProject(workspaceId, projectId);

						if (path) {
							safeTrashFileOrFolder(path);
						}
						fetchAndSendProjects();
					}, 0);
				},
				fullyDeleteNodeFromDisk: ({ nodePath }) => {
					safeTrashFileOrFolder(nodePath);
				},
				syncDevlink: ({ nodePath }) => {
					syncDevlink(nodePath);
				},
				track: ({ event, properties }) => {
					const trackFn = track[event];
					if (!trackFn) {
						console.error("no track function found for event", event);
						return;
					}

					trackFn(properties);
				},
			},
		},
	});
	console.log("---->1 creating main window");
	const mainWindow = new BrowserWindow({
		titleBarStyle: "hiddenInset",
		frame: {
			width: window.position.width || 5,
			height: window.position.height || 5,
			x: window.position.x || 5,
			y: window.position.y || 5,
		},
		renderer: "cef",
		// url: "https://colab.sh",
		url: "views://ivde/index.html",
		rpc: WorkspaceRPC,
		// syncRpc: {},
		// titleBarStyle: "hiddenInset",
		// movable: true,
		// resizable: true,
		// minimizable: true,
		// maximizable: true,
		// backgroundColor: "#1e1e1e",

		// frame: false,

		// webPreferences: {
		//   nodeIntegration: true,
		//   contextIsolation: false,
		//   webSecurity: false,
		//   scrollBounce: false,
		//   backgroundThrottling: false,
		//   disableDialogs: true,
		//   spellcheck: false,
		//   zoomFactor: 1,
		//   webviewTag: true,
		// },
	});

	mainWindow.webview.on("dom-ready", () => {
		console.log("---->:: 2 main window dom-ready");
		// We never want the main window to navigate or reload once it's loaded
		mainWindow.webview.on("will-navigate", (e) => {
			console.log("---->:: 3 main window will navigate");
			e.response = { allow: false };
		});
	});

	// Track window focus using native macOS event
	mainWindow.on("focus", () => {
		console.log(`[main] Window ${windowId} received native focus event`);
		setFocusedWindow(workspaceId, windowId);
	});

	const sendToMainWindow = (type: string, data: any) => {
		const webview = mainWindow.webview;
		if (!webview?.ptr || !webview?.rpc) {
			return;
		}

		try {
			(webview.rpc as any).send(type, data);
		} catch (error) {
			console.error(
				`[main] Failed to send ${type} to window ${windowId}`,
				error,
			);
		}
	};

	// Set up terminal manager message handler for this window
	terminalManager.setWindowMessageHandler(windowId, (message) => {
		sendToMainWindow(message.type, {
			terminalId: message.terminalId,
			data: message.data,
			exitCode: message.exitCode,
			signal: message.signal,
		});
	});

	// Set up slate render message handler for plugin slates
	pluginManager.setSlateWindowMessageHandler((targetWindowId, message) => {
		if (targetWindowId === windowId) {
			const slateMessage = message as {
				type: string;
				instanceId: string;
				html?: string;
				script?: string;
			};
			sendToMainWindow("slateRender", {
				instanceId: slateMessage.instanceId,
				html: slateMessage.html,
				script: slateMessage.script,
			});
		}
	});

	// ZZZ - leave-html-full-screen
	// mainWindow.addListener("leave-html-full-screen", () => {
	// NOTE: There's a bug where a webview iframe exiting full screen
	// doesn't exit the parent document's full screen and so you end up with
	// the whole webview rendering into the main window's #top-layer and
	// inside the window the exit fullscreen event isn't even fired.
	// So we have to listen for it here, and then trigger a document.exitFullscreen manually
	// on the parent document.
	// ZZZ - fullscreen exit-full-screen-hack
	// portalChannel.port1.postMessage({
	//   type: "exit-full-screen-hack",
	//   data: {},
	// });
	// });

	mainWindow.on("move", (e) => {
		const { x, y } = e.data;
		const { data: workspaceToUpdate } = db
			.collection("workspaces")
			.queryById(workspaceId);
		if (workspaceToUpdate) {
			workspaceToUpdate.windows = workspaceToUpdate.windows?.map((w) => {
				if (w.id === windowId) {
					w.position = {
						...w.position,
						x,
						y,
					};
				}
				return w;
			});
			db.collection("workspaces").update(workspaceId, {
				windows: workspaceToUpdate.windows,
			});
		}
	});

	mainWindow.on("resize", (e) => {
		const { x, y, width, height } = e.data;

		const { data: workspaceToUpdate } = db
			.collection("workspaces")
			.queryById(workspaceId);
		if (workspaceToUpdate) {
			workspaceToUpdate.windows = workspaceToUpdate.windows?.map((w) => {
				if (w.id === windowId) {
					w.position = {
						x,
						y,
						width,
						height,
					};
				}
				return w;
			});
			db.collection("workspaces").update(workspaceId, {
				windows: workspaceToUpdate.windows,
			});
		}
	});

	// todo (yoav): we need a way to close/hide the windows without triggering removing it from the db
	mainWindow.on("close", (e) => {
		// unloading is blocked in the window's dom to prevent
		// refreshing
		// XXX - before unload
		// mainWindow.webContents.on("will-prevent-unload", (e) => {
		//   e.preventDefault();
		// });

		const workspaceWindow = workspaceWindows[workspaceId][windowId];
		// sometimes when quitting the app the window doesn't exist
		if (!workspaceWindow) {
			console.error(
				"workspaceWindow not found",
				workspaceId,
				windowId,
				workspaceWindows,
			);
			return true;
		}

		delete workspaceWindows[workspaceId][windowId];

		// Clean up terminals owned by this window
		terminalManager.removeWindowMessageHandler(windowId);

		// If we're just hiding it we don't want to remove it from the db
		if (workspaceWindow.status === "hiding") {
			return true;
		}

		// todo (yoav): provide function to update workspace
		const { data: workspaceToUpdate } = db
			.collection("workspaces")
			.queryById(workspaceId);

		if (workspaceToUpdate?.windows) {
			const visible = workspaceToUpdate.windows?.length > 1;

			db.collection("workspaces").update(workspaceId, {
				windows: workspaceToUpdate.windows.filter((w) => w.id !== windowId),
				visible,
			});

			updateTrayMenu();
		}
	});
	console.log("---->222 creating main window");
	// todo (yoav): [blocking] this should be a much smarter sync mechanism
	// there should be a goldfishdb client library that provides instant optimistic updates while
	// the backend sync is pending, or does typical client -> server request and updates the model when
	// finished in a more atomic way
	const fetchAndSendProjects = () => {
		const data = fetchProjects();

		if (data) {
			const { workspace, projects, tokens, appSettings } = data;
			broadcastToAllWindowsInWorkspace(workspaceId, "setProjects", {
				workspace,
				projects,
				tokens,
				appSettings,
			});
		}
	};

	const fetchProjects = () => {
		const workspace = db.collection("workspaces").queryById(workspaceId).data;

		if (!workspace) {
			return;
		}

		try {
			watchProjectDirectories();
		} catch (error) {
			console.warn(
				"[main] Failed to refresh project directory watchers:",
				error,
			);
		}

		const { data: projects } = db.collection("projects").query({
			where: (project) => Boolean(workspace.projectIds?.includes(project.id)),
		});
		const { data: tokens } = db.collection("tokens").query();
		const { data: appSettingsArray } = db.collection("appSettings").query();
		const appSettings = appSettingsArray[0]; // Get the first (and should be only) settings record

		console.log("fetchProjects - loaded appSettings:", appSettings);

		return { workspace, projects, tokens, appSettings };
	};

	workspaceWindows[workspaceId] = workspaceWindows[workspaceId] || {};

	workspaceWindows[workspaceId][windowId] = {
		id: windowId,
		win: mainWindow,
		status: "open",
	};
};

let { data: workspaces } = db.collection("workspaces").query();

if (workspaces.length === 0) {
	db.collection("workspaces").insert({
		name: "default workspace",
		color: "#000",
		visible: true,
		projectIds: [],
		windows: [],
	});

	workspaces = db.collection("workspaces").query()?.data || [];
}

workspaces.forEach((workspace) => {
	if (workspace.visible) {
		openWorkspaceWindows(workspace);
	}
});

toggleWorkspace = (workspaceId: string) => {
	const workspace = db.collection("workspaces").queryById(workspaceId)?.data;

	if (workspace) {
		if (workspace.visible) {
			hideWorkspaceWindows(workspace);
		} else {
			openWorkspaceWindows(workspace);
		}

		const newValue = !workspace.visible;
		db.collection("workspaces").update(workspaceId, { visible: newValue });
	}
};

setTimeout(() => {
	checkForUpdate();
}, 10_000);
const hour = 60 * 60 * 1000;
setInterval(() => {
	checkForUpdate();
}, hour);

// Cleanup function for llama processes
function cleanupLlamaProcesses() {
	console.log("🧹 Cleaning up llama processes...");
	const processTracker = (globalThis as any).llamaProcesses;
	if (processTracker && processTracker instanceof Map) {
		console.log(`Killing ${processTracker.size} active llama processes`);
		for (const [id, proc] of processTracker.entries()) {
			try {
				if (proc && !proc.killed) {
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 1000);
				}
			} catch (e) {
				console.warn(`Failed to kill llama process ${id}:`, e);
			}
		}
		processTracker.clear();
	}
}

// Cleanup function for plugins
async function cleanupPlugins() {
	console.log("🧹 Cleaning up plugins...");
	try {
		await pluginManager.shutdown();
	} catch (e) {
		console.warn("Failed to shutdown plugins:", e);
	}
}

// --- Bunny window ---
let bunnyWindow: BrowserWindow | null = null;

function openBunnyWindow(screenX?: number, screenY?: number) {
	if (bunnyWindow) {
		const win = bunnyWindow;
		bunnyWindow = null;
		win.close();
		return;
	}

	const size = 80 + Math.floor(Math.random() * 90);
	const halfSize = Math.floor(size / 2);
	// Center the window on the cursor position, or fall back to random
	let x: number;
	let y: number;
	if (screenX != null && screenY != null) {
		x = screenX - halfSize;
		y = screenY - halfSize;
	} else {
		const display = Screen.getPrimaryDisplay();
		const workArea = display.workArea;
		x =
			workArea.x +
			Math.floor(Math.random() * Math.max(0, workArea.width - size));
		y =
			workArea.y +
			Math.floor(Math.random() * Math.max(0, workArea.height - size));
	}

	const bunnyRpc = BrowserView.defineRPC<any>({
		maxRequestTime: 5000,
		handlers: {
			requests: {},
			messages: {
				bunnyClicked: () => {
					if (bunnyWindow) {
						const win = bunnyWindow;
						bunnyWindow = null;
						win.close();
					}
				},
			},
		},
	});

	const win = new BrowserWindow({
		title: "Bunny",
		url: "views://bunny/index.html",
		titleBarStyle: "hidden",
		transparent: true,
		frame: { width: size, height: size, x, y },
		rpc: bunnyRpc,
	});

	win.setAlwaysOnTop(true);
	bunnyWindow = win;

	function sendCursor() {
		const cursor = Screen.getCursorScreenPoint();
		const frame = win.getFrame();
		(win.webview.rpc as any)?.send?.cursorMove({
			screenX: cursor.x,
			screenY: cursor.y,
			winX: frame.x,
			winY: frame.y,
			winW: frame.width,
			winH: frame.height,
		});
	}

	// Adaptive-rate cursor polling
	const POLL_SLOW = 400;
	const POLL_FAST = 100;
	const FAST_DURATION = 1000;

	let pollTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastCursorX = 0;
	let lastCursorY = 0;
	let fastUntil = 0;

	function pollCursor() {
		pollTimeout = null;
		try {
			const cursor = Screen.getCursorScreenPoint();
			const moved = cursor.x !== lastCursorX || cursor.y !== lastCursorY;
			lastCursorX = cursor.x;
			lastCursorY = cursor.y;

			if (moved) {
				fastUntil = Date.now() + FAST_DURATION;
				sendCursor();
			}

			const delay = Date.now() < fastUntil ? POLL_FAST : POLL_SLOW;
			pollTimeout = setTimeout(pollCursor, delay);
		} catch {}
	}

	function startPolling() {
		if (pollTimeout) return;
		try {
			const cursor = Screen.getCursorScreenPoint();
			lastCursorX = cursor.x;
			lastCursorY = cursor.y;
		} catch {}
		pollTimeout = setTimeout(pollCursor, POLL_SLOW);
	}

	win.webview.on("dom-ready", () => {
		try {
			sendCursor();
		} catch {}
		startPolling();
	});

	win.on("closed", () => {
		if (pollTimeout) clearTimeout(pollTimeout);
		bunnyWindow = null;
	});
}

// Handle process termination signals
process.on("SIGINT", async () => {
	console.log("Received SIGINT, cleaning up...");
	cleanupLlamaProcesses();
	await cleanupPlugins();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("Received SIGTERM, cleaning up...");
	cleanupLlamaProcesses();
	await cleanupPlugins();
	process.exit(0);
});

process.on("beforeExit", async () => {
	console.log("Process beforeExit, cleaning up...");
	cleanupLlamaProcesses();
	await cleanupPlugins();
});

// Handle app quit - add cleanup when quit is called
process.on("exit", () => {
	console.log("Process exiting, cleaning up...");
	cleanupLlamaProcesses();
	// Note: can't await async in exit handler, plugins should already be cleaned up
});

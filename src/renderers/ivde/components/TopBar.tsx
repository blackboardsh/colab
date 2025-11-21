// import { render } from "solid-js/web";
import { produce } from "solid-js/store";
import { dirname, basename } from "../../utils/pathUtils";
import { getProjectForNodePath } from "../files";
import { electrobun } from "../init";
import {
  state,
  setState,
  openNewTabForNode,
  getWindow,
  focusTabWithId,
  openFileAt,
  updateSyncedState,
  getCurrentTab,
} from "../store";
import { For, type JSX, Show, createEffect, createSignal, createMemo } from "solid-js";

export const TopBar = () => {
  const setCommandPaletteOpen = (value: boolean) => {
    setState("ui", "showCommandPalette", value);
    if (!value) {
      electrobun.rpc?.request.cancelFileSearch();
    }
  };

  const onClickToggleSidebar = () => {
    const currentWindow = getWindow();
    if (!currentWindow) return;

    const showSidebar = !currentWindow.ui.showSidebar;
    // isResizingPane will cause active webviews to go into mirroring mode
    setState("isResizingPane", true);
    // give it a second to start before toggling the ui so the animation is smoother
    setTimeout(() => {
      // Update the workspace window state and persist to database
      setState(
        "workspace",
        "windows",
        (w) => w.id === currentWindow.id,
        "ui",
        "showSidebar",
        showSidebar
      );
      updateSyncedState();
    }, 200);
    // then after the animation is complete turn off mirroring mode
    setTimeout(() => {
      setState("isResizingPane", false);
    }, 800);
  };

  // todo (yoav): make this a util that follows the currentTabPath
  return (
    <div
      style={{
        height: "40px",
        width: "100%",
        background: "#222",
        display: "flex",
      }}
    >
      <div
        style={{
          "margin-left": "80px",
          width: "24px",
          height: "24px",
          background: "#333",
          color: "#888",
          "border-radius": "4px",
          "text-align": "center",
          "vertical-align": "middle",
          "line-height": "24px",
          "margin-top": "7px",
          cursor: "pointer",
          "-webkit-user-select": "none",
          border: "1px solid #1f1f1f",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
        onClick={onClickToggleSidebar}
      >
        <img
          width="16px"
          height="16px"
          src={`views://assets/file-icons/sidebar-left${
            getWindow()?.ui.showSidebar ? "-filled" : ""
          }.svg`}
        />
      </div>      

      <div
        class="electrobun-webkit-app-region-drag"
        style="flex-grow:1; height: 100%; cursor: move; "
      ></div>

      <Update />

      {/* Colab button */}
      <div
        style={`font-size: 13px;margin: 8px 0px; margin-right: -2px; cursor: pointer; display: flex; align-items: center; gap: 6px; background: ${
          state.buildVars.channel === "dev" ? "#5a1616" :
          state.buildVars.channel === "canary" ? "#076310" :
          "#184d8b"
        }; border-radius: 4px; padding: 2px 8px 2px 4px;`}
        title="This is a beta version of co(lab)"
        onClick={() => openNewTabForNode("__COLAB_INTERNAL__/web", false, { url: "https://github.com/blackboardsh/colab" })}
      >
        <img
          style={{
            height: "20px",
            width: "20px",
          }}
          src="views://assets/icon_32x32@2x.png"
        />
        <span style="color: #fff; font-weight: bold;">co(lab){state.buildVars.channel === "dev" ? " - dev" :
          state.buildVars.channel === "canary" ? " - canary" :
          "#184d8b"}</span>
      </div>

      <CommandPalette setOpen={setCommandPaletteOpen} />
    </div>
  );
};

const CommandPalette = ({ setOpen }: { setOpen: (value: boolean) => void }) => {
  const toggleOpen = (value = !state.ui.showCommandPalette) => {
    setOpen(value);
  };

  const open = () => {
    return state.ui.showCommandPalette;
  };

  // todo:
  // 3. add a way to open the file in the current pane
  // 4. add a section for open tabs that focuses the tab when clicked
  // 5. add search functionality

  // decide if we can ship before continuing
  // 2. move the workspace menu into the command palette
  // 1. move state to store so it can be opened and modified globally
  // 2. add selection mechanism connected to hover and keyboard up/down
  // 4. when first opening it should show the active tabs organized by last used
  // 5. open tabs should be shown first even when filtering with a grey line and heading

  const [fileMatches, setFileMatches] = createSignal<
    { name: string; description: string; project: string }[]
  >([]);

  const [openTabs, setOpenTabs] = createSignal<
    { name: string; description: string; project: string }[]
  >([]);

  const [workspaceCommands, setWorkspaceCommands] = createSignal<
    { name: string; description: string; action: () => void }[]
  >([]);

  const [colabCommands, setColabCommands] = createSignal<
    { name: string; description: string; action: () => void }[]
  >([]);

  const [selectedIndex, setSelectedIndex] = createSignal(0);

  // Flatten all items into a single array for navigation - needs to be a memo for reactivity
  const getAllItems = createMemo(() => {
    const items: any[] = [];

    openTabs().forEach((tab) => {
      items.push({ type: 'tab', ...tab });
    });

    workspaceCommands().forEach((cmd) => {
      items.push({ type: 'workspace', ...cmd });
    });

    colabCommands().forEach((cmd) => {
      items.push({ type: 'colab', ...cmd });
    });

    const files = fileMatches();
    files.forEach((file) => {
      items.push({ type: 'file', ...file });
    });

    return items;
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const allItems = getAllItems();
    const totalItems = allItems.length;

    if (totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((selectedIndex() + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((selectedIndex() - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = allItems[selectedIndex()];
      if (selectedItem) {
        if (selectedItem.type === 'tab') {
          focusTabWithId(selectedItem.tabId);
        } else if (selectedItem.type === 'workspace' || selectedItem.type === 'colab') {
          selectedItem.action();
        } else if (selectedItem.type === 'file') {
          openFileAt(selectedItem.path, 0, 0);
        }
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleOpen(false);
    }
  };

  const onCommandPaletteInput = (e: InputEvent) => {
    const value = e.target?.value;

    if (value !== state.commandPalette.query) {
      setState(
        produce((_state: AppState) => {
          _state.commandPalette = { query: value, results: {} };
        })
      );
    }

    // Trigger file search - results will stream in via findFilesInWorkspaceResult handler
    electrobun.rpc?.request.findFilesInWorkspace({ query: value });
  };

  createEffect((lastValue) => {
    if (open()) {
      resetOpenTabs();
      filterCommands();
      if (!lastValue) {
        setState("commandPalette", "query", "");
      }

      return true;
    }

    return false;
  });

  const resetOpenTabs = () => {
    const query = state.commandPalette.query;
    const queryRegex = new RegExp(query.split("").join(".*"), "i");
    const tabs = Object.values(getWindow(state)?.tabs || {}).reduce(
      (acc, tab) => {
        if (tab.type === "file") {
          // const node = state.fileCache[tab.path];
          const project = getProjectForNodePath(tab.path);
          const name = basename(tab.path);
          const folder = dirname(tab.path).replace(project?.path || "", "");
          const projectName = project?.name || basename(project?.path);
          if (name.match(queryRegex)) {
            acc.push({
              name: name,
              description: `${projectName} ${folder}`,
              path: tab.path,
              tabId: tab.id,
            });
          }
        } else if (tab.type === "web") {
          if (tab.url.match(queryRegex)) {
            acc.push({
              name: new URL(tab.url).host,
              description: tab.url,
              tabId: tab.id,
              // todo: tabs need to store which project they were opened under
              // project: "web",
            });
          }
        }

        return acc;
      },
      []
    );

    setOpenTabs(tabs);
  };

  const openWebTab = (url: string) => {
    openNewTabForNode("__COLAB_INTERNAL__/web", false, { url });
  };

  const globalSettingsClick = () => {
    setState("settingsPane", {
      type:
        state.settingsPane.type === "global-settings" ? "" : "global-settings",
      data: {},
    });
  };

  const workspaceSettingsClick = () => {
    setState("settingsPane", {
      type:
        state.settingsPane.type === "workspace-settings"
          ? ""
          : "workspace-settings",
      data: {},
    });
  };

  const filterCommands = () => {
    const query = state.commandPalette.query;
    const queryRegex = new RegExp(query.split("").join(".*"), "i");

    // Define all workspace commands
    const allWorkspaceCommands = [
      { name: "New Window", description: "Open a new window", action: () => electrobun.rpc?.send.createWindow() },
      { name: "Hide Workspace", description: "Hide the current workspace", action: () => electrobun.rpc?.send.hideWorkspace() },
      { name: "Workspace Settings", description: "Configure workspace settings", action: workspaceSettingsClick },
      { name: "Colab Settings", description: "Configure global Colab settings", action: globalSettingsClick },
      { name: "New Workspace", description: "Create a new workspace", action: () => electrobun.rpc?.send.createWorkspace() },
      {
        name: "Format Document",
        description: "Format the current code editor",
        action: () => {
          const activeTab = getCurrentTab();
          if (!activeTab || activeTab.type !== 'file') return;

          electrobun.rpc?.send("formatFile", { path: activeTab.path });
        }
      },
    ];

    // Define all colab menu commands
    const allColabCommands = [
      { name: "Submit an issue", description: "Report a Bug / Request a Feature", action: () => openWebTab("https://github.com/blackboardsh/colab") },
      { name: "Changelog", description: "View Colab changelog", action: () => openWebTab("https://github.com/blackboardsh/colab/tags") },
      { name: "Blackboard Blog", description: "Updates from the Blackboard Labs", action: () => openWebTab("https://blackboard.sh/blog/") },
      { name: "Join co(lab) Discord", description: "Join our Discord community", action: () => openWebTab("https://discord.gg/ueKE4tjaCE") },
      { name: "Yoav", description: "Things Yoav says", action: () => openWebTab("https://bsky.app/profile/yoav.codes") },
    ];

    // Filter workspace commands
    const filteredWorkspace = allWorkspaceCommands.filter((cmd) => {
      const combined = `${cmd.name} ${cmd.description}`;
      return combined.match(queryRegex);
    });

    // Filter colab commands
    const filteredColab = allColabCommands.filter((cmd) => {
      const combined = `${cmd.name} ${cmd.description}`;
      return combined.match(queryRegex);
    });

    setWorkspaceCommands(filteredWorkspace);
    setColabCommands(filteredColab);
  };

  // resetOpenTabs();

  createEffect(() => {
    const matches: any[] = [];
    const query = state.commandPalette.query;
    const results = state.commandPalette.results;

    if (query) {
      // Collect matches per project with scoring, limit to top 5 per project
      Object.entries(results).forEach(([key, value]) => {
        const project = state.projects[key];
        const projectMatches: any[] = [];

        value.forEach((path) => {
          const name = basename(path);

          // Get path from project folder (including project folder name)
          const projectFolderName = basename(project.path);
          const pathFromProject = path.replace(dirname(project.path) + "/", "");

          // Simple scoring: prefer shorter paths and exact substring matches
          const lowerQuery = query.toLowerCase();
          let score = 0;

          // Exact filename match gets highest score
          if (name.toLowerCase() === lowerQuery) score += 1000;
          // Filename starts with query
          else if (name.toLowerCase().startsWith(lowerQuery)) score += 500;
          // Filename contains query
          else if (name.toLowerCase().includes(lowerQuery)) score += 250;

          // Shorter paths rank higher
          score -= path.length / 100;

          projectMatches.push({
            name,
            description: pathFromProject,
            path,
            score,
          });
        });

        // Sort by score and take top 5 from this project
        projectMatches.sort((a, b) => b.score - a.score);
        matches.push(...projectMatches.slice(0, 5));
      });

      // Sort all matches by score for final display
      matches.sort((a, b) => b.score - a.score);
    }

    setFileMatches(matches);

    // Update filtered commands when query changes
    resetOpenTabs();
    filterCommands();

    // Reset selected index when items change
    setSelectedIndex(0);
  });

  let input: HTMLInputElement;

  createEffect(() => {
    if (open()) {
      // trigger webview rapid sync so show animation plays smoothly
      document
        .querySelectorAll("electrobun-webview")
        .forEach((el) => el?.syncDimensions());
      input?.focus();
    }
  });

  return (
    <div
      style={`
      position: absolute;
      height: 40px;          
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: none;
    `}
    >
      <button
        onClick={() => setOpen(!open())}
        style={`
        pointer-events: auto;
        width: 300px;
        border-radius: 7px;
        border: none;
        background: #444;
        padding: 4px;
        text-align: center;
        font-family: Helvetica;
        font-size: 14px;
        color: #999;
        cursor: pointer;
      `}
      >
        {state.workspace?.name || 'Search'}
      </button>
      <style>
        {`@keyframes fadeIn {
        to {
          opacity: 1;
          transform: translateY(0);           
        }
      }`}
      </style>
      {open() && (
        <div
          class="webview-overlay"
          style={`
          position: absolute;
          top: 8px;
          background: #222;
          z-index: 999999;
          width: 500px;
          min-height: 200px;
          padding: 10px;
          border-radius: 8px;
          border: 1px solid #444;
          display: flex;
          flex-direction: column;
          pointer-events: auto;
          box-shadow: 0 9px 10px 2px #170808;
          opacity: 0;
          transform: translateY(-10px);
          animation: fadeIn 0.4s forwards;          
        `}
        >
          <input
            ref={(r) => (input = r)}
            style={`
              background: #393939;
              border: 1px solid #444;
              border-radius: 4px;
              padding: 4px;
              color: #ddd;
              margin-bottom: 6px;
            `}
            autofocus={true}
            onBlur={() => toggleOpen(false)}
            type="text"
            placeholder="Search"
            onInput={onCommandPaletteInput}
            onKeyDown={handleKeyDown}
          />
          <div
            style={`max-height: 80vh;
          overflow-y: scroll;`}
          >
            <For each={getAllItems()}>
              {(item, index) => {
                const isFirstInSection = () => {
                  if (index() === 0) return true;
                  const prevItem = getAllItems()[index() - 1];
                  return item.type !== prevItem?.type;
                };

                const sectionTitle = () => {
                  if (item.type === 'tab') return 'Tabs';
                  if (item.type === 'workspace') return 'Workspace';
                  if (item.type === 'colab') return 'Colab';
                  if (item.type === 'file') return 'Files';
                  return '';
                };

                return (
                  <>
                    {isFirstInSection() && (
                      <h3
                        style={`
                      color: #888;
                      padding: 5px;
                      font-size: 12px;
                      border-bottom: 1px solid #333;
                      margin: 0 3px;
                      margin-top: ${index() > 0 ? '10px' : '0'};`}
                      >
                        {sectionTitle()}
                      </h3>
                    )}
                    <CommandPaletteItem
                      icon={
                        item.type === 'tab' ? '✨' :
                        item.type === 'workspace' ? '⚙️' :
                        item.type === 'colab' ? '🔧' :
                        '✨'
                      }
                      name={item.name}
                      description={item.description}
                      isSelected={() => index() === selectedIndex()}
                      onSelect={() => {
                        if (item.type === 'tab') {
                          focusTabWithId(item.tabId);
                        } else if (item.type === 'workspace' || item.type === 'colab') {
                          item.action();
                        } else if (item.type === 'file') {
                          openFileAt(item.path, 0, 0);
                        }
                        toggleOpen(false);
                      }}
                    />
                  </>
                );
              }}
            </For>
          </div>
        </div>
      )}
    </div>
  );
};

const CommandPaletteItem = ({ icon, name, description, onSelect, isSelected }: {
  icon: string;
  name: string;
  description: string;
  onSelect: () => void;
  isSelected?: () => boolean;
}) => {
  const [hover, setHover] = createSignal(false);
  let itemRef: HTMLDivElement;

  createEffect(() => {
    if (isSelected?.() && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  return (
    <div
      ref={(el) => (itemRef = el)}
      style={`
    display: flex;
    color: #666;
    padding: 0 5px;
    background: ${isSelected?.() ? "#4a6fa5" : hover() ? "#3f5b7c" : "#222"};
    color: ${hover() || isSelected?.() ? "#ddd" : "#fff"};
    padding: 5px;
    border-radius: 5px;
    align-items: center;
    cursor: pointer;
    text-wrap-mode: nowrap;
    border: ${isSelected?.() ? "2px solid #6a9fd8" : "2px solid transparent"};
    `}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={onSelect}
    >
      <div>{icon}</div>
      <div>{name}</div>
      <div style={`font-size: 12px; opacity: .6; margin-left:8px;`}>
        {description}
      </div>
    </div>
  );
};

const WorkspaceMenu = ({ children }: { children: JSX.Element }) => {
  return (
    <Show when={state.workspace.id}>
      <div style="-webkit-user-select: none; font-size: 13px; color: #ddd;margin: 8px 0px; padding: 5px; ">
        <span
          style={`border-radius: 4px;padding: 5px 17px;   font-size: 13px; cursor: pointer;`}
          class="workspace-menu-button"
          onClick={() => {
            if (!state.ui.showWorkspaceMenu) {
              setState("isResizingPane", true);
              setTimeout(() => {
                setState(
                  "ui",
                  "showWorkspaceMenu",
                  !state.ui.showWorkspaceMenu
                );
              }, 100);
            } else {
              setState("ui", "showWorkspaceMenu", !state.ui.showWorkspaceMenu);
              setState("isResizingPane", false);
            }
          }}
        >
          {state.workspace?.name || "Workspace"}
        </span>
        <div style="position:relative;">
          <Show when={state.ui.showWorkspaceMenu}>
            <div
              class="workspace-menu webview-overlay"
              style="border-radius: 4px; position: absolute; top: 8px; right: 0px;min-width:200px; text-align: right; border: 2px solid black; padding:2px; z-index: 2; background: #000"
              onClick={() => setState("ui", "showWorkspaceMenu", false)}
            >
              <ul style="list-style: none;">{children}</ul>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

const Update = () => {
  const isReady = () => Boolean(state.update.downloadedFile);
  const updateInfo = () => state.update.info;
  const hasError = () =>
    state.update.status === "error" || Boolean(state.update.error);
  const updateAvailable = () =>
    Boolean(updateInfo()?.updateAvailable) || isReady() || hasError();
  const updateErrorMessage = () =>
    state.update.error?.message || "Update failed. Please download manually.";

  const buttonLabel = () => {
    const version = updateInfo()?.version || "";

    if (hasError()) {
      return "Update Failed";
    }

    if (isReady()) {
      return `Update Installed: Click to Restart ${version} - ${updateInfo().hash}`;
    }

    return `Installing Update ${version} - ${updateInfo().hash}`;
  };

  const buttonTitle = () => {
    if (hasError()) {
      return updateErrorMessage();
    } else if (isReady()) {
      return "Will automatically update at next restart";
    }

    if (state.update.status === "update-not-downloaded") {
      return "Download failed, retrying shortly";
    }

    return "Fetching update…";
  };

  const onClick = () => {
    if (!isReady()) {
      return;
    }

    electrobun.rpc?.send.installUpdateNow();
  };

  return (
    <Show when={updateAvailable()}>
      <div
        class={`update-button${hasError() ? " error" : ""}`}
        onClick={onClick}
        title={buttonTitle()}
        style={`font-size: 13px;margin: 8px 0px; padding: 5px; cursor: ${
          isReady() ? "pointer" : "default"
        };`}
      >
        <span
          style={`-webkit-user-select: none;border-radius: 4px;  padding: 5px 17px; font-size: 13px; box-sizing: border-box; color: ${
            hasError() ? "#fff" : "#222"
          }; opacity: ${
            hasError() || isReady() ? 1 : 0.7
          };`}
        >
          {buttonLabel()}
        </span>
      </div>
    </Show>
  );
};


// YYY - DidNAvigateEvent types
// import { DidNavigateEvent, DidNavigateInPageEvent } from "electron";
type DidNavigateEvent = any;
type DidNavigateInPageEvent = any;
import {
  type AppState,
  type WebTabType,
  focusTabWithId,
  updateSyncedState,
  openNewTabForNode,
  getCurrentPane,
  getPaneWithId,
  setNodeExpanded,
} from "../store";
import type {
  CachedFileType,
  PreviewFileTreeType,
} from "../../../shared/types/types";
import { state, setState } from "../store";
import { produce } from "solid-js/store";
import { getWindow } from "../store";

import { getSlateForNode } from "../files";

import { type DomEventWithTarget } from "../../../shared/types/types";
import { Show, createEffect, createSignal, createMemo } from "solid-js";
import { electrobun } from "../init";

import { join } from "../../utils/pathUtils";
import { getNode } from "../FileWatcher";
import { createBrowserProfileFolderName } from "../../utils/browserProfileUtils";

// Not needed anymore - using regex pattern instead
// const hasValidProtocol = (url: string) => {
//   return (
//     url.startsWith("http://") ||
//     url.startsWith("https://") ||
//     url.startsWith("file://")
//   );
// };

// todo: implement cmd + click to open in new tab. needs more thought
const colabPreloadScript = `

`;

// WebSlates typically have a 'home' path, saved to the node's web slate
// and a 'current url' saved to the tab's url. This lets you open multiple tabs to
// say google or webflow, and have each one navigate around independently and remember
// their current url
export const WebSlate = ({
  node,
  tabId,
}: {
  node?: CachedFileType;
  tabId: string;
}) => {
  console.log("WebSlate component created:", { tabId, nodePath: node?.path });
  if (!node) {
    console.error("WebSlate: No node provided for tabId:", tabId);
    return null;
  }
  const getNodeUrl = () => {
    const slate = getSlateForNode(node);
    // Ensure we return a valid URL or undefined (not an empty string or invalid value)
    return slate?.type === "web" ? slate.url : undefined;
  };
  const tab = () => getWindow()?.tabs[tabId];

  const tabUrl = () => {
    const currentTab = tab();
    return currentTab?.type === "web" && currentTab.url ? currentTab.url : undefined;
  };

  // Get the renderer setting from the slate config
  const renderer = () => {
    const slate = getSlateForNode(node);
    if (slate?.type === "web" && slate.config && "renderer" in slate.config) {
      return slate.config.renderer || "cef";
    }
    // Default to CEF for better compatibility
    return "cef";
  };

  // just get this once, so we have unidirectinoal flow on navigate -> update store
  // Note: initialUrl must be a valid url, otherwise webview will not initialize properly
  // and will throw. eg: when editing the url in the url bar there won't be a webcontents initialized
  const initialUrl = tabUrl() || getNodeUrl() || "https://www.google.com";

  console.log("WebSlate init:", {
    tabId,
    nodePath: node?.path,
    tabUrl: tabUrl(),
    nodeUrl: getNodeUrl(),
    initialUrl,
    renderer: renderer(),
  });

  // use a different partition for each workspace and renderer type
  // CEF and WebKit need separate partitions to avoid conflicts
  // todo (yoav): make this a util
  const partition = `persist:sites:${state.workspace.id}:${renderer()}`;
  // YYY - any was Electron.WebviewTag
  let webviewRef: any | undefined;

  const onClickBack = () => {
    webviewRef?.goBack();
  };

  const onClickForward = () => {
    webviewRef?.goForward();
  };

  const onClickReload = () => {
    webviewRef?.reload();
  };

  const onClickHome = () => {
    webviewRef.src = initialUrl;
  };

  const onCreatePreloadScript = async () => {
    if (!isRealNode() || !node) {
      // For internal nodes or when node is undefined, just open devtools
      webviewRef?.openDevTools();
      return;
    }

    const fileName = ".preload.js";
    const defaultContent = `// Preload script for this web browser profile
// This script runs before the page loads and can modify the page behavior

// Example: Hide all ads
// document.addEventListener('DOMContentLoaded', () => {
//   const ads = document.querySelectorAll('[class*="ad"], [id*="ad"]');
//   ads.forEach(ad => ad.style.display = 'none');
// });

// Example: Auto-fill a form
// document.addEventListener('DOMContentLoaded', () => {
//   const usernameField = document.querySelector('input[name="username"]');
//   if (usernameField) {
//     usernameField.value = 'your-username';
//   }
// });

console.log('Preload script loaded for:', window.location.href);
`;
    
    const filePath = join(node.path, fileName);
    
    try {
      // Check if file already exists
      const exists = await electrobun.rpc?.request.exists({ path: filePath });
      
      let wasCreated = false;
      if (!exists) {
        // Create the file if it doesn't exist
        await electrobun.rpc?.request.touchFile({
          path: filePath,
          contents: defaultContent,
        });
        wasCreated = true;
      }
      
      if (wasCreated) {
        // Wait a bit for the file system events to be processed and the file to be detected
        setTimeout(() => {
          // Expand the web node folder
          setNodeExpanded(node.path, true);
        }, 500);
      } else {
        // File already exists, expand immediately
        setNodeExpanded(node.path, true);
      }
      
      // Open the file in the current pane for editing
      openNewTabForNode(filePath, false, { focusNewTab: true });
    } catch (error) {
      console.error(`Error creating ${fileName}:`, error);
      alert(`Failed to create ${fileName}. Please try again.`);
    }
  };

  const onUrlInputKeyDown = (
    e: DomEventWithTarget<KeyboardEvent, HTMLInputElement>
  ) => {
    if (e.key === "Enter") {
      let newUrl = e.currentTarget.value;
      // Add https:// if no protocol is present
      const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(newUrl);
      if (!hasProtocol) {
        newUrl = `https://${newUrl}`;
      }
      webviewRef.src = newUrl;
      
      // Update the URL and title in the tab immediately
      setState(
        produce((_state: AppState) => {
          const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
          _tab.url = newUrl;
          // Extract hostname as initial title
          try {
            const url = new URL(newUrl);
            _tab.title = url.hostname;
          } catch (err) {
            _tab.title = newUrl;
          }
        })
      );
      updateSyncedState();
    }
  };

  const [isReady, setIsReady] = createSignal(false);
  const [webviewUrl, setWebviewUrl] = createSignal(tabUrl());

  const [isBackDisabled, setIsBackDisabled] = createSignal(true);
  const [isForwardDisabled, setIsForwardDisabled] = createSignal(true);

  createEffect(async () => {
    // Note: wait for it to be ready, and wire reactivity to tabUrl
    // which is updated on did-navigate
    const currentTabUrl = tabUrl();
    console.log("WebSlate effect:", { tabId, isReady: isReady(), currentTabUrl });

    if (isReady() && currentTabUrl) {
      // give it a second for cross language rpc to resolve before checking

      // Note: currently in-page-navigations don't trigger canGoBack/Forward
      // TODO: electrobun should likely account for this
      setIsBackDisabled(!(await webviewRef?.canGoBack()));
      setIsForwardDisabled(!(await webviewRef?.canGoForward()));
      setWebviewUrl(currentTabUrl);
      console.log("Set webviewUrl to:", currentTabUrl);
    } else {
      setIsBackDisabled(false);
      setIsForwardDisabled(false);
    }
  });

  // createEffect(() => {
  //   // Note: Sometimes a tab becomes the current tab in its pane even when that pane is not the active pane
  //   // if (currentPane.tabIds.includes(tabId)) {
  //   // make webview tabs a little more responsive when showing/hiding while switching tabs
  //   console.log('toggle hidden id:', webviewRef, webviewRef?.webviewId)
    
  //   // if (!webviewRef?.webviewId) {
  //   //   return;
  //   // }
  //   if (isTabActive()) {    
  //     console.log('solidjs: setting hidden (false): ', webviewRef?.webviewId) 
  //     // if (webviewRef?.webviewId) {       
  //     webviewRef?.toggleHidden(false);
  //     // webviewRef?.toggleTransparent(false);
  //     // webviewRef?.togglePassthrough(false);
  //     webviewRef?.syncDimensions(true);
  //     // }
  //   } else {
  //     // if (webviewRef?.webviewId) {
  //     console.log('solidjs: setting hidden (true): ', webviewRef?.webviewId)        
  //     webviewRef?.toggleHidden(true);
  //     // webviewRef?.toggleTransparent(true);
  //     // webviewRef?.togglePassthrough(true);
  //     requestAnimationFrame(() => {
  //     webviewRef?.syncDimensions(true);
  //     })
  //     // }
  //   }
  // });

  const isTabActive = () => {
    const _tab = tab();
    if (!_tab) {
      return false;
    }

    const paneForTab = getPaneWithId(state, _tab?.paneId);
    if (!paneForTab) {
      return false;
    }

    if (paneForTab.type !== "pane" || paneForTab?.currentTabId !== _tab.id) {
      return false;
    }

    return true;
  };

  createEffect(() => {
    if (!isTabActive()) {
      return;
    }

    // Create a single boolean for toggling the menu
    state.ui.showWorkspaceMenu || state.ui.showAppMenu;

    // Perform the syncDimensions call once
    webviewRef?.syncDimensions(true);
  });

  createEffect(() => {
    if (!isTabActive()) {
      return;
    }

    if (state.dragState?.targetPaneId === tab()?.paneId) {
      if (!webviewRef?.transparent) {
        webviewRef?.toggleTransparent(true);
        // webviewRef?.syncScreenshot();
        webviewRef?.syncDimensions(true);
      }
    } else {
      requestAnimationFrame(() => {
        if (webviewRef?.transparent) {
          webviewRef?.toggleTransparent(false);
          // webviewRef?.clearScreenImage();
          webviewRef?.syncDimensions(true);
        }
      });
    }
  });

  createEffect(() => {
    if (!isTabActive()) {
      return;
    }

    // Create a single boolean for toggling the menu
    if (state.isResizingPane) {
      // Perform the syncDimensions call and force it to trigger the
      // accelerated syncDimensions loop so dragging is immediately responsive
      // when the mouse starts moving
      webviewRef?.syncDimensions(true);
    }
  });

  const onClickAddBrowserProfile = async () => {
    if (!isRealNode() || !node) {
      // Can't create browser profiles for internal nodes or when node is undefined
      console.log("Cannot create browser profile: isRealNode=", isRealNode(), "node=", node);
      return;
    }

    const currentUrl = tabUrl();
    if (!currentUrl) {
      return;
    }

    try {
      // Get title from tab state
      const pageTitle = _tab?.type === "web" ? _tab.title : null;
      
      // Use the shared utility to create a proper browser profile folder name
      const nodeName = await createBrowserProfileFolderName(
        pageTitle,
        currentUrl,
        node.path,
        electrobun.rpc!.request.makeFileNameSafe,
        electrobun.rpc!.request.getUniqueNewName
      );
      const browserProfilePath = join(node.path, nodeName);
      
      // Create the browser profile directory
      const mkdirResult = await electrobun.rpc?.request.mkdir({ path: browserProfilePath });
      if (!mkdirResult?.success) {
        console.error("Failed to create browser profile directory:", mkdirResult?.error);
        alert("Failed to create browser profile folder. Please try again.");
        return;
      }
      
      // Write the .colab.json slate config file
      const slateConfig = {
        v: 1,
        name: pageTitle || new URL(currentUrl).hostname,
        icon: "views://assets/file-icons/bookmark.svg",
        type: "web",
        url: currentUrl,
        config: {
          renderer: "cef" as const, // Default to CEF for new browser profiles
        },
      };
      
      const slateConfigPath = join(browserProfilePath, ".colab.json");
      const writeResult = await electrobun.rpc?.request.writeFile({
        path: slateConfigPath,
        value: JSON.stringify(slateConfig, null, 2),
      });
      
      if (!writeResult?.success) {
        console.error("Failed to write slate config:", writeResult?.error);
        // Try to clean up the created directory
        await electrobun.rpc?.request.safeDeleteFileOrFolder({ absolutePath: browserProfilePath });
        alert("Failed to create browser profile configuration. Please try again.");
        return;
      }

      // Expand the parent node so the new browser profile is visible
      setNodeExpanded(node.path, true);
      
      // Open the new browser profile in a new tab
      openNewTabForNode(browserProfilePath, false, { 
        url: currentUrl, 
        focusNewTab: true 
      });

      // Fetch and update the favicon asynchronously
      electrobun.rpc?.request
        .getFaviconForUrl({ url: currentUrl })
        .then(async (favicon) => {
          if (favicon && favicon !== slateConfig.icon) {
            // Update the slate config with the favicon
            const updatedSlateConfig = { ...slateConfig, icon: favicon };
            await electrobun.rpc?.request.writeFile({
              path: slateConfigPath,
              value: JSON.stringify(updatedSlateConfig, null, 2),
            });
          }
        })
        .catch(error => {
          console.error("Failed to fetch favicon:", error);
          // Non-critical error, browser profile is already created
        });
        
    } catch (error) {
      console.error("Error creating browser profile:", error);
      console.error("Debug info:", {
        isRealNode: isRealNode(),
        nodePath: node?.path,
        currentUrl,
        pageTitle: _tab?.type === "web" ? _tab.title : null,
        tabType: _tab?.type,
      });
      alert("Failed to create browser profile. Please try again.");
    }
  };

  // todo (yoav): https://www.electronjs.org/docs/latest/api/webview-tag
  // reload
  // reloadIgnoringCache
  // open devtools
  // context menues
  // find in page
  // capturePage
  // showDefinitionForSelection

  const isRealNode = createMemo(() => node && !node.path.startsWith("__COLAB_INTERNAL__") && !node.path.startsWith("__COLAB_TEMPLATE__"));
  const preloadFilePath = createMemo(() => isRealNode() && node ? join(node.path, ".preload.js") : "");

  const [preloadContent, setPreloadContent] = createSignal("");
  const [preloadLoaded, setPreloadLoaded] = createSignal(false);

  // Load preload content - runs whenever preloadFilePath changes or file cache updates
  createEffect(() => {
    if (!preloadFilePath()) {
      setPreloadContent("");
      setPreloadLoaded(true); // No preload file, so we're "loaded"
      return;
    }

    setPreloadLoaded(false); // Start loading

    const loadPreloadContent = async () => {
      // Always try to read the file directly first - this ensures we get the latest content
      try {
        const { textContent } = await electrobun.rpc?.request.readFile({ path: preloadFilePath() }) || {};

        if (textContent) {
          setPreloadContent(textContent);
          setPreloadLoaded(true);
          return;
        }
      } catch (err) {
        // File doesn't exist or can't be read, ignore error
      }

      // Fallback: check if we have cached content
      const cachedNode = getNode(preloadFilePath());

      if (cachedNode && cachedNode.type === "file" && cachedNode.persistedContent) {
        setPreloadContent(cachedNode.persistedContent);
      } else {
        setPreloadContent("");
      }

      setPreloadLoaded(true);
    };

    loadPreloadContent();
  });
  
  // Also watch for changes in the file cache for this specific preload file
  createEffect(() => {
    if (!preloadFilePath()) return;

    const cachedNode = getNode(preloadFilePath());

    if (cachedNode && cachedNode.type === "file" && cachedNode.persistedContent) {
      setPreloadContent(cachedNode.persistedContent);
    }
  });

  const preloadScript = () => {
    return colabPreloadScript + ";\n " + preloadContent();
  };

  return (
    <div style="display: flex; flex-direction: column; height: 100%">
      <div style="display: flex; box-sizing: border-box; gap: 5px; padding: 10px; min-height: 40px;height: 40px; width: 100%;overflow-x:hidden;">
        <button
          class="browser-btn"
          disabled={isBackDisabled()}
          type="button"
          onClick={onClickBack}
        >
          <img
            width="16"
            height="16"
            src={`views://assets/file-icons/browser-back.svg`}
          />
        </button>
        <button
          disabled={isForwardDisabled()}
          type="button"
          onClick={onClickForward}
          class="browser-btn"
        >
          <img
            width="16"
            height="16"
            src={`views://assets/file-icons/browser-forward.svg`}
          />
        </button>
        <button class="browser-btn" type="button" onClick={onClickReload}>
          <img
            width="12"
            height="12"
            src={`views://assets/file-icons/browser-reload.svg`}
          />
        </button>

        <button class="browser-btn" type="button" onClick={onClickHome}>
          <img
            width="12"
            height="12"
            src={`views://assets/file-icons/browser-home.svg`}
          />
        </button>

        <input
          style="flex-grow: 1;
        background: #444;
        border: inset 1px #555;
        color: #ddd;
        font-size: 13px;
        font-weight: bold;
        padding: 5px;
        outline: none;"
          type="text"
          value={webviewUrl()}
          onKeyDown={onUrlInputKeyDown}
        />
        <button class="browser-btn" type="button" onClick={onClickAddBrowserProfile}>
          <img
            width="12"
            height="12"
            src={`views://assets/file-icons/browser-add-profile.svg`}
          />
        </button>
        <button class="browser-btn" type="button" onClick={onCreatePreloadScript}>
          <img
            width="12"
            height="12"
            src={`views://assets/file-icons/browser-devtools.svg`}
          />
        </button>
      </div>

      <Show 
        when={preloadLoaded()} 
        fallback={
          <div style={{
            width: "calc(100% - 4px)",
            height: "calc(100% - 4px)",
            background: "#1e1e1e",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#888"
          }}>
            Loading...
          </div>
        }
      >
        {/* @ts-ignore */}
        <electrobun-webview
          data-type="webslate"
          renderer={renderer()}
          style={{
            width: `calc(100% - 4px)`,
            height: "calc(100% - 4px)",
            // margin: 10,
            background: "#1e1e1e",
            // "flex-grow": 1,
            "min-height": "0px",
            "background-size": "fit",
            // opacity: isResizingPane() ? 1 : 1,
            // "margin-right": isResizingPane() ? "20px" : "0px",
          }}
          partition={partition}
          src={initialUrl}
          preload={preloadScript()}
        ref={(el: any) => {
          console.log('setting webviewRef', el, el.webviewId)
          // console.log("electrobun-webview ref", el);
          // YYY - el was type Electron.WebviewTag
          webviewRef = el; // as Electron.WebviewTag;
          
          // Log what methods and properties are available
          console.log("webviewRef created with ID:", webviewRef?.webviewId);
          console.log("webviewRef object:", webviewRef);
          
          if (!webviewRef) {
            console.error("webviewRef is null!");
            return;
          }

          webviewRef.addMaskSelector(".webview-overlay");

          webviewRef.on("dom-ready", () => {
            console.log("dom-ready event fired for webview:", webviewRef.webviewId);
            setIsReady(true);
            // Update title when DOM is ready
            const pageTitle = webviewRef?.getTitle?.();
            console.log("getTitle result:", pageTitle);
            if (pageTitle) {
              setState(
                produce((_state: AppState) => {
                  const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
                  _tab.title = pageTitle;
                })
              );
            }
          });

          // Listen for page title updates
          webviewRef.on("page-title-updated", (e: any) => {
            console.log("page-title-updated event:", e.detail);
            setState(
              produce((_state: AppState) => {
                const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
                _tab.title = e.detail;
              })
            );
          });

          // Also listen for when loading stops to get the title
          webviewRef.on("did-stop-loading", async () => {
            // Try getting title directly
            const pageTitle = webviewRef?.getTitle?.();
            console.log("did-stop-loading, title from getTitle:", pageTitle);
            
            // Also try executing JavaScript to get the title
            try {
              const titleFromJS = await webviewRef?.executeJavaScript?.("document.title");
              console.log("did-stop-loading, title from JS:", titleFromJS);
              
              const finalTitle = pageTitle || titleFromJS;
              if (finalTitle) {
                setState(
                  produce((_state: AppState) => {
                    const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
                    _tab.title = finalTitle;
                  })
                );
              }
              
              // Also fetch favicon when page finishes loading
              const currentUrl = tabUrl();
              if (currentUrl) {
                electrobun.rpc?.request
                  .getFaviconForUrl({ url: currentUrl })
                  .then((favicon) => {
                    if (favicon && isRealNode() && node) {
                      const slateConfigPath = join(node.path, ".colab.json");
                      electrobun.rpc?.request.readFile({ path: slateConfigPath })
                        .then((content) => {
                          if (content) {
                            try {
                              const slateConfig = JSON.parse(content);
                              if (slateConfig.icon !== favicon) {
                                slateConfig.icon = favicon;
                                electrobun.rpc?.request.writeFile({
                                  path: slateConfigPath,
                                  value: JSON.stringify(slateConfig, null, 2),
                                });
                              }
                            } catch (error) {
                              console.error("Error updating slate config favicon on load:", error);
                            }
                          }
                        })
                        .catch((error) => {
                          console.error("Error reading slate config for favicon update on load:", error);
                        });
                    }
                  })
                  .catch((error) => {
                    console.error("Error fetching favicon on page load:", error);
                  });
              }
            } catch (e) {
              console.log("Error getting title from JS:", e);
            }
          });

          // YYYY - DidNavigateEvent
          // @ts-ignore
          webviewRef.on("did-navigate", async (e: DidNavigateEvent) => {
            console.log("did-navigate event:", e.detail, typeof e.detail);

            // Validate that e.detail is a valid string URL before using it
            if (!e.detail || typeof e.detail !== 'string' || e.detail.length < 1) {
              console.warn("Invalid did-navigate event detail, ignoring:", e.detail);
              return;
            }

            // Additional validation - try to construct URL to ensure it's valid
            let validUrl: string;
            try {
              validUrl = new URL(e.detail).href;
            } catch (err) {
              console.warn("Invalid URL in did-navigate event, ignoring:", e.detail);
              return;
            }

            // Update URL immediately with validated URL
            setState(
              produce((_state: AppState) => {
                const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
                _tab.url = validUrl;
                // For now, extract hostname as title until we can get the real title
                try {
                  const url = new URL(validUrl);
                  _tab.title = url.hostname;
                } catch (err) {
                  _tab.title = validUrl;
                }
              })
            );

            // Fetch favicon for the new URL
            electrobun.rpc?.request
              .getFaviconForUrl({ url: validUrl })
              .then((favicon) => {
                if (favicon) {
                  // Update the tab's icon in the slate config if this is a real browser profile node
                  if (isRealNode() && node) {
                    const slateConfigPath = join(node.path, ".colab.json");
                    electrobun.rpc?.request.readFile({ path: slateConfigPath })
                      .then((content) => {
                        if (content) {
                          try {
                            const slateConfig = JSON.parse(content);
                            slateConfig.icon = favicon;
                            electrobun.rpc?.request.writeFile({
                              path: slateConfigPath,
                              value: JSON.stringify(slateConfig, null, 2),
                            });
                          } catch (error) {
                            console.error("Error updating slate config favicon:", error);
                          }
                        }
                      })
                      .catch((error) => {
                        console.error("Error reading slate config for favicon update:", error);
                      });
                  }
                }
              })
              .catch((error) => {
                console.error("Error fetching favicon on navigation:", error);
              });

            updateSyncedState();
          });
          webviewRef.on("did-navigate-in-page", (e: DidNavigateInPageEvent) => {
            if (!e.isMainFrame) {
              return;
            }

            setState(
              produce((_state: AppState) => {
                const _tab = getWindow(_state)?.tabs[tabId] as WebTabType;
                _tab.url = e.detail;
                // Get the title after in-page navigation
                const pageTitle = webviewRef?.getTitle();
                if (pageTitle) {
                  _tab.title = pageTitle;
                }
              })
            );

            updateSyncedState();
          });

          webviewRef.on("new-window-open", (e: any) => {
            console.log('new window open fired in webview')
            try {
              // const data = JSON.parse(e.detail)
              const targetUrl = e.detail.url;
              openNewTabForNode(node.path, false, {
                url: targetUrl,
                focusNewTab: false,
                targetPaneId: tab()?.paneId,
              });
            } catch (e) {
              console.log(e)
            }
          });

          // XXX - webview focus
          // webviewRef.addEventListener("focus", () => {
          //   focusTabWithId(tabId);
          // });
        }}
      ></electrobun-webview>
      </Show>
    </div>
  );
};

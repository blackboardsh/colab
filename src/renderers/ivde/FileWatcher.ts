// XXX: move these to fe files.ts
import * as monaco from "monaco-editor";
import { state, setState, type AppState } from "./store";
import type { CachedFileType } from "../../shared/types/types";
import { produce } from "solid-js/store";

import { electrobun } from "./init";

// TODO:
// 1. in the rendering flow, we should check if we have the file in the cache and subscribe to changes
// 2. when a file is not in the cache, it should fire an async request to get it's metadata including if it's a file or folder, if it exists
// and store whatever result in the cache
// 3. then the front-end should just check the cache for a file and render it without all these syncRPC checks.

// Think of the filesystem as a datastore. We want to keep a cache
// of files we interact with, but don't really care about anything else
// We use fileWatchers to update the cache if we've already cached something

// rename _getNode to getNodeFromCache that accounts for __internal nodes
// move the bun stuff to an async bun request that gets called in getNode() after that calls getNodeFromCache()
// other things can just be subscribed to the cache or the _getNode call
// maybe that'll just work?
const pendingNodeRequests: { [path: string]: boolean } = {};

// doesn't cache the node, useful inside setState(produce(_state => {const _node = _getNode(path, _state)})) blocks

export const _getNode = (
  path?: string,
  _state: AppState = state
): CachedFileType | undefined => {
  if (!path) {
    return;
  }

  // These are for pseudo nodes that don't exist on the filesystem
  if (path.startsWith("__COLAB_INTERNAL__")) {
    return {
      name: path.split("/").pop() || "",
      type: "dir",
      path: path,
      children: [],
    };
  }

  // Template nodes for quick access (browser, file, terminal, agent)
  if (path.startsWith("__COLAB_TEMPLATE__")) {
    // Check if we already have this template cached
    if (_state.fileCache[path]) {
      return _state.fileCache[path];
    }

    const templateId = path.split("/").pop() || "";
    let templateNode: CachedFileType;

    // Browser and agent templates are directory nodes with slates
    if (templateId === "browser" || templateId === "agent") {
      templateNode = {
        name: templateId,
        type: "dir",
        path: path,
        children: [],
      };
    }
    // Terminal template (file node, but not actually opened as a file)
    else {
      templateNode = {
        name: templateId,
        type: "file",
        path: path,
        persistedContent: "",
        isDirty: false,
        model: null,
        editors: {},
      };
    }

    // Cache the template node so it returns the same reference
    setState("fileCache", path, templateNode);
    return templateNode;
  }

  if (_state.fileCache[path]) {
    return _state.fileCache[path];
  }

  if (pendingNodeRequests[path]) {
    return;
  }

  pendingNodeRequests[path] = true;
  // Note: because this is async there's a race condition with the early exit above
  // where multiple things can call getNode for the same path triggering multiple calls
  // todo: We need to update the architecture to have a pending state for state objects like this
  electrobun.rpc?.request.getNode({ path }).then((node) => {
    delete pendingNodeRequests[path];

    if (node) {
      // Only update the cache if we don't already have it
      // since this is getNode(). actual changes to the node
      // will be handled by fileWatchers/events
      if (!state.fileCache[path]) {
        setState("fileCache", path, node);
      }
    }
  });
};

// typically used in code, will cache the node if it's not already cached
export const getNode = (path?: string): CachedFileType | undefined => {
  const node = _getNode(path);

  if (!path || !node) {
    return;
  }

  return node;
};

// todo (yoav): rename to createOrFetchModel
export const createModel = async (absolutePath: string) => {
  // Handle template file paths - they don't exist on disk, so provide empty content
  let contents = "";
  if (absolutePath.startsWith("__COLAB_TEMPLATE__")) {
    contents = "";
  } else {
    const fileContents = await electrobun.rpc?.request.readFile({
      path: absolutePath,
    }); //?.slice(0, 1024 * 1024 * 2); //, "utf-8");
    contents = fileContents?.textContent || "";
  }

  const extension = absolutePath.split(".").pop() || "";
  const language = getExtensionLanguage(extension);
  // it knows about. In fact it does this when you open a typescript file, but also as you type in the editor
  // if you add a new type import. It's funny that id does this because you _also_ have to externally
  // addExtraLib or create a model for those files for type hinting to work.
  let model = monaco.editor.getModel(monaco.Uri.parse(absolutePath));
  if (!model) {
    model = monaco.editor.createModel(
      contents,
      language,
      monaco.Uri.parse(absolutePath)
    );

    // maybe multiple editors can share the same model that the user has actually opened?
    setState(
      produce((_state: AppState) => {
        const node = _state.fileCache[absolutePath];
        if (node.type === "file") {
          node.model = model;
          node.persistedContent = contents;
        }
      })
    );
  }

  return model;
};

const extensionsToLanguages: {} = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  html: "html",
  md: "plaintext",
  css: "css",
  json: "json",
};

const getExtensionLanguage = (extension: string) => {
  if (extension in extensionsToLanguages) {
    return extensionsToLanguages[
      extension as keyof typeof extensionsToLanguages
    ];
  } else {
    return "plaintext";
  }
};

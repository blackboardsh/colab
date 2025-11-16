// XXX
// import { spawn } from "child_process";
import { createEffect, untrack } from "solid-js";
import { type AppState, setState, state } from "./store";
import { join, relative } from "../utils/pathUtils";
import {
  type PreviewFileTreeType,
  type ProjectType,
  type SlateType,
  type CachedFileType,
  type FolderNodeType,
} from "../../shared/types/types";
import { electrobun } from "./init";

// const HOME_DIRECTORY = homedir();
// const COLAB_DIRECTORY = join(HOME_DIRECTORY, "colab");
// export const DEFAULT_CODE_DIRECTORY = join(HOME_DIRECTORY, "colab");

// todo (yoav): [blocking] move this to store
// export interface FileNodeType {
//   name: string;
//   path: string;
//   type: "file";
//   contents: string;
//   isDirty: boolean;
//   model: any;
// }

// export interface PreviewFolderNodeType<Extended> {
//   name: string;
//   path: string;
//   type: "dir";
//   children: Record<string, FileTreeType<Extended>>;
// }

// export type FileTreeType<Extended = {}> = CachedFileType | PreviewFolderNodeType<Extended> & Extended;

// XXX
// import "./files";
// this import was imported into index.tsx and just doing this
// this should happen on the server, maybe i fetch Projects and send

// // createEffect(() => {
//   const { projects } = state;
//   if (projects) {
//     createFoldersForProjects(projects);
//   }
// });
// export const createFoldersForProjects = (projectsById: AppState['projects']) => {
//   if (!state.paths?.COLAB_HOME_FOLDER) {
//     throw new Error('Must set COLAB_HOME_FOLDER in state.paths')
//   }
//   for (const projectId in projectsById) {
//     const project = projectsById[projectId];
//     // TODO: connect this to branch changes later
//     const projectPath = join(state.paths.COLAB_HOME_FOLDER, makeFileNameSafe(project.name));
//     if (!existsSync(projectPath)) {
//       mkdirSync(projectPath, { recursive: true });
//     }
//   }
// };

// todo (yoav): [blocking] move this to a store and make it reactive when state changes (wtf did I mean by this comment)
// todo (yoav): [blocking] rename this to writeColabSlateConfigFile since it's different to writing a package.json config file
export const writeSlateConfigFile = (
  absoluteFolderPath: string,
  slate: SlateType
) => {
  if (slate.type === "project" || slate.type === "web" || slate.type === "agent") {
    const configPath = join(absoluteFolderPath, ".colab.json");
    
    let contents;
    if (slate.type === "agent") {
      contents = JSON.stringify({
        v: 1,
        name: slate.name || "",
        type: slate.type || "",
        icon: slate.icon || "",
        config: slate.config || {},
      });
    } else {
      // web and project types
      contents = JSON.stringify({
        v: 1,
        name: slate.name || "",
        type: slate.type || "",
        url: slate.url || "",
        icon: slate.icon || "",
        config: slate.config || {},
      });
    }

    // save your file here
    const result = electrobun.rpc?.request.writeFile({
      path: configPath,
      value: contents,
    });

    // todo: handle failure
    // if (!result?.success) {
    //   // todo: handle failed write
    //   return;
    // }
  }
};

export const getProjectForNode = (
  node: PreviewFileTreeType,
  _state: AppState = state
) => {
  if (!node) {
    return null;
  }
  return getProjectForNodePath(node.path, _state);
};

export const getProjectForNodePath = (
  nodePath: string,
  _state: AppState = state
) => {
  const project = Object.values(_state.projects).find((project) => {
    return nodePath.startsWith(project.path);
  });

  return project;
};

export const getFileTreesChildPathToNode = (nodePath: string): string[] => {
  return untrack(() => {
    const project = getProjectForNodePath(nodePath);

    if (!project?.path) {
      // todo (yoav): [blocking] can remove after cleaning up the old bad data
      return [];
    }

    const location = ["fileTrees", project.id];

    const relativePath = relative(project.path, nodePath);
    const relativePathParts = relativePath.split("/").filter(Boolean);
    for (const part of relativePathParts) {
      location.push("children");
      location.push(part);
    }
    return location;
  });
};

// given something nodeShaped, return the copy from state
// todo (yoav): rename this function

const fileSlates = {
  ".git": {
    name: "Git",
    type: "git",
    icon: "", //"https://git-scm.com/images/logos/downloads/Git-Icon-1788C.png",
    // TODO: default git config here
    config: {},
  },
  "package.json": {
    name: "Npm (package.json)",
    type: "npm",
    icon: "",
    config: {},
  },
  ".webflowrc.json": {
    name: "DevLink (configure)",
    type: "devlink",
    icon: "",
    config: {},
  },
};

// Template slates - cached to maintain object reference for reactivity
const templateSlates = {
  browser: {
    v: 1,
    name: "Browser",
    type: "web" as const,
    url: "https://blackboard.sh",
    icon: "views://assets/file-icons/bookmark.svg",
    config: {},
  },
  agent: {
    v: 1,
    name: "AI Chat",
    type: "agent" as const,
    icon: "views://assets/file-icons/agent.svg",
    config: {},
  },
};

// todo: - how much of this should be async via the backend vs. completely stored, and cached
// on the backend.
export const getSlateForNode = (
  node?: CachedFileType | PreviewFileTreeType | null
) => {
  if (!node) {
    // throw new Error('Must give a node')
    return undefined;
  }

  // Note: In certain siutations, like creating a node we're looking
  // at a previewnode which just has the slate defined on it
  if ("slate" in node) {
    return node.slate;
  }

  if (node.path.startsWith("__COLAB_INTERNAL__")) {
    if (node.path === "__COLAB_INTERNAL__/web") {
      return {
        v: 1,
        name: "Web",
        type: "web",
        url: "https://colab.dev",
        icon: "",
        config: {},
      };
    }
    return;
  }

  // Handle template nodes
  if (node.path.startsWith("__COLAB_TEMPLATE__")) {
    if (node.path === "__COLAB_TEMPLATE__/browser") {
      return templateSlates.browser;
    }
    if (node.path === "__COLAB_TEMPLATE__/terminal") {
      // Terminal tabs are handled differently - they don't use slates
      return undefined;
    }
    if (node.path === "__COLAB_TEMPLATE__/agent") {
      return templateSlates.agent;
    }
    return;
  }

  const fileOrFolderName = node.path.split("/").pop();

  if (fileOrFolderName && fileOrFolderName in fileSlates) {
    const fileNameSlate =
      fileSlates[fileOrFolderName as keyof typeof fileSlates];

    if (fileNameSlate) {
      return fileNameSlate;
    }
  }

  if (node.type === "dir") {
    const colabConfigFile = (node as FolderNodeType).children?.includes(
      ".colab.json"
    );

    if (colabConfigFile) {
      const absoluteColabConfigPath = join(node.path, ".colab.json");
      const cachedConfig = state.slateCache[absoluteColabConfigPath];

      if (cachedConfig) {
        return cachedConfig;
      }

      return readSlateConfigFile(absoluteColabConfigPath);
    }

    // Note: currently .colab.json is the only nested slate type, but in the future
    // you could add more here
  }

  // return node.type;
};

// Note: this can be used to read and cache any slate config file .colab.json, package.json, etc.
// currently only supports json files
export const readSlateConfigFile = (path: string, cacheResult = true) => {
  electrobun.rpc?.request.readSlateConfigFile({ path }).then((slate) => {
    if (slate && cacheResult) {
      setState("slateCache", path, slate);
    }
    return slate;
  });

  return null;
};

export const isDescendantPath = (parentPath: string, childPath: string) => {
  const relativePath = relative(parentPath, childPath);
  return relativePath && !relativePath.startsWith("..");
};

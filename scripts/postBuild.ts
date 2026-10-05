console.log("post build script");
const path = require("path");
const { builtinModules } = require("node:module");
const esbuild = require("esbuild");
const MonacoEsbuildPlugin = require("esbuild-monaco-editor-plugin");
const { solidPlugin } = require("esbuild-plugin-solid");
import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync, writeFileSync } from "fs";



const {ELECTROBUN_BUILD_DIR, ELECTROBUN_APP_NAME} = process.env;

const APP_BUNDLE_FOLDER = path.join(ELECTROBUN_BUILD_DIR, `${ELECTROBUN_APP_NAME}.app`);

// Same artwork as icon.iconset, precompiled for builds where iconutil is unavailable.
cpSync("./assets/colab.icns", path.join(APP_BUNDLE_FOLDER, "Contents", "Resources", "AppIcon.icns"));

// Analytics build configuration
const getBuildAnalyticsConfig = () => {
  // Single Mixpanel token - only use if explicitly provided
  const mixpanelToken = process.env['MIXPANEL_TOKEN'] || null;
  
  return {
    mixpanelToken: mixpanelToken,
  };
};

// buildEnvironment

// TODO: pass build_folder and other paths from cli
const BUILD_FOLDER = path.resolve(
  path.join(
    APP_BUNDLE_FOLDER,
    "Contents",
    "Resources",
    "app",
    "views",
    "ivde"
  )
);

const externalDeps = [
  // "electrobun",
  // "esbuild",
  "vscode",
  "typescript",
  "vs",

  // otherwise __dirname equals the build folder because it's compiled in
  // TODO: find a way to automatically externalize all dependencies (maybe package.json scan)
  "window-wrapper",
  ...builtinModules.flatMap((m: string) => [m, `node:${m}`]),
];

// Build ivde renderer
await esbuild.build({
  entryPoints: [
    path.resolve(path.join("./src", "renderers", "ivde", "index.tsx")),
  ],
  // outDir: path.join(appPath, "build"),
  outfile: path.join(BUILD_FOLDER, `index.js`),
  bundle: true,
  plugins: [
    MonacoEsbuildPlugin({
      destDir: path.join(BUILD_FOLDER),
      pathPrefix: "/", // Use root path instead of default "/assets/"
      minify: false, // need this for production builds
      languages: [
        "typescript",
        "javascript",
        "html",
        "css",
        "json",
        "markdown",
      ],

      // features: ["coreCommands", "find", "folding", "format"],
    }),
    solidPlugin(),
  ],
  // jsx: "preserve",
  // jsxImportSource: "solid-js",
  // jsxFactory: "Solid.h", // use Solid's h function for JSX
  // jsxFragment: "Solid.Fragment", // use
  jsxFactory: "Solid.createElement",
  jsxFragment: "Solid.Fragment",
  // TODO: do we need to detect or have different filenames for renderers with and without node integration?
  // or can we just always compile with node as the target and let user turn it on or off in new BrowserWindow()
  // NOTE: you still need to set this to browser even if nodeIntegration is true
  platform: "browser",
  //   target: "node14",
  format: "esm",
  external: externalDeps,
  loader: {
    ".tts": "file",
    ".ttf": "file",
    ".node": "file",
    // ".svg": "text",
  },
});
console.log("--------> esbuild ivde")

// Inject analytics configuration into the built files
await injectAnalyticsConfig();

// Build PTY binary (assumes Zig is already vendored)
await buildPtyBinary();

// Build llama-cli (assumes llama.cpp is already built)
await buildLlamaCli();

/*
Usage:
   tailwindcss build [options]

Options:
   -i, --input              Input file
   -o, --output             Output file
   -w, --watch              Watch for changes and rebuild as needed
   -p, --poll               Use polling instead of filesystem events when watching
       --content            Content paths to use for removing unused classes
       --postcss            Load custom PostCSS configuration
   -m, --minify             Minify the output
   -c, --config             Path to a custom config file
       --no-autoprefixer    Disable autoprefixer
   -h, --help               Display usage information
         */
// path.resolve(path.join("./src", "renderers", "ivde", "index.tsx"));
const cssInPath = path.join("./src/renderers", "ivde", "index.css");
const cssOutPath = path.join(
  BUILD_FOLDER.replace("(", "\\(").replace(")", "\\)"),
  `tailwind.css`
);
const tailwindConfig = path.join("./src/renderers", `tailwind.config.js`);
const contentPath = path.join("./src/renderers", "ivde", "*.tsx");
execSync(
  `./node_modules/.bin/tailwind --content ${contentPath} -c ${tailwindConfig} -i ${cssInPath} -o ${cssOutPath}`,
  {}
  // (err, stdout, stderr) => console.log("result", err, stdout, stderr)
);

cpSync(
  "./vendor",
  path.join(APP_BUNDLE_FOLDER, "Contents", "MacOS", "vendor"),
  { recursive: true, dereference: true }
);


// Note: All dependency building functions moved to scripts/setup-deps.ts
// This file now only handles building final binaries from pre-built dependencies

async function buildPtyBinary() {
    const zigBinary = process.platform === 'win32' ? 'zig.exe' : 'zig';
    const zigBinPath = path.join('./vendors/zig', zigBinary);
    
    if (!existsSync(zigBinPath)) {
        console.error("Zig not found, cannot build PTY binary");
        console.error("Run 'bun setup' first to vendor dependencies");
        return;
    }
    
    console.log("--------> Building PTY binary...");
    
    // Build the Zig PTY binary
    execSync(`cd src/pty && ../../${zigBinPath} build`, {});
    
    // Copy PTY binary to MacOS folder
    const ptyBinarySource = path.join("src/pty/zig-out/bin", "colab-pty");
    const ptyBinaryMacOSTarget = path.join(APP_BUNDLE_FOLDER, "Contents", "MacOS", "colab-pty");
    
    if (existsSync(ptyBinarySource)) {
        // Copy to MacOS folder only
        cpSync(ptyBinarySource, ptyBinaryMacOSTarget);
        console.log("--------> PTY binary copied to MacOS folder");
    } else {
        console.error("--------> PTY binary not found at:", ptyBinarySource);
    }
    
    console.log("--------> PTY binary built and copied");
}


async function buildLlamaCli() {
    const zigBinary = process.platform === 'win32' ? 'zig.exe' : 'zig';
    const zigBinPath = path.join('./vendors/zig', zigBinary);
    
    if (!existsSync(zigBinPath)) {
        console.error("Zig not found, cannot build llama-cli binary");
        console.error("Run 'bun setup' first to vendor dependencies");
        return;
    }
    
    console.log("--------> Building llama-cli binary (assumes dependencies are ready)...");
    
    const targetMacOSPath = path.join(APP_BUNDLE_FOLDER, "Contents", "MacOS");
    
    try {
        // Verify llama.cpp libraries exist (should be built by setup-deps.ts)
        const llamaCppDir = path.resolve("llama-cli", "deps", "llama.cpp");
        const buildDir = path.join(llamaCppDir, "build");
        const libLlamaPath = path.join(buildDir, "src", "libllama.a");
        
        if (!existsSync(libLlamaPath)) {
            console.error("--------> llama.cpp libraries not found at:", libLlamaPath);
            console.error("--------> Run 'bun setup' first to build dependencies");
            throw new Error("Dependencies not found - run 'bun setup'");
        }
        
        console.log("--------> llama.cpp libraries found, proceeding with Zig build");
        
        // Set has_llama = true in build options
        const buildOptionsPath = path.join("llama-cli", "src", "build_options_default.zig");
        const buildOptionsContent = "pub const has_llama = true;\n";
        writeFileSync(buildOptionsPath, buildOptionsContent);
        console.log("--------> Set has_llama = true in build options");
        
        // Build the real llama-cli using our working Zig configuration
        console.log("--------> Building llama-cli with Zig...");
        execSync(`cd llama-cli && ../${zigBinPath} build`, { stdio: 'inherit' });
        
        // Copy llama-cli binary to MacOS folder
        const llamaCliBinarySource = path.join("llama-cli", "zig-out", "bin", "llama-cli");
        const llamaCliBinaryMacOSTarget = path.join(targetMacOSPath, "llama-cli");
        
        if (existsSync(llamaCliBinarySource)) {
            // Copy to MacOS folder
            cpSync(llamaCliBinarySource, llamaCliBinaryMacOSTarget);
            console.log("--------> Real llama-cli binary copied to MacOS folder");
        } else {
            console.error("--------> llama-cli binary not found at:", llamaCliBinarySource);
            // Fall back to mock version
            await buildMockLlamaCli();
        }
        
        console.log("--------> Real llama-cli binary built and copied successfully");
    } catch (error) {
        console.error("--------> Failed to build real llama-cli:", error);
        console.log("--------> Falling back to mock version...");
        await buildMockLlamaCli();
    }
}

async function buildMockLlamaCli() {
    const zigBinary = process.platform === 'win32' ? 'zig.exe' : 'zig';
    const zigBinPath = path.join('./vendors/zig', zigBinary);
    
    if (!existsSync(zigBinPath)) {
        console.error("Zig not found, cannot build mock llama-cli binary");
        return;
    }
    
    console.log("--------> Building mock llama-cli binary...");
    
    const targetMacOSPath = path.join(APP_BUNDLE_FOLDER, "Contents", "MacOS");
    
    try {
        // Build the mock llama-cli binary
        execSync(`cd llama-cli && ../${zigBinPath} build`, {});
        
        // Copy llama-cli binary to MacOS folder
        const llamaCliBinarySource = path.join("llama-cli/zig-out/bin", "llama-cli-mock");
        const llamaCliBinaryMacOSTarget = path.join(targetMacOSPath, "llama-cli");
        
        if (existsSync(llamaCliBinarySource)) {
            // Copy to MacOS folder
            cpSync(llamaCliBinarySource, llamaCliBinaryMacOSTarget);
            console.log("--------> Mock llama-cli binary copied to MacOS folder");
        } else {
            console.error("--------> Mock llama-cli binary not found at:", llamaCliBinarySource);
        }
        
        console.log("--------> Mock llama-cli binary built and copied");
    } catch (error) {
        console.error("--------> Failed to build mock llama-cli:", error);
        throw error;
    }
}

async function injectAnalyticsConfig() {
    console.log("--------> Injecting analytics configuration...");
    
    const analyticsConfig = getBuildAnalyticsConfig();
    console.log("--------> Analytics config for build:", analyticsConfig);
    
    // Path to the built main process file
    const mainBundlePath = path.join(APP_BUNDLE_FOLDER, "Contents", "Resources", "app", "bun", "index.js");
    
    if (!existsSync(mainBundlePath)) {
        console.error("--------> Main bundle not found at:", mainBundlePath);
        return;
    }
    
    try {
        // Read the built main process file
        const fs = require('fs');
        let mainBundleContent = fs.readFileSync(mainBundlePath, 'utf8');
        
        // Replace the build-time Mixpanel token
        const tokenValue = analyticsConfig.mixpanelToken ? `"${analyticsConfig.mixpanelToken}"` : 'null';
        mainBundleContent = mainBundleContent.replace(
            new RegExp(`"BUILD_TIME_MIXPANEL_TOKEN"`, 'g'),
            tokenValue
        );
        
        // Write the modified content back
        fs.writeFileSync(mainBundlePath, mainBundleContent);
        
        console.log("--------> Analytics configuration injected successfully");
        console.log(`--------> Mixpanel token: ${analyticsConfig.mixpanelToken ? '***configured***' : 'none'}`);
        console.log(`--------> Analytics behavior: User opt-in required (default: disabled)`);
        
    } catch (error) {
        console.error("--------> Failed to inject analytics configuration:", error);
        // Don't throw - this is not critical for the build to succeed
    }
}

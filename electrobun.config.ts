import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json" assert { type: "json" };

export default {
    "app": {
        "name": "co(lab)",
        "identifier": "sh.blackboard.colab",
        "version": packageJson.version
    },
    "build": {
        "bun": {
            "entrypoint": "src/main/index.ts",
            "external": []
        },
        "views": {
            bunny: {
                entrypoint: "src/renderers/bunny/index.ts",
            },
        },
        "copy": {
            "src/renderers/ivde/index.html": "views/ivde/index.html",
            "src/renderers/ivde/styles/": "views/ivde/styles/",
            "assets/custom.editor.worker.js": "views/ivde/custom.editor.worker.js",
            "assets/": "views/assets/",
            "node_modules/@xterm/xterm/css/xterm.css": "views/ivde/xterm.css",
            "src/renderers/bunny/index.html": "views/bunny/index.html",
            "src/renderers/bunny/index.css": "views/bunny/index.css",
            "assets/bunny.png": "views/bunny/assets/bunny.png"
        },
        "mac": {
            // postBuild copies the compiled icon so builds don't depend on iconutil.
            "icons": "",
            "codesign": true,
            "notarize": true,
            "bundleCEF": false,
            "entitlements": {

            }
        },
        watch: [],
        watchIgnore: [
            'assets/licenses.html'
        ]
    },
    "runtime": {
        exitOnLastWindowClosed: false
    },
    "scripts": {
        "postBuild": "./scripts/postBuild.ts",
        "postPackage": "./scripts/sign-dev.ts"
    },
    "release": {
        "baseUrl": "https://colab-releases.blackboard.sh/"
    }
} satisfies ElectrobunConfig;


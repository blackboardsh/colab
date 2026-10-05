import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Electrobun 1.x skips signing dev builds. Sign after the bundle is complete,
// because its generated metadata changes after the postBuild hook.
if (
  process.env.ELECTROBUN_BUILD_ENV === "dev" &&
  process.env.ELECTROBUN_OS === "macos" &&
  process.platform === "darwin"
) {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  const appName = process.env.ELECTROBUN_APP_NAME;
  if (!buildDir || !appName) {
    throw new Error("Dev signing requires Electrobun's build directory and app name.");
  }

  const appBundle = join(buildDir, `${appName}.app`);
  console.log("Signing local dev bundle (no developer certificate required)...");
  execFileSync("/usr/bin/codesign", [
    "--force", "--deep", "--sign", "-", "--timestamp=none", "--options", "0", appBundle,
  ], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", [
    "--verify", "--deep", "--strict", appBundle,
  ], { stdio: "inherit" });
}

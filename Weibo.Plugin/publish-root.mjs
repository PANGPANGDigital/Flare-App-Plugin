import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(pluginRoot);
const supportedIcon = /^icon\.(?:png|jpe?g|webp|gif|ico)$/;
const sourceAssets = join(pluginRoot, "assets");
const icons = (await readdir(sourceAssets)).filter((name) => supportedIcon.test(name));

if (icons.length !== 1) {
  throw new Error(`Expected exactly one supported icon in ${sourceAssets}, found ${icons.length}`);
}

for (const name of ["manifest.json", "plugin.js"]) {
  await cp(join(pluginRoot, name), join(repositoryRoot, name));
}

const repositoryAssets = join(repositoryRoot, "assets");
await mkdir(repositoryAssets, { recursive: true });
for (const name of await readdir(repositoryAssets)) {
  if (supportedIcon.test(name) && name !== icons[0]) {
    await rm(join(repositoryAssets, name));
  }
}
await cp(join(sourceAssets, icons[0]), join(repositoryAssets, icons[0]));

console.log("Synced manifest.json, plugin.js, and the plugin icon to the repository root.");

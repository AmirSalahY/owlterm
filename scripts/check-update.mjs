#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const REPO = process.env.TERMAUTO_UPDATE_REPO ?? "AmirSalahY/termauto";
const URL = process.env.TERMAUTO_UPDATE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE = path.join(os.homedir(), ".termauto", "update-check.json");
const TTL_MS = Number(process.env.TERMAUTO_UPDATE_TTL_MS ?? 6 * 60 * 60 * 1000);
const TIMEOUT_MS = Number(process.env.TERMAUTO_UPDATE_TIMEOUT_MS ?? 1200);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const currentVersion = () => {
  try {
    return readJson(path.join(ROOT, "package.json")).version;
  } catch {
    return undefined;
  }
};

const normalize = (version) => String(version ?? "").trim().replace(/^v/i, "");

const parseVersion = (version) => {
  const [core, prerelease = ""] = normalize(version).split("-", 2);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease };
};

const compareVersions = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
};

const readCache = () => {
  try {
    const cached = readJson(CACHE);
    if (Date.now() - cached.checkedAt < TTL_MS) return cached.release;
  } catch {
    return undefined;
  }
  return undefined;
};

const writeCache = (release) => {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({ checkedAt: Date.now(), release }, null, 2));
  } catch {
    // Update checks must never block the shell from starting.
  }
};

const writeNotice = (message) => {
  const output = process.env.TERMAUTO_UPDATE_OUTPUT;
  if (output) {
    try {
      fs.writeFileSync(output, message, { flag: "a" });
      return;
    } catch {
      return;
    }
  }
  process.stdout.write(message);
};

const fetchRelease = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `termauto/${currentVersion() ?? "unknown"}`,
      },
    });
    if (!response.ok) return undefined;
    const json = await response.json();
    if (!json?.tag_name) return undefined;
    const release = {
      version: normalize(json.tag_name),
      tag: json.tag_name,
      url: json.html_url,
    };
    writeCache(release);
    return release;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  const current = currentVersion();
  if (!current) return;
  const release = readCache() ?? (await fetchRelease());
  if (!release?.version || compareVersions(release.version, current) <= 0) return;

  writeNotice(`\ntermauto ${release.version} is available; current is ${current}.\nRun: termauto update\n\n`);
};

await main();

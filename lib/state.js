/**
 * 状态文件读写：`$DSH_HOME/window-state.json`。
 *
 * 文件格式与旧插件 dsh-window-state 完全一致（schema 1 / x / y / width / height /
 * maximized），所以换插件不会丢掉已经记住的窗口状态。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isValidGeometry } from "./geometry.js";

/** 当前写出的 schema 版本；读到更高版本时宁可不用，也不去猜它的语义。 */
export const SCHEMA = 1;

/** 状态文件路径。 */
export function statePath() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "window-state.json");
}

/**
 * 读取状态。
 * @returns {null | { geometry: object | null, maximized: boolean, future: boolean }}
 *   文件缺失、损坏或几何不合法时返回 null（当作"没有记录"）。
 */
export function loadState() {
  let text;
  try {
    text = readFileSync(statePath(), "utf8");
  } catch {
    return null;
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;

  // 更高版本的 schema 读不懂，宁可不还原。
  if (Number.isFinite(value.schema) && value.schema > SCHEMA) {
    return { geometry: null, maximized: false, future: true, savedAt: null };
  }

  const geometry = { x: value.x, y: value.y, width: value.width, height: value.height };
  if (!isValidGeometry(geometry)) return null;
  return {
    geometry,
    maximized: value.maximized === true,
    future: false,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : null,
  };
}

/** 删掉状态文件（设置页的「清除记录」）。文件本来就不存在也算成功。 */
export function clearState() {
  try {
    rmSync(statePath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 写入状态文件（先写临时文件再改名，避免写一半被读到）。
 * @returns 是否写入成功
 */
export function saveState(state, log) {
  const file = statePath();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const body = `${JSON.stringify({
      schema: SCHEMA,
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      maximized: state.maximized === true,
      savedAt: new Date().toISOString(),
    }, null, 2)}\n`;
    writeFileSync(temp, body, "utf8");
    renameSync(temp, file);
    return true;
  } catch (error) {
    log?.warn?.(`写状态文件失败：${String(error)}`);
    if (existsSync(temp)) {
      try {
        rmSync(temp, { force: true });
      } catch {
        // 临时文件留着也无害，下次写会覆盖。
      }
    }
    return false;
  }
}

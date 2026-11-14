/**
 * dsh-window-memory —— 记住 DSH 桌面版主窗口的尺寸、位置与最大化状态。
 *
 * 宿主半边跑在 desktop Host 子进程里（ELECTRON_RUN_AS_NODE=1 的纯 Node 进程），
 * 拿不到 Electron 的 BrowserWindow，因此用 koffi 直接调 user32.dll 读写窗口放置信息。
 *
 * 与旧版 dsh-window-state（0.1.0）的差别：
 *   1. 启动阶段 150ms 一轮快速轮询，窗口一出现就还原；旧版固定 2s 一轮，最多要等 2s。
 *      还原后降为 1.5s 一轮，静止时不再写盘。
 *   2. 用 WINDOWPLACEMENT.flags 的 WPF_RESTORETOMAXIMIZED 判断"最小化前是否最大化"。
 *   3. 绝不跨进程取消最大化：把最大化窗口 SetWindowPlacement 回普通态时曾把调用方挂住，
 *      这里窗口已是目标状态就一次 Win32 写都不发。
 *   4. 有可视化设置页（设置 → 窗口记忆）：三个开关 + 记住当前窗口 / 立即还原 / 清除记录。
 *
 * 设置页的接口挂在 webServer 的 /dsh-window-memory 前缀下；没有 webServer 时只是不注册
 * 接口，窗口记忆照常工作。
 *
 * 平台：仅 Windows 生效，其它平台记一条日志后跳过。
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fitIntoWorkArea, geometryToRect, isValidGeometry, rectToGeometry, sameGeometry } from "./lib/geometry.js";
import { clearState, loadState, saveState, SCHEMA, statePath } from "./lib/state.js";
import {
  bindUser32,
  enumTopLevel,
  hasMaximizeBox,
  isIconic,
  isOnScreen,
  isRootWindow,
  isVisible,
  isWindow,
  isZoomed,
  mainWindowClass,
  normalizeExePath,
  processImagePath,
  readPlacement,
  SW_MAXIMIZE,
  SW_NORMAL,
  windowClass,
  windowPid,
  workAreaOf,
  writePlacement,
  WPF_RESTORETOMAXIMIZED,
} from "./lib/win32.js";

/** 启动阶段：等窗口出现时的轮询间隔（毫秒）。够快，肉眼看不见跳变。 */
const FAST_POLL_MS = 150;
/** 稳定阶段：记录用户调整的轮询间隔（毫秒）。 */
const STEADY_POLL_MS = 1_500;
/** 等主窗口出现的上限（毫秒）；超时说明不是桌面版，安静停掉。 */
const WAIT_WINDOW_MS = 90_000;
/** 状态变化后的防抖（毫秒）：拖动窗口的过程中不写盘。 */
const WRITE_DEBOUNCE_MS = 350;
/** 设置页接口前缀。 */
const API_PREFIX = "/dsh-window-memory";
/** 界面保存的开关落在这个文件（与状态文件同一个目录）。 */
const SETTINGS_FILE = "window-memory.json";
/** 三个开关的名字，顺序即设置页里的顺序。 */
const SETTING_KEYS = ["enabled", "restoreMaximized", "restoreSizePosition"];

/** 宽松的布尔解析：YAML / JSON 里写 "false"、"no"、"off"、"0" 都算关。 */
function parseFlag(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return !/^(false|no|off|0|)$/i.test(value.trim());
  return Boolean(value);
}

/** 读配置行（patch 里的 config），缺项用 true。 */
function readOptions(config) {
  return {
    enabled: parseFlag(config?.enabled, true),
    restoreMaximized: parseFlag(config?.restoreMaximized, true),
    restoreSizePosition: parseFlag(config?.restoreSizePosition, true),
  };
}

/** 用补丁里出现过的字段覆盖 base；没出现的字段保持 base。 */
function mergeOptions(base, patch) {
  const next = { ...base };
  if (patch === null || typeof patch !== "object") return next;
  for (const key of SETTING_KEYS) {
    if (patch[key] === undefined || patch[key] === null) continue;
    next[key] = parseFlag(patch[key], base[key]);
  }
  return next;
}

/** 只取三个开关，写文件时用。 */
function pickSettings(values) {
  const picked = {};
  for (const key of SETTING_KEYS) picked[key] = values[key] === true;
  return picked;
}

/** DSH_HOME（和状态文件同源）。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/** 界面开关的保存位置。 */
function settingsPath() {
  return join(dshHome(), SETTINGS_FILE);
}

/** 读界面保存的开关；文件缺失或损坏都当作"没有"。 */
function loadSettingsFile() {
  try {
    const value = JSON.parse(readFileSync(settingsPath(), "utf8"));
    return value !== null && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** 写界面开关（先写临时文件再改名）。 */
function saveSettingsFile(values, log) {
  const file = settingsPath();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temp, `${JSON.stringify({
      schema: 1,
      ...pickSettings(values),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    renameSync(temp, file);
    return true;
  } catch (error) {
    log?.warn?.(`写设置文件失败：${String(error)}`);
    return false;
  }
}

/** 取宿主 logger；没有就静默，插件不该因为日志能力缺失而报错。 */
function loggerOf(ctx) {
  const logger = ctx?.logger;
  return {
    info: (message) => { try { logger?.info?.(`window-memory: ${message}`); } catch { /* 忽略 */ } },
    warn: (message) => { try { logger?.warn?.(`window-memory: ${message}`); } catch { /* 忽略 */ } },
  };
}

/**
 * 借宿主的 koffi。
 *
 * koffi 刻意不声明为运行时依赖：它带原生构建脚本，pnpm 默认拒绝执行，会让整个安装
 * 失败。改为从宿主借——desktop-host 自带 koffi，并且与宿主同一个原生 ABI。
 */
function loadKoffi() {
  try {
    return createRequire(import.meta.url)("koffi");
  } catch {
    // 链接安装时本包没有自己的 node_modules，继续向宿主借。
  }
  const entry = hostEntry();
  if (entry === null) return null;
  try {
    return createRequire(entry)("koffi");
  } catch {
    return null;
  }
}

/** 定位 desktop-host 的入口脚本，用它的位置解析 koffi。 */
function hostEntry() {
  const argv = process.argv[1];
  if (typeof argv === "string" && /dsh-desktop-host/.test(argv)) return argv;

  const suffix = join("dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "index.js");
  let dir = dirname(process.execPath);
  for (let i = 0; i < 6; i++) {
    for (const prefix of [[], ["resources"], ["resources", "app.asar"]]) {
      const candidate = join(dir, ...prefix, suffix);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 两组记录是否一致。 */
function sameState(a, b) {
  return a !== null && b !== null
    && a.x === b.x && a.y === b.y
    && a.width === b.width && a.height === b.height
    && a.maximized === b.maximized;
}

/** 读插件自己的版本号，只用于设置页显示。 */
function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * 窗口轮询与操作。
 *
 * 返回一组方法给 apply 和设置页接口共用；所有 Win32 调用都收在这里。
 */
function createController({ b, ownExe, log, settings }) {
  const windowClass1 = mainWindowClass();

  let timer = null;
  let disposed = false;
  let target = null;
  let restored = false;
  let lastWritten = null;
  let pendingTimer = null;
  let pendingValue = null;
  let lastAction = null;
  const deadline = Date.now() + WAIT_WINDOW_MS;

  /**
   * 一次操作的结果。界面按 `code` 翻译，`message` 只进日志/兜底。
   * @param {string} code 语言无关的结果码
   * @param {boolean} ok 这次操作算不算成功
   * @param {object | null} params 翻译用参数（如 width/height/maximized）
   * @param {string} message 中文说明，写日志
   * @param {boolean} [applied] 是否真的改了窗口
   */
  function action(code, ok, params, message, applied) {
    return {
      at: new Date().toISOString(),
      ok,
      code,
      params: params ?? null,
      message,
      ...(applied === undefined ? {} : { applied }),
    };
  }

  /** 该窗口是否属于宿主自己的进程（唯一判据，不看标题）。 */
  function isOwnWindow(hwnd) {
    const pid = windowPid(b, hwnd);
    return pid !== 0 && normalizeExePath(processImagePath(b, pid)) === ownExe;
  }

  /**
   * 找主窗口：宿主进程里、顶层、可最大化、面积最大的窗口。
   * 欢迎页与更新弹窗不可最大化（没有 WS_MAXIMIZEBOX），因此被排除。
   */
  function findTarget(requireVisible) {
    let best = null;
    let bestArea = 0;
    enumTopLevel(b, (hwnd) => {
      if (!isRootWindow(b, hwnd)) return true;
      if (requireVisible && !isVisible(b, hwnd)) return true;
      if (windowClass(b, hwnd) !== windowClass1) return true;
      if (!hasMaximizeBox(b, hwnd)) return true;
      if (!isOwnWindow(hwnd)) return true;
      const placement = readPlacement(b, hwnd);
      if (placement === null) return true;
      const geometry = rectToGeometry(placement.rcNormalPosition);
      if (!isValidGeometry(geometry)) return true;
      const area = geometry.width * geometry.height;
      if (area > bestArea) {
        bestArea = area;
        best = hwnd;
      }
      return true;
    });
    return best;
  }

  /** 取得目标窗口，尽量复用已缓存的句柄。 */
  function acquire(requireVisible) {
    if (target !== null && isWindow(b, target)) {
      if (!requireVisible || isVisible(b, target)) return target;
    }
    target = findTarget(requireVisible);
    return target;
  }

  /** 读当前窗口状态；句柄失效返回 null。 */
  function readCurrent(hwnd) {
    const placement = readPlacement(b, hwnd);
    if (placement === null) return null;
    const geometry = rectToGeometry(placement.rcNormalPosition);
    if (!isValidGeometry(geometry)) return null;
    const minimized = isIconic(b, hwnd);
    const maximized = isZoomed(b, hwnd)
      || placement.showCmd === SW_MAXIMIZE
      || (minimized && (placement.flags & WPF_RESTORETOMAXIMIZED) !== 0);
    return { ...geometry, maximized };
  }

  /** 把读到的状态记下来（防抖后写盘；已 dispose 时立即写）。 */
  function record(value) {
    if (value === null) return;
    if (sameState(lastWritten, value)) {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        pendingValue = null;
      }
      return;
    }
    pendingValue = value;
    if (disposed) {
      flush();
      return;
    }
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** 真正落盘。 */
  function flush() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const value = pendingValue;
    pendingValue = null;
    if (value === null || sameState(lastWritten, value)) return;
    if (saveState(value, log)) lastWritten = value;
  }

  /**
   * 把记住的状态套到窗口上。
   *
   * `ok` 表示这次操作本身是否说得通（没东西可改也算 ok），`applied` 表示是否真的发了
   * Win32 写调用。`code`/`params` 给界面按语言翻译用，`reason` 只写进日志。
   * @returns {{ applied: boolean, ok: boolean, code: string, params: object | null, reason: string }}
   */
  function restore(hwnd, saved) {
    const options = settings.values;
    if (saved === null || saved.future || saved.geometry === null) {
      return { applied: false, ok: false, code: "apply.noRecord", params: null, reason: "状态文件里没有可用的记录" };
    }
    const work = workAreaOf(b, hwnd);
    const wanted = work === null
      ? saved.geometry
      : fitIntoWorkArea(saved.geometry, work, isOnScreen(b, geometryToRect(saved.geometry)));
    const zoomed = isZoomed(b, hwnd);
    const size = { width: wanted.width, height: wanted.height };

    if (saved.maximized && options.restoreMaximized) {
      if (zoomed) {
        return { applied: false, ok: true, code: "apply.alreadyMaximized", params: null, reason: "窗口已经是最大化了" };
      }
      if (!writePlacement(b, hwnd, geometryToRect(wanted), SW_MAXIMIZE)) {
        return { applied: false, ok: false, code: "apply.maxFailed", params: null, reason: "还原最大化失败" };
      }
      log.info(`已还原 ${wanted.width}×${wanted.height} @ (${wanted.x},${wanted.y})，最大化`);
      return { applied: true, ok: true, code: "apply.okMaximized", params: size, reason: "已还原为最大化" };
    }

    if (!options.restoreSizePosition) {
      return { applied: false, ok: true, code: "apply.sizeOff", params: null, reason: "尺寸与位置的记忆是关着的" };
    }
    if (zoomed) {
      // 跨进程把最大化窗口拉回普通态时，SetWindowPlacement 有可能把调用方挂住。
      // 真实启动路径里窗口总是从普通态开始，这条分支只会出现在手动还原时。
      return { applied: false, ok: false, code: "apply.zoomed", params: null, reason: "窗口现在是最大化" };
    }
    const current = readPlacement(b, hwnd);
    if (current !== null && sameGeometry(rectToGeometry(current.rcNormalPosition), wanted)) {
      return { applied: false, ok: true, code: "apply.alreadyThere", params: null, reason: "窗口已经是记录的位置和尺寸" };
    }
    if (!writePlacement(b, hwnd, geometryToRect(wanted), SW_NORMAL)) {
      return { applied: false, ok: false, code: "apply.sizeFailed", params: null, reason: "还原窗口尺寸失败" };
    }
    log.info(`已还原 ${wanted.width}×${wanted.height} @ (${wanted.x},${wanted.y})`);
    return { applied: true, ok: true, code: "apply.okSize", params: size, reason: "已还原窗口尺寸" };
  }

  /** 安排下一轮。 */
  function schedule(delay) {
    if (disposed) return;
    timer = setTimeout(tick, delay);
  }

  function tick() {
    timer = null;
    if (disposed) return;
    try {
      const options = settings.values;
      if (!restored) {
        const hwnd = acquire(true);
        if (hwnd === null) {
          if (Date.now() >= deadline) {
            log.info("未找到 DSH 主窗口（可能不是桌面版），停止监听");
            timer = null;
            return;
          }
          schedule(FAST_POLL_MS);
          return;
        }
        restored = true;
        if (options.enabled) restore(hwnd, loadState());
        lastWritten = readCurrent(hwnd);
        schedule(STEADY_POLL_MS);
        return;
      }

      const hwnd = acquire(false);
      if (hwnd !== null) {
        // 暂停记录时只更新基线，不写盘；重新打开后从那一刻的状态继续记。
        if (options.enabled) record(readCurrent(hwnd));
        else lastWritten = readCurrent(hwnd);
      }
      schedule(STEADY_POLL_MS);
    } catch (error) {
      log.warn(`轮询出错：${String(error)}`);
      schedule(restored ? STEADY_POLL_MS : FAST_POLL_MS);
    }
  }

  /** 开始轮询；返回清理函数。 */
  function start() {
    schedule(FAST_POLL_MS);
    return () => {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        const hwnd = acquire(false);
        if (hwnd !== null) record(readCurrent(hwnd));
        flush();
      } catch (error) {
        log.warn(`退出前记录失败：${String(error)}`);
      }
    };
  }

  /** 当前窗口状态（找不到窗口返回 null）。 */
  function currentState() {
    const hwnd = acquire(false);
    return hwnd === null ? null : readCurrent(hwnd);
  }

  /** 立刻把当前窗口状态写进状态文件。 */
  function snapshotNow() {
    const hwnd = acquire(true) ?? acquire(false);
    if (settings.values.enabled !== true) {
      lastAction = action("disabled.snapshot", false, null, "窗口记忆已停用，不在记录");
      return lastAction;
    }
    if (hwnd === null) {
      lastAction = action("snapshot.noWindow", false, null, "没找到 DSH 主窗口");
      return lastAction;
    }
    const value = readCurrent(hwnd);
    if (value === null) {
      lastAction = action("snapshot.unreadable", false, null, "读不到窗口状态");
      return lastAction;
    }
    lastWritten = value;
    if (!saveState(value, log)) {
      lastAction = action("snapshot.writeFailed", false, null, "写状态文件失败");
      return lastAction;
    }
    lastAction = action(
      "snapshot.ok",
      true,
      { maximized: value.maximized, width: value.width, height: value.height },
      "已记住当前窗口",
    );
    return lastAction;
  }

  /** 立刻把记录套用到窗口上。 */
  function applyNow() {
    if (settings.values.enabled !== true) {
      lastAction = action("disabled.apply", false, null, "窗口记忆已停用，不在还原");
      return lastAction;
    }
    const hwnd = acquire(false);
    if (hwnd === null) {
      lastAction = action("apply.noWindow", false, null, "没找到 DSH 主窗口");
      return lastAction;
    }
    const result = restore(hwnd, loadState());
    lastWritten = readCurrent(hwnd);
    lastAction = action(result.code, result.ok, result.params, result.reason, result.applied);
    return lastAction;
  }

  /** 删除记录。 */
  function clearSaved() {
    const ok = clearState();
    lastWritten = null;
    lastAction = action(ok ? "clear.ok" : "clear.failed", ok, null, ok ? "记录已清除" : "清除失败");
    return lastAction;
  }

  /** 设置页用的快照。 */
  function status() {
    const saved = loadState();
    return {
      current: currentState(),
      saved: saved === null ? null : {
        x: saved.geometry?.x ?? null,
        y: saved.geometry?.y ?? null,
        width: saved.geometry?.width ?? null,
        height: saved.geometry?.height ?? null,
        maximized: saved.maximized,
        savedAt: saved.savedAt,
        future: saved.future === true,
      },
      restored,
      lastAction,
      statePath: statePath(),
      settingsPath: settingsPath(),
    };
  }

  return { start, status, snapshotNow, applyNow, clearSaved, currentState };
}

/**
 * 设置页接口。
 *
 * GET  /status    设置页轮询的状态
 * POST /settings  改开关 { enabled?, restoreMaximized?, restoreSizePosition? }
 * POST /snapshot  立刻记住当前窗口
 * POST /apply     立刻还原记录
 * POST /clear     清除记录
 */
function createHandler({ controller, settings, log }) {
  function json(res, status, value) {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(body.length),
      "cache-control": "no-store",
    });
    res.end(body);
  }

  function fail(res, status, message) {
    json(res, status, { ok: false, error: message });
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error("请求太大"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function readJsonBody(req) {
    const raw = await readBody(req, 64 * 1024);
    if (!raw.length) return {};
    try {
      const value = JSON.parse(raw.toString("utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
      return value;
    } catch {
      throw Object.assign(new Error("请求不是有效的 JSON"), { status: 400 });
    }
  }

  /** 只接受本机页面的请求（浏览器半侧就在本机页面里跑）。 */
  function isLocalRequest(req) {
    const host = String(req.headers.host || "").toLowerCase();
    const name = host.replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(name)) return false;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    return true;
  }

  function updateSettings(body) {
    const patch = {};
    for (const key of SETTING_KEYS) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    settings.values = mergeOptions(settings.values, patch);
    const persisted = saveSettingsFile(settings.values, log);
    return {
      settings: settings.values,
      persisted,
      message: persisted ? "已保存" : "已生效，但写入设置文件失败（重启后会丢失）",
    };
  }

  return async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const sub = url.pathname.replace(/^\/dsh-window-memory\/?/, "").replace(/\/+$/, "");
    const method = req.method || "GET";

    try {
      if (method === "GET" && (sub === "" || sub === "status")) {
        return json(res, 200, {
          ok: true,
          version: readVersion(),
          platform: process.platform,
          settings: settings.values,
          defaults: settings.defaults,
          ...controller.status(),
        });
      }
      if (method !== "POST") return fail(res, 405, "只支持 GET/POST");
      if (!isLocalRequest(req)) return fail(res, 403, "只接受本机请求");
      if (req.headers["x-dsh-window-memory"] !== "1") return fail(res, 403, "缺少本插件的请求头");

      const body = await readJsonBody(req);
      if (sub === "settings") return json(res, 200, { ok: true, ...updateSettings(body) });
      if (sub === "snapshot") return json(res, 200, { ok: true, action: controller.snapshotNow() });
      if (sub === "apply") return json(res, 200, { ok: true, action: controller.applyNow() });
      if (sub === "clear") return json(res, 200, { ok: true, action: controller.clearSaved() });
      return fail(res, 404, "没有这个接口");
    } catch (error) {
      log.warn(`设置页接口出错：${String(error)}`);
      if (!res.headersSent) fail(res, Number.isInteger(error?.status) ? error.status : 500, error?.message || "内部错误");
      else res.end();
    }
  };
}

export function apply(ctx, config) {
  const defaults = readOptions(config);
  const log = loggerOf(ctx);

  if (process.platform !== "win32") {
    log.info("仅支持 Windows，本平台跳过");
    return;
  }

  // 默认值来自 patch 行；界面保存过的开关覆盖它。
  const settings = {
    defaults,
    values: mergeOptions(defaults, loadSettingsFile()),
  };
  if (!settings.values.enabled) {
    log.info("当前是停用状态（可在 设置 → 窗口记忆 里打开）");
  }

  const koffi = loadKoffi();
  if (koffi === null) {
    log.warn("载入 koffi 失败（宿主缺少原生 FFI），插件停用");
    return;
  }
  const b = bindUser32(koffi);
  if (b === null) {
    log.warn("绑定 user32.dll 失败，插件停用");
    return;
  }
  const ownExe = normalizeExePath(process.execPath);
  if (ownExe === null) {
    log.warn("无法确定宿主可执行文件，插件停用");
    return;
  }

  const controller = createController({ b, ownExe, log, settings });
  ctx.effect(() => controller.start(), "dsh-window-memory: 记忆主窗口尺寸、位置与最大化");

  /** 挂设置页接口。 */
  const mountRoutes = (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: "prefix",
        path: API_PREFIX,
        handler: createHandler({ controller, settings, log }),
      }),
      "dsh-window-memory: 设置页接口",
    );
  };

  if (typeof ctx.inject === "function") {
    // webServer 是异步启动的：宿主刚起时它可能还没就位，直接 get 一次会永远拿不到。
    // ctx.inject 会等服务出现再回调，服务重新装载时也会重挂。
    ctx.inject(["webServer"], mountRoutes);
  } else {
    // 兜底：没有 inject 的容器上，只能当场查一次。
    const webServer = typeof ctx.get === "function" ? ctx.get("webServer") : undefined;
    if (webServer && typeof webServer.register === "function") {
      ctx.effect(
        () => webServer.register({
          kind: "prefix",
          path: API_PREFIX,
          handler: createHandler({ controller, settings, log }),
        }),
        "dsh-window-memory: 设置页接口",
      );
    } else {
      log.info("没有 webServer，设置页接口不注册（窗口记忆照常工作）");
    }
  }
}

/**
 * user32.dll / kernel32.dll 的最小封装。
 *
 * 三个必须守住的约定：
 *
 * 1. 绑定结果挂在 koffi 对象上，不放模块级变量。koffi 的类型名是进程级注册，
 *    重名会抛 `Duplicate type name`；cordis 的 HMR 会重新加载本模块，模块级缓存
 *    随之归零，下一次 apply 就会二次注册。挂在 koffi 对象上才能跨重载复用。
 *
 * 2. 自定义类型名一律带插件前缀。宿主进程自己也用 koffi，通用名（RECT 之类）
 *    可能已被占用，重名注册即抛错。
 *
 * 3. 读尺寸用 WINDOWPLACEMENT，不用 GetWindowRect。窗口最小化时 GetWindowRect
 *    返回 (-32000,-32000) 处的极小矩形，最大化时返回最大化矩形——两者都不再是
 *    用户设定的尺寸。`WINDOWPLACEMENT.rcNormalPosition` 在三种状态下都保持用户
 *    设定值，`showCmd` / `flags` 另可判断最大化与"最小化前是否最大化"。
 */

/** 挂在 koffi 上的缓存键（Symbol.for 保证跨模块实例取到同一个）。 */
const BINDING_KEY = Symbol.for("dsh-window-memory.user32");

/** 私有类型名，避免与宿主或其它插件在 koffi 里注册的类型冲突。 */
const T = {
  point: "DshWindowMemoryPoint",
  rect: "DshWindowMemoryRect",
  monitorInfo: "DshWindowMemoryMonitorInfo",
  placement: "DshWindowMemoryPlacement",
  enumProc: "DshWindowMemoryEnumProc",
};

/** WINDOWPLACEMENT 的 length 字段（32/64 位下均为 44 字节）。 */
const WINDOWPLACEMENT_LENGTH = 44;

/** 主窗口的窗口类：Electron 在 Windows 上的顶层窗口类名。 */
const MAIN_WINDOW_CLASS = "Chrome_WidgetWin_1";

/** showCmd 取值。 */
export const SW_NORMAL = 1;
export const SW_MAXIMIZE = 3;

/** WINDOWPLACEMENT.flags：窗口最小化前处于最大化，还原时应回到最大化。 */
export const WPF_RESTORETOMAXIMIZED = 0x0002;

/** GetWindowLong 的 GWL_STYLE 索引与 WS_MAXIMIZEBOX 位。 */
const GWL_STYLE = -16;
const WS_MAXIMIZEBOX = 0x0001_0000;

/** GetAncestor 的 GA_ROOT：取顶层祖先。 */
const GA_ROOT = 2;

/** MonitorFromRect 的标志。 */
const MONITOR_DEFAULTTONULL = 0;
const MONITOR_DEFAULTTONEAREST = 2;

/** 空 WINDOWPLACEMENT；length 必须预填，否则调用失败。 */
function emptyPlacement() {
  return {
    length: WINDOWPLACEMENT_LENGTH,
    flags: 0,
    showCmd: 0,
    ptMinPosition: { x: 0, y: 0 },
    ptMaxPosition: { x: 0, y: 0 },
    rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 },
  };
}

/**
 * 绑定 user32/kernel32 并把结果缓存到 koffi 上。
 * @returns 绑定对象；失败返回 null（插件不应因缺少 API 而拖垮宿主）。
 */
export function bindUser32(koffi) {
  if (koffi[BINDING_KEY]) return koffi[BINDING_KEY];
  if (typeof koffi?.load !== "function") return null;

  try {
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");

    koffi.struct(T.point, { x: "long", y: "long" });
    koffi.struct(T.rect, { left: "long", top: "long", right: "long", bottom: "long" });
    koffi.struct(T.monitorInfo, {
      cbSize: "uint32",
      rcMonitor: T.rect,
      rcWork: T.rect,
      dwFlags: "uint32",
    });
    koffi.struct(T.placement, {
      length: "uint32",
      flags: "uint32",
      showCmd: "uint32",
      ptMinPosition: T.point,
      ptMaxPosition: T.point,
      rcNormalPosition: T.rect,
    });

    const binding = {
      koffi,
      GetWindowPlacement: user32.func(`bool GetWindowPlacement(void* h, _Inout_ ${T.placement}* p)`),
      SetWindowPlacement: user32.func(`bool SetWindowPlacement(void* h, _Inout_ ${T.placement}* p)`),
      IsWindow: user32.func("bool IsWindow(void* h)"),
      IsWindowVisible: user32.func("bool IsWindowVisible(void* h)"),
      IsZoomed: user32.func("bool IsZoomed(void* h)"),
      IsIconic: user32.func("bool IsIconic(void* h)"),
      GetAncestor: user32.func("void* GetAncestor(void* h, uint32 f)"),
      GetWindowLongW: user32.func("int32 GetWindowLongW(void* h, int32 index)"),
      GetClassNameW: user32.func("int GetClassNameW(void* h, _Out_ uint16* b, int n)"),
      GetWindowThreadProcessId: user32.func("uint32 GetWindowThreadProcessId(void* h, _Out_ uint32* p)"),
      EnumWindows: user32.func("bool EnumWindows(void* cb, intptr lp)"),
      MonitorFromRect: user32.func(`void* MonitorFromRect(_In_ ${T.rect}* r, uint32 f)`),
      MonitorFromWindow: user32.func("void* MonitorFromWindow(void* h, uint32 f)"),
      GetMonitorInfoW: user32.func(`bool GetMonitorInfoW(void* mon, _Inout_ ${T.monitorInfo}* mi)`),
      enumProto: koffi.proto(`bool __stdcall ${T.enumProc}(void* h, intptr l)`),

      // 用于按可执行文件路径确认窗口归属——写窗口前的硬门禁。
      OpenProcess: kernel32.func("void* OpenProcess(uint32 access, bool inherit, uint32 pid)"),
      QueryFullProcessImageNameW: kernel32.func(
        "bool QueryFullProcessImageNameW(void* proc, uint32 flags, _Out_ uint16* buf, _Inout_ uint32* size)",
      ),
      CloseHandle: kernel32.func("bool CloseHandle(void* handle)"),
    };

    Object.defineProperty(koffi, BINDING_KEY, {
      value: binding,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return binding;
  } catch {
    return null;
  }
}

/** 主窗口的类名，供调用方过滤。 */
export function mainWindowClass() {
  return MAIN_WINDOW_CLASS;
}

/** 读取窗口放置信息；失败返回 null。 */
export function readPlacement(b, hwnd) {
  const placement = emptyPlacement();
  if (!b.GetWindowPlacement(hwnd, placement)) return null;
  return placement;
}

/**
 * 写出窗口放置信息。
 * @param rect       rcNormalPosition（正常态的位置与尺寸）
 * @param showCmd    SW_NORMAL 或 SW_MAXIMIZE
 */
export function writePlacement(b, hwnd, rect, showCmd) {
  const placement = emptyPlacement();
  placement.showCmd = showCmd;
  // 与窗口创建时一致的最小/最大位置，避免还原出异常的最小化位置。
  placement.ptMinPosition = { x: -32000, y: -32000 };
  placement.ptMaxPosition = { x: -1, y: -1 };
  placement.rcNormalPosition = rect;
  return b.SetWindowPlacement(hwnd, placement);
}

/** 枚举全部顶层窗口（只回调 hwnd，过滤交给调用方）；visitor 返回 false 可提前结束。 */
export function enumTopLevel(b, visitor) {
  const cb = b.koffi.register((hwnd) => (visitor(hwnd) === false ? false : true), b.koffi.pointer(b.enumProto));
  try {
    b.EnumWindows(cb, 0);
  } finally {
    b.koffi.unregister(cb);
  }
}

/** 窗口是否仍然有效。 */
export function isWindow(b, hwnd) {
  return Boolean(b.IsWindow(hwnd));
}

/** 窗口是否可见（注意：最小化的窗口仍算可见）。 */
export function isVisible(b, hwnd) {
  return Boolean(b.IsWindowVisible(hwnd));
}

/** 窗口是否最大化。 */
export function isZoomed(b, hwnd) {
  return Boolean(b.IsZoomed(hwnd));
}

/** 窗口是否最小化。 */
export function isIconic(b, hwnd) {
  return Boolean(b.IsIconic(hwnd));
}

/** 窗口是否本身就是顶层窗口（而不是某个子窗口）。 */
export function isRootWindow(b, hwnd) {
  return b.GetAncestor(hwnd, GA_ROOT) === hwnd;
}

/** 窗口是否有最大化按钮；欢迎页、更新弹窗这类不可最大化窗口靠它排除。 */
export function hasMaximizeBox(b, hwnd) {
  return (b.GetWindowLongW(hwnd, GWL_STYLE) & WS_MAXIMIZEBOX) !== 0;
}

/** 读取窗口类名。 */
export function windowClass(b, hwnd) {
  const buf = new Uint16Array(256);
  const length = b.GetClassNameW(hwnd, buf, 256);
  if (length <= 0) return "";
  return Buffer.from(buf.buffer, buf.byteOffset, length * 2).toString("utf16le");
}

/** 进程 id（0 表示取不到）。 */
export function windowPid(b, hwnd) {
  const pid = [0];
  b.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

/**
 * 取进程可执行文件完整路径；取不到返回 null。
 * 用 PROCESS_QUERY_LIMITED_INFORMATION，普通权限进程即可读取，无需提权。
 */
export function processImagePath(b, pid) {
  if (pid === 0) return null;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const handle = b.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (handle === null) return null;
  try {
    const buf = new Uint16Array(32_768);
    const size = [32_768];
    if (!b.QueryFullProcessImageNameW(handle, 0, buf, size)) return null;
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("utf16le").replace(/\0.*$/, "");
  } catch {
    return null;
  } finally {
    b.CloseHandle(handle);
  }
}

/** 规范化可执行文件路径：统一分隔符与大小写，并去掉长路径前缀 `\\?\`。 */
export function normalizeExePath(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  return path.replace(/\//g, "\\").replace(/^\\\\\?\\/, "").toLowerCase();
}

/** 该矩形是否仍与某块显示器相交（判断窗口是否已被移到屏幕外）。 */
export function isOnScreen(b, rect) {
  return b.MonitorFromRect(rect, MONITOR_DEFAULTTONULL) !== null;
}

/** 取得窗口所在显示器的工作区（已排除任务栏）；失败返回 null。 */
export function workAreaOf(b, hwnd) {
  const monitor = b.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (monitor === null) return null;
  const info = {
    cbSize: 40,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };
  if (!b.GetMonitorInfoW(monitor, info)) return null;
  return info.rcWork;
}

/**
 * 纯几何计算：不碰平台 API，便于单独推理与测试。
 */

/** 能被当作主窗口的最小尺寸；比主窗口的默认 1280×820 小得多，只用于排除弹窗/辅助窗口。 */
export const MIN_W = 400;
export const MIN_H = 300;

/** 位置/尺寸的合理上限，防止损坏的状态文件把窗口搬到荒谬的位置。 */
const LIMIT = 100_000;

/**
 * 判断一组数字是否是可用的窗口几何。
 *
 * 位置允许为负（多显示器在主屏左侧/上方），但幅度有限；
 * 尺寸必须不小于主窗口的下限。
 */
export function isValidGeometry(value) {
  if (value === null || typeof value !== "object") return false;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false;
  if (width < MIN_W || height < MIN_H) return false;
  if (width > LIMIT || height > LIMIT) return false;
  if (Math.abs(x) > LIMIT || Math.abs(y) > LIMIT) return false;
  return true;
}

/** 两组几何是否完全一致。 */
export function sameGeometry(a, b) {
  return a !== null && b !== null
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * 让几何适应目标显示器的工作区（已排除任务栏）。
 *
 * 只在两种情况下改动：
 *   - 尺寸大于工作区（换小屏、改分辨率后常见）：缩到工作区大小；
 *   - 窗口整体已不在任何显示器上（拔掉外接屏后常见）：移到该工作区左上角。
 *
 * 其余情况原样返回，尊重用户手动摆的位置。
 */
export function fitIntoWorkArea(geometry, work, onScreen) {
  const availableW = Math.max(MIN_W, work.right - work.left);
  const availableH = Math.max(MIN_H, work.bottom - work.top);
  const width = Math.min(geometry.width, availableW);
  const height = Math.min(geometry.height, availableH);
  if (!onScreen) return { ...geometry, x: work.left, y: work.top, width, height };
  return { ...geometry, width, height };
}

/** Win32 RECT → {x, y, width, height}。 */
export function rectToGeometry(rect) {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/** {x, y, width, height} → Win32 RECT。 */
export function geometryToRect(geometry) {
  return {
    left: geometry.x,
    top: geometry.y,
    right: geometry.x + geometry.width,
    bottom: geometry.y + geometry.height,
  };
}

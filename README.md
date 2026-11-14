# 窗口记忆 · dsh-window-memory

让 **DeepSeek Harness 桌面版**记住主窗口的尺寸、位置与最大化状态：你怎么关，
下次启动就是什么样。窗口一出现就套用（实测约 0.17 秒），所以不会先弹出一个
1280×820 的小窗口再跳成最大化。

> 这是 `dsh-window-state` 0.1.0 的替代版：同一个状态文件、同一套判定，
> 但启动还原快了约一个数量级，有可视化设置页，并可分别关掉某项记忆。
> 两个插件不要同时开（旧的已在插件页停用）。

## 安装

从 GitHub 安装：

```sh
dsh plugin --profile desktop add https://github.com/jiaxusummer/dsh-window-memory
```

桌面版默认没有 `dsh` 命令，这时用插件页的「添加插件」：选本仓库目录，或从插件市场
（条目见 `market/awesome-dsh-plugin.yml`）安装。本地开发也可以直接当 bundle 装：

```sh
dsh plugin --profile desktop add link:C:\path\to\dsh-window-memory
```

装完重启 DSH，在 **设置 → 窗口记忆** 里用。

## 设置页

**设置 → 窗口记忆**（和「应用图标」是同一套设置页样式）：

- **当前状态**：当前窗口是最大化还是普通窗口、尺寸多少；上次记录的是什么、记录时间；
  状态文件在哪；最近一次操作的结果。
- **记忆哪些内容**：三个勾选项——`启用窗口记忆`、`记住最大化`、`记住尺寸与位置`。
- **动手试试**：`记住当前窗口`（立刻把当前样子记下来）、`立即还原`（把记录直接套到
  当前窗口，不用重启）、`清除记录`。
- 面板打开时取一次状态；之后每次操作都会重新拉取，也可以点「刷新」手动更新。

勾选改动立即生效：`启用` 取消勾选后既不还原也不记录（但仍在监听，重新勾上就继续记）。
`记住最大化` / `记住尺寸与位置` 只在**下次启动**或按「立即还原」时起作用。

## 它做什么

- 窗口尺寸、位置或最大化状态一变，就记下来（1.5 秒检查一次，拖动时防抖，静止时不写盘）。
- 下次启动时，窗口一旦出现就恢复成上次的样子（启动阶段每 0.15 秒检查一次）。
- 退出前再记一次最终值，所以"调完窗口马上关"也能被记住。
- 最大化状态下窗口被最小化再退出，仍然记成最大化（读 `WPF_RESTORETOMAXIMIZED`）。
- 状态文件：`$DSH_HOME/window-state.json`（默认 `~/.dsh/window-state.json`），
  与旧版 `dsh-window-state` 格式相同，换插件不会丢已记住的状态。

## 配置

界面上的勾选保存在 `$DSH_HOME/window-memory.json`。`cordis.patch.yml` 里的 `config`
是**初始默认值**（界面没存过的时候用它）；要改默认值就在 profile 的
`cordis.patch.yml` 末尾加一条同 id 的覆盖（loader 会用这条替换整行 `config`）：

```yaml
- id: dsh-window-memory
  config:
    enabled: true
    restoreMaximized: true
    restoreSizePosition: false
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。关掉后既不还原也不记录。 |
| `restoreMaximized` | `true` | 记住并还原最大化状态。 |
| `restoreSizePosition` | `true` | 记住并还原窗口尺寸与位置。 |

配置值按宽松规则解析（`false` / `no` / `off` / `0` 都算关），写错类型不会让插件出错。

## 想重置

删掉状态文件即可（设置页的「清除记录」是同一个效果）：

```powershell
Remove-Item "$env:DSH_HOME\window-state.json"
```

## 为什么这么快

DSH 主进程自己创建窗口、自己 `show()`，窗口尺寸 1280×820 硬编码在 `app.asar` 里，
插件只能在窗口出现之后改。旧版每 2 秒检查一次，所以最多要等 2 秒才跳到目标状态；
本插件在启动阶段每 0.15 秒检查一次，窗口一出现就套用（实测从插件就绪到窗口最大化
约 167 毫秒），还原完再降回 1.5 秒一轮。

## 安全边界

- 只操作**宿主自己进程**的窗口：窗口所属进程的可执行文件必须与插件进程的
  `process.execPath` 完全一致；写窗口前会再校验一次（句柄可能被系统复用）。
- 只认 Electron 的主窗口类 `Chrome_WidgetWin_1`，且必须有最大化按钮——欢迎页、
  更新弹窗这类不可最大化窗口不会被误当成主窗口。
- 设置页接口只接受本机页面（`127.0.0.1`/`localhost`，且要求本插件的请求头）。
- 绝不跨进程把最大化窗口拉回普通态（这条路径在 Windows 上可能把调用方挂住）；
  窗口已经是目标状态时不发任何 Win32 写调用，所以运行中重载插件是无害的。

## 平台

**仅 Windows。** 其它平台会记一条 info 日志后跳过，不报错、不影响宿主。

## 已知限制

- 窗口第一次出现时仍可能有一帧（≤0.15 秒）是默认尺寸——窗口由主进程创建，
  不改 `app.asar` 就只能做到这个程度。
- 不跟踪全屏，只记普通态与最大化。
- 强杀、崩溃或断电时，最后一次调整可能丢失（此时以轮询记录为准）。
- 不含窗口吸附/分屏逻辑，不改变 Windows 的贴靠行为。
- 「立即还原」在窗口当前是**最大化**、而记录是普通窗口时不会动手：跨进程取消最大化
  有风险，先手动把窗口还原一下再点。
- 窗口本身有一个约 1167 像素的最小高度（DSH/Chromium 自己设的）：还原更矮的尺寸时
  会被窗口顶回去，记下来的也只是实际值，所以不会越用越偏。
- 若官方桌面版将来自己实现了窗口状态持久化，本插件应卸载。

## 文件

- `index.js` 宿主半边：轮询、还原、录制，以及设置页的 HTTP 接口（`/dsh-window-memory`）。
- `client.js` 浏览器半边：设置里的「窗口记忆」页（`settings.section` 槽位）。
- `lib/win32.js` user32 封装；`lib/state.js` 状态文件读写；`lib/geometry.js` 纯几何计算。
- `market/awesome-dsh-plugin.yml` DSH 插件市场的收录条目。

## 发布

从 GitHub 分发；市场条目在 `market/awesome-dsh-plugin.yml`，把同名文件放进
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的
`data/plugins/`（文件名 `<owner>__<repo>.yml`）提 PR 即可，市场列表会自动收录。

npm 暂未发布；要发时把 `version` 改成新版本后 `npm publish`。

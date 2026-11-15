# AOSP源码路径导读-PiP小窗.md — 修订记录

> 本文是 [AOSP源码路径导读-PiP小窗.md](../在岗学习/AOSP源码路径导读-PiP小窗.md) 的修订记录，从正文移出。
> 原始文件：`新建 文本文档.md`（AI 生成的初步定位报告）

---

## 批次 4（2026-10-28）：新增自检清单 + 「时间不够读哪里」提示

**性质**：纯增补，未改动任何已有内容。

- 新增 `## 自检清单`（7 条，每条标注"不会就看第 X 节"，把清单变成导航）
- 在导读 / 结论处补一句"时间不够就只读哪两节"

> **动机**：读者反馈"抓不到重点"。长文档需要两个东西——
> **入口捷径**（时间不够读哪两节）和**可自测的出口**（自检清单）。

---

## 批次 3（2026-10-22）：补入第五部分，改造为源码阅读教训

**背景**：用户补交了原先丢弃的「第五部分：修复方案与验证」。

### 采纳判断

| 第五部分内容 | 是否采纳 | 原因 |
|---|---|---|
| 方案一：定向修复 → 落地后无效 | ❌ 不收 | 属工程迭代，教训已在"能解释≠根因"体现 |
| **方案二首次：reparent 后黑屏 → `PipTaskListener` 未支撑** | ✅ **收** | **整个案例里最值钱的源码阅读教训** |
| 方案二修正：`getTaskLeash` + `tx.reparent` 绕开 | ✅ 收（精简） | 说明"两代实现能力不对等" |
| 验证标准 / adb grep / 预期时间戳 | ❌ 不收 | 工程细节，与"读源码"无关 |
| "诚实说明"段 | ⚠️ 部分收 | 把"另一条线索（Surface 尺寸不匹配）"提炼成一句 |

### 新增/修改

| 位置 | 改动 |
|---|---|
| **第 7.6 节（新增）** | 「接口实现了，方法却没实现」——`:0` 行号技巧、四条通用教训、绕开方案、两代实现能力对比、未验证的另一条线索 |
| 第 8 节 | 五步法 → **六步法**，新增第 5 步"确认要调的方法真的被实现了" |
| 第 0 节 | "有坑可挖"一行补上第二个坑 |
| 第 11 节 | 加状态提示 + **重建命令**（用户重建分区导致 `F:\AOSP` 丢失） |

### 本轮源码核实 ✅

拉取 `pip2/phone/PipTaskListener.java` 逐行确认：

- 类声明为 `implements ShellTaskOrganizer.TaskListener` ✅
- 只 override 了 `onTaskInfoChanged` 和 `onPipTransitionStateChanged` ✅
- **确实没有 `reparentChildSurfaceToTask`** ✅ → 用户"未 override 导致继承基类抛异常"的判断成立

> 未核实项：基类里那句 `throw new IllegalStateException(...)` —— 文件较大未取，但与用户提供的堆栈吻合，采信。

### 记录但未采信的数值冲突

第五部分提到"PiP 窗口 919×520"、"视频 Surface 42.154 以 2640×1216 创建"，
批次 1 的原始报告是"小窗 668×378"、"全屏 1216×2640"。
两处数字对不上，**按用户要求（待确认项不追）不展开**，仅记录在案。

---

## 批次 2（2026-10-21）：改向为「源码路径阅读引子」

**用户要求**：这份文档只做引子，本质是**AOSP 源码路径阅读的例子**；待确认的内容可以不管。

### 改动

| 项 | 调整 |
|---|---|
| **定位** | 从「bug 定位复盘」→ **「AOSP 源码路径导读」** |
| **文件名** | `腾讯视频PiP显示不全-定位复盘.md` → `AOSP源码路径导读-PiP小窗.md` |
| **待确认项** | **全部删除**（Surface 缩放 vs 重建、空窗期时长、编号跳号、设备标签混用） |
| **证据链** | 从"证明根因"改造成"**日志 → 代码的映射表**"（读源码的技能） |
| **知识点** | 从"速查表"改成"路径上的地标" |
| **新增** | 包结构地图、完整代码路径图、关键类"认人卡片"、**三处源码注释原文**、**五步读路径法**、**三个留给读者的作业** |
| **弱化** | bug 结论压缩成第 10 节一句话 |

### 本轮补查的 AOSP 源码

在批次 1 的基础上，本轮又拉了 `PipScheduler.java`（13KB）和 `PipController.java`（26KB），新增确认：

| 新增事实 | 出处 |
|---|---|
| **pip2 受实验开关控制**：`PipUtils.isPip2ExperimentEnabled()` | `PipController` 构造函数 |
| **占位层 reparent 的那段代码与注释原文** | `PipController.onSwipePipToHomeAnimationStart()` |
| `PipScheduler.removePipAfterAnimation()` 用 `PipAlphaAnimator.FADE_OUT` | `PipScheduler` |
| **config-at-end 的 API 是 `deferConfigToTransitionEnd()`** | `PipScheduler.scheduleAnimateResizePip()` |
| `PipController` 启动时检查 `FEATURE_PICTURE_IN_PICTURE` | `PipController.create()` |
| `PipTransitionState` 三个状态：`SWIPING_TO_PIP` / `ENTERED_PIP` / `EXITED_PIP` | `PipTransitionState` |
| pip2 包内文件清单（animation/ 与 phone/ 各有哪些类） | GitHub contents API |

**仍未核实**（已在正文用 🔍 标为"作业"）：
- `PipTransition.java` 内部（`isLegacyEnter()`、两个 `startXxxAnimation`、`setAppIconContentOverlay` 的调用点）
- App → ATMS 的具体方法名

---

## 批次 1（2026-10-21）：结构整理 + 事实校对

**原始来源**：另一 AI 生成的问题定位报告（约 96 行）
**用户说明**：第五部分已被丢弃

### 一、结构性修复

| 原文问题 | 处理 |
|---|---|
| **编号跳号**：第四部分后直接第六部分，缺第五节 | 重排 |
| 四部分平铺，无层级 | 改为分层章节 |
| 设备标签混用（问题组/问题机/整编2） | 统一四类标签 |
| 知识点散在最后 | 拆成体系化 + 速查 |

### 二、AOSP 源码核实结果

对照 [aosp-mirror/platform_frameworks_base](https://github.com/aosp-mirror/platform_frameworks_base/tree/main/libs/WindowManager/Shell/src/com/android/wm/shell/pip2) 核对，**原文技术主体基本准确**：

| 原文声称 | 核实结果 |
|---|---|
| 代码在 `com.android.wm.shell.pip2` | ✅ 存在，含 `animation/`、`phone/` |
| `PipEnterAnimator` / `PipAlphaAnimator` | ✅ 真实文件 |
| `PipTransition`（pip2） | ✅ 在 `pip2/phone/` |
| `PipAppIconOverlay` | ✅ 在 `pip2/phone/` |
| `PipContentOverlay` | ✅ 是**接口**，在 `wm.shell.shared.pip` |
| `setAppIconContentOverlay(...)` | ✅ 方法存在，参数一致 |
| `mContentOverlay.attach(tx, mLeash)` | ✅ 确认 |
| config-at-end 是进 PiP 固有特性 | ✅ 源码注释原文确认 |
| fadeout 应在清除前完成 | ✅ `clearAppIconOverlay()` 注释原文确认 |

**结论：`PipContentOverlay` / `PipAppIconOverlay` 两种叫法都不是笔误**——前者接口，后者实现。原文没说清，容易让读者以为是同一个名字写错。

### 三、批次 1 发现但批次 2 已按用户要求删掉的待确认项

| # | 问题 |
|---|---|
| 1 | Surface 是"缩放"还是"销毁重建"（原文两处说法冲突） |
| 2 | 空窗期时长"约 1 秒多" vs "约 3.3s" |
| 3 | `isLegacyEnter()` 分支仅埋点结论，未核源码（批次 2 改成"作业"保留） |
| 4 | 编号缺第五节 |
| 5 | 设备标签混用 |

> 第 3 条以"留作业"的形式保留在正文第 7 节，其余按用户要求不再追究。

### 四、原文保留未改的内容

- 现象描述与复现路径
- 三组设备对照
- 根因结论（占位层存活时间太短）
- 四类证据的原始数据（层栈时间差、animator 计数、输入对齐、时间线数值）
- 责任归属判断（系统侧）

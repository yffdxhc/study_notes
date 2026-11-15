# Edge-to-Edge 与 Insets：应用顶部间距为什么变大

> 用途：搞清「应用内容顶部该留多少白、由谁留」。这是 **框架和应用的职责边界** 问题——edge-to-edge 之后边界变了，很多间距问题都从这里长出来。
> 挂载：[Android-Framework-地图](../android学习/Android-Framework-地图.md) → **WMS（窗口 / Insets / DisplayPolicy）** + PMS（targetSdk 判定）
> 脱敏说明：文中用「应用 A / 应用 B」代指具体应用，不写包名白名单，不贴公司 patch 原文。

---

## 0. 30 秒导读

| 一句话 | 在哪节 |
|---|---|
| Android 15 起对 `targetSdk ≥ 35` **强制 edge-to-edge**：框架不再替应用消费系统栏 insets | 二 |
| 应用只有**两种**正确适配：① 监听 insets 自己加 padding ② 布局顶到状态栏下 | 二 |
| 顶部间距异常只有**两种成因**：框架多补了 margin / 应用自己又避让了一次 | 五 |
| 判定第一步：**这个应用监听不监听 insets** | 五 |
| 状态栏的**完整物理高度**要用 `InsetsSource.getFrame()`，不是 `WindowInsets.getInsets()` | 四 |

> **时间不够只读第二节（edge-to-edge 是什么）和第五节（怎么判成因）。**

---

## 一、问题长什么样

某个厂商定制开关（"隐藏前置摄像头"）打开后，部分应用**一级界面的顶部菜单栏离状态栏过远**。

两个应用表现相似，但**根因完全不同**：

| 应用 | 表面现象 | 实际成因 |
|---|---|---|
| **应用 A** | 顶部间距变大 | 框架**多补**了 margin，应用没做任何避让 |
| **应用 B** | 顶部间距变大 | 应用自己也会避让，**两次叠加** |

> **同一个现象，两个根因——这就是为什么"先分类再修"比"直接改"重要。**

---

## 二、AOSP 背景一：edge-to-edge 强制

### 2.1 规则变了

| | Android 15 之前 | **Android 15 起（`targetSdk ≥ 35`）** |
|---|---|---|
| 谁负责避让系统栏 | **框架**（帮你留白） | **应用**（框架不管了） |
| 窗口布局 | 默认不延伸到状态栏下 | **必须延伸到状态栏下**（edge-to-edge） |
| `fitsSystemWindows` | 自动留出状态栏空间 | **不再自动留白** |
| 框架是否消费系统栏 insets | 是 | **否** |

**"消费（consume）"是什么意思**：insets 是"系统栏占了多宽"的信息。谁"消费"它，谁就负责让出这块空间。

> 以前框架消费 → 框架给内容加 margin → 应用什么都不用做。
> 现在框架不消费 → 应用必须自己处理。

### 2.2 应用只剩两种正确做法

| 做法 | 具体做什么 | 特点 |
|---|---|---|
| **① 监听 insets 主动避让** | 监听状态栏 insets，给顶部内容加 padding/margin | 灵活，可做沉浸式 |
| **② 布局顶到状态栏之下** | 内容延伸到状态栏区域，状态栏透明叠加 | 沉浸式观感，**但必须自己保证内容不被挡住** |

**两种做法互斥**——选了一种就不能再让框架帮你避让，否则就是重复避让。

### 2.3 edge-to-edge 是否被强制，从哪看

| 位置 | 说明 |
|---|---|
| `Window.mEdgeToEdgeEnforced` | 窗口级标志：这个窗口是否被强制 edge-to-edge |
| `PhoneWindow.generateLayout()` 里的 `isEdgeToEdgeEnforced(appInfo, …)` | 计算处：按 `targetSdk` 等条件判定 |

> **这个标志是判断"应用该不该自己避让"的第一依据。**

---

## 三、AOSP 背景二：insets 怎么落到应用上

### 3.1 核心方法：`DecorView.updateColorViews()`

位置：`frameworks/base/core/java/com/android/internal/policy/DecorView.java`

这是**系统栏 insets 落到应用内容上的关键路径**，共四步：

```
① 算 consumingTypes —— 哪些 insets 类型由框架消费
      （依据：窗口属性 fullscreen / requestedVisibleTypes / forceConsumingTypes …）
                    ↓
② 从 mLastInsets 取出 consumedInsets
                    ↓
③ 把 consumedInsets 设置到 mContentRoot 的 margin
      （lp.topMargin = consumedInsets.top …  ← 内容整体内缩，实现"避让"）
                    ↓
④ 剩余 insets 继续向下分发
      （insets.inset(consumedInsets)  ← 应用最终收到的就是这部分）
```

### 3.2 关键推论

> **强制 edge-to-edge 的窗口，状态栏不在 `consumingTypes` 里 → `consumedInsets.top` 本应为 0。**
> 也就是说，**框架本来不该给这类应用留顶部白**。

**所以一旦发现这类应用顶部多了一块白**，就要怀疑：**谁往 margin 里多加了东西**。

### 3.3 改 margin 和改 insets 分发的区别（重要）

| 改哪里 | 影响 |
|---|---|
| **只改 `mContentRoot` 的 margin** | 只动框架自己的留白，**应用收到的 insets 不变** |
| 改 `insets.inset(...)` 的消费量 | **会改变应用收到的 insets**，影响应用自己的避让逻辑 |

> **想"只修显示、不干扰应用"就改 margin；想整体改变避让规则才碰 insets 分发。**

---

## 四、AOSP 背景三：InsetsController 与 InsetsSource

### 4.1 两组对象

| 对象 | 从哪拿 | 是什么 |
|---|---|---|
| **`InsetsState`** | `ViewRootImpl.getInsetsController().getState()` | 当前窗口**所有 insets source 的快照**（状态栏、导航栏、刘海、IME…） |
| **`InsetsSource`** | `insetsState.findSourceByType(WindowInsets.Type.statusBars())` | 某一种 insets 的**源信息**（含它实际占的区域） |

### 4.2 `getFrame()` 和 `getInsets()` 的区别（这一讲最容易混的点）

| 取法 | 返回什么 | 用在哪 |
|---|---|---|
| `WindowInsets.getInsets(Type.statusBars())` | **需要避让的量**（可能为 0） | 应用做避让 |
| **`InsetsSource.getFrame()`** | **该 source 在窗口坐标系里的实际占用区域** | **要"整体移动一个状态栏高度"这类操作** |

> **`getFrame().height()` 才是状态栏的完整物理高度**（含刘海/挖孔区域）。
> `getInsets()` 在 edge-to-edge 场景下可能是 0——**拿它算移动量会算出 0**。

**这是排查间距问题时最容易搞错的一处。**

---

## 五、怎么判成因（② 怎么定位）

### 5.1 判据表

| 成因 | 前提 | 表现 | 修在哪 |
|---|---|---|---|
| **框架多补 margin** | 应用**不监听** insets、布局顶到状态栏下 | 框架补了 → 应用又不会自己减 → 间距过大 | **框架侧**（`DecorView.updateColorViews`）把多补的减掉 |
| **应用双重避让** | 应用**监听** insets 并主动避让 | 框架补一次 + 应用避让一次 → 叠加 | **从源头**：该场景下不启用 edge-to-edge |
| 正常 | — | 间距正常 | 不用改 |

### 5.2 定位顺序

| 步 | 做什么 | 判据 |
|---|---|---|
| 1 | **先看应用监听不监听 insets** | 看应用有无 `setOnApplyWindowInsetsListener` / 布局有无 insets 处理 |
| 2 | 不监听 → 怀疑**框架多补** | 看 `mContentRoot` 的 `topMargin` 是否被额外加过 |
| 3 | 监听 → 怀疑**双重避让** | 看应用实际收到的 insets 是否和框架留白重复 |
| 4 | 确认窗口是否被**强制 edge-to-edge** | `Window.mEdgeToEdgeEnforced` |
| 5 | 确认是否处于**客制化模式**（如隐藏摄像头） | 见第六节的窗口属性 |
| 6 | 量状态栏高度用 **`InsetsSource.getFrame().height()`** | 别用 `getInsets()` |

> **核心原则：先分类（听不听 insets），再决定改框架还是改源头。**
> 用同一套修法去处理两类应用，必有一类会被改坏。

---

## 六、客制化：隐藏摄像头这个模式（③ 客制化改在哪）

### 6.1 客制化新增了什么

厂商为了支持"隐藏前置摄像头"，在 `WindowManager.LayoutParams` 上加了一个 `@hide` 定制字段，用三态描述窗口在这个场景下的全屏行为：

| 值 | 语义 | 含义 |
|---|---|---|
| `0` | `AUTOMATCH` | 默认，按系统策略自动匹配 |
| `1` | `NOTFULL` | **非全屏**：窗口不延伸到刘海/挖孔区，按避让模式布局 |
| `2` | `KEEPFULL` | 保持全屏：窗口延伸到刘海区 |

**打开"隐藏前置摄像头"后，相关窗口被置为 `NOTFULL`（=1）**——这是整个问题的第一个触发条件。

### 6.2 这个字段在各处被联动使用

| 使用点 | `NOTFULL` 时的行为 |
|---|---|
| `WindowLayout` | `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` 不生效（不参与刘海区扩展）；折叠屏/多任务下不保持全屏 |
| `DisplayPolicy.updateSystemBarsLw` | 竖屏非多窗口时，**强制状态栏不透明**（`APPEARANCE_OPAQUE_STATUS_BARS`） |
| `AppCompatLetterboxPolicy` / `WindowState` | 刘海区仍按 **letterbox（黑边）** 处理，而不是让内容铺满 |
| `SnapshotDrawerUtils` | 窗口快照绘制时透传该标志，保证截图与显示一致 |

### 6.3 回溯表（关键词 → AOSP 环节 → 客制化）

| 「关键词」 | 挂在 AOSP 哪个环节 | AOSP 标准实现 | 客制化 |
|---|---|---|---|
| `keepFullScreen` / `NOTFULL` | **刘海/挖孔模式 + 系统栏可见性** | `LayoutParams.layoutInDisplayCutoutMode` + `DisplayPolicy` 对系统栏可见性的判定 | **新增一个三态字段来编码"隐藏摄像头"** |
| `mEdgeToEdgeEnforced` | **targetSdk 驱动的 edge-to-edge 强制** | `PhoneWindow.isEdgeToEdgeEnforced()` | 无改动（AOSP 原生） |
| `updateColorViews` 里的 `topMargin` | **系统栏 insets 落到内容上** | `DecorView.updateColorViews()` 的 `consumedInsets` → `mContentRoot` margin | 客制化在**这个环节后**多补/少补了 margin |
| `InsetsSource.getFrame()` | **insets 源的实际占用区域** | `InsetsController.State` / `InsetsSource` | 无改动（AOSP 原生） |

> **关键判断**：这一整套里，**只有 `keepFullScreen` 是客制化新加的**；
> `mEdgeToEdgeEnforced`、`updateColorViews`、`InsetsSource` **全是 AOSP 原生**——
> 也就是说**这个问题的 90% 是 AOSP 知识，在家完全能学**。

### 6.4 客制化带来的工程代价（值得记住）

| 代价 | 说明 |
|---|---|
| **白名单式修补不可扩展** | 只对单个应用生效；其他"不监听 insets 的 edge-to-edge 应用"同样会出问题，要么逐个加白名单，要么推动应用自己适配 |
| **改动事后被 revert** | 这类"框架层打补丁"的方案容易被回退；重新引入前必须确认回退原因（是否影响其他隐藏摄像头场景、应用是否已自行适配） |
| **与 AOSP 语义漂移** | `NOTFULL` 让"刘海模式"和"系统栏不透明度"耦合在一起，AOSP 里这两个本来是独立的 |

---

## 七、自检清单

> **用法**：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能说出 Android 15 起 edge-to-edge 的**变化本质**（谁消费 insets） → 二
- [ ] 能列出应用**两种**正确的适配方式，并说出为什么互斥 → 2.2
- [ ] 能背出 `DecorView.updateColorViews` 的**四步**流程 → 3.1
- [ ] 能解释"强制 edge-to-edge 时 `consumedInsets.top` 本应为 0" → 3.2
- [ ] 能说清 **改 margin vs 改 insets 分发** 的区别 → 3.3
- [ ] 能说出 `getFrame()` 和 `getInsets()` 的区别，以及为什么移动量要用前者 → 4.2
- [ ] 能按判据表区分「框架多补」和「双重避让」，并说出各自修在哪 → 5.1
- [ ] 能把 `keepFullScreen` 这个客制化字段**回溯到 AOSP 的哪个环节** → 6.3
- [ ] 能说出白名单式修补的**三个代价** → 6.4

---

## 附：一句话记忆

> **edge-to-edge 的本质是"职责转移"：框架不再替应用消费系统栏 insets，应用必须自己避让。**
>
> **间距异常的两种成因：框架多补（应用不监听）／双重避让（应用监听）。先分类，再修。**
>
> **量状态栏高度用 `InsetsSource.getFrame()`，不是 `getInsets()`——edge-to-edge 下后者可能是 0。**

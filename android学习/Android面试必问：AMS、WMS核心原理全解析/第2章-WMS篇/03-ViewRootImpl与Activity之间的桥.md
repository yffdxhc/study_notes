# 03 [ViewRootImpl](../../../辅助稿/术语表.md#viewrootimpl) 与 Activity 之间的桥

> **逐字稿**：`C:\Users\18369\Documents\ZhuangFengYuan\Android面试必问：AMS、WMS核心原理全解析\Android面试必问_AMS、WMS核心原理全解析 - P9 3.viewRootImpl 与Activty之间的桥 Window是怎么搭建起来的_.doc`
> 上一讲：[02 Window 到底在哪个生命周期创建](02-Window在哪个生命周期创建.md)｜下一讲：[04 onResume 里能度量 View 宽高吗](04-onResume中能否度量View宽高.md)
> 导读：[00 导读与规范](../00-导读与规范.md)
> **值得回看**：老师顺着 `setView` 往下点，指出 `mWindowSession` **本身就是一个 [Binder](../../../辅助稿/术语表.md#binder)**，"把 WindowState 交给 SurfaceFlinger"那一下

---

## 这一讲讲什么

上一讲走到 `ViewRootImpl.setView()` 就停了。这一讲回答：**`ViewRootImpl` 怎么把窗口真正交给系统（WMS）？**

**一句话**：`setView` → 触发 traversal → **`performTraversals` 里通过 `mWindowSession`（Binder）把窗口信息交给 WMS** → WMS 生成 `WindowState` → 交给 **SurfaceFlinger** 合成。

---

## 一、`setView()` 之后发生了什么

| 步 | 做什么 | 现场看（行号直达） |
|---|---|---|
| ① | `setView()` 建立连接、触发一次遍历 | [ViewRootImpl.java:1489 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=1489) |
| ② | `requestLayout()` → `scheduleTraversals()` 安排"三大流程" | [ViewRootImpl.java:2980 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=2980) |
| ③ | `performTraversals()` 总调度（measure/layout/draw 都在这驱动） | [ViewRootImpl.java:3454 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=3454) |
| ④ | **`relayoutWindow()`** —— 准备跨进程 | [ViewRootImpl.java:9367 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=9367) |
| ⑤ | **`mWindowSession.relayout(...)`** —— 这里跨进程了（Binder） | [Session.java:278 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/wm/Session.java;l=278) |
| ⑥ | WMS 创建/更新 `WindowState` | [WindowState.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/wm/WindowState.java) |

| 概念 | 是什么 |
|---|---|
| **`mWindowSession`** | **`IWindowSession` 的 Binder 代理** —— 老师强调"它就是个 Binder" |
| **`Session`** | WMS 进程里对应的服务端对象 |
| **`WindowState`** | WMS 里代表"一个窗口"的对象（和 [AMS](../../../辅助稿/术语表.md#ams-atm) 里的 `ActivityRecord` 地位类似） |

---

## 二、跨进程之后：WMS → SurfaceFlinger

```
WMS（生成 WindowState，用 token 标记）
   ↓
SurfaceFlinger（合成）
   ↓ 内部有一层层缓存
Skia / OpenGL ES 渲染
   ↓
屏幕
```

**两个要点**：

| 要点 | 说明 |
|---|---|
| **token 也是 Binder** | WMS 用它标识"这个窗口是谁的"（和 Activity 对应） |
| **SurfaceFlinger 负责"合成"** | 把多个窗口的图层合成一帧；里面有缓存机制 |

> 老师说这块（WMS → SurfaceFlinger → 渲染）**要讲三节课**，这一讲只点到"交给谁"。

---

## 三、为什么说 `ViewRootImpl` 才是"桥"

回看整条链路，`Activity` / `Window` 都在"上层"，**真正跨到系统服务的那一下发生在 `ViewRootImpl`**：

| 层 | 职责 | 跨进程？ |
|---|---|---|
| `Activity` | 管生命周期 | ❌ |
| `PhoneWindow` / `DecorView` | 装视图树 | ❌ |
| **`ViewRootImpl`** | **调度三大流程 + 通过 `mWindowSession` 和 WMS 通信** | ✅ **就是它** |
| `WindowManagerService` | 窗口管理（层级、焦点、token） | — |
| `SurfaceFlinger` | 图层合成 | — |

> **所以它是"桥"**：上面接应用，下面接 WMS。

---

## 四、整条 UI 链路（把第 1~3 讲串起来）

```
① Activity.attach()            → new PhoneWindow()          【Window 诞生】
② onCreate → setContentView    → 解析 XML，建视图树          【View 诞生】
③ onResume → handleResumeActivity
       → activity.makeVisible()
       → wm.addView(decor)     → WindowManagerImpl
                               → WindowManagerGlobal
                               → new ViewRootImpl           【桥 诞生】
④ ViewRootImpl.setView()
       → requestLayout → scheduleTraversals → performTraversals
       → relayoutWindow → mWindowSession.relayout(Binder)   【跨进程】
⑤ WMS：生成 WindowState
⑥ SurfaceFlinger：合成 → 屏幕                             【上屏】
```

> **"Window 是怎么搭建起来的"** —— 就是这条链，**每一环都缺一不可**。

---

## 易错点

| 易错点 | 正确理解 |
|---|---|
| 以为 `ViewRootImpl` 只是"根 View" | 它是**调度器 + 与 WMS 通信的桥** |
| 以为 `ViewRootImpl.setView` 直接调 WMS | 中间经 **`mWindowSession`（Binder）** |
| 以为 `WindowState` 是应用侧对象 | 它是 **WMS 进程里**的窗口代表 |
| 以为窗口一创建就能显示 | 还要 WMS 分配 + SurfaceFlinger 合成 |
| 把 token 当普通 ID | token **本身是 Binder**，用来标识窗口归属 |

---

## 自检清单

> 用法：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能说出 `setView` 之后触发的**遍历入口**（`scheduleTraversals` / `performTraversals`） → 一
- [ ] 能说出 `mWindowSession` 是什么，以及它负责跨进程出去 → 一
- [ ] 能说出 `WindowState` 是谁的什么对象 → 一
- [ ] 能说出 WMS 之后把活交给谁（`SurfaceFlinger`） → 二
- [ ] 能解释为什么 `ViewRootImpl` 被称为"桥" → 三
- [ ] 能默画出 ①~⑥ 的完整 UI 链路 → 四

---

## 一句话记忆

> **`ViewRootImpl.setView` → `scheduleTraversals` → `performTraversals` → `relayoutWindow` → `mWindowSession.relayout`（Binder）→ WMS 生成 `WindowState` → SurfaceFlinger 合成上屏。**
>
> **上层都在应用进程里自娱自乐，真正跨到系统的那一刀切在 `ViewRootImpl` —— 所以它是桥。**

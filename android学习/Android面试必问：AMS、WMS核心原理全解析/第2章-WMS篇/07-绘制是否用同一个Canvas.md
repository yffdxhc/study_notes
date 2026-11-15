# 07 绘制用的是同一个 [Canvas](../00-术语表.md#surface-canvas) 吗

> **逐字稿**：`C:\Users\18369\Documents\ZhuangFengYuan\Android面试必问：AMS、WMS核心原理全解析\Android面试必问_AMS、WMS核心原理全解析 - P13 7.View 的绘制过程中用的是同一个canvas吗_.doc`
> 上一讲：[06 Handler 如何消化 UI 刷新消息](06-Handler如何消化UI刷新消息.md)
> 导读：[00 导读与规范](../00-导读与规范.md)
> **值得回看**：老师从 `performDraw` 一路点到 `Surface.lockCanvas()` **拿到第一个 Canvas**，再点进 `View.draw` → `dispatchDraw` 验证"同一个传下去"
> ⚠️ **文稿口误**：`Canvas` → 「con / cone / commerce / 康」；`Surface` → 「说服 / 是 face / service」；`draw` → 「旧 / 就 / j」；`dispatchDraw` → 「dis page」

---

## 这一讲讲什么

**一道看着简单、但能牵出一整条绘制链的题**：

> **View 的绘制过程中，用的是同一个 Canvas 吗？**

**答案：是同一个。** 从一个 `Surface` 上 `lockCanvas()` 拿到，然后**沿 View 树一路传下去**。

---

## 一、验证链路（怎么证明是同一个）

### 源码落点

| 环节 | 方法 | 现场看 |
|---|---|---|
| 触发绘制 | `ViewRootImpl.performTraversals()` → `performDraw()` | [ViewRootImpl.java:3454 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=3454) |
| **拿到第一个 Canvas** | `drawSoftware()` 里 `mSurface.lockCanvas(dirty)` | [ViewRootImpl.java:5811 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=5811) ｜ [Surface.java:547 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/Surface.java;l=547) |
| 画根 View | `View.draw(canvas)`（背景 → onDraw → 分发） | [View.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/View.java) |
| **同一个 canvas 传给孩子** | `ViewGroup.dispatchDraw(canvas)` | [ViewGroup.java:4253 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewGroup.java;l=4253) |

> 原 ASCII 结构图已移除（中英混排容易错位），结构见本讲的图或下方表格。

> **"同一个"的证据就在第 ③ 步**：`dispatchDraw(canvas)` 传下去的是**同一个对象引用**，从头到尾没有新建过 `Canvas`。

---

## 二、所以绘制的顺序是固定的

| 顺序 | 做什么 | 说明 |
|---|---|---|
| **①** | **画背景** | `drawBackground(canvas)` —— **永远第一步** |
| **②** | 画自己 | `onDraw(canvas)` |
| **③** | 分发给子 View | `dispatchDraw(canvas)` |

### 2.1 一个"没有 onDraw"的例子

> **`FrameLayout` 没有 `onDraw`**（只有 `onMeasure` / `onLayout`），因为它自己**不需要画内容**，只负责摆孩子。

**但它仍然会有背景** —— 这解释了：

> **数据还没加载完时看到的那个"空白界面"，就是先画出来的背景。** 数据到了再一层层往上加。

---

## 三、"同一个 Canvas"带来两个必须遵守的后果

| 后果 | 说明 |
|---|---|
| **`canvas.save()` / `restore()` 必须配对** | 因为大家都在同一块画布上操作状态（平移/旋转/裁剪），**你不还原，后面的 View 就跟着歪** |
| **`lockCanvas()` / `unlockCanvasAndPost()` 必须配对** | 锁住的是**这块 [Surface](../00-术语表.md#surface-canvas) 的绘制缓冲区**，不解锁画面就出不来 |

> 这也是自定义 View 里最常见的两个 bug 来源。

---

## 四、⚠️ 一处需要澄清的说法（面试别说错）

老师口述里说过："**整个 App 里所有的 Canvas 都来自同一个 Surface**。"

**更准确的说法是**：

| 说法 | 准确性 |
|---|---|
| 同一个**窗口**（Window）内的所有 View，共享**同一个 Canvas** | ✅ **对** |
| 一个 App 只有**一个** Surface / Canvas | ❌ **不对** |

**正确理解**：

```
每个 Window → 对应一个 ViewRootImpl → 持有自己的一个 Surface → lockCanvas 得到自己的 Canvas
```

> 所以多窗口（多 Activity 同时可见、Dialog、悬浮窗）就**有多个 Surface**。
> **"同一个"这个结论限定在"同一个窗口的 View 树"范围内。**

---

## 五、把第 2 章串起来（整条链收口）

> 原 ASCII 结构图已移除（中英混排容易错位），结构见本讲的图或下方表格。

---

## 易错点

| 易错点 | 正确理解 |
|---|---|
| 以为每个 View 有自己的 Canvas | **同一个窗口内共享同一个** |
| 以为 `onDraw` 一定先于背景 | **背景先画**（`drawBackground` 是第一步） |
| 以为 `FrameLayout` 会 `onDraw` | 它**没有** `onDraw`，但有背景 |
| 自定义 View 里 `save()` 不 `restore()` | 同一块画布，**会污染后续绘制** |
| 说"整个 App 只有一个 Surface" | **每个窗口一个**；同一窗口内共享 Canvas |

---

## 自检清单

> 用法：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能直接回答"是不是同一个 Canvas" → 这一讲讲什么
- [ ] 能背出 Canvas 是**从哪拿到的**（`Surface.lockCanvas`） → 一
- [ ] 能说出 `dispatchDraw` 传下去的是同一个对象 → 一
- [ ] 能说出绘制的**三步顺序**（背景 → onDraw → dispatchDraw） → 二
- [ ] 能解释 `FrameLayout` 为什么没有 `onDraw` 还有背景 → 2.1
- [ ] 能说出"同一个 Canvas"带来的两个配对要求 → 三
- [ ] 能纠正"整个 App 一个 Surface"这个说法 → 四

---

## 一句话记忆

> **同一个窗口内，所有 View 用的是同一个 Canvas：`Surface.lockCanvas()` 拿出一个，`View.draw` → `dispatchDraw` 一路传下去。**
>
> **绘制顺序固定：先画背景 → 再 `onDraw` → 再 `dispatchDraw` 给孩子。**
>
> **因为共用一块画布：`save/restore` 要配对，`lockCanvas/unlockCanvasAndPost` 也要配对。**

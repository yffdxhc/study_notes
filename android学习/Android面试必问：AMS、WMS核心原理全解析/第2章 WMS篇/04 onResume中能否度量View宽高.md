# 04 onResume 里能度量 View 宽高吗

> **逐字稿**：`C:\Users\18369\Documents\ZhuangFengYuan\Android面试必问：AMS、WMS核心原理全解析\Android面试必问_AMS、WMS核心原理全解析 - P10 4.在onResume函数中可以度量view的宽高吗_.doc`
> 上一讲：[03 ViewRootImpl 与 Activity 之间的桥](03 ViewRootImpl与Activity之间的桥.md)｜下一讲：[05 子线程能更新 UI 吗](05 子线程更新UI.md)
> 导读：[00 导读与规范](../00 导读与规范.md)
> **值得回看**：老师现场在 `onResume` 里打印 `decorView.getWidth()`，**控制台输出 0**，然后立刻反问"为什么是 0"
> ⚠️ **文稿口误**：`decorView` → 「特色view / 退出view / test view」；`getWidth` → 「get y / get wet」；`onResume` → 「only soon / on res ho」

---

## 这一讲讲什么

**一道看起来很简单、但答案不是"能"或"不能"的题。**

> **在 `onResume` 里能拿到 View 的宽高吗？**

**结论：第一次启动时拿不到（是 0）；但从别的页面返回时有值。**

**准确的说法是：不确定。** 这一讲用一次实验 + 一条时序把原因讲透。

---

## 一、实验：`onResume` 里打印宽高

```java
@Override
protected void onResume() {
    super.onResume();
    Log.d("TAG", "width = " + decorView.getWidth());   // 第一次启动：0
}
```

**输出：0。**

> 老师当场演示，让学生自己看到 0，再问"为什么"。

---

## 二、为什么是 0：时序问题

### 2.1 `onResume` 在"绑定窗口"**之前**

```
ActivityThread.handleResumeActivity()
   ↓
performResumeActivity()
   ↓
activity.performResume()
   ↓
【回调】activity.onResume()          ★ 你现在在这里
   ↓  ← 注意：onResume 回调【返回之后】
activity.makeVisible()
   ↓
wm.addView(decorView, ...)           ★ WindowManager 和 DecorView 才绑定
   ↓
ViewRootImpl 建立 → 三大流程开始
   ↓
measure → layout → draw              ★ 这才有宽高
```

**关键在 `makeVisible()`**：

| 位置 | 状态 |
|---|---|
| 在 `onResume` **内** | `WindowManager` 与 `DecorView` **还没绑定** |
| `onResume` **返回后**，`makeVisible()` 执行 | 才 `addView` 绑定 |
| 绑定后 | 才开始 measure/layout/draw |

### 2.2 逻辑推演（老师的链条）

> **要刷新 UI，得先有 UI** → 现在 `WindowManager` 管理的对象还没绑定 → **谈不上刷新**
> → **度量只是绘制过程中的一小步** → 连绘制都没开始 → **哪来的度量**
> → 没有度量 → **自然没有宽高**

---

## 三、那为什么"从别的页面返回"就有值了

因为**之前已经完整走过一次** measure/layout/draw：

| 场景 | onResume 里能拿到宽高吗 |
|---|---|
| **第一次启动**（全新页面） | ❌ **0** |
| 从 B 页面**返回** A 页面 | ✅ **有值**（A 之前已经量过了） |

> **所以答案不是"能"或"不能"，而是"看这次 `onResume` 之前有没有量过"。**

---

## 四、这个现象还能解释另一个常见困惑

> **在 `onMeasure` / `onLayout` 里调 `getWidth()`，有时有值有时没有。**

老师点出：**同一个根因** —— 取决于**当前处在第几次遍历、走到哪一步了**。

| 现象 | 原因 |
|---|---|
| `onResume` 里第一次是 0 | 还没绑定窗口、没遍历 |
| 返回时又有值 | 已经量过 |
| `onMeasure` 里 `getWidth()` 不稳定 | 测量/布局本身还在进行中，值来自上一轮 |

**这也正是"布局里取宽高要 post / doOnLayout"的由来**（实践结论，非本讲原文）。

---

## 五、那要怎么正确拿宽高

> 下面是对应解法（**不是本讲原文**，按同一原理推导）：

| 做法 | 为什么可行 |
|---|---|
| **`view.post { }`** | 消息排到遍历之后执行 |
| **`doOnLayout` / `addOnLayoutChangeListener`** | 布局完成后回调 |
| **`ViewTreeObserver.OnGlobalLayoutListener`** | 布局/全局布局完成时通知 |
| **`onWindowFocusChanged`** | 窗口已获得焦点，通常已量完 |

> **共同点：都等到"绑定 + 遍历"之后的时机。**

---

## 源码落点（行号直达）

| 环节 | 方法 | 位置 |
|---|---|---|
| 驱动 onResume | `ActivityThread.handleResumeActivity()` | [ActivityThread.java:5513 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/app/ActivityThread.java;l=5513) |
| **onResume 之后才执行** | `Activity.makeVisible()` → `wm.addView(...)` | [Activity.java:7307 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/app/Activity.java;l=7307) |
| 正确取宽高的姿势 | `View.post(Runnable)` | [View.java:21316 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/View.java;l=21316) |

> 验证方法：在 `handleResumeActivity` 里看**两行的先后** —— `performResumeActivity(...)`（内部回调 `onResume`）在前，`makeVisible()` 在后。你写代码的位置就在前者的回调里。

---

## 易错点

| 易错点 | 正确理解 |
|---|---|
| 直接答"不能" | 准确说法是**不确定**：第一次 0，返回时有值 |
| 以为 `onResume` 时窗口已添加 | `addView` 发生在 `onResume` **之后的 `makeVisible()`** 里 |
| 以为度量是独立的一步 | 度量是**绘制流程中的一小步** |
| 以为 `onLayout` 里 `getWidth` 一定准 | 取决于遍历阶段，可能拿到上一轮的值 |
| 在 `onCreate` 里取宽高 | 那时连 `setContentView` 都刚做完，更不可能 |

---

## 自检清单

> 用法：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能说出在 `onResume` 里第一次取宽高得到什么值 → 一
- [ ] 能说出 `onResume` 和 `makeVisible()` 的**先后顺序** → 2.1
- [ ] 能完整推导"为什么是 0"这条逻辑链 → 2.2
- [ ] 能解释为什么"从别的页面返回就有值" → 三
- [ ] 能说出这个现象和 `onMeasure` 里取宽高不稳是**同一个根因** → 四
- [ ] 能说出三种以上正确获取宽高的时机 → 五

---

## 一句话记忆

> **`onResume` 回调时，`WindowManager` 还没和 `DecorView` 绑定（那是它返回后 `makeVisible()` 干的事）→ 没遍历 → 没度量 → 宽高是 0。**
>
> **从别的页面返回有值，是因为之前已经量过。所以答案是"不确定"，不是"不能"。**

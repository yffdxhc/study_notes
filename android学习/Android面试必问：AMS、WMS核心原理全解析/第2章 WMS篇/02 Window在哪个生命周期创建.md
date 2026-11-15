# 02 Window 到底在哪个生命周期创建

> **逐字稿**：`C:\Users\18369\Documents\ZhuangFengYuan\Android面试必问：AMS、WMS核心原理全解析\Android面试必问_AMS、WMS核心原理全解析 - P8 2.window到底是在Activity哪个生命周期创建的_.doc`
> 上一讲：[01 生命周期中何时创建 Window](01 生命周期中何时创建Window.md)｜下一讲：[03 ViewRootImpl 与 Activity 之间的桥](03 ViewRootImpl与Activity之间的桥.md)
> 导读：[00 导读与规范](../00 导读与规范.md)
> **值得回看**：老师在 `handleResumeActivity` 里逐行念 `r.window = activity.getWindow()` → `wm.addView(decor, l)`，然后一路点进 `WindowManagerImpl` → `WindowManagerGlobal` → `ViewRootImpl.setView`
> ⚠️ **文稿口误**：`PhoneWindow` → 「full window / 孔温度」；`ViewRootImpl` → 「view route implement / router view / view route」；`WindowManagerGlobal` → 「window manager group / window money」；`DecorView` → 「deck view」；`Activity` → 「iktv / iqt / 挨个 tvt」

---

## 这一讲讲什么

接着上一讲的问题往下追。这一讲给出**两个精确的答案**，其中第二个会推翻很多人的直觉：

| 问题 | 答案 |
|---|---|
| **Activity 和 Window 何时建立联系** | **`attach()` 时**（`onCreate` 之前）——上一讲已答 |
| **Window 和 View 何时建立联系** | **`onResume` 的 `handleResumeActivity` 里**，靠 `wm.addView(decor, l)` |
| **`setContentView` 做了联系吗** | **❌ 没有！** |

---

## 一、澄清 ①：`attach` 之后就能拿到 Window

```java
// Activity 里随时可以
Window w = getWindow();     // 拿到的就是 attach 里 new 的那个 PhoneWindow
```

> 老师说得很直白：`getWindow()` 是**公共函数**，`attach` 阶段就 `new` 好了，所以**此时 Activity 和 Window 已经紧密绑定**。

---

## 二、澄清 ②：`setContentView` **没有**建立联系（**这一讲最重要的一点**）

### 2.1 常见误解

> "我调了 `setContentView`，XML 解析出来的 View 就和 Window 关联上了。"

### 2.2 事实

> **`setContentView` 只有一个作用：解析 XML（本质是一次"序列化"动作），生成视图树。**

**解析出来的根布局 View 和 Window 之间——没有任何调用把它们连起来。**

> 老师原话：**"哪怕是走了 `setContentView`，我们的 View 仍旧没有跟 Window 建立联系。"**

### 2.3 那 `setContentView` 之后 View 在哪

它只是被**挂到了 `DecorView` 的 `ContentView` 容器里** —— 而 `DecorView` 本身**还悬在空中**，没有被添加到窗口系统。

> 原 ASCII 结构图已移除（中英混排容易错位），结构见本讲的图或下方表格。

---

## 三、真正的连接点：`handleResumeActivity`

### 3.1 是 `onResume`，不是 `onStart`

```
ActivityThread.handleResumeActivity()
   ↓
performResumeActivity()          ← 这里回调 activity.onResume()
   ↓
【关键代码】
   if (r.window == null) r.window = r.activity.getWindow();
   ...
   View decor = r.window.getDecorView();
   wm.addView(decor, l);         // ★★★ 真正把窗口加进系统
```

| 代码 | 含义 |
|---|---|
| `r.window = activity.getWindow()` | 拿到 attach 时创建的那个 `PhoneWindow` |
| `decor = r.window.getDecorView()` | 拿到根视图 |
| **`wm.addView(decor, l)`** | **把 DecorView 添加到窗口系统** —— 这才是"建立联系" |

> **所以完整答案是：Window 对象在 `attach` 创建；Window 真正"上屏"在 `onResume`。**

### 3.2 为什么必须等 `onResume`

因为到 `onResume` 时：

- 布局已经 `setContentView` 建好了（`onCreate`）
- 资源、主题已就绪
- **此时窗口才有资格交给系统去显示**

---

## 四、`wm.addView()` 的**三级委托**（重点）

`wm` 是 `WindowManager`，但它**是个接口** —— 真正干活要往下传三层：

| 层 | 角色 | 干了什么 | 现场看 |
|---|---|---|---|
| **`WindowManager`（接口）** | 门面 | — | — |
| **`WindowManagerImpl`** | 唯一实现 | **转手**（几乎不干活） | [WindowManagerImpl.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/WindowManagerImpl.java) |
| **`WindowManagerGlobal`** | **进程内全局单例** | **创建 `ViewRootImpl`** | [WindowManagerGlobal.java:350 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/WindowManagerGlobal.java;l=350) |
| **`ViewRootImpl`** | **UI 刷新核心类** | **`setView()` 之后所有 UI 动作归它** | [ViewRootImpl.java:1489 ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewRootImpl.java;l=1489) |

> 读源码时只盯最后两行：`WindowManagerGlobal.addView()` 里的 **`new ViewRootImpl(...)`**，然后 **`root.setView(...)`**。中间几层都是纯转手。

> **这一串是什么设计模式？** 老师说是**委托/代理** —— 每一层都把活往外推，最后推到 `ViewRootImpl`。

---

## 五、`ViewRootImpl` 是 UI 的核心类

> **所有 UI 相关的动作，最终都由 `ViewRootImpl` 完成。**

| 归它管的事 | 说明 |
|---|---|
| **`setView()`** | 建立 View 树与窗口系统的连接 |
| **`scheduleTraversals()`** | 触发 measure / layout / draw（下一讲 & 第 6 讲） |
| **测量、布局、绘制** | 三大流程的调度者 |
| **触摸 / 按键事件** | 事件从这进来再分发 |
| **刷新节奏** | 60Hz ≈ 16.7ms 一次的调度也归它 |

---

## 六、类关系（老师最后收的图）

> 原 ASCII 结构图已移除（中英混排容易错位），结构见本讲的图或下方表格。

> **`Window` 是"壳"，`WindowManager` 是"桥"，`ViewRootImpl` 才是"发动机"。**

---

## 七、顺着这个逻辑看 Flutter（老师的延伸，一句话）

> `Activity` 管生命周期、`Window` 几乎不干活、最后全靠 `ViewRootImpl` 绘制 —— 这套体系很庞大。
>
> 所以 Flutter / Compose 干脆**不要 Activity/Window 这一层**，直接做"声明式 UI"（`Widget`），底层仍然是同一个渲染引擎（Skia）。

---

## 易错点

| 易错点 | 正确理解 |
|---|---|
| 以为 `setContentView` 就把 View 挂到 Window 了 | **没有**；它只解析 XML 建视图树 |
| 以为 `onStart` 就 addView | 是 **`onResume`** 的 `handleResumeActivity` |
| 以为 `Window` 是干活的 | **`Window` 几乎不干活**，活都推给 `ViewRootImpl` |
| 以为 `WindowManager` 直接创建窗口 | 它只是**桥**：Impl → Global → ViewRootImpl |
| 以为每个 Activity 一个 `WindowManagerGlobal` | **整个进程只有一个** |
| 以为 `Activity` 能直接画 UI | Activity **不具备 UI 功能**，只负责生命周期调度 |

---

## 自检清单

> 用法：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能说出 Activity 与 Window 绑定的**确切位置**（`attach`） → 一
- [ ] 能说清 `setContentView` **到底做了什么、没做什么** → 二
- [ ] 能说出 Window 与 View 真正建立联系的**方法名和生命周期** → 3.1
- [ ] 能背出 `wm.addView` 的**三级委托链** → 四
- [ ] 能说出为什么 `WindowManagerGlobal` 是"全局唯一" → 四
- [ ] 能列出 `ViewRootImpl` 管的**至少四件事** → 五
- [ ] 能画出 Activity → PhoneWindow → ViewRootImpl 的类关系 → 六

---

## 一句话记忆

> **`attach` 时 new `PhoneWindow`（Window 有了）→ `setContentView` 解析 XML（View 有了，但**还没连**）→ `onResume` 的 `handleResumeActivity` 里 `wm.addView(decor)`（**这才连上**）。**
>
> **委托链：`WindowManagerImpl` → `WindowManagerGlobal`（进程唯一）→ `new ViewRootImpl` → `setView()`。UI 的活全归 `ViewRootImpl`。**

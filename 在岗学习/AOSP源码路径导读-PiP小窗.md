# AOSP 源码路径导读：以 PiP 小窗显示不全为例

> 整理：2026-10-21
> **用途**：用一个大厂真实 bug 当引子，走一遍「从现象 → 代码路径 → 源码」的完整过程
> **这不是 bug 报告，是源码阅读练习。** 现象只是入口，重点是路径怎么找到的

---

## 30 秒导读

| 一句话 | 在第几节 |
|---|---|
| **现象**：腾讯视频进小窗，画面先"显示不全"再"显示全" | 0 |
| **方法**：从日志里的类名反查 → 建包地图 → 画调用链 → 读注释 → 回验 | 1~6 |
| **根因**：占位层挂在 transition leash 上，转场一结束就被销毁 | 7.5 |
| **最值钱的坑**：接口实现了但方法没实现，照搬修法直接黑屏 | **7.6** |
| **可带走的**：读一条 AOSP 路径的六步法 | **8** |

> **时间不够就只读 7.6 和 8 两节。** 其它当字典查。
> 这篇 579 行，**不是用来一口气读完的**。

---

## 0. 为什么拿这个案例当教材

选案例当"读源码"的训练材料，得满足几个条件——这个案例恰好都有：

| 条件 | 这个案例 |
|---|---|
| 路径跨层 | App → system_server → Shell → SurfaceControl → SurfaceFlinger，**四层** |
| 有日志能对上代码 | log 里直接出现类名 `PipAlphaAnimator`，可以反查 ✅ |
| 有对照组 | 一台有问题、一台没问题，能看出"应该怎样" |
| 类不太多 | 走完只要认 6 个类 |
| 有坑可挖 | ① 同一功能**两个名字**（接口 vs 实现）；② **接口实现了但方法没实现**（`PipTaskListener`），照搬修法直接黑屏 |

**一句话引子**：腾讯视频从全屏进小窗，画面先"显示不全"再"显示全"。参考机没这问题。

---

## 1. 第一步：先建包结构的地图（读 AOSP 第一招）

打开 `frameworks/base/libs/WindowManager/Shell/src/com/android/wm/shell/pip2/`，你会看到：

```
pip2/
├── PipSurfaceTransactionHelper.java   ← 共用的 SurfaceControl 操作
├── animation/                          ← 所有动画
│   ├── PipEnterAnimator.java
│   ├── PipAlphaAnimator.java
│   ├── PipExpandAnimator.java
│   └── PipResizeAnimator.java
└── phone/                              ← 手机形态的业务编排
    ├── PipController.java              ← 入口 / 对外接口
    ├── PipScheduler.java               ← 编排（scheduler）
    ├── PipTransition.java              ← 转场控制
    ├── PipTransitionState.java         ← 状态机
    ├── PipAppIconOverlay.java          ← 占位层实现
    ├── PipTouchHandler.java
    └── ...
```

加上两个兄弟包：

| 包 | 职责 |
|---|---|
| `wm.shell.common.pip` | 跨形态通用状态：`PipBoundsState`、`PipBoundsAlgorithm`、`PipDisplayLayoutState` |
| `wm.shell.shared.pip` | 跨形态共享的**接口**：`PipContentOverlay` 就在这 |
| `wm.shell.pip` | **老一代**实现（legacy pip），以及所有形态共用的基类 `PipTransitionController` |

> **第一招：包名就是职责分工表。**
> `animation/` 只管画，`phone/` 只管编排，`shared/` 放接口。
> **看懂包结构，你就省掉一半找代码的时间。**

**顺手发现的一个关键事实**：

```java
// PipController.java 构造函数里
if (PipUtils.isPip2ExperimentEnabled()) {
    shellInit.addInitCallback(this::onInit, this);
}
```

→ **pip2 是被一个实验开关控制的**。这解释了为什么"同一 Android 版本的两台机器，pip 实现可能不一样"。

---

## 2. 第二步：画出完整代码路径

下面是这条路径的四段。**✅ = 已在源码中核实；🔍 = 留给你去点开确认。**

```
① App 侧
   Activity.enterPictureInPictureMode(PictureInPictureParams)
     └─ Binder → system_server
                                🔍 具体走到 ATMS 的哪个方法，留作业

② 系统侧（system_server）
   ATMS / RootWindowContainer：把 Activity 的 Task 置为 PINNED
     └─ 发起一个 Transition
                                🔍 类型与请求参数，留作业

③ Shell 侧（SystemUI 进程）
   PipController  ── 实现 Pip / 对外暴露 IPip
     │  检查 FEATURE_PICTURE_IN_PICTURE ✅
     └─ PipScheduler ── 编排 ✅
          └─ PipTransition（继承 PipTransitionController）✅
               └─ 分支：isLegacyEnter() ?          🔍 分支细节留作业
                    ├─ false → startBoundsTypeEnterAnimation
                    │            └─ PipEnterAnimator ✅
                    └─ true  → startAlphaTypeEnterAnimation
                                 └─ PipAlphaAnimator ✅

④ 动画侧
   PipEnterAnimator extends ValueAnimator ✅
     ├─ onEnterAnimationUpdate(fraction, tx)
     │    每帧 tx.setCrop / setMatrix / setCornerRadius ✅
     └─ setAppIconContentOverlay(...)
          └─ new PipAppIconOverlay(...)  →  mContentOverlay.attach(tx, mLeash) ✅

⑤ Surface 侧
   leash (SurfaceControl) → SurfaceFlinger 合成 → 屏幕 ✅
```

**这条路径最有价值的地方**：它一路从"Java 层的动画"走到了"SurfaceFlinger 的层"。**你读完这一段，就打通了 UI 到上屏的完整链路。**

---

## 3. 六个关键类：认人卡片

读源码先"认人"。这几个类各管一段：

| 类 | 一句话职责 | 读它时重点看什么 |
|---|---|---|
| **`PipController`** | 入口。对外暴露 `Pip`（进程内）和 `IPip`（跨进程） | `onInit()` 里挂了哪些监听器；`PipImpl` / `IPipImpl` 两个内部类 |
| **`PipScheduler`** | 编排。决定"什么时候发起什么转场" | 每个 `scheduleXxx()` 方法；`PipAlphaAnimator.FADE_OUT` 用在 remove PiP |
| **`PipTransition`** | 转场控制。真正接管 `Transition` | 🔍 `isLegacyEnter()` 的两个分支 |
| **`PipEnterAnimator`** | bounds 路径的进出动画（**建占位层**） | `onEnterAnimationUpdate`、`setAppIconContentOverlay`、`clearAppIconOverlay` |
| **`PipAlphaAnimator`** | alpha 路径的淡入淡出（**不建占位层**） | `FADE_IN` / `FADE_OUT` 两个方向 |
| **`PipAppIconOverlay`** | 占位层本体（App 图标 + 纯色底） | 它 `implements PipContentOverlay` ← 关键 |

---

## 4. 第三步：读注释，找"为什么"

**这是本次阅读最大的收获：AOSP 的作者把"为什么"直接写在注释里了。**

### 注释一：占位层应该"淡出完再清"

```java
// PipEnterAnimator.java
/**
 * Clears the {@link #mContentOverlay}, this should be done after the content overlay is
 * faded out.
 */
public void clearAppIconOverlay() { ... }
```

→ **设计意图写得很清楚**：清除必须发生在淡出之后。
→ 如果别的机制提前把它干掉，就违背了这个意图。

### 注释二：为什么要把占位层 reparent

```java
// PipController.java — onSwipePipToHomeAnimationStart()
if (overlay != null) {
    // Shell transitions might use a root animation leash, which will be removed when
    // the Recents transition is finished. Launcher attaches the overlay leash to this
    // animation target leash; thus, we need to reparent it to the actual Task surface now.
    // PipTransition is responsible to fade it out and cleanup when finishing the enter PIP
    // transition.
    SurfaceControl.Transaction tx = new SurfaceControl.Transaction();
    mShellTaskOrganizer.reparentChildSurfaceToTask(taskId, overlay, tx);
    tx.setLayer(overlay, Integer.MAX_VALUE);
    tx.apply();
}
```

翻译：

> Shell 的转场可能用一个 root animation leash，**它会在 Recents 转场结束时被移除**。Launcher 把这个 overlay 的 leash 挂在了这个 animation target leash 上；**所以我们现在必须把它 reparent 到真正的 Task surface。**

→ **一句话把 bug 的根因说完了**：挂在转场上会跟着转场一起死，所以要搬到 Task 上。

### 注释三：config-at-end 是进 PiP 的固有特性

```java
// PipEnterAnimator.java — setEnterStartState()
/**
 * Since enter PiP makes use of a config-at-end transition, initial transform needs to be
 * calculated differently from generic transitions.
 */
```

→ 印证了 `PipScheduler` 里的 `wct.deferConfigToTransitionEnd(pipTaskToken)`。
→ **`config-at-end` 不是巧合，是设计。**

> **第三招：读源码先读 javadoc 和行内注释，再看逻辑。**
> 逻辑告诉你"做了什么"，注释告诉你"为什么这么做"——**后者才是你排查问题时要的。**

---

## 5. 一个差点看懵的坑：接口 vs 实现

本次阅读最容易卡住的地方：**同一个东西出现了两个名字。**

- `PipContentOverlay` —— 在 `wm.shell.shared.pip`，是个**接口**
- `PipAppIconOverlay` —— 在 `pip2.phone`，是**具体实现**，`implements PipContentOverlay`

证据：

```java
// PipEnterAnimator.java 顶部 import
import com.android.wm.shell.pip2.phone.PipAppIconOverlay;
import com.android.wm.shell.shared.pip.PipContentOverlay;
```

```java
@Nullable private PipContentOverlay mContentOverlay;   // 字段声明用接口

mContentOverlay = mPipAppIconOverlaySupplier.get(...);  // 实际 new 的是 PipAppIconOverlay
```

**为什么这么设计**：`shared` 包要跨设备形态复用（手机/平板/桌面），所以**接口放共享包，实现放形态包**。

> **第四招：看到两个像的名字，先看 import 和 implement 关键字。**
> 别急着认为是笔误——AOSP 里"接口在 shared、实现在 phone"是标准分层。

---

## 6. 日志怎么对上代码（反查法）

这是把"现象"和"源码"连起来的关键技能。

| 你在 log / dumpsys 里看到 | 直接对应到 | 说明 |
|---|---|---|
| `PipAlphaAnimator.onAlphaAnimationUpdate` | `pip2/animation/PipAlphaAnimator.java` | 类名 + 方法名，直接搜 |
| `PipEnterAnimator` 计数 | `pip2/animation/PipEnterAnimator.java` | **计数为 0 = 这段代码没执行** |
| 层名里的 `PipContentOverlay` | `PipAppIconOverlay`（实现） | 层名来自创建 Surface 时传入的字符串 |
| `finishTransition` / `onHandleDestroyed` | `Transitions` + `SurfaceFlinger` | 转场结束 → 层被销毁，**两个时间差就是生命周期** |

**本次最有价值的一条推理**：

> log 里出现 `PipAlphaAnimator` → 说明走了 `startAlphaTypeEnterAnimation` → 说明 `isLegacyEnter()` 返回 true → **说明建占位层的那段代码根本没执行**。

**一个类名，反推出整条分支。** 这就是读源码 + 看日志结合起来的威力。

---

## 7. 三条线索的答案（已在本地源码中核实）

> 源码已在本地：`F:\AOSP\frameworks\base\libs\WindowManager\Shell\src\com\android\wm\shell\pip2\phone\PipTransition.java`
> 直接跳过去看，比在网页上翻快得多。

### ① 占位层在什么条件下创建

`PipTransition.startBoundsTypeEnterAnimation()`，第 465 行：

```java
PipEnterAnimator animator = new PipEnterAnimator(mContext, pipLeash,
        startTransaction, finishTransaction, endBounds, delta);
if (PipBoundsAlgorithm.getValidSourceHintRect(params, startBounds, endBounds) == null) {
    // If app provided src-rect-hint is invalid, use app icon overlay.
    animator.setAppIconContentOverlay(mContext, startBounds, endBounds,
            pipChange.getTaskInfo().topActivityInfo,
            mPipBoundsState.getLauncherState().getAppIconSizePx());
}
```

→ **条件：App 提供的 `sourceRectHint` 无效。**
有有效 hint 就不需要图标占位——系统知道视频的确切起始区域，可以做更精确的转场。

### ② `isLegacyEnter()` 的真实条件

第 826 行：

```java
private boolean isLegacyEnter(@NonNull TransitionInfo info) {
    TransitionInfo.Change pipChange = getPipChange(info);
    // If the only change in the changes list is a opening type PiP task,
    // then this is legacy-enter PiP.
    return pipChange != null && info.getChanges().size() == 1
            && (pipChange.getMode() == TRANSIT_TO_FRONT || pipChange.getMode() == TRANSIT_OPEN);
}
```

→ **条件：整次转场里只有 1 个 change（就是 PiP task 自己），且 mode 是 `TO_FRONT` 或 `OPEN`。**
→ 通俗说：**"这次转场只有小窗在动" = 老的进法**，走 alpha 淡入，不建占位层。

> ⚠️ **原报告在这里说错了。** 它说"命中 `isLegacyEnter()` 中一个 `!isAutoEnterEnabled()` 子句"。
> 但 `isLegacyEnter()` 里**没有任何** `isAutoEnterEnabled` 判断。
> `isAutoEnterEnabled()` 只出现在另一个方法 `isAutoEnterInButtonNavigation()`（第 818 行），判断的是"是否按钮导航模式下的 auto-enter"。**两个判断被混淆了。**
>
> **教训**：AI 给的根因链，写到"命中某个子句"这种细节时最容易编。**必须点开源码看那一行。**

### ③ pip2 的开关是什么

`PipUtils.kt` 第 315 行：

```kotlin
isPip2ExperimentEnabled = Flags.enablePip2() && !isArc && !isTv
```

→ **`Flags.enablePip2()`（trunk-stable flag），且排除 ARC（ChromeOS 容器）和 TV（LEANBACK）。**
→ 注释还说明"开发阶段可用 system property 覆盖这个只读 flag"。

---

## 7.5 根因：代码里写得明明白白

这是本次阅读最大的收获——**根因不用猜，就在相邻的两个调用里。**

`PipTransition.startBoundsTypeEnterAnimation()`，第 482 行：

```java
animator.setAnimationEndCallback(() -> {
    if (animator.getContentOverlayLeash() != null) {
        startOverlayFadeoutAnimation(animator.getContentOverlayLeash(),
                animator::clearAppIconOverlay);   // ← 淡出结束时才清除
    }
    finishTransition();                            // ← 但这一行不等淡出完
});
```

```java
private void startOverlayFadeoutAnimation(SurfaceControl overlayLeash, Runnable onAnimationEnd) {
    PipAlphaAnimator animator = new PipAlphaAnimator(mContext, overlayLeash,
            null, PipAlphaAnimator.FADE_OUT);
    animator.setDuration(CONTENT_OVERLAY_FADE_OUT_DELAY_MS);   // = 500ms
    animator.setAnimationEndCallback(onAnimationEnd);
    animator.start();                                          // ← 异步，立即返回
}
```

**读出来的因果链：**

```
动画结束回调
  ├─ ① startOverlayFadeoutAnimation(...)  → 启动一个 500ms 的异步淡出
  └─ ② finishTransition()                 → 立即推进转场，不等淡出
                                           ↓
                                     转场结束 → leash 被移除
                                           ↓
                               挂在 leash 上的 overlay 跟着销毁
                                           ↓
                                    500ms 淡出被打断
                                           ↓
                               视频首帧（错误尺寸）暴露
```

**`clearAppIconOverlay()` 的注释说"应该在淡出之后才做"，但 `finishTransition()` 没等淡出——这个自相矛盾就是 bug。**

> **附带发现的第二个不准确点**：原报告说 fadeout 是"400ms delay + 500ms duration"。
> 源码里只有 `CONTENT_OVERLAY_FADE_OUT_DELAY_MS = 500`（第 98 行），**而且它是当成 `setDuration()` 用的，没有 `setStartDelay()`**。
> 所以只有"500ms 时长"，没有"400ms 延迟"——可能是 ROM 改动，也可能是原报告看错了。

---

---

## 7.6 一个更狠的坑：接口实现了，方法却没实现

这一节来自实际修复过程，**是整个案例里最值钱的源码阅读教训**。

### 场景：想照 legacy pip 的修法搬过来

看到根因后，最直接的想法是"把占位层 reparent 到 Task surface，让它活过转场"。
legacy pip 就是这么干的（`PipController.onSwipePipToHomeAnimationStart`）：

```java
mShellTaskOrganizer.reparentChildSurfaceToTask(taskId, overlay, tx);
```

**照搬到 pip2 → 直接黑屏。**

### 为什么：看堆栈里那个 `:0`

```
java.lang.IllegalStateException: This task listener doesn't support child surface reparent.
    at com.android.wm.shell.pip2.phone.PipTaskListener.reparentChildSurfaceToTask(PipTaskListener.java:0)
```

**注意行号是 `:0`。**

行号 0 意味着**这个方法没有对应的源码行**——它是从接口/基类继承来的，`PipTaskListener` 自己没实现。

去源码确认（`pip2/phone/PipTaskListener.java`）：它确实 `implements ShellTaskOrganizer.TaskListener`，但只 override 了两个方法：

```java
public class PipTaskListener implements ShellTaskOrganizer.TaskListener,
        PipTransitionState.PipTransitionStateChangedListener {
    ...
    @Override public void onTaskInfoChanged(ActivityManager.RunningTaskInfo taskInfo) { ... }
    @Override public void onPipTransitionStateChanged(int oldState, int newState, Bundle extra) { ... }
    // ← reparentChildSurfaceToTask 一个字都没有
}
```

于是运行时走基类的默认实现，而那个默认实现是：

```java
throw new IllegalStateException("This task listener doesn't support child surface reparent.");
```

**这次实际触发：**

```
动画结束回调
  ├─ reparentChildSurfaceToTask()   ← 抛 IllegalStateException
  │                                    ↓  回调在这里中断
  └─ finishTransition()             ← 永远没执行
                                       ↓
                                 transition 不会结束
                                       ↓
                                 leash 永不释放
                                       ↓
                                      黑屏
```

**一个未捕获的异常，把整个转场的资源释放全跳过去了。**

### 四条通用教训

| # | 教训 | 说明 |
|---|---|---|
| **1** | **`implements` 编译通过 ≠ 方法可用** | 接口/基类的默认实现可能只是 `throw`。**编译过、跑起来炸**，这是 AOSP 里很常见的坑 |
| **2** | **堆栈里的 `:0` 是好东西** | 行号 0 = 没有源码行 = **继承来的** = 很可能没实现。看到 `:0` 第一反应就该是"去确认这个方法有没有 override" |
| **3** | **别跨实现照搬** | legacy pip 这么做 ≠ pip2 支持这么做。两个实现接口相似，**能力可以完全不同**。搬代码前先确认目标端支不支持 |
| **4** | **资源释放不能被异常跳过** | 他自己的修法也有问题：`finishTransition()` 排在有风险的操作**之后**。应该 `try/finally`，或者先 finish 再 reparent |

### 正确做法：绕开它

```java
SurfaceControl taskLeash = mShellTaskOrganizer.getTaskLeash(taskId);
if (taskLeash != null && taskLeash.isValid()) {
    tx.reparent(overlayLeash, taskLeash);
    tx.setLayer(overlayLeash, Integer.MAX_VALUE);
}
```

两个关键点：

- **`getTaskLeash(taskId)` 拿的是持久 task surface**（`onTaskAppeared` 时 WMS 给的），**不是 transition leash** → 不会被转场结束销毁
- **判空 + 降级**：拿不到就保持原行为（占位层随 leash 销毁），**至少不黑屏**——降级路径比"修好"更重要

### 顺带暴露的一个结构性差异

| | legacy pip | pip2 |
|---|---|---|
| 占位层 repos 目标 | `reparentChildSurfaceToTask` ✅ 支持 | **不支持（抛异常）** |
| 需要绕道 | — | `getTaskLeash` + `tx.reparent` |

> **这就是"同一个功能两代实现，能力不对等"的典型样本。** 读源码时如果只读一代，很容易得出错误结论。

### 还有一条没验证的线索

修复方案落地后若问题仍在，原记录指向**另一个方向**：视频 Surface 以**全屏尺寸**创建（等 2640×1216），而 PiP 窗口只有 919×520——这是**尺寸不匹配**问题，属于**渲染层的 buffer**，跟本节的 leash 生命周期是两回事。

> **这条线索正好说明四层模型的价值**：同一个"画面不全"，可能来自转场层（leash 提前销毁），也可能来自渲染层（buffer 尺寸不对）。**两层都查过，才能说定位完了。**

---

## 8. 可迁移的「读一条 AOSP 路径」六步法

这个方法比这个案例本身更值钱：

| 步 | 做什么 | 本次对应 |
|---|---|---|
| **1** | **找一个入口**：日志里的类名/方法名、dumpsys 里的字段名、别人提到的类 | `PipAlphaAnimator` |
| **2** | **建包结构地图**：看目录，分清 animation / 业务 / 共享接口 | 第 1 节 |
| **3** | **画调用链**：从入口往上找"谁调我"，往下找"我调谁" | 第 2 节 |
| **4** | **读注释找"为什么"**：javadoc + 行内注释优先 | 第 4 节 |
| **5** | **确认要调的方法真的被实现了** | `PipTaskListener` 没 override → 第 7.6 节 |
| **6** | **用日志/层栈回验**：确认你画的路径真的在跑 | 第 6 节 |

**最容易犯的错**：一上来从 `Activity` 开始往下读。
**正确做法**：从**你手上那条日志/那个类名**往上追，先建立局部，再扩到全局。

**第二容易犯的错**：看到一个接口方法就直接调，不确认实现类有没有 override。
**看到堆栈里的 `:0`，就是它在提醒你。**

---

## 9. 知识点速查

| 知识点 | 内容 |
|---|---|
| **PiP 代际** | `pip`（老）与 `pip2`（新，Android 12+ 转场框架驱动）。**pip2 受实验开关控制**（`PipUtils.isPip2ExperimentEnabled()`） |
| **WindowingMode** | `0=UNDEFINED`、`1=FULLSCREEN`、`2=PINNED`、`3=MULTI_WINDOW`、`5=FREEFORM` |
| **WindowContainer 树** | `Display → TaskDisplayArea → Task → (TaskFragment) → ActivityRecord`。进 PiP 时 ActivityRecord **reparent** 到 pinned Task |
| **Transition / leash** | Android 12+ 转场框架。**leash 是转场期间给窗口套的临时 SurfaceControl 父节点，转场结束就被移除**——挂在它上面的子节点会一起销毁 |
| **config-at-end** | 把 config 变更推迟到转场结束提交。API：`WindowContainerTransaction.deferConfigToTransitionEnd()`。**是进 PiP 的固有特性** |
| **ValueAnimator 子类** | `PipEnterAnimator extends ValueAnimator`——**所以它的本质是"逐帧改 `SurfaceControl.Transaction`"**（`setCrop` / `setMatrix` / `setCornerRadius`） |
| **PipTransitionState 状态** | `SWIPING_TO_PIP` → `ENTERED_PIP` → `EXITED_PIP` |
| **SurfaceFlinger 层名** | 格式 `<hash> <层名> <创建时间>#<layerId>`。层名**来自创建 Surface 时传入的字符串**，不是 SF 起的 |

---

## 10. 这个案例本身（一句话，不展开）

> 占位层 attach 在 transition leash 上，转场一结束 leash 被移除，占位层跟着销毁，fadeout 没跑完 → 视频首帧（错误尺寸）暴露 → "先不全再全"。

**但按本文的用途，这个结论不重要。重要的是你怎么从"画面不全"这四个字，一路走到 `mContentOverlay.attach(tx, mLeash)` 这一行。**

---

## 11. 本地源码（F:\AOSP）

> ⚠️ **当前状态：F 盘分区被重建过，`F:\AOSP` 已丢失。**
> 本节记录的是目录结构和拉取方式，**重建命令见本节末尾**。重拉约 52MB、一分钟。

### 目录结构

```
F:\AOSP\
└── frameworks\
    └── base\          ← 只检出 4 个目录，3195 个文件，约 50MB
        ├── libs\WindowManager\       ← Shell 全在这（pip2 / transitions / wm）
        ├── core\java\android\view\   ← SurfaceControl、SurfaceView
        ├── core\java\android\window\ ← TransitionInfo、WindowContainerToken
        └── core\java\android\app\    ← Activity、PictureInPictureParams
```

**为什么只有 50MB**：用了 `--filter=blob:none --sparse`，只下载元数据 + 点名的目录，**90% 的源码根本没下载**。

### 常用路径速查

| 想找什么 | 本地路径（相对 `F:\AOSP\frameworks\base\`） |
|---|---|
| pip2 业务编排 | `libs\WindowManager\Shell\src\com\android\wm\shell\pip2\phone\` |
| pip2 动画 | `libs\WindowManager\Shell\src\com\android\wm\shell\pip2\animation\` |
| 转场框架 | `libs\WindowManager\Shell\src\com\android\wm\shell\transitions\` |
| WM Core | `libs\WindowManager\Shell\src\com\android\wm\shell\wm\` |
| SurfaceControl | `core\java\android\view\SurfaceControl.java` |
| PiP 参数 | `core\java\android\app\PictureInPictureParams.java` |

### 以后要加别的目录

```powershell
cd F:\AOSP\frameworks\base
git sparse-checkout add packages/SystemUI      # 加一个目录
git sparse-checkout list                        # 看现在检出了什么
git sparse-checkout set libs/WindowManager      # 重设（会取消其他的）
```

> `add` 是追加，`set` 是覆盖——**别用错**。

### 要加别的仓库

AOSP 是几百个独立 git 仓库，按需单个拉就行：

```powershell
git -c http.sslBackend=openssl clone --depth 1 `
  https://github.com/aosp-mirror/platform_system_core F:\AOSP\system\core
git -c http.sslBackend=openssl clone --depth 1 `
  https://github.com/aosp-mirror/platform_frameworks_native F:\AOSP\frameworks\native
```

### 三个必须知道的限制

| 限制 | 说明 |
|---|---|
| **不能编译** | Windows 上无法构建 AOSP（要 Linux）。`F:\AOSP` 只能**读**，不是构建环境 |
| **不是全量** | 只检出了 4 个目录。找不到某个文件，先用 `git sparse-checkout add` 加上 |
| **镜像可能滞后** | 用的是 GitHub `aosp-mirror`，比官方 `android.googlesource.com` 慢一点。你 ROM 是 Android 17，镜像里可能还是更早的代码，**具体行为要以你手上的 ROM 源码为准** |

> **别忘了 `cs.android.com` 仍然是最好的补充**——能跳转、能查引用、能看历史，本地 grep 替代不了。**本地适合深读，网页适合跳转。两者配合用。**

---

### 重建命令（AOSP 丢失后重新拉）

```powershell
$env:GIT_TERMINAL_PROMPT = '0'
New-Item -ItemType Directory -Force -Path 'F:\AOSP\frameworks' | Out-Null

git -c http.sslBackend=openssl -c core.longpaths=true clone --depth 1 `
  --filter=blob:none --sparse --branch main `
  https://github.com/aosp-mirror/platform_frameworks_base 'F:\AOSP\frameworks\base'

Set-Location 'F:\AOSP\frameworks\base'
git config http.sslBackend openssl
git config core.longpaths true
git config core.autocrlf false
git sparse-checkout set libs/WindowManager core/java/android/view core/java/android/window core/java/android/app
```

> **`http.sslBackend=openssl` 不能省**——这个环境里 git 默认的 schannel 后端会报 `SEC_E_NO_CREDENTIALS`。

---

## 自检清单

> **用法**：**不查资料**能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。
> 全勾上 = 这篇可以封存；只差一两项 = 只补那一两节，**别重读全文。**

- [ ] 能说出 `pip2/animation` 和 `pip2/phone` 各放什么（包名即职责） → 第 1 节
- [ ] 能不看笔记画出 `PipController` → … → `SurfaceControl` 的调用链 → 第 2 节
- [ ] 能说清 `PipContentOverlay`（接口）和 `PipAppIconOverlay`（实现）的关系 → 第 5 节
- [ ] 能说出 `setAppIconContentOverlay` 的触发条件（`sourceRectHint` 无效） → 7①
- [ ] 能用堆栈里的 `:0` 判断"方法没被实现"，并说出它为什么导致黑屏 → **7.6**
- [ ] 能说出"读一条 AOSP 路径"的六步，并解释为什么**不要**从 `Activity` 往下读 → **第 8 节**
- [ ] 能从一条日志（如 `PipAlphaAnimator`）反推出走了哪条分支 → 第 6 节

---

## 附：一句话记忆

> **包名是职责表，注释是答案本，日志是最好的搜索关键词。**
> **读 AOSP 别从 Activity 往下读——从你手上那条日志往上追。**

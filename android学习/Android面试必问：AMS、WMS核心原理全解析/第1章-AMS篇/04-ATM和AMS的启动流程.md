# 04 [ATM](../../../辅助稿/术语表.md#ams-atm) 和 [AMS](../../../辅助稿/术语表.md#ams-atm) 的启动流程

> **逐字稿**：`C:\Users\18369\Documents\ZhuangFengYuan\Android面试必问：AMS、WMS核心原理全解析\Android面试必问_AMS、WMS核心原理全解析 - P4 4.ATM和AMS的启动流程.doc`
> 上一讲：[03 system_server 进程的创建](03-system_server进程的创建.md)｜下一讲：[05 Activity 的启动流程](05-Activity的启动流程.md)
> 导读：[00 导读与规范](../00-导读与规范.md)
> **值得回看**：老师**在源码里现场搜 `startSystemProcess`、`publishBinderService`**，一路点进 `Lifecycle` 内部类，演示"看名字预判 + 跳进去验证"的读源码手法
> ⚠️ **文稿口误**：`SystemServiceManager` → 「season server manager / c server manager」；`ActivityTaskSupervisor` → 「activity spark supervision」；`SystemServer` → 「深成照 / 生成 server / 随身 server」

---

## 这一讲讲什么

上一讲把 `system_server` 进程拉起来了，这一讲讲**它进去之后干什么**，重点落在 **AMS / ATM / WMS 三个服务的启动**。

**一句话**：`system_server` 用 `SystemServiceManager` 按"**引导 → 核心 → 其他**"三类顺序启动近 100 个服务，**AMS 在最前面（引导服务）**，**WMS 在后面（其他服务）**。

---

## 一、`system_server` 启动服务的四步

```
SystemServer.main() → run()
   ↓
① 创建 SystemServiceManager
   ↓
② startBootstrapServices()   引导服务  ← AMS、PKMS 在这里
   ↓
③ startCoreServices()        核心服务
   ↓
④ startOtherServices()       其他服务  ← WMS 在这里（数量最多，七八十个）
   ↓
Looper.loop()                进循环
```

### 1.1 为什么 AMS 这么早、WMS 这么晚（**面试点**）

> **按依赖关系排的。** AMS 是"别人都要用"的基础服务，所以放进引导服务；WMS 启动后**立刻要和 AMS 关联**（`setWindowManager`），自然排在 AMS 之后。

---

## 二、Android 10 的分水岭：多了个 ATM

| 版本 | Activity 管理 |
|---|---|
| **Android 10 之前** | 只有 **AMS**（`ActivityManagerService`）一个 |
| **Android 10 及之后** | 拆成 **ATM**（`ActivityTaskManagerService`）+ **AMS** |

> **为什么要拆**：AMS 太胖了，把"**任务/Activity 管理**"这块切出去给 ATM，AMS 自己留"进程/内存/权限"等职责。

**两个都住在 `system_server` 里，都在这条启动链上。**

---

## 三、服务是怎么被启动的（通用套路）

所有服务的启动都走同一个方法：`SystemServiceManager.startService(...)`。

### 3.1 它干两件事

| # | 做什么 |
|---|---|
| **①** | **通过反射创建服务对象**（以及它的参数对象） |
| **②** | 调用该服务的 **`Lifecycle.onStart()`** |

### 3.2 一个读源码的实用技巧（老师反复强调）

> **看到传 `Class` 对象、传全类名字符串 → 基本就是反射。**

带着这个预判去读源码，比一行行啃快得多。

### 3.3 服务的标准写法：内部类 `Lifecycle`

AMS / ATM / WMS 都遵循同一个模式：

```java
class XxxService {
    static final class Lifecycle extends SystemService {   // ← 内部类，继承 SystemService
        onCreate()  → 创建真正的服务对象
        onStart()   → 把服务注册到 ServiceManager
    }
}
```

> ⚠️ 读源码时**别进错 `Lifecycle`** —— AMS 和 ATM 各有一个同名内部类。

---

## 四、ATM 启动：关键是 `ActivityTaskSupervisor`

### 4.1 创建阶段

| 顺序 | 做什么 |
|---|---|
| 1 | `Lifecycle.onCreate()` → **创建 ATM 服务对象** |
| 2 | ATM 初始化时创建 **`ActivityTaskSupervisor`**（栈/任务管理对象） |
| 3 | 还做了 `setRecentTasks(...)`（设置"当前任务栈"，就是设置里"正在运行的应用"看到的那个） |

> `ActivityTaskSupervisor` 是**任务栈管理的核心对象**，后面讲栈和 launchMode 都要靠它。

### 4.2 注册阶段

```java
// Lifecycle.onStart()
publishBinderService(...)   // 把 ATM 注册进 ServiceManager
```

---

## 五、AMS 启动：只干一件核心事

### 5.1 创建阶段

> **AMS 创建时只做一件事：创建 `ActivityTaskSupervisor`。**

（同样的类，因为栈管理归 ATM，但 AMS 也持有它）

### 5.2 注册阶段：`setSystemProcess()`

AMS 不走 `publishBinderService`，而是走 **`ActivityManagerService.setSystemProcess()`**：

```java
ServiceManager.addService(Context.ACTIVITY_SERVICE, this);   // 注册自己
// 同时注册的还有：
//   meminfo  → dumpsys meminfo
//   gfxinfo  → dumpsys gfxinfo
//   dbinfo   → dumpsys dbinfo
```

**顺带的三个 [Binder](../../../辅助稿/术语表.md#binder) 服务都是干嘛的**：

| 服务 | 用途 |
|---|---|
| **`meminfo`** | `dumpsys meminfo` —— 看**进程占用的内存** |
| `gfxinfo` | 图形/渲染信息 |
| `dbinfo` | 数据库信息 |

> 都是**跨进程取信息**用的，排障时会直接 `dumpsys` 它们。

---

## 六、WMS 启动：晚一步，且写法更老

| 项 | AMS / ATM | WMS |
|---|---|---|
| 在哪启动 | `startBootstrapServices` | **`startOtherServices`** |
| 创建方式 | `Lifecycle` + `SystemServiceManager.startService` | **`WMS.main()`**（Android 10 前 AMS 也这么写） |
| 创建后 | 注册到 ServiceManager | `setWindowManager(...)` **和 AMS 建立关联** |

> 老师判断：WMS"以后可能也会改成 Lifecycle 那套"。

---

## 七、Launcher 什么时候启动

> **在 `systemReady()` 里。**

```
SystemServer.run()
   ↓ …启动完所有服务
ActivityManagerService.systemReady()
   ↓
ATM 去启动桌面（Launcher）
```

> ⚠️ 文稿里方法名是"`ration top activities`"，实际类/方法名**待核实**（看源码时以 `startTopActivities` 一类为准）。

---

## 八、⚠️ SystemServiceManager vs ServiceManager（**必须分清**）

这是这一讲最容易混的一对名字。

| | **`ServiceManager`** | **`SystemServiceManager`** |
|---|---|---|
| 外号 | 系统服务的「**大管家**」 | 系统服务的「**人事部**」 |
| 管什么 | **注册与查找系统服务**（`addService` / `getService`） | **管理 `SystemService` 的生命周期**（`startService` → `onCreate` / `onStart`） |
| 层次 | Java 层 + 底层 **C++ 也有一个同名 `ServiceManager`**，**是同一个东西** | 只在 Java 层（`system_server` 内部） |

> **老师口述里说 `SystemServiceManager` 管"SystemServer 的生命周期"，这是简化说法**：
> 它管的是**所有 `SystemService` 的生命周期**（AMS/ATM/WMS 的 `Lifecycle` 都是它的管理对象）。

---

## 九、为什么要懂这一整套（老师的动机）

> **因为 ANR 的日志看不懂，根子就在这不熟。**

- 不熟启动流程 → 看到 ANR 日志一片懵，不知道哪行是重点
- 熟了流程 → 一眼看出日志落在哪一步，才能定位

> 老师原话大意：面试问 AMS/WMS 不是"造火箭"，而是**你解决线上问题的前提**。

---

## 源码落点

| 环节 | 位置 |
|---|---|
| **`SystemServiceManager.startService()`** —— 反射创建 + 调 `Lifecycle.onStart()` | [SystemServiceManager.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/SystemServiceManager.java) |
| `ActivityManagerService.setSystemProcess()` —— AMS 注册自己 + meminfo/gfxinfo/dbinfo | [ActivityManagerService.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java) |
| **`ActivityTaskManagerService`**（ATM） | [ActivityTaskManagerService.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/wm/ActivityTaskManagerService.java) |
| **`WindowManagerService`**（WMS） | [WindowManagerService.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/wm/WindowManagerService.java) |
| `ActivityTaskSupervisor` —— AMS/ATM 都创建的那个"栈管理"对象 | [ActivityTaskSupervisor.java ↗](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/services/core/java/com/android/server/wm/ActivityTaskSupervisor.java) |

> 在 `SystemServer.java` 里搜 **`startBootstrapServices`** 和 **`startOtherServices`**，就能看到 AMS 与 WMS 分别排在哪一批。

---

## 易错点

| 易错点 | 正确理解 |
|---|---|
| 以为 AMS 和 ATM 是一回事 | Android 10 起**拆成两个**，ATM 管任务/Activity，AMS 管进程等 |
| 以为 WMS 和 AMS 一起启动 | AMS 在**引导服务**，WMS 在**其他服务**（更晚） |
| 把 `ServiceManager` 和 `SystemServiceManager` 混用 | 前者**管服务注册查找**，后者**管服务生命周期** |
| 以为 `SystemServiceManager` 管 "SystemServer" | 它管的是**所有 `SystemService` 的生命周期** |
| 读源码时进错 `Lifecycle` 内部类 | AMS/ATM **各有一个**同名内部类 |
| 以为 `meminfo`/`gfxinfo`/`dbinfo` 是普通属性 | 它们都是 **Binder 服务**，`dumpsys` 用 |

---

## 自检清单

> 用法：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能背出 `system_server` 启动服务的**四步顺序** → 一
- [ ] 能说出 AMS 和 WMS 分属哪一类服务，以及为什么这么排 → 1.1
- [ ] 能说出 Android 10 之后 AMS 被拆成了什么，为什么拆 → 二
- [ ] 能说出 `SystemServiceManager.startService` 干的两件事 → 3.1
- [ ] 能说出"看到传 Class / 全类名 → 就是反射"这条读源码技巧 → 3.2
- [ ] 能说出 ATM 和 AMS **各自创建的核心对象** → 四、五
- [ ] 能说出 AMS 注册时**顺带注册的三个 Binder 服务**及其用途 → 5.2
- [ ] 能**分清 `ServiceManager` 和 `SystemServiceManager`** → 八

---

## 一句话记忆

> **`system_server` 里：`SystemServiceManager` 按「引导 → 核心 → 其他」启动近百个服务，AMS 在引导、WMS 在其他。**
>
> **Android 10 起 AMS → 拆成 ATM + AMS；两者都创建 `ActivityTaskSupervisor`，都把自己注册进 `ServiceManager`。**
>
> **`ServiceManager` 管"服务在哪"，`SystemServiceManager` 管"服务怎么活"。**

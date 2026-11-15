# Android 开机流程：从 BootROM 到桌面

> 整理：2026-10-20 ｜ 校对：2026-10-21
>
> 本文挂在 [Android-Framework-地图.md](../android学习/Android-Framework-地图.md) 的「系统启动主线：init → Zygote → SystemServer」节点上。

---

## 30 秒导读

开机分**两段**，两段的工具链完全不同：

| 段 | 范围 | 归属 | 日志在哪 |
|---|---|---|---|
| **第一段：Boot chain** | BootROM → 一级加载器 → 二级加载器 → Kernel | 厂商 BSP + kernel | **串口 UART**（早期没有 Android log） |
| **第二段：Android 启动** | init → 早期服务 → zygote → system_server → Launcher | 纯 AOSP | `dmesg` / init 日志 / `logcat` |

**分诊的核心依据就是：先判断卡在哪一段。**

> **时间不够就只读「四、开机 bug 分诊与救砖」**，那是能直接干活的部分。其它当背景知识。

---

## 一、通用模型：多级引导链

### 1.1 接力图

所有 SoC 的开机都遵循同一个通用模型：**多级加载器接力**。

```
上电
 │
 ▼
BootROM ──> 一级加载器 ──> 二级加载器 ──> Kernel ──> init
芯片固件    flash 分区     flash 分区     flash 分区   ramdisk / system
不可改      受 secure boot 下载协议常在   通用 + 厂商  Android 第一进程
            保护           这一层
```

### 1.2 每一级做的事都是同一类

**校验下一级 → 加载到内存 → 跳转执行。**

"加载"具体分三步：

1. 从 flash 把下一级镜像读出来
2. 用 secure boot 公钥验签名（**失败就卡住，是开机 bug 最常见的原因**）
3. 把 CPU 控制权交给下一级入口地址

**控制权单向传递，不会回头。**

### 1.3 为什么必须多级（硬件约束，全行业通用）

1. BootROM 极小且固化，只能放最精简代码
2. 早期 DRAM 还没起来，代码只能跑在片内 SRAM，容量有限
3. 越靠前越要"小、快、可信"，越靠后越复杂

### 1.4 三个关键区别

**① 前四级是"加载器"，init 不是**

init 是 Android 第一个用户态进程（**PID 1**）。它启动后引导链结束，进入正常进程世界。

注意：init 只**启动 zygote**，**不 fork system_server**。`system_server` 是 `zygote` fork 出来的。

**② 存放与可改性不同**

| 阶段 | 位置 | 能否改 |
|---|---|---|
| BootROM | 芯片内固件 | 永不可改 |
| 一级加载器 | flash 分区 | 可烧录（受 secure boot 保护） |
| 二级加载器 | flash 分区 | 可烧录（受 secure boot 保护） |
| Kernel | flash 分区（`boot.img`） | 可烧录 |
| init | `boot.img` 的 ramdisk + `/system/bin/init` | 随镜像更新 |

> Android 10 起有 **first-stage init 跑在 `boot.img` 的 ramdisk 里**，所以"init 归 AOSP"成立，但它不止在 system 分区。

**③ Kernel 身兼两职**

既是二级加载器加载的对象，又是加载 init 的主体——引导链最后一环，也是新世界起点。

---

## 二、概念辨析：bootloader / fastboot / 厂商名词

### 2.1 bootloader（通用概念）

**任何"加载下一级"的程序都可以叫 bootloader**，是行业通用术语。一级加载器、二级加载器、U-Boot 都是 bootloader。

### 2.2 fastboot（具体协议，不是加载器）

fastboot 是 **AOSP 定义的 host↔device 通信协议**，分两端：

- **host 端**：`fastboot` 命令行工具（AOSP `system/core/fastboot/`，路径以当前 AOSP 为准）
- **device 端**：bootloader 里的一个模式

**准确关系：fastboot 是 bootloader 的一种工作模式，不是 bootloader 本身。**

### 2.3 二级加载器（bootloader）的几种模式

```
二级加载器 (bootloader)
  ├─ 正常启动模式   → 加载 kernel 进系统
  ├─ fastboot 模式  → 跑 fastboot 协议，接受 host 的 flash/reboot
  ├─ recovery 模式  → 加载 recovery 镜像
  ├─ fastbootd      → 用户态 fastboot（Android 10+，刷动态分区）
  └─ 厂商私有下载模式
```

### ⚠️ fastbootd 与 bootloader fastboot 是两个东西

| | bootloader fastboot | fastbootd |
|---|---|---|
| 跑在哪 | ABL / LK（bootloader 里） | 用户态（recovery 里） |
| 刷什么 | 物理分区：`boot`、`vbmeta`、`dtbo`… | **动态分区**：`system`、`vendor`、`product`… |
| 怎么进 | `adb reboot bootloader` | `adb reboot fastboot` |

**排查"刷不进去"的 bug 时，先确认你在哪个 fastboot 里**——这是很常见的坑。

### 2.4 厂商名词对照（别按名字对，按职责对）

| 通用概念 | MTK | 高通（**现代**） | 高通（**老平台**） | Samsung Exynos | 开源方案 |
|---|---|---|---|---|---|
| **BootROM**（芯片内固件） | BROM | **PBL** | PBL | iROM | — |
| **一级加载器** | **preloader** | **XBL** | SBL1 | BL1 | 厂商 L1 / SPL |
| **二级加载器**（bootloader） | **LK** | **ABL** | SBL2 / SBL3 | BL2 / BL33 | **U-Boot** |
| 安全世界 / ATF | — | TZ / hyp | TZ | **BL31**(EL3)、BL32(TEE) | ATF |
| 私有下载模式 | BROM 模式 / Preloader 模式 | **EDL / 9008（在 PBL 里）** | EDL | — | — |

**三个要点：**

1. **高通的 SBL1/SBL2/SBL3 是老平台的叫法。** 现代高通（大约 SDM845 之后）是 **PBL → XBL → ABL**。拿 SBL 系列去对现代高通文档会对不上。
2. **PBL 是 BootROM，不是"一级加载器"。** 它和 BROM、iROM 是同层的东西。
3. **级数不固定**：MTK 三级（BROM/preloader/LK）、高通三到四级、三星把 ATF（EL3）也算一级。

---

## 2.5 MTK 平台专章：preloader 和 LK 到底是什么

> 同事说 "preloader"、"lk" 的时候，说的就是下面这两级。

### 完整链条

```
BROM（Boot ROM，芯片内，不可改）
  │  扫描 flash/SD/USB，找 preloader
  ▼
preloader（flash 的 preloader 分区）
  │  初始化 DRAM、时钟、串口 → 加载 LK
  ▼
LK = Little Kernel（flash 的 lk / bootloader 分区）
  │  MTK 的 bootloader：开机第一屏、fastboot、选启动模式、加载 kernel
  ▼
kernel
```

### 两级分别是什么

| 阶段 | 名字 | 在哪 | 干什么 |
|---|---|---|---|
| **BootROM** | BROM | 芯片内 ROM，擦不掉 | 上电第一段代码。扫描存储介质找 preloader，校验后加载到 SRAM。**BROM 模式是救砖的最后防线** |
| **一级加载器** | **preloader** | flash 的 `preloader` 分区 | 初始化 DRAM（内存训练）、时钟、串口；加载 LK。**SP Flash Tool 正常烧录就靠它** |
| **二级加载器** | **LK**（Little Kernel） | flash 的 `lk` / `bootloader` 分区 | MTK 的 bootloader。显示开机第一屏、实现 fastboot 协议、决定进 normal/recovery/fastboot、加载 kernel + dtb |

### 同事说这两个词，其实是在说"卡在第几级"

| 同事说 | 实际含义 | 对应排查 |
|---|---|---|
| "preloader 挂了" | BROM 之后的第一个加载器坏了 | fastboot 大概率进不去；进 **BROM 模式**用 SP Flash Tool 重刷 |
| "lk 有问题" | bootloader 坏了 | **fastboot 进不去**，但 BROM 模式还能进 |
| "进不了 fastboot" | 先怀疑 **LK** | 串口看 LK 有没有打印 |

### 实用点 1：串口 log 是分段的，看打到哪里就知道卡在哪级

| 阶段 | 串口特征 |
|---|---|
| BROM | **几乎没有输出**（只有下载模式握手时吐一个字节） |
| preloader | 会打印带 `[PL]` 前缀的日志（DRAM、storage、loading…） |
| LK | 打印自己的 banner，之后是开机第一屏 |

> **这是 MTK 平台上最有效的分诊手段**：串口打到 `[PL]` 就停 → preloader 之后的问题；完全没输出 → BROM 或硬件；能看到 LK 的 banner 才停 → LK 加载 kernel 的问题。

### 实用点 2：SP Flash Tool 有两种连接模式

| 模式 | 前提 | 说明 |
|---|---|---|
| **Preloader 模式** | preloader 还活着 | 正常下载/格式化 |
| **BROM 模式** | **preloader 坏了也能进** | 短接 test point 或按键组合强制进 BootROM，用 **DA（Download Agent）** 提供下载协议 |

**所以"preloader 挂了"不等于砖——BROM 模式还能救。**

⚠️ 但有例外：**开了 secure boot 的机器，BROM 模式只接受签名过的 DA 文件**，自己找的 DA 会被拒。这是 secure boot 机器难救的根本原因。

### 实用点 3：MTK 语境里的 "bootloader" 是特指

在 MTK 的文档和同事口中，**"bootloader" 通常特指 LK 这一级**，不是泛指所有加载器。这跟通用术语的含义不完全一样，听的时候注意上下文。

---

## 2.6 按职责定位（跨平台通用）

- **校验并加载下一级** → 一级加载器
- **跑 fastboot / 烧录** → 二级加载器
- **加载 kernel** → 最后一级 loader

---

## 三、AOSP 边界与知识归属

### 3.1 谁的东西

| 范围 | 归属 | 说明 |
|---|---|---|
| BootROM / 一级 / 二级加载器 | **纯厂商 BSP** | AOSP 里没有 |
| Kernel | **一半一半** | AOSP 提供通用源码；SoC 驱动和 boot 配置由厂商 BSP 补。Android 12 起走 **GKI**（通用内核镜像），边界更清晰 |
| init 及之后 | **全是 AOSP** | init、zygote、system_server、framework、桌面 |
| fastboot 协议 | **一半一半** | host 端工具在 AOSP，device 端实现由厂商 BSP 完成 |

**准确说法：AOSP 从 kernel 通用部分开始，init 之后全是 AOSP 地盘。**

### 3.2 Android 启动段

| 步骤 | 谁 | 做什么 |
|---|---|---|
| 1 | **init（first stage）** | 跑在 ramdisk 里：挂载 `system`/`vendor`、建挂载点、加载 SELinux 策略 |
| 2 | **init（second stage）** | 解析 `init.rc`：挂载 `data`、启动早期服务（`vold`、`netd`、`logd`、`servicemanager`、`hwservicemanager`、`surfaceflinger`…） |
| 3 | init | 启动 **zygote** |
| 4 | zygote | 预加载 framework 类和资源 → **fork 出 system_server** |
| 5 | system_server | 启动核心服务：ATMS/AMS、WMS、PMS、PowerManagerService… |
| 6 | AMS | 系统就绪后解析 **HOME Intent**，拉起 **Launcher**（独立 App 进程） |
| 7 | — | 解锁 → 看到桌面 = 进入系统 |

### 3.3 知识归属：开机引导横跨多个领域，计组只占一小块

| 知识块 | 覆盖内容 |
|---|---|
| **计组** | reset vector、上电复位、CPU 从哪个地址取第一条指令 |
| **体系结构 / 嵌入式** | BootROM 内容、boot chain 分级、secure boot 校验链、各 SoC boot 流程 |
| **操作系统** | kernel 加载、ramdisk、init 启动、bootloader 与 OS 交接 |
| **SoC 厂商 BSP** | 各级加载器实现、fastboot、私有下载协议、烧录 |

**计组只讲到"CPU 从 BootROM 开始跑"为止，再往后就超出。**

> 排查开机 bug 真正靠的是：
> - 厂商 boot 文档
> - secure boot 机制（哪级校验失败、卡在哪）
> - **各阶段串口 log**（一级加载器阶段通常只有串口 log，没有 Android log）
>
> 计组帮你理解"为什么上电先跑 BootROM"，**定位 bug 靠厂商文档 + 串口 log**。

---

## 四、开机 bug 分诊与救砖

### 4.1 分诊表

**第一段：Boot chain（看串口 / `dmesg`）**

| 卡住位置 | 现象 | 常见原因 |
|---|---|---|
| BootROM | 串口**完全无输出** | 硬件：电源、时钟、flash 未识别 |
| 一级加载器 | 有一级串口 log 但停住 | 二级加载器校验失败、flash 分区损坏 |
| 二级加载器 | 能进 fastboot 但起不了系统 | kernel 分区损坏、签名不匹配 |
| Kernel | 有 `dmesg` 但起不来 | 看 panic：驱动、内存、分区表 |

**第二段：Android 启动（看 `logcat` / init 日志）**

| 卡住位置 | 现象 | 常见原因 |
|---|---|---|
| init 挂分区 | 卡 logo / 反复重启 / 进 recovery | 分区损坏、fstab 配置、加密失败 |
| 早期服务 | 有 logcat 但服务起不来 | 看 init 日志、`/dev/kmsg` |
| zygote / system_server | 系统起来了但异常 | `logcat`、`dumpsys activity` |
| Launcher | 桌面闪退、反复回锁屏 | `logcat` 过滤 Launcher 进程 |

### 4.2 分诊第一步：先判断卡在哪一段

| 现象 | 卡在哪 | 查什么 |
|---|---|---|
| logo 都出不来 | Boot chain 段 | 厂商 BSP、kernel log、串口 |
| **能出 logo**，但进不了系统（卡住 / 反复重启 / 进 recovery） | init 段 | init 日志、分区挂载 |
| 系统起来了但异常（桌面闪退、服务起不来） | Android 启动段 | `logcat`、`dumpsys` |

### 一个能砍掉一半排查范围的判据

**能出 logo，就说明 kernel 已经起来了。**

bootlogo 是 kernel 和 bootloader 在 framebuffer 上画的；bootanimation（会动的开机动画）才是 init 起 surfaceflinger 之后的事。所以：

- **卡在 bootlogo（静止的图）** → kernel 或更早
- **卡在 bootanimation（会动的动画）** → kernel 没问题，是 Android 启动段

**前一段用串口 / `dmesg`，后一段用 `logcat`——工具链完全不同，这是分诊核心依据。**

### 4.3 救砖通道（逐级降级）

| 还能进什么 | 说明 | 手段 |
|---|---|---|
| 系统 / fastboot | bootloader 正常 | `fastboot flash` 重刷分区 |
| **厂商私有下载模式**（高通 EDL/9008、MTK BROM） | **BootROM 级，比一级加载器还深**——一级挂了也能进 | 高通 QFIL、MTK **SP Flash Tool** + 对应的 firehose / DA 文件 |
| 都进不去 | 硬件、BootROM 损坏 | 编程器（eMMC/UFS 直读）或硬件维修 |

**为什么 EDL/9008 这么深？** 因为它实现在 **PBL（BootROM）** 里——芯片出厂就固化，擦不掉。所以哪怕 flash 全空、一级加载器全没了，**短接 test point 仍然能进**。

> **"救砖"的最后一根救命稻草是 BootROM，不是 bootloader。**

---

## 五、验证链、A/B 分区与日志

### 5.1 验证链：secure boot 不止一级

现代 Android 有**三条独立的验证机制**：

| 机制 | 在哪验 | 验什么 |
|---|---|---|
| **Secure Boot**（芯片级） | BootROM / 一级加载器 | 加载器的签名（厂商私钥） |
| **AVB / Verified Boot**（Android 级） | bootloader（ABL/LK） | `boot`、`init_boot`、`vendor_boot`、`dtbo`、**`vbmeta`** |
| **dm-verity**（运行时） | kernel | `system`/`vendor` 块设备，逐块校验 |

**`vbmeta` 是关键**：里面有各分区的 hash / hashtree root hash。**改任何被验证的分区，都必须同时改 `vbmeta`，否则起不来。**

**设备状态四色：**

- **绿**：已锁定，验证通过
- **黄**：已锁定，但用的是自定义 key
- **橙**：**已解锁**（会警告）
- **红**：验证失败

> **解锁会强制清空 userdata**（加密 key 丢失）。这既是安全设计，也是很多"解锁后数据没了"的原因。

### 5.2 A/B 分区

现代设备大多是 **A/B 双槽**（`_a` / `_b`）。开机时 bootloader 选一个槽启动。

**坑点：**

- 刷了 A 槽但设备在 B 槽跑 → 看起来"刷了没生效"（`fastboot getvar current-slot` 确认）
- 系统更新失败会自动回滚到另一个槽 → "莫名变回旧版本"就是这个原因

### 5.3 各阶段日志在哪看

| 阶段 | 日志来源 | 怎么拿 |
|---|---|---|
| BootROM / 一级加载器 | **只有串口 UART** | 拆机接串口（或厂商调试口），没有软件途径 |
| 二级加载器 | 串口 / bootloader 自己的 log | 串口，或 `fastboot oem` 类命令 |
| Kernel | `dmesg` / `/dev/kmsg` | 串口、`adb shell dmesg`、`last_kmsg`（重启后） |
| init | init 日志 / `/dev/kmsg` | `adb shell dmesg \| grep init`、`logcat -b all` |
| Android 上层 | `logcat` | `logcat -b all`（别只看 main，还有 system/events/crash） |
| 系统卡死 | ANR trace / tombstone | `adb bugreport`、`/data/anr/`、`/data/tombstones/` |

---

## 自检清单

> **用法**：**不查资料**能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。
> 全勾上 = 这篇可以封存；只差一两项 = 只补那一两节，**别重读全文。**

- [ ] 拿到"开不了机"，**第一句先问"logo 出没出来"**，并说得出两种结论各自指向哪段 → 4.2
- [ ] 能画出整条链 `BootROM → 一级 → 二级 → kernel → init`，并说出每级做的三件事 → 1.2
- [ ] 能说出 **MTK 三级**（BROM → preloader → LK）各干什么 → 2.5
- [ ] 能解释"**preloader 挂了为什么还能救**"（BROM 模式在芯片内，擦不掉） → 2.5 / 4.3
- [ ] 能说出 **AOSP 的边界从哪开始**（kernel 通用部分起，init 之后全是 AOSP） → 3.1
- [ ] 能背出**三条主线**：init→zygote→system_server、一次跨进程调用、界面怎么上屏 → 附录
- [ ] 能说出**哪一段用串口、哪一段用 logcat**，以及为什么 → 4.2

---

## 附：一句话记忆版

> **BootROM 固化验一级，一级拉二级，二级拉 kernel，kernel 拉 init。**
> **init 拉服务起 zygote，zygote fork system_server，AMS 拉 Launcher。**
> **串口看前半段，logcat 看后半段，能出 logo 说明 kernel 没事。**
>
> MTK 版：**BROM → preloader → LK → kernel**，preloader 挂了还有 BROM 模式。

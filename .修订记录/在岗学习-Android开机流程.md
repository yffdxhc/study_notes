# Android开机流程.md — 修订记录

> 本文是 [Android开机流程.md](../在岗学习/Android开机流程.md) 的修订记录，从正文中移出。
> 正文位置：`在岗学习/Android开机流程.md`。

---

## 修订批次 1（2026-10-21）

**来源**：2026-10-20 对另一 AI 的提问整理
**性质**：结构重排 + 事实校对 + 补充缺失内容

### 一、修正的 8 处

| # | 原文（问题点） | 问题 | 修正 |
|---|---|---|---|
| ① | "init 启动后…（fork 出 zygote、system_server）" | **init 不 fork system_server**，是 zygote fork 的。且与原文第三节自相矛盾 | 改为"init 启动 zygote，zygote fork 出 system_server" |
| ② | 厂商表：一级加载器 = "PBL / SBL1"，二级 = "SBL2"，更多级 = "SBL3→Kernel" | **SBL1/2/3 是老平台叫法**；现代高通是 **PBL → XBL → ABL**。且 **PBL 是 BootROM**，不应算作一级加载器 | 拆成"高通（现代）/ 高通（老平台）"两列，单独列出 BootROM 行 |
| ③ | "system_server 起 Launcher（桌面）" | Launcher 是**独立 App 进程**，由 **AMS 解析 HOME Intent** 拉起，不是 system_server 的子服务 | 改为"AMS 解析 HOME Intent 拉起 Launcher 进程" |
| ④ | 救砖表："厂商私有下载模式 → 二级损坏，一级还活着" | **EDL/9008 实现在 PBL（BootROM）里**，比一级加载器更深，**一级挂了也能进**。原文把方向带偏 | 改为"BootROM 级，比一级加载器还深" |
| ⑤ | "'L1/L2' 更多是 MTK 语境说法" | MTK 官方术语是 **preloader** 和 **LK**，没有"L1/L2"的说法 | 删除此说法，改为按职责对照 |
| ⑥ | "init 在 system 分区随镜像更新" | Android 10 起有 **first-stage init 跑在 boot.img 的 ramdisk** | 改为"boot.img ramdisk + /system/bin/init"，并补 first/second stage 划分 |
| ⑦ | "SPDownload（跑在一级）" | 厂商名应为 **SP Flash Tool**；且 MTK 深层救砖靠 **BROM 模式**（BootROM），不只是 preloader | 更正名称并区分 BROM 模式 / Preloader 模式 |
| ⑧ | AOSP 覆盖范围的 ASCII 框图 | 中文宽度导致**对齐错乱**，且第二个括号从 Kernel 开始，与"Kernel 一半一半"矛盾 | 改成表格 |

**严重度分级**：①②④ 会实际误导排查；③⑥ 精度问题；⑤⑦⑧ 表述问题。

### 二、补充的缺失内容

1. **验证链**：原文只在"一级加载器"提 secure boot。实际有三段独立机制——Secure Boot（芯片级）、AVB（bootloader 级，验 vbmeta）、dm-verity（运行时）。并补了 vbmeta 的作用和四色设备状态。
2. **A/B 分区**：双槽机制及"刷了 A 槽但跑在 B 槽"的坑。
3. **各阶段日志获取方式**：一张表说明 BootROM/一级加载器只有串口，没有软件途径。
4. **fastbootd vs bootloader fastboot**：前者刷动态分区（用户态），后者刷物理分区。
5. **卡 bootlogo vs 卡 bootanimation 的判据**：能出 logo 说明 kernel 已起来，可把排查范围砍一半。
6. **MTK 专章**（第 2.5 节）：完整解释 preloader 和 LK 是什么、串口 log 分段特征、SP Flash Tool 的两种模式。

### 三、确认无误、原样保留的部分

- 多级引导链的通用模型、为什么必须多级
- "校验 → 加载 → 跳转"三步、控制权单向
- bootloader / fastboot 的关系辨析
- init 是 PID 1、Android 第一个用户态进程
- 两段划分（Boot chain vs Android 启动）及工具链差异
- 知识归属表（计组只占一小块）
- 分诊表的各级现象和常见原因

### 四、结构调整

- 平铺四部分 → 六节 + 导读 + 附录速记
- 全部 ASCII 框图（中文宽度错位）→ 表格
- 新增「30 秒导读」「一句话记忆版」「MTK 专章」
- 文首增加挂载标记，指向 `Android-Framework-地图.md`

## 批次 2（2026-10-28）：新增自检清单 + 「时间不够读哪里」提示

**性质**：纯增补，未改动任何已有内容。

- 新增 `## 自检清单`（7 条，每条标注"不会就看第 X 节"，把清单变成导航）
- 在导读 / 结论处补一句"时间不够就只读哪两节"

> **动机**：读者反馈"抓不到重点"。长文档需要两个东西——
> **入口捷径**（时间不够读哪两节）和**可自测的出口**（自检清单）。

---


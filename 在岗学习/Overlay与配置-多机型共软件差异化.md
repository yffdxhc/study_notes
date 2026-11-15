# Overlay 与配置：多机型共软件的差异化怎么做

> 用途：搞清「**同一套软件、不同硬件参数**」这件事，AOSP 提供了哪几层机制，以及客制化是怎么把它们收口的。
> 挂载：[Android-Framework-地图](../android学习/Android-Framework-地图.md) → **PMS（overlay 挂载）/ 资源系统（Resources）/ 启动（property）**
> 脱敏说明：文中用「**项目 A / 项目 B**」代指具体机型，用 `vendor.` 前缀代指厂商命名空间。实际对应关系记在本地，不进网盘。

---

## 0. 30 秒导读

| 一句话 | 在哪节 |
|---|---|
| AOSP 处理"同代码不同硬件"有**四层**机制：设备分离 / 编译期 overlay / 运行期 RRO / 运行期 property | 二 |
| 差异只是**资源**（尺寸、颜色、boolean）→ 用 **overlay** | 三 |
| 差异只是**开关/分支**（走哪套逻辑）→ 用 **property** | 四 |
| 要区分**同型号不同 SKU** → AOSP 原生靠 `ro.boot.product.hardware.sku` | 五 |
| 客制化只是把这几层**收口**成一份配置，**绕不过底层** | 六 |

> **时间不够只读第二节（四层机制表）和第五节（SKU 怎么区分）。**

---

## 一、问题长什么样

两个机型**共用一套软件**（同一份代码、同一个 product），但硬件参数不同——比如屏幕的**物理圆角半径**不一样。

矛盾点：

- 代码里只有一份逻辑，**编译期无法区分**
- 但 UI 渲染要按"这台机器的实际圆角"来裁剪
- 于是必须在**运行期**告诉系统："我是哪个硬件变体，该用哪套参数"

> 这个矛盾在 AOSP 里同样存在（Pixel 也有多个变体），所以 AOSP 早就给了几层机制。
> **先看懂 AOSP 怎么解决，再看客制化怎么改。**

---

## 二、AOSP 的四层机制（核心表）

| # | 层 | 机制 | 生效时机 | 典型用途 | 在家能学 |
|---|---|---|---|---|---|
| 1 | **编译期** | 一个机型一个 `device/<vendor>/<device>/` 目录 | 编译时 | 彻底不同的机型 | ✅ 看 AOSP 的 `device/` 样例 |
| 2 | **编译期** | 静态 overlay：`PRODUCT_PACKAGE_OVERLAYS` | 编译时**打包进 APK** | 少量资源差异 | ✅ AOSP 里有大量用例 |
| 3 | **运行期** | **RRO**（Runtime Resource Overlay）APK | 开机后由 PMS 挂载 | 同一 APK 换一套资源 | ✅ 机制完全开源 |
| 4 | **运行期** | **system property**：`ro.*` / `ro.boot.*` | 极早（init 阶段） | 行为开关、SKU 标识 | ✅ 开源 |

**两个关键判断：**

| 差异是什么 | 用哪层 |
|---|---|
| **资源值**不同（dimen / color / bool / string） | overlay（第 2 或 3 层） |
| **走哪条代码分支**不同 | property（第 4 层） |
| 两者都有 | 通常：property 定"我是谁"，overlay 给"我的资源" |

> **记住这一条：资源找 overlay，开关找 property。** 后面所有客制化都是这两条的变体。

---

## 三、资源层：overlay 的两种形态

### 3.1 编译期 overlay（静态，打进 APK）

在 `device.mk` / `product.mk` 里：

```makefile
PRODUCT_PACKAGE_OVERLAYS += device/<vendor>/<device>/overlay
```

目录结构镜像目标包的资源路径：

```
overlay/
└── frameworks/base/core/res/res/values/config.xml   ← 只写要改的项
```

**特点**：编译时就合并进 `framework-res.apk`，运行时**看不出来**（没有额外 APK）。

### 3.2 运行期 RRO（独立 APK，可热换）

一个**只含资源、不含代码**的 APK，声明要覆盖哪个包：

```xml
<manifest ...>
    <overlay
        android:targetPackage="com.android.systemui"
        android:isStatic="true"
        android:priority="1" />
    <application android:hasCode="false" />
</manifest>
```

**放在哪**：`/vendor/overlay/`、`/product/overlay/`、`/system/overlay/`
（**厂商资源通常放 `/vendor/overlay/`**）

**⚠️ Android 10+ 的硬门槛**：目标资源必须**声明为可覆盖**，否则 overlay 无效：

```xml
<!-- 目标包里 res/values/overlayable.xml -->
<overlayable name="ThemeResources">
    <policy type="public">
        <item type="dimen" name="rounded_corner_radius" />
    </policy>
</overlayable>
```

> 这是排查"**overlay 明明放了却不生效**"的第一嫌疑点。

**多个 overlay 的叠加顺序**：`isStatic` + `priority` 决定，数字大的盖小的。

### 3.3 验证命令（这是硬技能）

```bash
# 列出所有 overlay 及其状态
cmd overlay list

# 看某个目标包被谁覆盖了
cmd overlay list --user 0

# 详细转储（target、priority、是否启用）
dumpsys overlay

# 单独启停一个 RRO
cmd overlay enable <包名>
cmd overlay disable <包名>
```

### 3.4 圆角在 AOSP 里的位置（映射示例）

AOSP 里，屏幕圆角是 **SystemUI 画出来的遮罩**，尺寸来自**资源**——所以天然可以用 overlay 改。

> ⚠️ **待核实**：具体资源名（`rounded_corner_radius*` 一类 dimen）和绘制类（`ScreenDecorations`）以你手上源码为准，写到笔记里之前先 `grep` 确认。
> 命令：`grep -rn "rounded_corner_radius" frameworks/base/packages/SystemUI/res/values/`

**这就是为什么"改 R 角"这件事天然属于 overlay 层**——它是个资源值，不是代码逻辑。

---

## 四、属性层：property

### 4.1 `ro.*` 的特性

| 特性 | 说明 |
|---|---|
| **只读** | `ro.` 前缀的属性**只能设一次**，设完不可改 |
| **极早** | init 阶段就设置好，比任何 App 都早 |
| **快** | 读取走共享内存，无 Binder 开销 |
| **全局** | 所有进程可读 |

### 4.2 从哪来

| 来源 | 写法 |
|---|---|
| `system.prop` / `vendor.prop`（模块目录） | 直接写 `key=value` |
| product 配置 | `PRODUCT_SYSTEM_PROPERTIES` / `PRODUCT_VENDOR_PROPERTIES` / `PRODUCT_PROPERTY_OVERRIDES` |
| **kernel cmdline / bootconfig** | `androidboot.xxx=yyy` → 变成 `ro.boot.xxx` |

### 4.3 读取

```bash
adb shell getprop | grep <前缀>
adb shell getprop ro.boot.product.hardware.sku
```

代码里：`__system_property_get()`（native）/ `SystemProperties.get()`（Java，仅系统可用）。

---

## 五、SKU：AOSP 原生怎么区分同一型号的变体

**关键属性（AOSP 官方机制）：**

```
ro.boot.product.hardware.sku
```

来源：kernel cmdline 里的 `androidboot.product.hardware.sku=xxx`。

**AOSP 里的标准玩法：**

```
① 用 SKU 值区分硬件变体
      ro.boot.product.hardware.sku = "sku1" / "sku2"
              ↓
② 按 SKU 加载不同的 overlay / 资源
      或者代码里读这个 property 走不同分支
```

> **所以"共软件 + 不同硬件参数"在 AOSP 里的标准答案就是：**
> **用 `ro.boot.*` 标记身份，用 overlay 提供该身份的差异资源。**

**这是本节最该带走的一句话**——客制化不管包装成什么样，底层一定是这两个动作的组合。

---

## 六、客制化怎么把它收口（对应第③段：客制化改在哪）

### 6.1 客制化的做法

不去为每个变体建 device 目录、也不一定用 RRO，而是：

```
构建期：多层配置逐层合并 → 生成一份汇总配置 → 打进 vendor 分区
        （全机型公共 → 平台级 → 项目级 → SKU 级 → 内外销）

运行期：系统进程启动时读这份配置
        把配置里的 section 当 feature flag
        → 决定走哪套逻辑、用哪套参数
```

本节用到的抽象命名（实际名称不落盘）：

| 本文写法 | 说明 |
|---|---|
| `vendor_config.ini` | 合并后的最终汇总配置 |
| `[vendor.feature.xxx]` | feature flag 的 section |
| `SKU 级覆盖文件` | 只对某个硬件变体生效的最后一层 |

### 6.2 和 AOSP 对照

| 客制化机制 | AOSP 的等价物 | 差别 |
|---|---|---|
| **多层配置逐层合并** | 多 `device/` 目录 + 多个 overlay 叠加 | AOSP 靠"目录分离 + priority"，这里靠"文件层的覆盖顺序" |
| **汇总配置里的 section** | `ro.*` system property | 这里是"一个文件里很多节"，AOSP 是"一个属性一行" |
| **SKU 级覆盖文件** | 不同 `device` 目录 / `ro.boot.product.hardware.sku` 分支 | 这里编译期就选定了，AOSP 常常是运行期判 property |
| **构建期合并工具** | `PRODUCT_PACKAGE_OVERLAYS` 的合并 | 这里是**配置层**合并，overlay 是**资源层**合并 |

### 6.3 本质

> **它把 AOSP 里"编译期的多目录 / 多 overlay"，换成了"一份配置 + 运行期分支"。**

| | AOSP 原生 | 客制化后 |
|---|---|---|
| 差异决定时机 | 编译期（选哪个目录、哪个 overlay） | **编译期合并，运行期读** |
| 表达方式 | 目录 / APK / property | **INI section** |
| 加一个变体 | 加目录 + 改 product 配置 | **加一个覆盖文件** |
| 优点 | 层次清晰、工具链原生 | **一个文件管几十个开关**，不用为每个 SKU 建目录 |
| 代价 | 变体多了目录爆炸 | **变成自定义体系，AOSP 文档和工具查不到**；排错要靠"读最终配置" |

> ⚠️ **这张表的右列就是"为什么你必须还懂 AOSP"**：
> 客制化体系**没有官方文档**，出问题时唯一能依靠的就是"它等价于 AOSP 的哪一层"。

---

## 七、怎么定位这类问题

### 7.1 典型症状

- 某个 UI 参数不对，**且只有某个项目 / 某个 SKU 有问题**
- 同一份代码，**A 机型正常、B 机型异常**
- 修改某个配置后行为变了，但**搜代码搜不到**

### 7.2 定位顺序

| 步 | 做什么 | 命令 / 动作 |
|---|---|---|
| 1 | **先判断是"资源"还是"开关"** | 换个值能修 → 资源；要改分支 → 开关 |
| 2 | 如果是资源，看有没有 overlay | `cmd overlay list`、`dumpsys overlay` |
| 3 | 如果是开关，看 property | `getprop \| grep <前缀>` |
| 4 | 找不到 → 找**最终生效的配置文件** | 去 vendor 分区 `ls /vendor/etc/` |
| 5 | 确认**我是哪个 SKU** | `getprop ro.boot.product.hardware.sku` |
| 6 | 判断改哪层 | 见下表 |

### 7.3 改哪层的判据

| 现象 | 该改哪层 |
|---|---|
| 值不对外暴露、纯资源 | overlay（静态或 RRO） |
| 需要在运行期切换、或要标身份 | property |
| 只是某个 SKU 差一点 | SKU 级覆盖 |
| 逻辑本身不同 | 代码分支（property 驱动） |

---

## 八、自检清单

> **用法**：不查资料能说出/做到就打勾。勾不上的，箭头指向该去读哪一节。

- [ ] 能背出 AOSP 的**四层差异化机制**，并各说一个使用场景 → 二
- [ ] 能用一句话区分：**资源找 overlay，开关找 property** → 二
- [ ] 能说出**编译期 overlay** 和 **RRO** 的三个区别（形态 / 生效时机 / 能否热换） → 三
- [ ] 能说出 Android 10+ 里 RRO **不生效**的头号原因（目标资源没声明 `overlayable`） → 3.2
- [ ] 能默写三个验证命令：`cmd overlay list` / `dumpsys overlay` / `getprop` → 3.3
- [ ] 能说出 AOSP 原生**区分 SKU** 的属性名 → 五
- [ ] 能说清客制化那套**等价于 AOSP 的哪几层**，以及它省掉了什么、多了什么代价 → 6.2 / 6.3
- [ ] 拿到"A 机型正常 B 机型异常"，能按六步走一遍 → 7.2

---

## 附：一句话记忆

> **资源找 overlay，开关找 property，身份找 `ro.boot.product.hardware.sku`。**
>
> **AOSP 的做法：多目录 + 多 overlay + 多属性；客制化的做法：一份合并后的配置 + 运行期分支。**
> **本质是同一件事的两种包装——所以看懂 AOSP，才看得懂包装。**

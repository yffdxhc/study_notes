# 在岗学习-EdgeToEdge与Insets-应用顶部间距异常 — 修订记录

> 对应正文：[在岗学习/EdgeToEdge与Insets-应用顶部间距异常.md](../在岗学习/EdgeToEdge与Insets-应用顶部间距异常.md)
> 原文件：`在岗学习/新建 文本文档.md`

---

## 批次 1（2026-11-05）：按模块定位重构 + 脱敏

**性质**：调整**叙述重心与措辞**，技术结论不变。

### 一、定位调整（最重要）

原文是「一个具体 bug 的分析报告」：问题 → 代码修改 → 触发条件 → 背景知识。

按本模块的定位（**只写 AOSP / 平台的标准行为，公司客制化只作第③段**），重心改为：

| 原文占比 | 整理后占比 |
|---|---|
| 约 40% 是**公司 patch 与触发条件** | 压缩到第六节，且**不贴 patch 原文** |
| 约 60% 是背景知识 | **扩成第二~五节，成为主体** |

**核心变化**：从「这个 bug 怎么修」→ **「系统栏 insets 的职责边界在 AOSP 里怎么划，边界一变会出哪两类问题」**。

### 二、脱敏

| 原文 | 处理 |
|---|---|
| 应用名（两个真实 App） | → **应用 A**（不监听 insets）／**应用 B**（监听 insets） |
| 包名 `com.xxx.xxx` 白名单条件 | **删除具体包名**，只保留"包名白名单（客制化）"这一机制描述 |
| 公司 patch 的 19 行代码 + `import` | **不贴原文**。改为「思路：margin 赋值之后减掉一个状态栏高度」，并保留它用到的 **AOSP 接口**（`InsetsController.State` / `InsetsSource.getFrame()`） |

**保留的**（属公开 / AOSP 原生）：
- `DecorView.updateColorViews`、`PhoneWindow.isEdgeToEdgeEnforced`、`Window.mEdgeToEdgeEnforced`
- `LayoutParams.layoutInDisplayCutoutMode`、`DisplayPolicy.updateSystemBarsLw`、`WindowLayout`、`AppCompatLetterboxPolicy`、`SnapshotDrawerUtils`
- `InsetsController.State` / `InsetsSource` / `getFrame()`
- `KEEP_FULLSCREEN_TYPE_*` 的三态语义（**标注为客制化新增字段**）

### 三、结构调整

| 原文 | 整理后 |
|---|---|
| 五部分平铺，无层级 | **七节**：30 秒导读 → AOSP 背景 ×3 → 判成因 → 客制化 → 自检 |
| 无开篇结论 | **新增第 0 节「30 秒导读」**（含"只读哪两节"） |
| 三、触发条件表（空格对齐） | **标准表格**（5 条，缺一不可） |
| 与另一应用的方案对比（空格对齐） | 合并进 **5.1 判据表**，改为"按成因分类"而不是"按应用对比" |
| 无自检 | **新增第七节 9 条自检清单**（每条带 → 节号） |

### 四、新增内容

1. **3.3 改 margin vs 改 insets 分发** —— 原文只在"注意点"里提了一句，整理后单独成节，因为**这是"只修显示不干扰应用"的关键设计点**
2. **4.2 `getFrame()` vs `getInsets()`** —— 原文埋在第五部分，提成独立小节并加"为什么移动量要用前者"
3. **6.3 关键词回溯表** —— `keepFullScreen` / `mEdgeToEdgeEnforced` / `updateColorViews` / `InsetsSource.getFrame()` 各自挂在 AOSP 哪个环节
4. **6.4 客制化的三个工程代价** —— 白名单不可扩展 / 改动被 revert / 与 AOSP 语义漂移
5. **5.2 定位顺序六步** —— 把原文散落的"排查要点"整理成可执行顺序

### 五、一句关键判断（整理时得出的）

> 这套机制里，**只有 `keepFullScreen` 是客制化新增的**；
> `mEdgeToEdgeEnforced`、`updateColorViews`、`InsetsSource` **全是 AOSP 原生**。
> 也就是说 **这个问题的 90% 是 AOSP 知识，在家完全能学**——这正是本模块要放大的部分。

# 笔记

个人学习笔记，纯 Markdown，用 **Typora** 阅读（图片是手写 SVG，GitHub 上也能直接看）。

## 目录

| 目录 | 内容 |
|---|---|
| `408/` | 考研 408 · C 语言（第 1~4 章笔记 + 每章速记） |
| `android学习/` | [Android-Framework-地图.md](android学习/Android-Framework-地图.md)（知识地图）+《Android 面试必问：AMS、WMS 核心原理》13 讲笔记 + 速记 |
| `在岗学习/` | Framework 实战：开机流程、AOSP 源码导读、锁屏闪屏、Overlay、Edge-to-Edge |
| `每日力扣/` | LeetCode 刷题记录 |
| `享学android一期/` | 早期课程笔记 |
| `.修订记录/` | 各文档的整理/勘误过程 |

根目录还有：`学习计划.md`、`虚拟机SSH连接说明.md`。

## 为什么 `.photo/` 不在仓库里

`.photo/` 是课程素材（视频、安装包、pptx），共 **4.6 GB**，其中多份单文件超过 GitHub 的 **100 MB 硬限制**。
它由百度网盘同步，**不进版本库**。图片引用如需使用，只在本地有效。

详见 `.gitignore`。

## 日常使用

```bash
git add -A
git commit -m "更新：xxx"
git push
```

想找回某次改动：`git log --oneline` → `git show <commit>`。

## 一个已知风险

这个目录同时被**百度网盘同步**，`.git/` 也在同步范围内。
同步客户端与 git 同时写 `.git/` 可能导致仓库损坏。真坏了不用慌：

```bash
# 备份工作区后重新克隆
git clone git@github.com:yffdxhc/notes.git 笔记-new
```

所以**每次大改之后记得 push**，GitHub 那份才是保险。

# Flutter

> 目的：
> 
> - 了解Flutter是什么，为什么很火
> 
> - 为什么要学习Flutter
> 
> - Flutter的环境搭建

![课程流程](file:///D:/BaiduNetdiskDownload/%E7%99%BE%E5%BA%A6%E5%90%8C%E6%AD%A5/BaiduSyncdisk/%E7%AC%94%E8%AE%B0/.photo/%E3%80%9001%E3%80%91flutter---lance%E8%80%81%E5%B8%88/%EF%BC%8801%EF%BC%892019.02.28%20flutter%E7%AC%AC%E4%B8%80%E8%8A%82%E8%AF%BE(lsn_flutter%E4%BB%8B%E7%BB%8D%E4%B8%8E%E7%8E%AF%E5%A2%83%E5%AE%89%E8%A3%85%EF%BC%89/%E5%9B%BE%E7%89%87/%E8%AF%BE%E7%A8%8B%E6%B5%81%E7%A8%8B.png "目录")

## 一、跨平台开发

Flutter是跨平台的ui框架

传统的原生开发一般都要维护Android、ios两个开发团队，版本迭代时，无论人力成本，还是测试成本都会变大。

使用Flutter开发，真正的一套代码多端使用(比RN等框架更能体现一套代码多端使用的优势)，增加代码复用，降低人力和开发成本。 

## 二、Flutter

> 移动平台发展史
> 
> - 原生开发
> 
> - H5
> 
> - Rect Native
> 
> 什么是Flutter
> 
> - 跨平台框架
> 
> - Flutter介绍
> 
> - Flutter发展史
> 
> - Flutter的特点
> 
> - Dart语言
> 
> - 总结
> 
> 开发环境配置

### 移动平台发展史

#### 第一阶段：原生开发（性能和稳定，但开发成本大）

- 开发成本大

原生开发一般都要维护Android、ios两个开发团队，版本迭代时，人力成本，开发成本，测试成本都会变大。

- 动态化需求

当需求发生变化时，纯原生应用大多数需要通过版本升级来更新内容，不乏版也可以更新应用内容的需求就变的迫在眉睫。

#### 第二阶段：H5

WebView担任JavaScript与原生API之间通信的桥梁(Bridge)。

用于在JavaScript与原生之间通信的工具称之为**WebView JavaScript Bridge(JsBridge)**。

<mark>WebView性能堪忧</mark>

工具：08年，phonegap(Cordova)框架，核心依赖android原生的webView

![cordova工作机制](file:///D:/BaiduNetdiskDownload/%E7%99%BE%E5%BA%A6%E5%90%8C%E6%AD%A5/BaiduSyncdisk/%E7%AC%94%E8%AE%B0/.photo/%E3%80%9001%E3%80%91flutter---lance%E8%80%81%E5%B8%88/%EF%BC%8801%EF%BC%892019.02.28%20flutter%E7%AC%AC%E4%B8%80%E8%8A%82%E8%AF%BE(lsn_flutter%E4%BB%8B%E7%BB%8D%E4%B8%8E%E7%8E%AF%E5%A2%83%E5%AE%89%E8%A3%85%EF%BC%89/%E5%9B%BE%E7%89%87/cordova%E5%B7%A5%E4%BD%9C%E6%9C%BA%E5%88%B6.png)

webview缺点：

手机厂商不一样，实现细节不一样，兼容性问题

加载html缓慢

Js代码属于解释型语言，执行性能太低

tip：java编译成.class，.class在虚拟机中解释执行，算混合型

一般将webview放到单独的进程中使用，webview有内存泄漏的问题(2026年不知道解决没有)，最终导致OOM。

内存泄漏：消耗的内存没有办法在不使用的时候及时回收

有性能需求和稳定性需求就不会使用webview开发，只用来显示问卷调查之类的。

总结：

WebView 承载 H5，JsBridge 连接 JS 与原生，Cordova/PhoneGap 是代表。优点是跨平台、开发快、可热更新；缺点是性能差、兼容性差、内存泄漏/OOM、体验不如原生。只适合问卷、活动页、协议页等轻交互场景，不适合核心高性能业务。WebView 是容器，JsBridge 才是桥；WebView 内部渲染不跨桥，只有 JS 调原生、原生调 JS 才跨桥。

#### 第三阶段:跨平台

H5作为第二阶段的性能瓶颈，RN通过桥梁完成原生绘制，以达到更优的性能。

- JavaScript通过bridge传递到native完成原生绘制，bridge的成本高，因为需要频繁的跨桥调用，导致卡顿等性能问题。

facebook公布的Rect Native(RN)，它的代码本质也是JS，解决使用webView带来的各种性能问题。

工作机制：

![rn工作机制](D:\BaiduNetdiskDownload\百度同步\BaiduSyncdisk\笔记\.photo\【01】flutter---lance老师\（01）2019.02.28%20flutter第一节课(lsn_flutter介绍与环境安装）\图片\rn工作机制.png)



我们写的JS代码通过桥梁和平台(ios、android)进行交互。不再使用webview进行渲染，通过桥梁把JS写好的配置发给平台，比如android通过读取、解析写好的配置，然后new一个textview，与原生开发类似。JS写的都是配置文件，通过bridge发给平台，平台通过配置创建对应的view。RN的渲染方式和第二种webview渲染不一样，它使用原生的方式来渲染。它的配置文件都是JS写的，多了一层桥梁来把配置文件发给平台。

但是写好的xml是静态的，更新ui直接在java中更新。RN当中改两套代码还有桥梁，桥梁的压力很大，只要有更新，bridge都要更新。

需要进行频繁的跨桥调用（**旧版 RN 中，JS 要驱动原生 UI 或调用原生能力，通常要经过 Bridge；但并非所有静态、动态逻辑都跨桥，布局、原生动画、纯 JS 逻辑等都不跨。新架构则转向 JSI/Fabric/TurboModules，不能简单说“都跨桥”。**）

### 什么是Flutter

18年进入视野

Flutter 不是把 Dart 转成 Java/Kotlin/Swift，而是 release 下 AOT 编译成机器码，并自带 Skia/Impeller 自绘 UI。它不依赖原生控件，原生平台只提供画布、事件、生命周期和底层能力；需要原生能力时通过 Platform Channel/FFI 调用。相对 RN：RN 是 JS + 原生控件 + Bridge/JSI，Flutter 是 Dart + 自绘引擎 + AOT 机器码。说“Flutter 把写的语言转换为原生语言”不准确，应该说“编译为原生机器码，UI 自绘”。

#### Flutter介绍

Flutter是谷歌的移动UI框架，可以快速在IOS和Android上构建高质量的原生用户界面。Flutter可以与现有的代码一起工作。在全世界，(2018)Flutter正在被越来越多的开发者和组织使用，并且Flutter是完全免费、开源的。

![flutter工作机制](D:\BaiduNetdiskDownload\百度同步\BaiduSyncdisk\笔记\.photo\【01】flutter---lance老师\（01）2019.02.28%20flutter第一节课(lsn_flutter介绍与环境安装）\图片\flutter工作机制.png)

利用DVM(dart虚拟机)减少桥的交互



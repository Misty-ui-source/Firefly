---
title: 如何使用cloudflare workes 功能搭建代理节点
published: 2025-10-25
updated: 2025-10-26
tags:
  - Cloudflare
  - 教程
  - VPS
description: 内容来自YouTube大佬：seven科技生活。作为一名技术小白，一步步跟着他做也成功搭建出自己的节点，并且能解锁x，chatgpt和gemini，能秒开高帧视频，使用体验也是不错的。
image: ./demo-avatar 1.png
category: 教程
draft: false
---
### 准备工作

好了，前面说了这么多，下面说说需要准备的东西吧。

首先，你需要准备一个GitHub账号登陆在网页上面，方便操作。最好有一个cloudflare账号，没有也没关系，登陆进去使用邮箱注册一个就好。

之后需要把你自己的域名托管在cf上，后续我会出一个申请免费域名并托管到cf上的教程。

这里附上链接：
github：
https://github.com

cloudflare:
https://dash.cloudflare.com/

然后，如果你电脑上没有代理，你需要在你的edge扩展里面下载并运行ilink,用于加速GitHub（如果你有watt tooltik，可以使用它来加速，效果会更好。但是强烈建议要有一个能加速浏览器的代理，例如ilink,保证你自己好。）

废话不多说准备开干！

第一步就是进入到cloudflare账号界面：
![](./b.png)
图上可以看到啊我现在有三个域名，其实都是免费申请的，这里只需要任意选择一个就好，当作备用。

之后展开**computer&AI**选项找到**workers&pages**，点进去：
![](./a.png)
点击右上角的**创建新项目**，之后点击最下面的**workers**栏**start with hello world**。
稍等片刻进入设计页面:

![](./c.png)
点击右上角的**Edit code**白色方块，这个时候我们要进入甬哥的项目，项目地址我放在下面：
[https://github.com/yonggekkk/Cloudflare-vless-trojan]()

![](./d.png)
![]()

选择我圈出来的文件夹，这个时候我们可以看到四个代码，其中有几个已经失效，代码说明我放在下面：
![](./e.png)

我们选择套壳混淆，进去选择copy，这个时候回到cloudflare代码编辑部份，删掉原来的代码，将我们刚复制的部分粘贴到上面。
点击deploy,成功会出现以下图象。
![](./f.png)

这时候我们要更改一下uuid，可以直接浏览器搜索uuid生成器，复制。

![](./g.png)

找到变量与密码这一部分，点击添加，第一栏写uuid,第二栏粘贴上刚复制的uuid。
![](./h.png)

下面呢我们就开始添加域名，便于我们找到部署的节点链接页面，其实你也可以在**Domains & Routes** 一栏点击cf自动给你生成的地址进入节点部署链接页面。（进入需要代理）
但是我还是建议自己部署一个域名。
![](./i.png)

找到**Domains & Routes** 一栏点击add，添加自己的域名，这里可以再往下面写一级，即在域名前面加上"www." 之类的。
下面我们找到uuid，按照以下格式进入上方搜索框：

”www. 自己的域名/uuid“ 的形式回车，就能看到部署页面啦！

推荐使用clash订阅链接，速度超快，看视频毫无压力！

好了，这个内容就写到这里，如果有相关方面的疑问可以联系我。
欢迎大家批评指正！
### 阅读 Express 源码

> version:4.18.1

**基本流程**

![image-20220518011332709](./img/Snipaste_2022-05-18_01-17-13.png)

**总结**

1. express 中间件的触发,主要就是外部访问,从所有存储的中间件 layer 的 stack 数组中找到匹配中间件 layer 执行
2. layer.handle_request_fn(req,res,next),实际上就是执行 layer.handle
3. 而以前就是把中间件函数挂载在 layer.handle 上,实际上就是执行中间件函数,并且把 next 当做参数穿进去
4. 当使用的时候调用了 next,继续去 stack 数组中查找下一匹配的中间件 layer,直到找到为止
5. 当找到为止,就是执行完所有的中间件函数,并且把请求转发到下一个中间件

**参考**

- [三步法解析 Express 源码](https://juejin.cn/post/6884575671721394189)

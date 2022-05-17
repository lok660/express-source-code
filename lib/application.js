/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var finalhandler = require('finalhandler');
var Router = require('./router');
var methods = require('methods');
var middleware = require('./middleware/init');
var query = require('./middleware/query');
var debug = require('debug')('express:application');
var View = require('./view');
var http = require('http');
var compileETag = require('./utils').compileETag;
var compileQueryParser = require('./utils').compileQueryParser;
var compileTrust = require('./utils').compileTrust;
//  判断 express 某些方法是否过期
var deprecate = require('depd')('express');
//  展平嵌套数组
var flatten = require('array-flatten');
//  对象合并
var merge = require('utils-merge');
var resolve = require('path').resolve;
var setPrototypeOf = require('setprototypeof')

/**
 * Module variables.
 * @private
 */

var hasOwnProperty = Object.prototype.hasOwnProperty
var slice = Array.prototype.slice;

/**
 * Application prototype.
 */

var app = exports = module.exports = {};

/**
 * Variable for trust proxy inheritance back-compat
 * @private
 */

var trustProxyDefaultSymbol = '@@symbol:trust_proxy_default';

/**
 * Initialize the server.
 *
 *   - setup default configuration
 *   - setup default middleware
 *   - setup route reflection methods
 *
 * @private
 */

app.init = function init () {
  //  view模板引擎缓存: render 第一个参数模板名 name 为 key, 对应的 view 实例为 value
  this.cache = {};
  //  存储模板引擎: 文件扩展为 key, 解析引擎 fn 为 value
  this.engines = {};
  //  this.set 设置所有的 key 和value
  this.settings = {};
  //  配置初始化
  this.defaultConfiguration();
};

/**
 * Initialize application configuration.
 * @private
 */

app.defaultConfiguration = function defaultConfiguration () {
  var env = process.env.NODE_ENV || 'development';

  // default settings
  this.enable('x-powered-by');
  this.set('etag', 'weak');
  this.set('env', env);
  this.set('query parser', 'extended');
  this.set('subdomain offset', 2);
  this.set('trust proxy', false);

  // trust proxy inherit back-compat
  //  this.settings 设置 trustProxyDefaultSymbol 属性为 true
  Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
    configurable: true, //  可配置
    value: true //  值为 true
  });

  debug('booting in %s mode', env);

  //  在 app.use 时触发 mount
  this.on('mount', function onmount (parent) {
    // inherit trust proxy
    if (this.settings[trustProxyDefaultSymbol] === true
      && typeof parent.settings['trust proxy fn'] === 'function') {
      delete this.settings['trust proxy'];
      delete this.settings['trust proxy fn'];
    }

    // inherit protos
    setPrototypeOf(this.request, parent.request)
    setPrototypeOf(this.response, parent.response)
    setPrototypeOf(this.engines, parent.engines)
    setPrototypeOf(this.settings, parent.settings)
  });

  // setup locals
  this.locals = Object.create(null);

  // top-most app is mounted at /
  this.mountpath = '/';

  // default locals
  this.locals.settings = this.settings;

  // default configuration
  this.set('view', View);
  this.set('views', resolve('views'));
  this.set('jsonp callback name', 'callback');

  if (env === 'production') {
    this.enable('view cache');
  }

  //  设置路由
  Object.defineProperty(this, 'router', {
    get: function () {
      throw new Error('\'app.router\' is deprecated!\nPlease see the 3.x to 4.x migration guide for details on how to update your app.');
    }
  });
};

/**
 * lazily adds the base router if it has not yet been added.
 *
 * We cannot add the base router in the defaultConfiguration because
 * it reads app settings which might be set after that has run.
 *
 * @private
 */
app.lazyrouter = function lazyrouter () {
  if (!this._router) {
    //  实例化路由 Router
    this._router = new Router({
      caseSensitive: this.enabled('case sensitive routing'),
      strict: this.enabled('strict routing')
    });
    //  调用路由的 use 方法
    this._router.use(query(this.get('query parser fn')));
    this._router.use(middleware.init(this));
  }
};

/**
 * Dispatch a req, res pair into the application. Starts pipeline processing.
 *
 * If no callback is provided, then default error handlers will respond
 * in the event of an error bubbling through the stack.
 *
 * @private
 */

app.handle = function handle (req, res, callback) {
  var router = this._router;

  // final handler
  var done = callback || finalhandler(req, res, {
    env: this.get('env'),
    onerror: logerror.bind(this)
  });

  // no routes
  if (!router) {
    debug('no routes defined on app');
    done();
    return;
  }

  router.handle(req, res, done);
};

/**
 * Proxy `Router#use()` to add middleware to the app router.
 * See Router#use() documentation for details.
 *
 * If the _fn_ parameter is an express app, then it will be
 * mounted at the _route_ specified.
 *
 * @public
 */

//  总结:app.use 最核心就是调用 router.use,本质上就是 router.use 的一层包装
//  在 app.use 中调用 router.use, 就是调用 router.use(path, router)
app.use = function use (fn) {
  var offset = 0;
  var path = '/';

  // default path to '/'
  // disambiguate app.use([fn])
  // fn 代表使用 app.use(fn) 时的第一位参数
  // 如果 fn 不是函数形式,那么就是 app.use('/',(req,res,next) => {})
  if (typeof fn !== 'function') {
    //  将第一位参数给 arg
    var arg = fn;
    //  如果是数组,取出第一位赋值给 arg
    while (Array.isArray(arg) && arg.length !== 0) {
      arg = arg[0];
    }

    // first arg is the path
    if (typeof arg !== 'function') {
      offset = 1;
      path = fn;
    }
  }
  //  将参数 arguments 从 offset 偏移量开始切割得到中间件函数数组
  //  offset: 如果第一位参数是路径,那么 offset=1,代表arguments从1之后的才是中间件函数
  //          否则offset=0
  var fns = flatten(slice.call(arguments, offset));

  //  没有传入中间件函数,报错
  if (fns.length === 0) {
    throw new TypeError('app.use() requires a middleware function')
  }

  // setup router
  // 通过 new Router 创建了 Router 实例挂载到 app._router上
  this.lazyrouter();
  // 从 app._router 上取出 Router 实例
  var router = this._router;

  // 遍历中间件函数数组
  fns.forEach(function (fn) {
    // non-express app
    // 第一次中间件的回调函数一般都没有 handle 和 set,即 fn.handle 和 fn.set 为undefined
    if (!fn || !fn.handle || !fn.set) {
      //  调用路由 use 方法
      return router.use(path, fn);
    }

    debug('.use app under %s', path);
    fn.mountpath = path;
    fn.parent = this;

    // restore .app property on req and res
    // 重置 req 和 res 的 app 属性,让 req 和 res 可以访问到 app 实例
    router.use(path, function mounted_app (req, res, next) {
      var orig = req.app;
      //  调用 fn 上面的 handle 方法
      fn.handle(req, res, function (err) {
        //  设置原型: req = Object.create(req.app.request)
        setPrototypeOf(req, orig.request)
        //  设置原型: res = Object.create(res.app.response)
        setPrototypeOf(res, orig.response)
        next(err);
      });
    });

    // mounted an app
    // 触发 mount 事件
    fn.emit('mount', this);
  }, this);

  //  返回 app 实例,方便链式调用
  return this;
};

/**
 * Proxy to the app `Router#route()`
 * Returns a new `Route` instance for the _path_.
 *
 * Routes are isolated middleware stacks for specific paths.
 * See the Route api docs for details.
 *
 * @public
 */

//  调用 router 实例的 route 方法
app.route = function route (path) {
  this.lazyrouter();
  return this._router.route(path);
};

/**
 * Register the given template engine callback `fn`
 * as `ext`.
 *
 * By default will `require()` the engine based on the
 * file extension. For example if you try to render
 * a "foo.ejs" file Express will invoke the following internally:
 *
 *     app.engine('ejs', require('ejs').__express);
 *
 * For engines that do not provide `.__express` out of the box,
 * or if you wish to "map" a different extension to the template engine
 * you may use this method. For example mapping the EJS template engine to
 * ".html" files:
 *
 *     app.engine('html', require('ejs').renderFile);
 *
 * In this case EJS provides a `.renderFile()` method with
 * the same signature that Express expects: `(path, options, callback)`,
 * though note that it aliases this method as `ejs.__express` internally
 * so if you're using ".ejs" extensions you don't need to do anything.
 *
 * Some template engines do not follow this convention, the
 * [Consolidate.js](https://github.com/tj/consolidate.js)
 * library was created to map all of node's popular template
 * engines to follow this convention, thus allowing them to
 * work seamlessly within Express.
 *
 * @param {String} ext
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */

//  设置模板引擎
//  app.engine('ejs', require('ejs').__express);
app.engine = function engine (ext, fn) {
  if (typeof fn !== 'function') {
    //  fn不是函数报错
    throw new Error('callback function required');
  }

  // get file extension
  //  获取模板引擎的后缀
  var extension = ext[0] !== '.'
    ? '.' + ext
    : ext;

  // store engine
  //  存储模板引擎
  this.engines[extension] = fn;

  return this;
};

/**
 * Proxy to `Router#param()` with one added api feature. The _name_ parameter
 * can be an array of names.
 *
 * See the Router#param() docs for more details.
 *
 * @param {String|Array} name
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */

app.param = function param (name, fn) {
  this.lazyrouter();

  if (Array.isArray(name)) {
    for (var i = 0; i < name.length; i++) {
      this.param(name[i], fn);
    }

    return this;
  }

  this._router.param(name, fn);

  return this;
};

/**
 * Assign `setting` to `val`, or return `setting`'s value.
 *
 *    app.set('foo', 'bar');
 *    app.set('foo');
 *    // => "bar"
 *
 * Mounted servers inherit their parent server's settings.
 *
 * @param {String} setting
 * @param {*} [val]
 * @return {Server} for chaining
 * @public
 */

//  给this.settings 对象下设置 key 和 value 分别为 setting 和val
app.set = function set (setting, val) {
  //  只传入一个参数: 返回 this.settings[setting]
  if (arguments.length === 1) {
    // app.get(setting)
    var settings = this.settings
    //  返回 settings[setting]
    while (settings && settings !== Object.prototype) {
      if (hasOwnProperty.call(settings, setting)) {
        return settings[setting]
      }

      settings = Object.getPrototypeOf(settings)
    }
    //  没有找到对应的setting
    return undefined
  }

  debug('set "%s" to %o', setting, val);

  // set value
  this.settings[setting] = val;

  // trigger matched settings
  switch (setting) {
    //  编译 compileETag
    case 'etag':
      this.set('etag fn', compileETag(val));
      break;
    //  编译 compileQueryParser
    case 'query parser':
      this.set('query parser fn', compileQueryParser(val));
      break;
    //  编译 compileTrust
    case 'trust proxy':
      this.set('trust proxy fn', compileTrust(val));

      // trust proxy inherit back-compat
      Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
        configurable: true,
        value: false
      });

      break;
  }

  return this;
};

/**
 * Return the app's absolute pathname
 * based on the parent(s) that have
 * mounted it.
 *
 * For example if the application was
 * mounted as "/admin", which itself
 * was mounted as "/blog" then the
 * return value would be "/blog/admin".
 *
 * @return {String}
 * @private
 */

//  返回绝对路径
app.path = function path () {
  return this.parent
    ? this.parent.path() + this.mountpath
    : '';
};

/**
 * Check if `setting` is enabled (truthy).
 *
 *    app.enabled('foo')
 *    // => false
 *
 *    app.enable('foo')
 *    app.enabled('foo')
 *    // => true
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */

//  返回 this.set(setting) 的结果
app.enabled = function enabled (setting) {
  return Boolean(this.set(setting));
};

/**
 * Check if `setting` is disabled.
 *
 *    app.disabled('foo')
 *    // => true
 *
 *    app.enable('foo')
 *    app.disabled('foo')
 *    // => false
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */

//  返回 !this.set(setting) 的结果
app.disabled = function disabled (setting) {
  return !this.set(setting);
};

/**
 * Enable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */

//  设置 this.set(setting,true) 的结果
app.enable = function enable (setting) {
  return this.set(setting, true);
};

/**
 * Disable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */

//  设置 this.set(setting,false) 的结果
app.disable = function disable (setting) {
  return this.set(setting, false);
};

/**
 * Delegate `.VERB(...)` calls to `router.VERB(...)`.
 */

//  app 下面挂在所有的 http 请求方法
methods.forEach(function (method) {
  app[method] = function (path) {
    //  get 请求 没有参数
    if (method === 'get' && arguments.length === 1) {
      // app.get(setting)
      return this.set(path);
    }
    //  调用 route 的 method 方法
    this.lazyrouter();

    var route = this._router.route(path);
    route[method].apply(route, slice.call(arguments, 1));
    return this;
  };
});

/**
 * Special-cased "all" method, applying the given route `path`,
 * middleware, and callback to _every_ HTTP method.
 *
 * @param {String} path
 * @param {Function} ...
 * @return {app} for chaining
 * @public
 */

/**
  router.all('*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:4000'); //设置Credentials，就不能设置*。【携带session】
  res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length, Authorization, Accept,X-Requested-With');
  res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('X-Powered-By', ' 3.2.1');
  if (req.method === 'OPTIONS') {
  res.send(200);
  }
  next();
}); 
 */
app.all = function all (path) {
  this.lazyrouter();
  //  拿到路由实例对象
  var route = this._router.route(path);
  var args = slice.call(arguments, 1);
  //  route 对应的 path 所有 method 都会调用
  for (var i = 0; i < methods.length; i++) {
    route[methods[i]].apply(route, args);
  }

  return this;
};

// del -> delete alias

app.del = deprecate.function(app.delete, 'app.del: Use app.delete instead');

/**
 * Render the given view `name` name with `options`
 * and a callback accepting an error and the
 * rendered template string.
 *
 * Example:
 *
 *    app.render('email', { name: 'Tobi' }, function(err, html){
 *      // ...
 *    })
 *
 * @param {String} name
 * @param {Object|Function} options or fn
 * @param {Function} callback
 * @public
 */

/**
  使用方法:
      app.set('views', path.join(__dirname, 'views'));
      app.set('view engine', 'jade');
      res.render('index');
 */
app.render = function render (name, options, callback) {
  var cache = this.cache;
  var done = callback;
  var engines = this.engines;
  var opts = options;
  var renderOptions = {};
  var view;

  // support callback function as second arg
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  // merge app.locals
  //  合并 app.locals
  merge(renderOptions, this.locals);

  // merge options._locals
  if (opts._locals) {
    // 合并传进来的  _locals
    merge(renderOptions, opts._locals);
  }

  // merge options
  //  合并 opts
  merge(renderOptions, opts);

  // set .cache unless explicitly provided
  if (renderOptions.cache == null) {
    //  确保 cache 开启
    renderOptions.cache = this.enabled('view cache');
  }

  // primed cache
  //  从缓存中获取 view  模板
  if (renderOptions.cache) {
    view = cache[name];
  }

  // view
  // 初始渲染的时候 cache 不存在
  if (!view) {
    //  获取view
    var View = this.get('view');

    //  从 views 根目录里面取到 name 模板,进行 view 视图实例化
    view = new View(name, {
      defaultEngine: this.get('view engine'),
      root: this.get('views'),
      engines: engines
    });

    //  不存在 path 路径,直接抛出异常
    if (!view.path) {
      var dirs = Array.isArray(view.root) && view.root.length > 1
        ? 'directories "' + view.root.slice(0, -1).join('", "') + '" or "' + view.root[view.root.length - 1] + '"'
        : 'directory "' + view.root + '"'
      var err = new Error('Failed to lookup view "' + name + '" in views ' + dirs);
      err.view = view;
      return done(err);
    }

    // prime the cache
    //  将 view 视图存入 cache 缓存
    if (renderOptions.cache) {
      cache[name] = view;
    }
  }

  // render
  //  调用 view render
  tryRender(view, renderOptions, done);
};

/**
 * Listen for connections.
 *
 * A node `http.Server` is returned, with this
 * application (which is a `Function`) as its
 * callback. If you wish to create both an HTTP
 * and HTTPS server you may do so with the "http"
 * and "https" modules as shown here:
 *
 *    var http = require('http')
 *      , https = require('https')
 *      , express = require('express')
 *      , app = express();
 *
 *    http.createServer(app).listen(80);
 *    https.createServer({ ... }, app).listen(443);
 *
 * @return {http.Server}
 * @public
 */

//  启动服务器 & 监听端口
app.listen = function listen () {
  var server = http.createServer(this);
  return server.listen.apply(server, arguments);
};

/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */

function logerror (err) {
  /* istanbul ignore next */
  if (this.get('env') !== 'test') console.error(err.stack || err.toString());
}

/**
 * Try rendering a view.
 * @private
 */

//  渲染模板
function tryRender (view, options, callback) {
  try {
    view.render(options, callback);
  } catch (err) {
    callback(err);
  }
}

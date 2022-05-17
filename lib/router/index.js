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

var Route = require('./route');
var Layer = require('./layer');
var methods = require('methods');
var mixin = require('utils-merge');
var debug = require('debug')('express:router');
var deprecate = require('depd')('express');
var flatten = require('array-flatten');
var parseUrl = require('parseurl');
var setPrototypeOf = require('setprototypeof')

/**
 * Module variables.
 * @private
 */

var objectRegExp = /^\[object (\S+)\]$/;
var slice = Array.prototype.slice;
var toString = Object.prototype.toString;

/**
 * Initialize a new `Router` with the given `options`.
 *
 * @param {Object} [options]
 * @return {Router} which is an callable function
 * @public
 */

var proto = module.exports = function (options) {
  var opts = options || {};

  //  定义 router 对象
  function router (req, res, next) {
    router.handle(req, res, next);
  }

  // mixin Router class functions
  // 混入 Router 类的方法,定义在 proto 中
  // 实际上 router.use 和 router.route 是在此混入的
  setPrototypeOf(router, proto)

  // 往 router 对象中添加属性
  router.params = {};
  router._params = [];
  router.caseSensitive = opts.caseSensitive;
  router.mergeParams = opts.mergeParams;
  router.strict = opts.strict;
  // 定义 stack 属性,用于存储中间件
  router.stack = [];
  // 返回 router 对象,在 new Router 后得到的就是这个 router 函数
  return router;
};

/**
 * Map the given param placeholder `name`(s) to the given callback.
 *
 * Parameter mapping is used to provide pre-conditions to routes
 * which use normalized placeholders. For example a _:user_id_ parameter
 * could automatically load a user's information from the database without
 * any additional code,
 *
 * The callback uses the same signature as middleware, the only difference
 * being that the value of the placeholder is passed, in this case the _id_
 * of the user. Once the `next()` function is invoked, just like middleware
 * it will continue on to execute the route, or subsequent parameter functions.
 *
 * Just like in middleware, you must either respond to the request or call next
 * to avoid stalling the request.
 *
 *  app.param('user_id', function(req, res, next, id){
 *    User.find(id, function(err, user){
 *      if (err) {
 *        return next(err);
 *      } else if (!user) {
 *        return next(new Error('failed to load user'));
 *      }
 *      req.user = user;
 *      next();
 *    });
 *  });
 *
 * @param {String} name
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */

proto.param = function param (name, fn) {
  // param logic
  if (typeof name === 'function') {
    deprecate('router.param(fn): Refactor to use path params');
    this._params.push(name);
    return;
  }

  // apply param functions
  var params = this._params;
  var len = params.length;
  var ret;

  if (name[0] === ':') {
    deprecate('router.param(' + JSON.stringify(name) + ', fn): Use router.param(' + JSON.stringify(name.slice(1)) + ', fn) instead')
    name = name.slice(1)
  }

  for (var i = 0; i < len; ++i) {
    if (ret = params[i](name, fn)) {
      fn = ret;
    }
  }

  // ensure we end up with a
  // middleware function
  if ('function' !== typeof fn) {
    throw new Error('invalid param() call for ' + name + ', got ' + fn);
  }

  (this.params[name] = this.params[name] || []).push(fn);
  return this;
};

/**
 * Dispatch a req, res into the router.
 * @private
 */

proto.handle = function handle (req, res, out) {
  var self = this;

  debug('dispatching %s %s', req.method, req.url);

  var idx = 0;
  var protohost = getProtohost(req.url) || ''
  var removed = '';
  var slashAdded = false;
  var sync = 0
  var paramcalled = {};

  // store options for OPTIONS request
  // only used if OPTIONS request
  var options = [];

  // middleware and routes
  // 拿到 router 对象的 stack 属性,这个 stack 属性是一个数组,里面存放了所有的中间件和路由
  // layer.handle 就是中间件的执行函数,layer.route 就是路由的执行函数
  // 在执行中间件的时候,会调用 layer.handle 执行中间件函数
  // 在执行路由的时候,会调用 layer.route 执行路由函数
  var stack = self.stack;

  // manage inter-router variables
  var parentParams = req.params;
  var parentUrl = req.baseUrl || '';
  var done = restore(out, req, 'baseUrl', 'next', 'params');

  // setup next layer
  req.next = next;

  // for options requests, respond with a default if nothing else responds
  // 如果是 options 请求,则在没有任何中间件和路由的情况下,返回一个默认的响应
  if (req.method === 'OPTIONS') {
    done = wrap(done, function (old, err) {
      if (err || options.length === 0) return old(err);
      sendOptionsResponse(res, options, old);
    });
  }

  // setup basic req values
  req.baseUrl = parentUrl;
  req.originalUrl = req.originalUrl || req.url;
  // 执行 next 函数,这个 next 函数是一个函数,它的作用是执行下一个中间件或者路由
  next();

  function next (err) {
    var layerError = err === 'route'
      ? null
      : err;

    // remove added slash
    // 如果添加了斜杠,则移除斜杠
    if (slashAdded) {
      req.url = req.url.slice(1)
      slashAdded = false;
    }

    // restore altered req.url
    if (removed.length !== 0) {
      req.baseUrl = parentUrl;
      req.url = protohost + removed + req.url.slice(protohost.length)
      removed = '';
    }

    // signal to exit router
    if (layerError === 'router') {
      setImmediate(done, null)
      return
    }

    // no more matching layers
    if (idx >= stack.length) {
      setImmediate(done, layerError);
      return;
    }

    // max sync stack
    if (++sync > 100) {
      return setImmediate(next, err)
    }

    // get pathname of request
    var path = getPathname(req);

    if (path == null) {
      return done(layerError);
    }

    // find next matching layer
    var layer;
    var match;
    var route;

    // 找到匹配的中间件 layer,当前的 layer 就是 stack 的第 idx 个元素
    // 如果是路由,则找到匹配的路由即 match=true 跳出循环,所以需要调用 next 函数再次进入
    while (match !== true && idx < stack.length) {
      // 取出 stack 的第 idx 个元素,这个元素就是一个中间件或者路由
      // idex++ 当前为0,取出 stack[0],然后 idx++,取出 stack[1]
      layer = stack[idx++];
      // 判断请求路径是否匹配当前 layer 的路径
      match = matchLayer(layer, path);
      route = layer.route;

      if (typeof match !== 'boolean') {
        // hold on to layerError
        layerError = layerError || match;
      }

      if (match !== true) {
        continue;
      }

      if (!route) {
        // process non-route handlers normally
        continue;
      }

      if (layerError) {
        // routes do not match with a pending error
        match = false;
        continue;
      }

      // 获取请求类型,判断请求类型是否一致
      var method = req.method;
      var has_method = route._handles_method(method);

      // build up automatic options response
      if (!has_method && method === 'OPTIONS') {
        appendMethods(options, route._options());
      }

      // don't even bother matching route
      if (!has_method && method !== 'HEAD') {
        match = false;
      }
    }

    // no match
    // 如果没有匹配到任何中间件或者路由,则返回错误
    if (match !== true) {
      return done(layerError);
    }

    // store route for dispatch on change
    // 如果是路由,则将路由保存在 req.route 中
    if (route) {
      req.route = route;
    }

    // Capture one-time layer values
    req.params = self.mergeParams
      ? mergeParams(layer.params, parentParams)
      : layer.params;
    var layerPath = layer.path;

    // this should be done for the layer
    // 将 layer.handle 执行的结果保存在 req.route.handle 中
    self.process_params(layer, paramcalled, req, res, function (err) {
      if (err) {
        next(layerError || err)
      } else if (route) {
        layer.handle_request(req, res, next)
      } else {
        trim_prefix(layer, layerError, layerPath, path)
      }

      sync = 0
    });
  }

  function trim_prefix (layer, layerError, layerPath, path) {
    if (layerPath.length !== 0) {
      // Validate path is a prefix match
      if (layerPath !== path.slice(0, layerPath.length)) {
        next(layerError)
        return
      }

      // Validate path breaks on a path separator
      var c = path[layerPath.length]
      if (c && c !== '/' && c !== '.') return next(layerError)

      // Trim off the part of the url that matches the route
      // middleware (.use stuff) needs to have the path stripped
      debug('trim prefix (%s) from url %s', layerPath, req.url);
      removed = layerPath;
      req.url = protohost + req.url.slice(protohost.length + removed.length)

      // Ensure leading slash
      if (!protohost && req.url[0] !== '/') {
        req.url = '/' + req.url;
        slashAdded = true;
      }

      // Setup base URL (no trailing slash)
      req.baseUrl = parentUrl + (removed[removed.length - 1] === '/'
        ? removed.substring(0, removed.length - 1)
        : removed);
    }

    debug('%s %s : %s', layer.name, layerPath, req.originalUrl);

    if (layerError) {
      layer.handle_error(layerError, req, res, next);
    } else {
      layer.handle_request(req, res, next);
    }
  }
};

/**
 * Process any parameters for the layer.
 * @private
 */

proto.process_params = function process_params (layer, called, req, res, done) {
  var params = this.params;

  // captured parameters from the layer, keys and values
  var keys = layer.keys;

  // fast track
  if (!keys || keys.length === 0) {
    return done();
  }

  var i = 0;
  var name;
  var paramIndex = 0;
  var key;
  var paramVal;
  var paramCallbacks;
  var paramCalled;

  // process params in order
  // param callbacks can be async
  function param (err) {
    if (err) {
      return done(err);
    }

    if (i >= keys.length) {
      return done();
    }

    paramIndex = 0;
    key = keys[i++];
    name = key.name;
    paramVal = req.params[name];
    paramCallbacks = params[name];
    paramCalled = called[name];

    if (paramVal === undefined || !paramCallbacks) {
      return param();
    }

    // param previously called with same value or error occurred
    if (paramCalled && (paramCalled.match === paramVal
      || (paramCalled.error && paramCalled.error !== 'route'))) {
      // restore value
      req.params[name] = paramCalled.value;

      // next param
      return param(paramCalled.error);
    }

    called[name] = paramCalled = {
      error: null,
      match: paramVal,
      value: paramVal
    };

    paramCallback();
  }

  // single param callbacks
  function paramCallback (err) {
    var fn = paramCallbacks[paramIndex++];

    // store updated value
    paramCalled.value = req.params[key.name];

    if (err) {
      // store error
      paramCalled.error = err;
      param(err);
      return;
    }

    if (!fn) return param();

    try {
      fn(req, res, paramCallback, paramVal, key.name);
    } catch (e) {
      paramCallback(e);
    }
  }

  param();
};

/**
 * Use the given middleware function, with optional path, defaulting to "/".
 *
 * Use (like `.all`) will run for any http METHOD, but it will not add
 * handlers for those methods so OPTIONS requests will not consider `.use`
 * functions even if they could respond.
 *
 * The other difference is that _route_ path is stripped and not visible
 * to the handler function. The main effect of this feature is that mounted
 * handlers can operate without any code changes regardless of the "prefix"
 * pathname.
 *
 * @public
 */

//  router.use 使用形式
//  1. router.use((req, res, next) =>{)} 只传中间件函数
//  2. router.use('/', (req, res, next) =>{}) 传中间件函数和路径
//  3. router.use('/', (req, res, next) =>{}, (req, res, next) =>{}) 传中间件函数和路径和多个中间件函数 

// 总结:通过 new Layer 实例化的形式,往中间件函数挂到layer实例上handle属性上
//      每个中间件函数都会有一个layer去保存,每个layer都有一个handle属性
//      将所有的中间件函数的layer实例放入stack中
proto.use = function use (fn) {
  var offset = 0;
  var path = '/';

  // default path to '/'
  // disambiguate router.use([fn])
  // 如果 fn 不是函数,那么就是 router.use('/', (req, res, next) =>{})
  if (typeof fn !== 'function') {
    // 将第一位参数给 arg
    var arg = fn;
    // 如果是数组,取出第一位
    while (Array.isArray(arg) && arg.length !== 0) {
      arg = arg[0];
    }

    // first arg is the path
    if (typeof arg !== 'function') {
      offset = 1;
      path = fn;
    }
  }

  var callbacks = flatten(slice.call(arguments, offset));

  if (callbacks.length === 0) {
    throw new TypeError('Router.use() requires a middleware function')
  }
  // 遍历中间件函数
  for (var i = 0; i < callbacks.length; i++) {
    var fn = callbacks[i];
    // 如果不是函数,抛出错误
    if (typeof fn !== 'function') {
      throw new TypeError('Router.use() requires a middleware function but got a ' + gettype(fn))
    }

    // add the middleware
    debug('use %o %s', path, fn.name || '<anonymous>')

    // 实例化 Layer,并将 路径,中间件函数fn以及一些其他参数穿进去
    // new Layer 时会将 中间件函数fn 挂载到实例 layer.handle 上
    var layer = new Layer(path, {
      sensitive: this.caseSensitive,
      strict: false,
      end: false
    }, fn);

    layer.route = undefined;
    // 将 layer 挂载到 router.stack 上
    // 当后面需要使用中间件函数时,可以通过 router.stack 来获取中间件函数,逐一执行实例的 handle
    this.stack.push(layer);
  }

  return this;
};

/**
 * Create a new Route for the given path.
 *
 * Each route contains a separate middleware stack and VERB handlers.
 *
 * See the Route api documentation for details on adding handlers
 * and middleware to routes.
 *
 * @param {String} path
 * @return {Route}
 * @public
 */

proto.route = function route (path) {
  var route = new Route(path);

  var layer = new Layer(path, {
    sensitive: this.caseSensitive,
    strict: this.strict,
    end: true
  }, route.dispatch.bind(route));

  layer.route = route;

  this.stack.push(layer);
  return route;
};

// create Router#VERB functions
methods.concat('all').forEach(function (method) {
  proto[method] = function (path) {
    var route = this.route(path)
    route[method].apply(route, slice.call(arguments, 1));
    return this;
  };
});

// append methods to a list of methods
function appendMethods (list, addition) {
  for (var i = 0; i < addition.length; i++) {
    var method = addition[i];
    if (list.indexOf(method) === -1) {
      list.push(method);
    }
  }
}

// get pathname of request
function getPathname (req) {
  try {
    return parseUrl(req).pathname;
  } catch (err) {
    return undefined;
  }
}

// Get get protocol + host for a URL
function getProtohost (url) {
  if (typeof url !== 'string' || url.length === 0 || url[0] === '/') {
    return undefined
  }

  var searchIndex = url.indexOf('?')
  var pathLength = searchIndex !== -1
    ? searchIndex
    : url.length
  var fqdnIndex = url.slice(0, pathLength).indexOf('://')

  return fqdnIndex !== -1
    ? url.substring(0, url.indexOf('/', 3 + fqdnIndex))
    : undefined
}

// get type for error message
function gettype (obj) {
  var type = typeof obj;

  if (type !== 'object') {
    return type;
  }

  // inspect [[Class]] for objects
  return toString.call(obj)
    .replace(objectRegExp, '$1');
}

/**
 * Match path to a layer.
 *
 * @param {Layer} layer
 * @param {string} path
 * @private
 */

function matchLayer (layer, path) {
  try {
    return layer.match(path);
  } catch (err) {
    return err;
  }
}

// merge params with parent params
function mergeParams (params, parent) {
  if (typeof parent !== 'object' || !parent) {
    return params;
  }

  // make copy of parent for base
  var obj = mixin({}, parent);

  // simple non-numeric merging
  if (!(0 in params) || !(0 in parent)) {
    return mixin(obj, params);
  }

  var i = 0;
  var o = 0;

  // determine numeric gaps
  while (i in params) {
    i++;
  }

  while (o in parent) {
    o++;
  }

  // offset numeric indices in params before merge
  for (i--; i >= 0; i--) {
    params[i + o] = params[i];

    // create holes for the merge when necessary
    if (i < o) {
      delete params[i];
    }
  }

  return mixin(obj, params);
}

// restore obj props after function
function restore (fn, obj) {
  var props = new Array(arguments.length - 2);
  var vals = new Array(arguments.length - 2);

  for (var i = 0; i < props.length; i++) {
    props[i] = arguments[i + 2];
    vals[i] = obj[props[i]];
  }

  return function () {
    // restore vals
    for (var i = 0; i < props.length; i++) {
      obj[props[i]] = vals[i];
    }

    return fn.apply(this, arguments);
  };
}

// send an OPTIONS response
function sendOptionsResponse (res, options, next) {
  try {
    var body = options.join(',');
    res.set('Allow', body);
    res.send(body);
  } catch (err) {
    next(err);
  }
}

// wrap a function
function wrap (old, fn) {
  return function proxy () {
    var args = new Array(arguments.length + 1);

    args[0] = old;
    for (var i = 0, len = arguments.length; i < len; i++) {
      args[i + 1] = arguments[i];
    }

    fn.apply(this, args);
  };
}

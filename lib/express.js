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
 */

//  解析json,raw,urlencoded,text格式的请求体
var bodyParser = require('body-parser')
var EventEmitter = require('events').EventEmitter;
//  合并对象
var mixin = require('merge-descriptors');
//  应用主体
var proto = require('./application');
//  路由
var Route = require('./router/route');
var Router = require('./router');
//  请求和响应
var req = require('./request');
var res = require('./response');

/**
 * Expose `createApplication()`.
 */

//  express的入口
exports = module.exports = createApplication;

/**
 基本使用:
  var express = require('express');
  var app = express();
  
  app.get('/', function (req, res) {
    res.send('Hello World');
  })
  
  var server = app.listen(8081, function () {
  
    var host = server.address().address
    var port = server.address().port
  
    console.log("应用实例，访问地址为 http://%s:%s", host, port)
  
  })
 */


/**
 * Create an express application.
 *
 * @return {Function}
 * @api public
 */

/**
 * app被设计成一个兼容http/https服务callback格式的函数
 * 
 * 1.把express作为http服务使用
 *   const app = express();
 *   app.listen(3000, () => {})
 * 
 * 2.把express作为https服务的callback使用
 *   const http = require('http')
 *   const app = express()
 *   const server = http.createServer(app)
 *   server.listen(3000, () => {})
 */

function createApplication () {
  //  执行 var express = require('express'); var app = express(); 返回 app
  var app = function (req, res, next) {
    app.handle(req, res, next);
  };

  //  app 对象 混入 EventEmitter.prototype 上的属性和方法
  mixin(app, EventEmitter.prototype, false);

  //  app 对象 混入 application.js 上的属性和方法
  mixin(app, proto, false);

  // expose the prototype that will get set on requests
  //  定义数据属性,即: app.request  = req;
  app.request = Object.create(req, {
    app: { configurable: true, enumerable: true, writable: true, value: app }
  })

  // expose the prototype that will get set on responses
  //  定义数据属性,即: app.response = res;
  app.response = Object.create(res, {
    app: { configurable: true, enumerable: true, writable: true, value: app }
  })

  //  内部调用 app 上的 init 方法,完成默认配置初始化
  app.init();

  return app;
}

/**
 * Expose the prototypes.
 */

//  暴露处理请求和响应的方法
exports.application = proto;
exports.request = req;
exports.response = res;

/**
 * Expose constructors.
 */

//  暴露处理路由的方法
exports.Route = Route;
exports.Router = Router;

/**
 * Expose middleware
 */

//  暴露中间件
exports.json = bodyParser.json
exports.query = require('./middleware/query');
exports.raw = bodyParser.raw
exports.static = require('serve-static');
exports.text = bodyParser.text
exports.urlencoded = bodyParser.urlencoded

/**
 * Replace removed middleware with an appropriate error message.
 */

//  被移除的中间件
var removedMiddlewares = [
  'bodyParser',
  'compress',
  'cookieSession',
  'session',
  'logger',
  'cookieParser',
  'favicon',
  'responseTime',
  'errorHandler',
  'timeout',
  'methodOverride',
  'vhost',
  'csrf',
  'directory',
  'limit',
  'multipart',
  'staticCache'
]

//  在express上添加被移除的中间件,引用中间件时,会报错
removedMiddlewares.forEach(function (name) {
  Object.defineProperty(exports, name, {
    get: function () {
      throw new Error('Most middleware (like ' + name + ') is no longer bundled with Express and must be installed separately. Please see https://github.com/senchalabs/connect#middleware.');
    },
    configurable: true
  });
});

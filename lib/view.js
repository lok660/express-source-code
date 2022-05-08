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

var debug = require('debug')('express:view');
var path = require('path');
var fs = require('fs');

/**
 * Module variables.
 * @private
 */

var dirname = path.dirname;
var basename = path.basename;
var extname = path.extname;
var join = path.join;
var resolve = path.resolve;

/**
 * Module exports.
 * @public
 */

module.exports = View;

/**
 * Initialize a new `View` with the given `name`.
 *
 * Options:
 *
 *   - `defaultEngine` the default template engine name
 *   - `engines` template engine require() cache
 *   - `root` root path for view lookup
 *
 * @param {string} name
 * @param {object} options
 * @public
 */

function View (name, options) {
  var opts = options || {};

  //  模板引擎 this.get('view engine')
  this.defaultEngine = opts.defaultEngine;
  //  扩展文件名
  this.ext = extname(name);
  this.name = name;
  //  页面所有视图 this.get('views)
  this.root = opts.root;
  //  文件扩展名和模板引擎至少有一个存在
  if (!this.ext && !this.defaultEngine) {
    throw new Error('No default engine was specified and no extension was provided.');
  }

  var fileName = name;
  /**
    如果没有传文件扩展名,如:
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'jade');
    res.render('index'); 

    => 可以得出 this.ext 为 .jade
   */
  if (!this.ext) {
    // get extension from default engine name
    this.ext = this.defaultEngine[0] !== '.'
      ? '.' + this.defaultEngine
      : this.defaultEngine;
    //  fileName 保证有扩展名
    fileName += this.ext;
  }

  /**
      app.engine('ejs', require('ejs').__express);
      this.engines[extension] = fn;
      => 即得到 ejs 的模版引擎为 require('ejs').__express
   */
  if (!opts.engines[this.ext]) {
    // load engine
    //  this.ext 是包含 . 的扩展名
    var mod = this.ext.slice(1)
    debug('require "%s"', mod)

    // default engine export
    //  引用模板引擎
    var fn = require(mod).__express

    //  没有模板引擎上都有一个__express方法
    if (typeof fn !== 'function') {
      throw new Error('Module "' + mod + '" does not provide a view engine.')
    }

    opts.engines[this.ext] = fn
  }

  // store loaded engine
  // 设置当前模板引擎,缓存下来
  this.engine = opts.engines[this.ext];

  // lookup path
  // 在 render 函数中调用,fileName为完整文件名
  this.path = this.lookup(fileName);
}

/**
 * Lookup view by the given `name`
 *
 * @param {string} name
 * @private
 */

//  返回当前文件的绝对路径
View.prototype.lookup = function lookup (name) {
  var path;
  //  页面所有试图 this.get('views')
  var roots = [].concat(this.root);

  debug('lookup "%s"', name);

  //  遍历模板文件目录
  for (var i = 0; i < roots.length && !path; i++) {
    var root = roots[i];

    // resolve the path
    var loc = resolve(root, name);
    var dir = dirname(loc); //  绝对路径
    var file = basename(loc); //  文件名

    // resolve the file
    path = this.resolve(dir, file);
  }

  //  返回当前文件的绝对路径
  return path;
};

/**
 * Render with the given options.
 *
 * @param {object} options
 * @param {function} callback
 * @private
 */

//  调用模板引擎的render方法,渲染页面
View.prototype.render = function render (options, callback) {
  debug('render "%s"', this.path);
  /**
    1、this.engine = opts.engines[this.ext]
    => require(mod).__express
    2、传入文件绝对路径、options 参数、callback参数 
   */
  this.engine(this.path, options, callback);
};

/**
 * Resolve the file within the given directory.
 *
 * @param {string} dir
 * @param {string} file
 * @private
 */

View.prototype.resolve = function resolve (dir, file) {
  var ext = this.ext;

  // <path>.<ext>
  // 拼接路径
  var path = join(dir, file);
  var stat = tryStat(path);

  // 拼接路径是文件的话,返回此绝对路径
  if (stat && stat.isFile()) {
    return path;
  }

  // <path>/index.<ext>
  // 可以直接传目录,会自动检索到当前目录的 `index${ext}`
  path = join(dir, basename(file, ext), 'index' + ext);
  stat = tryStat(path);

  if (stat && stat.isFile()) {
    return path;
  }
};

/**
 * Return a stat, maybe.
 *
 * @param {string} path
 * @return {fs.Stats}
 * @private
 */

//  读取文件的状态
function tryStat (path) {
  debug('stat "%s"', path);

  try {
    return fs.statSync(path);
  } catch (e) {
    return undefined;
  }
}

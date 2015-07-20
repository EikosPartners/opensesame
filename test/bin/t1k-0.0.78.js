/**
 * @license almond 0.3.0 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

define("scalejs",[],function(){var a;return{load:function(b,c,d,e){var f;"extensions"===b?e.scalejs&&e.scalejs.extensions?(a=e.scalejs.extensions,c(a,function(){d(Array.prototype.slice(arguments))})):c(["scalejs.extensions"],function(){d(Array.prototype.slice(arguments))},function(){d([])}):0===b.indexOf("application")?(f=b.substring("application".length+1).match(/([^,]+)/g)||[],f=f.map(function(a){return-1===a.indexOf("/")?"app/"+a+"/"+a+"Module":a}),f.push("scalejs.application"),c(["scalejs!extensions"],function(){c(f,function(){var a=arguments[arguments.length-1],b=Array.prototype.slice.call(arguments,0,arguments.length-1);e.isBuild||a.registerModules.apply(null,b),d(a)})})):c(["scalejs."+b],function(a){d(a)})},write:function(b,c,d){"scalejs"===b&&0===c.indexOf("application")&&d('define("scalejs.extensions", '+JSON.stringify(a)+", function () { return Array.prototype.slice(arguments); })")}}}),define("scalejs.base.type",[],function(){function a(a){if(void 0===a)return"undefined";if(null===a)return"null";var b,c=Object.prototype.toString.call(a).match(/\s([a-z|A-Z]+)/)[1].toLowerCase();return"object"!==c?c:(b=a.constructor.toString().match(/^function\s*([$A-Z_][0-9A-Z_$]*)/i),null===b?"object":b[1])}function b(a){var c,d,e,f,g=void 0,h=arguments.length,i=h-1,j=a;if(0===h)return!1;if(1===h)return null!==a&&a!==g;if(h>2)for(c=0;i-1>c;c+=1){if(!b(j))return!1;j=j[arguments[c+1]]}return d=arguments[i],null===j?null===d||"null"===d:j===g?d===g||"undefined"===d:""===d?j===d:(e=typeof d,"string"===e?(f=Object.prototype.toString.call(j).slice(8,-1).toLowerCase(),f===d):"function"===e?j instanceof d:j===d)}return{is:b,typeOf:a}}),define("scalejs.base.object",["./scalejs.base.type"],function(a){function b(a){var b,c,d,e=a;if(!j(e))return!1;for(b=1,c=arguments.length;c>b;b+=1)if(d=arguments[b],e=e[d],!j(e))return!1;return!0}function c(a,d){var e;for(e in d)d.hasOwnProperty(e)&&(a[e]=b(d,e)&&b(a,e)&&d[e].constructor===Object?c(a[e],d[e]):d[e]);return a}function d(){var a,b=arguments,d=b.length,e={};for(a=0;d>a;a+=1)c(e,b[a]);return e}function e(a){return d(a)}function f(a,d,e){var f,g=b(e)?e.split("."):[],h=a;for(f=0;f<g.length;f+=1)b(h,g[f])||(h[g[f]]={}),h=h[g[f]];return c(h,d),h}function g(a,c,d){var e,f,g=c.split("."),h=!0;for(e=0;e<g.length;e+=1){if(f=g[e],!b(a,f)){h=!1;break}a=a[f]}return h?a:d}function h(a,c){return b(a)?a:c}function i(a){var b=[];return JSON.stringify(a,function(a,c){if("object"==typeof c&&null!==c){if(-1!==b.indexOf(c))return"[Circular]";b.push(c)}return c})}var j=a.is;return{has:b,valueOrDefault:h,merge:d,extend:f,clone:e,get:g,stringify:i}}),define("scalejs.base.array",["./scalejs.base.object"],function(a){function b(a,b){a.indexOf(b)<0&&a.push(b)}function c(a,b){var c=a.indexOf(b);c>-1&&a.splice(c,1)}function d(a){a.splice(0,a.length)}function e(a,b,c){return b=h(b,0),c=h(c,a.length),Array.prototype.slice.call(a,b,c)}function f(a,b,c){var d,e;for(d=0,e=a.length;e>d;d+=1)if(a.hasOwnProperty(d)&&b.call(c,a[d],d,a))return a[d];return null}function g(a,b,c){return e(a,b,c)}var h=a.valueOrDefault;return{addOne:b,removeOne:c,removeAll:d,copy:e,find:f,toArray:g}}),define("scalejs.base.log",["./scalejs.base.object"],function(a){function b(b){return function(){var c,f;c=Array.prototype.slice.call(arguments,0),e?(f=b+" ",c.forEach(function(b){f+=a.stringify(b)+" "}),c=[f]):c.unshift(b),d.apply(this,arguments)}}function c(a){var b=a.stack?String(a.stack):"",c=a.message||"";return"Error: "+c+"\nStack: "+b}var d=Function.prototype.call.bind(console.log,console),e=navigator.userAgent.indexOf("MSIE")>0||navigator.userAgent.indexOf("Trident")>0;return{log:b("      "),info:b("info: "),error:b("error:"),warn:b("warn: "),debug:b("debug:"),formatException:c}}),define("scalejs.base",["./scalejs.base.array","./scalejs.base.log","./scalejs.base.object","./scalejs.base.type"],function(a,b,c,d){return{type:d,object:c,array:a,log:b}}),define("scalejs.core",["./scalejs.base"],function(a){function b(a){try{var b;if(h(a,"buildCore","function"))return a.buildCore(l),void j(m,a);b=h(a,"function")?a(l):g(a,"core")?a.core:a,b&&(i(l,b),j(m,a))}catch(c){k("Fatal error during application initialization. ",'Failed to build core with extension "',a,"See following exception for more details.",c)}}function c(a){if(!g(a))throw new Error("Sandbox name is required to build a sandbox.");var b={type:l.type,object:l.object,array:l.array,log:l.log};return m.forEach(function(a){try{h(a,"buildSandbox","function")?a.buildSandbox(b):g(a,"sandbox")?i(b,a.sandbox):i(b,a)}catch(c){throw k("Fatal error during application initialization. ",'Failed to build sandbox with extension "',a,"See following exception for more details.",c),c}}),b}function d(a){n.push(a)}function e(){o||(o=!0,n.forEach(function(a){a("started")}))}function f(){o&&(o=!1,n.forEach(function(a){a("stopped")}))}var g=a.object.has,h=a.type.is,i=a.object.extend,j=a.array.addOne,k=a.log.error,l={},m=[],n=[],o=!1;return Object.defineProperty(l,"STARTED",{value:"started",writable:!1}),Object.defineProperty(l,"STOPPED",{value:"stopped",writable:!1}),i(l,{type:a.type,object:a.object,array:a.array,log:a.log,buildSandbox:c,notifyApplicationStarted:e,notifyApplicationStopped:f,onApplicationEvent:d,registerExtension:b,isApplicationRunning:function(){return o}})}),define("scalejs.application",["scalejs!core"],function(a){function b(){if(a.isApplicationRunning())throw new Error("Can't register module since the application is already running.","Dynamic module loading is not supported.");Array.prototype.push.apply(m,j(arguments).filter(function(a){return a}))}function c(a){var b,c;if("function"==typeof a)try{b=a()}catch(d){c=a.getId?a.getId():a.name,k('Failed to create an instance of module "'+c+'".',"Application will continue running without the module. See following exception stack for more details.",d.stack)}else b=a;return i(n,b),b}function d(){m.forEach(c)}function e(){l("Application started."),a.notifyApplicationStarted()}function f(){l("Application exited."),a.notifyApplicationStopped()}function g(){d(),e()}function h(){f()}var i=a.array.addOne,j=a.array.toArray,k=a.log.error,l=a.log.debug,m=[],n=[];return{registerModules:b,run:g,exit:h}}),define("scalejs.sandbox",[],function(){return{load:function(a,b,c,d){b(["scalejs!core","scalejs!extensions"],function(b){if(d.isBuild)c();else{var e=b.buildSandbox(a);c(e)}})}}});
/*!
 * Knockout JavaScript library v3.2.0
 * (c) Steven Sanderson - http://knockoutjs.com/
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)
 */

(function() {(function(p){var s=this||(0,eval)("this"),v=s.document,L=s.navigator,w=s.jQuery,D=s.JSON;(function(p){"function"===typeof require&&"object"===typeof exports&&"object"===typeof module?p(module.exports||exports,require):"function"===typeof define&&define.amd?define('knockout',["exports","require"],p):p(s.ko={})})(function(M,N){function H(a,d){return null===a||typeof a in R?a===d:!1}function S(a,d){var c;return function(){c||(c=setTimeout(function(){c=p;a()},d))}}function T(a,d){var c;return function(){clearTimeout(c);
c=setTimeout(a,d)}}function I(b,d,c,e){a.d[b]={init:function(b,h,k,f,m){var l,q;a.s(function(){var f=a.a.c(h()),k=!c!==!f,z=!q;if(z||d||k!==l)z&&a.Y.la()&&(q=a.a.ia(a.f.childNodes(b),!0)),k?(z||a.f.T(b,a.a.ia(q)),a.Ca(e?e(m,f):m,b)):a.f.ja(b),l=k},null,{o:b});return{controlsDescendantBindings:!0}}};a.h.ha[b]=!1;a.f.Q[b]=!0}var a="undefined"!==typeof M?M:{};a.b=function(b,d){for(var c=b.split("."),e=a,g=0;g<c.length-1;g++)e=e[c[g]];e[c[c.length-1]]=d};a.A=function(a,d,c){a[d]=c};a.version="3.2.0";
a.b("version",a.version);a.a=function(){function b(a,b){for(var c in a)a.hasOwnProperty(c)&&b(c,a[c])}function d(a,b){if(b)for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a}function c(a,b){a.__proto__=b;return a}var e={__proto__:[]}instanceof Array,g={},h={};g[L&&/Firefox\/2/i.test(L.userAgent)?"KeyboardEvent":"UIEvents"]=["keyup","keydown","keypress"];g.MouseEvents="click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave".split(" ");b(g,function(a,b){if(b.length)for(var c=
0,d=b.length;c<d;c++)h[b[c]]=a});var k={propertychange:!0},f=v&&function(){for(var a=3,b=v.createElement("div"),c=b.getElementsByTagName("i");b.innerHTML="\x3c!--[if gt IE "+ ++a+"]><i></i><![endif]--\x3e",c[0];);return 4<a?a:p}();return{vb:["authenticity_token",/^__RequestVerificationToken(_.*)?$/],u:function(a,b){for(var c=0,d=a.length;c<d;c++)b(a[c],c)},m:function(a,b){if("function"==typeof Array.prototype.indexOf)return Array.prototype.indexOf.call(a,b);for(var c=0,d=a.length;c<d;c++)if(a[c]===
b)return c;return-1},qb:function(a,b,c){for(var d=0,f=a.length;d<f;d++)if(b.call(c,a[d],d))return a[d];return null},ua:function(m,b){var c=a.a.m(m,b);0<c?m.splice(c,1):0===c&&m.shift()},rb:function(m){m=m||[];for(var b=[],c=0,d=m.length;c<d;c++)0>a.a.m(b,m[c])&&b.push(m[c]);return b},Da:function(a,b){a=a||[];for(var c=[],d=0,f=a.length;d<f;d++)c.push(b(a[d],d));return c},ta:function(a,b){a=a||[];for(var c=[],d=0,f=a.length;d<f;d++)b(a[d],d)&&c.push(a[d]);return c},ga:function(a,b){if(b instanceof
Array)a.push.apply(a,b);else for(var c=0,d=b.length;c<d;c++)a.push(b[c]);return a},ea:function(b,c,d){var f=a.a.m(a.a.Xa(b),c);0>f?d&&b.push(c):d||b.splice(f,1)},xa:e,extend:d,za:c,Aa:e?c:d,G:b,na:function(a,b){if(!a)return a;var c={},d;for(d in a)a.hasOwnProperty(d)&&(c[d]=b(a[d],d,a));return c},Ka:function(b){for(;b.firstChild;)a.removeNode(b.firstChild)},oc:function(b){b=a.a.S(b);for(var c=v.createElement("div"),d=0,f=b.length;d<f;d++)c.appendChild(a.R(b[d]));return c},ia:function(b,c){for(var d=
0,f=b.length,e=[];d<f;d++){var k=b[d].cloneNode(!0);e.push(c?a.R(k):k)}return e},T:function(b,c){a.a.Ka(b);if(c)for(var d=0,f=c.length;d<f;d++)b.appendChild(c[d])},Lb:function(b,c){var d=b.nodeType?[b]:b;if(0<d.length){for(var f=d[0],e=f.parentNode,k=0,g=c.length;k<g;k++)e.insertBefore(c[k],f);k=0;for(g=d.length;k<g;k++)a.removeNode(d[k])}},ka:function(a,b){if(a.length){for(b=8===b.nodeType&&b.parentNode||b;a.length&&a[0].parentNode!==b;)a.shift();if(1<a.length){var c=a[0],d=a[a.length-1];for(a.length=
0;c!==d;)if(a.push(c),c=c.nextSibling,!c)return;a.push(d)}}return a},Nb:function(a,b){7>f?a.setAttribute("selected",b):a.selected=b},cb:function(a){return null===a||a===p?"":a.trim?a.trim():a.toString().replace(/^[\s\xa0]+|[\s\xa0]+$/g,"")},vc:function(a,b){a=a||"";return b.length>a.length?!1:a.substring(0,b.length)===b},cc:function(a,b){if(a===b)return!0;if(11===a.nodeType)return!1;if(b.contains)return b.contains(3===a.nodeType?a.parentNode:a);if(b.compareDocumentPosition)return 16==(b.compareDocumentPosition(a)&
16);for(;a&&a!=b;)a=a.parentNode;return!!a},Ja:function(b){return a.a.cc(b,b.ownerDocument.documentElement)},ob:function(b){return!!a.a.qb(b,a.a.Ja)},t:function(a){return a&&a.tagName&&a.tagName.toLowerCase()},n:function(b,c,d){var e=f&&k[c];if(!e&&w)w(b).bind(c,d);else if(e||"function"!=typeof b.addEventListener)if("undefined"!=typeof b.attachEvent){var g=function(a){d.call(b,a)},h="on"+c;b.attachEvent(h,g);a.a.w.da(b,function(){b.detachEvent(h,g)})}else throw Error("Browser doesn't support addEventListener or attachEvent");
else b.addEventListener(c,d,!1)},oa:function(b,c){if(!b||!b.nodeType)throw Error("element must be a DOM node when calling triggerEvent");var d;"input"===a.a.t(b)&&b.type&&"click"==c.toLowerCase()?(d=b.type,d="checkbox"==d||"radio"==d):d=!1;if(w&&!d)w(b).trigger(c);else if("function"==typeof v.createEvent)if("function"==typeof b.dispatchEvent)d=v.createEvent(h[c]||"HTMLEvents"),d.initEvent(c,!0,!0,s,0,0,0,0,0,!1,!1,!1,!1,0,b),b.dispatchEvent(d);else throw Error("The supplied element doesn't support dispatchEvent");
else if(d&&b.click)b.click();else if("undefined"!=typeof b.fireEvent)b.fireEvent("on"+c);else throw Error("Browser doesn't support triggering events");},c:function(b){return a.C(b)?b():b},Xa:function(b){return a.C(b)?b.v():b},Ba:function(b,c,d){if(c){var f=/\S+/g,e=b.className.match(f)||[];a.a.u(c.match(f),function(b){a.a.ea(e,b,d)});b.className=e.join(" ")}},bb:function(b,c){var d=a.a.c(c);if(null===d||d===p)d="";var f=a.f.firstChild(b);!f||3!=f.nodeType||a.f.nextSibling(f)?a.f.T(b,[b.ownerDocument.createTextNode(d)]):
f.data=d;a.a.fc(b)},Mb:function(a,b){a.name=b;if(7>=f)try{a.mergeAttributes(v.createElement("<input name='"+a.name+"'/>"),!1)}catch(c){}},fc:function(a){9<=f&&(a=1==a.nodeType?a:a.parentNode,a.style&&(a.style.zoom=a.style.zoom))},dc:function(a){if(f){var b=a.style.width;a.style.width=0;a.style.width=b}},sc:function(b,c){b=a.a.c(b);c=a.a.c(c);for(var d=[],f=b;f<=c;f++)d.push(f);return d},S:function(a){for(var b=[],c=0,d=a.length;c<d;c++)b.push(a[c]);return b},yc:6===f,zc:7===f,L:f,xb:function(b,c){for(var d=
a.a.S(b.getElementsByTagName("input")).concat(a.a.S(b.getElementsByTagName("textarea"))),f="string"==typeof c?function(a){return a.name===c}:function(a){return c.test(a.name)},e=[],k=d.length-1;0<=k;k--)f(d[k])&&e.push(d[k]);return e},pc:function(b){return"string"==typeof b&&(b=a.a.cb(b))?D&&D.parse?D.parse(b):(new Function("return "+b))():null},eb:function(b,c,d){if(!D||!D.stringify)throw Error("Cannot find JSON.stringify(). Some browsers (e.g., IE < 8) don't support it natively, but you can overcome this by adding a script reference to json2.js, downloadable from http://www.json.org/json2.js");
return D.stringify(a.a.c(b),c,d)},qc:function(c,d,f){f=f||{};var e=f.params||{},k=f.includeFields||this.vb,g=c;if("object"==typeof c&&"form"===a.a.t(c))for(var g=c.action,h=k.length-1;0<=h;h--)for(var r=a.a.xb(c,k[h]),E=r.length-1;0<=E;E--)e[r[E].name]=r[E].value;d=a.a.c(d);var y=v.createElement("form");y.style.display="none";y.action=g;y.method="post";for(var p in d)c=v.createElement("input"),c.type="hidden",c.name=p,c.value=a.a.eb(a.a.c(d[p])),y.appendChild(c);b(e,function(a,b){var c=v.createElement("input");
c.type="hidden";c.name=a;c.value=b;y.appendChild(c)});v.body.appendChild(y);f.submitter?f.submitter(y):y.submit();setTimeout(function(){y.parentNode.removeChild(y)},0)}}}();a.b("utils",a.a);a.b("utils.arrayForEach",a.a.u);a.b("utils.arrayFirst",a.a.qb);a.b("utils.arrayFilter",a.a.ta);a.b("utils.arrayGetDistinctValues",a.a.rb);a.b("utils.arrayIndexOf",a.a.m);a.b("utils.arrayMap",a.a.Da);a.b("utils.arrayPushAll",a.a.ga);a.b("utils.arrayRemoveItem",a.a.ua);a.b("utils.extend",a.a.extend);a.b("utils.fieldsIncludedWithJsonPost",
a.a.vb);a.b("utils.getFormFields",a.a.xb);a.b("utils.peekObservable",a.a.Xa);a.b("utils.postJson",a.a.qc);a.b("utils.parseJson",a.a.pc);a.b("utils.registerEventHandler",a.a.n);a.b("utils.stringifyJson",a.a.eb);a.b("utils.range",a.a.sc);a.b("utils.toggleDomNodeCssClass",a.a.Ba);a.b("utils.triggerEvent",a.a.oa);a.b("utils.unwrapObservable",a.a.c);a.b("utils.objectForEach",a.a.G);a.b("utils.addOrRemoveItem",a.a.ea);a.b("unwrap",a.a.c);Function.prototype.bind||(Function.prototype.bind=function(a){var d=
this,c=Array.prototype.slice.call(arguments);a=c.shift();return function(){return d.apply(a,c.concat(Array.prototype.slice.call(arguments)))}});a.a.e=new function(){function a(b,h){var k=b[c];if(!k||"null"===k||!e[k]){if(!h)return p;k=b[c]="ko"+d++;e[k]={}}return e[k]}var d=0,c="__ko__"+(new Date).getTime(),e={};return{get:function(c,d){var e=a(c,!1);return e===p?p:e[d]},set:function(c,d,e){if(e!==p||a(c,!1)!==p)a(c,!0)[d]=e},clear:function(a){var b=a[c];return b?(delete e[b],a[c]=null,!0):!1},F:function(){return d++ +
c}}};a.b("utils.domData",a.a.e);a.b("utils.domData.clear",a.a.e.clear);a.a.w=new function(){function b(b,d){var f=a.a.e.get(b,c);f===p&&d&&(f=[],a.a.e.set(b,c,f));return f}function d(c){var e=b(c,!1);if(e)for(var e=e.slice(0),f=0;f<e.length;f++)e[f](c);a.a.e.clear(c);a.a.w.cleanExternalData(c);if(g[c.nodeType])for(e=c.firstChild;c=e;)e=c.nextSibling,8===c.nodeType&&d(c)}var c=a.a.e.F(),e={1:!0,8:!0,9:!0},g={1:!0,9:!0};return{da:function(a,c){if("function"!=typeof c)throw Error("Callback must be a function");
b(a,!0).push(c)},Kb:function(d,e){var f=b(d,!1);f&&(a.a.ua(f,e),0==f.length&&a.a.e.set(d,c,p))},R:function(b){if(e[b.nodeType]&&(d(b),g[b.nodeType])){var c=[];a.a.ga(c,b.getElementsByTagName("*"));for(var f=0,m=c.length;f<m;f++)d(c[f])}return b},removeNode:function(b){a.R(b);b.parentNode&&b.parentNode.removeChild(b)},cleanExternalData:function(a){w&&"function"==typeof w.cleanData&&w.cleanData([a])}}};a.R=a.a.w.R;a.removeNode=a.a.w.removeNode;a.b("cleanNode",a.R);a.b("removeNode",a.removeNode);a.b("utils.domNodeDisposal",
a.a.w);a.b("utils.domNodeDisposal.addDisposeCallback",a.a.w.da);a.b("utils.domNodeDisposal.removeDisposeCallback",a.a.w.Kb);(function(){a.a.ba=function(b){var d;if(w)if(w.parseHTML)d=w.parseHTML(b)||[];else{if((d=w.clean([b]))&&d[0]){for(b=d[0];b.parentNode&&11!==b.parentNode.nodeType;)b=b.parentNode;b.parentNode&&b.parentNode.removeChild(b)}}else{var c=a.a.cb(b).toLowerCase();d=v.createElement("div");c=c.match(/^<(thead|tbody|tfoot)/)&&[1,"<table>","</table>"]||!c.indexOf("<tr")&&[2,"<table><tbody>",
"</tbody></table>"]||(!c.indexOf("<td")||!c.indexOf("<th"))&&[3,"<table><tbody><tr>","</tr></tbody></table>"]||[0,"",""];b="ignored<div>"+c[1]+b+c[2]+"</div>";for("function"==typeof s.innerShiv?d.appendChild(s.innerShiv(b)):d.innerHTML=b;c[0]--;)d=d.lastChild;d=a.a.S(d.lastChild.childNodes)}return d};a.a.$a=function(b,d){a.a.Ka(b);d=a.a.c(d);if(null!==d&&d!==p)if("string"!=typeof d&&(d=d.toString()),w)w(b).html(d);else for(var c=a.a.ba(d),e=0;e<c.length;e++)b.appendChild(c[e])}})();a.b("utils.parseHtmlFragment",
a.a.ba);a.b("utils.setHtml",a.a.$a);a.D=function(){function b(c,d){if(c)if(8==c.nodeType){var g=a.D.Gb(c.nodeValue);null!=g&&d.push({bc:c,mc:g})}else if(1==c.nodeType)for(var g=0,h=c.childNodes,k=h.length;g<k;g++)b(h[g],d)}var d={};return{Ua:function(a){if("function"!=typeof a)throw Error("You can only pass a function to ko.memoization.memoize()");var b=(4294967296*(1+Math.random())|0).toString(16).substring(1)+(4294967296*(1+Math.random())|0).toString(16).substring(1);d[b]=a;return"\x3c!--[ko_memo:"+
b+"]--\x3e"},Rb:function(a,b){var g=d[a];if(g===p)throw Error("Couldn't find any memo with ID "+a+". Perhaps it's already been unmemoized.");try{return g.apply(null,b||[]),!0}finally{delete d[a]}},Sb:function(c,d){var g=[];b(c,g);for(var h=0,k=g.length;h<k;h++){var f=g[h].bc,m=[f];d&&a.a.ga(m,d);a.D.Rb(g[h].mc,m);f.nodeValue="";f.parentNode&&f.parentNode.removeChild(f)}},Gb:function(a){return(a=a.match(/^\[ko_memo\:(.*?)\]$/))?a[1]:null}}}();a.b("memoization",a.D);a.b("memoization.memoize",a.D.Ua);
a.b("memoization.unmemoize",a.D.Rb);a.b("memoization.parseMemoText",a.D.Gb);a.b("memoization.unmemoizeDomNodeAndDescendants",a.D.Sb);a.La={throttle:function(b,d){b.throttleEvaluation=d;var c=null;return a.j({read:b,write:function(a){clearTimeout(c);c=setTimeout(function(){b(a)},d)}})},rateLimit:function(a,d){var c,e,g;"number"==typeof d?c=d:(c=d.timeout,e=d.method);g="notifyWhenChangesStop"==e?T:S;a.Ta(function(a){return g(a,c)})},notify:function(a,d){a.equalityComparer="always"==d?null:H}};var R=
{undefined:1,"boolean":1,number:1,string:1};a.b("extenders",a.La);a.Pb=function(b,d,c){this.target=b;this.wa=d;this.ac=c;this.Cb=!1;a.A(this,"dispose",this.K)};a.Pb.prototype.K=function(){this.Cb=!0;this.ac()};a.P=function(){a.a.Aa(this,a.P.fn);this.M={}};var G="change",A={U:function(b,d,c){var e=this;c=c||G;var g=new a.Pb(e,d?b.bind(d):b,function(){a.a.ua(e.M[c],g);e.nb&&e.nb()});e.va&&e.va(c);e.M[c]||(e.M[c]=[]);e.M[c].push(g);return g},notifySubscribers:function(b,d){d=d||G;if(this.Ab(d))try{a.k.Ea();
for(var c=this.M[d].slice(0),e=0,g;g=c[e];++e)g.Cb||g.wa(b)}finally{a.k.end()}},Ta:function(b){var d=this,c=a.C(d),e,g,h;d.qa||(d.qa=d.notifySubscribers,d.notifySubscribers=function(a,b){b&&b!==G?"beforeChange"===b?d.kb(a):d.qa(a,b):d.lb(a)});var k=b(function(){c&&h===d&&(h=d());e=!1;d.Pa(g,h)&&d.qa(g=h)});d.lb=function(a){e=!0;h=a;k()};d.kb=function(a){e||(g=a,d.qa(a,"beforeChange"))}},Ab:function(a){return this.M[a]&&this.M[a].length},yb:function(){var b=0;a.a.G(this.M,function(a,c){b+=c.length});
return b},Pa:function(a,d){return!this.equalityComparer||!this.equalityComparer(a,d)},extend:function(b){var d=this;b&&a.a.G(b,function(b,e){var g=a.La[b];"function"==typeof g&&(d=g(d,e)||d)});return d}};a.A(A,"subscribe",A.U);a.A(A,"extend",A.extend);a.A(A,"getSubscriptionsCount",A.yb);a.a.xa&&a.a.za(A,Function.prototype);a.P.fn=A;a.Db=function(a){return null!=a&&"function"==typeof a.U&&"function"==typeof a.notifySubscribers};a.b("subscribable",a.P);a.b("isSubscribable",a.Db);a.Y=a.k=function(){function b(a){c.push(e);
e=a}function d(){e=c.pop()}var c=[],e,g=0;return{Ea:b,end:d,Jb:function(b){if(e){if(!a.Db(b))throw Error("Only subscribable things can act as dependencies");e.wa(b,b.Vb||(b.Vb=++g))}},B:function(a,c,f){try{return b(),a.apply(c,f||[])}finally{d()}},la:function(){if(e)return e.s.la()},ma:function(){if(e)return e.ma}}}();a.b("computedContext",a.Y);a.b("computedContext.getDependenciesCount",a.Y.la);a.b("computedContext.isInitial",a.Y.ma);a.b("computedContext.isSleeping",a.Y.Ac);a.p=function(b){function d(){if(0<
arguments.length)return d.Pa(c,arguments[0])&&(d.X(),c=arguments[0],d.W()),this;a.k.Jb(d);return c}var c=b;a.P.call(d);a.a.Aa(d,a.p.fn);d.v=function(){return c};d.W=function(){d.notifySubscribers(c)};d.X=function(){d.notifySubscribers(c,"beforeChange")};a.A(d,"peek",d.v);a.A(d,"valueHasMutated",d.W);a.A(d,"valueWillMutate",d.X);return d};a.p.fn={equalityComparer:H};var F=a.p.rc="__ko_proto__";a.p.fn[F]=a.p;a.a.xa&&a.a.za(a.p.fn,a.P.fn);a.Ma=function(b,d){return null===b||b===p||b[F]===p?!1:b[F]===
d?!0:a.Ma(b[F],d)};a.C=function(b){return a.Ma(b,a.p)};a.Ra=function(b){return"function"==typeof b&&b[F]===a.p||"function"==typeof b&&b[F]===a.j&&b.hc?!0:!1};a.b("observable",a.p);a.b("isObservable",a.C);a.b("isWriteableObservable",a.Ra);a.b("isWritableObservable",a.Ra);a.aa=function(b){b=b||[];if("object"!=typeof b||!("length"in b))throw Error("The argument passed when initializing an observable array must be an array, or null, or undefined.");b=a.p(b);a.a.Aa(b,a.aa.fn);return b.extend({trackArrayChanges:!0})};
a.aa.fn={remove:function(b){for(var d=this.v(),c=[],e="function"!=typeof b||a.C(b)?function(a){return a===b}:b,g=0;g<d.length;g++){var h=d[g];e(h)&&(0===c.length&&this.X(),c.push(h),d.splice(g,1),g--)}c.length&&this.W();return c},removeAll:function(b){if(b===p){var d=this.v(),c=d.slice(0);this.X();d.splice(0,d.length);this.W();return c}return b?this.remove(function(c){return 0<=a.a.m(b,c)}):[]},destroy:function(b){var d=this.v(),c="function"!=typeof b||a.C(b)?function(a){return a===b}:b;this.X();
for(var e=d.length-1;0<=e;e--)c(d[e])&&(d[e]._destroy=!0);this.W()},destroyAll:function(b){return b===p?this.destroy(function(){return!0}):b?this.destroy(function(d){return 0<=a.a.m(b,d)}):[]},indexOf:function(b){var d=this();return a.a.m(d,b)},replace:function(a,d){var c=this.indexOf(a);0<=c&&(this.X(),this.v()[c]=d,this.W())}};a.a.u("pop push reverse shift sort splice unshift".split(" "),function(b){a.aa.fn[b]=function(){var a=this.v();this.X();this.sb(a,b,arguments);a=a[b].apply(a,arguments);this.W();
return a}});a.a.u(["slice"],function(b){a.aa.fn[b]=function(){var a=this();return a[b].apply(a,arguments)}});a.a.xa&&a.a.za(a.aa.fn,a.p.fn);a.b("observableArray",a.aa);var J="arrayChange";a.La.trackArrayChanges=function(b){function d(){if(!c){c=!0;var d=b.notifySubscribers;b.notifySubscribers=function(a,b){b&&b!==G||++g;return d.apply(this,arguments)};var f=[].concat(b.v()||[]);e=null;b.U(function(c){c=[].concat(c||[]);if(b.Ab(J)){var d;if(!e||1<g)e=a.a.Fa(f,c,{sparse:!0});d=e;d.length&&b.notifySubscribers(d,
J)}f=c;e=null;g=0})}}if(!b.sb){var c=!1,e=null,g=0,h=b.U;b.U=b.subscribe=function(a,b,c){c===J&&d();return h.apply(this,arguments)};b.sb=function(b,d,m){function l(a,b,c){return q[q.length]={status:a,value:b,index:c}}if(c&&!g){var q=[],h=b.length,t=m.length,z=0;switch(d){case "push":z=h;case "unshift":for(d=0;d<t;d++)l("added",m[d],z+d);break;case "pop":z=h-1;case "shift":h&&l("deleted",b[z],z);break;case "splice":d=Math.min(Math.max(0,0>m[0]?h+m[0]:m[0]),h);for(var h=1===t?h:Math.min(d+(m[1]||0),
h),t=d+t-2,z=Math.max(h,t),u=[],r=[],E=2;d<z;++d,++E)d<h&&r.push(l("deleted",b[d],d)),d<t&&u.push(l("added",m[E],d));a.a.wb(r,u);break;default:return}e=q}}}};a.s=a.j=function(b,d,c){function e(){a.a.G(v,function(a,b){b.K()});v={}}function g(){e();C=0;u=!0;n=!1}function h(){var a=f.throttleEvaluation;a&&0<=a?(clearTimeout(P),P=setTimeout(k,a)):f.ib?f.ib():k()}function k(b){if(t){if(E)throw Error("A 'pure' computed must not be called recursively");}else if(!u){if(w&&w()){if(!z){s();return}}else z=!1;
t=!0;if(y)try{var c={};a.k.Ea({wa:function(a,b){c[b]||(c[b]=1,++C)},s:f,ma:p});C=0;q=r.call(d)}finally{a.k.end(),t=!1}else try{var e=v,m=C;a.k.Ea({wa:function(a,b){u||(m&&e[b]?(v[b]=e[b],++C,delete e[b],--m):v[b]||(v[b]=a.U(h),++C))},s:f,ma:E?p:!C});v={};C=0;try{var l=d?r.call(d):r()}finally{a.k.end(),m&&a.a.G(e,function(a,b){b.K()}),n=!1}f.Pa(q,l)&&(f.notifySubscribers(q,"beforeChange"),q=l,!0!==b&&f.notifySubscribers(q))}finally{t=!1}C||s()}}function f(){if(0<arguments.length){if("function"===typeof O)O.apply(d,
arguments);else throw Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");return this}a.k.Jb(f);n&&k(!0);return q}function m(){n&&!C&&k(!0);return q}function l(){return n||0<C}var q,n=!0,t=!1,z=!1,u=!1,r=b,E=!1,y=!1;r&&"object"==typeof r?(c=r,r=c.read):(c=c||{},r||(r=c.read));if("function"!=typeof r)throw Error("Pass a function that returns the value of the ko.computed");var O=c.write,x=c.disposeWhenNodeIsRemoved||
c.o||null,B=c.disposeWhen||c.Ia,w=B,s=g,v={},C=0,P=null;d||(d=c.owner);a.P.call(f);a.a.Aa(f,a.j.fn);f.v=m;f.la=function(){return C};f.hc="function"===typeof c.write;f.K=function(){s()};f.Z=l;var A=f.Ta;f.Ta=function(a){A.call(f,a);f.ib=function(){f.kb(q);n=!0;f.lb(f)}};c.pure?(y=E=!0,f.va=function(){y&&(y=!1,k(!0))},f.nb=function(){f.yb()||(e(),y=n=!0)}):c.deferEvaluation&&(f.va=function(){m();delete f.va});a.A(f,"peek",f.v);a.A(f,"dispose",f.K);a.A(f,"isActive",f.Z);a.A(f,"getDependenciesCount",
f.la);x&&(z=!0,x.nodeType&&(w=function(){return!a.a.Ja(x)||B&&B()}));y||c.deferEvaluation||k();x&&l()&&x.nodeType&&(s=function(){a.a.w.Kb(x,s);g()},a.a.w.da(x,s));return f};a.jc=function(b){return a.Ma(b,a.j)};A=a.p.rc;a.j[A]=a.p;a.j.fn={equalityComparer:H};a.j.fn[A]=a.j;a.a.xa&&a.a.za(a.j.fn,a.P.fn);a.b("dependentObservable",a.j);a.b("computed",a.j);a.b("isComputed",a.jc);a.Ib=function(b,d){if("function"===typeof b)return a.s(b,d,{pure:!0});b=a.a.extend({},b);b.pure=!0;return a.s(b,d)};a.b("pureComputed",
a.Ib);(function(){function b(a,g,h){h=h||new c;a=g(a);if("object"!=typeof a||null===a||a===p||a instanceof Date||a instanceof String||a instanceof Number||a instanceof Boolean)return a;var k=a instanceof Array?[]:{};h.save(a,k);d(a,function(c){var d=g(a[c]);switch(typeof d){case "boolean":case "number":case "string":case "function":k[c]=d;break;case "object":case "undefined":var l=h.get(d);k[c]=l!==p?l:b(d,g,h)}});return k}function d(a,b){if(a instanceof Array){for(var c=0;c<a.length;c++)b(c);"function"==
typeof a.toJSON&&b("toJSON")}else for(c in a)b(c)}function c(){this.keys=[];this.hb=[]}a.Qb=function(c){if(0==arguments.length)throw Error("When calling ko.toJS, pass the object you want to convert.");return b(c,function(b){for(var c=0;a.C(b)&&10>c;c++)b=b();return b})};a.toJSON=function(b,c,d){b=a.Qb(b);return a.a.eb(b,c,d)};c.prototype={save:function(b,c){var d=a.a.m(this.keys,b);0<=d?this.hb[d]=c:(this.keys.push(b),this.hb.push(c))},get:function(b){b=a.a.m(this.keys,b);return 0<=b?this.hb[b]:p}}})();
a.b("toJS",a.Qb);a.b("toJSON",a.toJSON);(function(){a.i={q:function(b){switch(a.a.t(b)){case "option":return!0===b.__ko__hasDomDataOptionValue__?a.a.e.get(b,a.d.options.Va):7>=a.a.L?b.getAttributeNode("value")&&b.getAttributeNode("value").specified?b.value:b.text:b.value;case "select":return 0<=b.selectedIndex?a.i.q(b.options[b.selectedIndex]):p;default:return b.value}},ca:function(b,d,c){switch(a.a.t(b)){case "option":switch(typeof d){case "string":a.a.e.set(b,a.d.options.Va,p);"__ko__hasDomDataOptionValue__"in
b&&delete b.__ko__hasDomDataOptionValue__;b.value=d;break;default:a.a.e.set(b,a.d.options.Va,d),b.__ko__hasDomDataOptionValue__=!0,b.value="number"===typeof d?d:""}break;case "select":if(""===d||null===d)d=p;for(var e=-1,g=0,h=b.options.length,k;g<h;++g)if(k=a.i.q(b.options[g]),k==d||""==k&&d===p){e=g;break}if(c||0<=e||d===p&&1<b.size)b.selectedIndex=e;break;default:if(null===d||d===p)d="";b.value=d}}}})();a.b("selectExtensions",a.i);a.b("selectExtensions.readValue",a.i.q);a.b("selectExtensions.writeValue",
a.i.ca);a.h=function(){function b(b){b=a.a.cb(b);123===b.charCodeAt(0)&&(b=b.slice(1,-1));var c=[],d=b.match(e),k,n,t=0;if(d){d.push(",");for(var z=0,u;u=d[z];++z){var r=u.charCodeAt(0);if(44===r){if(0>=t){k&&c.push(n?{key:k,value:n.join("")}:{unknown:k});k=n=t=0;continue}}else if(58===r){if(!n)continue}else if(47===r&&z&&1<u.length)(r=d[z-1].match(g))&&!h[r[0]]&&(b=b.substr(b.indexOf(u)+1),d=b.match(e),d.push(","),z=-1,u="/");else if(40===r||123===r||91===r)++t;else if(41===r||125===r||93===r)--t;
else if(!k&&!n){k=34===r||39===r?u.slice(1,-1):u;continue}n?n.push(u):n=[u]}}return c}var d=["true","false","null","undefined"],c=/^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+\]))$/i,e=RegExp("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|/(?:[^/\\\\]|\\\\.)*/w*|[^\\s:,/][^,\"'{}()/:[\\]]*[^\\s,\"'{}()/:[\\]]|[^\\s]","g"),g=/[\])"'A-Za-z0-9_$]+$/,h={"in":1,"return":1,"typeof":1},k={};return{ha:[],V:k,Wa:b,ya:function(f,m){function e(b,m){var f;if(!z){var u=a.getBindingHandler(b);if(u&&u.preprocess&&
!(m=u.preprocess(m,b,e)))return;if(u=k[b])f=m,0<=a.a.m(d,f)?f=!1:(u=f.match(c),f=null===u?!1:u[1]?"Object("+u[1]+")"+u[2]:f),u=f;u&&h.push("'"+b+"':function(_z){"+f+"=_z}")}t&&(m="function(){return "+m+" }");g.push("'"+b+"':"+m)}m=m||{};var g=[],h=[],t=m.valueAccessors,z=m.bindingParams,u="string"===typeof f?b(f):f;a.a.u(u,function(a){e(a.key||a.unknown,a.value)});h.length&&e("_ko_property_writers","{"+h.join(",")+" }");return g.join(",")},lc:function(a,b){for(var c=0;c<a.length;c++)if(a[c].key==
b)return!0;return!1},pa:function(b,c,d,e,k){if(b&&a.C(b))!a.Ra(b)||k&&b.v()===e||b(e);else if((b=c.get("_ko_property_writers"))&&b[d])b[d](e)}}}();a.b("expressionRewriting",a.h);a.b("expressionRewriting.bindingRewriteValidators",a.h.ha);a.b("expressionRewriting.parseObjectLiteral",a.h.Wa);a.b("expressionRewriting.preProcessBindings",a.h.ya);a.b("expressionRewriting._twoWayBindings",a.h.V);a.b("jsonExpressionRewriting",a.h);a.b("jsonExpressionRewriting.insertPropertyAccessorsIntoJson",a.h.ya);(function(){function b(a){return 8==
a.nodeType&&h.test(g?a.text:a.nodeValue)}function d(a){return 8==a.nodeType&&k.test(g?a.text:a.nodeValue)}function c(a,c){for(var f=a,e=1,k=[];f=f.nextSibling;){if(d(f)&&(e--,0===e))return k;k.push(f);b(f)&&e++}if(!c)throw Error("Cannot find closing comment tag to match: "+a.nodeValue);return null}function e(a,b){var d=c(a,b);return d?0<d.length?d[d.length-1].nextSibling:a.nextSibling:null}var g=v&&"\x3c!--test--\x3e"===v.createComment("test").text,h=g?/^\x3c!--\s*ko(?:\s+([\s\S]+))?\s*--\x3e$/:/^\s*ko(?:\s+([\s\S]+))?\s*$/,
k=g?/^\x3c!--\s*\/ko\s*--\x3e$/:/^\s*\/ko\s*$/,f={ul:!0,ol:!0};a.f={Q:{},childNodes:function(a){return b(a)?c(a):a.childNodes},ja:function(c){if(b(c)){c=a.f.childNodes(c);for(var d=0,f=c.length;d<f;d++)a.removeNode(c[d])}else a.a.Ka(c)},T:function(c,d){if(b(c)){a.f.ja(c);for(var f=c.nextSibling,e=0,k=d.length;e<k;e++)f.parentNode.insertBefore(d[e],f)}else a.a.T(c,d)},Hb:function(a,c){b(a)?a.parentNode.insertBefore(c,a.nextSibling):a.firstChild?a.insertBefore(c,a.firstChild):a.appendChild(c)},Bb:function(c,
d,f){f?b(c)?c.parentNode.insertBefore(d,f.nextSibling):f.nextSibling?c.insertBefore(d,f.nextSibling):c.appendChild(d):a.f.Hb(c,d)},firstChild:function(a){return b(a)?!a.nextSibling||d(a.nextSibling)?null:a.nextSibling:a.firstChild},nextSibling:function(a){b(a)&&(a=e(a));return a.nextSibling&&d(a.nextSibling)?null:a.nextSibling},gc:b,xc:function(a){return(a=(g?a.text:a.nodeValue).match(h))?a[1]:null},Fb:function(c){if(f[a.a.t(c)]){var k=c.firstChild;if(k){do if(1===k.nodeType){var g;g=k.firstChild;
var h=null;if(g){do if(h)h.push(g);else if(b(g)){var t=e(g,!0);t?g=t:h=[g]}else d(g)&&(h=[g]);while(g=g.nextSibling)}if(g=h)for(h=k.nextSibling,t=0;t<g.length;t++)h?c.insertBefore(g[t],h):c.appendChild(g[t])}while(k=k.nextSibling)}}}}})();a.b("virtualElements",a.f);a.b("virtualElements.allowedBindings",a.f.Q);a.b("virtualElements.emptyNode",a.f.ja);a.b("virtualElements.insertAfter",a.f.Bb);a.b("virtualElements.prepend",a.f.Hb);a.b("virtualElements.setDomNodeChildren",a.f.T);(function(){a.J=function(){this.Yb=
{}};a.a.extend(a.J.prototype,{nodeHasBindings:function(b){switch(b.nodeType){case 1:return null!=b.getAttribute("data-bind")||a.g.getComponentNameForNode(b);case 8:return a.f.gc(b);default:return!1}},getBindings:function(b,d){var c=this.getBindingsString(b,d),c=c?this.parseBindingsString(c,d,b):null;return a.g.mb(c,b,d,!1)},getBindingAccessors:function(b,d){var c=this.getBindingsString(b,d),c=c?this.parseBindingsString(c,d,b,{valueAccessors:!0}):null;return a.g.mb(c,b,d,!0)},getBindingsString:function(b){switch(b.nodeType){case 1:return b.getAttribute("data-bind");
case 8:return a.f.xc(b);default:return null}},parseBindingsString:function(b,d,c,e){try{var g=this.Yb,h=b+(e&&e.valueAccessors||""),k;if(!(k=g[h])){var f,m="with($context){with($data||{}){return{"+a.h.ya(b,e)+"}}}";f=new Function("$context","$element",m);k=g[h]=f}return k(d,c)}catch(l){throw l.message="Unable to parse bindings.\nBindings value: "+b+"\nMessage: "+l.message,l;}}});a.J.instance=new a.J})();a.b("bindingProvider",a.J);(function(){function b(a){return function(){return a}}function d(a){return a()}
function c(b){return a.a.na(a.k.B(b),function(a,c){return function(){return b()[c]}})}function e(a,b){return c(this.getBindings.bind(this,a,b))}function g(b,c,d){var f,e=a.f.firstChild(c),k=a.J.instance,g=k.preprocessNode;if(g){for(;f=e;)e=a.f.nextSibling(f),g.call(k,f);e=a.f.firstChild(c)}for(;f=e;)e=a.f.nextSibling(f),h(b,f,d)}function h(b,c,d){var e=!0,k=1===c.nodeType;k&&a.f.Fb(c);if(k&&d||a.J.instance.nodeHasBindings(c))e=f(c,null,b,d).shouldBindDescendants;e&&!l[a.a.t(c)]&&g(b,c,!k)}function k(b){var c=
[],d={},f=[];a.a.G(b,function y(e){if(!d[e]){var k=a.getBindingHandler(e);k&&(k.after&&(f.push(e),a.a.u(k.after,function(c){if(b[c]){if(-1!==a.a.m(f,c))throw Error("Cannot combine the following bindings, because they have a cyclic dependency: "+f.join(", "));y(c)}}),f.length--),c.push({key:e,zb:k}));d[e]=!0}});return c}function f(b,c,f,g){var m=a.a.e.get(b,q);if(!c){if(m)throw Error("You cannot apply bindings multiple times to the same element.");a.a.e.set(b,q,!0)}!m&&g&&a.Ob(b,f);var l;if(c&&"function"!==
typeof c)l=c;else{var h=a.J.instance,n=h.getBindingAccessors||e,s=a.j(function(){(l=c?c(f,b):n.call(h,b,f))&&f.I&&f.I();return l},null,{o:b});l&&s.Z()||(s=null)}var v;if(l){var w=s?function(a){return function(){return d(s()[a])}}:function(a){return l[a]},A=function(){return a.a.na(s?s():l,d)};A.get=function(a){return l[a]&&d(w(a))};A.has=function(a){return a in l};g=k(l);a.a.u(g,function(c){var d=c.zb.init,e=c.zb.update,k=c.key;if(8===b.nodeType&&!a.f.Q[k])throw Error("The binding '"+k+"' cannot be used with virtual elements");
try{"function"==typeof d&&a.k.B(function(){var a=d(b,w(k),A,f.$data,f);if(a&&a.controlsDescendantBindings){if(v!==p)throw Error("Multiple bindings ("+v+" and "+k+") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");v=k}}),"function"==typeof e&&a.j(function(){e(b,w(k),A,f.$data,f)},null,{o:b})}catch(g){throw g.message='Unable to process binding "'+k+": "+l[k]+'"\nMessage: '+g.message,g;}})}return{shouldBindDescendants:v===p}}
function m(b){return b&&b instanceof a.N?b:new a.N(b)}a.d={};var l={script:!0};a.getBindingHandler=function(b){return a.d[b]};a.N=function(b,c,d,f){var e=this,k="function"==typeof b&&!a.C(b),g,m=a.j(function(){var g=k?b():b,l=a.a.c(g);c?(c.I&&c.I(),a.a.extend(e,c),m&&(e.I=m)):(e.$parents=[],e.$root=l,e.ko=a);e.$rawData=g;e.$data=l;d&&(e[d]=l);f&&f(e,c,l);return e.$data},null,{Ia:function(){return g&&!a.a.ob(g)},o:!0});m.Z()&&(e.I=m,m.equalityComparer=null,g=[],m.Tb=function(b){g.push(b);a.a.w.da(b,
function(b){a.a.ua(g,b);g.length||(m.K(),e.I=m=p)})})};a.N.prototype.createChildContext=function(b,c,d){return new a.N(b,this,c,function(a,b){a.$parentContext=b;a.$parent=b.$data;a.$parents=(b.$parents||[]).slice(0);a.$parents.unshift(a.$parent);d&&d(a)})};a.N.prototype.extend=function(b){return new a.N(this.I||this.$data,this,null,function(c,d){c.$rawData=d.$rawData;a.a.extend(c,"function"==typeof b?b():b)})};var q=a.a.e.F(),n=a.a.e.F();a.Ob=function(b,c){if(2==arguments.length)a.a.e.set(b,n,c),
c.I&&c.I.Tb(b);else return a.a.e.get(b,n)};a.ra=function(b,c,d){1===b.nodeType&&a.f.Fb(b);return f(b,c,m(d),!0)};a.Wb=function(d,f,e){e=m(e);return a.ra(d,"function"===typeof f?c(f.bind(null,e,d)):a.a.na(f,b),e)};a.Ca=function(a,b){1!==b.nodeType&&8!==b.nodeType||g(m(a),b,!0)};a.pb=function(a,b){!w&&s.jQuery&&(w=s.jQuery);if(b&&1!==b.nodeType&&8!==b.nodeType)throw Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");b=b||s.document.body;h(m(a),
b,!0)};a.Ha=function(b){switch(b.nodeType){case 1:case 8:var c=a.Ob(b);if(c)return c;if(b.parentNode)return a.Ha(b.parentNode)}return p};a.$b=function(b){return(b=a.Ha(b))?b.$data:p};a.b("bindingHandlers",a.d);a.b("applyBindings",a.pb);a.b("applyBindingsToDescendants",a.Ca);a.b("applyBindingAccessorsToNode",a.ra);a.b("applyBindingsToNode",a.Wb);a.b("contextFor",a.Ha);a.b("dataFor",a.$b)})();(function(b){function d(d,f){var e=g.hasOwnProperty(d)?g[d]:b,l;e||(e=g[d]=new a.P,c(d,function(a){h[d]=a;delete g[d];
l?e.notifySubscribers(a):setTimeout(function(){e.notifySubscribers(a)},0)}),l=!0);e.U(f)}function c(a,b){e("getConfig",[a],function(c){c?e("loadComponent",[a,c],function(a){b(a)}):b(null)})}function e(c,d,g,l){l||(l=a.g.loaders.slice(0));var h=l.shift();if(h){var n=h[c];if(n){var t=!1;if(n.apply(h,d.concat(function(a){t?g(null):null!==a?g(a):e(c,d,g,l)}))!==b&&(t=!0,!h.suppressLoaderExceptions))throw Error("Component loaders must supply values by invoking the callback, not by returning values synchronously.");
}else e(c,d,g,l)}else g(null)}var g={},h={};a.g={get:function(a,c){var e=h.hasOwnProperty(a)?h[a]:b;e?setTimeout(function(){c(e)},0):d(a,c)},tb:function(a){delete h[a]},jb:e};a.g.loaders=[];a.b("components",a.g);a.b("components.get",a.g.get);a.b("components.clearCachedDefinition",a.g.tb)})();(function(){function b(b,c,d,e){function k(){0===--u&&e(h)}var h={},u=2,r=d.template;d=d.viewModel;r?g(c,r,function(c){a.g.jb("loadTemplate",[b,c],function(a){h.template=a;k()})}):k();d?g(c,d,function(c){a.g.jb("loadViewModel",
[b,c],function(a){h[f]=a;k()})}):k()}function d(a,b,c){if("function"===typeof b)c(function(a){return new b(a)});else if("function"===typeof b[f])c(b[f]);else if("instance"in b){var e=b.instance;c(function(){return e})}else"viewModel"in b?d(a,b.viewModel,c):a("Unknown viewModel value: "+b)}function c(b){switch(a.a.t(b)){case "script":return a.a.ba(b.text);case "textarea":return a.a.ba(b.value);case "template":if(e(b.content))return a.a.ia(b.content.childNodes)}return a.a.ia(b.childNodes)}function e(a){return s.DocumentFragment?
a instanceof DocumentFragment:a&&11===a.nodeType}function g(a,b,c){"string"===typeof b.require?N||s.require?(N||s.require)([b.require],c):a("Uses require, but no AMD loader is present"):c(b)}function h(a){return function(b){throw Error("Component '"+a+"': "+b);}}var k={};a.g.tc=function(b,c){if(!c)throw Error("Invalid configuration for "+b);if(a.g.Qa(b))throw Error("Component "+b+" is already registered");k[b]=c};a.g.Qa=function(a){return a in k};a.g.wc=function(b){delete k[b];a.g.tb(b)};a.g.ub={getConfig:function(a,
b){b(k.hasOwnProperty(a)?k[a]:null)},loadComponent:function(a,c,d){var e=h(a);g(e,c,function(c){b(a,e,c,d)})},loadTemplate:function(b,d,f){b=h(b);if("string"===typeof d)f(a.a.ba(d));else if(d instanceof Array)f(d);else if(e(d))f(a.a.S(d.childNodes));else if(d.element)if(d=d.element,s.HTMLElement?d instanceof HTMLElement:d&&d.tagName&&1===d.nodeType)f(c(d));else if("string"===typeof d){var k=v.getElementById(d);k?f(c(k)):b("Cannot find element with ID "+d)}else b("Unknown element type: "+d);else b("Unknown template value: "+
d)},loadViewModel:function(a,b,c){d(h(a),b,c)}};var f="createViewModel";a.b("components.register",a.g.tc);a.b("components.isRegistered",a.g.Qa);a.b("components.unregister",a.g.wc);a.b("components.defaultLoader",a.g.ub);a.g.loaders.push(a.g.ub);a.g.Ub=k})();(function(){function b(b,e){var g=b.getAttribute("params");if(g){var g=d.parseBindingsString(g,e,b,{valueAccessors:!0,bindingParams:!0}),g=a.a.na(g,function(d){return a.s(d,null,{o:b})}),h=a.a.na(g,function(d){return d.Z()?a.s(function(){return a.a.c(d())},
null,{o:b}):d.v()});h.hasOwnProperty("$raw")||(h.$raw=g);return h}return{$raw:{}}}a.g.getComponentNameForNode=function(b){b=a.a.t(b);return a.g.Qa(b)&&b};a.g.mb=function(c,d,g,h){if(1===d.nodeType){var k=a.g.getComponentNameForNode(d);if(k){c=c||{};if(c.component)throw Error('Cannot use the "component" binding on a custom element matching a component');var f={name:k,params:b(d,g)};c.component=h?function(){return f}:f}}return c};var d=new a.J;9>a.a.L&&(a.g.register=function(a){return function(b){v.createElement(b);
return a.apply(this,arguments)}}(a.g.register),v.createDocumentFragment=function(b){return function(){var d=b(),g=a.g.Ub,h;for(h in g)g.hasOwnProperty(h)&&d.createElement(h);return d}}(v.createDocumentFragment))})();(function(){var b=0;a.d.component={init:function(d,c,e,g,h){function k(){var a=f&&f.dispose;"function"===typeof a&&a.call(f);m=null}var f,m;a.a.w.da(d,k);a.s(function(){var e=a.a.c(c()),g,n;"string"===typeof e?g=e:(g=a.a.c(e.name),n=a.a.c(e.params));if(!g)throw Error("No component name specified");
var t=m=++b;a.g.get(g,function(b){if(m===t){k();if(!b)throw Error("Unknown component '"+g+"'");var c=b.template;if(!c)throw Error("Component '"+g+"' has no template");c=a.a.ia(c);a.f.T(d,c);var c=n,e=b.createViewModel;b=e?e.call(b,c,{element:d}):c;c=h.createChildContext(b);f=b;a.Ca(c,d)}})},null,{o:d});return{controlsDescendantBindings:!0}}};a.f.Q.component=!0})();var Q={"class":"className","for":"htmlFor"};a.d.attr={update:function(b,d){var c=a.a.c(d())||{};a.a.G(c,function(c,d){d=a.a.c(d);var h=
!1===d||null===d||d===p;h&&b.removeAttribute(c);8>=a.a.L&&c in Q?(c=Q[c],h?b.removeAttribute(c):b[c]=d):h||b.setAttribute(c,d.toString());"name"===c&&a.a.Mb(b,h?"":d.toString())})}};(function(){a.d.checked={after:["value","attr"],init:function(b,d,c){function e(){var e=b.checked,k=q?h():e;if(!a.Y.ma()&&(!f||e)){var g=a.k.B(d);m?l!==k?(e&&(a.a.ea(g,k,!0),a.a.ea(g,l,!1)),l=k):a.a.ea(g,k,e):a.h.pa(g,c,"checked",k,!0)}}function g(){var c=a.a.c(d());b.checked=m?0<=a.a.m(c,h()):k?c:h()===c}var h=a.Ib(function(){return c.has("checkedValue")?
a.a.c(c.get("checkedValue")):c.has("value")?a.a.c(c.get("value")):b.value}),k="checkbox"==b.type,f="radio"==b.type;if(k||f){var m=k&&a.a.c(d())instanceof Array,l=m?h():p,q=f||m;f&&!b.name&&a.d.uniqueName.init(b,function(){return!0});a.s(e,null,{o:b});a.a.n(b,"click",e);a.s(g,null,{o:b})}}};a.h.V.checked=!0;a.d.checkedValue={update:function(b,d){b.value=a.a.c(d())}}})();a.d.css={update:function(b,d){var c=a.a.c(d());"object"==typeof c?a.a.G(c,function(c,d){d=a.a.c(d);a.a.Ba(b,c,d)}):(c=String(c||""),
a.a.Ba(b,b.__ko__cssValue,!1),b.__ko__cssValue=c,a.a.Ba(b,c,!0))}};a.d.enable={update:function(b,d){var c=a.a.c(d());c&&b.disabled?b.removeAttribute("disabled"):c||b.disabled||(b.disabled=!0)}};a.d.disable={update:function(b,d){a.d.enable.update(b,function(){return!a.a.c(d())})}};a.d.event={init:function(b,d,c,e,g){var h=d()||{};a.a.G(h,function(k){"string"==typeof k&&a.a.n(b,k,function(b){var h,l=d()[k];if(l){try{var q=a.a.S(arguments);e=g.$data;q.unshift(e);h=l.apply(e,q)}finally{!0!==h&&(b.preventDefault?
b.preventDefault():b.returnValue=!1)}!1===c.get(k+"Bubble")&&(b.cancelBubble=!0,b.stopPropagation&&b.stopPropagation())}})})}};a.d.foreach={Eb:function(b){return function(){var d=b(),c=a.a.Xa(d);if(!c||"number"==typeof c.length)return{foreach:d,templateEngine:a.O.Oa};a.a.c(d);return{foreach:c.data,as:c.as,includeDestroyed:c.includeDestroyed,afterAdd:c.afterAdd,beforeRemove:c.beforeRemove,afterRender:c.afterRender,beforeMove:c.beforeMove,afterMove:c.afterMove,templateEngine:a.O.Oa}}},init:function(b,
d){return a.d.template.init(b,a.d.foreach.Eb(d))},update:function(b,d,c,e,g){return a.d.template.update(b,a.d.foreach.Eb(d),c,e,g)}};a.h.ha.foreach=!1;a.f.Q.foreach=!0;a.d.hasfocus={init:function(b,d,c){function e(e){b.__ko_hasfocusUpdating=!0;var f=b.ownerDocument;if("activeElement"in f){var g;try{g=f.activeElement}catch(h){g=f.body}e=g===b}f=d();a.h.pa(f,c,"hasfocus",e,!0);b.__ko_hasfocusLastValue=e;b.__ko_hasfocusUpdating=!1}var g=e.bind(null,!0),h=e.bind(null,!1);a.a.n(b,"focus",g);a.a.n(b,"focusin",
g);a.a.n(b,"blur",h);a.a.n(b,"focusout",h)},update:function(b,d){var c=!!a.a.c(d());b.__ko_hasfocusUpdating||b.__ko_hasfocusLastValue===c||(c?b.focus():b.blur(),a.k.B(a.a.oa,null,[b,c?"focusin":"focusout"]))}};a.h.V.hasfocus=!0;a.d.hasFocus=a.d.hasfocus;a.h.V.hasFocus=!0;a.d.html={init:function(){return{controlsDescendantBindings:!0}},update:function(b,d){a.a.$a(b,d())}};I("if");I("ifnot",!1,!0);I("with",!0,!1,function(a,d){return a.createChildContext(d)});var K={};a.d.options={init:function(b){if("select"!==
a.a.t(b))throw Error("options binding applies only to SELECT elements");for(;0<b.length;)b.remove(0);return{controlsDescendantBindings:!0}},update:function(b,d,c){function e(){return a.a.ta(b.options,function(a){return a.selected})}function g(a,b,c){var d=typeof b;return"function"==d?b(a):"string"==d?a[b]:c}function h(c,d){if(q.length){var e=0<=a.a.m(q,a.i.q(d[0]));a.a.Nb(d[0],e);n&&!e&&a.k.B(a.a.oa,null,[b,"change"])}}var k=0!=b.length&&b.multiple?b.scrollTop:null,f=a.a.c(d()),m=c.get("optionsIncludeDestroyed");
d={};var l,q;q=b.multiple?a.a.Da(e(),a.i.q):0<=b.selectedIndex?[a.i.q(b.options[b.selectedIndex])]:[];f&&("undefined"==typeof f.length&&(f=[f]),l=a.a.ta(f,function(b){return m||b===p||null===b||!a.a.c(b._destroy)}),c.has("optionsCaption")&&(f=a.a.c(c.get("optionsCaption")),null!==f&&f!==p&&l.unshift(K)));var n=!1;d.beforeRemove=function(a){b.removeChild(a)};f=h;c.has("optionsAfterRender")&&(f=function(b,d){h(0,d);a.k.B(c.get("optionsAfterRender"),null,[d[0],b!==K?b:p])});a.a.Za(b,l,function(d,e,f){f.length&&
(q=f[0].selected?[a.i.q(f[0])]:[],n=!0);e=b.ownerDocument.createElement("option");d===K?(a.a.bb(e,c.get("optionsCaption")),a.i.ca(e,p)):(f=g(d,c.get("optionsValue"),d),a.i.ca(e,a.a.c(f)),d=g(d,c.get("optionsText"),f),a.a.bb(e,d));return[e]},d,f);a.k.B(function(){c.get("valueAllowUnset")&&c.has("value")?a.i.ca(b,a.a.c(c.get("value")),!0):(b.multiple?q.length&&e().length<q.length:q.length&&0<=b.selectedIndex?a.i.q(b.options[b.selectedIndex])!==q[0]:q.length||0<=b.selectedIndex)&&a.a.oa(b,"change")});
a.a.dc(b);k&&20<Math.abs(k-b.scrollTop)&&(b.scrollTop=k)}};a.d.options.Va=a.a.e.F();a.d.selectedOptions={after:["options","foreach"],init:function(b,d,c){a.a.n(b,"change",function(){var e=d(),g=[];a.a.u(b.getElementsByTagName("option"),function(b){b.selected&&g.push(a.i.q(b))});a.h.pa(e,c,"selectedOptions",g)})},update:function(b,d){if("select"!=a.a.t(b))throw Error("values binding applies only to SELECT elements");var c=a.a.c(d());c&&"number"==typeof c.length&&a.a.u(b.getElementsByTagName("option"),
function(b){var d=0<=a.a.m(c,a.i.q(b));a.a.Nb(b,d)})}};a.h.V.selectedOptions=!0;a.d.style={update:function(b,d){var c=a.a.c(d()||{});a.a.G(c,function(c,d){d=a.a.c(d);if(null===d||d===p||!1===d)d="";b.style[c]=d})}};a.d.submit={init:function(b,d,c,e,g){if("function"!=typeof d())throw Error("The value for a submit binding must be a function");a.a.n(b,"submit",function(a){var c,e=d();try{c=e.call(g.$data,b)}finally{!0!==c&&(a.preventDefault?a.preventDefault():a.returnValue=!1)}})}};a.d.text={init:function(){return{controlsDescendantBindings:!0}},
update:function(b,d){a.a.bb(b,d())}};a.f.Q.text=!0;(function(){if(s&&s.navigator)var b=function(a){if(a)return parseFloat(a[1])},d=s.opera&&s.opera.version&&parseInt(s.opera.version()),c=s.navigator.userAgent,e=b(c.match(/^(?:(?!chrome).)*version\/([^ ]*) safari/i)),g=b(c.match(/Firefox\/([^ ]*)/));if(10>a.a.L)var h=a.a.e.F(),k=a.a.e.F(),f=function(b){var c=this.activeElement;(c=c&&a.a.e.get(c,k))&&c(b)},m=function(b,c){var d=b.ownerDocument;a.a.e.get(d,h)||(a.a.e.set(d,h,!0),a.a.n(d,"selectionchange",
f));a.a.e.set(b,k,c)};a.d.textInput={init:function(b,c,f){function k(c,d){a.a.n(b,c,d)}function h(){var d=a.a.c(c());if(null===d||d===p)d="";v!==p&&d===v?setTimeout(h,4):b.value!==d&&(s=d,b.value=d)}function u(){y||(v=b.value,y=setTimeout(r,4))}function r(){clearTimeout(y);v=y=p;var d=b.value;s!==d&&(s=d,a.h.pa(c(),f,"textInput",d))}var s=b.value,y,v;10>a.a.L?(k("propertychange",function(a){"value"===a.propertyName&&r()}),8==a.a.L&&(k("keyup",r),k("keydown",r)),8<=a.a.L&&(m(b,r),k("dragend",u))):
(k("input",r),5>e&&"textarea"===a.a.t(b)?(k("keydown",u),k("paste",u),k("cut",u)):11>d?k("keydown",u):4>g&&(k("DOMAutoComplete",r),k("dragdrop",r),k("drop",r)));k("change",r);a.s(h,null,{o:b})}};a.h.V.textInput=!0;a.d.textinput={preprocess:function(a,b,c){c("textInput",a)}}})();a.d.uniqueName={init:function(b,d){if(d()){var c="ko_unique_"+ ++a.d.uniqueName.Zb;a.a.Mb(b,c)}}};a.d.uniqueName.Zb=0;a.d.value={after:["options","foreach"],init:function(b,d,c){if("input"!=b.tagName.toLowerCase()||"checkbox"!=
b.type&&"radio"!=b.type){var e=["change"],g=c.get("valueUpdate"),h=!1,k=null;g&&("string"==typeof g&&(g=[g]),a.a.ga(e,g),e=a.a.rb(e));var f=function(){k=null;h=!1;var e=d(),f=a.i.q(b);a.h.pa(e,c,"value",f)};!a.a.L||"input"!=b.tagName.toLowerCase()||"text"!=b.type||"off"==b.autocomplete||b.form&&"off"==b.form.autocomplete||-1!=a.a.m(e,"propertychange")||(a.a.n(b,"propertychange",function(){h=!0}),a.a.n(b,"focus",function(){h=!1}),a.a.n(b,"blur",function(){h&&f()}));a.a.u(e,function(c){var d=f;a.a.vc(c,
"after")&&(d=function(){k=a.i.q(b);setTimeout(f,0)},c=c.substring(5));a.a.n(b,c,d)});var m=function(){var e=a.a.c(d()),f=a.i.q(b);if(null!==k&&e===k)setTimeout(m,0);else if(e!==f)if("select"===a.a.t(b)){var g=c.get("valueAllowUnset"),f=function(){a.i.ca(b,e,g)};f();g||e===a.i.q(b)?setTimeout(f,0):a.k.B(a.a.oa,null,[b,"change"])}else a.i.ca(b,e)};a.s(m,null,{o:b})}else a.ra(b,{checkedValue:d})},update:function(){}};a.h.V.value=!0;a.d.visible={update:function(b,d){var c=a.a.c(d()),e="none"!=b.style.display;
c&&!e?b.style.display="":!c&&e&&(b.style.display="none")}};(function(b){a.d[b]={init:function(d,c,e,g,h){return a.d.event.init.call(this,d,function(){var a={};a[b]=c();return a},e,g,h)}}})("click");a.H=function(){};a.H.prototype.renderTemplateSource=function(){throw Error("Override renderTemplateSource");};a.H.prototype.createJavaScriptEvaluatorBlock=function(){throw Error("Override createJavaScriptEvaluatorBlock");};a.H.prototype.makeTemplateSource=function(b,d){if("string"==typeof b){d=d||v;var c=
d.getElementById(b);if(!c)throw Error("Cannot find template with ID "+b);return new a.r.l(c)}if(1==b.nodeType||8==b.nodeType)return new a.r.fa(b);throw Error("Unknown template type: "+b);};a.H.prototype.renderTemplate=function(a,d,c,e){a=this.makeTemplateSource(a,e);return this.renderTemplateSource(a,d,c)};a.H.prototype.isTemplateRewritten=function(a,d){return!1===this.allowTemplateRewriting?!0:this.makeTemplateSource(a,d).data("isRewritten")};a.H.prototype.rewriteTemplate=function(a,d,c){a=this.makeTemplateSource(a,
c);d=d(a.text());a.text(d);a.data("isRewritten",!0)};a.b("templateEngine",a.H);a.fb=function(){function b(b,c,d,k){b=a.h.Wa(b);for(var f=a.h.ha,m=0;m<b.length;m++){var l=b[m].key;if(f.hasOwnProperty(l)){var q=f[l];if("function"===typeof q){if(l=q(b[m].value))throw Error(l);}else if(!q)throw Error("This template engine does not support the '"+l+"' binding within its templates");}}d="ko.__tr_ambtns(function($context,$element){return(function(){return{ "+a.h.ya(b,{valueAccessors:!0})+" } })()},'"+d.toLowerCase()+
"')";return k.createJavaScriptEvaluatorBlock(d)+c}var d=/(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9\-]+(?:=(?:\"[^\"]*\"|\'[^\']*\'))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi,c=/\x3c!--\s*ko\b\s*([\s\S]*?)\s*--\x3e/g;return{ec:function(b,c,d){c.isTemplateRewritten(b,d)||c.rewriteTemplate(b,function(b){return a.fb.nc(b,c)},d)},nc:function(a,g){return a.replace(d,function(a,c,d,e,l){return b(l,c,d,g)}).replace(c,function(a,c){return b(c,"\x3c!-- ko --\x3e","#comment",g)})},Xb:function(b,c){return a.D.Ua(function(d,
k){var f=d.nextSibling;f&&f.nodeName.toLowerCase()===c&&a.ra(f,b,k)})}}}();a.b("__tr_ambtns",a.fb.Xb);(function(){a.r={};a.r.l=function(a){this.l=a};a.r.l.prototype.text=function(){var b=a.a.t(this.l),b="script"===b?"text":"textarea"===b?"value":"innerHTML";if(0==arguments.length)return this.l[b];var d=arguments[0];"innerHTML"===b?a.a.$a(this.l,d):this.l[b]=d};var b=a.a.e.F()+"_";a.r.l.prototype.data=function(c){if(1===arguments.length)return a.a.e.get(this.l,b+c);a.a.e.set(this.l,b+c,arguments[1])};
var d=a.a.e.F();a.r.fa=function(a){this.l=a};a.r.fa.prototype=new a.r.l;a.r.fa.prototype.text=function(){if(0==arguments.length){var b=a.a.e.get(this.l,d)||{};b.gb===p&&b.Ga&&(b.gb=b.Ga.innerHTML);return b.gb}a.a.e.set(this.l,d,{gb:arguments[0]})};a.r.l.prototype.nodes=function(){if(0==arguments.length)return(a.a.e.get(this.l,d)||{}).Ga;a.a.e.set(this.l,d,{Ga:arguments[0]})};a.b("templateSources",a.r);a.b("templateSources.domElement",a.r.l);a.b("templateSources.anonymousTemplate",a.r.fa)})();(function(){function b(b,
c,d){var e;for(c=a.f.nextSibling(c);b&&(e=b)!==c;)b=a.f.nextSibling(e),d(e,b)}function d(c,d){if(c.length){var e=c[0],g=c[c.length-1],h=e.parentNode,n=a.J.instance,t=n.preprocessNode;if(t){b(e,g,function(a,b){var c=a.previousSibling,d=t.call(n,a);d&&(a===e&&(e=d[0]||b),a===g&&(g=d[d.length-1]||c))});c.length=0;if(!e)return;e===g?c.push(e):(c.push(e,g),a.a.ka(c,h))}b(e,g,function(b){1!==b.nodeType&&8!==b.nodeType||a.pb(d,b)});b(e,g,function(b){1!==b.nodeType&&8!==b.nodeType||a.D.Sb(b,[d])});a.a.ka(c,
h)}}function c(a){return a.nodeType?a:0<a.length?a[0]:null}function e(b,e,h,l,q){q=q||{};var n=b&&c(b),n=n&&n.ownerDocument,t=q.templateEngine||g;a.fb.ec(h,t,n);h=t.renderTemplate(h,l,q,n);if("number"!=typeof h.length||0<h.length&&"number"!=typeof h[0].nodeType)throw Error("Template engine must return an array of DOM nodes");n=!1;switch(e){case "replaceChildren":a.f.T(b,h);n=!0;break;case "replaceNode":a.a.Lb(b,h);n=!0;break;case "ignoreTargetNode":break;default:throw Error("Unknown renderMode: "+
e);}n&&(d(h,l),q.afterRender&&a.k.B(q.afterRender,null,[h,l.$data]));return h}var g;a.ab=function(b){if(b!=p&&!(b instanceof a.H))throw Error("templateEngine must inherit from ko.templateEngine");g=b};a.Ya=function(b,d,h,l,q){h=h||{};if((h.templateEngine||g)==p)throw Error("Set a template engine before calling renderTemplate");q=q||"replaceChildren";if(l){var n=c(l);return a.j(function(){var g=d&&d instanceof a.N?d:new a.N(a.a.c(d)),p=a.C(b)?b():"function"===typeof b?b(g.$data,g):b,g=e(l,q,p,g,h);
"replaceNode"==q&&(l=g,n=c(l))},null,{Ia:function(){return!n||!a.a.Ja(n)},o:n&&"replaceNode"==q?n.parentNode:n})}return a.D.Ua(function(c){a.Ya(b,d,h,c,"replaceNode")})};a.uc=function(b,c,g,h,q){function n(a,b){d(b,s);g.afterRender&&g.afterRender(b,a)}function t(c,d){s=q.createChildContext(c,g.as,function(a){a.$index=d});var f=a.C(b)?b():"function"===typeof b?b(c,s):b;return e(null,"ignoreTargetNode",f,s,g)}var s;return a.j(function(){var b=a.a.c(c)||[];"undefined"==typeof b.length&&(b=[b]);b=a.a.ta(b,
function(b){return g.includeDestroyed||b===p||null===b||!a.a.c(b._destroy)});a.k.B(a.a.Za,null,[h,b,t,g,n])},null,{o:h})};var h=a.a.e.F();a.d.template={init:function(b,c){var d=a.a.c(c());"string"==typeof d||d.name?a.f.ja(b):(d=a.f.childNodes(b),d=a.a.oc(d),(new a.r.fa(b)).nodes(d));return{controlsDescendantBindings:!0}},update:function(b,c,d,e,g){var n=c(),t;c=a.a.c(n);d=!0;e=null;"string"==typeof c?c={}:(n=c.name,"if"in c&&(d=a.a.c(c["if"])),d&&"ifnot"in c&&(d=!a.a.c(c.ifnot)),t=a.a.c(c.data));
"foreach"in c?e=a.uc(n||b,d&&c.foreach||[],c,b,g):d?(g="data"in c?g.createChildContext(t,c.as):g,e=a.Ya(n||b,g,c,b)):a.f.ja(b);g=e;(t=a.a.e.get(b,h))&&"function"==typeof t.K&&t.K();a.a.e.set(b,h,g&&g.Z()?g:p)}};a.h.ha.template=function(b){b=a.h.Wa(b);return 1==b.length&&b[0].unknown||a.h.lc(b,"name")?null:"This template engine does not support anonymous templates nested within its templates"};a.f.Q.template=!0})();a.b("setTemplateEngine",a.ab);a.b("renderTemplate",a.Ya);a.a.wb=function(a,d,c){if(a.length&&
d.length){var e,g,h,k,f;for(e=g=0;(!c||e<c)&&(k=a[g]);++g){for(h=0;f=d[h];++h)if(k.value===f.value){k.moved=f.index;f.moved=k.index;d.splice(h,1);e=h=0;break}e+=h}}};a.a.Fa=function(){function b(b,c,e,g,h){var k=Math.min,f=Math.max,m=[],l,q=b.length,n,p=c.length,s=p-q||1,u=q+p+1,r,v,w;for(l=0;l<=q;l++)for(v=r,m.push(r=[]),w=k(p,l+s),n=f(0,l-1);n<=w;n++)r[n]=n?l?b[l-1]===c[n-1]?v[n-1]:k(v[n]||u,r[n-1]||u)+1:n+1:l+1;k=[];f=[];s=[];l=q;for(n=p;l||n;)p=m[l][n]-1,n&&p===m[l][n-1]?f.push(k[k.length]={status:e,
value:c[--n],index:n}):l&&p===m[l-1][n]?s.push(k[k.length]={status:g,value:b[--l],index:l}):(--n,--l,h.sparse||k.push({status:"retained",value:c[n]}));a.a.wb(f,s,10*q);return k.reverse()}return function(a,c,e){e="boolean"===typeof e?{dontLimitMoves:e}:e||{};a=a||[];c=c||[];return a.length<=c.length?b(a,c,"added","deleted",e):b(c,a,"deleted","added",e)}}();a.b("utils.compareArrays",a.a.Fa);(function(){function b(b,d,g,h,k){var f=[],m=a.j(function(){var l=d(g,k,a.a.ka(f,b))||[];0<f.length&&(a.a.Lb(f,
l),h&&a.k.B(h,null,[g,l,k]));f.length=0;a.a.ga(f,l)},null,{o:b,Ia:function(){return!a.a.ob(f)}});return{$:f,j:m.Z()?m:p}}var d=a.a.e.F();a.a.Za=function(c,e,g,h,k){function f(b,d){x=q[d];r!==d&&(A[b]=x);x.Na(r++);a.a.ka(x.$,c);s.push(x);w.push(x)}function m(b,c){if(b)for(var d=0,e=c.length;d<e;d++)c[d]&&a.a.u(c[d].$,function(a){b(a,d,c[d].sa)})}e=e||[];h=h||{};var l=a.a.e.get(c,d)===p,q=a.a.e.get(c,d)||[],n=a.a.Da(q,function(a){return a.sa}),t=a.a.Fa(n,e,h.dontLimitMoves),s=[],u=0,r=0,v=[],w=[];e=
[];for(var A=[],n=[],x,B=0,D,F;D=t[B];B++)switch(F=D.moved,D.status){case "deleted":F===p&&(x=q[u],x.j&&x.j.K(),v.push.apply(v,a.a.ka(x.$,c)),h.beforeRemove&&(e[B]=x,w.push(x)));u++;break;case "retained":f(B,u++);break;case "added":F!==p?f(B,F):(x={sa:D.value,Na:a.p(r++)},s.push(x),w.push(x),l||(n[B]=x))}m(h.beforeMove,A);a.a.u(v,h.beforeRemove?a.R:a.removeNode);for(var B=0,l=a.f.firstChild(c),G;x=w[B];B++){x.$||a.a.extend(x,b(c,g,x.sa,k,x.Na));for(u=0;t=x.$[u];l=t.nextSibling,G=t,u++)t!==l&&a.f.Bb(c,
t,G);!x.ic&&k&&(k(x.sa,x.$,x.Na),x.ic=!0)}m(h.beforeRemove,e);m(h.afterMove,A);m(h.afterAdd,n);a.a.e.set(c,d,s)}})();a.b("utils.setDomNodeChildrenFromArrayMapping",a.a.Za);a.O=function(){this.allowTemplateRewriting=!1};a.O.prototype=new a.H;a.O.prototype.renderTemplateSource=function(b){var d=(9>a.a.L?0:b.nodes)?b.nodes():null;if(d)return a.a.S(d.cloneNode(!0).childNodes);b=b.text();return a.a.ba(b)};a.O.Oa=new a.O;a.ab(a.O.Oa);a.b("nativeTemplateEngine",a.O);(function(){a.Sa=function(){var a=this.kc=
function(){if(!w||!w.tmpl)return 0;try{if(0<=w.tmpl.tag.tmpl.open.toString().indexOf("__"))return 2}catch(a){}return 1}();this.renderTemplateSource=function(b,e,g){g=g||{};if(2>a)throw Error("Your version of jQuery.tmpl is too old. Please upgrade to jQuery.tmpl 1.0.0pre or later.");var h=b.data("precompiled");h||(h=b.text()||"",h=w.template(null,"{{ko_with $item.koBindingContext}}"+h+"{{/ko_with}}"),b.data("precompiled",h));b=[e.$data];e=w.extend({koBindingContext:e},g.templateOptions);e=w.tmpl(h,
b,e);e.appendTo(v.createElement("div"));w.fragments={};return e};this.createJavaScriptEvaluatorBlock=function(a){return"{{ko_code ((function() { return "+a+" })()) }}"};this.addTemplate=function(a,b){v.write("<script type='text/html' id='"+a+"'>"+b+"\x3c/script>")};0<a&&(w.tmpl.tag.ko_code={open:"__.push($1 || '');"},w.tmpl.tag.ko_with={open:"with($1) {",close:"} "})};a.Sa.prototype=new a.H;var b=new a.Sa;0<b.kc&&a.ab(b);a.b("jqueryTmplTemplateEngine",a.Sa)})()})})();})();

(function (factory) {
	// Module systems magic dance.

	if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
		// CommonJS or Node: hard-coded dependency on "knockout"
		factory(require("knockout"), exports);
	} else if (typeof define === "function" && define["amd"]) {
		// AMD anonymous module with hard-coded dependency on "knockout"
		define('knockout.mapping',["knockout", "exports"], factory);
	} else {
		// <script> tag: use the global `ko` object, attaching a `mapping` property
		factory(ko, ko.mapping = {});
	}
}(function (ko, exports) {
	var DEBUG=true;
	var mappingProperty = "__ko_mapping__";
	var realKoDependentObservable = ko.dependentObservable;
	var mappingNesting = 0;
	var dependentObservables;
	var visitedObjects;
	var recognizedRootProperties = ["create", "update", "key", "arrayChanged"];
	var emptyReturn = {};

	var _defaultOptions = {
		include: ["_destroy"],
		ignore: [],
		copy: [],
		observe: []
	};
	var defaultOptions = _defaultOptions;

	// Author: KennyTM @ StackOverflow
	function unionArrays (x, y) {
		var obj = {};
		for (var i = x.length - 1; i >= 0; -- i) obj[x[i]] = x[i];
		for (var i = y.length - 1; i >= 0; -- i) obj[y[i]] = y[i];
		var res = [];

		for (var k in obj) {
			res.push(obj[k]);
		};

		return res;
	}

	function extendObject(destination, source) {
		var destType;

		for (var key in source) {
			if (source.hasOwnProperty(key) && source[key]) {
				destType = exports.getType(destination[key]);
				if (key && destination[key] && destType !== "array" && destType !== "string") {
					extendObject(destination[key], source[key]);
				} else {
					var bothArrays = exports.getType(destination[key]) === "array" && exports.getType(source[key]) === "array";
					if (bothArrays) {
						destination[key] = unionArrays(destination[key], source[key]);
					} else {
						destination[key] = source[key];
					}
				}
			}
		}
	}

	function merge(obj1, obj2) {
		var merged = {};
		extendObject(merged, obj1);
		extendObject(merged, obj2);

		return merged;
	}

	exports.isMapped = function (viewModel) {
		var unwrapped = ko.utils.unwrapObservable(viewModel);
		return unwrapped && unwrapped[mappingProperty];
	}

	exports.fromJS = function (jsObject /*, inputOptions, target*/ ) {
		if (arguments.length == 0) throw new Error("When calling ko.fromJS, pass the object you want to convert.");

		try {
			if (!mappingNesting++) {
				dependentObservables = [];
				visitedObjects = new objectLookup();
			}

			var options;
			var target;

			if (arguments.length == 2) {
				if (arguments[1][mappingProperty]) {
					target = arguments[1];
				} else {
					options = arguments[1];
				}
			}
			if (arguments.length == 3) {
				options = arguments[1];
				target = arguments[2];
			}

			if (target) {
				options = merge(options, target[mappingProperty]);
			}
			options = fillOptions(options);

			var result = updateViewModel(target, jsObject, options);
			if (target) {
				result = target;
			}

			// Evaluate any dependent observables that were proxied.
			// Do this after the model's observables have been created
			if (!--mappingNesting) {
				while (dependentObservables.length) {
					var DO = dependentObservables.pop();
					if (DO) {
						DO();
						
						// Move this magic property to the underlying dependent observable
						DO.__DO["throttleEvaluation"] = DO["throttleEvaluation"];
					}
				}
			}

			// Save any new mapping options in the view model, so that updateFromJS can use them later.
			result[mappingProperty] = merge(result[mappingProperty], options);

			return result;
		} catch(e) {
			mappingNesting = 0;
			throw e;
		}
	};

	exports.fromJSON = function (jsonString /*, options, target*/ ) {
		var parsed = ko.utils.parseJson(jsonString);
		arguments[0] = parsed;
		return exports.fromJS.apply(this, arguments);
	};

	exports.updateFromJS = function (viewModel) {
		throw new Error("ko.mapping.updateFromJS, use ko.mapping.fromJS instead. Please note that the order of parameters is different!");
	};

	exports.updateFromJSON = function (viewModel) {
		throw new Error("ko.mapping.updateFromJSON, use ko.mapping.fromJSON instead. Please note that the order of parameters is different!");
	};

	exports.toJS = function (rootObject, options) {
		if (!defaultOptions) exports.resetDefaultOptions();

		if (arguments.length == 0) throw new Error("When calling ko.mapping.toJS, pass the object you want to convert.");
		if (exports.getType(defaultOptions.ignore) !== "array") throw new Error("ko.mapping.defaultOptions().ignore should be an array.");
		if (exports.getType(defaultOptions.include) !== "array") throw new Error("ko.mapping.defaultOptions().include should be an array.");
		if (exports.getType(defaultOptions.copy) !== "array") throw new Error("ko.mapping.defaultOptions().copy should be an array.");

		// Merge in the options used in fromJS
		options = fillOptions(options, rootObject[mappingProperty]);

		// We just unwrap everything at every level in the object graph
		return exports.visitModel(rootObject, function (x) {
			return ko.utils.unwrapObservable(x)
		}, options);
	};

	exports.toJSON = function (rootObject, options) {
		var plainJavaScriptObject = exports.toJS(rootObject, options);
		return ko.utils.stringifyJson(plainJavaScriptObject);
	};

	exports.defaultOptions = function () {
		if (arguments.length > 0) {
			defaultOptions = arguments[0];
		} else {
			return defaultOptions;
		}
	};

	exports.resetDefaultOptions = function () {
		defaultOptions = {
			include: _defaultOptions.include.slice(0),
			ignore: _defaultOptions.ignore.slice(0),
			copy: _defaultOptions.copy.slice(0)
		};
	};

	exports.getType = function(x) {
		if ((x) && (typeof (x) === "object")) {
			if (x.constructor === Date) return "date";
			if (x.constructor === Array) return "array";
		}
		return typeof x;
	}

	function fillOptions(rawOptions, otherOptions) {
		var options = merge({}, rawOptions);

		// Move recognized root-level properties into a root namespace
		for (var i = recognizedRootProperties.length - 1; i >= 0; i--) {
			var property = recognizedRootProperties[i];
			
			// Carry on, unless this property is present
			if (!options[property]) continue;
			
			// Move the property into the root namespace
			if (!(options[""] instanceof Object)) options[""] = {};
			options[""][property] = options[property];
			delete options[property];
		}

		if (otherOptions) {
			options.ignore = mergeArrays(otherOptions.ignore, options.ignore);
			options.include = mergeArrays(otherOptions.include, options.include);
			options.copy = mergeArrays(otherOptions.copy, options.copy);
			options.observe = mergeArrays(otherOptions.observe, options.observe);
		}
		options.ignore = mergeArrays(options.ignore, defaultOptions.ignore);
		options.include = mergeArrays(options.include, defaultOptions.include);
		options.copy = mergeArrays(options.copy, defaultOptions.copy);
		options.observe = mergeArrays(options.observe, defaultOptions.observe);

		options.mappedProperties = options.mappedProperties || {};
		options.copiedProperties = options.copiedProperties || {};
		return options;
	}

	function mergeArrays(a, b) {
		if (exports.getType(a) !== "array") {
			if (exports.getType(a) === "undefined") a = [];
			else a = [a];
		}
		if (exports.getType(b) !== "array") {
			if (exports.getType(b) === "undefined") b = [];
			else b = [b];
		}

		return ko.utils.arrayGetDistinctValues(a.concat(b));
	}

	// When using a 'create' callback, we proxy the dependent observable so that it doesn't immediately evaluate on creation.
	// The reason is that the dependent observables in the user-specified callback may contain references to properties that have not been mapped yet.
	function withProxyDependentObservable(dependentObservables, callback) {
		var localDO = ko.dependentObservable;
		ko.dependentObservable = function (read, owner, options) {
			options = options || {};

			if (read && typeof read == "object") { // mirrors condition in knockout implementation of DO's
				options = read;
			}

			var realDeferEvaluation = options.deferEvaluation;

			var isRemoved = false;

			// We wrap the original dependent observable so that we can remove it from the 'dependentObservables' list we need to evaluate after mapping has
			// completed if the user already evaluated the DO themselves in the meantime.
			var wrap = function (DO) {
				// Temporarily revert ko.dependentObservable, since it is used in ko.isWriteableObservable
				var tmp = ko.dependentObservable;
				ko.dependentObservable = realKoDependentObservable;
				var isWriteable = ko.isWriteableObservable(DO);
				ko.dependentObservable = tmp;

				var wrapped = realKoDependentObservable({
					read: function () {
						if (!isRemoved) {
							ko.utils.arrayRemoveItem(dependentObservables, DO);
							isRemoved = true;
						}
						return DO.apply(DO, arguments);
					},
					write: isWriteable && function (val) {
						return DO(val);
					},
					deferEvaluation: true
				});
				if (DEBUG) wrapped._wrapper = true;
				wrapped.__DO = DO;
				return wrapped;
			};
			
			options.deferEvaluation = true; // will either set for just options, or both read/options.
			var realDependentObservable = new realKoDependentObservable(read, owner, options);

			if (!realDeferEvaluation) {
				realDependentObservable = wrap(realDependentObservable);
				dependentObservables.push(realDependentObservable);
			}

			return realDependentObservable;
		}
		ko.dependentObservable.fn = realKoDependentObservable.fn;
		ko.computed = ko.dependentObservable;
		var result = callback();
		ko.dependentObservable = localDO;
		ko.computed = ko.dependentObservable;
		return result;
	}

	function updateViewModel(mappedRootObject, rootObject, options, parentName, parent, parentPropertyName, mappedParent) {
		var isArray = exports.getType(ko.utils.unwrapObservable(rootObject)) === "array";

		parentPropertyName = parentPropertyName || "";

		// If this object was already mapped previously, take the options from there and merge them with our existing ones.
		if (exports.isMapped(mappedRootObject)) {
			var previousMapping = ko.utils.unwrapObservable(mappedRootObject)[mappingProperty];
			options = merge(previousMapping, options);
		}

		var callbackParams = {
			data: rootObject,
			parent: mappedParent || parent
		};

		var hasCreateCallback = function () {
			return options[parentName] && options[parentName].create instanceof Function;
		};

		var createCallback = function (data) {
			return withProxyDependentObservable(dependentObservables, function () {
				
				if (ko.utils.unwrapObservable(parent) instanceof Array) {
					return options[parentName].create({
						data: data || callbackParams.data,
						parent: callbackParams.parent,
						skip: emptyReturn
					});
				} else {
					return options[parentName].create({
						data: data || callbackParams.data,
						parent: callbackParams.parent
					});
				}				
			});
		};

		var hasUpdateCallback = function () {
			return options[parentName] && options[parentName].update instanceof Function;
		};

		var updateCallback = function (obj, data) {
			var params = {
				data: data || callbackParams.data,
				parent: callbackParams.parent,
				target: ko.utils.unwrapObservable(obj)
			};

			if (ko.isWriteableObservable(obj)) {
				params.observable = obj;
			}

			return options[parentName].update(params);
		}

		var alreadyMapped = visitedObjects.get(rootObject);
		if (alreadyMapped) {
			return alreadyMapped;
		}

		parentName = parentName || "";

		if (!isArray) {
			// For atomic types, do a direct update on the observable
			if (!canHaveProperties(rootObject)) {
				switch (exports.getType(rootObject)) {
				case "function":
					if (hasUpdateCallback()) {
						if (ko.isWriteableObservable(rootObject)) {
							rootObject(updateCallback(rootObject));
							mappedRootObject = rootObject;
						} else {
							mappedRootObject = updateCallback(rootObject);
						}
					} else {
						mappedRootObject = rootObject;
					}
					break;
				default:
					if (ko.isWriteableObservable(mappedRootObject)) {
						if (hasUpdateCallback()) {
							var valueToWrite = updateCallback(mappedRootObject);
							mappedRootObject(valueToWrite);
							return valueToWrite;
						} else {
							var valueToWrite = ko.utils.unwrapObservable(rootObject);
							mappedRootObject(valueToWrite);
							return valueToWrite;
						}
					} else {
						var hasCreateOrUpdateCallback = hasCreateCallback() || hasUpdateCallback();
						
						if (hasCreateCallback()) {
							mappedRootObject = createCallback();
						} else {
							mappedRootObject = ko.observable(ko.utils.unwrapObservable(rootObject));
						}

						if (hasUpdateCallback()) {
							mappedRootObject(updateCallback(mappedRootObject));
						}
						
						if (hasCreateOrUpdateCallback) return mappedRootObject;
					}
				}

			} else {
				mappedRootObject = ko.utils.unwrapObservable(mappedRootObject);
				if (!mappedRootObject) {
					if (hasCreateCallback()) {
						var result = createCallback();

						if (hasUpdateCallback()) {
							result = updateCallback(result);
						}

						return result;
					} else {
						if (hasUpdateCallback()) {
							return updateCallback(result);
						}

						mappedRootObject = {};
					}
				}

				if (hasUpdateCallback()) {
					mappedRootObject = updateCallback(mappedRootObject);
				}

				visitedObjects.save(rootObject, mappedRootObject);
				if (hasUpdateCallback()) return mappedRootObject;

				// For non-atomic types, visit all properties and update recursively
				visitPropertiesOrArrayEntries(rootObject, function (indexer) {
					var fullPropertyName = parentPropertyName.length ? parentPropertyName + "." + indexer : indexer;

					if (ko.utils.arrayIndexOf(options.ignore, fullPropertyName) != -1) {
						return;
					}

					if (ko.utils.arrayIndexOf(options.copy, fullPropertyName) != -1) {
						mappedRootObject[indexer] = rootObject[indexer];
						return;
					}

					if(typeof rootObject[indexer] != "object" && typeof rootObject[indexer] != "array" && options.observe.length > 0 && ko.utils.arrayIndexOf(options.observe, fullPropertyName) == -1)
					{
						mappedRootObject[indexer] = rootObject[indexer];
						options.copiedProperties[fullPropertyName] = true;
						return;
					}
					
					// In case we are adding an already mapped property, fill it with the previously mapped property value to prevent recursion.
					// If this is a property that was generated by fromJS, we should use the options specified there
					var prevMappedProperty = visitedObjects.get(rootObject[indexer]);
					var retval = updateViewModel(mappedRootObject[indexer], rootObject[indexer], options, indexer, mappedRootObject, fullPropertyName, mappedRootObject);
					var value = prevMappedProperty || retval;
					
					if(options.observe.length > 0 && ko.utils.arrayIndexOf(options.observe, fullPropertyName) == -1)
					{
						mappedRootObject[indexer] = value();
						options.copiedProperties[fullPropertyName] = true;
						return;
					}
					
					if (ko.isWriteableObservable(mappedRootObject[indexer])) {
						value = ko.utils.unwrapObservable(value);
						if (mappedRootObject[indexer]() !== value) {
							mappedRootObject[indexer](value);
						}
					} else {
						value = mappedRootObject[indexer] === undefined ? value : ko.utils.unwrapObservable(value);
						mappedRootObject[indexer] = value;
					}

					options.mappedProperties[fullPropertyName] = true;
				});
			}
		} else { //mappedRootObject is an array
			var changes = [];

			var hasKeyCallback = false;
			var keyCallback = function (x) {
				return x;
			}
			if (options[parentName] && options[parentName].key) {
				keyCallback = options[parentName].key;
				hasKeyCallback = true;
			}

			if (!ko.isObservable(mappedRootObject)) {
				// When creating the new observable array, also add a bunch of utility functions that take the 'key' of the array items into account.
				mappedRootObject = ko.observableArray([]);

				mappedRootObject.mappedRemove = function (valueOrPredicate) {
					var predicate = typeof valueOrPredicate == "function" ? valueOrPredicate : function (value) {
							return value === keyCallback(valueOrPredicate);
						};
					return mappedRootObject.remove(function (item) {
						return predicate(keyCallback(item));
					});
				}

				mappedRootObject.mappedRemoveAll = function (arrayOfValues) {
					var arrayOfKeys = filterArrayByKey(arrayOfValues, keyCallback);
					return mappedRootObject.remove(function (item) {
						return ko.utils.arrayIndexOf(arrayOfKeys, keyCallback(item)) != -1;
					});
				}

				mappedRootObject.mappedDestroy = function (valueOrPredicate) {
					var predicate = typeof valueOrPredicate == "function" ? valueOrPredicate : function (value) {
							return value === keyCallback(valueOrPredicate);
						};
					return mappedRootObject.destroy(function (item) {
						return predicate(keyCallback(item));
					});
				}

				mappedRootObject.mappedDestroyAll = function (arrayOfValues) {
					var arrayOfKeys = filterArrayByKey(arrayOfValues, keyCallback);
					return mappedRootObject.destroy(function (item) {
						return ko.utils.arrayIndexOf(arrayOfKeys, keyCallback(item)) != -1;
					});
				}

				mappedRootObject.mappedIndexOf = function (item) {
					var keys = filterArrayByKey(mappedRootObject(), keyCallback);
					var key = keyCallback(item);
					return ko.utils.arrayIndexOf(keys, key);
				}

				mappedRootObject.mappedGet = function (item) {
					return mappedRootObject()[mappedRootObject.mappedIndexOf(item)];
				}

				mappedRootObject.mappedCreate = function (value) {
					if (mappedRootObject.mappedIndexOf(value) !== -1) {
						throw new Error("There already is an object with the key that you specified.");
					}

					var item = hasCreateCallback() ? createCallback(value) : value;
					if (hasUpdateCallback()) {
						var newValue = updateCallback(item, value);
						if (ko.isWriteableObservable(item)) {
							item(newValue);
						} else {
							item = newValue;
						}
					}
					mappedRootObject.push(item);
					return item;
				}
			}

			var currentArrayKeys = filterArrayByKey(ko.utils.unwrapObservable(mappedRootObject), keyCallback).sort();
			var newArrayKeys = filterArrayByKey(rootObject, keyCallback);
			if (hasKeyCallback) newArrayKeys.sort();
			var editScript = ko.utils.compareArrays(currentArrayKeys, newArrayKeys);

			var ignoreIndexOf = {};
			
			var i, j;

			var unwrappedRootObject = ko.utils.unwrapObservable(rootObject);
			var itemsByKey = {};
			var optimizedKeys = true;
			for (i = 0, j = unwrappedRootObject.length; i < j; i++) {
				var key = keyCallback(unwrappedRootObject[i]);
				if (key === undefined || key instanceof Object) {
					optimizedKeys = false;
					break;
				}
				itemsByKey[key] = unwrappedRootObject[i];
			}

			var newContents = [];
			var passedOver = 0;
			for (i = 0, j = editScript.length; i < j; i++) {
				var key = editScript[i];
				var mappedItem;
				var fullPropertyName = parentPropertyName + "[" + i + "]";
				switch (key.status) {
				case "added":
					var item = optimizedKeys ? itemsByKey[key.value] : getItemByKey(ko.utils.unwrapObservable(rootObject), key.value, keyCallback);
					mappedItem = updateViewModel(undefined, item, options, parentName, mappedRootObject, fullPropertyName, parent);
					if(!hasCreateCallback()) {
						mappedItem = ko.utils.unwrapObservable(mappedItem);
					}

					var index = ignorableIndexOf(ko.utils.unwrapObservable(rootObject), item, ignoreIndexOf);
					
					if (mappedItem === emptyReturn) {
						passedOver++;
					} else {
						newContents[index - passedOver] = mappedItem;
					}
						
					ignoreIndexOf[index] = true;
					break;
				case "retained":
					var item = optimizedKeys ? itemsByKey[key.value] : getItemByKey(ko.utils.unwrapObservable(rootObject), key.value, keyCallback);
					mappedItem = getItemByKey(mappedRootObject, key.value, keyCallback);
					updateViewModel(mappedItem, item, options, parentName, mappedRootObject, fullPropertyName, parent);

					var index = ignorableIndexOf(ko.utils.unwrapObservable(rootObject), item, ignoreIndexOf);
					newContents[index] = mappedItem;
					ignoreIndexOf[index] = true;
					break;
				case "deleted":
					mappedItem = getItemByKey(mappedRootObject, key.value, keyCallback);
					break;
				}

				changes.push({
					event: key.status,
					item: mappedItem
				});
			}

			mappedRootObject(newContents);

			if (options[parentName] && options[parentName].arrayChanged) {
				ko.utils.arrayForEach(changes, function (change) {
					options[parentName].arrayChanged(change.event, change.item);
				});
			}
		}

		return mappedRootObject;
	}

	function ignorableIndexOf(array, item, ignoreIndices) {
		for (var i = 0, j = array.length; i < j; i++) {
			if (ignoreIndices[i] === true) continue;
			if (array[i] === item) return i;
		}
		return null;
	}

	function mapKey(item, callback) {
		var mappedItem;
		if (callback) mappedItem = callback(item);
		if (exports.getType(mappedItem) === "undefined") mappedItem = item;

		return ko.utils.unwrapObservable(mappedItem);
	}

	function getItemByKey(array, key, callback) {
		array = ko.utils.unwrapObservable(array);
		for (var i = 0, j = array.length; i < j; i++) {
			var item = array[i];
			if (mapKey(item, callback) === key) return item;
		}

		throw new Error("When calling ko.update*, the key '" + key + "' was not found!");
	}

	function filterArrayByKey(array, callback) {
		return ko.utils.arrayMap(ko.utils.unwrapObservable(array), function (item) {
			if (callback) {
				return mapKey(item, callback);
			} else {
				return item;
			}
		});
	}

	function visitPropertiesOrArrayEntries(rootObject, visitorCallback) {
		if (exports.getType(rootObject) === "array") {
			for (var i = 0; i < rootObject.length; i++)
			visitorCallback(i);
		} else {
			for (var propertyName in rootObject)
			visitorCallback(propertyName);
		}
	};

	function canHaveProperties(object) {
		var type = exports.getType(object);
		return ((type === "object") || (type === "array")) && (object !== null);
	}

	// Based on the parentName, this creates a fully classified name of a property

	function getPropertyName(parentName, parent, indexer) {
		var propertyName = parentName || "";
		if (exports.getType(parent) === "array") {
			if (parentName) {
				propertyName += "[" + indexer + "]";
			}
		} else {
			if (parentName) {
				propertyName += ".";
			}
			propertyName += indexer;
		}
		return propertyName;
	}

	exports.visitModel = function (rootObject, callback, options) {
		options = options || {};
		options.visitedObjects = options.visitedObjects || new objectLookup();

		var mappedRootObject;
		var unwrappedRootObject = ko.utils.unwrapObservable(rootObject);

		if (!canHaveProperties(unwrappedRootObject)) {
			return callback(rootObject, options.parentName);
		} else {
			options = fillOptions(options, unwrappedRootObject[mappingProperty]);

			// Only do a callback, but ignore the results
			callback(rootObject, options.parentName);
			mappedRootObject = exports.getType(unwrappedRootObject) === "array" ? [] : {};
		}

		options.visitedObjects.save(rootObject, mappedRootObject);

		var parentName = options.parentName;
		visitPropertiesOrArrayEntries(unwrappedRootObject, function (indexer) {
			if (options.ignore && ko.utils.arrayIndexOf(options.ignore, indexer) != -1) return;

			var propertyValue = unwrappedRootObject[indexer];
			options.parentName = getPropertyName(parentName, unwrappedRootObject, indexer);

			// If we don't want to explicitly copy the unmapped property...
			if (ko.utils.arrayIndexOf(options.copy, indexer) === -1) {
				// ...find out if it's a property we want to explicitly include
				if (ko.utils.arrayIndexOf(options.include, indexer) === -1) {
					// The mapped properties object contains all the properties that were part of the original object.
					// If a property does not exist, and it is not because it is part of an array (e.g. "myProp[3]"), then it should not be unmapped.
				    if (unwrappedRootObject[mappingProperty]
				        && unwrappedRootObject[mappingProperty].mappedProperties && !unwrappedRootObject[mappingProperty].mappedProperties[indexer]
				        && unwrappedRootObject[mappingProperty].copiedProperties && !unwrappedRootObject[mappingProperty].copiedProperties[indexer]
				        && !(exports.getType(unwrappedRootObject) === "array")) {
						return;
					}
				}
			}

			var outputProperty;
			switch (exports.getType(ko.utils.unwrapObservable(propertyValue))) {
			case "object":
			case "array":
			case "undefined":
				var previouslyMappedValue = options.visitedObjects.get(propertyValue);
				mappedRootObject[indexer] = (exports.getType(previouslyMappedValue) !== "undefined") ? previouslyMappedValue : exports.visitModel(propertyValue, callback, options);
				break;
			default:
				mappedRootObject[indexer] = callback(propertyValue, options.parentName);
			}
		});

		return mappedRootObject;
	}

	function simpleObjectLookup() {
		var keys = [];
		var values = [];
		this.save = function (key, value) {
			var existingIndex = ko.utils.arrayIndexOf(keys, key);
			if (existingIndex >= 0) values[existingIndex] = value;
			else {
				keys.push(key);
				values.push(value);
			}
		};
		this.get = function (key) {
			var existingIndex = ko.utils.arrayIndexOf(keys, key);
			var value = (existingIndex >= 0) ? values[existingIndex] : undefined;
			return value;
		};
	};
	
	function objectLookup() {
		var buckets = {};
		
		var findBucket = function(key) {
			var bucketKey;
			try {
				bucketKey = key;//JSON.stringify(key);
			}
			catch (e) {
				bucketKey = "$$$";
			}

			var bucket = buckets[bucketKey];
			if (bucket === undefined) {
				bucket = new simpleObjectLookup();
				buckets[bucketKey] = bucket;
			}
			return bucket;
		};
		
		this.save = function (key, value) {
			findBucket(key).save(key, value);
		};
		this.get = function (key) {
			return findBucket(key).get(key);
		};
	};
}));


define("scalejs.functional/functional",[],function(){function a(){var a=Array.prototype.slice.call(arguments,0).reverse();return function(){var b=a.reduce(function(a,b){return[b.apply(void 0,a)]},Array.prototype.slice.call(arguments));return b[0]}}function b(){var a=Array.prototype.slice.call(arguments,0);return function(){var b=a.reduce(function(a,b){return[b.apply(void 0,a)]},Array.prototype.slice.call(arguments,0));return b[0]}}function c(a,b){var c=Array.prototype.slice.call(arguments,2);return function(){return b.apply(a,c.concat(Array.prototype.slice.call(arguments,0)))}}function d(a,b){return function(){return a.apply(void 0,Array.prototype.slice.call(arguments,0,b))}}function e(){var a=Array.prototype.slice.call(arguments,0),b=a.reduce(function(a,b,c){return b===g?a.concat([c]):a},[]);return 0===b.length?a[0].apply(void 0,a.slice(1)):function(){var c;for(c=0;c<Math.min(b.length,arguments.length);c+=1)a[b[c]]=arguments[c];return e.apply(void 0,a)}}var f,g={};return f=function(a,b){if(1===arguments.length)return f(a,a.length);var c=Array.prototype.slice.call(arguments,2);return c.length>=b?a.apply(this,c):function(){var d=c.concat(Array.prototype.slice.call(arguments,0));return d.unshift(a,b),f.apply(this,d)}},{_:g,compose:a,sequence:b,bind:c,aritize:d,curry:f,partial:e}}),define("scalejs.functional/builder",[],function(){function a(a){var b,c,d,e;return d=function(a){if(!a||"$"!==a.kind)return a;if("function"==typeof a.expr)return a.expr.call(this);if("string"==typeof a.expr)return this[a.expr];throw new Error("Parameter in $(...) must be either a function or a string referencing a binding.")},e=function(a,e,f){function g(a){return"$return"===a||"$RETURN"===a||"$yield"===a||"$YIELD"===a}if("function"!=typeof c[a]&&"$then"!==a&&"$else"!==a)throw new Error("This control construct may only be used if the computation expression builder defines a `"+a+"` method.");var h,i=d(e);if(f.length>0&&"function"!=typeof c.combine)throw new Error("This control construct may only be used if the computation expression builder defines a `combine` method.");if(g(a)){if(0===f.length)return c[a](i);if("function"!=typeof c.delay)throw new Error("This control construct may only be used if the computation expression builder defines a `delay` method.");return c.combine(c[a](i),c.delay(function(){return b(f)}))}if("$for"===a)return c.combine(c.$for(e.items,function(a){var c=Array.prototype.slice.call(e.cexpr);return this[e.name]=a,b(c)}),b(f));if("$while"===a){if("function"!=typeof c.delay)throw new Error("This control construct may only be used if the computation expression builder defines a `delay` method.");return i=c.$while(e.condition.bind(this),c.delay(function(){var a=Array.prototype.slice.call(e.cexpr);return b(a)})),f.length>0?c.combine(i,b(f)):i}return"$then"===a||"$else"===a?(h=Array.prototype.slice.call(e.cexpr),c.combine(b(h),f)):c.combine(c[a](i),b(f))},a.missing||(a.missing=function(a){if(a.kind)throw new Error('Unknown operation "'+a.kind+'". Either define `missing` method on the builder or fix the spelling of the operation.');throw new Error("Expression "+JSON.stringify(a)+" cannot be processed. Either define `missing` method on the builder or convert expression to a function.")}),b=function(a){var f;if(a=Array.prototype.slice.call(a),0===a.length){if(c.zero)return c.zero();throw new Error("Computation expression builder must define `zero` method.")}if(f=a.shift(),"let"===f.kind)return this[f.name]=d(f.expr),b.call(this,a);if("do"===f.kind)return f.expr.call(this),b.call(this,a);if("letBind"===f.kind)return c.bind(f.expr.bind(this),function(c){return this[f.name]=c,b.call(this,a)}.bind(this));if("doBind"===f.kind||"$"===f.kind){if(a.length>0)return c.bind(f.expr.bind(this),function(){return b.call(this,a)}.bind(this));if("function"!=typeof c.$return)throw new Error("This control construct may only be used if the computation expression builder defines a `$return` method.");return c.bind(f.expr.bind(this),function(a){return c.$return(a)})}return"$return"===f.kind||"$RETURN"===f.kind||"$yield"===f.kind||"$YIELD"===f.kind?e(f.kind,f.expr,a):"$for"===f.kind||"$while"===f.kind?e(f.kind,f,a):"$if"===f.kind?f.condition.call(this)?e("$then",f.thenExpr,a):f.elseExpr?e("$else",f.elseExpr,a):e(b([]),a):"function"==typeof f&&c.call?(c.call(this),b.call(this,a)):"function"==typeof f?(f.call(this),b.call(this,a)):e("missing",f,a)},function(){function d(){var a={mixins:Array.prototype.slice.call(arguments,0)},b=f.bind(a);return b.mixin=function(){return Array.prototype.push.apply(a.mixins,arguments),b},b}var e=Array.prototype.slice.call(arguments),f=function(){var d,f,g,h=Array.prototype.slice.call(arguments,0);return c={},Object.keys(a).forEach(function(b){c[b]=a[b]}),this.mixins&&this.mixins.forEach(function(a){a.beforeBuild&&a.beforeBuild(h)}),g=function(){return b.call(this,h)},c.run||c.delay?(c.delay&&(f=g,g=function(){return c.delay(f)}),d=g(),c.run&&(d=c.run.apply(c,[d].concat(e)))):d=g(),this.mixins&&this.mixins.forEach(function(a){a.afterBuild&&(d=a.afterBuild(d))}),d};return f.mixin=d,f}}return a.$let=function(a,b){return{kind:"let",name:a,expr:b}},a.$LET=function(a,b){return{kind:"letBind",name:a,expr:b}},a.$do=function(a){return{kind:"do",expr:a}},a.$DO=function(a){return{kind:"doBind",expr:a}},a.$return=function(a){return{kind:"$return",expr:a}},a.$RETURN=function(a){return{kind:"$RETURN",expr:a}},a.$yield=function(a){return{kind:"$yield",expr:a}},a.$YIELD=function(a){return{kind:"$YIELD",expr:a}},a.$for=function(a,b){var c=Array.prototype.slice.call(arguments,2);return{kind:"$for",name:a,items:b,cexpr:c}},a.$while=function(a){if(arguments.length<2)throw new Error('Incomplete `while`. Expected "$while(<condition>, <expr>)".');var b=Array.prototype.slice.call(arguments,1);return{kind:"$while",condition:a,cexpr:b}},a.$if=function(a,b,c){if(arguments.length<2)throw new Error('Incomplete conditional. Expected "$if(<expr>, $then(expr))" or "$if(<expr>, $then(<expr>), $else(<expr>)"');if("function"!=typeof a)throw new Error("First argument must be a function that defines the condition of $if.");if("$then"!==b.kind)throw new Error('Unexpected "'+b.kind+'" in the place of "$then"');if(c&&"$else"!==c.kind)throw new Error('Unexpected "'+c.kind+'" in the place of "$else"');return{kind:"$if",condition:a,thenExpr:b,elseExpr:c}},a.$then=function(){var a=Array.prototype.slice.call(arguments,0);if(0===a.length)throw new Error("$then should contain at least one expression.");return{kind:"$then",cexpr:a}},a.$else=function(){var a=Array.prototype.slice.call(arguments,0);if(0===a.length)throw new Error("$else should contain at least one expression.");return{kind:"$else",cexpr:a}},a.$=function(a){return{kind:"$",expr:a}},a}),define("scalejs.functional/continuationBuilder",["./builder"],function(a){var b,c;return b=a({bind:function(a,b){return function(c,d){a(function(a){var e=b(a);return e(c,d)},d)}},$return:function(a){return function(b){b&&("function"==typeof a&&(a=a()),b(a))}},delay:function(a){return a},run:function(a){return function(b,c){var d=a.call(this);d.call(this,b,c)}}}),c=b().mixin({beforeBuild:function(b){b.forEach(function(c,d){"function"==typeof c&&(b[d]=a.$DO(c))})}})}),define("scalejs.functional",["scalejs!core","./scalejs.functional/functional","./scalejs.functional/builder","./scalejs.functional/continuationBuilder"],function(a,b,c,d){var e=a.object.merge;a.registerExtension({functional:e(b,{builder:c,builders:{continuation:d}})})});
!function(a){"function"==typeof define&&define.amd?define("scalejs.mvvm/classBindingProvider",["knockout","exports"],a):a(ko)}(function(a,b){var c=function(a,b){var c,d;if(!a)return a;c={};for(d in a)a.hasOwnProperty(d)&&(c[d]=b(a[d],d,a));return c},d=function(a){return function(){return a}};a.version>="3.0.0"&&!function(){var b=document.createElement("div");a.applyBindings(null,b);var c=a.contextFor(b),d=!a.storedBindingContextForNode,e=d?"A":"_subscribable",f=d?"wb":"_addNode",g=function(){};g[f]=g,c.constructor.prototype[e]=g,a.cleanNode(b)}();var e=function(b,e){var f=new a.bindingProvider;e=e||{},this.attribute=e.attribute||"data-class",this.virtualAttribute="ko "+(e.virtualAttribute||"class")+":",this.fallback=e.fallback,this.bindings=b||{},this.bindingRouter=e.bindingRouter||function(a,b){var c,d,e,f;if(b[a])return b[a];for(e=a.split("."),f=b,c=0,d=e.length;d>c;c++)f=f[e[c]];return f},this.registerBindings=function(b){a.utils.extend(this.bindings,b)},this.nodeHasBindings=function(a){var b,c;return 1===a.nodeType?b=a.getAttribute(this.attribute):8===a.nodeType&&(c=""+a.nodeValue||a.text,b=c.indexOf(this.virtualAttribute)>-1),!b&&this.fallback&&(b=f.nodeHasBindings(a)),b},this.getBindingsFunction=function(b){return function(g,h){var i,j,k,l,m,n,o={},p="";if(1===g.nodeType?p=g.getAttribute(this.attribute):8===g.nodeType&&(m=""+g.nodeValue||g.text,n=m.indexOf(this.virtualAttribute),n>-1&&(p=m.substring(n+this.virtualAttribute.length))),p)for(p=p.replace(/^(\s|\u00A0)+|(\s|\u00A0)+$/g,"").replace(/(\s|\u00A0){2,}/g," ").split(" "),i=0,j=p.length;j>i;i++)k=this.bindingRouter(p[i],this.bindings),k?(l="function"==typeof k?k.call(h.$data,h,p):k,b&&(l=c(l,d)),a.utils.extend(o,l)):e.log&&e.log('No binding function provided for data class "'+p[i]+'" in element ',g,"\nMake sure data class is spelled correctly and that it's binding function is registered.");else this.fallback&&(o=f[b?"getBindingAccessors":"getBindings"](g,h));if(e.log)for(bindingName in o)o.hasOwnProperty(bindingName)&&"_ko_property_writers"!==bindingName&&"valueUpdate"!==bindingName&&"optionsText"!==bindingName&&!a.bindingHandlers[bindingName]&&(l?e.log('Unknown binding handler "'+bindingName+'" found in element',g,' defined in data-class "'+p+'" as',l,"\nMake sure that binding handler's name is spelled correctly and that it's properly registered. \nThe binding will be ignored."):e.log('Unknown binding handler "'+bindingName+'" in',g,"\nMake sure that it's name spelled correctly and that it's properly registered. \nThe binding will be ignored."));return o}},this.getBindings=this.getBindingsFunction(!1),this.getBindingAccessors=this.getBindingsFunction(!0)};return b||(a.classBindingProvider=e),e}),define("scalejs.mvvm/htmlTemplateSource",["knockout","scalejs!core"],function(a,b){function c(a){var b=document.createElement("div");"undefined"!=typeof WinJS?WinJS.Utilities.setInnerHTMLUnsafe(b,a):b.innerHTML=a,e(b.childNodes).forEach(function(a){1===a.nodeType&&f(a,"id")&&(h[a.id]=a.innerHTML)})}function d(a){function b(b,c){return f(h.data,a)||(h.data[a]={}),1===arguments.length?h.data[a][b]:void(h.data[a][b]=c)}function c(b){if(0===arguments.length)return h[a];throw new Error('An attempt to override template "'+a+'" with content "'+b+'" Template overriding is not supported.')}return{data:b,text:c}}var e=b.array.toArray,f=b.object.has,g=new a.nativeTemplateEngine,h={data:{}};return g.makeTemplateSource=d,a.setTemplateEngine(g),{registerTemplates:c}}),define("scalejs.mvvm/selectableArray",["knockout","scalejs!core"],function(a,b){var c=a.isObservable,d=a.utils.unwrapObservable,e=a.observable,f=a.computed,g=b.object.has,h=b.array;return function(a,b){function i(a){if(!c(a.isSelected)||g(b.isSelectedPath)&&"isSelected"!==b.isSelectedPath){if(c(a.isSelected))throw new Error('item has observable `isSelected` property but `isSelectedPath` specified as "'+b.isSelectedPath+"\". `selectable` uses `isSelected` property of an item to determine whether it's selected. Either don't specify `isSelectedPath` or rename `isSelected` property to something else.");if(a.hasOwnProperty("isSelected"))throw new Error("item has non-observable `isSelected` property. `selectable` uses `isSelected` property of an item to determine whether it's selected. Either make `isSelected` observable or rename it.");if(a.isSelected=e(),g(b.isSelectedPath)&&"isSelected"!==b.isSelectedPath&&!c(a[b.isSelectedPath]))throw new Error("item's property \""+b.isSelectedPath+"\" specified by `isSelectedPath`  isn't observable. Either make it observable or specify different property in  `isSelectedPath`");g(b.isSelectedPath)&&(a.isSelected=a[b.isSelectedPath]),a.isSelected.subscribe(function(b){b?k(a):k()===a&&k(void 0)})}}b=b||{};var j,k=b.selectedItem||e(),l=b.selectionPolicy||"single";return c(a)?j=f(function(){var b=d(a);return b.forEach(i),h.copy(b)}):(a.forEach(i),j=h.copy(a)),k.subscribe(function(a){d(j).forEach(function(b){b.isSelected(b===a)}),"deselect"===l&&a&&setTimeout(function(){k(void 0)},0)}),j.selectedItem=k,j}}),define("scalejs.mvvm/ko.utils",["scalejs!core","knockout"],function(a,b){function c(c,d){return a.array.toArray(c).map(function(a){var c=a.cloneNode(!0);return d?b.cleanNode(c):c})}return{cloneNodes:c}}),define("scalejs.mvvm/mvvm",["knockout","knockout.mapping","scalejs!core","scalejs.mvvm/classBindingProvider","./htmlTemplateSource","./selectableArray","./ko.utils"],function(a,b,c,d,e,f,g){function h(b){return a.observable(b)}function i(b){return a.observableArray(b)}function j(b){return a.computed(b)}function k(a){return b.toJSON(a)}function l(a){return JSON.parse(k(a))}function m(){v(arguments).forEach(w.registerBindings.bind(w))}function n(a,c,d){var e=Object.keys(d).reduce(function(a,b){return u(a,{k:b,create:function(a){return d[b](a.data)}})},{});return b.fromJS(a,e,c)}function o(){v(arguments).forEach(e.registerTemplates)}function p(a,b){var c={};return c[a]=b,c}function q(a,b){return p("template",{name:a,data:b})}function r(a,b){return{dataClass:a,viewmodel:b}}function s(a){return document.getElementsByTagName(a)[0]}function t(){var b,c=document.createComment(" ko class: scalejs-shell "),d=document.createComment(" /ko ");b=document.getElementsByTagName("script"),b=b[b.length-1].parentElement,b||Array.prototype.slice.call(document.getElementsByTagName("script")).forEach(function(a){"app/app"===a.getAttribute("data-main")&&(b=a.parent)}),(b===s("html")||b===s("head"))&&(b=s("body")),b&&(b.appendChild(c),b.appendChild(d),m({"scalejs-shell":function(a){return{render:a.$data.root}}}),a.applyBindings({root:x},b))}var u=c.object.merge,v=c.array.toArray,w=new d({},{log:c.log.warn,fallback:!0}),x=a.observable();return a.bindingProvider.instance=w,{core:{mvvm:{toJson:k,registerBindings:m,registerTemplates:o,dataClass:r,template:q,dataBinding:p,selectableArray:f,ko:{utils:g}}},sandbox:{mvvm:{observable:h,observableArray:i,computed:j,registerBindings:m,registerTemplates:o,toJson:k,toViewModel:n,toObject:l,dataClass:r,template:q,dataBinding:p,selectableArray:f,root:x}},init:t}}),define("scalejs.bindings/change",["knockout","scalejs!core"],function(a,b){function c(b,c,f,g){function h(a,c){return function(d){d!==c&&(c=d,a.call(g,d,b))}}function i(c,d){a.computed({read:function(){var a=m(g[c]);d(a)},disposeWhenNodeIsRemoved:b})}if(e(g)){var j,k,l,m=a.utils.unwrapObservable,n=c(),o=m(n);for(j in o)o.hasOwnProperty(j)&&(k=o[j],d(k.initial,"function")&&k.initial.apply(g,[m(g[j]),b]),d(k.update,"function")&&(l=h(k.update,m(g[j]))),d(k,"function")&&(l=h(k,m(g[j]))),l&&i(j,l))}}var d=b.type.is,e=b.object.has;return{init:c}}),define("scalejs.bindings/render",["scalejs!core","knockout","scalejs.functional"],function(a,b){function c(){return{controlsDescendantBindings:!0}}function d(a,c,d,j,k){function l(c){n?b.applyBindingsToNode(a,n,j):b.virtualElements.emptyNode(a),window.requestAnimationFrame(c)}var m,n,o,p,q,r=g(c()),s=[],t=[];if(o=b.utils.domData.get(a,"binding"),r)if(e(r.dataClass,"string")){if(m=b.bindingProvider.instance.bindingRouter(r.dataClass,b.bindingProvider.instance.bindings),!m)throw new Error("Don't know how to render binding \""+r.dataClass+'" - no such binding registered. Either register the bindng or correct its name.');m&&(n=e(m,"function")?m.call(r.viewmodel||j,k):m)}else n=e(r,"function")?r.call(j,k):r;f(o,"transitions","outTransitions")&&(t=o.transitions.outTransitions.map(function(a){return i(a)})),f(n,"transitions","inTransitions")&&(s=n.transitions.inTransitions.map(function(a){return i(a)})),q=h.apply(null,t.concat(i(l)).concat(s)),p={getElement:function(){return a}},q.call(p),b.utils.domData.set(a,"binding",n)}var e=a.type.is,f=a.object.has,g=b.utils.unwrapObservable,h=a.functional.builders.continuation,i=a.functional.builder.$DO;return{init:c,update:d}}),define("scalejs.mvvm",["scalejs!core","knockout","scalejs.mvvm/mvvm","./scalejs.bindings/change","./scalejs.bindings/render"],function(a,b,c,d,e){b.bindingHandlers.change=d,b.bindingHandlers.render=e,b.virtualElements.allowedBindings.change=!0,b.virtualElements.allowedBindings.render=!0,c.init(),a.registerExtension(c)}),define("scalejs.mvvm.bindings",[],function(){return{load:function(a,b,c,d){var e=a.match(/([^,]+)/g)||[];e=e.map(function(a){return a.indexOf(".js",a.length-3)>-1?a:(-1===a.indexOf("Bindings",a.length-"Bindings".length)&&(a+="Bindings"),-1===a.indexOf("/")?"./bindings/"+a:a)}),e.push("scalejs.mvvm","scalejs!core"),b(e,function(){var a=arguments[arguments.length-1],b=Array.prototype.slice.call(arguments,0,arguments.length-2);d.isBuild||a.mvvm.registerBindings.apply(null,b),c(b)})}}}),define("scalejs.mvvm.views",[],function(){return{load:function(a,b,c,d){var e=a.match(/([^,]+)/g)||[];e=e.map(function(a){return-1===a.indexOf(".html",a.length-5)&&(a+=".html"),-1===a.indexOf("/")&&(a="./views/"+a),"text!"+a}),e.push("scalejs.mvvm","scalejs!core"),b(e,function(){var a=arguments[arguments.length-1],b=Array.prototype.slice.call(arguments,0,arguments.length-2);d.isBuild||a.mvvm.registerTemplates.apply(null,b),c(b)})}}});
define("scalejs.mvvm", ["knockout.mapping","scalejs.functional"], function(){});

/*global define*/
/*jsling sloppy: true*/

define('backend',[
    'scalejs!core',
    //'underscore'
], function (
    core
) {

    

    var service = 'http://108.30.58.154:8465/Service/FunctionService.svc';

    if (window.service) {
        service = window.service;
    }

    var service_url = service + '/json/InvokeNamedFunction';

    /**
     * process data into usable js object and run callback
     * @param {Object} Object       Object with data to be processed
     * @param {Function} callback   callback function
     */
    function process ( data, callback ) {

        try {
            data = JSON.parse(data);
        } catch (e) {
            return callback(e);
        }

        if (data.InvokeNamedFunctionResult.hasOwnProperty('Error') &&
            data.InvokeNamedFunctionResult.Error !== null)
        {
            return callback(data.InvokeNamedFunctionResult.Error);
        }

        if (!data.InvokeNamedFunctionResult.TableResult)
        {
            return callback(null, [ ]);
        }

        callback(null, data.InvokeNamedFunctionResult.TableResult.map(function ( result ) {
            // assert result instanceof Array
            var results = [ ],
                obj, data,
                column, value,
                i, j;

            for (i in result.DataRows) {
                obj = { }; // reset storage object
                data = result.DataRows[i].split(result.FieldEnd);

                for (j in result.Columns) {
                    column = result.Columns[j];
                    value = data[j];

                    // cast values to proper types
                    switch(column.ColumnType) {
                        case 1: // Date
                            value = new Date(value);
                            break;
                        case 2: // Number
                            value = parseFloat(value, 10);
                            break;
                        case 3: // Table
                        case 4: // WholeNumber
                            value = parseInt(value, 10);
                    }
                    obj[column.ColumnName] = value;
                }
                results.push(obj);
            }
            return results;
        }));
    }//;

    /**
     * Open connection to backend and post
     * @param {Object} Object       Object with data to be posted
     * @param {Function} callback   callback function
     */
    function ajax ( object, callback ) {
        var r = new XMLHttpRequest();

        r.onreadystatechange = function () {
            if (r.readyState != 4) {
                return;
            }
            if (r.status != 200) {
                return callback('request failed with status ' + r.status);
            }
            process(r.responseText, callback);
        };

        var abort = r.abort.bind(r);
        r.abort = function () {
            callback(null, [ ]);
            abort();
        };
        r.open('POST', service_url, true);
        r.setRequestHeader('Content-Type', 'application/json');
        r.send(JSON.stringify(object));
        return r;
    }//;


    /**
     * Post request to backend interface
     * @param {Object} options          database connection options
     * @param {String} options.group    name of group to access
     * @param {String} options.menu     name of menu to access
     * @param {Array}  [options.params] extra parameters to send
     * @param {Function} callback       function to callback with data
     * @param {Object}  callback.err    error object from callback
     * @param {Object}  callback.data   data object from callback
     */
    function query ( options, callback ) {
        callback = _.once(callback); // TODO: find a way to set timeout
        return ajax({
            serviceName: 'Example',
            functionCall: {
                'Function': {
                    GroupName: options.group,
                    MenuName: options.menu,
                },
                Parameters: options.params || [ ]
            }
        }, callback);
    }//;

    // register function to backend
    core.registerExtension({
        query: query
    });

});


define('flag',[
    'scalejs!core'
], function (
    core
) {

    

    var
    /**
     * holds registered invokable functions
     * @memberOf flag
     * @private
     */
    m_registry = { },

    /**
     * holds number of times a registered key has been used
     * @memberOf flag
     * @private
     */
    m_counts = { },

    /**
     * holds functions waiting to be invoked
     * @memberOf flag
     * @private
     */
    m_waiting = { };

    /**
     * invokes the functions for the given key
     * @memberOf flag
     * @private
     * @param {String}   key    reference for invocation
     * @param {Array}    [args] arguments to pass the invocation
     * @param {Function} [done] called when complete
     * @return {Boolean} if there was a registration
     */
    function _invoke ( key, args, done ) {
        var funcs = m_registry[key], func;
        if (!funcs) { return false; }

        console.debug('flag: invoking key ' + key);

        m_counts[key]++;
        for (func in funcs) {
            funcs[func].apply(null, args || [ ]);
        }
        if (typeof done === 'function') {
            done();
        }
        return true;
    }

    core.registerExtension({
        flag: {
            /**
             * registers a function to be invoked
             * @memberOf flag
             * @param {String} key reference for invocation
             * @param {Function} func invoked later by key
             */
            register: function (key, func) {

                if (!func instanceof Function) {
                    return console.error('registered item must be a function');
                }
                key = String(key);

                console.debug('flag: registering key ' + key);

                if (m_registry[key]) {
                    m_registry[key].push(func);

                } else {
                    m_registry[key] = [func];
                    m_counts[key] = 0;
                    if (m_waiting[key]) {
                        var opts = m_waiting[key];
                        for (var opt in opts) {
                            _invoke(key, opts[opt].args, opts[opt].done);
                        }
                    }
                }
            },

            /**
             * invokes a registered function
             * @memberOf flag
             * @param {String} key    reference for invocation
             * @param {Array}  [args] arguments to invoke with
             * @return {Boolean} if the reference was invoked
             */
            invoke: function (key, args) {
                return _invoke(key, args);
            },

            /**
             * times reference was invoked
             * @memberOf flag
             * @param {String} key reference for invocation
             * @return {Number} count associated to key
             */
            count: function (key) {
                key = String(key);
                return m_counts[key];
            },

            /**
             * waits for a registration before calling callback
             * @memberOf flag
             * @param {String}   key    registration to wait for
             * @param {Object}   [args] arguments to invoke with
             * @param {Function} [done] called when invoked
             */
            wait: function (key, args, done) {
                key = String(key);

                console.debug('flag: waiting on key ' + key);

                if (m_registry[key]) {
                    _invoke(key, args, done);
                }

                if (!m_waiting[key]) {
                    m_waiting[key] = [ ];
                }
                m_waiting[key].push({args: args, done: done});
            }//;
        }//;
    });
});


/**
 * @license RequireJS text 2.0.14 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.14',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.lastIndexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config && config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config && config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'] &&
            !process.versions['atom-shell'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file[0] === '\uFEFF') {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                if (errback) {
                    errback(e);
                }
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status || 0;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        if (errback) {
                            errback(err);
                        }
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes;
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});


define('text!extensions/table/view.html',[],function () { return '<script id="listjs_modal_template">\n    <div data-class="listjs_table_modal_close_underlay" class="listjs-modal-underlay"></div>\n    <div class="listjs-modal" data-class="listjs_table_modal">\n        <header>\n            <span data-class="listjs_table_modal_title"></span>\n            <i class="fa fa-close" data-class="listjs_table_modal_close"></i>\n        </header>\n        <nav class="tabs">\n            <!-- ko foreach: pages -->\n                <div data-class="listjs_table_modal_filter_type_tab"></div>\n            <!-- /ko -->\n        </nav>\n        <section data-bind="css: { hidden: selectedTab() !== \'Filter by value\'}">\n                <!-- ko if: distinct.length >= 15 -->\n                <div class="tabs">\n                    <!-- ko foreach: categories -->\n                    <div data-class="listjs_table_modal_category_link"></div>\n                    <!-- /ko -->\n                </div>\n                <!-- /ko -->\n                <div data-class="listjs_table_modal_values" class="values">\n                    <ul data-class="listjs_table_modal_distinct_foreach_onload">\n                        <!-- ko class: listjs_table_modal_distinct_foreach_inner -->\n                            <li data-class="listjs_table_modal_distinct"></li>\n                        <!-- /ko -->\n                    </ul>\n                </div>\n        </section>\n        <section class="relational" data-bind="css: { hidden: selectedTab() !== \'Advanced filters\'}">\n            <div data-class="listjs_table_modal_relational_filters">\n                <div>\n                    <div data-bind="text: tag + \':\'"></div>\n                    <input onClick="this.setSelectionRange(0, this.value.length)" type="text" data-class="listjs_table_modal_filter_input"></input>\n                    <input type="checkbox" data-bind="checked: enabled"></input>\n                </div>\n            </div>\n        </section>\n        <footer class="listjs-modal-buttons" data-bind="css: { hidden: selectedTab() !== \'Filter by value\'}">\n            <div class="clear_filter" data-class="listjs_table_modal_clear_filter">Clear Filter</div>\n            <div class="select_all" data-class="listjs_table_modal_select_all">Select All</div>\n            <div class="listjs-modal-ascending" data-class="listjs_table_modal_ascending"></div>\n            <div class="listjs-modal-descending" data-class="listjs_table_modal_descending"></div>\n        </footer>\n    </div>\n</script>\n\n<div data-class="listjs_table" class="listjs">\n    <!-- ko if: title -->\n    <div class="listjs-title" data-class="listjs_table_title">\n    </div>\n    <!-- /ko -->\n    <div class="listjs-header">\n        <ul>\n            <li>\n            <!-- ko foreach: columns -->\n            <div data-class="listjs_table_header">\n            </div>\n            <!-- /ko -->\n            </li>\n        </ul>\n    </div>\n\n    <!-- ko template: \'listjs_modal_template\' -->\n    <!-- /ko -->\n\n    <div class="listjs-loading" data-class="listjs_table_loading"></div>\n    <div class="listjs-table">\n        <div class="listjs-list">\n            <ul class=\'list\'>\n            </ul>\n            <ul class="pagination">\n            </ul>\n        </div>\n    </div>\n\n    <!-- ko if: total -->\n    <div class="listjs-footer">\n        <ul>\n            <li>\n                <!-- ko foreach: columns -->\n                    <div data-class="listjs_table_total_value"></div>\n                <!-- /ko -->\n            </li>\n        </ul>\n    </div>\n    <!-- /ko -->\n<div>\n';});



define('extensions/table/bindings.js',[],function () {
    function is_member_currently_selected_category (data, selectedCategory) {
        function compareTo(a, b) {
            if(!(typeof a === 'number') && (a.match(/.*Bn/g) || a.match(/.*%/g))) {
                if (a.match(/\(.*?\).*/g)) {
                    a = parseFloat('-' + a.substring(1))
                } else {
                    a = parseFloat(a);
                }
            }
            if(!(typeof b === 'number') && (b.match(/.*Bn/g) || b.match(/.*%/g))) {
                if (b.match(/\(.*?\).*/g)) {
                    b = parseFloat('-' + b.substring(1))
                } else {
                    b = parseFloat(b);
                }
            }

            //uppercase letters are less than lowercase
            if(typeof a === 'string') {
                a = a.toLowerCase();
            }
            if(typeof b === 'string') {
                b = b.toLowerCase();
            }


            return a >= b;
        }

        return  selectedCategory() == null ||
                compareTo(data.tag ,selectedCategory().min) &&
                compareTo(selectedCategory().max, data.tag)
            //(ctx.$index() >= distinct.indexOf(ctx.$parent.selectedCategory().min) &&
            //ctx.$index() <= distinct.indexOf(ctx.$parent.selectedCategory().max));
    }

    return {
        listjs_table: function ( ctx ) {
            return {
                css: {
                    modal: !!this.modal()
                }
            };
        },
        listjs_table_loading: function ( ctx ) {
            return {
                visible: this.loading(),
                css: {
                    tableloading: this.loading()
                }
            };
        },
        listjs_table_header: function ( ctx ) {
            var css = {
                // set filtered if at least one selected item matches id
                filtered: _.some(ctx.$parent.selected(), function ( item ) {
                        // return this.id_tag !== undefined ? this.id_tag === item.column
                        //     : this.id === item.column;
                        return this.id === item.column || this.id_tag === item.column;
                }.bind(this))
            };
            // add static id and direction classes
            css[this.id] = css[this.dir()] = true;
            return {
                css: css,
                html: this.name,
                hmTap: function () {
                    if (ctx.$parent.rows().length <= 10)
                    {
                        return;
                    }

                    // show modal for this column unless already shown
                    var currentId = null;
                    if (ctx.$parent.modal() != null) {
                        currentId = ctx.$parent.modal().id;
                    }
                    if(!(currentId === this.id)) {
                        ctx.$parent.loading(true);
                    }

                    //this is used to defer rendering of the huge list in the modal.
                    //this way the loading animation can begin before this starts
                    //hogging the CPU. (ctx.$parent.loading(true) above)
                    //TODO: figure out why this is necessary (shouldn't the loading
                    //animation start first anyway?) and why a timeout of 0 isn't
                    //sufficient
                    setTimeout(function () {
                        ctx.$parent.modal(currentId === this.id ?
                            null : this);
                    }.bind(this), 30);
                }.bind(this)
            };
        },
        listjs_table_modal: function ( ctx ) {
            var id = null;
            var title = null;
            var id_tag;
            var distinct;

            if(this.modal() != null) {
                id = this.modal().id;
                id_tag = this.modal().id_tag;
                if(id_tag === undefined)
                    id_tag = id;
                title = this.modal().name;
            }

            distinct = this.distinct()[id] || [ ];

            distinct.forEach(function ( item ) {
                item.disabled = !in_currently_filtered_rows(item, id_tag);
            });
            return {
                with: _.extend({
                    id: id,
                    id_tag: id_tag,
                    title: title,
                    selectedCategory: ko.observable(null),//this.selectedCategory,
                    pages: ['Filter by value', 'Advanced filters'],
                    selectedTab: ko.observable('Filter by value'),
                    distinct: distinct,
                    categories: this.categories()[id] || [ ]
                }, this.modal())
            };

            function in_currently_filtered_rows ( filter, tag ) {
                var currently_visible_rows, column, i;
                //check if is filtered
                if(ctx.$data.primaryColumnFilter !== null && ctx.$data.list.filtered && ctx.$data.primaryColumnFilter !== tag) {
                    currently_visible_rows = _.pluck(ctx.$data.list.matchingItems, '_values');
                    for(i = 0; i < currently_visible_rows.length; i++) {
                        if(currently_visible_rows[i][filter.tag_column] === filter.tag)
                            return true;
                    }
                    return false;
                }
                return true;
            }

        },
        listjs_table_modal_title: function ( ctx ) {
            return {
                text: this.title
            };
        },
        listjs_table_modal_close_underlay: function ( ctx ) {
            return {
                hmTap: function () {
                    this.modal(null);
                }
            };
        },
        listjs_table_modal_close: function ( ctx ) {
            return {
                hmTap: function () {
                    ctx.$parent.modal(null);
                }
            };
        },
        listjs_table_modal_filter_type_tab: function ( ctx ) {
            return {
                text: this,
                hmTap: function () {
                    ctx.$parent.selectedTab(ctx.$data);
                }
            };
        },
        listjs_table_modal_category_link: function ( ctx ) {
            var text = format(this).split('-').map(function ( item ) {
                return '<div>' + item.replace('$$$', '-') + '</div>';
            }).join('<div>&nbsp;-&nbsp;</div>');

            var categoryDescription = {min: this.min, max: this.max};
            return {
                css: {//TODO: implement more complex logic to determine if selected
                    selected: _.isEqual(ctx.$parent.selectedCategory(), categoryDescription)
                },
                /*attr: {
                    href: '#' + this.id
                },*/
                hmTap: function () {
                    var prevCat = ctx.$parent.selectedCategory();
                    if(_.isEqual(prevCat, categoryDescription)) {
                        ctx.$parent.selectedCategory(null);
                    } else {
                        ctx.$parent.selectedCategory(categoryDescription);
                    }
                    return true;    //return true so href link works
                }.bind(this),
                html: text
            }

            function formatText ( s ) {
                if(s.length === 0) {
                    return "<no value>";
                } else {
                    return s.replace('-', '$$$'); //global.window.toolkit.filter.truncate( s );
                }
            }

            function format ( filter ) {
                //var nonAlpha = ((min === "") || min.search(/[^A-Za-z\s]/) != -1) &&
                //                ((max === "") || max.search(/[^A-Za-z\s]/) != -1);
                //if ( nonAlpha ) {
                var min, max;
                var numDetect = [" Bn", " Mn", " Th"];
                min = filter.min;
                max = filter.max;

                if (filter.hasOwnProperty('tag'))
                    return filter.tag;
                else if (typeof min === "number") {
                    return min + '-' + max;
                }
                else if(min !== '' && _.some(numDetect, function ( item ) {
                    return min.indexOf(item) > -1;
                })) {
                    return min === max ? min : min + '-' + max
                } else {
                    var minText = formatText(min);
                    var maxText = formatText(max);
                    if(minText === maxText)
                        return minText;
                    else
                        return [minText, maxText].join('-');
                }
                //} else if (min.substring(0, 1) == max.substring(0, 1)) {
                    //if first letters are the same only display first letter
                    //(i.e. Car - Cat only display C)
                //    return min.substring(0, 1)
                //} else {
                    //display only first letters
                    //(i.e. Car - Dog displays C-D)
                //    return [min.substring(0, 1), max.substring(0, 1)].join(" - ")
                //}
            }
        },
        listjs_table_modal_values: function ( ctx ) {
            if (this.distinct.length < 15)
                return {
                    style: {
                        width: '100%'
                    }
                };
        },
        //TODO: figure out a better way to detect when a long list is rendered
        //this foreach is used to detect when the long list of distinct values
        //is done rendering (listjs_table_modal_distinct_foreach_inner)
        listjs_table_modal_distinct_foreach_onload: function ( ctx ) {
            return {
                foreach: {
                    data: [this.distinct],
                    afterRender: function (elements, data) {
                        ctx.$parent.loading(false);
                    }
                }
            };
        },
        listjs_table_modal_distinct_foreach_inner: function ( ctx ) {
            return {
                foreach: {
                    data: this
                }
            };
        },
        listjs_table_modal_distinct: function ( ctx ) {
            var distinct = _.pluck(ctx.$parent, "tag");
            var ret = {
                text: this.tag,
                visible: is_member_currently_selected_category(ctx.$data, ctx.$parentContext.$parent.selectedCategory),
                css: {
                    selected: this.selected(),
                    disabled: this.disabled
                },
                hmTap: click_handler
            };

            // find if item needs id for category scroll feature
            var index = _.pluck(ctx.$parentContext.$parent.categories, 'min').indexOf(this.id_tag);
            if (index > -1) {
                ret.attr = { id: ctx.$parentContext.$parent.categories[index].id };
            }

            return ret;

            function click_handler ( ) {
                var selected, filter_item, filter_func;

                selected = !ctx.$data.selected();
                ctx.$data.selected(selected);

                // item to be passed into
                filter_item = {
                    column: ctx.$data.tag_column,
                    value: ctx.$data.tag
                };

                filter_func = {
                    name: 'equality',
                    column: ctx.$data.tag_column,
                    value: ctx.$data.tag,
                    filter: function (row) {
                        return row[ctx.$data.tag_column] === ctx.$data.tag;
                    }
                }

                if (selected) {
                    // ctx.$parents[2].selected.push(filter_item);
                    ctx.$parents[2].selected.push(filter_func);
                } else {
                    ctx.$parents[2].selected.remove(function ( item ) {
                        return item.name === filter_func.name &&
                               item.column === filter_func.column &&
                               item.value === filter_func.value;
                    });
                }
            };
        },
        listjs_table_modal_relational_filters: function ( ctx ) {
            return {
                foreach: _.values(this.filters)
            };
        },
        listjs_table_modal_filter_input: function ( ctx ) {
            return {
                textInput: this.value,
                attr: {
                    pattern: this.type === 'number' ? '-?(?:\\d{1,3},?)*' : ''
                }
            };
        },
        listjs_table_modal_ascending: function ( ctx ) {
            return {
                text: "Ascending",
                click: function () {
                    ctx.$parent.list.sort(this.id, {
                        order: 'asc'
                    });
                    _.find(ctx.$parent.columns(), function ( item ) {
                        return item.id === this.id;
                    }.bind(this)).dir('ascending');
                }.bind(this)
            };
        },
        listjs_table_modal_descending: function ( ctx ) {
            return {
                text: "Descending",
                click: function () {
                    ctx.$parent.list.sort(this.id, {
                        order: 'desc'
                    });
                    _.find(ctx.$parent.columns(), function ( item ) {
                        return item.id === this.id;
                    }.bind(this)).dir('descending');
                }.bind(this)
            };
        },
        listjs_table_modal_clear_filter: function ( ctx ) {
            return {
                hmTap: function () {
                    this.distinct.forEach(function (filter) {
                        filter.selected(false);
                    });
                    ctx.$parent.selected.remove(function ( item ) {
                        return item.column === this.id_tag;
                    }.bind(this));
                }.bind(this)
            };
        },
        listjs_table_modal_select_all: function ( ctx ) {
            return {
                hmTap: function () {
                    this.distinct.forEach(function (filter) {
                        if(is_member_currently_selected_category(filter, ctx.$data.selectedCategory)) {
                            var filter_item = {
                                column: filter.tag_column,
                                value: filter.tag
                            },
                            filter_func = {
                                column: filter.tag_column,
                                filter: function (row) {
                                    return row[filter.tag_column] === filter.tag;
                                }
                            };
                            filter.selected(true);
                            ctx.$parent.selected.push(filter_func);
                        }
                    });

                }.bind(this)
            };
        },
        listjs_table_total_value: function ( ctx ) {
            var display_text;

            if(this.hasOwnProperty('total') && this.total) {
                if(this.hasOwnProperty('total_tag')) {
                    display_text = this.total_tag;
                } else {
                    display_text = _.reduce(ctx.$parents[0].matchingItems(),
                        function ( memo, item ) {
                            return memo + parseInt(item[this.id]);
                        }.bind(this), 0);
                    if(this.hasOwnProperty('bn') && this.bn) {
                        display_text = global.toolkit.filter.bn(display_text);
                    }
                }
            }

            return {
                css: this.id,
                text: display_text
            };
        },
        listjs_table_title: function ( ctx ) {
            return {
                html: this.title
            };
        }//;
    };
});

!function(){function a(b,c,d){var e=a.resolve(b);if(null==e){d=d||b,c=c||"root";var f=new Error('Failed to require "'+d+'" from "'+c+'"');throw f.path=d,f.parent=c,f.require=!0,f}var g=a.modules[e];if(!g._resolving&&!g.exports){var h={};h.exports={},h.client=h.component=!0,g._resolving=!0,g.call(this,h.exports,a.relative(e),h),delete g._resolving,g.exports=h.exports}return g.exports}a.modules={},a.aliases={},a.resolve=function(b){"/"===b.charAt(0)&&(b=b.slice(1));for(var c=[b,b+".js",b+".json",b+"/index.js",b+"/index.json"],d=0;d<c.length;d++){var b=c[d];if(a.modules.hasOwnProperty(b))return b;if(a.aliases.hasOwnProperty(b))return a.aliases[b]}},a.normalize=function(a,b){var c=[];if("."!=b.charAt(0))return b;a=a.split("/"),b=b.split("/");for(var d=0;d<b.length;++d)".."==b[d]?a.pop():"."!=b[d]&&""!=b[d]&&c.push(b[d]);return a.concat(c).join("/")},a.register=function(b,c){a.modules[b]=c},a.alias=function(b,c){if(!a.modules.hasOwnProperty(b))throw new Error('Failed to alias "'+b+'", it does not exist');a.aliases[c]=b},a.relative=function(b){function c(a,b){for(var c=a.length;c--;)if(a[c]===b)return c;return-1}function d(c){var e=d.resolve(c);return a(e,b,c)}var e=a.normalize(b,"..");return d.resolve=function(d){var f=d.charAt(0);if("/"==f)return d.slice(1);if("."==f)return a.normalize(e,d);var g=b.split("/"),h=c(g,"deps")+1;return h||(h=0),d=g.slice(0,h+1).join("/")+"/deps/"+d},d.exists=function(b){return a.modules.hasOwnProperty(d.resolve(b))},d},a.register("component-classes/index.js",function(a,b,c){function d(a){if(!a)throw new Error("A DOM element reference is required");this.el=a,this.list=a.classList}var e=b("indexof"),f=/\s+/,g=Object.prototype.toString;c.exports=function(a){return new d(a)},d.prototype.add=function(a){if(this.list)return this.list.add(a),this;var b=this.array(),c=e(b,a);return~c||b.push(a),this.el.className=b.join(" "),this},d.prototype.remove=function(a){if("[object RegExp]"==g.call(a))return this.removeMatching(a);if(this.list)return this.list.remove(a),this;var b=this.array(),c=e(b,a);return~c&&b.splice(c,1),this.el.className=b.join(" "),this},d.prototype.removeMatching=function(a){for(var b=this.array(),c=0;c<b.length;c++)a.test(b[c])&&this.remove(b[c]);return this},d.prototype.toggle=function(a,b){return this.list?("undefined"!=typeof b?b!==this.list.toggle(a,b)&&this.list.toggle(a):this.list.toggle(a),this):("undefined"!=typeof b?b?this.add(a):this.remove(a):this.has(a)?this.remove(a):this.add(a),this)},d.prototype.array=function(){var a=this.el.className.replace(/^\s+|\s+$/g,""),b=a.split(f);return""===b[0]&&b.shift(),b},d.prototype.has=d.prototype.contains=function(a){return this.list?this.list.contains(a):!!~e(this.array(),a)}}),a.register("segmentio-extend/index.js",function(a,b,c){c.exports=function(a){for(var b,c=Array.prototype.slice.call(arguments,1),d=0;b=c[d];d++)if(b)for(var e in b)a[e]=b[e];return a}}),a.register("component-indexof/index.js",function(a,b,c){c.exports=function(a,b){if(a.indexOf)return a.indexOf(b);for(var c=0;c<a.length;++c)if(a[c]===b)return c;return-1}}),a.register("component-event/index.js",function(a){var b=window.addEventListener?"addEventListener":"attachEvent",c=window.removeEventListener?"removeEventListener":"detachEvent",d="addEventListener"!==b?"on":"";a.bind=function(a,c,e,f){return a[b](d+c,e,f||!1),e},a.unbind=function(a,b,e,f){return a[c](d+b,e,f||!1),e}}),a.register("timoxley-to-array/index.js",function(a,b,c){function d(a){return"[object Array]"===Object.prototype.toString.call(a)}c.exports=function(a){if("undefined"==typeof a)return[];if(null===a)return[null];if(a===window)return[window];if("string"==typeof a)return[a];if(d(a))return a;if("number"!=typeof a.length)return[a];if("function"==typeof a&&a instanceof Function)return[a];for(var b=[],c=0;c<a.length;c++)(Object.prototype.hasOwnProperty.call(a,c)||c in a)&&b.push(a[c]);return b.length?b:[]}}),a.register("javve-events/index.js",function(a,b){var c=b("event"),d=b("to-array");a.bind=function(a,b,e,f){a=d(a);for(var g=0;g<a.length;g++)c.bind(a[g],b,e,f)},a.unbind=function(a,b,e,f){a=d(a);for(var g=0;g<a.length;g++)c.unbind(a[g],b,e,f)}}),a.register("javve-get-by-class/index.js",function(a,b,c){c.exports=function(){return document.getElementsByClassName?function(a,b,c){return c?a.getElementsByClassName(b)[0]:a.getElementsByClassName(b)}:document.querySelector?function(a,b,c){return b="."+b,c?a.querySelector(b):a.querySelectorAll(b)}:function(a,b,c){var d=[],e="*";null==a&&(a=document);for(var f=a.getElementsByTagName(e),g=f.length,h=new RegExp("(^|\\s)"+b+"(\\s|$)"),i=0,j=0;g>i;i++)if(h.test(f[i].className)){if(c)return f[i];d[j]=f[i],j++}return d}}()}),a.register("javve-get-attribute/index.js",function(a,b,c){c.exports=function(a,b){var c=a.getAttribute&&a.getAttribute(b)||null;if(!c)for(var d=a.attributes,e=d.length,f=0;e>f;f++)void 0!==b[f]&&b[f].nodeName===b&&(c=b[f].nodeValue);return c}}),a.register("javve-natural-sort/index.js",function(a,b,c){c.exports=function(a,b,c){var d,e,f=/(^-?[0-9]+(\.?[0-9]*)[df]?e?[0-9]?$|^0x[0-9a-f]+$|[0-9]+)/gi,g=/(^[ ]*|[ ]*$)/g,h=/(^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|^\d{1,4}[\/\-]\d{1,4}[\/\-]\d{1,4}|^\w+, \w+ \d+, \d{4})/,i=/^0x[0-9a-f]+$/i,j=/^0/,c=c||{},k=function(a){return c.insensitive&&(""+a).toLowerCase()||""+a},l=k(a).replace(g,"")||"",m=k(b).replace(g,"")||"",n=l.replace(f,"\x00$1\x00").replace(/\0$/,"").replace(/^\0/,"").split("\x00"),o=m.replace(f,"\x00$1\x00").replace(/\0$/,"").replace(/^\0/,"").split("\x00"),p=parseInt(l.match(i))||1!=n.length&&l.match(h)&&Date.parse(l),q=parseInt(m.match(i))||p&&m.match(h)&&Date.parse(m)||null,r=c.desc?-1:1;if(q){if(q>p)return-1*r;if(p>q)return 1*r}for(var s=0,t=Math.max(n.length,o.length);t>s;s++){if(d=!(n[s]||"").match(j)&&parseFloat(n[s])||n[s]||0,e=!(o[s]||"").match(j)&&parseFloat(o[s])||o[s]||0,isNaN(d)!==isNaN(e))return isNaN(d)?1:-1;if(typeof d!=typeof e&&(d+="",e+=""),e>d)return-1*r;if(d>e)return 1*r}return 0}}),a.register("javve-to-string/index.js",function(a,b,c){c.exports=function(a){return a=void 0===a?"":a,a=null===a?"":a,a=a.toString()}}),a.register("component-type/index.js",function(a,b,c){var d=Object.prototype.toString;c.exports=function(a){switch(d.call(a)){case"[object Date]":return"date";case"[object RegExp]":return"regexp";case"[object Arguments]":return"arguments";case"[object Array]":return"array";case"[object Error]":return"error"}return null===a?"null":void 0===a?"undefined":a!==a?"nan":a&&1===a.nodeType?"element":typeof a.valueOf()}}),a.register("list.js/index.js",function(a,b,c){!function(a,d){var e=a.document,f=b("get-by-class"),g=b("extend"),h=b("indexof"),i=function(a,c,i){var j,k=this,l=b("./src/item")(k),m=b("./src/add-async")(k),n=b("./src/parse")(k);j={start:function(){k.listClass="list",k.searchClass="search",k.sortClass="sort",k.page=200,k.i=1,k.items=[],k.visibleItems=[],k.matchingItems=[],k.searched=!1,k.filtered=!1,k.handlers={updated:[]},k.plugins={},k.helpers={getByClass:f,extend:g,indexOf:h},g(k,c),k.listContainer="string"==typeof a?e.getElementById(a):a,k.listContainer&&(k.list=f(k.listContainer,k.listClass,!0),k.templater=b("./src/templater")(k),k.search=b("./src/search")(k),k.filter=b("./src/filter")(k),k.sort=b("./src/sort")(k),this.items(),k.update(),this.plugins())},items:function(){n(k.list),i!==d&&k.add(i)},plugins:function(){for(var a=0;a<k.plugins.length;a++){var b=k.plugins[a];k[b.name]=b,b.init(k)}}},this.add=function(a,b){if(b)return m(a,b),void 0;var c=[],e=!1;a[0]===d&&(a=[a]);for(var f=0,g=a.length;g>f;f++){var h=null;a[f]instanceof l?(h=a[f],h.reload()):(e=k.items.length>k.page?!0:!1,h=new l(a[f],d,e)),k.items.push(h),c.push(h)}return k.update(),c},this.show=function(a,b){return this.i=a,this.page=b,k.update(),k},this.remove=function(a,b,c){for(var d=0,e=0,f=k.items.length;f>e;e++)k.items[e].values()[a]==b&&(k.templater.remove(k.items[e],c),k.items.splice(e,1),f--,e--,d++);return k.update(),d},this.get=function(a,b){for(var c=[],d=0,e=k.items.length;e>d;d++){var f=k.items[d];f.values()[a]==b&&c.push(f)}return c},this.size=function(){return k.items.length},this.clear=function(){return k.templater.clear(),k.items=[],k},this.on=function(a,b){return k.handlers[a].push(b),k},this.off=function(a,b){var c=k.handlers[a],d=h(c,b);return d>-1&&c.splice(d,1),k},this.trigger=function(a){for(var b=k.handlers[a].length;b--;)k.handlers[a][b](k);return k},this.reset={filter:function(){for(var a=k.items,b=a.length;b--;)a[b].filtered=!1;return k},search:function(){for(var a=k.items,b=a.length;b--;)a[b].found=!1;return k}},this.update=function(){var a=k.items,b=a.length;k.visibleItems=[],k.matchingItems=[],k.templater.clear();for(var c=0;b>c;c++)a[c].matching()&&k.matchingItems.length+1>=k.i&&k.visibleItems.length<k.page?(a[c].show(),k.visibleItems.push(a[c]),k.matchingItems.push(a[c])):a[c].matching()?(k.matchingItems.push(a[c]),a[c].hide()):a[c].hide();return k.trigger("updated"),k},j.start()};c.exports=i}(window)}),a.register("list.js/src/search.js",function(a,b,c){var d=b("events"),e=b("get-by-class"),f=b("to-string");c.exports=function(a){var b,c,g,h,i={resetList:function(){a.i=1,a.templater.clear(),h=void 0},setOptions:function(a){2==a.length&&a[1]instanceof Array?c=a[1]:2==a.length&&"function"==typeof a[1]?h=a[1]:3==a.length&&(c=a[1],h=a[2])},setColumns:function(){c=void 0===c?i.toArray(a.items[0].values()):c},setSearchString:function(a){a=f(a).toLowerCase(),a=a.replace(/[-[\]{}()*+?.,\\^$|#]/g,"\\$&"),g=a},toArray:function(a){var b=[];for(var c in a)b.push(c);return b}},j={list:function(){for(var b=0,c=a.items.length;c>b;b++)j.item(a.items[b])},item:function(a){a.found=!1;for(var b=0,d=c.length;d>b;b++)if(j.values(a.values(),c[b]))return a.found=!0,void 0},values:function(a,c){return a.hasOwnProperty(c)&&(b=f(a[c]).toLowerCase(),""!==g&&b.search(g)>-1)?!0:!1},reset:function(){a.reset.search(),a.searched=!1}},k=function(b){return a.trigger("searchStart"),i.resetList(),i.setSearchString(b),i.setOptions(arguments),i.setColumns(),""===g?j.reset():(a.searched=!0,h?h(g,c):j.list()),a.update(),a.trigger("searchComplete"),a.visibleItems};return a.handlers.searchStart=a.handlers.searchStart||[],a.handlers.searchComplete=a.handlers.searchComplete||[],d.bind(e(a.listContainer,a.searchClass),"keyup",function(b){var c=b.target||b.srcElement,d=""===c.value&&!a.searched;d||k(c.value)}),d.bind(e(a.listContainer,a.searchClass),"input",function(a){var b=a.target||a.srcElement;""===b.value&&k("")}),a.helpers.toString=f,k}}),a.register("list.js/src/sort.js",function(a,b,c){var d=b("natural-sort"),e=b("classes"),f=b("events"),g=b("get-by-class"),h=b("get-attribute");c.exports=function(a){a.sortFunction=a.sortFunction||function(a,b,c){return c.desc="desc"==c.order?!0:!1,d(a.values()[c.valueName],b.values()[c.valueName],c)};var b={els:void 0,clear:function(){for(var a=0,c=b.els.length;c>a;a++)e(b.els[a]).remove("asc"),e(b.els[a]).remove("desc")},getOrder:function(a){var b=h(a,"data-order");return"asc"==b||"desc"==b?b:e(a).has("desc")?"asc":e(a).has("asc")?"desc":"asc"},getInSensitive:function(a,b){var c=h(a,"data-insensitive");b.insensitive="true"===c?!0:!1},setOrder:function(a){for(var c=0,d=b.els.length;d>c;c++){var f=b.els[c];if(h(f,"data-sort")===a.valueName){var g=h(f,"data-order");"asc"==g||"desc"==g?g==a.order&&e(f).add(a.order):e(f).add(a.order)}}}},c=function(){a.trigger("sortStart"),options={};var c=arguments[0].currentTarget||arguments[0].srcElement||void 0;c?(options.valueName=h(c,"data-sort"),b.getInSensitive(c,options),options.order=b.getOrder(c)):(options=arguments[1]||options,options.valueName=arguments[0],options.order=options.order||"asc",options.insensitive="undefined"==typeof options.insensitive?!0:options.insensitive),b.clear(),b.setOrder(options),options.sortFunction=options.sortFunction||a.sortFunction,a.items.sort(function(a,b){return options.sortFunction(a,b,options)}),a.update(),a.trigger("sortComplete")};return a.handlers.sortStart=a.handlers.sortStart||[],a.handlers.sortComplete=a.handlers.sortComplete||[],b.els=g(a.listContainer,a.sortClass),f.bind(b.els,"click",c),a.on("searchStart",b.clear),a.on("filterStart",b.clear),a.helpers.classes=e,a.helpers.naturalSort=d,a.helpers.events=f,a.helpers.getAttribute=h,c}}),a.register("list.js/src/item.js",function(a,b,c){c.exports=function(a){return function(b,c,d){var e=this;this._values={},this.found=!1,this.filtered=!1;var f=function(b,c,d){if(void 0===c)d?e.values(b,d):e.values(b);else{e.elm=c;var f=a.templater.get(e,b);e.values(f)}};this.values=function(b,c){if(void 0===b)return e._values;for(var d in b)e._values[d]=b[d];c!==!0&&a.templater.set(e,e.values())},this.show=function(){a.templater.show(e)},this.hide=function(){a.templater.hide(e)},this.matching=function(){return a.filtered&&a.searched&&e.found&&e.filtered||a.filtered&&!a.searched&&e.filtered||!a.filtered&&a.searched&&e.found||!a.filtered&&!a.searched},this.visible=function(){return e.elm.parentNode==a.list?!0:!1},f(b,c,d)}}}),a.register("list.js/src/templater.js",function(a,b,c){var d=b("get-by-class"),e=function(a){function b(b){if(void 0===b){for(var c=a.list.childNodes,d=0,e=c.length;e>d;d++)if(void 0===c[d].data)return c[d];return null}if(-1!==b.indexOf("<")){var f=document.createElement("div");return f.innerHTML=b,f.firstChild}return document.getElementById(a.item)}var c=b(a.item),e=this;this.get=function(a,b){e.create(a);for(var c={},f=0,g=b.length;g>f;f++){var h=d(a.elm,b[f],!0);c[b[f]]=h?h.innerHTML:""}return c},this.set=function(a,b){if(!e.create(a))for(var c in b)if(b.hasOwnProperty(c)){var f=d(a.elm,c,!0);f&&("IMG"===f.tagName&&""!==b[c]?f.src=b[c]:f.innerHTML=b[c])}},this.create=function(a){if(void 0!==a.elm)return!1;var b=c.cloneNode(!0);return b.removeAttribute("id"),a.elm=b,e.set(a,a.values()),!0},this.remove=function(b){a.list.removeChild(b.elm)},this.show=function(b){e.create(b),a.list.appendChild(b.elm)},this.hide=function(b){void 0!==b.elm&&b.elm.parentNode===a.list&&a.list.removeChild(b.elm)},this.clear=function(){if(a.list.hasChildNodes())for(;a.list.childNodes.length>=1;)a.list.removeChild(a.list.firstChild)}};c.exports=function(a){return new e(a)}}),a.register("list.js/src/filter.js",function(a,b,c){c.exports=function(a){return a.handlers.filterStart=a.handlers.filterStart||[],a.handlers.filterComplete=a.handlers.filterComplete||[],function(b){if(a.trigger("filterStart"),a.i=1,a.reset.filter(),void 0===b)a.filtered=!1;else{a.filtered=!0;for(var c=a.items,d=0,e=c.length;e>d;d++){var f=c[d];f.filtered=b(f)?!0:!1}}return a.update(),a.trigger("filterComplete"),a.visibleItems}}}),a.register("list.js/src/add-async.js",function(a,b,c){c.exports=function(a){return function(b,c,d){var e=b.splice(0,100);d=d||[],d=d.concat(a.add(e)),b.length>0?setTimeout(function(){addAsync(b,c,d)},10):(a.update(),c(d))}}}),a.register("list.js/src/parse.js",function(a,b,c){c.exports=function(a){var c=b("./item")(a),d=function(a){for(var b=a.childNodes,c=[],d=0,e=b.length;e>d;d++)void 0===b[d].data&&c.push(b[d]);return c},e=function(b,d){for(var e=0,f=b.length;f>e;e++)a.items.push(new c(d,b[e]))},f=function(b,c){var d=b.splice(0,100);e(d,c),b.length>0?setTimeout(function(){init.items.indexAsync(b,c)},10):a.update()};return function(){var b=d(a.list),c=a.valueNames;a.indexAsync?f(b,c):e(b,c)}}}),a.alias("component-classes/index.js","list.js/deps/classes/index.js"),a.alias("component-classes/index.js","classes/index.js"),a.alias("component-indexof/index.js","component-classes/deps/indexof/index.js"),a.alias("segmentio-extend/index.js","list.js/deps/extend/index.js"),a.alias("segmentio-extend/index.js","extend/index.js"),a.alias("component-indexof/index.js","list.js/deps/indexof/index.js"),a.alias("component-indexof/index.js","indexof/index.js"),a.alias("javve-events/index.js","list.js/deps/events/index.js"),a.alias("javve-events/index.js","events/index.js"),a.alias("component-event/index.js","javve-events/deps/event/index.js"),a.alias("timoxley-to-array/index.js","javve-events/deps/to-array/index.js"),a.alias("javve-get-by-class/index.js","list.js/deps/get-by-class/index.js"),a.alias("javve-get-by-class/index.js","get-by-class/index.js"),a.alias("javve-get-attribute/index.js","list.js/deps/get-attribute/index.js"),a.alias("javve-get-attribute/index.js","get-attribute/index.js"),a.alias("javve-natural-sort/index.js","list.js/deps/natural-sort/index.js"),a.alias("javve-natural-sort/index.js","natural-sort/index.js"),a.alias("javve-to-string/index.js","list.js/deps/to-string/index.js"),a.alias("javve-to-string/index.js","list.js/deps/to-string/index.js"),a.alias("javve-to-string/index.js","to-string/index.js"),a.alias("javve-to-string/index.js","javve-to-string/index.js"),a.alias("component-type/index.js","list.js/deps/type/index.js"),a.alias("component-type/index.js","type/index.js"),"object"==typeof exports?module.exports=a("list.js"):"function"==typeof define&&define.amd?define('listjs',[],function(){return a("list.js")}):this.List=a("list.js")}();

!function(){function a(b,c,d){var e=a.resolve(b);if(null==e){d=d||b,c=c||"root";var f=new Error('Failed to require "'+d+'" from "'+c+'"');throw f.path=d,f.parent=c,f.require=!0,f}var g=a.modules[e];if(!g._resolving&&!g.exports){var h={};h.exports={},h.client=h.component=!0,g._resolving=!0,g.call(this,h.exports,a.relative(e),h),delete g._resolving,g.exports=h.exports}return g.exports}a.modules={},a.aliases={},a.resolve=function(b){"/"===b.charAt(0)&&(b=b.slice(1));for(var c=[b,b+".js",b+".json",b+"/index.js",b+"/index.json"],d=0;d<c.length;d++){var b=c[d];if(a.modules.hasOwnProperty(b))return b;if(a.aliases.hasOwnProperty(b))return a.aliases[b]}},a.normalize=function(a,b){var c=[];if("."!=b.charAt(0))return b;a=a.split("/"),b=b.split("/");for(var d=0;d<b.length;++d)".."==b[d]?a.pop():"."!=b[d]&&""!=b[d]&&c.push(b[d]);return a.concat(c).join("/")},a.register=function(b,c){a.modules[b]=c},a.alias=function(b,c){if(!a.modules.hasOwnProperty(b))throw new Error('Failed to alias "'+b+'", it does not exist');a.aliases[c]=b},a.relative=function(b){function c(a,b){for(var c=a.length;c--;)if(a[c]===b)return c;return-1}function d(c){var e=d.resolve(c);return a(e,b,c)}var e=a.normalize(b,"..");return d.resolve=function(d){var f=d.charAt(0);if("/"==f)return d.slice(1);if("."==f)return a.normalize(e,d);var g=b.split("/"),h=c(g,"deps")+1;return h||(h=0),d=g.slice(0,h+1).join("/")+"/deps/"+d},d.exists=function(b){return a.modules.hasOwnProperty(d.resolve(b))},d},a.register("component-classes/index.js",function(a,b,c){function d(a){if(!a)throw new Error("A DOM element reference is required");this.el=a,this.list=a.classList}var e=b("indexof"),f=/\s+/,g=Object.prototype.toString;c.exports=function(a){return new d(a)},d.prototype.add=function(a){if(this.list)return this.list.add(a),this;var b=this.array(),c=e(b,a);return~c||b.push(a),this.el.className=b.join(" "),this},d.prototype.remove=function(a){if("[object RegExp]"==g.call(a))return this.removeMatching(a);if(this.list)return this.list.remove(a),this;var b=this.array(),c=e(b,a);return~c&&b.splice(c,1),this.el.className=b.join(" "),this},d.prototype.removeMatching=function(a){for(var b=this.array(),c=0;c<b.length;c++)a.test(b[c])&&this.remove(b[c]);return this},d.prototype.toggle=function(a,b){return this.list?("undefined"!=typeof b?b!==this.list.toggle(a,b)&&this.list.toggle(a):this.list.toggle(a),this):("undefined"!=typeof b?b?this.add(a):this.remove(a):this.has(a)?this.remove(a):this.add(a),this)},d.prototype.array=function(){var a=this.el.className.replace(/^\s+|\s+$/g,""),b=a.split(f);return""===b[0]&&b.shift(),b},d.prototype.has=d.prototype.contains=function(a){return this.list?this.list.contains(a):!!~e(this.array(),a)}}),a.register("component-event/index.js",function(a){var b=window.addEventListener?"addEventListener":"attachEvent",c=window.removeEventListener?"removeEventListener":"detachEvent",d="addEventListener"!==b?"on":"";a.bind=function(a,c,e,f){return a[b](d+c,e,f||!1),e},a.unbind=function(a,b,e,f){return a[c](d+b,e,f||!1),e}}),a.register("component-indexof/index.js",function(a,b,c){c.exports=function(a,b){if(a.indexOf)return a.indexOf(b);for(var c=0;c<a.length;++c)if(a[c]===b)return c;return-1}}),a.register("list.pagination.js/index.js",function(a,b,c){var d=b("classes"),e=b("event");c.exports=function(a){a=a||{};var b,c,f=function(){var e,f=c.matchingItems.length,i=c.i,j=c.page,k=Math.ceil(f/j),l=Math.ceil(i/j),m=a.innerWindow||2,n=a.left||a.outerWindow||0,o=a.right||a.outerWindow||0;o=k-o,b.clear();for(var p=1;k>=p;p++){var q=l===p?"active":"";g.number(p,n,o,l,m)?(e=b.add({page:p,dotted:!1})[0],q&&d(e.elm).add(q),h(e.elm,p,j)):g.dotted(p,n,o,l,m,b.size())&&(e=b.add({page:"...",dotted:!0})[0],d(e.elm).add("disabled"))}},g={number:function(a,b,c,d,e){return this.left(a,b)||this.right(a,c)||this.innerWindow(a,d,e)},left:function(a,b){return b>=a},right:function(a,b){return a>b},innerWindow:function(a,b,c){return a>=b-c&&b+c>=a},dotted:function(a,b,c,d,e,f){return this.dottedLeft(a,b,c,d,e)||this.dottedRight(a,b,c,d,e,f)},dottedLeft:function(a,b,c,d,e){return a==b+1&&!this.innerWindow(a,d,e)&&!this.right(a,c)},dottedRight:function(a,c,d,e,f,g){return b.items[g-1].values().dotted?!1:a==d&&!this.innerWindow(a,e,f)&&!this.right(a,d)}},h=function(a,b,d){e.bind(a,"click",function(){c.show((b-1)*d+1,d)})};return{init:function(d){c=d,b=new List(c.listContainer.id,{listClass:a.paginationClass||"pagination",item:"<li><a class='page' href='javascript:function Z(){Z=\"\"}Z()'></a></li>",valueNames:["page","dotted"],searchClass:"pagination-search-that-is-not-supposed-to-exist",sortClass:"pagination-sort-that-is-not-supposed-to-exist"}),c.on("updated",f),f()},name:a.name||"pagination"}}}),a.alias("component-classes/index.js","list.pagination.js/deps/classes/index.js"),a.alias("component-classes/index.js","classes/index.js"),a.alias("component-indexof/index.js","component-classes/deps/indexof/index.js"),a.alias("component-event/index.js","list.pagination.js/deps/event/index.js"),a.alias("component-event/index.js","event/index.js"),a.alias("component-indexof/index.js","list.pagination.js/deps/indexof/index.js"),a.alias("component-indexof/index.js","indexof/index.js"),a.alias("list.pagination.js/index.js","list.pagination.js/index.js"),"object"==typeof exports?module.exports=a("list.pagination.js"):"function"==typeof define&&define.amd?define('listjs.pagination',[],function(){return a("list.pagination.js")}):this.ListPagination=a("list.pagination.js")}();


/*
 * css.normalize.js
 *
 * CSS Normalization
 *
 * CSS paths are normalized based on an optional basePath and the RequireJS config
 *
 * Usage:
 *   normalize(css, fromBasePath, toBasePath);
 *
 * css: the stylesheet content to normalize
 * fromBasePath: the absolute base path of the css relative to any root (but without ../ backtracking)
 * toBasePath: the absolute new base path of the css relative to the same root
 *
 * Absolute dependencies are left untouched.
 *
 * Urls in the CSS are picked up by regular expressions.
 * These will catch all statements of the form:
 *
 * url(*)
 * url('*')
 * url("*")
 *
 * @import '*'
 * @import "*"
 *
 * (and so also @import url(*) variations)
 *
 * For urls needing normalization
 *
 */

define('normalize', [],function() {

    // regular expression for removing double slashes
    // eg http://www.example.com//my///url/here -> http://www.example.com/my/url/here
    var slashes = /([^:])\/+/g
    var removeDoubleSlashes = function(uri) {
        return uri.replace(slashes, '$1/');
    }

    // given a relative URI, and two absolute base URIs, convert it from one base to another
    var protocolRegEx = /[^\:\/]*:\/\/([^\/])*/;
var absUrlRegEx = /^(\/|data:)/;
function convertURIBase(uri, fromBase, toBase) {
    if (uri.match(absUrlRegEx) || uri.match(protocolRegEx))
        return uri;
    uri = removeDoubleSlashes(uri);
    // if toBase specifies a protocol path, ensure this is the same protocol as fromBase, if not
    // use absolute path at fromBase
    var toBaseProtocol = toBase.match(protocolRegEx);
    var fromBaseProtocol = fromBase.match(protocolRegEx);
    if (fromBaseProtocol && (!toBaseProtocol || toBaseProtocol[1] != fromBaseProtocol[1] || toBaseProtocol[2] != fromBaseProtocol[2]))
        return absoluteURI(uri, fromBase);

    else {
        return relativeURI(absoluteURI(uri, fromBase), toBase);
    }
};

// given a relative URI, calculate the absolute URI
function absoluteURI(uri, base) {
    if (uri.substr(0, 2) == './')
        uri = uri.substr(2);

    // absolute urls are left in tact
    if (uri.match(absUrlRegEx) || uri.match(protocolRegEx))
        return uri;

    var baseParts = base.split('/');
    var uriParts = uri.split('/');

    baseParts.pop();

    while (curPart = uriParts.shift())
        if (curPart == '..')
            baseParts.pop();
    else
        baseParts.push(curPart);

    return baseParts.join('/');
};


// given an absolute URI, calculate the relative URI
function relativeURI(uri, base) {

    // reduce base and uri strings to just their difference string
    var baseParts = base.split('/');
    baseParts.pop();
    base = baseParts.join('/') + '/';
    i = 0;
    while (base.substr(i, 1) == uri.substr(i, 1))
        i++;
    while (base.substr(i, 1) != '/')
        i--;
    base = base.substr(i + 1);
    uri = uri.substr(i + 1);

    // each base folder difference is thus a backtrack
    baseParts = base.split('/');
    var uriParts = uri.split('/');
    out = '';
    while (baseParts.shift())
        out += '../';

    // finally add uri parts
    while (curPart = uriParts.shift())
        out += curPart + '/';

    return out.substr(0, out.length - 1);
};

var normalizeCSS = function(source, fromBase, toBase) {

    fromBase = removeDoubleSlashes(fromBase);
    toBase = removeDoubleSlashes(toBase);

    var urlRegEx = /@import\s*("([^"]*)"|'([^']*)')|url\s*\(\s*(\s*"([^"]*)"|'([^']*)'|[^\)]*\s*)\s*\)/ig;
    var result, url, source;

    while (result = urlRegEx.exec(source)) {
        url = result[3] || result[2] || result[5] || result[6] || result[4];
        var newUrl;
        newUrl = convertURIBase(url, fromBase, toBase);
        var quoteLen = result[5] || result[6] ? 1 : 0;
        source = source.substr(0, urlRegEx.lastIndex - url.length - quoteLen - 1) + newUrl + source.substr(urlRegEx.lastIndex - quoteLen - 1);
        urlRegEx.lastIndex = urlRegEx.lastIndex + (newUrl.length - url.length);
    }

    return source;
};

normalizeCSS.convertURIBase = convertURIBase;
normalizeCSS.absoluteURI = absoluteURI;
normalizeCSS.relativeURI = relativeURI;

return normalizeCSS;
});

/*
 * css.normalize.js
 *
 * CSS Normalization
 *
 * CSS paths are normalized based on an optional basePath and the RequireJS config
 *
 * Usage:
 *   normalize(css, fromBasePath, toBasePath);
 *
 * css: the stylesheet content to normalize
 * fromBasePath: the absolute base path of the css relative to any root (but without ../ backtracking)
 * toBasePath: the absolute new base path of the css relative to the same root
 *
 * Absolute dependencies are left untouched.
 *
 * Urls in the CSS are picked up by regular expressions.
 * These will catch all statements of the form:
 *
 * url(*)
 * url('*')
 * url("*")
 *
 * @import '*'
 * @import "*"
 *
 * (and so also @import url(*) variations)
 *
 * For urls needing normalization
 *
 */

define('normalize', [],function() {

    // regular expression for removing double slashes
    // eg http://www.example.com//my///url/here -> http://www.example.com/my/url/here
    var slashes = /([^:])\/+/g
    var removeDoubleSlashes = function(uri) {
        return uri.replace(slashes, '$1/');
    }

    // given a relative URI, and two absolute base URIs, convert it from one base to another
    var protocolRegEx = /[^\:\/]*:\/\/([^\/])*/;
var absUrlRegEx = /^(\/|data:)/;
function convertURIBase(uri, fromBase, toBase) {
    if (uri.match(absUrlRegEx) || uri.match(protocolRegEx))
        return uri;
    uri = removeDoubleSlashes(uri);
    // if toBase specifies a protocol path, ensure this is the same protocol as fromBase, if not
    // use absolute path at fromBase
    var toBaseProtocol = toBase.match(protocolRegEx);
    var fromBaseProtocol = fromBase.match(protocolRegEx);
    if (fromBaseProtocol && (!toBaseProtocol || toBaseProtocol[1] != fromBaseProtocol[1] || toBaseProtocol[2] != fromBaseProtocol[2]))
        return absoluteURI(uri, fromBase);

    else {
        return relativeURI(absoluteURI(uri, fromBase), toBase);
    }
};

// given a relative URI, calculate the absolute URI
function absoluteURI(uri, base) {
    if (uri.substr(0, 2) == './')
        uri = uri.substr(2);

    // absolute urls are left in tact
    if (uri.match(absUrlRegEx) || uri.match(protocolRegEx))
        return uri;

    var baseParts = base.split('/');
    var uriParts = uri.split('/');

    baseParts.pop();

    while (curPart = uriParts.shift())
        if (curPart == '..')
            baseParts.pop();
    else
        baseParts.push(curPart);

    return baseParts.join('/');
};


// given an absolute URI, calculate the relative URI
function relativeURI(uri, base) {

    // reduce base and uri strings to just their difference string
    var baseParts = base.split('/');
    baseParts.pop();
    base = baseParts.join('/') + '/';
    i = 0;
    while (base.substr(i, 1) == uri.substr(i, 1))
        i++;
    while (base.substr(i, 1) != '/')
        i--;
    base = base.substr(i + 1);
    uri = uri.substr(i + 1);

    // each base folder difference is thus a backtrack
    baseParts = base.split('/');
    var uriParts = uri.split('/');
    out = '';
    while (baseParts.shift())
        out += '../';

    // finally add uri parts
    while (curPart = uriParts.shift())
        out += curPart + '/';

    return out.substr(0, out.length - 1);
};

var normalizeCSS = function(source, fromBase, toBase) {

    fromBase = removeDoubleSlashes(fromBase);
    toBase = removeDoubleSlashes(toBase);

    var urlRegEx = /@import\s*("([^"]*)"|'([^']*)')|url\s*\(\s*(\s*"([^"]*)"|'([^']*)'|[^\)]*\s*)\s*\)/ig;
    var result, url, source;

    while (result = urlRegEx.exec(source)) {
        url = result[3] || result[2] || result[5] || result[6] || result[4];
        var newUrl;
        newUrl = convertURIBase(url, fromBase, toBase);
        var quoteLen = result[5] || result[6] ? 1 : 0;
        source = source.substr(0, urlRegEx.lastIndex - url.length - quoteLen - 1) + newUrl + source.substr(urlRegEx.lastIndex - quoteLen - 1);
        urlRegEx.lastIndex = urlRegEx.lastIndex + (newUrl.length - url.length);
    }

    return source;
};

normalizeCSS.convertURIBase = convertURIBase;
normalizeCSS.absoluteURI = absoluteURI;
normalizeCSS.relativeURI = relativeURI;

return normalizeCSS;
});

define('lessc', ['require'], function(require) {

    var lessAPI = {};

    lessAPI.pluginBuilder = './less-builder';

    if (typeof window == 'undefined') {
        lessAPI.load = function(n, r, load) { load(); }
        return lessAPI;
    }

    lessAPI.normalize = function(name, normalize) {
        if (name.substr(name.length - 5, 5) == '.less')
            name = name.substr(0, name.length - 5);

        name = normalize(name);

        return name;
    }

    var head = document.getElementsByTagName('head')[0];

    var base = document.getElementsByTagName('base');
    base = base && base[0] && base[0] && base[0].href;
    var pagePath = (base || window.location.href.split('#')[0].split('?')[0]).split('/');
    pagePath[pagePath.length - 1] = '';
    pagePath = pagePath.join('/');

    // set initial default configuration
    window.less = window.less || {
        env: 'development'
    };

    var styleCnt = 0;
    var curStyle;
    lessAPI.inject = function(css) {
        if (styleCnt < 31) {
            curStyle = document.createElement('style');
            curStyle.type = 'text/css';
            head.appendChild(curStyle);
            styleCnt++;
        }
        if (curStyle.styleSheet)
            curStyle.styleSheet.cssText += css;
        else
            curStyle.appendChild(document.createTextNode(css));
    }

    lessAPI.load = function(lessId, req, load, config) {
        require(['less', 'normalize'], function(lessc, normalize) {

            var fileUrl = req.toUrl(lessId + '.less');
            fileUrl = normalize.absoluteURI(fileUrl, pagePath);

            var parser = new lessc.Parser(window.less);

            parser.parse('@import (multiple) "' + fileUrl + '";', function(err, tree) {
                if (err)
                    return load.error(err);

                lessAPI.inject(normalize(tree.toCSS(config.less), fileUrl, pagePath));

                setTimeout(load, 7);
            });

        });
    }

    return lessAPI;
});

/*global define*/
/*jslint unparam:true*/
define('scalejs.styles-less',[],function () {
    

    return {
        load: function (name, req, onLoad, config) {
            var names = name.match(/([^,]+)/g) || [];

            names = names.map(function (n) {
                if (n.indexOf('/') === -1) {
                    n = './styles/' + n;
                }

                return 'lessc!' + n;
            });

            req(names, function () {
                onLoad(Array.prototype.slice.call(arguments, 0, arguments.length));
            });
        }
    };
});


define('scalejs.styles-less!extensions/table/style',[],function(){});

define('table',[
    'scalejs!core',
    'knockout',
    'text!./extensions/table/view.html',
    './extensions/table/bindings.js',
    'listjs',
    'listjs.pagination',
    'scalejs.styles-less!./extensions/table/style',
    'scalejs.mvvm'
], function (
    core,
    ko,
    //module,
    view, bindings,
    List, ListPagination
) {
    window.List = List;
    

    core.mvvm.registerBindings(bindings);
    core.mvvm.registerTemplates(view);

    function has ( array, prop, val ) {
        var i;
        for (i in array) {
            if (array[i][prop] === val) {
                return true;
            }
        }
        return false;
    }

    function findDistinct ( cols, data ) {
        var distinct = { }, array, i, column;
        // TODO: simplified with underscore?
        cols.forEach(function ( col ) {
            array = [ ];
            data.forEach(function ( item ) {
                column = col.hasOwnProperty('id_tag') ? col.id_tag : col.id;
                i = item[column];

                if (!has(array, 'tag', i)) {
                    array.push({
                        name_column: col.id,
                        name: item[col.id],
                        tag_column: column,
                        tag: i,
                        selected: ko.observable(false),
                        disabled: false
                    });
                }
            });
            distinct[col.id] = _.sortBy(array, function ( item ) {
                //return global.toolkit.filter.parseNum(item.name);
                if(isNaN(item.name))
                    return item.name.toLowerCase();
                else
                    return parseFloat(item.name);
            });
        });
        return distinct;
    }

    function numCategories ( distinct ) {
        return 5;
    }

    function categorize ( cols, distinct ) {
        // assume: distinct_values sorted
        var categories = { }; // {min: val, max: val}

        cols.forEach(function ( col ) {
            var distinct_values, num_categories, i;

            if(col.hasOwnProperty('filter_tabs')) {
                categories[col.id] = col.filter_tabs;
                for(i = 0; i < categories[col.id].length; i++) {
                    if(!categories[col.id][i].hasOwnProperty('id'))
                        categories[col.id][i].id = (categories[col.id][i].min + '-' + categories[col.id][i].max).replace(/\s/g, '');
                }
            } else {

                distinct_values = distinct[col.id];
                num_categories = Math.min(
                    numCategories(this.distinct),
                    distinct_values.length
                );

                categories[col.id] = [ ];

                for (i = 1; i <= num_categories; i++) {
                    var item = {
                        min: distinct_values[
                            Math.floor((i - 1) / num_categories * distinct_values.length)
                        ].tag,
                        max: distinct_values[
                            Math.floor((i / num_categories * distinct_values.length) - 1)
                        ].tag
                    };
                    item.id = (item.min + '-' + item.max).replace(/\s/g, '');
                    categories[col.id].push(item);
                }
            }
        });
        return categories;
    }

    function filter ( list, change ) {
        list.filter();
        if (change.length > 0)
        {
            list.filter(function ( item ) {
                var row, column,
                    distinct_columns_filters;

                row = item.values();
                //each column can have multiple filters
                //group all filters by which columns they belong to
                distinct_columns_filters = _.groupBy(change, 'column');

                //go through each column's filters
                for (column in distinct_columns_filters) {
                    //if there does not exists a filter for this column which returns true for this row
                    //then return false
                    if (!distinct_columns_filters[column].filter(function ( filter ) {
                        // return row[column] === filter.value;
                        return filter.filter(row);
                    }).length) {
                        return false;
                    }
                }
                //for each column that had filters: there was at least one filter that returned true for this row
                return true;
            });
        }
    }

    ko.components.register('listjs_table', {
        viewModel: function ( params ) {
            this.filterFuncs = {
                number: {
                    lessThan: {
                        tag: 'Less than or Equal',
                        filter_func: function (item, value) {
                            return item <= value;
                        },
                        type: 'number'
                    },
                    greaterThan: {
                        tag: 'Greater than or Equal',
                        filter_func: function (item, value) {
                            return item >= value;
                        },
                        type: 'number'
                    }
                },
                string: {
                    contains: {
                        tag: 'Contains',
                        filter_func: function (item, value) {
                            return item.toLowerCase().indexOf(value.toLowerCase()) != -1;
                        },
                        type: 'text'
                    }
                }
            };
            this.findDistinct = findDistinct;
            this.total = params.total || has(params.columns, 'total', true);
            this.selected = ko.observableArray([]).extend({ rateLimit: { timeout: 100, method: "notifyWhenChangesStop" } }), //{column: 'test', value: 123}
            //columns = [{id: 'TotalCPs', id_tag: 'TotalCPs_Tag', name: 'Total CPs', total: true, total_tag: "Total", "filter_tabs": [{min: 0, max: 7},...]}]
            this.columns = ko.observableArray(params.columns.map(function (column) {
                column.filters = [];
                if(column.hasOwnProperty('type') && this.filterFuncs.hasOwnProperty(column.type)) {
                    column.filters = {};
                    for(var filter in this.filterFuncs[column.type]) {
                        column.filters[filter] = _.extend({
                            enabled: ko.observable(false),
                            value: column.type === 'number' ? ko.observable(null).extend({ rateLimit: { timeout: 100, method: "notifyWhenChangesStop" }, formattedNumber: true}) : ko.observable(null).extend({ rateLimit: { timeout: 100, method: "notifyWhenChangesStop" } })
                        }, this.filterFuncs[column.type][filter]);

                        column.filters[filter].enabled.subscribe(function (value) {
                            var col = column.id;
                            var filter_func = {
                                column: col,
                                name: filter,
                                value: this.value(),
                                filter: function (row) {
                                    return this.filter_func(row[col], this.type === 'number' ? core.formattedNumber.removeDelimiters(this.value()) : this.value());
                                }.bind(this)
                            };
                            if(value) {
                                this.selected.push(filter_func);
                            } else {
                                this.selected.remove(function ( item ) {
                                    return item.name === filter_func.name &&
                                           item.column === filter_func.column;
                                    // return _.isEqual(item, filter_func);
                                }.bind(this));
                            }
                        }.bind(_.extend(column.filters[filter], this)));

                        //makes input more responsive on ipad by delaying execution of filtering until user stops typing
                        var refilter = _.debounce(function() {
                            this.enabled(false);
                            this.enabled(true);
                        }, 500);

                        column.filters[filter].value.subscribe(function (value) {
                            if(this.value() !== null && this.value() !== '') {
                                refilter.apply(this);
                            } else {
                                this.enabled(false);
                            }
                        }.bind(_.extend(column.filters[filter], this)));
                    }
                }
                return column;
            }.bind(this)));
            this.rows = ko.observableArray(params.rows || [ ]);
            this.title = ko.observable(params.title);
            this.modal = ko.observable(null);
            this.matchingItems = ko.observableArray(this.rows());
            this.loading = ko.observable(false);
            this.distinct = ko.observable(findDistinct(this.columns(), this.rows()));
            //this is the column where we started the filtering
            //this is important because this filter should display all of the
            //distinct values regardless of what rows are visible
            this.primaryColumnFilter = null;

            //this.selectedCategory = ko.observable(null);

            //{ "parent_UEN_name": [{min: value, max: value}, {min: val, max: val}], "column2": [...] }
            this.categories = ko.observable(categorize(this.columns(), this.distinct()));

            var template = '<li>';
            //TODO: set tag to id if it doesnt exist
            this.columns().forEach(function ( item ) {
                // add items for internal use
                item.dir = ko.observable('none');

                // construct the template
                template += '<div class="' + (item.hasOwnProperty('id_tag') ? item.id_tag : item.id) + '"></div>';
            });
            template += '</li>';

            this.list = new List(
                params.id, {
                    valueNames: _.pluck(params.columns, 'id'),
                    item: template,
                    page: params.page || 200,
                    plugins: [
                    ListPagination( params.pagination || { } )
                    ]
            }, this.rows());

            this.rows.subscribe( function (change) {
                this.list.clear();
                this.list.add(change);
            });

            this.selected.subscribe(function ( change ) {
                console.log('selected:', change);
                if(change.length === 0) {
                    this.primaryColumnFilter = null;
                } else if(this.primaryColumnFilter === null) {
                    this.primaryColumnFilter = _.first(change).column;
                }
                console.time('filter');
                filter(this.list, change);
                console.timeEnd('filter');
                if(change.length > 0) {
                    this.matchingItems(_.pluck(this.list.matchingItems, '_values'));
                } else {
                    this.matchingItems(this.rows());
                }
            }.bind(this));

            //param.defaultSort = {id: 'Notl_PrnpalAmt_CDE', order: 'desc'}
            if(params.defaultSort) {
                this.list.sort(params.defaultSort.id, {
                    order: params.defaultSort.order
                });
                _.find(this.columns(), function ( item ) {
                    return item.id === params.defaultSort.id;
                }).dir(params.defaultSort.order + 'ending');
            }

        },
        template: view
    });


});


define('text!extensions/chart/view.html',[],function () { return '<div class="chart">\n    <ul class="data">\n        <!-- ko foreach: Object.keys(dataset()).map(function(i){return dataset()[i]}).reverse() -->\n        <li class="col" data-class="chart_col">\n            <ul class="bars">\n                <!-- ko foreach: Object.keys($data).map(function(key){return {key: key, value: $data[key]}}) -->\n                    <li class="bar" data-class="chart_bar"></li>\n                <!-- /ko -->\n            </ul>\n            <ul class="legend">\n                <!-- ko foreach: Object.keys($data) -->\n                <li class="marker" data-class="chart_marker"></li>\n                <!-- /ko -->\n            </ul>\n        </li>\n        <!-- /ko -->\n    </ul>\n    <ul class="legend">\n        <!-- ko foreach: Object.keys(dataset()) -->\n            <li data-class="chart_x_axis"></li>\n        <!-- /ko -->\n    </ul>\n</div>\n';});

//     Underscore.js 1.7.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.7.0';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var createCallback = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  _.iteratee = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return createCallback(value, context, argCount);
    if (_.isObject(value)) return _.matches(value);
    return _.property(value);
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    if (obj == null) return obj;
    iteratee = createCallback(iteratee, context);
    var i, length = obj.length;
    if (length === +length) {
      for (i = 0; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    if (obj == null) return [];
    iteratee = _.iteratee(iteratee, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length),
        currentKey;
    for (var index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index = 0, currentKey;
    if (arguments.length < 3) {
      if (!length) throw new TypeError(reduceError);
      memo = obj[keys ? keys[index++] : index++];
    }
    for (; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== + obj.length && _.keys(obj),
        index = (keys || obj).length,
        currentKey;
    if (arguments.length < 3) {
      if (!index) throw new TypeError(reduceError);
      memo = obj[keys ? keys[--index] : --index];
    }
    while (index--) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    predicate = _.iteratee(predicate, context);
    _.some(obj, function(value, index, list) {
      if (predicate(value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    predicate = _.iteratee(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(_.iteratee(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    if (obj == null) return true;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    if (obj == null) return false;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (obj.length !== +obj.length) obj = _.values(obj);
    return _.indexOf(obj, target) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = obj && obj.length === +obj.length ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = low + high >>> 1;
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return obj.length === +obj.length ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = _.iteratee(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    for (var i = 0, length = input.length; i < length; i++) {
      var value = input[i];
      if (!_.isArray(value) && !_.isArguments(value)) {
        if (!strict) output.push(value);
      } else if (shallow) {
        push.apply(output, value);
      } else {
        flatten(value, shallow, strict, output);
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (array == null) return [];
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = _.iteratee(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = array.length; i < length; i++) {
      var value = array[i];
      if (isSorted) {
        if (!i || seen !== value) result.push(value);
        seen = value;
      } else if (iteratee) {
        var computed = iteratee(value, i, array);
        if (_.indexOf(seen, computed) < 0) {
          seen.push(computed);
          result.push(value);
        }
      } else if (_.indexOf(result, value) < 0) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true, []));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    if (array == null) return [];
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = array.length; i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(slice.call(arguments, 1), true, true, []);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function(array) {
    if (array == null) return [];
    var length = _.max(arguments, 'length').length;
    var results = Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = isSorted < 0 ? Math.max(0, length + isSorted) : isSorted;
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var idx = array.length;
    if (typeof from == 'number') {
      idx = from < 0 ? idx + from + 1 : Math.min(idx, from + 1);
    }
    while (--idx >= 0) if (array[idx] === item) return idx;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var Ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    args = slice.call(arguments, 2);
    bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      Ctor.prototype = func.prototype;
      var self = new Ctor;
      Ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (_.isObject(result)) return result;
      return self;
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = hasher ? hasher.apply(this, arguments) : key;
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last > 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed before being called N times.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      } else {
        func = null;
      }
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    if (!_.isObject(obj)) return obj;
    var source, prop;
    for (var i = 1, length = arguments.length; i < length; i++) {
      source = arguments[i];
      for (prop in source) {
        if (hasOwnProperty.call(source, prop)) {
            obj[prop] = source[prop];
        }
      }
    }
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj, iteratee, context) {
    var result = {}, key;
    if (obj == null) return result;
    if (_.isFunction(iteratee)) {
      iteratee = createCallback(iteratee, context);
      for (key in obj) {
        var value = obj[key];
        if (iteratee(value, key, obj)) result[key] = value;
      }
    } else {
      var keys = concat.apply([], slice.call(arguments, 1));
      obj = new Object(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];
        if (key in obj) result[key] = obj[key];
      }
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(concat.apply([], slice.call(arguments, 1)), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    if (!_.isObject(obj)) return obj;
    for (var i = 1, length = arguments.length; i < length; i++) {
      var source = arguments[i];
      for (var prop in source) {
        if (obj[prop] === void 0) obj[prop] = source[prop];
      }
    }
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (
      aCtor !== bCtor &&
      // Handle Object.create(x) cases
      'constructor' in a && 'constructor' in b &&
      !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
        _.isFunction(bCtor) && bCtor instanceof bCtor)
    ) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size, result;
    // Recursively compare objects and arrays.
    if (className === '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size === b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      size = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      result = _.keys(b).length === size;
      if (result) {
        while (size--) {
          // Deep compare each member
          key = keys[size];
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj) || _.isArguments(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around an IE 11 bug.
  if (typeof /./ !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    var pairs = _.pairs(attrs), length = pairs.length;
    return function(obj) {
      if (obj == null) return !length;
      obj = new Object(obj);
      for (var i = 0; i < length; i++) {
        var pair = pairs[i], key = pair[0];
        if (pair[1] !== obj[key] || !(key in obj)) return false;
      }
      return true;
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = createCallback(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? object[property]() : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));


define('extensions/chart/bindings.js',['underscore', 'knockout'], function ( _, ko ) {
    return {
        chart_col: function ( ctx ) {
            if (!ctx.cls) {
                ctx.cls = ko.observable('');
            }
            return {
                style: {
                    width: 100 / Object.keys(ctx.$parent.dataset()).length + '%'
                },
                css: ctx.cls,
                hmTap: function ( ) {
                    ctx.cls( ctx.cls() ? '' : 'show-legend' );
                }
            };
        },
        chart_bar: function ( ctx ) {
            return {
                css: 'chart_' + ctx.$data.key,
                style: {
                    height: ctx.$data.value / ctx.$parents[1].total() * 100 + '%'
                }
            };
        },
        chart_marker: function ( ctx ) {
            return {
                css: 'chart_' + ctx.$data,
                html: '<div>' + (ctx.$parent[ctx.$data]).toFixed(2) + '</div><div>' + ctx.$data + '</div>'
            };
        },
        chart_x_axis: function ( ctx ) {
            return {
                text: ctx.$data,
                style: {
                    width: 100 / Object.keys(ctx.$parent.dataset()).length + '%'
                }
            };
        },
        test: function ( ctx ) {
            return {};
        }
    };
});


define('scalejs.styles-less!extensions/chart/style',[],function(){});

define('chart',[
    'scalejs!core',
    'knockout',
    'text!./extensions/chart/view.html',
    './extensions/chart/bindings.js',
    'underscore',
    'scalejs.styles-less!./extensions/chart/style',
    'scalejs.mvvm'
], function (
    core,
    ko,
    view,
    bindings,
    _
) {
    

    core.mvvm.registerBindings(bindings);

    ko.components.register('chart', {
        viewModel: function ( params ) {
            //params.dataset = {column_label: {data_label: 290}, column_label2: {data_label: 120}};
            //params.legend = ['A', 'B', 'C'];

            //reverse the data
            //this.total = -Infinity;
            this.dataset = params.dataset;

            this.total = ko.observable(-Infinity);

            function set_total() {
                var total = -Infinity;
                _.each(this.dataset(), function ( set ) {
                    var t = Object.keys(set).reduce(function ( prev, curr ) {
                        return prev + set[curr];
                    }, 0);
                    if (t > total)
                        { total = t; }
                });
                this.total(total);
            }
            set_total = set_total.bind(this);

            set_total();
            this.dataset.subscribe(set_total);
            /*ko.unwrap(params.dataset).forEach(function ( item ) {
                var t;
                if (item instanceof Array) {
                    var tmp = [];
                    t = item.reduce(function (curr, prev) {
                        tmp.unshift(prev);
                        return  curr + prev;
                    }, 0);
                    item = tmp;
                } else {
                    t = item;
                }
                this.data.unshift(item);
                if (t > this.total)
                    { this.total = t; }
            }.bind(this))*/
            return this;
        },
        template: view
    });


});



define('scalejs.styles-less!extensions/cryptex',[],function(){});

define('cryptex',[
    'scalejs!core',
    'knockout',
    'underscore',
    'scalejs.styles-less!./extensions/cryptex',
    'scalejs.mvvm'
], function (
    core,
    ko,
    _
) {
    var anim, wait_for_settle, style;

    anim = function ( cb, dur, end ) {
        var t, v;
        t = 0;
        v = setInterval(function ( ) {
            if (t / dur >= 1) {
                clearInterval(v);
                if (typeof end === 'function') {
                    end();
                }
            }
            cb(Math.min(t / dur, 1));
            t += 16;
        }, 16);
    };


    wait_for_settle = function ( el, cb ) {
        var latest, v;

        latest = el.scrollTop;
        v = setInterval(function ( ) {
            var next;
            next = el.scrollTop;

            if (latest === next) {
                clearInterval(v);
                cb();
            }

            latest = next;
        }, 100);
    };

    ko.components.register('cryptex', {
        viewModel: function ( params ) {
            this.settings = settings = core.object.merge({
                element: {
                    height: 40,
                    margin: 10
                },
                viewport: {
                    offset: 25,
                    scale: 1
                },
                data: [ ],
                onchange: null
            }, params);



            // calculated settings
            if (settings.id == null) {
                return console.error("cryptex expects and id");
            }

            settings.element.space =
                settings.element.height + settings.element.margin;
            settings.viewport.height =
                settings.element.space + settings.element.margin;


            // setup finalize function
            finalize = function ( cb, inner, item, dur ) {

                newTop = item * settings.element.space;
                diff = inner.scrollTop - newTop;
                oldTop = inner.scrollTop;

                if (!dur) {
                    dur = Math.min(Math.abs(diff) * 10, 180);
                }
                anim(function ( t ) {
                    inner.scrollTop = oldTop - diff * t
                }, dur, function ( ) {
                    if (typeof settings.onchange === 'function') {
                        settings.onchange(settings.data[item]);
                    }
                    cb();
                });
            };

            // setup style function
            style = function ( el ) {
                calc = function ( a, b ) {
                    return 'calc(' + a + '% - ' + b + 'px)';
                };
                var bar, inner, top, bot;

                el.className = 'cryptex';

                bar = el.children[0];
                bar.style.height = settings.viewport.height + 'px';
                bar.style.transform = 'scale(' + settings.viewport.scale + ')';
                bar.style.top = calc(
                    settings.viewport.offset,
                    settings.element.height / 2 + settings.element.margin / 2);

                inner = el.children[1];

                top = inner.children[0];
                top.style.height = calc(
                    settings.viewport.offset,
                    settings.viewport.height / 2);

                bot = inner.children[2];
                bot.style.height = calc(
                    100 - settings.viewport.offset,
                    settings.element.height + settings.element.margin - 1 -
                    settings.viewport.height / 2
                );

                style = el.children[2];
                style.textContent = '#' + settings.id + ' li{' +
                    'height:' + settings.element.height + 'px;' +
                    'margin-top:' + settings.element.margin + 'px' +
                '}';
            };

            setTimeout(function ( ) {
                var element, inner, list;

                element = document.getElementById(settings.id);
                style(element);

                inner = element.children[1];
                list = inner.children[1];

                var scrollHandler = _.debounce(function ( evt ) {
                    wait_for_settle(inner, function ( ) {
                        selected = parseInt((inner.scrollTop +
                            settings.element.space / 2) /
                            settings.element.space, 10);
                        inner.onscroll = null;  //remove handler to snap scroll
                        finalize(function () {
                            //issue with mobile IE browser getting scrollhandler
                            //back too early and causing infinite loop issues
                            //where scroll would bounce back and forth between
                            //two items
                            setTimeout(function () {
                                inner.onscroll = scrollHandler;
                            }, 16);
                        }, inner, selected);
                    });
                }, 180);

                // inner.ontouchmove =
                var iOS = ( navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? true : false );
                if(iOS){
                    inner.ontouchmove = _.debounce(function ( evt ) {
                        wait_for_settle(inner, function ( ) {
                            selected = parseInt((inner.scrollTop +
                                settings.element.space / 2) /
                                settings.element.space, 10);
                            finalize(function () {}, inner, selected);
                        });
                    }, 180);
                } else {
                    inner.onscroll = scrollHandler;
                }

            });
        },
        template: '\
<div class="bar"></div>\
<div class="inner">\
    <div class="top"></div>\
    <ul><!-- ko foreach: settings.data -->\
        <li data-bind="text:$data.name||$data"></li>\
    <!-- /ko --></ul>\
    <div class="bot"></div>\
</div>\
<style></style>'
    });

});

/*!
 * Chart.js
 * http://chartjs.org/
 *
 * Copyright 2014 Nick Downie
 * Released under the MIT license
 * https://github.com/nnnick/Chart.js/blob/master/LICENSE.md
 */
(function(){var t=this,i=t.Chart,e=function(t){this.canvas=t.canvas,this.ctx=t;this.width=t.canvas.width,this.height=t.canvas.height;return this.aspectRatio=this.width/this.height,s.retinaScale(this),this};e.defaults={global:{animation:!0,animationSteps:60,animationEasing:"easeOutQuart",showScale:!0,scaleOverride:!1,scaleSteps:null,scaleStepWidth:null,scaleStartValue:null,scaleLineColor:"rgba(0,0,0,.1)",scaleLineWidth:1,scaleShowLabels:!0,scaleLabel:"<%=value%>",scaleIntegersOnly:!0,scaleBeginAtZero:!1,scaleFontFamily:"'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",scaleFontSize:12,scaleFontStyle:"normal",scaleFontColor:"#666",responsive:!1,showTooltips:!0,tooltipEvents:["mousemove","touchstart","touchmove","mouseout"],tooltipFillColor:"rgba(0,0,0,0.8)",tooltipFontFamily:"'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",tooltipFontSize:14,tooltipFontStyle:"normal",tooltipFontColor:"#fff",tooltipTitleFontFamily:"'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",tooltipTitleFontSize:14,tooltipTitleFontStyle:"bold",tooltipTitleFontColor:"#fff",tooltipYPadding:6,tooltipXPadding:6,tooltipCaretSize:8,tooltipCornerRadius:6,tooltipXOffset:10,tooltipTemplate:"<%if (label){%><%=label%>: <%}%><%= value %>",multiTooltipTemplate:"<%= value %>",multiTooltipKeyBackground:"#fff",onAnimationProgress:function(){},onAnimationComplete:function(){}}},e.types={};var s=e.helpers={},n=s.each=function(t,i,e){var s=Array.prototype.slice.call(arguments,3);if(t)if(t.length===+t.length){var n;for(n=0;n<t.length;n++)i.apply(e,[t[n],n].concat(s))}else for(var o in t)i.apply(e,[t[o],o].concat(s))},o=s.clone=function(t){var i={};return n(t,function(e,s){t.hasOwnProperty(s)&&(i[s]=e)}),i},a=s.extend=function(t){return n(Array.prototype.slice.call(arguments,1),function(i){n(i,function(e,s){i.hasOwnProperty(s)&&(t[s]=e)})}),t},h=s.merge=function(){var t=Array.prototype.slice.call(arguments,0);return t.unshift({}),a.apply(null,t)},l=s.indexOf=function(t,i){if(Array.prototype.indexOf)return t.indexOf(i);for(var e=0;e<t.length;e++)if(t[e]===i)return e;return-1},r=s.inherits=function(t){var i=this,e=t&&t.hasOwnProperty("constructor")?t.constructor:function(){return i.apply(this,arguments)},s=function(){this.constructor=e};return s.prototype=i.prototype,e.prototype=new s,e.extend=r,t&&a(e.prototype,t),e.__super__=i.prototype,e},c=s.noop=function(){},u=s.uid=function(){var t=0;return function(){return"chart-"+t++}}(),d=s.warn=function(t){window.console&&"function"==typeof window.console.warn&&console.warn(t)},p=s.amd="function"==typeof t.define&&t.define.amd,f=s.isNumber=function(t){return!isNaN(parseFloat(t))&&isFinite(t)},g=s.max=function(t){return Math.max.apply(Math,t)},m=s.min=function(t){return Math.min.apply(Math,t)},v=(s.cap=function(t,i,e){if(f(i)){if(t>i)return i}else if(f(e)&&e>t)return e;return t},s.getDecimalPlaces=function(t){return t%1!==0&&f(t)?t.toString().split(".")[1].length:0}),S=s.radians=function(t){return t*(Math.PI/180)},x=(s.getAngleFromPoint=function(t,i){var e=i.x-t.x,s=i.y-t.y,n=Math.sqrt(e*e+s*s),o=2*Math.PI+Math.atan2(s,e);return 0>e&&0>s&&(o+=2*Math.PI),{angle:o,distance:n}},s.aliasPixel=function(t){return t%2===0?0:.5}),C=(s.splineCurve=function(t,i,e,s){var n=Math.sqrt(Math.pow(i.x-t.x,2)+Math.pow(i.y-t.y,2)),o=Math.sqrt(Math.pow(e.x-i.x,2)+Math.pow(e.y-i.y,2)),a=s*n/(n+o),h=s*o/(n+o);return{inner:{x:i.x-a*(e.x-t.x),y:i.y-a*(e.y-t.y)},outer:{x:i.x+h*(e.x-t.x),y:i.y+h*(e.y-t.y)}}},s.calculateOrderOfMagnitude=function(t){return Math.floor(Math.log(t)/Math.LN10)}),y=(s.calculateScaleRange=function(t,i,e,s,n){var o=2,a=Math.floor(i/(1.5*e)),h=o>=a,l=g(t),r=m(t);l===r&&(l+=.5,r>=.5&&!s?r-=.5:l+=.5);for(var c=Math.abs(l-r),u=C(c),d=Math.ceil(l/(1*Math.pow(10,u)))*Math.pow(10,u),p=s?0:Math.floor(r/(1*Math.pow(10,u)))*Math.pow(10,u),f=d-p,v=Math.pow(10,u),S=Math.round(f/v);(S>a||a>2*S)&&!h;)if(S>a)v*=2,S=Math.round(f/v),S%1!==0&&(h=!0);else if(n&&u>=0){if(v/2%1!==0)break;v/=2,S=Math.round(f/v)}else v/=2,S=Math.round(f/v);return h&&(S=o,v=f/S),{steps:S,stepValue:v,min:p,max:p+S*v}},s.template=function(t,i){function e(t,i){var e=/\W/.test(t)?new Function("obj","var p=[],print=function(){p.push.apply(p,arguments);};with(obj){p.push('"+t.replace(/[\r\t\n]/g," ").split("<%").join("	").replace(/((^|%>)[^\t]*)'/g,"$1\r").replace(/\t=(.*?)%>/g,"',$1,'").split("	").join("');").split("%>").join("p.push('").split("\r").join("\\'")+"');}return p.join('');"):s[t]=s[t];return i?e(i):e}var s={};return e(t,i)}),b=(s.generateLabels=function(t,i,e,s){var o=new Array(i);return labelTemplateString&&n(o,function(i,n){o[n]=y(t,{value:e+s*(n+1)})}),o},s.easingEffects={linear:function(t){return t},easeInQuad:function(t){return t*t},easeOutQuad:function(t){return-1*t*(t-2)},easeInOutQuad:function(t){return(t/=.5)<1?.5*t*t:-0.5*(--t*(t-2)-1)},easeInCubic:function(t){return t*t*t},easeOutCubic:function(t){return 1*((t=t/1-1)*t*t+1)},easeInOutCubic:function(t){return(t/=.5)<1?.5*t*t*t:.5*((t-=2)*t*t+2)},easeInQuart:function(t){return t*t*t*t},easeOutQuart:function(t){return-1*((t=t/1-1)*t*t*t-1)},easeInOutQuart:function(t){return(t/=.5)<1?.5*t*t*t*t:-0.5*((t-=2)*t*t*t-2)},easeInQuint:function(t){return 1*(t/=1)*t*t*t*t},easeOutQuint:function(t){return 1*((t=t/1-1)*t*t*t*t+1)},easeInOutQuint:function(t){return(t/=.5)<1?.5*t*t*t*t*t:.5*((t-=2)*t*t*t*t+2)},easeInSine:function(t){return-1*Math.cos(t/1*(Math.PI/2))+1},easeOutSine:function(t){return 1*Math.sin(t/1*(Math.PI/2))},easeInOutSine:function(t){return-0.5*(Math.cos(Math.PI*t/1)-1)},easeInExpo:function(t){return 0===t?1:1*Math.pow(2,10*(t/1-1))},easeOutExpo:function(t){return 1===t?1:1*(-Math.pow(2,-10*t/1)+1)},easeInOutExpo:function(t){return 0===t?0:1===t?1:(t/=.5)<1?.5*Math.pow(2,10*(t-1)):.5*(-Math.pow(2,-10*--t)+2)},easeInCirc:function(t){return t>=1?t:-1*(Math.sqrt(1-(t/=1)*t)-1)},easeOutCirc:function(t){return 1*Math.sqrt(1-(t=t/1-1)*t)},easeInOutCirc:function(t){return(t/=.5)<1?-0.5*(Math.sqrt(1-t*t)-1):.5*(Math.sqrt(1-(t-=2)*t)+1)},easeInElastic:function(t){var i=1.70158,e=0,s=1;return 0===t?0:1==(t/=1)?1:(e||(e=.3),s<Math.abs(1)?(s=1,i=e/4):i=e/(2*Math.PI)*Math.asin(1/s),-(s*Math.pow(2,10*(t-=1))*Math.sin(2*(1*t-i)*Math.PI/e)))},easeOutElastic:function(t){var i=1.70158,e=0,s=1;return 0===t?0:1==(t/=1)?1:(e||(e=.3),s<Math.abs(1)?(s=1,i=e/4):i=e/(2*Math.PI)*Math.asin(1/s),s*Math.pow(2,-10*t)*Math.sin(2*(1*t-i)*Math.PI/e)+1)},easeInOutElastic:function(t){var i=1.70158,e=0,s=1;return 0===t?0:2==(t/=.5)?1:(e||(e=.3*1.5),s<Math.abs(1)?(s=1,i=e/4):i=e/(2*Math.PI)*Math.asin(1/s),1>t?-.5*s*Math.pow(2,10*(t-=1))*Math.sin(2*(1*t-i)*Math.PI/e):s*Math.pow(2,-10*(t-=1))*Math.sin(2*(1*t-i)*Math.PI/e)*.5+1)},easeInBack:function(t){var i=1.70158;return 1*(t/=1)*t*((i+1)*t-i)},easeOutBack:function(t){var i=1.70158;return 1*((t=t/1-1)*t*((i+1)*t+i)+1)},easeInOutBack:function(t){var i=1.70158;return(t/=.5)<1?.5*t*t*(((i*=1.525)+1)*t-i):.5*((t-=2)*t*(((i*=1.525)+1)*t+i)+2)},easeInBounce:function(t){return 1-b.easeOutBounce(1-t)},easeOutBounce:function(t){return(t/=1)<1/2.75?7.5625*t*t:2/2.75>t?1*(7.5625*(t-=1.5/2.75)*t+.75):2.5/2.75>t?1*(7.5625*(t-=2.25/2.75)*t+.9375):1*(7.5625*(t-=2.625/2.75)*t+.984375)},easeInOutBounce:function(t){return.5>t?.5*b.easeInBounce(2*t):.5*b.easeOutBounce(2*t-1)+.5}}),w=s.requestAnimFrame=function(){return window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.oRequestAnimationFrame||window.msRequestAnimationFrame||function(t){return window.setTimeout(t,1e3/60)}}(),P=(s.cancelAnimFrame=function(){return window.cancelAnimationFrame||window.webkitCancelAnimationFrame||window.mozCancelAnimationFrame||window.oCancelAnimationFrame||window.msCancelAnimationFrame||function(t){return window.clearTimeout(t,1e3/60)}}(),s.animationLoop=function(t,i,e,s,n,o){var a=0,h=b[e]||b.linear,l=function(){a++;var e=a/i,r=h(e);t.call(o,r,e,a),s.call(o,r,e),i>a?o.animationFrame=w(l):n.apply(o)};w(l)},s.getRelativePosition=function(t){var i,e,s=t.originalEvent||t,n=t.currentTarget||t.srcElement,o=n.getBoundingClientRect();return s.touches?(i=s.touches[0].clientX-o.left,e=s.touches[0].clientY-o.top):(i=s.clientX-o.left,e=s.clientY-o.top),{x:i,y:e}},s.addEvent=function(t,i,e){t.addEventListener?t.addEventListener(i,e):t.attachEvent?t.attachEvent("on"+i,e):t["on"+i]=e}),L=s.removeEvent=function(t,i,e){t.removeEventListener?t.removeEventListener(i,e,!1):t.detachEvent?t.detachEvent("on"+i,e):t["on"+i]=c},k=(s.bindEvents=function(t,i,e){t.events||(t.events={}),n(i,function(i){t.events[i]=function(){e.apply(t,arguments)},P(t.chart.canvas,i,t.events[i])})},s.unbindEvents=function(t,i){n(i,function(i,e){L(t.chart.canvas,e,i)})}),F=s.getMaximumSize=function(t){var i=t.parentNode;return i.clientWidth},R=s.retinaScale=function(t){var i=t.ctx,e=t.canvas.width,s=t.canvas.height;window.devicePixelRatio&&(i.canvas.style.width=e+"px",i.canvas.style.height=s+"px",i.canvas.height=s*window.devicePixelRatio,i.canvas.width=e*window.devicePixelRatio,i.scale(window.devicePixelRatio,window.devicePixelRatio))},A=s.clear=function(t){t.ctx.clearRect(0,0,t.width,t.height)},T=s.fontString=function(t,i,e){return i+" "+t+"px "+e},M=s.longestText=function(t,i,e){t.font=i;var s=0;return n(e,function(i){var e=t.measureText(i).width;s=e>s?e:s}),s},W=s.drawRoundedRectangle=function(t,i,e,s,n,o){t.beginPath(),t.moveTo(i+o,e),t.lineTo(i+s-o,e),t.quadraticCurveTo(i+s,e,i+s,e+o),t.lineTo(i+s,e+n-o),t.quadraticCurveTo(i+s,e+n,i+s-o,e+n),t.lineTo(i+o,e+n),t.quadraticCurveTo(i,e+n,i,e+n-o),t.lineTo(i,e+o),t.quadraticCurveTo(i,e,i+o,e),t.closePath()};e.instances={},e.Type=function(t,i,s){this.options=i,this.chart=s,this.id=u(),e.instances[this.id]=this,i.responsive&&this.resize(),this.initialize.call(this,t)},a(e.Type.prototype,{initialize:function(){return this},clear:function(){return A(this.chart),this},stop:function(){return s.cancelAnimFrame.call(t,this.animationFrame),this},resize:function(t){this.stop();var i=this.chart.canvas,e=F(this.chart.canvas),s=e/this.chart.aspectRatio;return i.width=this.chart.width=e,i.height=this.chart.height=s,R(this.chart),"function"==typeof t&&t.apply(this,Array.prototype.slice.call(arguments,1)),this},reflow:c,render:function(t){return t&&this.reflow(),this.options.animation&&!t?s.animationLoop(this.draw,this.options.animationSteps,this.options.animationEasing,this.options.onAnimationProgress,this.options.onAnimationComplete,this):(this.draw(),this.options.onAnimationComplete.call(this)),this},generateLegend:function(){return y(this.options.legendTemplate,this)},destroy:function(){this.clear(),k(this,this.events),delete e.instances[this.id]},showTooltip:function(t,i){"undefined"==typeof this.activeElements&&(this.activeElements=[]);var o=function(t){var i=!1;return t.length!==this.activeElements.length?i=!0:(n(t,function(t,e){t!==this.activeElements[e]&&(i=!0)},this),i)}.call(this,t);if(o||i){if(this.activeElements=t,this.draw(),t.length>0)if(this.datasets&&this.datasets.length>1){for(var a,h,r=this.datasets.length-1;r>=0&&(a=this.datasets[r].points||this.datasets[r].bars||this.datasets[r].segments,h=l(a,t[0]),-1===h);r--);var c=[],u=[],d=function(){var t,i,e,n,o,a=[],l=[],r=[];return s.each(this.datasets,function(i){t=i.points||i.bars||i.segments,a.push(t[h])}),s.each(a,function(t){l.push(t.x),r.push(t.y),c.push(s.template(this.options.multiTooltipTemplate,t)),u.push({fill:t._saved.fillColor||t.fillColor,stroke:t._saved.strokeColor||t.strokeColor})},this),o=m(r),e=g(r),n=m(l),i=g(l),{x:n>this.chart.width/2?n:i,y:(o+e)/2}}.call(this,h);new e.MultiTooltip({x:d.x,y:d.y,xPadding:this.options.tooltipXPadding,yPadding:this.options.tooltipYPadding,xOffset:this.options.tooltipXOffset,fillColor:this.options.tooltipFillColor,textColor:this.options.tooltipFontColor,fontFamily:this.options.tooltipFontFamily,fontStyle:this.options.tooltipFontStyle,fontSize:this.options.tooltipFontSize,titleTextColor:this.options.tooltipTitleFontColor,titleFontFamily:this.options.tooltipTitleFontFamily,titleFontStyle:this.options.tooltipTitleFontStyle,titleFontSize:this.options.tooltipTitleFontSize,cornerRadius:this.options.tooltipCornerRadius,labels:c,legendColors:u,legendColorBackground:this.options.multiTooltipKeyBackground,title:t[0].label,chart:this.chart,ctx:this.chart.ctx}).draw()}else n(t,function(t){var i=t.tooltipPosition();new e.Tooltip({x:Math.round(i.x),y:Math.round(i.y),xPadding:this.options.tooltipXPadding,yPadding:this.options.tooltipYPadding,fillColor:this.options.tooltipFillColor,textColor:this.options.tooltipFontColor,fontFamily:this.options.tooltipFontFamily,fontStyle:this.options.tooltipFontStyle,fontSize:this.options.tooltipFontSize,caretHeight:this.options.tooltipCaretSize,cornerRadius:this.options.tooltipCornerRadius,text:y(this.options.tooltipTemplate,t),chart:this.chart}).draw()},this);return this}},toBase64Image:function(){return this.chart.canvas.toDataURL.apply(this.chart.canvas,arguments)}}),e.Type.extend=function(t){var i=this,s=function(){return i.apply(this,arguments)};if(s.prototype=o(i.prototype),a(s.prototype,t),s.extend=e.Type.extend,t.name||i.prototype.name){var n=t.name||i.prototype.name,l=e.defaults[i.prototype.name]?o(e.defaults[i.prototype.name]):{};e.defaults[n]=a(l,t.defaults),e.types[n]=s,e.prototype[n]=function(t,i){var o=h(e.defaults.global,e.defaults[n],i||{});return new s(t,o,this)}}else d("Name not provided for this chart, so it hasn't been registered");return i},e.Element=function(t){a(this,t),this.initialize.apply(this,arguments),this.save()},a(e.Element.prototype,{initialize:function(){},restore:function(t){return t?n(t,function(t){this[t]=this._saved[t]},this):a(this,this._saved),this},save:function(){return this._saved=o(this),delete this._saved._saved,this},update:function(t){return n(t,function(t,i){this._saved[i]=this[i],this[i]=t},this),this},transition:function(t,i){return n(t,function(t,e){this[e]=(t-this._saved[e])*i+this._saved[e]},this),this},tooltipPosition:function(){return{x:this.x,y:this.y}}}),e.Element.extend=r,e.Point=e.Element.extend({inRange:function(t,i){var e=this.hitDetectionRadius+this.radius;return Math.pow(t-this.x,2)+Math.pow(i-this.y,2)<Math.pow(e,2)},draw:function(){var t=this.ctx;t.beginPath(),t.arc(this.x,this.y,this.radius,0,2*Math.PI),t.closePath(),t.strokeStyle=this.strokeColor,t.lineWidth=this.strokeWidth,t.fillStyle=this.fillColor,t.fill(),t.stroke()}}),e.Arc=e.Element.extend({inRange:function(t,i){var e=s.getAngleFromPoint(this,{x:t,y:i}),n=e.angle>=this.startAngle&&e.angle<=this.endAngle,o=e.distance>=this.innerRadius&&e.distance<=this.outerRadius;return n&&o},tooltipPosition:function(){var t=this.startAngle+(this.endAngle-this.startAngle)/2,i=(this.outerRadius-this.innerRadius)/2+this.innerRadius;return{x:this.x+Math.cos(t)*i,y:this.y+Math.sin(t)*i}},draw:function(t){var i=this.ctx;i.beginPath(),i.arc(this.x,this.y,this.outerRadius,this.startAngle,this.endAngle),i.arc(this.x,this.y,this.innerRadius,this.endAngle,this.startAngle,!0),i.closePath(),i.strokeStyle=this.strokeColor,i.lineWidth=this.strokeWidth,i.fillStyle=this.fillColor,i.fill(),i.lineJoin="bevel",this.showStroke&&i.stroke()}}),e.Rectangle=e.Element.extend({draw:function(){var t=this.ctx,i=this.width/2,e=this.x-i,s=this.x+i,n=this.base-(this.base-this.y),o=this.strokeWidth/2;this.showStroke&&(e+=o,s-=o,n+=o),t.beginPath(),t.fillStyle=this.fillColor,t.strokeStyle=this.strokeColor,t.lineWidth=this.strokeWidth,t.moveTo(e,this.base),t.lineTo(e,n),t.lineTo(s,n),t.lineTo(s,this.base),t.fill(),this.showStroke&&t.stroke()},height:function(){return this.base-this.y},inRange:function(t,i){return t>=this.x-this.width/2&&t<=this.x+this.width/2&&i>=this.y&&i<=this.base}}),e.Tooltip=e.Element.extend({draw:function(){var t=this.chart.ctx;t.font=T(this.fontSize,this.fontStyle,this.fontFamily),this.xAlign="center",this.yAlign="above";var i=2,e=t.measureText(this.text).width+2*this.xPadding,s=this.fontSize+2*this.yPadding,n=s+this.caretHeight+i;this.x+e/2>this.chart.width?this.xAlign="left":this.x-e/2<0&&(this.xAlign="right"),this.y-n<0&&(this.yAlign="below");var o=this.x-e/2,a=this.y-n;switch(t.fillStyle=this.fillColor,this.yAlign){case"above":t.beginPath(),t.moveTo(this.x,this.y-i),t.lineTo(this.x+this.caretHeight,this.y-(i+this.caretHeight)),t.lineTo(this.x-this.caretHeight,this.y-(i+this.caretHeight)),t.closePath(),t.fill();break;case"below":a=this.y+i+this.caretHeight,t.beginPath(),t.moveTo(this.x,this.y+i),t.lineTo(this.x+this.caretHeight,this.y+i+this.caretHeight),t.lineTo(this.x-this.caretHeight,this.y+i+this.caretHeight),t.closePath(),t.fill()}switch(this.xAlign){case"left":o=this.x-e+(this.cornerRadius+this.caretHeight);break;case"right":o=this.x-(this.cornerRadius+this.caretHeight)}W(t,o,a,e,s,this.cornerRadius),t.fill(),t.fillStyle=this.textColor,t.textAlign="center",t.textBaseline="middle",t.fillText(this.text,o+e/2,a+s/2)}}),e.MultiTooltip=e.Element.extend({initialize:function(){this.font=T(this.fontSize,this.fontStyle,this.fontFamily),this.titleFont=T(this.titleFontSize,this.titleFontStyle,this.titleFontFamily),this.height=this.labels.length*this.fontSize+(this.labels.length-1)*(this.fontSize/2)+2*this.yPadding+1.5*this.titleFontSize,this.ctx.font=this.titleFont;var t=this.ctx.measureText(this.title).width,i=M(this.ctx,this.font,this.labels)+this.fontSize+3,e=g([i,t]);this.width=e+2*this.xPadding;var s=this.height/2;this.y-s<0?this.y=s:this.y+s>this.chart.height&&(this.y=this.chart.height-s),this.x>this.chart.width/2?this.x-=this.xOffset+this.width:this.x+=this.xOffset},getLineHeight:function(t){var i=this.y-this.height/2+this.yPadding,e=t-1;return 0===t?i+this.titleFontSize/2:i+(1.5*this.fontSize*e+this.fontSize/2)+1.5*this.titleFontSize},draw:function(){W(this.ctx,this.x,this.y-this.height/2,this.width,this.height,this.cornerRadius);var t=this.ctx;t.fillStyle=this.fillColor,t.fill(),t.closePath(),t.textAlign="left",t.textBaseline="middle",t.fillStyle=this.titleTextColor,t.font=this.titleFont,t.fillText(this.title,this.x+this.xPadding,this.getLineHeight(0)),t.font=this.font,s.each(this.labels,function(i,e){t.fillStyle=this.textColor,t.fillText(i,this.x+this.xPadding+this.fontSize+3,this.getLineHeight(e+1)),t.fillStyle=this.legendColorBackground,t.fillRect(this.x+this.xPadding,this.getLineHeight(e+1)-this.fontSize/2,this.fontSize,this.fontSize),t.fillStyle=this.legendColors[e].fill,t.fillRect(this.x+this.xPadding,this.getLineHeight(e+1)-this.fontSize/2,this.fontSize,this.fontSize)},this)}}),e.Scale=e.Element.extend({initialize:function(){this.fit()},buildYLabels:function(){this.yLabels=[];for(var t=v(this.stepValue),i=0;i<=this.steps;i++)this.yLabels.push(y(this.templateString,{value:(this.min+i*this.stepValue).toFixed(t)}));this.yLabelWidth=this.display&&this.showLabels?M(this.ctx,this.font,this.yLabels):0},addXLabel:function(t){this.xLabels.push(t),this.valuesCount++,this.fit()},removeXLabel:function(){this.xLabels.shift(),this.valuesCount--,this.fit()},fit:function(){this.startPoint=this.display?this.fontSize:0,this.endPoint=this.display?this.height-1.5*this.fontSize-5:this.height,this.startPoint+=this.padding,this.endPoint-=this.padding;var t,i=this.endPoint-this.startPoint;for(this.calculateYRange(i),this.buildYLabels(),this.calculateXLabelRotation();i>this.endPoint-this.startPoint;)i=this.endPoint-this.startPoint,t=this.yLabelWidth,this.calculateYRange(i),this.buildYLabels(),t<this.yLabelWidth&&this.calculateXLabelRotation()},calculateXLabelRotation:function(){this.ctx.font=this.font;var t,i,e=this.ctx.measureText(this.xLabels[0]).width,s=this.ctx.measureText(this.xLabels[this.xLabels.length-1]).width;if(this.xScalePaddingRight=s/2+3,this.xScalePaddingLeft=e/2>this.yLabelWidth+10?e/2:this.yLabelWidth+10,this.xLabelRotation=0,this.display){var n,o=M(this.ctx,this.font,this.xLabels);this.xLabelWidth=o;for(var a=Math.floor(this.calculateX(1)-this.calculateX(0))-6;this.xLabelWidth>a&&0===this.xLabelRotation||this.xLabelWidth>a&&this.xLabelRotation<=90&&this.xLabelRotation>0;)n=Math.cos(S(this.xLabelRotation)),t=n*e,i=n*s,t+this.fontSize/2>this.yLabelWidth+8&&(this.xScalePaddingLeft=t+this.fontSize/2),this.xScalePaddingRight=this.fontSize/2,this.xLabelRotation++,this.xLabelWidth=n*o;this.xLabelRotation>0&&(this.endPoint-=Math.sin(S(this.xLabelRotation))*o+3)}else this.xLabelWidth=0,this.xScalePaddingRight=this.padding,this.xScalePaddingLeft=this.padding},calculateYRange:c,drawingArea:function(){return this.startPoint-this.endPoint},calculateY:function(t){var i=this.drawingArea()/(this.min-this.max);return this.endPoint-i*(t-this.min)},calculateX:function(t){var i=(this.xLabelRotation>0,this.width-(this.xScalePaddingLeft+this.xScalePaddingRight)),e=i/(this.valuesCount-(this.offsetGridLines?0:1)),s=e*t+this.xScalePaddingLeft;return this.offsetGridLines&&(s+=e/2),Math.round(s)},update:function(t){s.extend(this,t),this.fit()},draw:function(){var t=this.ctx,i=(this.endPoint-this.startPoint)/this.steps,e=Math.round(this.xScalePaddingLeft);this.display&&(t.fillStyle=this.textColor,t.font=this.font,n(this.yLabels,function(n,o){var a=this.endPoint-i*o,h=Math.round(a);t.textAlign="right",t.textBaseline="middle",this.showLabels&&t.fillText(n,e-10,a),t.beginPath(),o>0?(t.lineWidth=this.gridLineWidth,t.strokeStyle=this.gridLineColor):(t.lineWidth=this.lineWidth,t.strokeStyle=this.lineColor),h+=s.aliasPixel(t.lineWidth),t.moveTo(e,h),t.lineTo(this.width,h),t.stroke(),t.closePath(),t.lineWidth=this.lineWidth,t.strokeStyle=this.lineColor,t.beginPath(),t.moveTo(e-5,h),t.lineTo(e,h),t.stroke(),t.closePath()},this),n(this.xLabels,function(i,e){var s=this.calculateX(e)+x(this.lineWidth),n=this.calculateX(e-(this.offsetGridLines?.5:0))+x(this.lineWidth),o=this.xLabelRotation>0;t.beginPath(),e>0?(t.lineWidth=this.gridLineWidth,t.strokeStyle=this.gridLineColor):(t.lineWidth=this.lineWidth,t.strokeStyle=this.lineColor),t.moveTo(n,this.endPoint),t.lineTo(n,this.startPoint-3),t.stroke(),t.closePath(),t.lineWidth=this.lineWidth,t.strokeStyle=this.lineColor,t.beginPath(),t.moveTo(n,this.endPoint),t.lineTo(n,this.endPoint+5),t.stroke(),t.closePath(),t.save(),t.translate(s,o?this.endPoint+12:this.endPoint+8),t.rotate(-1*S(this.xLabelRotation)),t.font=this.font,t.textAlign=o?"right":"center",t.textBaseline=o?"middle":"top",t.fillText(i,0,0),t.restore()},this))}}),e.RadialScale=e.Element.extend({initialize:function(){this.size=m([this.height,this.width]),this.drawingArea=this.display?this.size/2-(this.fontSize/2+this.backdropPaddingY):this.size/2},calculateCenterOffset:function(t){var i=this.drawingArea/(this.max-this.min);return(t-this.min)*i},update:function(){this.lineArc?this.drawingArea=this.display?this.size/2-(this.fontSize/2+this.backdropPaddingY):this.size/2:this.setScaleSize(),this.buildYLabels()},buildYLabels:function(){this.yLabels=[];for(var t=v(this.stepValue),i=0;i<=this.steps;i++)this.yLabels.push(y(this.templateString,{value:(this.min+i*this.stepValue).toFixed(t)}))},getCircumference:function(){return 2*Math.PI/this.valuesCount},setScaleSize:function(){var t,i,e,s,n,o,a,h,l,r,c,u,d=m([this.height/2-this.pointLabelFontSize-5,this.width/2]),p=this.width,g=0;for(this.ctx.font=T(this.pointLabelFontSize,this.pointLabelFontStyle,this.pointLabelFontFamily),i=0;i<this.valuesCount;i++)t=this.getPointPosition(i,d),e=this.ctx.measureText(y(this.templateString,{value:this.labels[i]})).width+5,0===i||i===this.valuesCount/2?(s=e/2,t.x+s>p&&(p=t.x+s,n=i),t.x-s<g&&(g=t.x-s,a=i)):i<this.valuesCount/2?t.x+e>p&&(p=t.x+e,n=i):i>this.valuesCount/2&&t.x-e<g&&(g=t.x-e,a=i);l=g,r=Math.ceil(p-this.width),o=this.getIndexAngle(n),h=this.getIndexAngle(a),c=r/Math.sin(o+Math.PI/2),u=l/Math.sin(h+Math.PI/2),c=f(c)?c:0,u=f(u)?u:0,this.drawingArea=d-(u+c)/2,this.setCenterPoint(u,c)},setCenterPoint:function(t,i){var e=this.width-i-this.drawingArea,s=t+this.drawingArea;this.xCenter=(s+e)/2,this.yCenter=this.height/2},getIndexAngle:function(t){var i=2*Math.PI/this.valuesCount;return t*i-Math.PI/2},getPointPosition:function(t,i){var e=this.getIndexAngle(t);return{x:Math.cos(e)*i+this.xCenter,y:Math.sin(e)*i+this.yCenter}},draw:function(){if(this.display){var t=this.ctx;if(n(this.yLabels,function(i,e){if(e>0){var s,n=e*(this.drawingArea/this.steps),o=this.yCenter-n;if(this.lineWidth>0)if(t.strokeStyle=this.lineColor,t.lineWidth=this.lineWidth,this.lineArc)t.beginPath(),t.arc(this.xCenter,this.yCenter,n,0,2*Math.PI),t.closePath(),t.stroke();else{t.beginPath();for(var a=0;a<this.valuesCount;a++)s=this.getPointPosition(a,this.calculateCenterOffset(this.min+e*this.stepValue)),0===a?t.moveTo(s.x,s.y):t.lineTo(s.x,s.y);t.closePath(),t.stroke()}if(this.showLabels){if(t.font=T(this.fontSize,this.fontStyle,this.fontFamily),this.showLabelBackdrop){var h=t.measureText(i).width;t.fillStyle=this.backdropColor,t.fillRect(this.xCenter-h/2-this.backdropPaddingX,o-this.fontSize/2-this.backdropPaddingY,h+2*this.backdropPaddingX,this.fontSize+2*this.backdropPaddingY)}t.textAlign="center",t.textBaseline="middle",t.fillStyle=this.fontColor,t.fillText(i,this.xCenter,o)}}},this),!this.lineArc){t.lineWidth=this.angleLineWidth,t.strokeStyle=this.angleLineColor;for(var i=this.valuesCount-1;i>=0;i--){if(this.angleLineWidth>0){var e=this.getPointPosition(i,this.calculateCenterOffset(this.max));t.beginPath(),t.moveTo(this.xCenter,this.yCenter),t.lineTo(e.x,e.y),t.stroke(),t.closePath()}var s=this.getPointPosition(i,this.calculateCenterOffset(this.max)+5);t.font=T(this.pointLabelFontSize,this.pointLabelFontStyle,this.pointLabelFontFamily),t.fillStyle=this.pointLabelFontColor;var o=this.labels.length,a=this.labels.length/2,h=a/2,l=h>i||i>o-h,r=i===h||i===o-h;t.textAlign=0===i?"center":i===a?"center":a>i?"left":"right",t.textBaseline=r?"middle":l?"bottom":"top",t.fillText(this.labels[i],s.x,s.y)}}}}}),s.addEvent(window,"resize",function(){var t;return function(){clearTimeout(t),t=setTimeout(function(){n(e.instances,function(t){t.options.responsive&&t.resize(t.render,!0)})},50)}}()),p&&define('Chart',[],function(){return e}),t.Chart=e,e.noConflict=function(){return t.Chart=i,e}}).call(this),function(){var t=this,i=t.Chart,e=i.helpers,s={scaleBeginAtZero:!0,scaleShowGridLines:!0,scaleGridLineColor:"rgba(0,0,0,.05)",scaleGridLineWidth:1,barShowStroke:!0,barStrokeWidth:2,barValueSpacing:5,barDatasetSpacing:1,legendTemplate:'<ul class="<%=name.toLowerCase()%>-legend"><% for (var i=0; i<datasets.length; i++){%><li><span style="background-color:<%=datasets[i].fillColor%>"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>'};i.Type.extend({name:"Bar",defaults:s,initialize:function(t){var s=this.options;this.ScaleClass=i.Scale.extend({offsetGridLines:!0,calculateBarX:function(t,i,e){var n=this.calculateBaseWidth(),o=this.calculateX(e)-n/2,a=this.calculateBarWidth(t);return o+a*i+i*s.barDatasetSpacing+a/2},calculateBaseWidth:function(){return this.calculateX(1)-this.calculateX(0)-2*s.barValueSpacing},calculateBarWidth:function(t){var i=this.calculateBaseWidth()-(t-1)*s.barDatasetSpacing;return i/t}}),this.datasets=[],this.options.showTooltips&&e.bindEvents(this,this.options.tooltipEvents,function(t){var i="mouseout"!==t.type?this.getBarsAtEvent(t):[];this.eachBars(function(t){t.restore(["fillColor","strokeColor"])}),e.each(i,function(t){t.fillColor=t.highlightFill,t.strokeColor=t.highlightStroke}),this.showTooltip(i)}),this.BarClass=i.Rectangle.extend({strokeWidth:this.options.barStrokeWidth,showStroke:this.options.barShowStroke,ctx:this.chart.ctx}),e.each(t.datasets,function(i){var s={label:i.label||null,fillColor:i.fillColor,strokeColor:i.strokeColor,bars:[]};this.datasets.push(s),e.each(i.data,function(n,o){e.isNumber(n)&&s.bars.push(new this.BarClass({value:n,label:t.labels[o],strokeColor:i.strokeColor,fillColor:i.fillColor,highlightFill:i.highlightFill||i.fillColor,highlightStroke:i.highlightStroke||i.strokeColor}))},this)},this),this.buildScale(t.labels),this.BarClass.prototype.base=this.scale.endPoint,this.eachBars(function(t,i,s){e.extend(t,{width:this.scale.calculateBarWidth(this.datasets.length),x:this.scale.calculateBarX(this.datasets.length,s,i),y:this.scale.endPoint}),t.save()},this),this.render()},update:function(){this.scale.update(),e.each(this.activeElements,function(t){t.restore(["fillColor","strokeColor"])}),this.eachBars(function(t){t.save()}),this.render()},eachBars:function(t){e.each(this.datasets,function(i,s){e.each(i.bars,t,this,s)},this)},getBarsAtEvent:function(t){for(var i,s=[],n=e.getRelativePosition(t),o=function(t){s.push(t.bars[i])},a=0;a<this.datasets.length;a++)for(i=0;i<this.datasets[a].bars.length;i++)if(this.datasets[a].bars[i].inRange(n.x,n.y))return e.each(this.datasets,o),s;return s},buildScale:function(t){var i=this,s=function(){var t=[];return i.eachBars(function(i){t.push(i.value)}),t},n={templateString:this.options.scaleLabel,height:this.chart.height,width:this.chart.width,ctx:this.chart.ctx,textColor:this.options.scaleFontColor,fontSize:this.options.scaleFontSize,fontStyle:this.options.scaleFontStyle,fontFamily:this.options.scaleFontFamily,valuesCount:t.length,beginAtZero:this.options.scaleBeginAtZero,integersOnly:this.options.scaleIntegersOnly,calculateYRange:function(t){var i=e.calculateScaleRange(s(),t,this.fontSize,this.beginAtZero,this.integersOnly);e.extend(this,i)},xLabels:t,font:e.fontString(this.options.scaleFontSize,this.options.scaleFontStyle,this.options.scaleFontFamily),lineWidth:this.options.scaleLineWidth,lineColor:this.options.scaleLineColor,gridLineWidth:this.options.scaleShowGridLines?this.options.scaleGridLineWidth:0,gridLineColor:this.options.scaleShowGridLines?this.options.scaleGridLineColor:"rgba(0,0,0,0)",padding:this.options.showScale?0:this.options.barShowStroke?this.options.barStrokeWidth:0,showLabels:this.options.scaleShowLabels,display:this.options.showScale};this.options.scaleOverride&&e.extend(n,{calculateYRange:e.noop,steps:this.options.scaleSteps,stepValue:this.options.scaleStepWidth,min:this.options.scaleStartValue,max:this.options.scaleStartValue+this.options.scaleSteps*this.options.scaleStepWidth}),this.scale=new this.ScaleClass(n)},addData:function(t,i){e.each(t,function(t,s){e.isNumber(t)&&this.datasets[s].bars.push(new this.BarClass({value:t,label:i,x:this.scale.calculateBarX(this.datasets.length,s,this.scale.valuesCount+1),y:this.scale.endPoint,width:this.scale.calculateBarWidth(this.datasets.length),base:this.scale.endPoint,strokeColor:this.datasets[s].strokeColor,fillColor:this.datasets[s].fillColor}))},this),this.scale.addXLabel(i),this.update()},removeData:function(){this.scale.removeXLabel(),e.each(this.datasets,function(t){t.bars.shift()},this),this.update()},reflow:function(){e.extend(this.BarClass.prototype,{y:this.scale.endPoint,base:this.scale.endPoint});var t=e.extend({height:this.chart.height,width:this.chart.width});this.scale.update(t)},draw:function(t){var i=t||1;this.clear();this.chart.ctx;this.scale.draw(i),e.each(this.datasets,function(t,s){e.each(t.bars,function(t,e){t.base=this.scale.endPoint,t.transition({x:this.scale.calculateBarX(this.datasets.length,s,e),y:this.scale.calculateY(t.value),width:this.scale.calculateBarWidth(this.datasets.length)},i).draw()},this)},this)}})}.call(this),function(){var t=this,i=t.Chart,e=i.helpers,s={segmentShowStroke:!0,segmentStrokeColor:"#fff",segmentStrokeWidth:2,percentageInnerCutout:50,animationSteps:100,animationEasing:"easeOutBounce",animateRotate:!0,animateScale:!1,legendTemplate:'<ul class="<%=name.toLowerCase()%>-legend"><% for (var i=0; i<segments.length; i++){%><li><span style="background-color:<%=segments[i].fillColor%>"></span><%if(segments[i].label){%><%=segments[i].label%><%}%></li><%}%></ul>'};i.Type.extend({name:"Doughnut",defaults:s,initialize:function(t){this.segments=[],this.outerRadius=(e.min([this.chart.width,this.chart.height])-this.options.segmentStrokeWidth/2)/2,this.SegmentArc=i.Arc.extend({ctx:this.chart.ctx,x:this.chart.width/2,y:this.chart.height/2}),this.options.showTooltips&&e.bindEvents(this,this.options.tooltipEvents,function(t){var i="mouseout"!==t.type?this.getSegmentsAtEvent(t):[];
e.each(this.segments,function(t){t.restore(["fillColor"])}),e.each(i,function(t){t.fillColor=t.highlightColor}),this.showTooltip(i)}),this.calculateTotal(t),e.each(t,function(t,i){this.addData(t,i,!0)},this),this.render()},getSegmentsAtEvent:function(t){var i=[],s=e.getRelativePosition(t);return e.each(this.segments,function(t){t.inRange(s.x,s.y)&&i.push(t)},this),i},addData:function(t,i,e){var s=i||this.segments.length;this.segments.splice(s,0,new this.SegmentArc({value:t.value,outerRadius:this.options.animateScale?0:this.outerRadius,innerRadius:this.options.animateScale?0:this.outerRadius/100*this.options.percentageInnerCutout,fillColor:t.color,highlightColor:t.highlight||t.color,showStroke:this.options.segmentShowStroke,strokeWidth:this.options.segmentStrokeWidth,strokeColor:this.options.segmentStrokeColor,startAngle:1.5*Math.PI,circumference:this.options.animateRotate?0:this.calculateCircumference(t.value),label:t.label})),e||(this.reflow(),this.update())},calculateCircumference:function(t){return 2*Math.PI*(t/this.total)},calculateTotal:function(t){this.total=0,e.each(t,function(t){this.total+=t.value},this)},update:function(){this.calculateTotal(this.segments),e.each(this.activeElements,function(t){t.restore(["fillColor"])}),e.each(this.segments,function(t){t.save()}),this.render()},removeData:function(t){var i=e.isNumber(t)?t:this.segments.length-1;this.segments.splice(i,1),this.reflow(),this.update()},reflow:function(){e.extend(this.SegmentArc.prototype,{x:this.chart.width/2,y:this.chart.height/2}),this.outerRadius=(e.min([this.chart.width,this.chart.height])-this.options.segmentStrokeWidth/2)/2,e.each(this.segments,function(t){t.update({outerRadius:this.outerRadius,innerRadius:this.outerRadius/100*this.options.percentageInnerCutout})},this)},draw:function(t){var i=t?t:1;this.clear(),e.each(this.segments,function(t,e){t.transition({circumference:this.calculateCircumference(t.value),outerRadius:this.outerRadius,innerRadius:this.outerRadius/100*this.options.percentageInnerCutout},i),t.endAngle=t.startAngle+t.circumference,t.draw(),0===e&&(t.startAngle=1.5*Math.PI),e<this.segments.length-1&&(this.segments[e+1].startAngle=t.endAngle)},this)}}),i.types.Doughnut.extend({name:"Pie",defaults:e.merge(s,{percentageInnerCutout:0})})}.call(this),function(){var t=this,i=t.Chart,e=i.helpers,s={scaleShowGridLines:!0,scaleGridLineColor:"rgba(0,0,0,.05)",scaleGridLineWidth:1,bezierCurve:!0,bezierCurveTension:.4,pointDot:!0,pointDotRadius:4,pointDotStrokeWidth:1,pointHitDetectionRadius:20,datasetStroke:!0,datasetStrokeWidth:2,datasetFill:!0,legendTemplate:'<ul class="<%=name.toLowerCase()%>-legend"><% for (var i=0; i<datasets.length; i++){%><li><span style="background-color:<%=datasets[i].strokeColor%>"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>'};i.Type.extend({name:"Line",defaults:s,initialize:function(t){this.PointClass=i.Point.extend({strokeWidth:this.options.pointDotStrokeWidth,radius:this.options.pointDotRadius,hitDetectionRadius:this.options.pointHitDetectionRadius,ctx:this.chart.ctx,inRange:function(t){return Math.pow(t-this.x,2)<Math.pow(this.radius+this.hitDetectionRadius,2)}}),this.datasets=[],this.options.showTooltips&&e.bindEvents(this,this.options.tooltipEvents,function(t){var i="mouseout"!==t.type?this.getPointsAtEvent(t):[];this.eachPoints(function(t){t.restore(["fillColor","strokeColor"])}),e.each(i,function(t){t.fillColor=t.highlightFill,t.strokeColor=t.highlightStroke}),this.showTooltip(i)}),e.each(t.datasets,function(i){var s={label:i.label||null,fillColor:i.fillColor,strokeColor:i.strokeColor,pointColor:i.pointColor,pointStrokeColor:i.pointStrokeColor,points:[]};this.datasets.push(s),e.each(i.data,function(n,o){e.isNumber(n)&&s.points.push(new this.PointClass({value:n,label:t.labels[o],strokeColor:i.pointStrokeColor,fillColor:i.pointColor,highlightFill:i.pointHighlightFill||i.pointColor,highlightStroke:i.pointHighlightStroke||i.pointStrokeColor}))},this),this.buildScale(t.labels),this.eachPoints(function(t,i){e.extend(t,{x:this.scale.calculateX(i),y:this.scale.endPoint}),t.save()},this)},this),this.render()},update:function(){this.scale.update(),e.each(this.activeElements,function(t){t.restore(["fillColor","strokeColor"])}),this.eachPoints(function(t){t.save()}),this.render()},eachPoints:function(t){e.each(this.datasets,function(i){e.each(i.points,t,this)},this)},getPointsAtEvent:function(t){var i=[],s=e.getRelativePosition(t);return e.each(this.datasets,function(t){e.each(t.points,function(t){t.inRange(s.x,s.y)&&i.push(t)})},this),i},buildScale:function(t){var s=this,n=function(){var t=[];return s.eachPoints(function(i){t.push(i.value)}),t},o={templateString:this.options.scaleLabel,height:this.chart.height,width:this.chart.width,ctx:this.chart.ctx,textColor:this.options.scaleFontColor,fontSize:this.options.scaleFontSize,fontStyle:this.options.scaleFontStyle,fontFamily:this.options.scaleFontFamily,valuesCount:t.length,beginAtZero:this.options.scaleBeginAtZero,integersOnly:this.options.scaleIntegersOnly,calculateYRange:function(t){var i=e.calculateScaleRange(n(),t,this.fontSize,this.beginAtZero,this.integersOnly);e.extend(this,i)},xLabels:t,font:e.fontString(this.options.scaleFontSize,this.options.scaleFontStyle,this.options.scaleFontFamily),lineWidth:this.options.scaleLineWidth,lineColor:this.options.scaleLineColor,gridLineWidth:this.options.scaleShowGridLines?this.options.scaleGridLineWidth:0,gridLineColor:this.options.scaleShowGridLines?this.options.scaleGridLineColor:"rgba(0,0,0,0)",padding:this.options.showScale?0:this.options.pointDotRadius+this.options.pointDotStrokeWidth,showLabels:this.options.scaleShowLabels,display:this.options.showScale};this.options.scaleOverride&&e.extend(o,{calculateYRange:e.noop,steps:this.options.scaleSteps,stepValue:this.options.scaleStepWidth,min:this.options.scaleStartValue,max:this.options.scaleStartValue+this.options.scaleSteps*this.options.scaleStepWidth}),this.scale=new i.Scale(o)},addData:function(t,i){e.each(t,function(t,s){e.isNumber(t)&&this.datasets[s].points.push(new this.PointClass({value:t,label:i,x:this.scale.calculateX(this.scale.valuesCount+1),y:this.scale.endPoint,strokeColor:this.datasets[s].pointStrokeColor,fillColor:this.datasets[s].pointColor}))},this),this.scale.addXLabel(i),this.update()},removeData:function(){this.scale.removeXLabel(),e.each(this.datasets,function(t){t.points.shift()},this),this.update()},reflow:function(){var t=e.extend({height:this.chart.height,width:this.chart.width});this.scale.update(t)},draw:function(t){var i=t||1;this.clear();var s=this.chart.ctx;this.scale.draw(i),e.each(this.datasets,function(t){e.each(t.points,function(t,e){t.transition({y:this.scale.calculateY(t.value),x:this.scale.calculateX(e)},i)},this),this.options.bezierCurve&&e.each(t.points,function(i,s){i.controlPoints=0===s?e.splineCurve(i,i,t.points[s+1],0):s>=t.points.length-1?e.splineCurve(t.points[s-1],i,i,0):e.splineCurve(t.points[s-1],i,t.points[s+1],this.options.bezierCurveTension)},this),s.lineWidth=this.options.datasetStrokeWidth,s.strokeStyle=t.strokeColor,s.beginPath(),e.each(t.points,function(i,e){e>0?this.options.bezierCurve?s.bezierCurveTo(t.points[e-1].controlPoints.outer.x,t.points[e-1].controlPoints.outer.y,i.controlPoints.inner.x,i.controlPoints.inner.y,i.x,i.y):s.lineTo(i.x,i.y):s.moveTo(i.x,i.y)},this),s.stroke(),this.options.datasetFill&&(s.lineTo(t.points[t.points.length-1].x,this.scale.endPoint),s.lineTo(this.scale.calculateX(0),this.scale.endPoint),s.fillStyle=t.fillColor,s.closePath(),s.fill()),e.each(t.points,function(t){t.draw()})},this)}})}.call(this),function(){var t=this,i=t.Chart,e=i.helpers,s={scaleShowLabelBackdrop:!0,scaleBackdropColor:"rgba(255,255,255,0.75)",scaleBeginAtZero:!0,scaleBackdropPaddingY:2,scaleBackdropPaddingX:2,scaleShowLine:!0,segmentShowStroke:!0,segmentStrokeColor:"#fff",segmentStrokeWidth:2,animationSteps:100,animationEasing:"easeOutBounce",animateRotate:!0,animateScale:!1,legendTemplate:'<ul class="<%=name.toLowerCase()%>-legend"><% for (var i=0; i<segments.length; i++){%><li><span style="background-color:<%=segments[i].fillColor%>"></span><%if(segments[i].label){%><%=segments[i].label%><%}%></li><%}%></ul>'};i.Type.extend({name:"PolarArea",defaults:s,initialize:function(t){this.segments=[],this.SegmentArc=i.Arc.extend({showStroke:this.options.segmentShowStroke,strokeWidth:this.options.segmentStrokeWidth,strokeColor:this.options.segmentStrokeColor,ctx:this.chart.ctx,innerRadius:0,x:this.chart.width/2,y:this.chart.height/2}),this.scale=new i.RadialScale({display:this.options.showScale,fontStyle:this.options.scaleFontStyle,fontSize:this.options.scaleFontSize,fontFamily:this.options.scaleFontFamily,fontColor:this.options.scaleFontColor,showLabels:this.options.scaleShowLabels,showLabelBackdrop:this.options.scaleShowLabelBackdrop,backdropColor:this.options.scaleBackdropColor,backdropPaddingY:this.options.scaleBackdropPaddingY,backdropPaddingX:this.options.scaleBackdropPaddingX,lineWidth:this.options.scaleShowLine?this.options.scaleLineWidth:0,lineColor:this.options.scaleLineColor,lineArc:!0,width:this.chart.width,height:this.chart.height,xCenter:this.chart.width/2,yCenter:this.chart.height/2,ctx:this.chart.ctx,templateString:this.options.scaleLabel,valuesCount:t.length}),this.updateScaleRange(t),this.scale.update(),e.each(t,function(t,i){this.addData(t,i,!0)},this),this.options.showTooltips&&e.bindEvents(this,this.options.tooltipEvents,function(t){var i="mouseout"!==t.type?this.getSegmentsAtEvent(t):[];e.each(this.segments,function(t){t.restore(["fillColor"])}),e.each(i,function(t){t.fillColor=t.highlightColor}),this.showTooltip(i)}),this.render()},getSegmentsAtEvent:function(t){var i=[],s=e.getRelativePosition(t);return e.each(this.segments,function(t){t.inRange(s.x,s.y)&&i.push(t)},this),i},addData:function(t,i,e){var s=i||this.segments.length;this.segments.splice(s,0,new this.SegmentArc({fillColor:t.color,highlightColor:t.highlight||t.color,label:t.label,value:t.value,outerRadius:this.options.animateScale?0:this.scale.calculateCenterOffset(t.value),circumference:this.options.animateRotate?0:this.scale.getCircumference(),startAngle:1.5*Math.PI})),e||(this.reflow(),this.update())},removeData:function(t){var i=e.isNumber(t)?t:this.segments.length-1;this.segments.splice(i,1),this.reflow(),this.update()},calculateTotal:function(t){this.total=0,e.each(t,function(t){this.total+=t.value},this),this.scale.valuesCount=this.segments.length},updateScaleRange:function(t){var i=[];e.each(t,function(t){i.push(t.value)});var s=this.options.scaleOverride?{steps:this.options.scaleSteps,stepValue:this.options.scaleStepWidth,min:this.options.scaleStartValue,max:this.options.scaleStartValue+this.options.scaleSteps*this.options.scaleStepWidth}:e.calculateScaleRange(i,e.min([this.chart.width,this.chart.height])/2,this.options.scaleFontSize,this.options.scaleBeginAtZero,this.options.scaleIntegersOnly);e.extend(this.scale,s,{size:e.min([this.chart.width,this.chart.height]),xCenter:this.chart.width/2,yCenter:this.chart.height/2})},update:function(){this.calculateTotal(this.segments),e.each(this.segments,function(t){t.save()}),this.render()},reflow:function(){e.extend(this.SegmentArc.prototype,{x:this.chart.width/2,y:this.chart.height/2}),this.updateScaleRange(this.segments),this.scale.update(),e.extend(this.scale,{xCenter:this.chart.width/2,yCenter:this.chart.height/2}),e.each(this.segments,function(t){t.update({outerRadius:this.scale.calculateCenterOffset(t.value)})},this)},draw:function(t){var i=t||1;this.clear(),e.each(this.segments,function(t,e){t.transition({circumference:this.scale.getCircumference(),outerRadius:this.scale.calculateCenterOffset(t.value)},i),t.endAngle=t.startAngle+t.circumference,0===e&&(t.startAngle=1.5*Math.PI),e<this.segments.length-1&&(this.segments[e+1].startAngle=t.endAngle),t.draw()},this),this.scale.draw()}})}.call(this),function(){var t=this,i=t.Chart,e=i.helpers;i.Type.extend({name:"Radar",defaults:{scaleShowLine:!0,angleShowLineOut:!0,scaleShowLabels:!1,scaleBeginAtZero:!0,angleLineColor:"rgba(0,0,0,.1)",angleLineWidth:1,pointLabelFontFamily:"'Arial'",pointLabelFontStyle:"normal",pointLabelFontSize:10,pointLabelFontColor:"#666",pointDot:!0,pointDotRadius:3,pointDotStrokeWidth:1,pointHitDetectionRadius:20,datasetStroke:!0,datasetStrokeWidth:2,datasetFill:!0,legendTemplate:'<ul class="<%=name.toLowerCase()%>-legend"><% for (var i=0; i<datasets.length; i++){%><li><span style="background-color:<%=datasets[i].strokeColor%>"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>'},initialize:function(t){this.PointClass=i.Point.extend({strokeWidth:this.options.pointDotStrokeWidth,radius:this.options.pointDotRadius,hitDetectionRadius:this.options.pointHitDetectionRadius,ctx:this.chart.ctx}),this.datasets=[],this.buildScale(t),this.options.showTooltips&&e.bindEvents(this,this.options.tooltipEvents,function(t){var i="mouseout"!==t.type?this.getPointsAtEvent(t):[];this.eachPoints(function(t){t.restore(["fillColor","strokeColor"])}),e.each(i,function(t){t.fillColor=t.highlightFill,t.strokeColor=t.highlightStroke}),this.showTooltip(i)}),e.each(t.datasets,function(i){var s={label:i.label||null,fillColor:i.fillColor,strokeColor:i.strokeColor,pointColor:i.pointColor,pointStrokeColor:i.pointStrokeColor,points:[]};this.datasets.push(s),e.each(i.data,function(n,o){if(e.isNumber(n)){var a;this.scale.animation||(a=this.scale.getPointPosition(o,this.scale.calculateCenterOffset(n))),s.points.push(new this.PointClass({value:n,label:t.labels[o],x:this.options.animation?this.scale.xCenter:a.x,y:this.options.animation?this.scale.yCenter:a.y,strokeColor:i.pointStrokeColor,fillColor:i.pointColor,highlightFill:i.pointHighlightFill||i.pointColor,highlightStroke:i.pointHighlightStroke||i.pointStrokeColor}))}},this)},this),this.render()},eachPoints:function(t){e.each(this.datasets,function(i){e.each(i.points,t,this)},this)},getPointsAtEvent:function(t){var i=e.getRelativePosition(t),s=e.getAngleFromPoint({x:this.scale.xCenter,y:this.scale.yCenter},i),n=2*Math.PI/this.scale.valuesCount,o=Math.round((s.angle-1.5*Math.PI)/n),a=[];return(o>=this.scale.valuesCount||0>o)&&(o=0),s.distance<=this.scale.drawingArea&&e.each(this.datasets,function(t){a.push(t.points[o])}),a},buildScale:function(t){this.scale=new i.RadialScale({display:this.options.showScale,fontStyle:this.options.scaleFontStyle,fontSize:this.options.scaleFontSize,fontFamily:this.options.scaleFontFamily,fontColor:this.options.scaleFontColor,showLabels:this.options.scaleShowLabels,showLabelBackdrop:this.options.scaleShowLabelBackdrop,backdropColor:this.options.scaleBackdropColor,backdropPaddingY:this.options.scaleBackdropPaddingY,backdropPaddingX:this.options.scaleBackdropPaddingX,lineWidth:this.options.scaleShowLine?this.options.scaleLineWidth:0,lineColor:this.options.scaleLineColor,angleLineColor:this.options.angleLineColor,angleLineWidth:this.options.angleShowLineOut?this.options.angleLineWidth:0,pointLabelFontColor:this.options.pointLabelFontColor,pointLabelFontSize:this.options.pointLabelFontSize,pointLabelFontFamily:this.options.pointLabelFontFamily,pointLabelFontStyle:this.options.pointLabelFontStyle,height:this.chart.height,width:this.chart.width,xCenter:this.chart.width/2,yCenter:this.chart.height/2,ctx:this.chart.ctx,templateString:this.options.scaleLabel,labels:t.labels,valuesCount:t.datasets[0].data.length}),this.scale.setScaleSize(),this.updateScaleRange(t.datasets),this.scale.buildYLabels()},updateScaleRange:function(t){var i=function(){var i=[];return e.each(t,function(t){t.data?i=i.concat(t.data):e.each(t.points,function(t){i.push(t.value)})}),i}(),s=this.options.scaleOverride?{steps:this.options.scaleSteps,stepValue:this.options.scaleStepWidth,min:this.options.scaleStartValue,max:this.options.scaleStartValue+this.options.scaleSteps*this.options.scaleStepWidth}:e.calculateScaleRange(i,e.min([this.chart.width,this.chart.height])/2,this.options.scaleFontSize,this.options.scaleBeginAtZero,this.options.scaleIntegersOnly);e.extend(this.scale,s)},addData:function(t,i){this.scale.valuesCount++,e.each(t,function(t,s){if(e.isNumber(t)){var n=this.scale.getPointPosition(this.scale.valuesCount,this.scale.calculateCenterOffset(t));this.datasets[s].points.push(new this.PointClass({value:t,label:i,x:n.x,y:n.y,strokeColor:this.datasets[s].pointStrokeColor,fillColor:this.datasets[s].pointColor}))}},this),this.scale.labels.push(i),this.reflow(),this.update()},removeData:function(){this.scale.valuesCount--,this.scale.labels.shift(),e.each(this.datasets,function(t){t.points.shift()},this),this.reflow(),this.update()},update:function(){this.eachPoints(function(t){t.save()}),this.render()},reflow:function(){e.extend(this.scale,{width:this.chart.width,height:this.chart.height,size:e.min([this.chart.width,this.chart.height]),xCenter:this.chart.width/2,yCenter:this.chart.height/2}),this.updateScaleRange(this.datasets),this.scale.setScaleSize(),this.scale.buildYLabels()},draw:function(t){var i=t||1,s=this.chart.ctx;this.clear(),this.scale.draw(),e.each(this.datasets,function(t){e.each(t.points,function(t,e){t.transition(this.scale.getPointPosition(e,this.scale.calculateCenterOffset(t.value)),i)},this),s.lineWidth=this.options.datasetStrokeWidth,s.strokeStyle=t.strokeColor,s.beginPath(),e.each(t.points,function(t,i){0===i?s.moveTo(t.x,t.y):s.lineTo(t.x,t.y)},this),s.closePath(),s.stroke(),s.fillStyle=t.fillColor,s.fill(),e.each(t.points,function(t){t.draw()})},this)}})}.call(this);
(function(){
	

	var root = this,
		Chart = root.Chart,
		helpers = Chart.helpers;

	var defaultConfig = {
		scaleBeginAtZero : true,

		//Boolean - Whether grid lines are shown across the chart
		scaleShowGridLines : true,

		//String - Colour of the grid lines
		scaleGridLineColor : "rgba(0,0,0,.05)",

		//Number - Width of the grid lines
		scaleGridLineWidth : 1,

		//Boolean - If there is a stroke on each bar
		barShowStroke : true,

		//Number - Pixel width of the bar stroke
		barStrokeWidth : 2,

		//Number - Spacing between each of the X value sets
		barValueSpacing : 5,

		//Boolean - Whether bars should be rendered on a percentage base
		relativeBars : false,

		//String - A legend template
		legendTemplate : "<ul class=\"<%=name.toLowerCase()%>-legend\"><% for (var i=0; i<datasets.length; i++){%><li><span style=\"background-color:<%=datasets[i].fillColor%>\"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>"

	};

	Chart.Type.extend({
		name: "StackedBar",
		defaults : defaultConfig,
		initialize:  function(data){
			//Expose options as a scope variable here so we can access it in the ScaleClass
			var options = this.options;

			this.ScaleClass = Chart.Scale.extend({
				offsetGridLines : true,
				calculateBarX : function(barIndex){
					return this.calculateX(barIndex);
				},
				calculateBarY : function(datasets, dsIndex, barIndex, value){
					var offset = 0,
						sum = 0;

					for(var i = 0; i < datasets.length; i++) {
						sum += datasets[i].bars[barIndex].value;
					}
					for(i = dsIndex; i < datasets.length; i++) {
						if(i === dsIndex && value) {
							offset += value;
						} else {
							offset += datasets[i].bars[barIndex].value;
						}
					}

					if(options.relativeBars) {
						offset = offset / sum * 100;
					}

					return this.calculateY(offset);
				},
				calculateBaseWidth : function(){
					return (this.calculateX(1) - this.calculateX(0)) - (2*options.barValueSpacing);
				},
				calculateBaseHeight : function(){
					return (this.calculateY(1) - this.calculateY(0));
				},
				calculateBarWidth : function(datasetCount){
					//The padding between datasets is to the right of each bar, providing that there are more than 1 dataset
					return this.calculateBaseWidth();
				},
				calculateBarHeight : function(datasets, dsIndex, barIndex, value) {
					var sum = 0;

					for(var i = 0; i < datasets.length; i++) {
						sum += datasets[i].bars[barIndex].value;
					}

					if(!value) {
						value = datasets[dsIndex].bars[barIndex].value;
					}

					if(options.relativeBars) {
						value = value / sum * 100;
					}

					return this.calculateY(value);
				}
			});

			this.datasets = [];

			//Set up tooltip events on the chart
			if (this.options.showTooltips){
				helpers.bindEvents(this, this.options.tooltipEvents, function(evt){
					var activeBars = (evt.type !== 'mouseout') ? this.getBarsAtEvent(evt) : [];

					this.eachBars(function(bar){
						bar.restore(['fillColor', 'strokeColor']);
					});
					helpers.each(activeBars, function(activeBar){
						activeBar.fillColor = activeBar.highlightFill;
						activeBar.strokeColor = activeBar.highlightStroke;
					});
					this.showTooltip(activeBars);
				});
			}

			//Declare the extension of the default point, to cater for the options passed in to the constructor
			this.BarClass = Chart.Rectangle.extend({
				strokeWidth : this.options.barStrokeWidth,
				showStroke : this.options.barShowStroke,
				ctx : this.chart.ctx
			});

			//Iterate through each of the datasets, and build this into a property of the chart
			helpers.each(data.datasets,function(dataset,datasetIndex){

				var datasetObject = {
					label : dataset.label || null,
					fillColor : dataset.fillColor,
					strokeColor : dataset.strokeColor,
					bars : []
				};

				this.datasets.push(datasetObject);

				helpers.each(dataset.data,function(dataPoint,index){
					if (helpers.isNumber(dataPoint)){
						//Add a new point for each piece of data, passing any required data to draw.
						datasetObject.bars.push(new this.BarClass({
							value : dataPoint,
							label : data.labels[index],
							datasetLabel: dataset.label,
							strokeColor : dataset.strokeColor,
							fillColor : dataset.fillColor,
							highlightFill : dataset.highlightFill || dataset.fillColor,
							highlightStroke : dataset.highlightStroke || dataset.strokeColor
						}));
					}
				},this);

			},this);

			this.buildScale(data.labels);

			this.eachBars(function(bar, index, datasetIndex){
				helpers.extend(bar, {
					base: this.scale.endPoint,
					height: 0,
					width : this.scale.calculateBarWidth(this.datasets.length),
					x: this.scale.calculateBarX(index),
					y: this.scale.endPoint
				});
				bar.save();
			}, this);

			this.render();
		},
		update : function(){
			this.scale.update();
			// Reset any highlight colours before updating.
			helpers.each(this.activeElements, function(activeElement){
				activeElement.restore(['fillColor', 'strokeColor']);
			});

			this.eachBars(function(bar){
				bar.save();
			});
			this.render();
		},
		eachBars : function(callback){
			helpers.each(this.datasets,function(dataset, datasetIndex){
				helpers.each(dataset.bars, callback, this, datasetIndex);
			},this);
		},
		getBarsAtEvent : function(e){
			var barsArray = [],
				eventPosition = helpers.getRelativePosition(e),
				datasetIterator = function(dataset){
					barsArray.push(dataset.bars[barIndex]);
				},
				barIndex;

			for (var datasetIndex = 0; datasetIndex < this.datasets.length; datasetIndex++) {
				for (barIndex = 0; barIndex < this.datasets[datasetIndex].bars.length; barIndex++) {
					if (this.datasets[datasetIndex].bars[barIndex].inRange(eventPosition.x,eventPosition.y)){
						helpers.each(this.datasets, datasetIterator);
						return barsArray;
					}
				}
			}

			return barsArray;
		},
		buildScale : function(labels){
			var self = this;

			var dataTotal = function(){
				var values = [];
				helpers.each(self.datasets, function(dataset) {
					helpers.each(dataset.bars, function(bar, barIndex) {
						if(!values[barIndex]) values[barIndex] = 0;
						if(self.options.relativeBars) {
							values[barIndex] = 100;
						} else {
							values[barIndex] += bar.value;
						}
					});
				});
				return values;
			};

			var scaleOptions = {
				templateString : this.options.scaleLabel,
				height : this.chart.height,
				width : this.chart.width,
				ctx : this.chart.ctx,
				textColor : this.options.scaleFontColor,
				fontSize : this.options.scaleFontSize,
				fontStyle : this.options.scaleFontStyle,
				fontFamily : this.options.scaleFontFamily,
				valuesCount : labels.length,
				beginAtZero : this.options.scaleBeginAtZero,
				integersOnly : this.options.scaleIntegersOnly,
				calculateYRange: function(currentHeight){
					var updatedRanges = helpers.calculateScaleRange(
						dataTotal(),
						currentHeight,
						this.fontSize,
						this.beginAtZero,
						this.integersOnly
					);
					helpers.extend(this, updatedRanges);
				},
				xLabels : labels,
				font : helpers.fontString(this.options.scaleFontSize, this.options.scaleFontStyle, this.options.scaleFontFamily),
				lineWidth : this.options.scaleLineWidth,
				lineColor : this.options.scaleLineColor,
				gridLineWidth : (this.options.scaleShowGridLines) ? this.options.scaleGridLineWidth : 0,
				gridLineColor : (this.options.scaleShowGridLines) ? this.options.scaleGridLineColor : "rgba(0,0,0,0)",
				padding : (this.options.showScale) ? 0 : (this.options.barShowStroke) ? this.options.barStrokeWidth : 0,
				showLabels : this.options.scaleShowLabels,
				display : this.options.showScale
			};

			if (this.options.scaleOverride){
				helpers.extend(scaleOptions, {
					calculateYRange: helpers.noop,
					steps: this.options.scaleSteps,
					stepValue: this.options.scaleStepWidth,
					min: this.options.scaleStartValue,
					max: this.options.scaleStartValue + (this.options.scaleSteps * this.options.scaleStepWidth)
				});
			}

			this.scale = new this.ScaleClass(scaleOptions);
		},
		addData : function(valuesArray,label){
			//Map the values array for each of the datasets
			helpers.each(valuesArray,function(value,datasetIndex){
				if (helpers.isNumber(value)){
					//Add a new point for each piece of data, passing any required data to draw.
					this.datasets[datasetIndex].bars.push(new this.BarClass({
						value : value,
						label : label,
						x: this.scale.calculateBarX(this.scale.valuesCount+1),
						y: this.scale.endPoint,
						width : this.scale.calculateBarWidth(this.datasets.length),
						base : this.scale.endPoint,
						strokeColor : this.datasets[datasetIndex].strokeColor,
						fillColor : this.datasets[datasetIndex].fillColor
					}));
				}
			},this);

			this.scale.addXLabel(label);
			//Then re-render the chart.
			this.update();
		},
		removeData : function(){
			this.scale.removeXLabel();
			//Then re-render the chart.
			helpers.each(this.datasets,function(dataset){
				dataset.bars.shift();
			},this);
			this.update();
		},
		reflow : function(){
			helpers.extend(this.BarClass.prototype,{
				y: this.scale.endPoint,
				base : this.scale.endPoint
			});
			var newScaleProps = helpers.extend({
				height : this.chart.height,
				width : this.chart.width
			});
			this.scale.update(newScaleProps);
		},
		draw : function(ease){
			var easingDecimal = ease || 1;
			this.clear();

			var ctx = this.chart.ctx;

			this.scale.draw(easingDecimal);

			//Draw all the bars for each dataset
			helpers.each(this.datasets,function(dataset,datasetIndex){
				helpers.each(dataset.bars,function(bar,index){
					var y = this.scale.calculateBarY(this.datasets, datasetIndex, index, bar.value),
						height = this.scale.calculateBarHeight(this.datasets, datasetIndex, index, bar.value);

					//Transition then draw
					bar.transition({
						base : this.scale.endPoint - (Math.abs(height) - Math.abs(y)),
						x : this.scale.calculateBarX(index),
						y : Math.abs(y),
						height : Math.abs(height),
						width : this.scale.calculateBarWidth(this.datasets.length)
					}, easingDecimal).draw();
				},this);
			},this);
		}
	});
}).call(this);

define("Chart.StackedBar", ["Chart"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Chart;
    };
}(this)));


define('chart-stacked-bar',[
    'scalejs!core',
    'knockout',
    'Chart.StackedBar',
    'scalejs.mvvm'
], function (
    core,
    ko,
    Chart
) {
    

    ko.components.register('chart-stacked-bar', {
        viewModel: function ( params ) {
            if (!params.id) {
                return console.error('chart: stacked-bar: id required by chart');
            }

            var parent = document.getElementById(params.id);
            var canvas = parent.children[0];

            if (!(canvas && canvas.getContext)) {
                return console.error('chart: stacked-bar: canvas not found [id ', params.id, ']');
            }

            canvas.setAttribute('width', parent.clientWidth);
            canvas.setAttribute('height', parent.clientHeight);

            canvas = canvas.getContext('2d');

            if (!canvas) {
                return console.error('chart: stacked-bar: context not found [id ', params.id, ']');
            }

            // create the initial chart
            params.chart = new Chart(canvas);
            params.bar = params.chart.StackedBar(
                ko.unwrap(params.data),
                ko.unwrap(params.options)
            );

            if (ko.isObservable(params.data)) {
                params.data.subscribe(function (change) {
                    params.bar.destroy();
                    params.bar = params.chart.StackedBar(
                        change, ko.unwrap(params.options)
                    );
                });
            }
        },
        template: '<canvas></canvas>'
    });

});


(function(){(function(a,d){var c,b;d=d();if(typeof define==="function"&&define.amd){return define("panorama",d)}else{if(typeof exports==="object"){return module.exports=d}else{b="panorama";c=a[b];a[b]=d;return a[b].noConflict=function(){var e;e=a[b];a[b]=c;return e}}}})(window||this,function(){var c,a,b;a=".panorama{-webkit-overflow-scrolling:touch;white-space:nowrap;height:100%;overflow-y:hidden;font-size:0;box-sizing:border-box}.panorama .panel{position:relative;display:inline-block;font-size:initial;white-space:initial;vertical-align:top;overflow:auto;height:100%}";b=null;return c={destroy:function(){if(!b){return}return document.getElementsByTagName("head")[0].removeChild(b)},init:function(){if(b){return}b=document.createElement("style");b.innerHTML=a;return document.getElementsByTagName("head")[0].appendChild(b)}}})}).call(this);
/*! Hammer.JS - v2.0.4 - 2014-09-28
 * http://hammerjs.github.io/
 *
 * Copyright (c) 2014 Jorik Tangelder;
 * Licensed under the MIT license */
!function(a,b,c,d){function e(a,b,c){return setTimeout(k(a,c),b)}function f(a,b,c){return Array.isArray(a)?(g(a,c[b],c),!0):!1}function g(a,b,c){var e;if(a)if(a.forEach)a.forEach(b,c);else if(a.length!==d)for(e=0;e<a.length;)b.call(c,a[e],e,a),e++;else for(e in a)a.hasOwnProperty(e)&&b.call(c,a[e],e,a)}function h(a,b,c){for(var e=Object.keys(b),f=0;f<e.length;)(!c||c&&a[e[f]]===d)&&(a[e[f]]=b[e[f]]),f++;return a}function i(a,b){return h(a,b,!0)}function j(a,b,c){var d,e=b.prototype;d=a.prototype=Object.create(e),d.constructor=a,d._super=e,c&&h(d,c)}function k(a,b){return function(){return a.apply(b,arguments)}}function l(a,b){return typeof a==kb?a.apply(b?b[0]||d:d,b):a}function m(a,b){return a===d?b:a}function n(a,b,c){g(r(b),function(b){a.addEventListener(b,c,!1)})}function o(a,b,c){g(r(b),function(b){a.removeEventListener(b,c,!1)})}function p(a,b){for(;a;){if(a==b)return!0;a=a.parentNode}return!1}function q(a,b){return a.indexOf(b)>-1}function r(a){return a.trim().split(/\s+/g)}function s(a,b,c){if(a.indexOf&&!c)return a.indexOf(b);for(var d=0;d<a.length;){if(c&&a[d][c]==b||!c&&a[d]===b)return d;d++}return-1}function t(a){return Array.prototype.slice.call(a,0)}function u(a,b,c){for(var d=[],e=[],f=0;f<a.length;){var g=b?a[f][b]:a[f];s(e,g)<0&&d.push(a[f]),e[f]=g,f++}return c&&(d=b?d.sort(function(a,c){return a[b]>c[b]}):d.sort()),d}function v(a,b){for(var c,e,f=b[0].toUpperCase()+b.slice(1),g=0;g<ib.length;){if(c=ib[g],e=c?c+f:b,e in a)return e;g++}return d}function w(){return ob++}function x(a){var b=a.ownerDocument;return b.defaultView||b.parentWindow}function y(a,b){var c=this;this.manager=a,this.callback=b,this.element=a.element,this.target=a.options.inputTarget,this.domHandler=function(b){l(a.options.enable,[a])&&c.handler(b)},this.init()}function z(a){var b,c=a.options.inputClass;return new(b=c?c:rb?N:sb?Q:qb?S:M)(a,A)}function A(a,b,c){var d=c.pointers.length,e=c.changedPointers.length,f=b&yb&&d-e===0,g=b&(Ab|Bb)&&d-e===0;c.isFirst=!!f,c.isFinal=!!g,f&&(a.session={}),c.eventType=b,B(a,c),a.emit("hammer.input",c),a.recognize(c),a.session.prevInput=c}function B(a,b){var c=a.session,d=b.pointers,e=d.length;c.firstInput||(c.firstInput=E(b)),e>1&&!c.firstMultiple?c.firstMultiple=E(b):1===e&&(c.firstMultiple=!1);var f=c.firstInput,g=c.firstMultiple,h=g?g.center:f.center,i=b.center=F(d);b.timeStamp=nb(),b.deltaTime=b.timeStamp-f.timeStamp,b.angle=J(h,i),b.distance=I(h,i),C(c,b),b.offsetDirection=H(b.deltaX,b.deltaY),b.scale=g?L(g.pointers,d):1,b.rotation=g?K(g.pointers,d):0,D(c,b);var j=a.element;p(b.srcEvent.target,j)&&(j=b.srcEvent.target),b.target=j}function C(a,b){var c=b.center,d=a.offsetDelta||{},e=a.prevDelta||{},f=a.prevInput||{};(b.eventType===yb||f.eventType===Ab)&&(e=a.prevDelta={x:f.deltaX||0,y:f.deltaY||0},d=a.offsetDelta={x:c.x,y:c.y}),b.deltaX=e.x+(c.x-d.x),b.deltaY=e.y+(c.y-d.y)}function D(a,b){var c,e,f,g,h=a.lastInterval||b,i=b.timeStamp-h.timeStamp;if(b.eventType!=Bb&&(i>xb||h.velocity===d)){var j=h.deltaX-b.deltaX,k=h.deltaY-b.deltaY,l=G(i,j,k);e=l.x,f=l.y,c=mb(l.x)>mb(l.y)?l.x:l.y,g=H(j,k),a.lastInterval=b}else c=h.velocity,e=h.velocityX,f=h.velocityY,g=h.direction;b.velocity=c,b.velocityX=e,b.velocityY=f,b.direction=g}function E(a){for(var b=[],c=0;c<a.pointers.length;)b[c]={clientX:lb(a.pointers[c].clientX),clientY:lb(a.pointers[c].clientY)},c++;return{timeStamp:nb(),pointers:b,center:F(b),deltaX:a.deltaX,deltaY:a.deltaY}}function F(a){var b=a.length;if(1===b)return{x:lb(a[0].clientX),y:lb(a[0].clientY)};for(var c=0,d=0,e=0;b>e;)c+=a[e].clientX,d+=a[e].clientY,e++;return{x:lb(c/b),y:lb(d/b)}}function G(a,b,c){return{x:b/a||0,y:c/a||0}}function H(a,b){return a===b?Cb:mb(a)>=mb(b)?a>0?Db:Eb:b>0?Fb:Gb}function I(a,b,c){c||(c=Kb);var d=b[c[0]]-a[c[0]],e=b[c[1]]-a[c[1]];return Math.sqrt(d*d+e*e)}function J(a,b,c){c||(c=Kb);var d=b[c[0]]-a[c[0]],e=b[c[1]]-a[c[1]];return 180*Math.atan2(e,d)/Math.PI}function K(a,b){return J(b[1],b[0],Lb)-J(a[1],a[0],Lb)}function L(a,b){return I(b[0],b[1],Lb)/I(a[0],a[1],Lb)}function M(){this.evEl=Nb,this.evWin=Ob,this.allow=!0,this.pressed=!1,y.apply(this,arguments)}function N(){this.evEl=Rb,this.evWin=Sb,y.apply(this,arguments),this.store=this.manager.session.pointerEvents=[]}function O(){this.evTarget=Ub,this.evWin=Vb,this.started=!1,y.apply(this,arguments)}function P(a,b){var c=t(a.touches),d=t(a.changedTouches);return b&(Ab|Bb)&&(c=u(c.concat(d),"identifier",!0)),[c,d]}function Q(){this.evTarget=Xb,this.targetIds={},y.apply(this,arguments)}function R(a,b){var c=t(a.touches),d=this.targetIds;if(b&(yb|zb)&&1===c.length)return d[c[0].identifier]=!0,[c,c];var e,f,g=t(a.changedTouches),h=[],i=this.target;if(f=c.filter(function(a){return p(a.target,i)}),b===yb)for(e=0;e<f.length;)d[f[e].identifier]=!0,e++;for(e=0;e<g.length;)d[g[e].identifier]&&h.push(g[e]),b&(Ab|Bb)&&delete d[g[e].identifier],e++;return h.length?[u(f.concat(h),"identifier",!0),h]:void 0}function S(){y.apply(this,arguments);var a=k(this.handler,this);this.touch=new Q(this.manager,a),this.mouse=new M(this.manager,a)}function T(a,b){this.manager=a,this.set(b)}function U(a){if(q(a,bc))return bc;var b=q(a,cc),c=q(a,dc);return b&&c?cc+" "+dc:b||c?b?cc:dc:q(a,ac)?ac:_b}function V(a){this.id=w(),this.manager=null,this.options=i(a||{},this.defaults),this.options.enable=m(this.options.enable,!0),this.state=ec,this.simultaneous={},this.requireFail=[]}function W(a){return a&jc?"cancel":a&hc?"end":a&gc?"move":a&fc?"start":""}function X(a){return a==Gb?"down":a==Fb?"up":a==Db?"left":a==Eb?"right":""}function Y(a,b){var c=b.manager;return c?c.get(a):a}function Z(){V.apply(this,arguments)}function $(){Z.apply(this,arguments),this.pX=null,this.pY=null}function _(){Z.apply(this,arguments)}function ab(){V.apply(this,arguments),this._timer=null,this._input=null}function bb(){Z.apply(this,arguments)}function cb(){Z.apply(this,arguments)}function db(){V.apply(this,arguments),this.pTime=!1,this.pCenter=!1,this._timer=null,this._input=null,this.count=0}function eb(a,b){return b=b||{},b.recognizers=m(b.recognizers,eb.defaults.preset),new fb(a,b)}function fb(a,b){b=b||{},this.options=i(b,eb.defaults),this.options.inputTarget=this.options.inputTarget||a,this.handlers={},this.session={},this.recognizers=[],this.element=a,this.input=z(this),this.touchAction=new T(this,this.options.touchAction),gb(this,!0),g(b.recognizers,function(a){var b=this.add(new a[0](a[1]));a[2]&&b.recognizeWith(a[2]),a[3]&&b.requireFailure(a[3])},this)}function gb(a,b){var c=a.element;g(a.options.cssProps,function(a,d){c.style[v(c.style,d)]=b?a:""})}function hb(a,c){var d=b.createEvent("Event");d.initEvent(a,!0,!0),d.gesture=c,c.target.dispatchEvent(d)}var ib=["","webkit","moz","MS","ms","o"],jb=b.createElement("div"),kb="function",lb=Math.round,mb=Math.abs,nb=Date.now,ob=1,pb=/mobile|tablet|ip(ad|hone|od)|android/i,qb="ontouchstart"in a,rb=v(a,"PointerEvent")!==d,sb=qb&&pb.test(navigator.userAgent),tb="touch",ub="pen",vb="mouse",wb="kinect",xb=25,yb=1,zb=2,Ab=4,Bb=8,Cb=1,Db=2,Eb=4,Fb=8,Gb=16,Hb=Db|Eb,Ib=Fb|Gb,Jb=Hb|Ib,Kb=["x","y"],Lb=["clientX","clientY"];y.prototype={handler:function(){},init:function(){this.evEl&&n(this.element,this.evEl,this.domHandler),this.evTarget&&n(this.target,this.evTarget,this.domHandler),this.evWin&&n(x(this.element),this.evWin,this.domHandler)},destroy:function(){this.evEl&&o(this.element,this.evEl,this.domHandler),this.evTarget&&o(this.target,this.evTarget,this.domHandler),this.evWin&&o(x(this.element),this.evWin,this.domHandler)}};var Mb={mousedown:yb,mousemove:zb,mouseup:Ab},Nb="mousedown",Ob="mousemove mouseup";j(M,y,{handler:function(a){var b=Mb[a.type];b&yb&&0===a.button&&(this.pressed=!0),b&zb&&1!==a.which&&(b=Ab),this.pressed&&this.allow&&(b&Ab&&(this.pressed=!1),this.callback(this.manager,b,{pointers:[a],changedPointers:[a],pointerType:vb,srcEvent:a}))}});var Pb={pointerdown:yb,pointermove:zb,pointerup:Ab,pointercancel:Bb,pointerout:Bb},Qb={2:tb,3:ub,4:vb,5:wb},Rb="pointerdown",Sb="pointermove pointerup pointercancel";a.MSPointerEvent&&(Rb="MSPointerDown",Sb="MSPointerMove MSPointerUp MSPointerCancel"),j(N,y,{handler:function(a){var b=this.store,c=!1,d=a.type.toLowerCase().replace("ms",""),e=Pb[d],f=Qb[a.pointerType]||a.pointerType,g=f==tb,h=s(b,a.pointerId,"pointerId");e&yb&&(0===a.button||g)?0>h&&(b.push(a),h=b.length-1):e&(Ab|Bb)&&(c=!0),0>h||(b[h]=a,this.callback(this.manager,e,{pointers:b,changedPointers:[a],pointerType:f,srcEvent:a}),c&&b.splice(h,1))}});var Tb={touchstart:yb,touchmove:zb,touchend:Ab,touchcancel:Bb},Ub="touchstart",Vb="touchstart touchmove touchend touchcancel";j(O,y,{handler:function(a){var b=Tb[a.type];if(b===yb&&(this.started=!0),this.started){var c=P.call(this,a,b);b&(Ab|Bb)&&c[0].length-c[1].length===0&&(this.started=!1),this.callback(this.manager,b,{pointers:c[0],changedPointers:c[1],pointerType:tb,srcEvent:a})}}});var Wb={touchstart:yb,touchmove:zb,touchend:Ab,touchcancel:Bb},Xb="touchstart touchmove touchend touchcancel";j(Q,y,{handler:function(a){var b=Wb[a.type],c=R.call(this,a,b);c&&this.callback(this.manager,b,{pointers:c[0],changedPointers:c[1],pointerType:tb,srcEvent:a})}}),j(S,y,{handler:function(a,b,c){var d=c.pointerType==tb,e=c.pointerType==vb;if(d)this.mouse.allow=!1;else if(e&&!this.mouse.allow)return;b&(Ab|Bb)&&(this.mouse.allow=!0),this.callback(a,b,c)},destroy:function(){this.touch.destroy(),this.mouse.destroy()}});var Yb=v(jb.style,"touchAction"),Zb=Yb!==d,$b="compute",_b="auto",ac="manipulation",bc="none",cc="pan-x",dc="pan-y";T.prototype={set:function(a){a==$b&&(a=this.compute()),Zb&&(this.manager.element.style[Yb]=a),this.actions=a.toLowerCase().trim()},update:function(){this.set(this.manager.options.touchAction)},compute:function(){var a=[];return g(this.manager.recognizers,function(b){l(b.options.enable,[b])&&(a=a.concat(b.getTouchAction()))}),U(a.join(" "))},preventDefaults:function(a){if(!Zb){var b=a.srcEvent,c=a.offsetDirection;if(this.manager.session.prevented)return void b.preventDefault();var d=this.actions,e=q(d,bc),f=q(d,dc),g=q(d,cc);return e||f&&c&Hb||g&&c&Ib?this.preventSrc(b):void 0}},preventSrc:function(a){this.manager.session.prevented=!0,a.preventDefault()}};var ec=1,fc=2,gc=4,hc=8,ic=hc,jc=16,kc=32;V.prototype={defaults:{},set:function(a){return h(this.options,a),this.manager&&this.manager.touchAction.update(),this},recognizeWith:function(a){if(f(a,"recognizeWith",this))return this;var b=this.simultaneous;return a=Y(a,this),b[a.id]||(b[a.id]=a,a.recognizeWith(this)),this},dropRecognizeWith:function(a){return f(a,"dropRecognizeWith",this)?this:(a=Y(a,this),delete this.simultaneous[a.id],this)},requireFailure:function(a){if(f(a,"requireFailure",this))return this;var b=this.requireFail;return a=Y(a,this),-1===s(b,a)&&(b.push(a),a.requireFailure(this)),this},dropRequireFailure:function(a){if(f(a,"dropRequireFailure",this))return this;a=Y(a,this);var b=s(this.requireFail,a);return b>-1&&this.requireFail.splice(b,1),this},hasRequireFailures:function(){return this.requireFail.length>0},canRecognizeWith:function(a){return!!this.simultaneous[a.id]},emit:function(a){function b(b){c.manager.emit(c.options.event+(b?W(d):""),a)}var c=this,d=this.state;hc>d&&b(!0),b(),d>=hc&&b(!0)},tryEmit:function(a){return this.canEmit()?this.emit(a):void(this.state=kc)},canEmit:function(){for(var a=0;a<this.requireFail.length;){if(!(this.requireFail[a].state&(kc|ec)))return!1;a++}return!0},recognize:function(a){var b=h({},a);return l(this.options.enable,[this,b])?(this.state&(ic|jc|kc)&&(this.state=ec),this.state=this.process(b),void(this.state&(fc|gc|hc|jc)&&this.tryEmit(b))):(this.reset(),void(this.state=kc))},process:function(){},getTouchAction:function(){},reset:function(){}},j(Z,V,{defaults:{pointers:1},attrTest:function(a){var b=this.options.pointers;return 0===b||a.pointers.length===b},process:function(a){var b=this.state,c=a.eventType,d=b&(fc|gc),e=this.attrTest(a);return d&&(c&Bb||!e)?b|jc:d||e?c&Ab?b|hc:b&fc?b|gc:fc:kc}}),j($,Z,{defaults:{event:"pan",threshold:10,pointers:1,direction:Jb},getTouchAction:function(){var a=this.options.direction,b=[];return a&Hb&&b.push(dc),a&Ib&&b.push(cc),b},directionTest:function(a){var b=this.options,c=!0,d=a.distance,e=a.direction,f=a.deltaX,g=a.deltaY;return e&b.direction||(b.direction&Hb?(e=0===f?Cb:0>f?Db:Eb,c=f!=this.pX,d=Math.abs(a.deltaX)):(e=0===g?Cb:0>g?Fb:Gb,c=g!=this.pY,d=Math.abs(a.deltaY))),a.direction=e,c&&d>b.threshold&&e&b.direction},attrTest:function(a){return Z.prototype.attrTest.call(this,a)&&(this.state&fc||!(this.state&fc)&&this.directionTest(a))},emit:function(a){this.pX=a.deltaX,this.pY=a.deltaY;var b=X(a.direction);b&&this.manager.emit(this.options.event+b,a),this._super.emit.call(this,a)}}),j(_,Z,{defaults:{event:"pinch",threshold:0,pointers:2},getTouchAction:function(){return[bc]},attrTest:function(a){return this._super.attrTest.call(this,a)&&(Math.abs(a.scale-1)>this.options.threshold||this.state&fc)},emit:function(a){if(this._super.emit.call(this,a),1!==a.scale){var b=a.scale<1?"in":"out";this.manager.emit(this.options.event+b,a)}}}),j(ab,V,{defaults:{event:"press",pointers:1,time:500,threshold:5},getTouchAction:function(){return[_b]},process:function(a){var b=this.options,c=a.pointers.length===b.pointers,d=a.distance<b.threshold,f=a.deltaTime>b.time;if(this._input=a,!d||!c||a.eventType&(Ab|Bb)&&!f)this.reset();else if(a.eventType&yb)this.reset(),this._timer=e(function(){this.state=ic,this.tryEmit()},b.time,this);else if(a.eventType&Ab)return ic;return kc},reset:function(){clearTimeout(this._timer)},emit:function(a){this.state===ic&&(a&&a.eventType&Ab?this.manager.emit(this.options.event+"up",a):(this._input.timeStamp=nb(),this.manager.emit(this.options.event,this._input)))}}),j(bb,Z,{defaults:{event:"rotate",threshold:0,pointers:2},getTouchAction:function(){return[bc]},attrTest:function(a){return this._super.attrTest.call(this,a)&&(Math.abs(a.rotation)>this.options.threshold||this.state&fc)}}),j(cb,Z,{defaults:{event:"swipe",threshold:10,velocity:.65,direction:Hb|Ib,pointers:1},getTouchAction:function(){return $.prototype.getTouchAction.call(this)},attrTest:function(a){var b,c=this.options.direction;return c&(Hb|Ib)?b=a.velocity:c&Hb?b=a.velocityX:c&Ib&&(b=a.velocityY),this._super.attrTest.call(this,a)&&c&a.direction&&a.distance>this.options.threshold&&mb(b)>this.options.velocity&&a.eventType&Ab},emit:function(a){var b=X(a.direction);b&&this.manager.emit(this.options.event+b,a),this.manager.emit(this.options.event,a)}}),j(db,V,{defaults:{event:"tap",pointers:1,taps:1,interval:300,time:250,threshold:2,posThreshold:10},getTouchAction:function(){return[ac]},process:function(a){var b=this.options,c=a.pointers.length===b.pointers,d=a.distance<b.threshold,f=a.deltaTime<b.time;if(this.reset(),a.eventType&yb&&0===this.count)return this.failTimeout();if(d&&f&&c){if(a.eventType!=Ab)return this.failTimeout();var g=this.pTime?a.timeStamp-this.pTime<b.interval:!0,h=!this.pCenter||I(this.pCenter,a.center)<b.posThreshold;this.pTime=a.timeStamp,this.pCenter=a.center,h&&g?this.count+=1:this.count=1,this._input=a;var i=this.count%b.taps;if(0===i)return this.hasRequireFailures()?(this._timer=e(function(){this.state=ic,this.tryEmit()},b.interval,this),fc):ic}return kc},failTimeout:function(){return this._timer=e(function(){this.state=kc},this.options.interval,this),kc},reset:function(){clearTimeout(this._timer)},emit:function(){this.state==ic&&(this._input.tapCount=this.count,this.manager.emit(this.options.event,this._input))}}),eb.VERSION="2.0.4",eb.defaults={domEvents:!1,touchAction:$b,enable:!0,inputTarget:null,inputClass:null,preset:[[bb,{enable:!1}],[_,{enable:!1},["rotate"]],[cb,{direction:Hb}],[$,{direction:Hb},["swipe"]],[db],[db,{event:"doubletap",taps:2},["tap"]],[ab]],cssProps:{userSelect:"none",touchSelect:"none",touchCallout:"none",contentZooming:"none",userDrag:"none",tapHighlightColor:"rgba(0,0,0,0)"}};var lc=1,mc=2;fb.prototype={set:function(a){return h(this.options,a),a.touchAction&&this.touchAction.update(),a.inputTarget&&(this.input.destroy(),this.input.target=a.inputTarget,this.input.init()),this},stop:function(a){this.session.stopped=a?mc:lc},recognize:function(a){var b=this.session;if(!b.stopped){this.touchAction.preventDefaults(a);var c,d=this.recognizers,e=b.curRecognizer;(!e||e&&e.state&ic)&&(e=b.curRecognizer=null);for(var f=0;f<d.length;)c=d[f],b.stopped===mc||e&&c!=e&&!c.canRecognizeWith(e)?c.reset():c.recognize(a),!e&&c.state&(fc|gc|hc)&&(e=b.curRecognizer=c),f++}},get:function(a){if(a instanceof V)return a;for(var b=this.recognizers,c=0;c<b.length;c++)if(b[c].options.event==a)return b[c];return null},add:function(a){if(f(a,"add",this))return this;var b=this.get(a.options.event);return b&&this.remove(b),this.recognizers.push(a),a.manager=this,this.touchAction.update(),a},remove:function(a){if(f(a,"remove",this))return this;var b=this.recognizers;return a=this.get(a),b.splice(s(b,a),1),this.touchAction.update(),this},on:function(a,b){var c=this.handlers;return g(r(a),function(a){c[a]=c[a]||[],c[a].push(b)}),this},off:function(a,b){var c=this.handlers;return g(r(a),function(a){b?c[a].splice(s(c[a],b),1):delete c[a]}),this},emit:function(a,b){this.options.domEvents&&hb(a,b);var c=this.handlers[a]&&this.handlers[a].slice();if(c&&c.length){b.type=a,b.preventDefault=function(){b.srcEvent.preventDefault()};for(var d=0;d<c.length;)c[d](b),d++}},destroy:function(){this.element&&gb(this,!1),this.handlers={},this.session={},this.input.destroy(),this.element=null}},h(eb,{INPUT_START:yb,INPUT_MOVE:zb,INPUT_END:Ab,INPUT_CANCEL:Bb,STATE_POSSIBLE:ec,STATE_BEGAN:fc,STATE_CHANGED:gc,STATE_ENDED:hc,STATE_RECOGNIZED:ic,STATE_CANCELLED:jc,STATE_FAILED:kc,DIRECTION_NONE:Cb,DIRECTION_LEFT:Db,DIRECTION_RIGHT:Eb,DIRECTION_UP:Fb,DIRECTION_DOWN:Gb,DIRECTION_HORIZONTAL:Hb,DIRECTION_VERTICAL:Ib,DIRECTION_ALL:Jb,Manager:fb,Input:y,TouchAction:T,TouchInput:Q,MouseInput:M,PointerEventInput:N,TouchMouseInput:S,SingleTouchInput:O,Recognizer:V,AttrRecognizer:Z,Tap:db,Pan:$,Swipe:cb,Pinch:_,Rotate:bb,Press:ab,on:n,off:o,each:g,merge:i,extend:h,inherit:j,bindFn:k,prefixed:v}),typeof define==kb&&define.amd?define('hammer',[],function(){return eb}):"undefined"!=typeof module&&module.exports?module.exports=eb:a[c]=eb}(window,document,"Hammer");


require([
    'scalejs!core',
    'underscore',
    'panorama',
    'knockout',
    'hammer'
], function (
    core,
    underscore,
    panorama,
    knockout,
    Hammer
) {

    // globalify
    window._ = underscore;
    window.ko = knockout;
    //TODO: Figure out hammer shim, this shouldn't be exposed here
    window.Hammer = Hammer

    core.registerExtension({
        _: underscore,
        underscore: underscore,
    });

    // pure css, no need to re-init
    panorama.init();
});


define("external", function(){});


define('knockout-hammer',[
    'knockout',
    'hammer'
], function(
    ko,
    Hammer
) {

    //['hold', 'tap', 'doubletap', 'drag', 'dragstart', 'dragend', 'dragup', 'dragdown', 'dragleft', 'dragright', 'swipe', 'swipeup', 'swipedown', 'swipeleft', 'swiperight', 'transform', 'transformstart', 'transformend', 'rotate', 'pinch', 'pinchin', 'pinchout', 'touch', 'release']
    ['Tap', 'Swipe'].forEach(function(gesture) {

        return ko.bindingHandlers['hm' + gesture] = {
            init: function(element, valueAccessor, allBindingsAccessor, data) {
                var handle, handler, options, settings;

                if (! (settings = valueAccessor()) ) {
                    return false;
                }

                handler = settings.handler ? settings.handler : settings;
                options = settings.handler ? settings : { };
                options['event'] = gesture.toLowerCase();

                handle = function (evt) {
                    console.debug('hammer: ' + gesture + ' invoked:', evt);
                    handler.apply(data, arguments);
                };

                if (!element._hammer) {
                    element._hammer = new Hammer.Manager(element,
                        allBindingsAccessor().hmOptions || { });
                }

                element._hammer.add(new Hammer[gesture](options));
                element._hammer.on(options['event'], handle);

                console.debug('hammer: ' + gesture + ' registered:', element);
                return true;
            }
        };
    });

});


define('toolkit',[
    'scalejs!core'
], function (
    core
) {
    try {
        window.global = window;
    } finally { }
    try {
        global.window = global;
    } finally { }

    core.registerExtension({
        global: global
    });

    global.toolkit = {
        filter: {
            object: function ( obj, rules ) {
                var i, j, prop;
                for (i in rules) {
                    for (j in rules[i]) {
                        prop = rules[i][j];
                        obj[prop] = global.toolkit.filter[i](obj[prop]);
                    }
                }
                return obj;
            },
            bn: function ( amt ) {
                amt = (Number(amt) / 1000000000).toFixed(2);
                if (isNaN(amt)) {
                    return '';
                }
                if (amt === -0) {
                    amt = 0;
                }
                if (amt < 0) {
                    amt = '(' + (-amt).toFixed(2) + ')';
                }
                return amt + ' Bn';
            },
            dateToString: function ( date ) {
                if(isFinite(date)) {
                    return date.toISOString().substring(0, 10);
                } else {
                    return 'NULL';
                }
            },
            parseNum: function ( formattedAmt ) {
                var negativeExpression = /^\([\d,\.]*\)/; //matches values in parentheses (negative values)
                var suffixVals = {
                    Bn: 1000000000,
                    Mn: 1000000,
                    Th: 1000
                };
                var i;

                if (formattedAmt.match(negativeExpression)) {
                    formattedAmt = '-' + formattedAmt.replace(/[\(\)]/g,'');    //replace (5) with -5
                }

                for (suffix in suffixVals) {
                    if(formattedAmt.search(suffix) != -1) {
                        formattedAmt = formattedAmt.replace(suffix, "").trim();
                        return parseFloat(formattedAmt) * suffixVals[suffix];
                    }
                }

                return formattedAmt;
            },
            percent: function ( amt ) {
                return (amt * 100).toFixed(1) + '%';
            },
            truncate: function ( s ) {
                var maxLength = 12;
                var ellipses = "…";
                if(s.length >= maxLength) {
                    return s.substring(0, maxLength) + ellipses;
                }
                return s;
            }
        }
    }
})
;
/*global define*/
/*jsling sloppy: true*/
define('formattedNumber',[
    'scalejs!core',
    'knockout'
], function (
    core,
    ko
) {

    

    ko.extenders.formattedNumber = function (target) {
        var result = ko.computed({
            read: function () {
                if (target() === null || target() === '') {
                    return '';
                } else {
                    return addDelimiters(target().toString());
                }
            },

            write: function (newValue) {
                if (newValue === null || newValue === '')
                {
                    target('');
                    return;
                }
                var valueToWrite = removeDelimiters(newValue.toString());
                if (!isNaN(valueToWrite) && newValue !== target()) {
                    target(valueToWrite);
                }
            }
        });

        return result;
    };

    function negativeToParentheses(nStr) {
        if(nStr.charAt(0) === '-') {
            return '(' + nStr.substring(1) + ')';
        } else {
            return nStr;
        }
    }

    function addDelimiters(nStr) {
        var negativeExpression = /^\([\d,\.]*\)/;
        nStr += '';
        // sometimes nStr has a negative value with parantheses
        // change it back to - format so this function works correctly
        if (nStr.match(negativeExpression)) {
            nStr = '-' + nStr.replace(/[\(\)]/g,'');    //replace (5) with -5
        }
        nStr = nStr.replace(/[^\d.-]/g, '');    //remove delimiters but dont convert to Number
        var dpos = nStr.indexOf('.');
        var nStrEnd = '';
        if (dpos !== -1) {
            nStrEnd = '.' + nStr.substring(dpos + 1, nStr.length);
            nStr = nStr.substring(0, dpos);
        }
        var rgx = /(\d+)(\d{3})/;
        while (rgx.test(nStr)) {
            nStr = nStr.replace(rgx, '$1,$2');
        }
        return negativeToParentheses(nStr + nStrEnd);
    }

    function removeDelimiters(nStr) {
        var negativeExpression = /^\([\d,\.]*\)/;
        if (typeof nStr == 'string' || nStr instanceof String) {
            if (nStr.match(negativeExpression)) {
                nStr = '-' + nStr.replace(/[\(\)]/g,'');    //replace (5) with -5
            }
            return Number(nStr.replace(/[^\d.-]/g, ''));
        } else {
            return nStr;
        }
    }

    //make addDelimiter function available to sandbox because it is useful
    core.registerExtension({
        formattedNumber: {
            addDelimiters: addDelimiters,
            removeDelimiters: removeDelimiters
        }
    });

});



//! moment.js
//! version : 2.8.4
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

(function (undefined) {
    /************************************
        Constants
    ************************************/

    var moment,
        VERSION = '2.8.4',
        // the global-scope this is NOT the global object in Node.js
        globalScope = typeof global !== 'undefined' ? global : this,
        oldGlobalMoment,
        round = Math.round,
        hasOwnProperty = Object.prototype.hasOwnProperty,
        i,

        YEAR = 0,
        MONTH = 1,
        DATE = 2,
        HOUR = 3,
        MINUTE = 4,
        SECOND = 5,
        MILLISECOND = 6,

        // internal storage for locale config files
        locales = {},

        // extra moment internal properties (plugins register props here)
        momentProperties = [],

        // check for nodeJS
        hasModule = (typeof module !== 'undefined' && module && module.exports),

        // ASP.NET json date format regex
        aspNetJsonRegex = /^\/?Date\((\-?\d+)/i,
        aspNetTimeSpanJsonRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,

        // from http://docs.closure-library.googlecode.com/git/closure_goog_date_date.js.source.html
        // somewhat more in line with 4.4.3.2 2004 spec, but allows decimal anywhere
        isoDurationRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,

        // format tokens
        formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Q|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|x|X|zz?|ZZ?|.)/g,
        localFormattingTokens = /(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g,

        // parsing token regexes
        parseTokenOneOrTwoDigits = /\d\d?/, // 0 - 99
        parseTokenOneToThreeDigits = /\d{1,3}/, // 0 - 999
        parseTokenOneToFourDigits = /\d{1,4}/, // 0 - 9999
        parseTokenOneToSixDigits = /[+\-]?\d{1,6}/, // -999,999 - 999,999
        parseTokenDigits = /\d+/, // nonzero number of digits
        parseTokenWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i, // any word (or two) characters or numbers including two/three word month in arabic.
        parseTokenTimezone = /Z|[\+\-]\d\d:?\d\d/gi, // +00:00 -00:00 +0000 -0000 or Z
        parseTokenT = /T/i, // T (ISO separator)
        parseTokenOffsetMs = /[\+\-]?\d+/, // 1234567890123
        parseTokenTimestampMs = /[\+\-]?\d+(\.\d{1,3})?/, // 123456789 123456789.123

        //strict parsing regexes
        parseTokenOneDigit = /\d/, // 0 - 9
        parseTokenTwoDigits = /\d\d/, // 00 - 99
        parseTokenThreeDigits = /\d{3}/, // 000 - 999
        parseTokenFourDigits = /\d{4}/, // 0000 - 9999
        parseTokenSixDigits = /[+-]?\d{6}/, // -999,999 - 999,999
        parseTokenSignedNumber = /[+-]?\d+/, // -inf - inf

        // iso 8601 regex
        // 0000-00-00 0000-W00 or 0000-W00-0 + T + 00 or 00:00 or 00:00:00 or 00:00:00.000 + +00:00 or +0000 or +00)
        isoRegex = /^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,

        isoFormat = 'YYYY-MM-DDTHH:mm:ssZ',

        isoDates = [
            ['YYYYYY-MM-DD', /[+-]\d{6}-\d{2}-\d{2}/],
            ['YYYY-MM-DD', /\d{4}-\d{2}-\d{2}/],
            ['GGGG-[W]WW-E', /\d{4}-W\d{2}-\d/],
            ['GGGG-[W]WW', /\d{4}-W\d{2}/],
            ['YYYY-DDD', /\d{4}-\d{3}/]
        ],

        // iso time formats and regexes
        isoTimes = [
            ['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d+/],
            ['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/],
            ['HH:mm', /(T| )\d\d:\d\d/],
            ['HH', /(T| )\d\d/]
        ],

        // timezone chunker '+10:00' > ['10', '00'] or '-1530' > ['-15', '30']
        parseTimezoneChunker = /([\+\-]|\d\d)/gi,

        // getter and setter names
        proxyGettersAndSetters = 'Date|Hours|Minutes|Seconds|Milliseconds'.split('|'),
        unitMillisecondFactors = {
            'Milliseconds' : 1,
            'Seconds' : 1e3,
            'Minutes' : 6e4,
            'Hours' : 36e5,
            'Days' : 864e5,
            'Months' : 2592e6,
            'Years' : 31536e6
        },

        unitAliases = {
            ms : 'millisecond',
            s : 'second',
            m : 'minute',
            h : 'hour',
            d : 'day',
            D : 'date',
            w : 'week',
            W : 'isoWeek',
            M : 'month',
            Q : 'quarter',
            y : 'year',
            DDD : 'dayOfYear',
            e : 'weekday',
            E : 'isoWeekday',
            gg: 'weekYear',
            GG: 'isoWeekYear'
        },

        camelFunctions = {
            dayofyear : 'dayOfYear',
            isoweekday : 'isoWeekday',
            isoweek : 'isoWeek',
            weekyear : 'weekYear',
            isoweekyear : 'isoWeekYear'
        },

        // format function strings
        formatFunctions = {},

        // default relative time thresholds
        relativeTimeThresholds = {
            s: 45,  // seconds to minute
            m: 45,  // minutes to hour
            h: 22,  // hours to day
            d: 26,  // days to month
            M: 11   // months to year
        },

        // tokens to ordinalize and pad
        ordinalizeTokens = 'DDD w W M D d'.split(' '),
        paddedTokens = 'M D H h m s w W'.split(' '),

        formatTokenFunctions = {
            M    : function () {
                return this.month() + 1;
            },
            MMM  : function (format) {
                return this.localeData().monthsShort(this, format);
            },
            MMMM : function (format) {
                return this.localeData().months(this, format);
            },
            D    : function () {
                return this.date();
            },
            DDD  : function () {
                return this.dayOfYear();
            },
            d    : function () {
                return this.day();
            },
            dd   : function (format) {
                return this.localeData().weekdaysMin(this, format);
            },
            ddd  : function (format) {
                return this.localeData().weekdaysShort(this, format);
            },
            dddd : function (format) {
                return this.localeData().weekdays(this, format);
            },
            w    : function () {
                return this.week();
            },
            W    : function () {
                return this.isoWeek();
            },
            YY   : function () {
                return leftZeroFill(this.year() % 100, 2);
            },
            YYYY : function () {
                return leftZeroFill(this.year(), 4);
            },
            YYYYY : function () {
                return leftZeroFill(this.year(), 5);
            },
            YYYYYY : function () {
                var y = this.year(), sign = y >= 0 ? '+' : '-';
                return sign + leftZeroFill(Math.abs(y), 6);
            },
            gg   : function () {
                return leftZeroFill(this.weekYear() % 100, 2);
            },
            gggg : function () {
                return leftZeroFill(this.weekYear(), 4);
            },
            ggggg : function () {
                return leftZeroFill(this.weekYear(), 5);
            },
            GG   : function () {
                return leftZeroFill(this.isoWeekYear() % 100, 2);
            },
            GGGG : function () {
                return leftZeroFill(this.isoWeekYear(), 4);
            },
            GGGGG : function () {
                return leftZeroFill(this.isoWeekYear(), 5);
            },
            e : function () {
                return this.weekday();
            },
            E : function () {
                return this.isoWeekday();
            },
            a    : function () {
                return this.localeData().meridiem(this.hours(), this.minutes(), true);
            },
            A    : function () {
                return this.localeData().meridiem(this.hours(), this.minutes(), false);
            },
            H    : function () {
                return this.hours();
            },
            h    : function () {
                return this.hours() % 12 || 12;
            },
            m    : function () {
                return this.minutes();
            },
            s    : function () {
                return this.seconds();
            },
            S    : function () {
                return toInt(this.milliseconds() / 100);
            },
            SS   : function () {
                return leftZeroFill(toInt(this.milliseconds() / 10), 2);
            },
            SSS  : function () {
                return leftZeroFill(this.milliseconds(), 3);
            },
            SSSS : function () {
                return leftZeroFill(this.milliseconds(), 3);
            },
            Z    : function () {
                var a = -this.zone(),
                    b = '+';
                if (a < 0) {
                    a = -a;
                    b = '-';
                }
                return b + leftZeroFill(toInt(a / 60), 2) + ':' + leftZeroFill(toInt(a) % 60, 2);
            },
            ZZ   : function () {
                var a = -this.zone(),
                    b = '+';
                if (a < 0) {
                    a = -a;
                    b = '-';
                }
                return b + leftZeroFill(toInt(a / 60), 2) + leftZeroFill(toInt(a) % 60, 2);
            },
            z : function () {
                return this.zoneAbbr();
            },
            zz : function () {
                return this.zoneName();
            },
            x    : function () {
                return this.valueOf();
            },
            X    : function () {
                return this.unix();
            },
            Q : function () {
                return this.quarter();
            }
        },

        deprecations = {},

        lists = ['months', 'monthsShort', 'weekdays', 'weekdaysShort', 'weekdaysMin'];

    // Pick the first defined of two or three arguments. dfl comes from
    // default.
    function dfl(a, b, c) {
        switch (arguments.length) {
            case 2: return a != null ? a : b;
            case 3: return a != null ? a : b != null ? b : c;
            default: throw new Error('Implement me');
        }
    }

    function hasOwnProp(a, b) {
        return hasOwnProperty.call(a, b);
    }

    function defaultParsingFlags() {
        // We need to deep clone this object, and es5 standard is not very
        // helpful.
        return {
            empty : false,
            unusedTokens : [],
            unusedInput : [],
            overflow : -2,
            charsLeftOver : 0,
            nullInput : false,
            invalidMonth : null,
            invalidFormat : false,
            userInvalidated : false,
            iso: false
        };
    }

    function printMsg(msg) {
        if (moment.suppressDeprecationWarnings === false &&
                typeof console !== 'undefined' && console.warn) {
            console.warn('Deprecation warning: ' + msg);
        }
    }

    function deprecate(msg, fn) {
        var firstTime = true;
        return extend(function () {
            if (firstTime) {
                printMsg(msg);
                firstTime = false;
            }
            return fn.apply(this, arguments);
        }, fn);
    }

    function deprecateSimple(name, msg) {
        if (!deprecations[name]) {
            printMsg(msg);
            deprecations[name] = true;
        }
    }

    function padToken(func, count) {
        return function (a) {
            return leftZeroFill(func.call(this, a), count);
        };
    }
    function ordinalizeToken(func, period) {
        return function (a) {
            return this.localeData().ordinal(func.call(this, a), period);
        };
    }

    while (ordinalizeTokens.length) {
        i = ordinalizeTokens.pop();
        formatTokenFunctions[i + 'o'] = ordinalizeToken(formatTokenFunctions[i], i);
    }
    while (paddedTokens.length) {
        i = paddedTokens.pop();
        formatTokenFunctions[i + i] = padToken(formatTokenFunctions[i], 2);
    }
    formatTokenFunctions.DDDD = padToken(formatTokenFunctions.DDD, 3);


    /************************************
        Constructors
    ************************************/

    function Locale() {
    }

    // Moment prototype object
    function Moment(config, skipOverflow) {
        if (skipOverflow !== false) {
            checkOverflow(config);
        }
        copyConfig(this, config);
        this._d = new Date(+config._d);
    }

    // Duration Constructor
    function Duration(duration) {
        var normalizedInput = normalizeObjectUnits(duration),
            years = normalizedInput.year || 0,
            quarters = normalizedInput.quarter || 0,
            months = normalizedInput.month || 0,
            weeks = normalizedInput.week || 0,
            days = normalizedInput.day || 0,
            hours = normalizedInput.hour || 0,
            minutes = normalizedInput.minute || 0,
            seconds = normalizedInput.second || 0,
            milliseconds = normalizedInput.millisecond || 0;

        // representation for dateAddRemove
        this._milliseconds = +milliseconds +
            seconds * 1e3 + // 1000
            minutes * 6e4 + // 1000 * 60
            hours * 36e5; // 1000 * 60 * 60
        // Because of dateAddRemove treats 24 hours as different from a
        // day when working around DST, we need to store them separately
        this._days = +days +
            weeks * 7;
        // It is impossible translate months into days without knowing
        // which months you are are talking about, so we have to store
        // it separately.
        this._months = +months +
            quarters * 3 +
            years * 12;

        this._data = {};

        this._locale = moment.localeData();

        this._bubble();
    }

    /************************************
        Helpers
    ************************************/


    function extend(a, b) {
        for (var i in b) {
            if (hasOwnProp(b, i)) {
                a[i] = b[i];
            }
        }

        if (hasOwnProp(b, 'toString')) {
            a.toString = b.toString;
        }

        if (hasOwnProp(b, 'valueOf')) {
            a.valueOf = b.valueOf;
        }

        return a;
    }

    function copyConfig(to, from) {
        var i, prop, val;

        if (typeof from._isAMomentObject !== 'undefined') {
            to._isAMomentObject = from._isAMomentObject;
        }
        if (typeof from._i !== 'undefined') {
            to._i = from._i;
        }
        if (typeof from._f !== 'undefined') {
            to._f = from._f;
        }
        if (typeof from._l !== 'undefined') {
            to._l = from._l;
        }
        if (typeof from._strict !== 'undefined') {
            to._strict = from._strict;
        }
        if (typeof from._tzm !== 'undefined') {
            to._tzm = from._tzm;
        }
        if (typeof from._isUTC !== 'undefined') {
            to._isUTC = from._isUTC;
        }
        if (typeof from._offset !== 'undefined') {
            to._offset = from._offset;
        }
        if (typeof from._pf !== 'undefined') {
            to._pf = from._pf;
        }
        if (typeof from._locale !== 'undefined') {
            to._locale = from._locale;
        }

        if (momentProperties.length > 0) {
            for (i in momentProperties) {
                prop = momentProperties[i];
                val = from[prop];
                if (typeof val !== 'undefined') {
                    to[prop] = val;
                }
            }
        }

        return to;
    }

    function absRound(number) {
        if (number < 0) {
            return Math.ceil(number);
        } else {
            return Math.floor(number);
        }
    }

    // left zero fill a number
    // see http://jsperf.com/left-zero-filling for performance comparison
    function leftZeroFill(number, targetLength, forceSign) {
        var output = '' + Math.abs(number),
            sign = number >= 0;

        while (output.length < targetLength) {
            output = '0' + output;
        }
        return (sign ? (forceSign ? '+' : '') : '-') + output;
    }

    function positiveMomentsDifference(base, other) {
        var res = {milliseconds: 0, months: 0};

        res.months = other.month() - base.month() +
            (other.year() - base.year()) * 12;
        if (base.clone().add(res.months, 'M').isAfter(other)) {
            --res.months;
        }

        res.milliseconds = +other - +(base.clone().add(res.months, 'M'));

        return res;
    }

    function momentsDifference(base, other) {
        var res;
        other = makeAs(other, base);
        if (base.isBefore(other)) {
            res = positiveMomentsDifference(base, other);
        } else {
            res = positiveMomentsDifference(other, base);
            res.milliseconds = -res.milliseconds;
            res.months = -res.months;
        }

        return res;
    }

    // TODO: remove 'name' arg after deprecation is removed
    function createAdder(direction, name) {
        return function (val, period) {
            var dur, tmp;
            //invert the arguments, but complain about it
            if (period !== null && !isNaN(+period)) {
                deprecateSimple(name, 'moment().' + name  + '(period, number) is deprecated. Please use moment().' + name + '(number, period).');
                tmp = val; val = period; period = tmp;
            }

            val = typeof val === 'string' ? +val : val;
            dur = moment.duration(val, period);
            addOrSubtractDurationFromMoment(this, dur, direction);
            return this;
        };
    }

    function addOrSubtractDurationFromMoment(mom, duration, isAdding, updateOffset) {
        var milliseconds = duration._milliseconds,
            days = duration._days,
            months = duration._months;
        updateOffset = updateOffset == null ? true : updateOffset;

        if (milliseconds) {
            mom._d.setTime(+mom._d + milliseconds * isAdding);
        }
        if (days) {
            rawSetter(mom, 'Date', rawGetter(mom, 'Date') + days * isAdding);
        }
        if (months) {
            rawMonthSetter(mom, rawGetter(mom, 'Month') + months * isAdding);
        }
        if (updateOffset) {
            moment.updateOffset(mom, days || months);
        }
    }

    // check if is an array
    function isArray(input) {
        return Object.prototype.toString.call(input) === '[object Array]';
    }

    function isDate(input) {
        return Object.prototype.toString.call(input) === '[object Date]' ||
            input instanceof Date;
    }

    // compare two arrays, return the number of differences
    function compareArrays(array1, array2, dontConvert) {
        var len = Math.min(array1.length, array2.length),
            lengthDiff = Math.abs(array1.length - array2.length),
            diffs = 0,
            i;
        for (i = 0; i < len; i++) {
            if ((dontConvert && array1[i] !== array2[i]) ||
                (!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
                diffs++;
            }
        }
        return diffs + lengthDiff;
    }

    function normalizeUnits(units) {
        if (units) {
            var lowered = units.toLowerCase().replace(/(.)s$/, '$1');
            units = unitAliases[units] || camelFunctions[lowered] || lowered;
        }
        return units;
    }

    function normalizeObjectUnits(inputObject) {
        var normalizedInput = {},
            normalizedProp,
            prop;

        for (prop in inputObject) {
            if (hasOwnProp(inputObject, prop)) {
                normalizedProp = normalizeUnits(prop);
                if (normalizedProp) {
                    normalizedInput[normalizedProp] = inputObject[prop];
                }
            }
        }

        return normalizedInput;
    }

    function makeList(field) {
        var count, setter;

        if (field.indexOf('week') === 0) {
            count = 7;
            setter = 'day';
        }
        else if (field.indexOf('month') === 0) {
            count = 12;
            setter = 'month';
        }
        else {
            return;
        }

        moment[field] = function (format, index) {
            var i, getter,
                method = moment._locale[field],
                results = [];

            if (typeof format === 'number') {
                index = format;
                format = undefined;
            }

            getter = function (i) {
                var m = moment().utc().set(setter, i);
                return method.call(moment._locale, m, format || '');
            };

            if (index != null) {
                return getter(index);
            }
            else {
                for (i = 0; i < count; i++) {
                    results.push(getter(i));
                }
                return results;
            }
        };
    }

    function toInt(argumentForCoercion) {
        var coercedNumber = +argumentForCoercion,
            value = 0;

        if (coercedNumber !== 0 && isFinite(coercedNumber)) {
            if (coercedNumber >= 0) {
                value = Math.floor(coercedNumber);
            } else {
                value = Math.ceil(coercedNumber);
            }
        }

        return value;
    }

    function daysInMonth(year, month) {
        return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    }

    function weeksInYear(year, dow, doy) {
        return weekOfYear(moment([year, 11, 31 + dow - doy]), dow, doy).week;
    }

    function daysInYear(year) {
        return isLeapYear(year) ? 366 : 365;
    }

    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    function checkOverflow(m) {
        var overflow;
        if (m._a && m._pf.overflow === -2) {
            overflow =
                m._a[MONTH] < 0 || m._a[MONTH] > 11 ? MONTH :
                m._a[DATE] < 1 || m._a[DATE] > daysInMonth(m._a[YEAR], m._a[MONTH]) ? DATE :
                m._a[HOUR] < 0 || m._a[HOUR] > 24 ||
                    (m._a[HOUR] === 24 && (m._a[MINUTE] !== 0 ||
                                           m._a[SECOND] !== 0 ||
                                           m._a[MILLISECOND] !== 0)) ? HOUR :
                m._a[MINUTE] < 0 || m._a[MINUTE] > 59 ? MINUTE :
                m._a[SECOND] < 0 || m._a[SECOND] > 59 ? SECOND :
                m._a[MILLISECOND] < 0 || m._a[MILLISECOND] > 999 ? MILLISECOND :
                -1;

            if (m._pf._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
                overflow = DATE;
            }

            m._pf.overflow = overflow;
        }
    }

    function isValid(m) {
        if (m._isValid == null) {
            m._isValid = !isNaN(m._d.getTime()) &&
                m._pf.overflow < 0 &&
                !m._pf.empty &&
                !m._pf.invalidMonth &&
                !m._pf.nullInput &&
                !m._pf.invalidFormat &&
                !m._pf.userInvalidated;

            if (m._strict) {
                m._isValid = m._isValid &&
                    m._pf.charsLeftOver === 0 &&
                    m._pf.unusedTokens.length === 0 &&
                    m._pf.bigHour === undefined;
            }
        }
        return m._isValid;
    }

    function normalizeLocale(key) {
        return key ? key.toLowerCase().replace('_', '-') : key;
    }

    // pick the locale from the array
    // try ['en-au', 'en-gb'] as 'en-au', 'en-gb', 'en', as in move through the list trying each
    // substring from most specific to least, but move to the next array item if it's a more specific variant than the current root
    function chooseLocale(names) {
        var i = 0, j, next, locale, split;

        while (i < names.length) {
            split = normalizeLocale(names[i]).split('-');
            j = split.length;
            next = normalizeLocale(names[i + 1]);
            next = next ? next.split('-') : null;
            while (j > 0) {
                locale = loadLocale(split.slice(0, j).join('-'));
                if (locale) {
                    return locale;
                }
                if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
                    //the next array item is better than a shallower substring of this one
                    break;
                }
                j--;
            }
            i++;
        }
        return null;
    }

    function loadLocale(name) {
        var oldLocale = null;
        if (!locales[name] && hasModule) {
            try {
                oldLocale = moment.locale();
                require('./locale/' + name);
                // because defineLocale currently also sets the global locale, we want to undo that for lazy loaded locales
                moment.locale(oldLocale);
            } catch (e) { }
        }
        return locales[name];
    }

    // Return a moment from input, that is local/utc/zone equivalent to model.
    function makeAs(input, model) {
        var res, diff;
        if (model._isUTC) {
            res = model.clone();
            diff = (moment.isMoment(input) || isDate(input) ?
                    +input : +moment(input)) - (+res);
            // Use low-level api, because this fn is low-level api.
            res._d.setTime(+res._d + diff);
            moment.updateOffset(res, false);
            return res;
        } else {
            return moment(input).local();
        }
    }

    /************************************
        Locale
    ************************************/


    extend(Locale.prototype, {

        set : function (config) {
            var prop, i;
            for (i in config) {
                prop = config[i];
                if (typeof prop === 'function') {
                    this[i] = prop;
                } else {
                    this['_' + i] = prop;
                }
            }
            // Lenient ordinal parsing accepts just a number in addition to
            // number + (possibly) stuff coming from _ordinalParseLenient.
            this._ordinalParseLenient = new RegExp(this._ordinalParse.source + '|' + /\d{1,2}/.source);
        },

        _months : 'January_February_March_April_May_June_July_August_September_October_November_December'.split('_'),
        months : function (m) {
            return this._months[m.month()];
        },

        _monthsShort : 'Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec'.split('_'),
        monthsShort : function (m) {
            return this._monthsShort[m.month()];
        },

        monthsParse : function (monthName, format, strict) {
            var i, mom, regex;

            if (!this._monthsParse) {
                this._monthsParse = [];
                this._longMonthsParse = [];
                this._shortMonthsParse = [];
            }

            for (i = 0; i < 12; i++) {
                // make the regex if we don't have it already
                mom = moment.utc([2000, i]);
                if (strict && !this._longMonthsParse[i]) {
                    this._longMonthsParse[i] = new RegExp('^' + this.months(mom, '').replace('.', '') + '$', 'i');
                    this._shortMonthsParse[i] = new RegExp('^' + this.monthsShort(mom, '').replace('.', '') + '$', 'i');
                }
                if (!strict && !this._monthsParse[i]) {
                    regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
                    this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
                }
                // test the regex
                if (strict && format === 'MMMM' && this._longMonthsParse[i].test(monthName)) {
                    return i;
                } else if (strict && format === 'MMM' && this._shortMonthsParse[i].test(monthName)) {
                    return i;
                } else if (!strict && this._monthsParse[i].test(monthName)) {
                    return i;
                }
            }
        },

        _weekdays : 'Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday'.split('_'),
        weekdays : function (m) {
            return this._weekdays[m.day()];
        },

        _weekdaysShort : 'Sun_Mon_Tue_Wed_Thu_Fri_Sat'.split('_'),
        weekdaysShort : function (m) {
            return this._weekdaysShort[m.day()];
        },

        _weekdaysMin : 'Su_Mo_Tu_We_Th_Fr_Sa'.split('_'),
        weekdaysMin : function (m) {
            return this._weekdaysMin[m.day()];
        },

        weekdaysParse : function (weekdayName) {
            var i, mom, regex;

            if (!this._weekdaysParse) {
                this._weekdaysParse = [];
            }

            for (i = 0; i < 7; i++) {
                // make the regex if we don't have it already
                if (!this._weekdaysParse[i]) {
                    mom = moment([2000, 1]).day(i);
                    regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
                    this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
                }
                // test the regex
                if (this._weekdaysParse[i].test(weekdayName)) {
                    return i;
                }
            }
        },

        _longDateFormat : {
            LTS : 'h:mm:ss A',
            LT : 'h:mm A',
            L : 'MM/DD/YYYY',
            LL : 'MMMM D, YYYY',
            LLL : 'MMMM D, YYYY LT',
            LLLL : 'dddd, MMMM D, YYYY LT'
        },
        longDateFormat : function (key) {
            var output = this._longDateFormat[key];
            if (!output && this._longDateFormat[key.toUpperCase()]) {
                output = this._longDateFormat[key.toUpperCase()].replace(/MMMM|MM|DD|dddd/g, function (val) {
                    return val.slice(1);
                });
                this._longDateFormat[key] = output;
            }
            return output;
        },

        isPM : function (input) {
            // IE8 Quirks Mode & IE7 Standards Mode do not allow accessing strings like arrays
            // Using charAt should be more compatible.
            return ((input + '').toLowerCase().charAt(0) === 'p');
        },

        _meridiemParse : /[ap]\.?m?\.?/i,
        meridiem : function (hours, minutes, isLower) {
            if (hours > 11) {
                return isLower ? 'pm' : 'PM';
            } else {
                return isLower ? 'am' : 'AM';
            }
        },

        _calendar : {
            sameDay : '[Today at] LT',
            nextDay : '[Tomorrow at] LT',
            nextWeek : 'dddd [at] LT',
            lastDay : '[Yesterday at] LT',
            lastWeek : '[Last] dddd [at] LT',
            sameElse : 'L'
        },
        calendar : function (key, mom, now) {
            var output = this._calendar[key];
            return typeof output === 'function' ? output.apply(mom, [now]) : output;
        },

        _relativeTime : {
            future : 'in %s',
            past : '%s ago',
            s : 'a few seconds',
            m : 'a minute',
            mm : '%d minutes',
            h : 'an hour',
            hh : '%d hours',
            d : 'a day',
            dd : '%d days',
            M : 'a month',
            MM : '%d months',
            y : 'a year',
            yy : '%d years'
        },

        relativeTime : function (number, withoutSuffix, string, isFuture) {
            var output = this._relativeTime[string];
            return (typeof output === 'function') ?
                output(number, withoutSuffix, string, isFuture) :
                output.replace(/%d/i, number);
        },

        pastFuture : function (diff, output) {
            var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
            return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
        },

        ordinal : function (number) {
            return this._ordinal.replace('%d', number);
        },
        _ordinal : '%d',
        _ordinalParse : /\d{1,2}/,

        preparse : function (string) {
            return string;
        },

        postformat : function (string) {
            return string;
        },

        week : function (mom) {
            return weekOfYear(mom, this._week.dow, this._week.doy).week;
        },

        _week : {
            dow : 0, // Sunday is the first day of the week.
            doy : 6  // The week that contains Jan 1st is the first week of the year.
        },

        _invalidDate: 'Invalid date',
        invalidDate: function () {
            return this._invalidDate;
        }
    });

    /************************************
        Formatting
    ************************************/


    function removeFormattingTokens(input) {
        if (input.match(/\[[\s\S]/)) {
            return input.replace(/^\[|\]$/g, '');
        }
        return input.replace(/\\/g, '');
    }

    function makeFormatFunction(format) {
        var array = format.match(formattingTokens), i, length;

        for (i = 0, length = array.length; i < length; i++) {
            if (formatTokenFunctions[array[i]]) {
                array[i] = formatTokenFunctions[array[i]];
            } else {
                array[i] = removeFormattingTokens(array[i]);
            }
        }

        return function (mom) {
            var output = '';
            for (i = 0; i < length; i++) {
                output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
            }
            return output;
        };
    }

    // format date using native date object
    function formatMoment(m, format) {
        if (!m.isValid()) {
            return m.localeData().invalidDate();
        }

        format = expandFormat(format, m.localeData());

        if (!formatFunctions[format]) {
            formatFunctions[format] = makeFormatFunction(format);
        }

        return formatFunctions[format](m);
    }

    function expandFormat(format, locale) {
        var i = 5;

        function replaceLongDateFormatTokens(input) {
            return locale.longDateFormat(input) || input;
        }

        localFormattingTokens.lastIndex = 0;
        while (i >= 0 && localFormattingTokens.test(format)) {
            format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
            localFormattingTokens.lastIndex = 0;
            i -= 1;
        }

        return format;
    }


    /************************************
        Parsing
    ************************************/


    // get the regex to find the next token
    function getParseRegexForToken(token, config) {
        var a, strict = config._strict;
        switch (token) {
        case 'Q':
            return parseTokenOneDigit;
        case 'DDDD':
            return parseTokenThreeDigits;
        case 'YYYY':
        case 'GGGG':
        case 'gggg':
            return strict ? parseTokenFourDigits : parseTokenOneToFourDigits;
        case 'Y':
        case 'G':
        case 'g':
            return parseTokenSignedNumber;
        case 'YYYYYY':
        case 'YYYYY':
        case 'GGGGG':
        case 'ggggg':
            return strict ? parseTokenSixDigits : parseTokenOneToSixDigits;
        case 'S':
            if (strict) {
                return parseTokenOneDigit;
            }
            /* falls through */
        case 'SS':
            if (strict) {
                return parseTokenTwoDigits;
            }
            /* falls through */
        case 'SSS':
            if (strict) {
                return parseTokenThreeDigits;
            }
            /* falls through */
        case 'DDD':
            return parseTokenOneToThreeDigits;
        case 'MMM':
        case 'MMMM':
        case 'dd':
        case 'ddd':
        case 'dddd':
            return parseTokenWord;
        case 'a':
        case 'A':
            return config._locale._meridiemParse;
        case 'x':
            return parseTokenOffsetMs;
        case 'X':
            return parseTokenTimestampMs;
        case 'Z':
        case 'ZZ':
            return parseTokenTimezone;
        case 'T':
            return parseTokenT;
        case 'SSSS':
            return parseTokenDigits;
        case 'MM':
        case 'DD':
        case 'YY':
        case 'GG':
        case 'gg':
        case 'HH':
        case 'hh':
        case 'mm':
        case 'ss':
        case 'ww':
        case 'WW':
            return strict ? parseTokenTwoDigits : parseTokenOneOrTwoDigits;
        case 'M':
        case 'D':
        case 'd':
        case 'H':
        case 'h':
        case 'm':
        case 's':
        case 'w':
        case 'W':
        case 'e':
        case 'E':
            return parseTokenOneOrTwoDigits;
        case 'Do':
            return strict ? config._locale._ordinalParse : config._locale._ordinalParseLenient;
        default :
            a = new RegExp(regexpEscape(unescapeFormat(token.replace('\\', '')), 'i'));
            return a;
        }
    }

    function timezoneMinutesFromString(string) {
        string = string || '';
        var possibleTzMatches = (string.match(parseTokenTimezone) || []),
            tzChunk = possibleTzMatches[possibleTzMatches.length - 1] || [],
            parts = (tzChunk + '').match(parseTimezoneChunker) || ['-', 0, 0],
            minutes = +(parts[1] * 60) + toInt(parts[2]);

        return parts[0] === '+' ? -minutes : minutes;
    }

    // function to convert string input to date
    function addTimeToArrayFromToken(token, input, config) {
        var a, datePartArray = config._a;

        switch (token) {
        // QUARTER
        case 'Q':
            if (input != null) {
                datePartArray[MONTH] = (toInt(input) - 1) * 3;
            }
            break;
        // MONTH
        case 'M' : // fall through to MM
        case 'MM' :
            if (input != null) {
                datePartArray[MONTH] = toInt(input) - 1;
            }
            break;
        case 'MMM' : // fall through to MMMM
        case 'MMMM' :
            a = config._locale.monthsParse(input, token, config._strict);
            // if we didn't find a month name, mark the date as invalid.
            if (a != null) {
                datePartArray[MONTH] = a;
            } else {
                config._pf.invalidMonth = input;
            }
            break;
        // DAY OF MONTH
        case 'D' : // fall through to DD
        case 'DD' :
            if (input != null) {
                datePartArray[DATE] = toInt(input);
            }
            break;
        case 'Do' :
            if (input != null) {
                datePartArray[DATE] = toInt(parseInt(
                            input.match(/\d{1,2}/)[0], 10));
            }
            break;
        // DAY OF YEAR
        case 'DDD' : // fall through to DDDD
        case 'DDDD' :
            if (input != null) {
                config._dayOfYear = toInt(input);
            }

            break;
        // YEAR
        case 'YY' :
            datePartArray[YEAR] = moment.parseTwoDigitYear(input);
            break;
        case 'YYYY' :
        case 'YYYYY' :
        case 'YYYYYY' :
            datePartArray[YEAR] = toInt(input);
            break;
        // AM / PM
        case 'a' : // fall through to A
        case 'A' :
            config._isPm = config._locale.isPM(input);
            break;
        // HOUR
        case 'h' : // fall through to hh
        case 'hh' :
            config._pf.bigHour = true;
            /* falls through */
        case 'H' : // fall through to HH
        case 'HH' :
            datePartArray[HOUR] = toInt(input);
            break;
        // MINUTE
        case 'm' : // fall through to mm
        case 'mm' :
            datePartArray[MINUTE] = toInt(input);
            break;
        // SECOND
        case 's' : // fall through to ss
        case 'ss' :
            datePartArray[SECOND] = toInt(input);
            break;
        // MILLISECOND
        case 'S' :
        case 'SS' :
        case 'SSS' :
        case 'SSSS' :
            datePartArray[MILLISECOND] = toInt(('0.' + input) * 1000);
            break;
        // UNIX OFFSET (MILLISECONDS)
        case 'x':
            config._d = new Date(toInt(input));
            break;
        // UNIX TIMESTAMP WITH MS
        case 'X':
            config._d = new Date(parseFloat(input) * 1000);
            break;
        // TIMEZONE
        case 'Z' : // fall through to ZZ
        case 'ZZ' :
            config._useUTC = true;
            config._tzm = timezoneMinutesFromString(input);
            break;
        // WEEKDAY - human
        case 'dd':
        case 'ddd':
        case 'dddd':
            a = config._locale.weekdaysParse(input);
            // if we didn't get a weekday name, mark the date as invalid
            if (a != null) {
                config._w = config._w || {};
                config._w['d'] = a;
            } else {
                config._pf.invalidWeekday = input;
            }
            break;
        // WEEK, WEEK DAY - numeric
        case 'w':
        case 'ww':
        case 'W':
        case 'WW':
        case 'd':
        case 'e':
        case 'E':
            token = token.substr(0, 1);
            /* falls through */
        case 'gggg':
        case 'GGGG':
        case 'GGGGG':
            token = token.substr(0, 2);
            if (input) {
                config._w = config._w || {};
                config._w[token] = toInt(input);
            }
            break;
        case 'gg':
        case 'GG':
            config._w = config._w || {};
            config._w[token] = moment.parseTwoDigitYear(input);
        }
    }

    function dayOfYearFromWeekInfo(config) {
        var w, weekYear, week, weekday, dow, doy, temp;

        w = config._w;
        if (w.GG != null || w.W != null || w.E != null) {
            dow = 1;
            doy = 4;

            // TODO: We need to take the current isoWeekYear, but that depends on
            // how we interpret now (local, utc, fixed offset). So create
            // a now version of current config (take local/utc/offset flags, and
            // create now).
            weekYear = dfl(w.GG, config._a[YEAR], weekOfYear(moment(), 1, 4).year);
            week = dfl(w.W, 1);
            weekday = dfl(w.E, 1);
        } else {
            dow = config._locale._week.dow;
            doy = config._locale._week.doy;

            weekYear = dfl(w.gg, config._a[YEAR], weekOfYear(moment(), dow, doy).year);
            week = dfl(w.w, 1);

            if (w.d != null) {
                // weekday -- low day numbers are considered next week
                weekday = w.d;
                if (weekday < dow) {
                    ++week;
                }
            } else if (w.e != null) {
                // local weekday -- counting starts from begining of week
                weekday = w.e + dow;
            } else {
                // default to begining of week
                weekday = dow;
            }
        }
        temp = dayOfYearFromWeeks(weekYear, week, weekday, doy, dow);

        config._a[YEAR] = temp.year;
        config._dayOfYear = temp.dayOfYear;
    }

    // convert an array to a date.
    // the array should mirror the parameters below
    // note: all values past the year are optional and will default to the lowest possible value.
    // [year, month, day , hour, minute, second, millisecond]
    function dateFromConfig(config) {
        var i, date, input = [], currentDate, yearToUse;

        if (config._d) {
            return;
        }

        currentDate = currentDateArray(config);

        //compute day of the year from weeks and weekdays
        if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
            dayOfYearFromWeekInfo(config);
        }

        //if the day of the year is set, figure out what it is
        if (config._dayOfYear) {
            yearToUse = dfl(config._a[YEAR], currentDate[YEAR]);

            if (config._dayOfYear > daysInYear(yearToUse)) {
                config._pf._overflowDayOfYear = true;
            }

            date = makeUTCDate(yearToUse, 0, config._dayOfYear);
            config._a[MONTH] = date.getUTCMonth();
            config._a[DATE] = date.getUTCDate();
        }

        // Default to current date.
        // * if no year, month, day of month are given, default to today
        // * if day of month is given, default month and year
        // * if month is given, default only year
        // * if year is given, don't default anything
        for (i = 0; i < 3 && config._a[i] == null; ++i) {
            config._a[i] = input[i] = currentDate[i];
        }

        // Zero out whatever was not defaulted, including time
        for (; i < 7; i++) {
            config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
        }

        // Check for 24:00:00.000
        if (config._a[HOUR] === 24 &&
                config._a[MINUTE] === 0 &&
                config._a[SECOND] === 0 &&
                config._a[MILLISECOND] === 0) {
            config._nextDay = true;
            config._a[HOUR] = 0;
        }

        config._d = (config._useUTC ? makeUTCDate : makeDate).apply(null, input);
        // Apply timezone offset from input. The actual zone can be changed
        // with parseZone.
        if (config._tzm != null) {
            config._d.setUTCMinutes(config._d.getUTCMinutes() + config._tzm);
        }

        if (config._nextDay) {
            config._a[HOUR] = 24;
        }
    }

    function dateFromObject(config) {
        var normalizedInput;

        if (config._d) {
            return;
        }

        normalizedInput = normalizeObjectUnits(config._i);
        config._a = [
            normalizedInput.year,
            normalizedInput.month,
            normalizedInput.day || normalizedInput.date,
            normalizedInput.hour,
            normalizedInput.minute,
            normalizedInput.second,
            normalizedInput.millisecond
        ];

        dateFromConfig(config);
    }

    function currentDateArray(config) {
        var now = new Date();
        if (config._useUTC) {
            return [
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate()
            ];
        } else {
            return [now.getFullYear(), now.getMonth(), now.getDate()];
        }
    }

    // date from string and format string
    function makeDateFromStringAndFormat(config) {
        if (config._f === moment.ISO_8601) {
            parseISO(config);
            return;
        }

        config._a = [];
        config._pf.empty = true;

        // This array is used to make a Date, either with `new Date` or `Date.UTC`
        var string = '' + config._i,
            i, parsedInput, tokens, token, skipped,
            stringLength = string.length,
            totalParsedInputLength = 0;

        tokens = expandFormat(config._f, config._locale).match(formattingTokens) || [];

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            parsedInput = (string.match(getParseRegexForToken(token, config)) || [])[0];
            if (parsedInput) {
                skipped = string.substr(0, string.indexOf(parsedInput));
                if (skipped.length > 0) {
                    config._pf.unusedInput.push(skipped);
                }
                string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
                totalParsedInputLength += parsedInput.length;
            }
            // don't parse if it's not a known token
            if (formatTokenFunctions[token]) {
                if (parsedInput) {
                    config._pf.empty = false;
                }
                else {
                    config._pf.unusedTokens.push(token);
                }
                addTimeToArrayFromToken(token, parsedInput, config);
            }
            else if (config._strict && !parsedInput) {
                config._pf.unusedTokens.push(token);
            }
        }

        // add remaining unparsed input length to the string
        config._pf.charsLeftOver = stringLength - totalParsedInputLength;
        if (string.length > 0) {
            config._pf.unusedInput.push(string);
        }

        // clear _12h flag if hour is <= 12
        if (config._pf.bigHour === true && config._a[HOUR] <= 12) {
            config._pf.bigHour = undefined;
        }
        // handle am pm
        if (config._isPm && config._a[HOUR] < 12) {
            config._a[HOUR] += 12;
        }
        // if is 12 am, change hours to 0
        if (config._isPm === false && config._a[HOUR] === 12) {
            config._a[HOUR] = 0;
        }
        dateFromConfig(config);
        checkOverflow(config);
    }

    function unescapeFormat(s) {
        return s.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function (matched, p1, p2, p3, p4) {
            return p1 || p2 || p3 || p4;
        });
    }

    // Code from http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
    function regexpEscape(s) {
        return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    // date from string and array of format strings
    function makeDateFromStringAndArray(config) {
        var tempConfig,
            bestMoment,

            scoreToBeat,
            i,
            currentScore;

        if (config._f.length === 0) {
            config._pf.invalidFormat = true;
            config._d = new Date(NaN);
            return;
        }

        for (i = 0; i < config._f.length; i++) {
            currentScore = 0;
            tempConfig = copyConfig({}, config);
            if (config._useUTC != null) {
                tempConfig._useUTC = config._useUTC;
            }
            tempConfig._pf = defaultParsingFlags();
            tempConfig._f = config._f[i];
            makeDateFromStringAndFormat(tempConfig);

            if (!isValid(tempConfig)) {
                continue;
            }

            // if there is any input that was not parsed add a penalty for that format
            currentScore += tempConfig._pf.charsLeftOver;

            //or tokens
            currentScore += tempConfig._pf.unusedTokens.length * 10;

            tempConfig._pf.score = currentScore;

            if (scoreToBeat == null || currentScore < scoreToBeat) {
                scoreToBeat = currentScore;
                bestMoment = tempConfig;
            }
        }

        extend(config, bestMoment || tempConfig);
    }

    // date from iso format
    function parseISO(config) {
        var i, l,
            string = config._i,
            match = isoRegex.exec(string);

        if (match) {
            config._pf.iso = true;
            for (i = 0, l = isoDates.length; i < l; i++) {
                if (isoDates[i][1].exec(string)) {
                    // match[5] should be 'T' or undefined
                    config._f = isoDates[i][0] + (match[6] || ' ');
                    break;
                }
            }
            for (i = 0, l = isoTimes.length; i < l; i++) {
                if (isoTimes[i][1].exec(string)) {
                    config._f += isoTimes[i][0];
                    break;
                }
            }
            if (string.match(parseTokenTimezone)) {
                config._f += 'Z';
            }
            makeDateFromStringAndFormat(config);
        } else {
            config._isValid = false;
        }
    }

    // date from iso format or fallback
    function makeDateFromString(config) {
        parseISO(config);
        if (config._isValid === false) {
            delete config._isValid;
            moment.createFromInputFallback(config);
        }
    }

    function map(arr, fn) {
        var res = [], i;
        for (i = 0; i < arr.length; ++i) {
            res.push(fn(arr[i], i));
        }
        return res;
    }

    function makeDateFromInput(config) {
        var input = config._i, matched;
        if (input === undefined) {
            config._d = new Date();
        } else if (isDate(input)) {
            config._d = new Date(+input);
        } else if ((matched = aspNetJsonRegex.exec(input)) !== null) {
            config._d = new Date(+matched[1]);
        } else if (typeof input === 'string') {
            makeDateFromString(config);
        } else if (isArray(input)) {
            config._a = map(input.slice(0), function (obj) {
                return parseInt(obj, 10);
            });
            dateFromConfig(config);
        } else if (typeof(input) === 'object') {
            dateFromObject(config);
        } else if (typeof(input) === 'number') {
            // from milliseconds
            config._d = new Date(input);
        } else {
            moment.createFromInputFallback(config);
        }
    }

    function makeDate(y, m, d, h, M, s, ms) {
        //can't just apply() to create a date:
        //http://stackoverflow.com/questions/181348/instantiating-a-javascript-object-by-calling-prototype-constructor-apply
        var date = new Date(y, m, d, h, M, s, ms);

        //the date constructor doesn't accept years < 1970
        if (y < 1970) {
            date.setFullYear(y);
        }
        return date;
    }

    function makeUTCDate(y) {
        var date = new Date(Date.UTC.apply(null, arguments));
        if (y < 1970) {
            date.setUTCFullYear(y);
        }
        return date;
    }

    function parseWeekday(input, locale) {
        if (typeof input === 'string') {
            if (!isNaN(input)) {
                input = parseInt(input, 10);
            }
            else {
                input = locale.weekdaysParse(input);
                if (typeof input !== 'number') {
                    return null;
                }
            }
        }
        return input;
    }

    /************************************
        Relative Time
    ************************************/


    // helper function for moment.fn.from, moment.fn.fromNow, and moment.duration.fn.humanize
    function substituteTimeAgo(string, number, withoutSuffix, isFuture, locale) {
        return locale.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
    }

    function relativeTime(posNegDuration, withoutSuffix, locale) {
        var duration = moment.duration(posNegDuration).abs(),
            seconds = round(duration.as('s')),
            minutes = round(duration.as('m')),
            hours = round(duration.as('h')),
            days = round(duration.as('d')),
            months = round(duration.as('M')),
            years = round(duration.as('y')),

            args = seconds < relativeTimeThresholds.s && ['s', seconds] ||
                minutes === 1 && ['m'] ||
                minutes < relativeTimeThresholds.m && ['mm', minutes] ||
                hours === 1 && ['h'] ||
                hours < relativeTimeThresholds.h && ['hh', hours] ||
                days === 1 && ['d'] ||
                days < relativeTimeThresholds.d && ['dd', days] ||
                months === 1 && ['M'] ||
                months < relativeTimeThresholds.M && ['MM', months] ||
                years === 1 && ['y'] || ['yy', years];

        args[2] = withoutSuffix;
        args[3] = +posNegDuration > 0;
        args[4] = locale;
        return substituteTimeAgo.apply({}, args);
    }


    /************************************
        Week of Year
    ************************************/


    // firstDayOfWeek       0 = sun, 6 = sat
    //                      the day of the week that starts the week
    //                      (usually sunday or monday)
    // firstDayOfWeekOfYear 0 = sun, 6 = sat
    //                      the first week is the week that contains the first
    //                      of this day of the week
    //                      (eg. ISO weeks use thursday (4))
    function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
        var end = firstDayOfWeekOfYear - firstDayOfWeek,
            daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
            adjustedMoment;


        if (daysToDayOfWeek > end) {
            daysToDayOfWeek -= 7;
        }

        if (daysToDayOfWeek < end - 7) {
            daysToDayOfWeek += 7;
        }

        adjustedMoment = moment(mom).add(daysToDayOfWeek, 'd');
        return {
            week: Math.ceil(adjustedMoment.dayOfYear() / 7),
            year: adjustedMoment.year()
        };
    }

    //http://en.wikipedia.org/wiki/ISO_week_date#Calculating_a_date_given_the_year.2C_week_number_and_weekday
    function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
        var d = makeUTCDate(year, 0, 1).getUTCDay(), daysToAdd, dayOfYear;

        d = d === 0 ? 7 : d;
        weekday = weekday != null ? weekday : firstDayOfWeek;
        daysToAdd = firstDayOfWeek - d + (d > firstDayOfWeekOfYear ? 7 : 0) - (d < firstDayOfWeek ? 7 : 0);
        dayOfYear = 7 * (week - 1) + (weekday - firstDayOfWeek) + daysToAdd + 1;

        return {
            year: dayOfYear > 0 ? year : year - 1,
            dayOfYear: dayOfYear > 0 ?  dayOfYear : daysInYear(year - 1) + dayOfYear
        };
    }

    /************************************
        Top Level Functions
    ************************************/

    function makeMoment(config) {
        var input = config._i,
            format = config._f,
            res;

        config._locale = config._locale || moment.localeData(config._l);

        if (input === null || (format === undefined && input === '')) {
            return moment.invalid({nullInput: true});
        }

        if (typeof input === 'string') {
            config._i = input = config._locale.preparse(input);
        }

        if (moment.isMoment(input)) {
            return new Moment(input, true);
        } else if (format) {
            if (isArray(format)) {
                makeDateFromStringAndArray(config);
            } else {
                makeDateFromStringAndFormat(config);
            }
        } else {
            makeDateFromInput(config);
        }

        res = new Moment(config);
        if (res._nextDay) {
            // Adding is smart enough around DST
            res.add(1, 'd');
            res._nextDay = undefined;
        }

        return res;
    }

    moment = function (input, format, locale, strict) {
        var c;

        if (typeof(locale) === 'boolean') {
            strict = locale;
            locale = undefined;
        }
        // object construction must be done this way.
        // https://github.com/moment/moment/issues/1423
        c = {};
        c._isAMomentObject = true;
        c._i = input;
        c._f = format;
        c._l = locale;
        c._strict = strict;
        c._isUTC = false;
        c._pf = defaultParsingFlags();

        return makeMoment(c);
    };

    moment.suppressDeprecationWarnings = false;

    moment.createFromInputFallback = deprecate(
        'moment construction falls back to js Date. This is ' +
        'discouraged and will be removed in upcoming major ' +
        'release. Please refer to ' +
        'https://github.com/moment/moment/issues/1407 for more info.',
        function (config) {
            config._d = new Date(config._i + (config._useUTC ? ' UTC' : ''));
        }
    );

    // Pick a moment m from moments so that m[fn](other) is true for all
    // other. This relies on the function fn to be transitive.
    //
    // moments should either be an array of moment objects or an array, whose
    // first element is an array of moment objects.
    function pickBy(fn, moments) {
        var res, i;
        if (moments.length === 1 && isArray(moments[0])) {
            moments = moments[0];
        }
        if (!moments.length) {
            return moment();
        }
        res = moments[0];
        for (i = 1; i < moments.length; ++i) {
            if (moments[i][fn](res)) {
                res = moments[i];
            }
        }
        return res;
    }

    moment.min = function () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isBefore', args);
    };

    moment.max = function () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isAfter', args);
    };

    // creating with utc
    moment.utc = function (input, format, locale, strict) {
        var c;

        if (typeof(locale) === 'boolean') {
            strict = locale;
            locale = undefined;
        }
        // object construction must be done this way.
        // https://github.com/moment/moment/issues/1423
        c = {};
        c._isAMomentObject = true;
        c._useUTC = true;
        c._isUTC = true;
        c._l = locale;
        c._i = input;
        c._f = format;
        c._strict = strict;
        c._pf = defaultParsingFlags();

        return makeMoment(c).utc();
    };

    // creating with unix timestamp (in seconds)
    moment.unix = function (input) {
        return moment(input * 1000);
    };

    // duration
    moment.duration = function (input, key) {
        var duration = input,
            // matching against regexp is expensive, do it on demand
            match = null,
            sign,
            ret,
            parseIso,
            diffRes;

        if (moment.isDuration(input)) {
            duration = {
                ms: input._milliseconds,
                d: input._days,
                M: input._months
            };
        } else if (typeof input === 'number') {
            duration = {};
            if (key) {
                duration[key] = input;
            } else {
                duration.milliseconds = input;
            }
        } else if (!!(match = aspNetTimeSpanJsonRegex.exec(input))) {
            sign = (match[1] === '-') ? -1 : 1;
            duration = {
                y: 0,
                d: toInt(match[DATE]) * sign,
                h: toInt(match[HOUR]) * sign,
                m: toInt(match[MINUTE]) * sign,
                s: toInt(match[SECOND]) * sign,
                ms: toInt(match[MILLISECOND]) * sign
            };
        } else if (!!(match = isoDurationRegex.exec(input))) {
            sign = (match[1] === '-') ? -1 : 1;
            parseIso = function (inp) {
                // We'd normally use ~~inp for this, but unfortunately it also
                // converts floats to ints.
                // inp may be undefined, so careful calling replace on it.
                var res = inp && parseFloat(inp.replace(',', '.'));
                // apply sign while we're at it
                return (isNaN(res) ? 0 : res) * sign;
            };
            duration = {
                y: parseIso(match[2]),
                M: parseIso(match[3]),
                d: parseIso(match[4]),
                h: parseIso(match[5]),
                m: parseIso(match[6]),
                s: parseIso(match[7]),
                w: parseIso(match[8])
            };
        } else if (typeof duration === 'object' &&
                ('from' in duration || 'to' in duration)) {
            diffRes = momentsDifference(moment(duration.from), moment(duration.to));

            duration = {};
            duration.ms = diffRes.milliseconds;
            duration.M = diffRes.months;
        }

        ret = new Duration(duration);

        if (moment.isDuration(input) && hasOwnProp(input, '_locale')) {
            ret._locale = input._locale;
        }

        return ret;
    };

    // version number
    moment.version = VERSION;

    // default format
    moment.defaultFormat = isoFormat;

    // constant that refers to the ISO standard
    moment.ISO_8601 = function () {};

    // Plugins that add properties should also add the key here (null value),
    // so we can properly clone ourselves.
    moment.momentProperties = momentProperties;

    // This function will be called whenever a moment is mutated.
    // It is intended to keep the offset in sync with the timezone.
    moment.updateOffset = function () {};

    // This function allows you to set a threshold for relative time strings
    moment.relativeTimeThreshold = function (threshold, limit) {
        if (relativeTimeThresholds[threshold] === undefined) {
            return false;
        }
        if (limit === undefined) {
            return relativeTimeThresholds[threshold];
        }
        relativeTimeThresholds[threshold] = limit;
        return true;
    };

    moment.lang = deprecate(
        'moment.lang is deprecated. Use moment.locale instead.',
        function (key, value) {
            return moment.locale(key, value);
        }
    );

    // This function will load locale and then set the global locale.  If
    // no arguments are passed in, it will simply return the current global
    // locale key.
    moment.locale = function (key, values) {
        var data;
        if (key) {
            if (typeof(values) !== 'undefined') {
                data = moment.defineLocale(key, values);
            }
            else {
                data = moment.localeData(key);
            }

            if (data) {
                moment.duration._locale = moment._locale = data;
            }
        }

        return moment._locale._abbr;
    };

    moment.defineLocale = function (name, values) {
        if (values !== null) {
            values.abbr = name;
            if (!locales[name]) {
                locales[name] = new Locale();
            }
            locales[name].set(values);

            // backwards compat for now: also set the locale
            moment.locale(name);

            return locales[name];
        } else {
            // useful for testing
            delete locales[name];
            return null;
        }
    };

    moment.langData = deprecate(
        'moment.langData is deprecated. Use moment.localeData instead.',
        function (key) {
            return moment.localeData(key);
        }
    );

    // returns locale data
    moment.localeData = function (key) {
        var locale;

        if (key && key._locale && key._locale._abbr) {
            key = key._locale._abbr;
        }

        if (!key) {
            return moment._locale;
        }

        if (!isArray(key)) {
            //short-circuit everything else
            locale = loadLocale(key);
            if (locale) {
                return locale;
            }
            key = [key];
        }

        return chooseLocale(key);
    };

    // compare moment object
    moment.isMoment = function (obj) {
        return obj instanceof Moment ||
            (obj != null && hasOwnProp(obj, '_isAMomentObject'));
    };

    // for typechecking Duration objects
    moment.isDuration = function (obj) {
        return obj instanceof Duration;
    };

    for (i = lists.length - 1; i >= 0; --i) {
        makeList(lists[i]);
    }

    moment.normalizeUnits = function (units) {
        return normalizeUnits(units);
    };

    moment.invalid = function (flags) {
        var m = moment.utc(NaN);
        if (flags != null) {
            extend(m._pf, flags);
        }
        else {
            m._pf.userInvalidated = true;
        }

        return m;
    };

    moment.parseZone = function () {
        return moment.apply(null, arguments).parseZone();
    };

    moment.parseTwoDigitYear = function (input) {
        return toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
    };

    /************************************
        Moment Prototype
    ************************************/


    extend(moment.fn = Moment.prototype, {

        clone : function () {
            return moment(this);
        },

        valueOf : function () {
            return +this._d + ((this._offset || 0) * 60000);
        },

        unix : function () {
            return Math.floor(+this / 1000);
        },

        toString : function () {
            return this.clone().locale('en').format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ');
        },

        toDate : function () {
            return this._offset ? new Date(+this) : this._d;
        },

        toISOString : function () {
            var m = moment(this).utc();
            if (0 < m.year() && m.year() <= 9999) {
                if ('function' === typeof Date.prototype.toISOString) {
                    // native implementation is ~50x faster, use it when we can
                    return this.toDate().toISOString();
                } else {
                    return formatMoment(m, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
                }
            } else {
                return formatMoment(m, 'YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
            }
        },

        toArray : function () {
            var m = this;
            return [
                m.year(),
                m.month(),
                m.date(),
                m.hours(),
                m.minutes(),
                m.seconds(),
                m.milliseconds()
            ];
        },

        isValid : function () {
            return isValid(this);
        },

        isDSTShifted : function () {
            if (this._a) {
                return this.isValid() && compareArrays(this._a, (this._isUTC ? moment.utc(this._a) : moment(this._a)).toArray()) > 0;
            }

            return false;
        },

        parsingFlags : function () {
            return extend({}, this._pf);
        },

        invalidAt: function () {
            return this._pf.overflow;
        },

        utc : function (keepLocalTime) {
            return this.zone(0, keepLocalTime);
        },

        local : function (keepLocalTime) {
            if (this._isUTC) {
                this.zone(0, keepLocalTime);
                this._isUTC = false;

                if (keepLocalTime) {
                    this.add(this._dateTzOffset(), 'm');
                }
            }
            return this;
        },

        format : function (inputString) {
            var output = formatMoment(this, inputString || moment.defaultFormat);
            return this.localeData().postformat(output);
        },

        add : createAdder(1, 'add'),

        subtract : createAdder(-1, 'subtract'),

        diff : function (input, units, asFloat) {
            var that = makeAs(input, this),
                zoneDiff = (this.zone() - that.zone()) * 6e4,
                diff, output, daysAdjust;

            units = normalizeUnits(units);

            if (units === 'year' || units === 'month') {
                // average number of days in the months in the given dates
                diff = (this.daysInMonth() + that.daysInMonth()) * 432e5; // 24 * 60 * 60 * 1000 / 2
                // difference in months
                output = ((this.year() - that.year()) * 12) + (this.month() - that.month());
                // adjust by taking difference in days, average number of days
                // and dst in the given months.
                daysAdjust = (this - moment(this).startOf('month')) -
                    (that - moment(that).startOf('month'));
                // same as above but with zones, to negate all dst
                daysAdjust -= ((this.zone() - moment(this).startOf('month').zone()) -
                        (that.zone() - moment(that).startOf('month').zone())) * 6e4;
                output += daysAdjust / diff;
                if (units === 'year') {
                    output = output / 12;
                }
            } else {
                diff = (this - that);
                output = units === 'second' ? diff / 1e3 : // 1000
                    units === 'minute' ? diff / 6e4 : // 1000 * 60
                    units === 'hour' ? diff / 36e5 : // 1000 * 60 * 60
                    units === 'day' ? (diff - zoneDiff) / 864e5 : // 1000 * 60 * 60 * 24, negate dst
                    units === 'week' ? (diff - zoneDiff) / 6048e5 : // 1000 * 60 * 60 * 24 * 7, negate dst
                    diff;
            }
            return asFloat ? output : absRound(output);
        },

        from : function (time, withoutSuffix) {
            return moment.duration({to: this, from: time}).locale(this.locale()).humanize(!withoutSuffix);
        },

        fromNow : function (withoutSuffix) {
            return this.from(moment(), withoutSuffix);
        },

        calendar : function (time) {
            // We want to compare the start of today, vs this.
            // Getting start-of-today depends on whether we're zone'd or not.
            var now = time || moment(),
                sod = makeAs(now, this).startOf('day'),
                diff = this.diff(sod, 'days', true),
                format = diff < -6 ? 'sameElse' :
                    diff < -1 ? 'lastWeek' :
                    diff < 0 ? 'lastDay' :
                    diff < 1 ? 'sameDay' :
                    diff < 2 ? 'nextDay' :
                    diff < 7 ? 'nextWeek' : 'sameElse';
            return this.format(this.localeData().calendar(format, this, moment(now)));
        },

        isLeapYear : function () {
            return isLeapYear(this.year());
        },

        isDST : function () {
            return (this.zone() < this.clone().month(0).zone() ||
                this.zone() < this.clone().month(5).zone());
        },

        day : function (input) {
            var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
            if (input != null) {
                input = parseWeekday(input, this.localeData());
                return this.add(input - day, 'd');
            } else {
                return day;
            }
        },

        month : makeAccessor('Month', true),

        startOf : function (units) {
            units = normalizeUnits(units);
            // the following switch intentionally omits break keywords
            // to utilize falling through the cases.
            switch (units) {
            case 'year':
                this.month(0);
                /* falls through */
            case 'quarter':
            case 'month':
                this.date(1);
                /* falls through */
            case 'week':
            case 'isoWeek':
            case 'day':
                this.hours(0);
                /* falls through */
            case 'hour':
                this.minutes(0);
                /* falls through */
            case 'minute':
                this.seconds(0);
                /* falls through */
            case 'second':
                this.milliseconds(0);
                /* falls through */
            }

            // weeks are a special case
            if (units === 'week') {
                this.weekday(0);
            } else if (units === 'isoWeek') {
                this.isoWeekday(1);
            }

            // quarters are also special
            if (units === 'quarter') {
                this.month(Math.floor(this.month() / 3) * 3);
            }

            return this;
        },

        endOf: function (units) {
            units = normalizeUnits(units);
            if (units === undefined || units === 'millisecond') {
                return this;
            }
            return this.startOf(units).add(1, (units === 'isoWeek' ? 'week' : units)).subtract(1, 'ms');
        },

        isAfter: function (input, units) {
            var inputMs;
            units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
            if (units === 'millisecond') {
                input = moment.isMoment(input) ? input : moment(input);
                return +this > +input;
            } else {
                inputMs = moment.isMoment(input) ? +input : +moment(input);
                return inputMs < +this.clone().startOf(units);
            }
        },

        isBefore: function (input, units) {
            var inputMs;
            units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
            if (units === 'millisecond') {
                input = moment.isMoment(input) ? input : moment(input);
                return +this < +input;
            } else {
                inputMs = moment.isMoment(input) ? +input : +moment(input);
                return +this.clone().endOf(units) < inputMs;
            }
        },

        isSame: function (input, units) {
            var inputMs;
            units = normalizeUnits(units || 'millisecond');
            if (units === 'millisecond') {
                input = moment.isMoment(input) ? input : moment(input);
                return +this === +input;
            } else {
                inputMs = +moment(input);
                return +(this.clone().startOf(units)) <= inputMs && inputMs <= +(this.clone().endOf(units));
            }
        },

        min: deprecate(
                 'moment().min is deprecated, use moment.min instead. https://github.com/moment/moment/issues/1548',
                 function (other) {
                     other = moment.apply(null, arguments);
                     return other < this ? this : other;
                 }
         ),

        max: deprecate(
                'moment().max is deprecated, use moment.max instead. https://github.com/moment/moment/issues/1548',
                function (other) {
                    other = moment.apply(null, arguments);
                    return other > this ? this : other;
                }
        ),

        // keepLocalTime = true means only change the timezone, without
        // affecting the local hour. So 5:31:26 +0300 --[zone(2, true)]-->
        // 5:31:26 +0200 It is possible that 5:31:26 doesn't exist int zone
        // +0200, so we adjust the time as needed, to be valid.
        //
        // Keeping the time actually adds/subtracts (one hour)
        // from the actual represented time. That is why we call updateOffset
        // a second time. In case it wants us to change the offset again
        // _changeInProgress == true case, then we have to adjust, because
        // there is no such time in the given timezone.
        zone : function (input, keepLocalTime) {
            var offset = this._offset || 0,
                localAdjust;
            if (input != null) {
                if (typeof input === 'string') {
                    input = timezoneMinutesFromString(input);
                }
                if (Math.abs(input) < 16) {
                    input = input * 60;
                }
                if (!this._isUTC && keepLocalTime) {
                    localAdjust = this._dateTzOffset();
                }
                this._offset = input;
                this._isUTC = true;
                if (localAdjust != null) {
                    this.subtract(localAdjust, 'm');
                }
                if (offset !== input) {
                    if (!keepLocalTime || this._changeInProgress) {
                        addOrSubtractDurationFromMoment(this,
                                moment.duration(offset - input, 'm'), 1, false);
                    } else if (!this._changeInProgress) {
                        this._changeInProgress = true;
                        moment.updateOffset(this, true);
                        this._changeInProgress = null;
                    }
                }
            } else {
                return this._isUTC ? offset : this._dateTzOffset();
            }
            return this;
        },

        zoneAbbr : function () {
            return this._isUTC ? 'UTC' : '';
        },

        zoneName : function () {
            return this._isUTC ? 'Coordinated Universal Time' : '';
        },

        parseZone : function () {
            if (this._tzm) {
                this.zone(this._tzm);
            } else if (typeof this._i === 'string') {
                this.zone(this._i);
            }
            return this;
        },

        hasAlignedHourOffset : function (input) {
            if (!input) {
                input = 0;
            }
            else {
                input = moment(input).zone();
            }

            return (this.zone() - input) % 60 === 0;
        },

        daysInMonth : function () {
            return daysInMonth(this.year(), this.month());
        },

        dayOfYear : function (input) {
            var dayOfYear = round((moment(this).startOf('day') - moment(this).startOf('year')) / 864e5) + 1;
            return input == null ? dayOfYear : this.add((input - dayOfYear), 'd');
        },

        quarter : function (input) {
            return input == null ? Math.ceil((this.month() + 1) / 3) : this.month((input - 1) * 3 + this.month() % 3);
        },

        weekYear : function (input) {
            var year = weekOfYear(this, this.localeData()._week.dow, this.localeData()._week.doy).year;
            return input == null ? year : this.add((input - year), 'y');
        },

        isoWeekYear : function (input) {
            var year = weekOfYear(this, 1, 4).year;
            return input == null ? year : this.add((input - year), 'y');
        },

        week : function (input) {
            var week = this.localeData().week(this);
            return input == null ? week : this.add((input - week) * 7, 'd');
        },

        isoWeek : function (input) {
            var week = weekOfYear(this, 1, 4).week;
            return input == null ? week : this.add((input - week) * 7, 'd');
        },

        weekday : function (input) {
            var weekday = (this.day() + 7 - this.localeData()._week.dow) % 7;
            return input == null ? weekday : this.add(input - weekday, 'd');
        },

        isoWeekday : function (input) {
            // behaves the same as moment#day except
            // as a getter, returns 7 instead of 0 (1-7 range instead of 0-6)
            // as a setter, sunday should belong to the previous week.
            return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
        },

        isoWeeksInYear : function () {
            return weeksInYear(this.year(), 1, 4);
        },

        weeksInYear : function () {
            var weekInfo = this.localeData()._week;
            return weeksInYear(this.year(), weekInfo.dow, weekInfo.doy);
        },

        get : function (units) {
            units = normalizeUnits(units);
            return this[units]();
        },

        set : function (units, value) {
            units = normalizeUnits(units);
            if (typeof this[units] === 'function') {
                this[units](value);
            }
            return this;
        },

        // If passed a locale key, it will set the locale for this
        // instance.  Otherwise, it will return the locale configuration
        // variables for this instance.
        locale : function (key) {
            var newLocaleData;

            if (key === undefined) {
                return this._locale._abbr;
            } else {
                newLocaleData = moment.localeData(key);
                if (newLocaleData != null) {
                    this._locale = newLocaleData;
                }
                return this;
            }
        },

        lang : deprecate(
            'moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.',
            function (key) {
                if (key === undefined) {
                    return this.localeData();
                } else {
                    return this.locale(key);
                }
            }
        ),

        localeData : function () {
            return this._locale;
        },

        _dateTzOffset : function () {
            // On Firefox.24 Date#getTimezoneOffset returns a floating point.
            // https://github.com/moment/moment/pull/1871
            return Math.round(this._d.getTimezoneOffset() / 15) * 15;
        }
    });

    function rawMonthSetter(mom, value) {
        var dayOfMonth;

        // TODO: Move this out of here!
        if (typeof value === 'string') {
            value = mom.localeData().monthsParse(value);
            // TODO: Another silent failure?
            if (typeof value !== 'number') {
                return mom;
            }
        }

        dayOfMonth = Math.min(mom.date(),
                daysInMonth(mom.year(), value));
        mom._d['set' + (mom._isUTC ? 'UTC' : '') + 'Month'](value, dayOfMonth);
        return mom;
    }

    function rawGetter(mom, unit) {
        return mom._d['get' + (mom._isUTC ? 'UTC' : '') + unit]();
    }

    function rawSetter(mom, unit, value) {
        if (unit === 'Month') {
            return rawMonthSetter(mom, value);
        } else {
            return mom._d['set' + (mom._isUTC ? 'UTC' : '') + unit](value);
        }
    }

    function makeAccessor(unit, keepTime) {
        return function (value) {
            if (value != null) {
                rawSetter(this, unit, value);
                moment.updateOffset(this, keepTime);
                return this;
            } else {
                return rawGetter(this, unit);
            }
        };
    }

    moment.fn.millisecond = moment.fn.milliseconds = makeAccessor('Milliseconds', false);
    moment.fn.second = moment.fn.seconds = makeAccessor('Seconds', false);
    moment.fn.minute = moment.fn.minutes = makeAccessor('Minutes', false);
    // Setting the hour should keep the time, because the user explicitly
    // specified which hour he wants. So trying to maintain the same hour (in
    // a new timezone) makes sense. Adding/subtracting hours does not follow
    // this rule.
    moment.fn.hour = moment.fn.hours = makeAccessor('Hours', true);
    // moment.fn.month is defined separately
    moment.fn.date = makeAccessor('Date', true);
    moment.fn.dates = deprecate('dates accessor is deprecated. Use date instead.', makeAccessor('Date', true));
    moment.fn.year = makeAccessor('FullYear', true);
    moment.fn.years = deprecate('years accessor is deprecated. Use year instead.', makeAccessor('FullYear', true));

    // add plural methods
    moment.fn.days = moment.fn.day;
    moment.fn.months = moment.fn.month;
    moment.fn.weeks = moment.fn.week;
    moment.fn.isoWeeks = moment.fn.isoWeek;
    moment.fn.quarters = moment.fn.quarter;

    // add aliased format methods
    moment.fn.toJSON = moment.fn.toISOString;

    /************************************
        Duration Prototype
    ************************************/


    function daysToYears (days) {
        // 400 years have 146097 days (taking into account leap year rules)
        return days * 400 / 146097;
    }

    function yearsToDays (years) {
        // years * 365 + absRound(years / 4) -
        //     absRound(years / 100) + absRound(years / 400);
        return years * 146097 / 400;
    }

    extend(moment.duration.fn = Duration.prototype, {

        _bubble : function () {
            var milliseconds = this._milliseconds,
                days = this._days,
                months = this._months,
                data = this._data,
                seconds, minutes, hours, years = 0;

            // The following code bubbles up values, see the tests for
            // examples of what that means.
            data.milliseconds = milliseconds % 1000;

            seconds = absRound(milliseconds / 1000);
            data.seconds = seconds % 60;

            minutes = absRound(seconds / 60);
            data.minutes = minutes % 60;

            hours = absRound(minutes / 60);
            data.hours = hours % 24;

            days += absRound(hours / 24);

            // Accurately convert days to years, assume start from year 0.
            years = absRound(daysToYears(days));
            days -= absRound(yearsToDays(years));

            // 30 days to a month
            // TODO (iskren): Use anchor date (like 1st Jan) to compute this.
            months += absRound(days / 30);
            days %= 30;

            // 12 months -> 1 year
            years += absRound(months / 12);
            months %= 12;

            data.days = days;
            data.months = months;
            data.years = years;
        },

        abs : function () {
            this._milliseconds = Math.abs(this._milliseconds);
            this._days = Math.abs(this._days);
            this._months = Math.abs(this._months);

            this._data.milliseconds = Math.abs(this._data.milliseconds);
            this._data.seconds = Math.abs(this._data.seconds);
            this._data.minutes = Math.abs(this._data.minutes);
            this._data.hours = Math.abs(this._data.hours);
            this._data.months = Math.abs(this._data.months);
            this._data.years = Math.abs(this._data.years);

            return this;
        },

        weeks : function () {
            return absRound(this.days() / 7);
        },

        valueOf : function () {
            return this._milliseconds +
              this._days * 864e5 +
              (this._months % 12) * 2592e6 +
              toInt(this._months / 12) * 31536e6;
        },

        humanize : function (withSuffix) {
            var output = relativeTime(this, !withSuffix, this.localeData());

            if (withSuffix) {
                output = this.localeData().pastFuture(+this, output);
            }

            return this.localeData().postformat(output);
        },

        add : function (input, val) {
            // supports only 2.0-style add(1, 's') or add(moment)
            var dur = moment.duration(input, val);

            this._milliseconds += dur._milliseconds;
            this._days += dur._days;
            this._months += dur._months;

            this._bubble();

            return this;
        },

        subtract : function (input, val) {
            var dur = moment.duration(input, val);

            this._milliseconds -= dur._milliseconds;
            this._days -= dur._days;
            this._months -= dur._months;

            this._bubble();

            return this;
        },

        get : function (units) {
            units = normalizeUnits(units);
            return this[units.toLowerCase() + 's']();
        },

        as : function (units) {
            var days, months;
            units = normalizeUnits(units);

            if (units === 'month' || units === 'year') {
                days = this._days + this._milliseconds / 864e5;
                months = this._months + daysToYears(days) * 12;
                return units === 'month' ? months : months / 12;
            } else {
                // handle milliseconds separately because of floating point math errors (issue #1867)
                days = this._days + Math.round(yearsToDays(this._months / 12));
                switch (units) {
                    case 'week': return days / 7 + this._milliseconds / 6048e5;
                    case 'day': return days + this._milliseconds / 864e5;
                    case 'hour': return days * 24 + this._milliseconds / 36e5;
                    case 'minute': return days * 24 * 60 + this._milliseconds / 6e4;
                    case 'second': return days * 24 * 60 * 60 + this._milliseconds / 1000;
                    // Math.floor prevents floating point math errors here
                    case 'millisecond': return Math.floor(days * 24 * 60 * 60 * 1000) + this._milliseconds;
                    default: throw new Error('Unknown unit ' + units);
                }
            }
        },

        lang : moment.fn.lang,
        locale : moment.fn.locale,

        toIsoString : deprecate(
            'toIsoString() is deprecated. Please use toISOString() instead ' +
            '(notice the capitals)',
            function () {
                return this.toISOString();
            }
        ),

        toISOString : function () {
            // inspired by https://github.com/dordille/moment-isoduration/blob/master/moment.isoduration.js
            var years = Math.abs(this.years()),
                months = Math.abs(this.months()),
                days = Math.abs(this.days()),
                hours = Math.abs(this.hours()),
                minutes = Math.abs(this.minutes()),
                seconds = Math.abs(this.seconds() + this.milliseconds() / 1000);

            if (!this.asSeconds()) {
                // this is the same as C#'s (Noda) and python (isodate)...
                // but not other JS (goog.date)
                return 'P0D';
            }

            return (this.asSeconds() < 0 ? '-' : '') +
                'P' +
                (years ? years + 'Y' : '') +
                (months ? months + 'M' : '') +
                (days ? days + 'D' : '') +
                ((hours || minutes || seconds) ? 'T' : '') +
                (hours ? hours + 'H' : '') +
                (minutes ? minutes + 'M' : '') +
                (seconds ? seconds + 'S' : '');
        },

        localeData : function () {
            return this._locale;
        }
    });

    moment.duration.fn.toString = moment.duration.fn.toISOString;

    function makeDurationGetter(name) {
        moment.duration.fn[name] = function () {
            return this._data[name];
        };
    }

    for (i in unitMillisecondFactors) {
        if (hasOwnProp(unitMillisecondFactors, i)) {
            makeDurationGetter(i.toLowerCase());
        }
    }

    moment.duration.fn.asMilliseconds = function () {
        return this.as('ms');
    };
    moment.duration.fn.asSeconds = function () {
        return this.as('s');
    };
    moment.duration.fn.asMinutes = function () {
        return this.as('m');
    };
    moment.duration.fn.asHours = function () {
        return this.as('h');
    };
    moment.duration.fn.asDays = function () {
        return this.as('d');
    };
    moment.duration.fn.asWeeks = function () {
        return this.as('weeks');
    };
    moment.duration.fn.asMonths = function () {
        return this.as('M');
    };
    moment.duration.fn.asYears = function () {
        return this.as('y');
    };

    /************************************
        Default Locale
    ************************************/


    // Set default locale, other locale will inherit from English.
    moment.locale('en', {
        ordinalParse: /\d{1,2}(th|st|nd|rd)/,
        ordinal : function (number) {
            var b = number % 10,
                output = (toInt(number % 100 / 10) === 1) ? 'th' :
                (b === 1) ? 'st' :
                (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
            return number + output;
        }
    });

    /* EMBED_LOCALES */

    /************************************
        Exposing Moment
    ************************************/

    function makeGlobal(shouldDeprecate) {
        /*global ender:false */
        if (typeof ender !== 'undefined') {
            return;
        }
        oldGlobalMoment = globalScope.moment;
        if (shouldDeprecate) {
            globalScope.moment = deprecate(
                    'Accessing Moment through the global scope is ' +
                    'deprecated, and will be removed in an upcoming ' +
                    'release.',
                    moment);
        } else {
            globalScope.moment = moment;
        }
    }

    // CommonJS module is defined
    if (hasModule) {
        module.exports = moment;
    } else if (typeof define === 'function' && define.amd) {
        define('moment', ['require','exports','module'],function (require, exports, module) {
            if (module.config && module.config() && module.config().noGlobal === true) {
                // release the global variable
                globalScope.moment = oldGlobalMoment;
            }

            return moment;
        });
        makeGlobal(true);
    } else {
        makeGlobal();
    }
}).call(this);


define('app/page/module',[
    'scalejs.sandbox!page',
    'moment'
], function (
    sandbox,
    moment
) {

    

    var m_date = sandbox.mvvm.observable(null);
    sandbox.flag.register('global.date', m_date);

    var get = _.memoize(function ( id ) {

        var m_link = {
            id      : id,
            display : sandbox.mvvm.observable(true),
            title   : sandbox.mvvm.observable(''),
            status  : sandbox.mvvm.observable(''),
            reset   : sandbox.mvvm.observable(function () {})  //reset module by undrilling
        };

        return {
            date: m_date,
            tile: {
                link: m_link
            },
            page: {
                link: m_link,
                template: id + '_template'
            },
            reset : m_link.reset
        };

    });

    sandbox.flag.register('page.create', _.memoize(function ( id, setup ) {

        var item = get(id);

        setup(item);

        console.debug('page: ' + id + ': registering to jump');
        sandbox.flag.wait('jump.register.tile', [item.tile]);

        console.debug('page: ' + id + ': registering to layout');
        sandbox.flag.wait('layout.register.panel', [item.page]);

    }));

    sandbox.flag.register('page.get', function ( id, give ) {
        give(get(id));

    });

    return void 0;

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

(function(){(function(a,d){var c,b;d=d();if(typeof define==="function"&&define.amd){return define("easing",d)}else{if(typeof exports==="object"){return module.exports=d}else{b="easing";c=a[b];a[b]=d;return a[b].noConflict=function(){var e;e=a[b];a[b]=c;return e}}}})(window||this,function(){var a,b,c;c={};c.a=0.1;c.p=0.4;if(!c.a||c.a<1){c.a=1;c.s=c.p/4}else{c.s=c.p*Math.asin(1/c.a)/(2*Math.PI)}a={};a.s=1.70158;a.h=1.70158*1.525;b={};b.k=7.5625;b.a=1/2.75;b.b=2/2.75;b.ob=0.75;b.sb=1.5/2.75;b.c=2.5/2.75;b.oc=0.9375;b.sc=2.25/2.75;b.od=0.984375;b.sd=2.625/2.75;b.f=function(d){switch(false){case !(d<b.a):return b.k*d*d;case !(d<b.b):return b.k*(d-=b.sb)*d+b.ob;case !(d<b.c):return b.k*(d-=b.sc)*d+b.oc;default:return b.k*(d-=b.sd)*d+b.od}};return{linear:function(d){return d},"quad-in":function(d){return d*d},"quad-out":function(d){return d*(2-d)},quad:function(d){if((d*=2)<1){return 0.5*d*d}return -0.5*(--d*(d-2)-1)},"cubic-in":function(d){return d*d*d},"cubic-out":function(d){return(--d)*d*d+1},cubic:function(d){if((d*=2)<1){return 0.5*d*d*d}return 0.5*((d-=2)*d*d+2)},"quart-in":function(d){return d*d*d*d},"quart-out":function(d){return 1-(--d)*d*d*d},quart:function(d){if((d*=2)<1){return 0.5*d*d*d*d}return -0.5*((d-=2)*d*d*d-2)},"quint-in":function(d){return d*d*d*d*d},"quint-out":function(d){return 1+(--d)*d*d*d*d},quint:function(d){if((d*=2)<1){return 0.5*d*d*d*d*d}return 0.5*((d-=2)*d*d*d*d+2)},"sin-in":function(d){return 1-Math.cos(d*Math.PI/2)},"sin-out":function(d){return Math.sin(d*Math.PI/2)},sin:function(d){return 0.5*(1-Math.cos(Math.PI*d))},"expo-in":function(d){if(d===0){return 0}else{return Math.pow(1024,d-1)}},"expo-out":function(d){if(d===1){return 1}else{return 1-Math.pow(2,-10*d)}},expo:function(d){if(d===0||d===1){return d}if((d*=2)<1){return 0.5*Math.pow(1024,d-1)}return 0.5*(-Math.pow(2,-10*(d-1))+2)},"circ-in":function(d){return 1-Math.sqrt(1-d*d)},"circ-out":function(d){return Math.sqrt(1-(--d*d))},circ:function(d){if((d*=2)<1){return -0.5*(Math.sqrt(1-d*d)-1)}return 0.5*(Math.sqrt(1-(d-=2)*d)+1)},"elastic-in":function(d){if(d===0||d===1){return d}return -(c.a*Math.pow(2,10*(d-=1))*Math.sin((d-c.s)*(2*Math.PI)/c.p))},"elastic-out":function(d){if(d===0||d===1){return d}return c.a*Math.pow(2,-10*d)*Math.sin((d-c.s)*(2*Math.PI)/c.p)+1},elastic:function(d){if((d*=2)<1){return -0.5*(c.a*Math.pow(2,10*(d-=1))*Math.sin((d-c.s)*(2*Math.PI)/c.p))}return c.a*Math.pow(2,-10*(d-=1))*Math.sin((d-c.s)*(2*Math.PI)/c.p)*0.5+1},"back-in":function(d){return d*d*((a.s+1)*d-a.s)},"back-out":function(d){return --d*d*((a.s+1)*d+a.s)+1},back:function(d){if((d*=2)<1){return 0.5*(d*d*((a.h+1)*d-a.h))}return 0.5*((d-=2)*d*((a.h+1)*d+a.h)+2)},"bounce-in":function(d){return 1-b.f(1-d)},"bounce-out":b.f,bounce:function(d){if(d<0.5){return 1-b.f(1-d*2)*0.5}return b.f(d*2-1)*0.5+0.5}}})}).call(this);
(function(){(function(a,d){var c,b;if(typeof define==="function"&&define.amd){return define("anim",["easing"],d)}else{if(typeof exports==="object"){return module.exports=d(require("easing"))}else{b="anim";c=a[b];a[b]=d(a.easing);return a[b].noConflict=function(){var e;e=a[b];a[b]=c;return e}}}})(window||this,(function(a){return function(d){var g,c,b,h,e,f;if(!d){return console.error("options are required for anim")}if(!d.next){return console.error("next callback is requred for anim")}if(!d.ease){d.ease="linear"}if(!d.speed){d.speed=500}if(!d.step){d.step=16}f=0;c=null;g=a[d.ease];if(!a){console.warn("easing function ",d.ease,"not found");g=function(i){return i}}e=function(){if(!c){return}clearInterval(c);f=0;c=null;return typeof d.after==="function"?d.after():void 0};b=function(){var i;i=Math.min((f+=d.step)/d.speed,1);d.next(g(i),f);if(i===1){return e()}};h=function(){if(c){e()}if(typeof d.before==="function"){d.before()}return c=setInterval(b,d.step)};if(d.auto){h()}return{start:h,stop:e}}}))}).call(this);
(function(){var a=[].slice;(function(b,e){var d,c;if(typeof define==="function"&&define.amd){return define("scroll",["hammer","anim"],e)}else{if(typeof exports==="object"){return module.exports=e(require("hammer"),require("anim"))}else{c="scroll";d=b[c];b[c]=e(b.Hammer,b.anim);return b[c].noConflict=function(){var f;f=b[c];b[c]=d;return f}}}})(window||this,(function(c,l,f){var j,d,i,b,m,h,k,e;j={HORIZONTAL:0,VERTICAL:1,supported:!!document.querySelector&&!!document.querySelectorAll&&!!document.addEventListener&&!!document.removeEventListener};i={events:new l.Manager(document.body,{recognizers:[[l.Tap]]}),pages:null,defaults:{speed:500,easing:"expo",offset:0,url:true,before:null,after:null}};k=function(o,g,n){if(g===j.VERTICAL){return o.scrollTop=n}else{return o.scrollLeft=n}};h=function(n,g){if(g===j.VERTICAL){return n.scrollTop}else{return n.scrollLeft}};d=function(n,g,q,o){var p;p=0;if(q.offsetParent){while(q){p+=g===j.VERTICAL?q.offsetTop:q.offsetLeft;q=q.offsetParent}}return Math.max(p-o,0)};e=function(n,g){if(g||String(g)==="true"){return typeof history.pushState==="function"?history.pushState({pos:n.id},"",window.location.pathname+n):void 0}};b=function(o){var g,n;n={};g=o.getAttribute("data-scroll-ease");if(g){n.easing=g}g=o.getAttribute("data-scroll-speed");if(g){n.speed=Number(g)}g=o.getAttribute("data-scroll-offset");if(g){n.offset=Number(g)}g=o.getAttribute("data-scroll-what");if(g){n.page=String(g)}g=o.getAttribute("data-scroll-direction");if(g){n.direction=g==="horizontal"?j.HORIZONTAL:j.VERTICAL}g=o.getAttribute("data-scroll-url");if(g){n.url=String(g)==="true"}return n};j.animate=function(s,n){var r,p,q,o,g;if(!i.pages){return console.warn("module not initialized")}q=i.pages[n.page]||i.pages.body;o=c.merge(q.settings||{},n||{});o.offset=parseInt(o.offset,10);o.speed=parseInt(o.speed,10);o.easing=String(o.easing);p=document.querySelector(s);if(!p){return console.warn("element not found matching",s)}g=h(q.elem,q.direction);r=d(q.elem,q.direction,p,o.offset)-g;if(!r){return}if(g===0){k(0)}e(s,o.url);return f({auto:true,ease:o.easing,speed:o.speed,next:function(u){return k(q.elem,q.direction,Math.floor(g+r*u))}})};m=function(g){var n;n=c.closest(g.target,"[data-scroll]");if(n){g.preventDefault();if(i.scrolling){i.scrolling.stop()}return i.scrolling=j.animate(n.getAttribute("data-scroll"),b(n))}};j.destroy=function(){return i.events.off("tap")};j.init=function(p){var t,o,s,g,q,r,n;if(!j.supported){return console.warn("module not supported")}j.destroy();i.pages={body:{elem:document.body,direction:j.VERTICAL,settings:i.defaults}};g=document.querySelectorAll("[data-scroll-page]");for(r=0,n=g.length;r<n;r++){s=g[r];o=s.getAttribute("data-scroll-page");q=c.merge(i.defaults,p||{},b(s));t=s.getAttribute("data-scroll-direction");t=t==="horizontal"?j.HORIZONTAL:j.VERTICAL;i.pages[o]={elem:s,direction:t,settings:q}}return i.events.on("tap",m)};return j}).bind(this,(function(){return{merge:function(){var d,h,f,b,g,e,c;f=1<=arguments.length?a.call(arguments,0):[];b={};for(e=0,c=f.length;e<c;e++){h=f[e];for(d in h){g=h[d];b[d]=g}}return b},closest:function(d,b){var c;c=b.charAt(0);b=b.substr(1);while(d&&d!==document){switch(c){case".":if(d.classList.contains(b)){return d}break;case"#":if(d.id===b){return d}break;case"[":if(d.hasAttribute(b.substr(0,b.length-1))){return d}}d=d.parentNode}return false}}})()))}).call(this);

define('text!app/layout/view.html',[],function () { return '<script id="no_data_template">\n    <div class="no_data">\n        <div class="no_data_text">No Data Available</div>\n    </div>\n</script>\n\n<script id="layout_template">\n    <header class="page header" data-class="header">\n        <!-- ko template: template -->\n        <!-- /ko -->\n    </header>\n\n    <article class="panel" data-class="panorama_jump">\n        <!-- ko template: template -->\n        <!-- /ko -->\n    </article>\n    <section id="panorama" class="page panorama" data-class="panorama">\n        <!-- ko foreach: panels -->\n        <article class="panel" data-class="panorama_panel">\n            <!-- ko template: template -->\n            <!-- /ko -->\n        </article>\n        <!-- /ko -->\n    </section>\n\n    <div hidden>\n        <svg id="loader" xmlns="http://www.w3.org/2000/svg" viewBox="0 14 32 18" width="400" height="100" fill="#fff" preserveAspectRatio="none">\n            <path opacity="0.8" transform="translate(0 0)" d="M2 14 V18 H6 V14z">\n                <animateTransform attributeName="transform" type="translate" values="0 0; 24 0; 0 0" dur="2s" begin="0" repeatCount="indefinite" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" calcMode="spline"/>\n            </path>\n            <path opacity="0.5" transform="translate(0 0)" d="M0 14 V18 H8 V14z">\n                <animateTransform attributeName="transform" type="translate" values="0 0; 24 0; 0 0" dur="2s" begin="0.1s" repeatCount="indefinite" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" calcMode="spline"/>\n            </path>\n            <path opacity="0.25" transform="translate(0 0)" d="M0 14 V18 H8 V14z">\n                <animateTransform attributeName="transform" type="translate" values="0 0; 24 0; 0 0" dur="2s" begin="0.2s" repeatCount="indefinite" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" calcMode="spline"/>\n            </path>\n        </svg>\n    </div>\n\n</script>\n';});


define('app/layout/bindings.js',[
    'scalejs.sandbox!layout',
], function (
    sandbox
) {

    
    return {
        header: function ( ctx ) {
            return {
                with: this.header()//;
            };
        },
        panorama: function ( ctx ) {
            return {
                attr: {
                    'data-scroll-page': 'main',
                    'data-scroll-direction': 'horizontal'
                },
                css: {
                    show: this.showjump()
                },
                event: {
                    scroll: _.throttle(this.loadVisisblePanels, 100)
                }
            };
        },
        panorama_jump: function ( ctx ) {
            var jump = this.jump();

            return {
                with: jump,
                attr: {
                    id: jump && jump.id,
                },
                css: {
                    show: this.showjump()
                }
            };
        },
        panorama_panel: function ( ctx ) {
            return {
                attr: {
                    id: this.link.id,
                    hidden: !this.link.display()//;
                }//;
            };
        }//;
    };
});


define('scalejs.styles-less!app/layout/style',[],function(){});

define('app/layout/module',[
    'scalejs.sandbox!layout',
    'scroll',
    'text!./view.html',
    './bindings.js',
    'styles!./style'
], function (
    sandbox,
    scroll,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    var m_header = sandbox.mvvm.observable(),
        m_jump   = sandbox.mvvm.observable(),
        m_panels = sandbox.mvvm.observableArray([]),
        m_showjump = sandbox.mvvm.observable(true);

    function verify ( model ) {
        if (!model) { return console.error('undefined model'); }
        if (!model.template) { return console.error('undefined model template'); }
        return true;
    };

    function loadVisisblePanels() {
        var scroll = document.getElementById('panorama');
        var vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        var left = scroll.scrollLeft;
        var right = left + vw;
        var panel_width = Math.min(vw, 1024);
        var panels = m_panels();
        var starting_panel_index = Math.floor(left / panel_width);
        var ending_panel_index = Math.min(Math.floor(right / panel_width), panels.length-1);

        // console.log('l:', left, ' r:', right, ' pw:', panel_width);
        //
        // console.log('[', starting_panel_index, ',', ending_panel_index, ']');
        for(var i = starting_panel_index; i <= ending_panel_index; i++) {
            var panel = panels[i];
            var id = panel.link.id;
            // console.log('invoking: ', 'load.' + id);
            sandbox.flag.invoke('load.' + id);
        }
        // console.log('scrolled');
    }

    console.debug('layout: rendering template');
    sandbox.mvvm.root(sandbox.mvvm.template('layout_template', {
        header: m_header,
        jump: m_jump,
        panels: m_panels,
        showjump: m_showjump,
        loadVisisblePanels: loadVisisblePanels
    }));

    sandbox.flag.register('date.changed', function ( ) {
        setTimeout(function () {loadVisisblePanels();}, 0);
    });

    sandbox.flag.register('jump.toggle', function ( ) {
        m_showjump(!m_showjump());
    });

    sandbox.flag.register('layout.register.header', function ( model ) {
        if (!verify(model)) { return; }
        m_header(model);
    });

    sandbox.flag.register('layout.register.jump',   function ( model ) {
        if (!verify(model)) { return; }
        m_jump(model);
    });

    sandbox.flag.register('layout.register.panel',  function ( model ) {
        if (!verify(model)) { return; }
        m_panels.push(model);
    });

    scroll.init();
    loadVisisblePanels();

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });


define('text!app/header/view.html',[],function () { return '\n<script id="header_template">\n    <a href="#" class="logo" data-class="header_logo">\n        <img src="resources/logo.png" />\n    </a> <!-- logo -->\n    <a href="#" class="date" data-class="header_picker_open">\n    </a> <!-- date -->\n    <div class="datepicker_wrapper" data-class="header_picker_wrapper">\n\n        <div id="datepicker">\n            <div data-class="header_picker_cryptex">\n            </div>\n            <a class="go" data-class="header_picker_go">\n                <i class="fa fa-check"></i>\n            </a>\n            <a class="close" data-class="header_picker_close">\n                <i class="fa fa-close"></i>\n            </a>\n        </div>\n    </div>\n</script>\n\n';});


define('app/header/bindings.js',{
    header_logo: function ( ctx ) {
        return {
            /*attr: {
                'data-scroll-what': 'main',
                'data-scroll': '#jump'
            },*/
           //hmTap: this.toggle,
           //hmSwipe: this.toggle
        };
    },
    header_picker_wrapper: function ( ctx ) {
        return {
            css: {
                'hide': !this.picker()
            }//;
        };
    },
    header_picker_close: function ( ctx ) {
        return {
            hmTap: function ( ) {
                this.picker(false);
            }//;
        };
    },
    header_picker_open: function ( ctx ) {
        return {
            text: this.date(),
            hmTap: function ( ) {
                this.picker(true);
            }//;
        };
    },
    header_picker_cryptex: function ( ctx ) {
        console.log(this.onchange)
        return {
            attr: {
                id: 'datepicker_cryptex'
            },
            component: {
                name: 'cryptex',
                params: {
                    id: 'datepicker_cryptex',
                    data: this.dates(),
                    onchange: this.onchange
                }
            }
        }
    },
    header_picker_go: function ( ctx ) {
        return {
            click: this.ongo
        };
    }//;
});



define('scalejs.styles-less!app/header/style',[],function(){});

define('app/header/module',[
    'scalejs.sandbox!header',

    'text!./view.html',
    './bindings.js',
    'styles!./style',
], function (
    sandbox,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    var model = {
        template: 'header_template',
        picker: sandbox.mvvm.observable(false),
        date: sandbox.mvvm.observable(),
        selected: null,

        toggle: function () {
            sandbox.flag.invoke('jump.toggle');
        },

        dates: sandbox.mvvm.observable(),
        onchange: function ( m ) {
            model.selected = m;
            console.debug('header: datepicker: selected date', m);
        },
        ongo: function ( ) {
            model.date(model.selected);
            console.debug('header: datepicker: changed date', model.selected);
            model.picker(false);
            sandbox.flag.wait('global.date', [model.selected]);
        }
    };

    sandbox.query({
        group: 'Metadata',
        menu: 'valueDates',
        params: [  ]
    }, function ( err, items ) {
        if (err) {
            console.error('header: ', err);
        } else {
            if (items.length) {
                var dates = [ ];
                items[0].forEach(function (item) {
                    dates.unshift(global.toolkit.filter.dateToString(item.Date));
                });
                sandbox.flag.wait('global.date', [dates[0]]);
                model.selected = dates[0];
                model.date(dates[0]);
                model.dates(dates);
            }
        }
    });

    model.date.subscribe(function (change) {
        sandbox.flag.invoke('date.changed');
    });

    sandbox.flag.wait('layout.register.header', [model]);
    /*var picker = null;
    var internal = false;

    var start = DatePicker.moment();
    model.date(start);

    console.debug('header: registering to layout');
    sandbox.flag.wait('layout.register.header', [model], function () {
        var elem = document.getElementById('datepicker');
        if (!elem) {
            return console.error('header: datepicker: wrapper not found');
        }

        picker = new DatePicker(elem, {
            size: 'long',
            start: start
        });

        sandbox.flag.register('global.date', function (date) {
            if (internal) { return internal = false; }
            picker.set(date);
        });

        picker.view.yy.controls.prev.dom.innerHTML =
        picker.view.mm.controls.prev.dom.innerHTML =
        picker.view.dd.controls.prev.dom.innerHTML =
        '<i class="fa fa-chevron-left"></i>';
        picker.view.yy.controls.next.dom.innerHTML =
        picker.view.mm.controls.next.dom.innerHTML =
        picker.view.dd.controls.next.dom.innerHTML =
        '<i class="fa fa-chevron-right"></i>';

        picker.onchange = function ( m ) {
            model.picker(false);
            var prev = model.date();
            if (!prev || prev.format('YYMMDD') !== m.format('YYMMDD')) {
                console.debug('header: datepicker: selected date', m._i);
                model.date(m);
                internal = true;
                sandbox.flag.invoke('global.date', [m.format('YYYY-MM-DD')]);
            }
        }
    });
*/
});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });


define('text!app/jump/view.html',[],function () { return '\n<script id="jump_template">\n    <div class="grid">\n        <div class="left" data-class="tab_scroll_left">◀</div>\n        <div id="scroll_tabs" data-class="tab_scroll" class="scroll">\n            <!-- ko foreach: tiles -->\n            <div class="tile" data-class="jump_tile">\n                <div data-class="jump_tile_content"></div>\n            </div>\n            <!-- /ko -->\n        </div>\n        <div class="right" data-class="tab_scroll_right">▶</div>\n    </div>\n</script>\n';});


define('app/jump/bindings.js',{
    tab_scroll: function ( ctx ) {
        return {
            event: {
                scroll: function ( ) {
                    var scroll = document.getElementById('scroll_tabs');
                    var scrollLeft = scroll.scrollLeft;
                    var rightScrollOffset = scroll.scrollWidth - scroll.clientWidth;
                    /*if(rightScrollOffset === 0) {
                        this.scrollSide(null);
                        return;
                    }*/
                    if(scrollLeft === 0) {
                        this.scrollSide('left');
                    } else if(scrollLeft === rightScrollOffset) {
                        this.scrollSide('right');
                    } else {
                        this.scrollSide('middle');
                    }
                }.bind(this)
            }
        };
    },
    tab_scroll_left: function ( ctx ) {
        return {
            css: ctx.$rawData.scrollSide() === null || ctx.$rawData.scrollSide() === 'left' ? 'hide' : ''
        };
    },
    tab_scroll_right: function ( ctx ) {
        return {
            css: ctx.$rawData.scrollSide() === null || ctx.$rawData.scrollSide() === 'right' ? 'hide' : ''
        };
    },
    jump_tile: function ( ctx ) {
        setTimeout(function () {
            var scroll = document.getElementById('scroll_tabs');
            var rightScrollOffset = scroll.scrollWidth - scroll.clientWidth;
            if(rightScrollOffset > 0) {
                ctx.$parent.scrollSide('left');
            }
        }, 0);
        return {
            css: this.link.id,
            attr: {
                'data-scroll-what': 'main',
                'data-scroll': '#' + this.link.id//;
            },
            hmTap: function ( ) {
                this.link.reset()();
                /*setTimeout(function () {
                    ctx.$parents[1].showjump(false);
                }, 100);*/
            }
        };
    },
    jump_tile_content: function ( ctx ) {
        var title = this.link.title().split(' ');
        title = title[0] + ' ' + title[1];
        return {
            text: this.link.title()//title//;
        };
    },
    jump_tile_status: function ( ctx ) {
        var status = this.link.status()
        return {
            css: {
                'fa': true,
                //'fa-exclamation': !!status,
                'fa-check': !status,
                'NearLimit': status === 'NearLimit',
                'OverLimit': status === 'OverLimit'
            }
        };
    }//;
});


define('scalejs.styles-less!app/jump/style',[],function(){});

define('app/jump/module',[
    'scalejs.sandbox!jump',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    var model = {
        store: sandbox.mvvm.observableArray([ ]),
        tiles: sandbox.mvvm.observableArray([ ]),

        show: sandbox.mvvm.observable(true),

        scrollSide: sandbox.mvvm.observable(null),

        showTile: function ( tile ) {
            model.store.remove(tile);
            model.tiles.push(tile);
            tile.link.display(true);
        },
        hideTile: function ( tile ) {
            model.store.push(tile);
            model.tiles.remove(tile);
            tile.link.display(false);
        },

        id: 'jump',
        template: 'jump_template',
        display: sandbox.mvvm.observable(true)
    };

    sandbox.flag.register('jump.register.tile', function ( tile ) {
        if (tile.link.display()) {
            model.tiles.push(tile);
        } else {
            model.store.push(tile);
        }
    });

    console.debug('jump: registering to layout');
    sandbox.flag.wait('layout.register.jump', [model]);
});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });


define('app/unsecured/model',[
    'scalejs.sandbox!unsecured',
    'underscore'
], function (
    sandbox,
    _
) {

    

    return function ( date ) {
        var data = {
            data_wholesale   : sandbox.mvvm.observable(null),
            //data_secured     : sandbox.mvvm.observable(null),
            //data_lcr         : sandbox.mvvm.observable(null),
            data_drill       : sandbox.mvvm.observable(null),
            data_status      : sandbox.mvvm.observable(''),
            date             : null
        };
        data.data_wholesale.status = sandbox.mvvm.observable('');
        //data.data_secured.status = sandbox.mvvm.observable('');
        //data.data_lcr.status = sandbox.mvvm.observable('');
        data.data_loading = sandbox.mvvm.observable(false);
        data.data_drill.tag = sandbox.mvvm.observable(null);
        data.data_drill.xhr = null;

        data.data_drill.tag.subscribe( function (change){
            if (!change) {
                data.data_drill(null);
            }
        });

        function max_status ( statuses ) {
            var max = '';
            for (var i in statuses) {
                if (statuses[i].LimitStatus === 'OverLimit') {
                    return 'OverLimit';
                }
                if (statuses[i].LimitStatus === 'NearLimit' && !max) {
                    max = 'NearLimit';
                }
            }
            return max;
        }

        sandbox.mvvm.computed(function () {
            data.data_status(
                max_status([
                    {LimitStatus: data.data_wholesale.status()}//,
                    //{LimitStatus: data.data_secured.status()},
                    //{LimitStatus: data.data_lcr.status()}
                ])
            );
        });

        function collect ( name, what ) {
            return function ( err, result ) {
                if ( !err ) {
                    if (what.status) {
                        what.status(max_status(result[0]));
                    }
                    what(result[0]);
                } else {
                    if (what.status) {
                        what.status('');
                    }
                    what('There was an error loading ' + name);
                    console.error('unsecured: error: ' + err);
                }
                data.data_loading(false);
            };
        }//;

        var collect_wholesale = collect('Trading Balance Sheets', function ( rows ) {
            // var TagToTagDisplayText_mapping = {
            //     'Trading Balance Sheet (CDE) - including Fed trade': 'Trading Balance Sheet (CDE) - including Fed Deposit',
            //     'Trading Balance Sheet (CDE) <= 90 days to maturity - excluding Fed trade': 'Trading Balance Sheet (CDE) <= 90 days to maturity - excluding Fed Deposit'
            // }
            var TagToTagDisplayText_mapping = {
                'Fed trade': 'Fed Deposit'
            }

            var length = rows.length;

            if(typeof rows === 'object') {
                _.forEach(rows, function ( row, index ) {
                    // if(TagToTagDisplayText_mapping[row.Tag]) {
                        for(var value in TagToTagDisplayText_mapping) {
                            row.TagDisplayText = row.Tag.replace(value, TagToTagDisplayText_mapping[value]);
                        }

                        if(index >= length - 3) {
                            row.dataAvailable = false;
                        } else {
                            row.dataAvailable = true;
                        }

                    // }
                });
            }

            data.data_wholesale(rows);
        });
        sandbox.flag.register('load.unsecured', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_loading(true);
                sandbox.query({
                    group:  'PoC',
                    //menu:   'WholesaleFunding',
                    menu:   'LiquidityAndFundingKeyMetrics',
                    params: [ date() ]
                }, collect_wholesale);
            }
        });
        //var collect_secured = collect('Secured Wholesale Funding', data.data_secured);
        /*sandbox.mvvm.computed(function () {
            sandbox.query({
                group:  'Liquidity',
                menu:   'SecuredWholesaleFunding',
                params: [ date() ]
            }, collect_secured);
        });*/
        //var collect_lcr = collect('Estimated Daily LCR', data.data_lcr);
        /*sandbox.mvvm.computed(function () {
            sandbox.query({
                group:  'Liquidity',
                menu:   'LcrWholesaleFunding',
                params: [ date() ]
            }, collect_lcr);
        });*/

        sandbox.mvvm.computed(function () {

            var tag;
            if (!(tag = data.data_drill.tag())) { return; }
            //if (data.data_drill.xhr()) { data.data_drill.xhr().abort(); }
            if(date()) {
                data.data_drill.xhr =
                    sandbox.query({
                        group:  'TradeDetail',
                        menu:   'GetTradeDetailsTagOnly',
                        params: [
                            date(),
                            'unsecuredWholesaleFunding',
                            tag.param,
                            'dbo.GetLMRSWidgetLevelTradeDetail'
                        ]
                    }, collect('details for ' + tag, function (rows) {
                        if (typeof data === 'object') {
                            var i, item;

                            if (typeof rows === 'object') {
                                for (i in rows) {
                                    item = rows[i];

                                    // crop dates
                                    item.ValueDate = global.toolkit.filter.dateToString(item.ValueDate);
                                    item.Trade_Date = global.toolkit.filter.dateToString(item.Trade_Date);
                                    item.MaturityDate = global.toolkit.filter.dateToString(item.MaturityDate);

                                    // modify bns
                                    item.Notl_PrnpalAmt_CDE_Tag = global.toolkit.filter.bn(item.Notl_PrnpalAmt_CDE);
                                    item.Notl_PrnpalAmt_USE_Tag = global.toolkit.filter.bn(item.Notl_PrnpalAmt_USE);
                                }
                            }
                        }

                        data.data_drill(rows);
                        data.data_drill.xhr = null;
                    }))
                }
            });

        return data;
    };
});


define('text!app/unsecured/view.html',[],function () { return '\n<script id="unsecured_info_template">\n    <!-- ko if: condition === \'No Data\' -->\n        <!-- ko template: "no_data_template" --><!-- /ko -->\n    <!-- /ko -->\n    <div class="info">\n        <header>\n            <i data-class="unsecured_tile_plus" class="fa fa-plus"></i>\n            <div data-class="unsecured_tile_tag"></div>\n        </header>\n\n        <!-- ko foreach: $data.data -->\n        <div class="item">\n            <div class="head" data-bind="text: column"></div>\n            <div data-class="unsecured_tile_data"></div>\n        </div>\n        <!-- /ko -->\n\n    </div>\n    <div class="progress">\n        <div class="bar" data-class="unsecured_tile_progress"></div>\n    </div>\n</script>\n\n<script id="unsecured_tile_template">\n    <!-- ko if: typeof $data.data() !== \'string\' -->\n        <!-- ko foreach: $data.data -->\n                <div data-class="unsecured_tile">\n                    <!-- ko template: \'unsecured_info_template\' -->\n                    <!-- /ko -->\n                </div>\n        <!-- /ko -->\n    <!-- /ko -->\n</script>\n\n<script id="unsecured_template">\n    <header class="title" data-class="unsecured_header"></header>\n    <div class="data_wrapper">\n        <div class="drill" data-class="unsecured_table" id="unsecured_drill_01"></div>\n        <div class="drill_loading" data-class="unsecured_table_loading">\n            <div class="BMOloading"></div>\n        </div>\n        <div data-class="unsecured_grid">\n            <!-- ko with: {data: $data.data_wholesale} -->\n                <!-- ko template: \'unsecured_tile_template\' --><!-- /ko -->\n            <!-- /ko -->\n        </div>\n    </div>\n    <!-- ko if: typeof $data.data_wholesale() === \'string\' -->\n        <!-- ko template: "no_data_template" --><!-- /ko -->\n    <!-- /ko -->\n</script>\n';});


define('app/unsecured/bindings.js',[
    'scalejs.sandbox!unsecured',
    'underscore'
], function (
    sandbox,
    _
) {

    

    return {
        unsecured_header: function ( ctx ) {
            this.link.reset(this.undrill);
            return {
                text: this.link.title,
                hmTap: this.undrill,
                style: {
                    color: this.data_drill.tag() ? 'yellow' : ''
                }
            };
        },
        unsecured_table_loading: function ( ctx ) {
            return {
                css: {
                    hide: !this.data_loading() && (!this.data_drill.tag() || this.data_drill())
                }
            };
        },
        unsecured_table: function ( ctx ) {
            function toggleCSS ( el, cls ) {
                var list = el.className.split(' '),
                    index = list.indexOf(cls);

                if (index < 0) {
                    list.push(cls);
                } else {
                    list.splice(index, 1);
                }

                el.className = list.join(' ');
            }

            var table_params;
            var custom_filter_tab = [
              {min: 0, max: 7},
              {min: 8, max: 30},
              {min: 31, max: 90}
            ];

            if ((this.data_drill.tag() ? this.data_drill.tag().param : '').indexOf('<= 90 days to maturity') === -1) {
                custom_filter_tab = custom_filter_tab.concat(
                    [
                        {min: 91, max: 180},
                        {min: 181, max: 365},
                        {min: 366, max: Infinity, tag: '> 365'}
                    ]);
            }

            table_params = {
                title: this.data_drill.tag() ? this.data_drill.tag().tag : '',
                id: 'unsecured_drill_01',
                pagination: {
                    innerWindow: 10,
                    outerWindow: 1
                },
                defaultSort: {
                    id: 'Notl_PrnpalAmt_CDE',
                    order: 'desc'
                },
                total: true,
                columns: [
                {
                   id: 'Parent_UEN_Name',
                   name: 'Counterparty Name',
                   type: 'string',
                   total: true,
                   total_tag: 'Total'
                }, {
                    id: 'Customer_Type',
                    name: 'Counterparty Type',
                    type: 'string',
                    total: false
                }, {
                    id: 'InstrumentCL',
                    name: 'Instrument Type',
                    type: 'string',
                    total: false
                },{
                    id: 'Ccy',
                    name: 'Ccy',
                    type: 'string',
                    total: false
                }, {
                    id: 'Notl_PrnpalAmt_CDE',
                    id_tag: 'Notl_PrnpalAmt_CDE_Tag',
                    name: 'Principal (CDE)',
                    type: 'number',
                    total: true,
                    bn: true
                }, {
                    id: 'Notl_PrnpalAmt_USE',
                    id_tag: 'Notl_PrnpalAmt_USE_Tag',
                    name: 'Principal (USE)',
                    type: 'number',
                    total: true,
                    bn: true
                }, {
                    id: 'Days_to_Mty_Cal',
                    name: 'Days to Mty (Cal Days)',
                    type: 'number',
                    filter_tabs: custom_filter_tab,
                    total: false
                }
                ],
                rows: this.data_drill()
            };

            return {
                css: {
                    hide: !this.data_drill.tag()
                },
                hmTap: function ( evt ) {
                    toggleCSS(evt.target.parentNode, 'expand');
                },
                component: {
                    name: 'listjs_table',
                    params: table_params
                }//;
            };
        },
        unsecured_grid: function ( ctx ) {
            return {
                css: 'grid'
            };
        },
        unsecured_tile: function ( ctx ) {
            var obj = {
                tag: this.TagDisplayText,
                condition: this.Condition,
                status: this.LimitStatus,
                percent: this.Text4 === 'Percentage' ?
                    sandbox.global.toolkit.filter.percent(this.Value4) : 'No Data',
                data: []
            };

            //bn is default formatter
            var formatters = {
                'Percentage': sandbox.global.toolkit.filter.percent,
                'LCR Ratio': sandbox.global.toolkit.filter.percent,
                'Minimum': sandbox.global.toolkit.filter.percent,
                // 'Capacity': sandbox.global.toolkit.filter.percent, //it's both bn and percent
                'Survivability Days': function (item) {
                    return item + ' days';
                },
                'Weeks': function (item) {
                    return item + ' weeks';
                }

            }

            //fill data array from backend data
            // [{
            // Text1: <column_name>,
            // Value1: <data_for_column>,
            // Text2: ...,
            // Value2: ...,
            // }, ...]
            // -> obj.data: [{column: <column_name>, data: <data_for_column>}, ...]
            //should be at most 5 values where we combine last 2
            for(var index = 1; index <= 5; index++) {
                //Some backend data has 'N/A' in data
                if (this['Text' + index] !== 'N/A') {
                    var column = this['Text' + index];
                    var data = this['Value' + index];

                    if(formatters[column] && _.isFunction(formatters[column])) {
                        data = formatters[column](data);
                    } else {
                        if(column === 'Capacity' && this.Tag.toLowerCase() === 'lcr status') {
                            //only case where Capacity is percentage
                            data = sandbox.global.toolkit.filter.percent(data);
                        } else {
                            data = sandbox.global.toolkit.filter.bn(data);
                        }
                    }

                    if(index === 5) {   //append 5th item to 4th
                        obj.data[3] = {
                            column: obj.data[3].column + ' / ' + column,
                            data: obj.data[3].data + ' / ' + data
                        }
                    } else {
                        obj.data.push({
                            column: column,
                            data: data
                        });
                    }
                }
            }

            // switch (ctx.$parent.type) {
            //     case 'wholesale':
            //     case 'unsecured':
            //         obj.actual      = toolkit.filter.bn(this.Value);
            //         obj.limit       = toolkit.filter.bn(this.Max);
            //         obj.capacity    = toolkit.filter.bn(this.Residual);
            //         obj.percent     = toolkit.filter.percent(this.Percentage);
            //         break;
            //     case 'lcr':
            //         obj.ratio       = toolkit.filter.percent(this.Percentage);
            //         obj.capacity    = toolkit.filter.percent(Percentage3);
            //         obj.minimum     = toolkit.filter.percent(this.Percentage2)
            //         obj.hqla        = this.Condition;
            //         obj.percent     = '100%';
            //         break;
            // };
            return {
                css: 'tile',
                with: obj,
                hmTap: function () {
                    if (!window.restrictView)
                    {
                        if(this.dataAvailable) { //backend returns boolean as string
                            ctx.$parents[1].drill({param: this.Tag, tag: this.TagDisplayText});
                        }
                    }
                }.bind(this)
            };
        },
        unsecured_tile_plus: function ( ctx ) {
            return {
                css: {
                    hide: !ctx.$parent.dataAvailable || window.restrictView
                }
            };
        },
        unsecured_tile_errors: function ( ctx ) {
            return {
                css: 'tile error',
                text: this.data//;
            };
        },
        unsecured_tile_data: function ( ctx ) {
            return {
                css: this.column.toLowerCase(),
                text: this.data
            }
        },
        unsecured_tile_tag: function ( ctx ) {
            return {
                css: 'tag',
                text: this.tag//;
            };
        },
        unsecured_tile_progress: function ( ctx ) {
            var percent = this.percent;
            var status = this.status;

            if (this.percent === 'No Data') {
                percent = '0%';
                status = 'OverLimit';
            }
            return {
                css: status,
                style: {
                    width: percent//;
                }//;
            };
        }//;
    };
});


define('scalejs.styles-less!app/unsecured/style',[],function(){});

define('app/unsecured/module',[
    'scalejs.sandbox!unsecured',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['unsecured', function ( item ) {
        item.page.link.title('Wholesale Funding Guidelines');

        data = data(item.date);
        data.drill = function ( tag ) {
            tag && data.data_drill.tag(tag);
        };
        data.undrill = function ( ) {
            data.data_drill.tag(null);
            if(data.data_drill.xhr) {
                data.data_drill.xhr.abort();
                data.data_drill.xhr = null;
            }
        };

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });


define('app/guidelines/columns',{
    unsecured: {
        level1: {
            unsecuredWholesaleFunding: [
                {
                    id: 'Tag',
                    name: 'Group by CDE',
                    type: 'string',
                },{
                    id: 'Usage',
                    id_tag: 'Usage_Tag',
                    name: '%',
                    type: 'number',
                },{
                    id: 'Balance',
                    id_tag: 'Balance_Tag',
                    name: 'Balance',
                    type: 'number',
                },{
                    id: 'CPLimit',
                    id_tag: 'CPLimit_Tag',
                    name: 'CP Limit',
                    type: 'number',
                },{
                    id: 'Capacity',
                    id_tag: 'Capacity_Tag',
                    name: 'Capacity',
                    type: 'number',
                }
            ],
            SingleNamebyLimit: [
                {
                    id: 'Tag',
                    name: 'Group By Customer Type',
                    type: 'string',
                    total: true,
                    total_tag: "Total"
                },{
                    id: 'TotalCPs',
                    //id_tag: 'TotalCPs_Tag',
                    name: 'Total CPs',
                    type: 'number',
                    total: true
                },{
                    id: 'CPsNearLimit',
                    //id_tag: 'CPsNearLimit_Tag',
                    name: 'CPs Near Lmt',
                    type: 'number',
                    total: true
                },{
                    id: 'CPsOverLimit',
                    //id_tag: 'CPsOverLimit_Tag',
                    name: 'CPs Over Lmt',
                    type: 'number',
                    total: true
                },{
                    id: 'CPsTotalAmount',
                    id_tag: 'CPsTotalAmount_Tag',
                    name: 'CPs Total Amt',
                    type: 'number',
                    total: true,
                    bn: true
                },{
                    id: 'HighestCP',
                    id_tag: 'HighestCP_Tag',
                    name: 'Highest CP',
                    type: 'number',
                    total: false
                },{
                    id: 'CPLimit',
                    id_tag: 'CPLimit_Tag',
                    name: 'CP Lmt',
                    type: 'number',
                    total: false
                }
            ],
            byCustClassMaxMatXDaysIBUK: [
                {
                    id: 'Tag',
                    name: 'Group by Customer Type',
                    total: true,
                    type: 'string',
                    total_tag: 'Total'
                },{
                    id: 'Usage',
                    id_tag: 'Usage_Tag',
                    name: '%',
                    type: 'number',
                    total: false
                },{
                    id: 'Balance',
                    id_tag: 'Balance_Tag',
                    name: 'Balance',
                    type: 'number',
                    total: true,
                    bn: true
                },{
                    id: 'LimitRangeMinMax',
                    name: 'Limit Range',
                    total: false
                }
            ],
            unsecuredOvernightFunding: [
                {
                    id: 'Tag',
                    name: 'Group by Currency',
                    type: 'string',
                },{
                    id: 'Usage',
                    id_tag: 'Usage_Tag',
                    type: 'number',
                    name: '%'
                },{
                    id: 'Balance',
                    id_tag: 'Balance_Tag',
                    type: 'number',
                    name: 'Balance'
                },{
                    id: 'CPLimit',
                    id_tag: 'CPLimit_Tag',
                    type: 'number',
                    name: 'CP Limit'
                },{
                    id: 'Capacity',
                    id_tag: 'Capacity_Tag',
                    type: 'number',
                    name: 'Capacity'
                },{
                    id: 'BalanceLessEq7D',
                    id_tag: 'BalanceLessEq7D_Tag',
                    type: 'number',
                    name: 'Balance <= 7 Days'
                },{
                    id: 'BalanceLessEq30D',
                    id_tag: 'BalanceLessEq30D_Tag',
                    type: 'number',
                    name: 'Balance <= 30 Days'
                },{
                    id: 'BalanceGreater30D',
                    id_tag: 'BalanceGreater30D_Tag',
                    type: 'number',
                    name: 'Balance > 30 Days'
                }
            ],
            unsecuredOvernightFundingNoLimit: [
                {
                    id: 'Tag',
                    name: 'Group by Currency',
                    type: 'string',
                },{
                    id: 'Balance',
                    id_tag: 'Balance_Tag',
                    type: 'number',
                    name: 'Balance'
                },{
                    id: 'BalanceLessEq7D',
                    id_tag: 'BalanceLessEq7D_Tag',
                    type: 'number',
                    name: 'Balance <= 7 Days'
                },{
                    id: 'BalanceLessEq30D',
                    id_tag: 'BalanceLessEq30D_Tag',
                    type: 'number',
                    name: 'Balance <= 30 Days'
                },{
                    id: 'BalanceGreater30D',
                    id_tag: 'BalanceGreater30D_Tag',
                    type: 'number',
                    name: 'Balance > 30 Days'
                }
            ]
        },
        level2: {
            SingleNamebyLimit: [
                {
                    id: 'EntityName',
                    name: 'Cust Parent Name',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },{
                    id: 'Percentage',
                    id_tag: 'Percentage_Tag',
                    type: 'number',
                    name: '%',
                    total: false
                },{
                    id: 'Value',
                    id_tag: 'Value_Tag',
                    type: 'number',
                    name: 'Amount',
                    total: true,
                    bn: true
                },{
                    id: 'Max',
                    id_tag: 'Max_Tag',
                    type: 'number',
                    name: 'Limit',
                    total: false,
                    //bn: true
                },{
                    id: 'Residual',
                    id_tag: 'Residual_Tag',
                    type: 'number',
                    name: 'Residual',
                    total: false
                }
            ],
            byCustClassMaxMatXDaysIBUK: [
                {
                    id: 'EntityName',
                    name: 'Cust Parent Name',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },{
                    id: 'Value',
                    id_tag: 'Value_Tag',
                    type: 'number',
                    name: 'Amount',
                    total: true,
                    bn: true
                }
            ]
        },
        level3: {
            SingleNamebyLimitSub: [
                {
                    id: 'EntityName',
                    name: 'Legal Entity Name',
                    type: 'string'
                },{
                    id: 'Percentage',
                    id_tag: 'Percentage_Tag',
                    type: 'number',
                    name: '%'
                },{
                    id: 'Value',
                    id_tag: 'Value_Tag',
                    type: 'number',
                    name: 'Amount'
                },{
                    id: 'Max',
                    id_tag: 'Max_Tag',
                    type: 'number',
                    name: 'Limit'
                },{
                    id: 'Residual',
                    id_tag: 'Residual_Tag',
                    type: 'number',
                    name: 'Residual'
                }
            ],
            byCustClassMaxMatXDaysIBUKSub: [
                {
                    id: 'Tag',
                    name: 'Group by Customer Type',
                    type: 'string'
                },{
                    id: 'Usage',
                    id_tag: 'Usage_Tag',
                    type: 'number',
                    name: '%'
                },{
                    id: 'Balance',
                    id_tag: 'Balance_Tag',
                    type: 'number',
                    name: 'Balance'
                },{
                    id: 'LimitRangeMinMax',
                    type: 'number',
                    name: 'Limit Range'
                }
            ]
        },
        level4: {
            byCustClassMaxMatXDaysIBUK: [
                {
                    id: 'EntityName',
                    name: 'Legal Entity Name',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'Value',
                    id_tag: 'Value_Tag',
                    type: 'number',
                    name: 'Amount',
                    total: true,
                    bn: true
                }
            ]
        }
    },
    secured: {
        level1: {
            SecuredWholesaleFundingAgainstCash: [
                {
                    id: 'Title',
                    name: 'Group by Asset Class Guideline',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'Short',
                    id_tag: 'Short_Tag',
                    name: 'Short CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Lend',
                    id_tag: 'Lend_Tag',
                    name: 'Lend CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ],
            SecuredOvernightFundingCAD: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'RevRepo',
                    id_tag: 'RevRepo_Tag',
                    name: 'Rev Repo',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ],
            SecuredOvernightFundingUSD: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'RevRepo',
                    id_tag: 'RevRepo_Tag',
                    name: 'Rev Repo',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ],
            SecuredFundingWithinOneWeekCAD: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'RevRepo',
                    id_tag: 'RevRepo_Tag',
                    name: 'Rev Repo',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ],
            SecuredFundingWithinOneWeekUSD: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'RevRepo',
                    id_tag: 'RevRepo_Tag',
                    name: 'Rev Repo',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ],
            SecuredFundingWithinOneWeekCADSub: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'RevRepo',
                    id_tag: 'RevRepo_Tag',
                    name: 'Rev Repo',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ]
        },
        level2: {
            SecuredWholesaleFundingAgainstCash: [
                {
                    id: 'GroupbyAssetClass',
                    name: 'Group by Asset Class Guideline',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'Short',
                    id_tag: 'Short_Tag',
                    name: 'Short CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Lend',
                    id_tag: 'Lend_Tag',
                    name: 'Lend CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ]
        },
        level3: {
            SecuredWholesaleFundingAgainstCash: [
                {
                    id: 'LegalEntityName',
                    name: 'Legal Entity Name',
                    type: 'string',
                    total: true,
                    total_tag: 'Total'
                },
                {
                    id: 'Short',
                    id_tag: 'Short_Tag',
                    name: 'Short CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Repo',
                    id_tag: 'Repo_Tag',
                    name: 'Repo CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Lend',
                    id_tag: 'Lend_Tag',
                    name: 'Lend CAD',
                    type: 'number',
                    total: true,
                    bn: true
                },
                {
                    id: 'Total',
                    id_tag: 'Total_Tag',
                    name: 'Total CAD',
                    type: 'number',
                    total: true,
                    bn: true
                }
            ]
        }
    }
});


define('app/guidelines/model',[
    'scalejs.sandbox!guidelines',
    './columns'
], function (
    sandbox,
    columns
) {

    

    function convert ( opts, o ) {
        if(o.Guideline === 'unsecuredWholesaleFunding') {
            var Tag_mapping = {
                'Trading Balance Sheet (CDE) - including Fed trade':
                    'Trading Balance Sheet (CDE) - including Fed Deposit',
                'Trading Balance Sheet (CDE) - excluding Fed trade':
                    'Trading Balance Sheet (CDE) - excluding Fed Deposit',
                'Trading Balance Sheet (CDE) <= 90 days to maturity - excluding Fed trade':
                    'Trading Balance Sheet (CDE) <= 90 days to maturity - excluding Fed Deposit'
            }
            if(Tag_mapping[o.Tag]) {
                o.Tag = Tag_mapping[o.Tag];
            }
        }
        _.each(opts.per, function ( v ) {
            //o[v] = (parseInt(o[v] * 100, 10)) + '%';
            //o[v + "_Tag"] = global.toolkit.filter.percent(o[v]);
            o[v + '_Tag'] = sandbox.global.toolkit.filter.percent(o[v]);//parseInt(o[v] * 100, 10);
            o[v] = o[v] * 100;
        });
        _.each(opts.bns, function ( v ) {
            //var val = (parseInt(o[v], 10) / 1000000000).toFixed(2);
            //if (val < 0) { val = '(' + (-val) + ')'; }
            //o[v] =  val + ' Bn';
            o[v + "_Tag"] = sandbox.global.toolkit.filter.bn(o[v]);
        });
    }

    return function ( date ) {
        var data_subguidelines = { };
        var data = {
            data_selector   : sandbox.mvvm.observable('unsecured'),
            unsecured: {
                data_guidelines : sandbox.mvvm.observable(null),
                data_level1     : sandbox.mvvm.observable(null),
                data_level2     : sandbox.mvvm.observable(null),
                data_level3     : sandbox.mvvm.observable(null),
                data_level4     : sandbox.mvvm.observable(null),
                data_status     : sandbox.mvvm.observable('')
            },
            secured: {
                data_guidelines : sandbox.mvvm.observable(null),
                data_level1     : sandbox.mvvm.observable(null),
                data_level2     : sandbox.mvvm.observable(null),
                data_level3     : sandbox.mvvm.observable(null),
                data_status     : sandbox.mvvm.observable('')
            },
            date: null
        };

        function collect ( name, what ) {
            return function ( err, data ) {
                if ( err ) {
                    what('There was an error loading ' + name);
                    console.error('guidelines: error: ' + err);
                    what(err);
                } else {
                    what(data[0]);
                }
            };
        }//;

        function collectLevel (
            selector, level, menu, paramlist, process, setup, cleanup
        ) {
            var data_level;
            if (!(data_level = data[selector]['data_level' + level]))
                { return function () { }; }

            data_level.xhr = null;
            data_level.params = data[selector]['drill' + level] =
                sandbox.mvvm.observable(null);
            data_level.columns = columns[selector]['level' + level];

            data[selector]['undrill' + level] = function ( ) {
                data_level(null);
                data_level.params(null);
                if (data_level.xhr) {
                    data_level.xhr.abort();
                    data_level.xhr = null;
                }
                if (cleanup) cleanup();
            }

            return function () {

                var params;
                if (!(params = data_level.params()))
                    { return; }

                if (data_level.xhr)
                    { data_level.xhr.abort(); }

                if (setup) setup( params );

                params = paramlist.map(function ( item ) {
                    return params[item];
                });
                params.unshift(date());
                if(date()) {
                    data_level.xhr = sandbox.query({
                        group: selector === 'unsecured' ? 'PoC' : 'Guidelines2',
                        menu: menu,
                        params: params
                    }, collect('details for ' + params.tag, function ( rows ) {
                        if (typeof rows === 'object') {
                            if (process) rows.forEach(process)
                            data_level(rows);
                            data_level.xhr = null;
                        }
                    }));
                }
            };
        }//;

        // unsecured
        // level1 - regular unsecured drill down
        data.unsecured.data_level1.sub = sandbox.mvvm.observable(null);
        sandbox.mvvm.computed(collectLevel('unsecured', 1, 'GetGuidelinesLevel1', [
            'guideline', 'level1Func'
        ], convert.bind(null, { // process
            per: [
                'Usage'
            ],
            bns: [
                'CPsTotalAmount', 'HighestCP', 'CPLimit',
                'Capacity', 'Balance', 'BalanceLessEq7D',
                'BalanceLessEq30D', 'BalanceGreater30D'
            ]
        }), function ( params ) { // setup
            data.unsecured.data_level1.sub(data_subguidelines.unsecured[params.guideline])
        }, function () { // cleanup
            data.unsecured.data_level1.sub(null);
        } ));

        // level2 - secondary drill down from regular drill down
        sandbox.mvvm.computed(collectLevel('unsecured', 2, 'GetGuidelinesLevel2', [
            'guideline', 'tag', 'level2Func'
        ], convert.bind(null, { // process
            per: [
                'Percentage'
            ],
            bns: [
                'Value', 'Max', 'Residual'
            ]
        }) ));

        // level3 - sub drill down
        sandbox.mvvm.computed(collectLevel('unsecured', 3, 'GetGuidelinesLevel1', [
            'guideline', 'level1Func'
        ], convert.bind(null, { // process
            per: [
                'Percentage', 'Usage'
            ],
            bns: [
                'Value', 'Max', 'Residual', 'Balance'
            ]
        }) ));

        // level4 - secondary drill down from sub drill down
        sandbox.mvvm.computed(collectLevel('unsecured', 4, 'GetGuidelinesLevel2', [
            'guideline', 'tag', 'level2Func'
        ], convert.bind(null, {
            per: [

            ],
            bns: [
                'Value'
            ]
        }) ));


        // Secured
        // level1 - regular secured drill down
        data.secured.data_level1.sub = sandbox.mvvm.observable(null);
        sandbox.mvvm.computed(collectLevel('secured', 1, 'GetSecuredGuidelinesLevel1', [
            'GuidelineName', 'ExecStoredProc', 'Branch'
        ], convert.bind(null, { // process
            bns: [
                'Short', 'RevRepo', 'Repo', 'Lend', 'Total'
            ]
        }), function ( params ) { // setup
            data.secured.data_level1.sub(data_subguidelines.secured[params.GuidelineName])
        }, function () { // cleanup
            data.secured.data_level1.sub(null);
        } ));

        // level2 - secondary secured drill down from regular drill down
        sandbox.mvvm.computed(collectLevel('secured', 2, 'GetSecuredGuidelinesLevel2', [
            'GuidelineName', 'GroupbyAssetClassGuideline', 'ExecStoredProc', 'Branch'
        ], convert.bind(null, { // process
            bns: [
                'Short', 'Repo', 'Lend', 'Total'
            ]
        }) ));

        // level3 - secured sub drill down
        sandbox.mvvm.computed(collectLevel('secured', 3, 'GetSecuredGuidelinesLevel3', [
            'GuidelineName', 'GroupbyAssetClassGuideline', 'GroupbyAssetClass', 'ExecStoredProc', 'Branch'
        ], convert.bind(null, { // process
            bns: [
                'Short', 'Repo', 'Lend', 'Total'
            ]
        }) ));


        function max_status ( statuses ) {
            var max = '';
            for (var i in statuses) {
                if (statuses[i].LimitStatus === 'OverLimit') {
                    return 'OverLimit';
                }
                if (!max && statuses[i].LimitStatus === 'NearLimit') {
                    max = 'NearLimit';
                }
            }
            return max;
        }

        var collect_unsecured_guidelines = collect('Guidelines', function ( guidelines ) {
            if (typeof guidelines !== 'string') {

                var Level0DisplayName_mapping = {
                    'Single Name - USE': 'Single Name (USE)',
                    'By Customer Classification': 'By Customer Classification (USE)',
                    'Sub Guideline': 'Sub Guideline (USE)'
                }

                data_subguidelines.unsecured = { };
                var data_guidelines = [ ];
                guidelines.forEach(function ( guideline ) {
                    if(Level0DisplayName_mapping[guideline.Level0DisplayName]) {
                        guideline.Level0DisplayName = Level0DisplayName_mapping[guideline.Level0DisplayName];
                    }
                    // if sub guideline
                    if(!guideline.Level0DisplayName.indexOf('Sub')) {
                        // store in object for later reference
                        data_subguidelines.unsecured[
                            data_guidelines[data_guidelines.length - 1].Guideline
                        ] = { data_guidelines: ko.observable([guideline]) };
                    } else {
                        // otherwise push to guidelines
                        data_guidelines.push(guideline);
                    }
                });

                data.unsecured.data_status(max_status(guidelines));
            } else {
                data.unsecured.data_status('');
                data_guidelines = guidelines;
            }
            // update guidelines
            data.unsecured.data_guidelines(data_guidelines);
        });

        var collect_secured_guidelines = collect('Guidelines', function ( guidelines ) {
            var data_guidelines;
            if (typeof guidelines === 'string') {
                data.secured.data_status('');
                data_guidelines = guidelines;
            } else {
                data_guidelines = [ ];
                data_subguidelines.secured = { };
                guidelines.forEach(function (guideline) {
                    convert({
                        bns: [
                            'Total', 'Limit', 'Residual'
                        ]
                    }, guideline);
                    //if sub guideline
                    if(guideline.Title.indexOf('Sub') !== -1) {
                        // store in object for later reference
                        data_subguidelines.secured[
                            data_guidelines[data_guidelines.length - 1].GuidelineName
                        ] = { data_guidelines: ko.observable([guideline]) };
                    } else {
                        // otherwise push to guidelines
                        data_guidelines.push(guideline);
                     }
                });
            }
            // update guidelines
            data.secured.data_guidelines(data_guidelines);
        });

        // collect guidelines when date changes
        sandbox.flag.register('load.guidelines', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                if(data.data_selector() === "unsecured") {
                    data.unsecured.data_guidelines(null);
                    sandbox.query({
                        group:  'PoC',
                        menu:   'GetGuidelinesTopLevel',
                        params: [ date(), '' ]
                    }, collect_unsecured_guidelines);
                } else {    //secured
                    data.secured.data_guidelines(null);
                    sandbox.query({
                        group:  'Guidelines2',
                        menu:   'GetSecuredGuidelinesSummary',
                        params: [ date(), '0' ]
                    }, collect_secured_guidelines);
                }
            }
        });

        return data;
    };
});


define('text!app/guidelines/view.html',[],function () { return '<script id="guidelines_unsecured_grid_template">\n    <div class="grid">\n        <!-- ko if: typeof $data.data_guidelines() === \'object\' -->\n            <!-- ko foreach: $data.data_guidelines -->\n                <div class="tile" data-class="guidelines_tile">\n                    <div class="info">\n                        <header>\n                            <i class="fa fa-plus"></i>\n                            <div data-bind="text:Level0DisplayName"></div>\n                        </header>\n\n                        <div class="item">\n                            <div class="head">Total</div>\n                            <div data-bind="text:Total"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Near Limit</div>\n                            <div data-bind="text:NearLimit"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Over Limit</div>\n                            <div data-bind="text:OverLimit"></div>\n                        </div>\n\n                    </div>\n                    <div class="progress">\n                        <div class="bar" data-class="guidelines_tile_progress"></div>\n                    </div>\n                </div>\n            <!-- /ko -->\n        <!-- /ko -->\n        <!-- ko if: typeof $data.data_guidelines() === \'string\' -->\n            <div class="tile error" data-bind="text:data">\n            </div>\n        <!-- /ko -->\n    </div>\n</script>\n\n<script id="guidelines_unsecured_sub_grid_template">\n    <div class="grid">\n        <!-- ko if: typeof $data.data_guidelines() === \'object\' -->\n            <!-- ko foreach: $data.data_guidelines -->\n                <div class="tile" data-class="guidelines_tile">\n                    <div class="info">\n                        <header>\n                            <!-- ko if: !window.restrictView -->\n                            <i class="fa fa-plus"></i>\n                            <!-- /ko -->\n                            <div data-bind="text:Level0DisplayName"></div>\n                        </header>\n\n                        <div class="item">\n                            <div class="head">Total</div>\n                            <div data-bind="text:Total"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Near Limit</div>\n                            <div data-bind="text:NearLimit"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Over Limit</div>\n                            <div data-bind="text:OverLimit"></div>\n                        </div>\n\n                    </div>\n                    <div class="progress">\n                        <div class="bar" data-class="guidelines_tile_progress"></div>\n                    </div>\n                </div>\n            <!-- /ko -->\n        <!-- /ko -->\n        <!-- ko if: typeof $data.data_guidelines() === \'string\' -->\n            <div class="tile error" data-bind="text:data">\n            </div>\n        <!-- /ko -->\n    </div>\n</script>\n\n<script id="guidelines_secured_grid_template">\n    <div class="grid">\n        <!-- ko if: typeof $data.data_guidelines() === \'object\' -->\n            <!-- ko foreach: $data.data_guidelines -->\n                <div class="tile" data-class="guidelines_tile">\n                    <div class="info">\n                        <header>\n                            <i class="fa fa-plus"></i>\n                            <div data-bind="text:Title"></div>\n                        </header>\n\n                        <div class="item">\n                            <div class="head">Total</div>\n                            <div data-bind="text:Total_Tag"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Limit</div>\n                            <div data-bind="text:Limit_Tag"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Residual</div>\n                            <div data-bind="text:Residual_Tag"></div>\n                        </div>\n\n                    </div>\n                    <div class="progress">\n                        <div class="bar" data-class="guidelines_tile_progress"></div>\n                    </div>\n                </div>\n            <!-- /ko -->\n        <!-- /ko -->\n    </div>\n</script>\n\n<script id="guidelines_secured_sub_grid_template">\n    <div class="grid">\n        <!-- ko if: typeof $data.data_guidelines() === \'object\' -->\n            <!-- ko foreach: $data.data_guidelines -->\n                <div class="tile" data-class="guidelines_secured_sub_tile">\n                    <div class="info">\n                        <header>\n                            <i class="fa fa-plus"></i>\n                            <div data-bind="text:Title"></div>\n                        </header>\n\n                        <div class="item">\n                            <div class="head">Total</div>\n                            <div data-bind="text:Total_Tag"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Limit</div>\n                            <div data-bind="text:Limit_Tag"></div>\n                        </div>\n\n                        <div class="item">\n                            <div class="head">Residual</div>\n                            <div data-bind="text:Residual_Tag"></div>\n                        </div>\n\n                    </div>\n                    <div class="progress">\n                        <div class="bar" data-class="guidelines_tile_progress"></div>\n                    </div>\n                </div>\n            <!-- /ko -->\n        <!-- /ko -->\n    </div>\n</script>\n\n<script id="guidelines_table_template">\n    <div class="listjs">\n        <div class="listjs-header">\n            <ul>\n                <li>\n                    <!-- ko foreach: columns -->\n                    <div data-class="table_header_col"></div>\n                    <!-- /ko -->\n                </li>\n            </ul>\n        </div>\n        <div class="listjs-table">\n            <div class="listjs-list">\n                <ul class="list">\n                    <!-- ko foreach: rows -->\n                        <li data-class="table_row">\n                            <div data-bind="html: $parent[id_tag], css: id"></div>\n                        </li>\n                    <!-- /ko -->\n                </ul>\n            </div>\n        </div>\n        <!-- ko if: total -->\n        <div class="listjs-footer">\n            <ul>\n                <li>\n                    <!-- ko foreach: columns -->\n                        <div data-class="table_footer_total"></div>\n                    <!-- /ko -->\n                </li>\n            </ul>\n        </div>\n        <!-- /ko -->\n    </div>\n</script>\n\n<script id="guidelines_unsecured_template">\n    <!-- ko if: !data_guidelines() -->\n        <div class="drill_loading">\n            <div class="BMOloading"></div>\n        </div>\n    <!-- /ko -->\n    <!-- ko if: typeof data_guidelines() === "string" -->\n        <!-- ko template: "no_data_template" --><!-- /ko -->\n    <!-- /ko -->\n\n    <!-- ko if: data_guidelines() && typeof data_guidelines() !== "string" -->\n        <!-- ko template:\'guidelines_unsecured_grid_template\' -->\n        <!-- /ko -->\n    <!-- /ko -->\n\n    <!-- ko if:data_level1.params() -->\n    <div class="level1" data-bind="css:{subs:!!data_level1.sub()}">\n        <!-- ko if:data_level1() -->\n            <header data-class="guidelines_table_level1_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level1">\n            </div>\n            <div class="drill_sub">\n                <!-- ko with:data_level1.sub -->\n                    <!-- ko template: \'guidelines_unsecured_sub_grid_template\' -->\n                    <!-- /ko -->\n                <!-- /ko -->\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level1() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n\n    <!-- ko if:data_level2.params() && !window.restrictView -->\n    <div class="level2">\n        <!-- ko if:data_level2() -->\n            <header data-class="guidelines_table_level1_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_table_level2_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level2">\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level2() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n\n    <!-- ko if:data_level3.params() && !window.restrictView -->\n    <div class="level3">\n        <!-- ko if:data_level3() -->\n            <header data-class="guidelines_table_level1_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_table_level3_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level3">\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level3() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n\n    <!-- ko if:data_level4.params()  && !window.restrictView -->\n    <div class="level4">\n        <!-- ko if:data_level4() -->\n            <header data-class="guidelines_table_level1_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_table_level3_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_table_level4_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level4">\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level4() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n</script>\n\n<script id="guidelines_secured_template">\n    <!-- ko if: !data_guidelines() -->\n        <div class="drill_loading">\n            <div class="BMOloading"></div>\n        </div>\n    <!-- /ko -->\n    <!-- ko if: typeof data_guidelines() === "string" -->\n        <!-- ko template: "no_data_template" --><!-- /ko -->\n    <!-- /ko -->\n\n\n    <!-- ko if: data_guidelines() && typeof data_guidelines() !== "string" -->\n        <!-- ko template:\'guidelines_secured_grid_template\' -->\n        <!-- /ko -->\n    <!-- /ko -->\n    <!-- ko if:data_level1.params() -->\n    <div class="level1" data-bind="css:{subs:!!data_level1.sub()}">\n        <!-- ko if:data_level1() -->\n            <header data-class="guidelines_secured_table_level1_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level1">\n            </div>\n            <div class="drill_sub">\n                <!-- ko with:data_level1.sub -->\n                    <!-- ko template: \'guidelines_secured_sub_grid_template\' -->\n                    <!-- /ko -->\n                <!-- /ko -->\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level1() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n    <!-- ko if:data_level2.params() -->\n    <div class="level2">\n        <!-- ko if:data_level2() -->\n            <header data-class="guidelines_secured_table_level1_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_secured_table_level2_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level2_secured">\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level2() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n\n    <!-- ko if:data_level3.params() && !window.restrictView -->\n    <div class="level3">\n        <!-- ko if:data_level3() -->\n            <header data-class="guidelines_secured_table_level1_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_secured_table_level2_header">\n            </header>\n            <header>></header>\n            <header data-class="guidelines_secured_table_level3_header">\n            </header>\n            <div class="drill" data-class="guidelines_table_level3_secured">\n            </div>\n        <!-- /ko -->\n        <!-- ko if:!data_level3() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n    </div>\n    <!-- /ko -->\n\n</script>\n\n\n<script id="guidelines_template">\n    <div class="selector">\n        <div data-class="guidelines_unsecured">Unsecured</div>\n        <div data-class="guidelines_secured">Secured</div>\n    </div>\n    <header class="title" data-class="guidelines_header"></header>\n    <div class="data_wrapper" data-bind="css: data_selector">\n        <!-- ko if: data_selector() === "unsecured" -->\n            <!-- ko template: { name: "guidelines_unsecured_template", data: $data.unsecured } --><!-- /ko -->\n        <!-- /ko -->\n        <!-- ko if: data_selector() === "secured" -->\n            <!-- ko template: { name: "guidelines_secured_template", data: $data.secured } --><!-- /ko -->\n        <!-- /ko -->\n    </div>\n</script>\n';});


define('app/guidelines/bindings.js',[],function () {
    function toggleCSS ( el, cls ) {
        var list = el.className.split(' '),
            index = list.indexOf(cls);

        if (index < 0) {
            list.push(cls);
        } else {
            list.splice(index, 1);
        }

        el.className = list.join(' ');
    }

    function table ( data_set, drill ) {
        return function ( ctx ) {
            var params = this[data_set].params() || { };

            var data = this[data_set]();
            var columns = this[data_set].columns[params.guideline || params.GuidelineName] || [ ];

            if(data.length > 0) {
                if (data[0].hasOwnProperty('LimitStatus')) {
                    data.forEach(function (i) {
                        i._limitstatus = '<div class="' + i.LimitStatus + '"></div>';
                    });
                    columns = [{id:'_limitstatus', name:''}].concat(columns);
                }

                // if there is a drilldown
                if (/*params.level2Func && */drill) {
                    data.forEach(function (i) {
                        i._plus = '<i class="fa fa-plus"></i>';
                    });
                    columns = [{id:'_plus', name:''}].concat(columns);
                }
            }


            return {
                hmTap: function ( evt ) {
                    var x = evt.target;
                    //only handle this click if it was a child of a html tag with class 'list'
                    // while (x.className !== 'list') {
                    //     if(x.parentNode === document)   //if we get to root then dont handle this click
                    //         return;
                    //     x = x.parentNode;
                    // }
                    //
                    // if (evt.target.className === 'Tag') {   //click on tag
                    //     drill.call(
                    //         this, evt.target.innerText
                    //     );
                    // } else if (evt.target.parentNode.parentNode.children[2].className === 'Tag') {  //click on overlimit
                    //     drill.call(
                    //         this, evt.target.parentNode.parentNode.children[2].innerText
                    //     );
                    // } else if (evt.target.parentNode.children[1].className === 'Tag') { //click on row w/o overlimit
                    //     drill.call(
                    //         this, evt.target.parentNode.children[1].innerText
                    //     );
                    // } else if (evt.target.parentNode.children[2].className === 'Tag') { //click on + with overlimit
                    //     drill.call(
                    //         this, evt.target.parentNode.children[2].innerText
                    //     );
                    // }
                    if (/*params.level2Func && */drill && evt.target.parentNode.children[0] === evt.target) {
                        if (data[0].hasOwnProperty('CPsOverLimit') || data[0].hasOwnProperty('Residual')) {
                            drill.call(
                                this, (evt.target.parentNode.children[2] ||
                                    evt.target.parentNode.parentNode.children[2])
                                .innerText
                            );
                        } else {
                            drill.call(
                                this, (evt.target.parentNode.children[1] ||
                                    evt.target.parentNode.parentNode.children[1])
                                .innerText
                            );
                        }
                    } else {
                        toggleCSS(evt.target.parentNode, 'expand');
                    }
                },
                attr: { id: data_set + params.guideline },
                component: {
                    name: 'listjs_table',
                    params: {
                        id: data_set + params.guideline,
                        pagination: {
                            innerWindow: 10,
                            outerWindow: 1
                        },
                        rows: this[data_set](),
                        columns: columns
                    }
                }
            };
        };
    }//;

    return {
        guidelines_header: function ( ctx ) {
            var reset = function () {
                    this[this.data_selector()].undrill1();
                    this[this.data_selector()].undrill2();
                    this[this.data_selector()].undrill3();
                    this[this.data_selector()].undrill4 ? this[this.data_selector()].undrill4() : 0;
                }.bind(this);
            this.link.reset(reset);
            return {
                style: {
                    color: (this[this.data_selector()].data_level1.params() ||
                            this[this.data_selector()].data_level2.params() ||
                            this[this.data_selector()].data_level3.params() ||
                            (this[this.data_selector()].data_level4 ? this[this.data_selector()].data_level4.params() : false)) ? 'yellow' : 'white'
                },
                text: this.link.title,
                hmTap: reset
            };
        },
        guidelines_unsecured: function ( ctx ) {
            return {
                css: {
                    selected: this.data_selector() === 'unsecured'
                },
                hmTap: function () {
                    this.data_selector('unsecured');
                }
            };
        },
        guidelines_secured: function ( ctx ) {
            return {
                css: {
                    selected: this.data_selector() === 'secured'
                },
                hmTap: function () {
                    this.data_selector('secured');
                }
            };
        },
        guidelines_tile: function ( ctx ) {
            return {
                hmTap: function () {
                    (ctx.$parents[0].drill1 || ctx.$parents[1].drill3)(_.extend({
                        guideline:  this.Guideline || this.GuidelineName,
                        level1Func: this.Level1Func,
                        level2Func: this.Level2Func, // used only by level2/4 drill
                        tag: this.Level0DisplayName ||  this.Title
                    }, this));
                }//;
            };
        },
        guidelines_secured_sub_tile: function ( ctx ) {
            return {
                hmTap: function () {
                    ctx.$parents[1].drill1(this);
                }//;
            };
        },
        table_header_col: function ( ctx ) {
            return {
                html: this.name,
                css: this.id
            };
        },
        table_row: function ( ctx ) {
            return {
                css: this.LimitStatus,
                foreach: ctx.$parent.columns,
                hmTap: function ( ) {
                    if(ctx.$parent.drill) {
                        ctx.$parents[1].drill2(_.extend({
                            guideline: ctx.$parents[1].drill1().guideline,
                            level2Func: ctx.$parents[1].drill1().level2Func,
                            tag: this.Tag || this.Title
                        }, this));
                    }
                }
            };
        },
        table_footer_total: function ( ctx ) {
            var display_text = '';

            if(this.hasOwnProperty('total') && this.total) {
                if(this.hasOwnProperty('total_tag')) {
                    display_text = this.total_tag;
                } else {
                    display_text = _.reduce(ctx.$parent.rows,
                        function ( memo, item ) {
                            return memo + parseInt(item[this.id]);
                        }.bind(this), 0);
                    if(this.hasOwnProperty('bn') && this.bn) {
                        display_text = global.toolkit.filter.bn(display_text);
                    }
                }
            }

            return {
                css: this.id,
                text: display_text
            };
        },
        guidelines_table_level1: function ( ctx ) {
            var data_set = 'data_level1';
            var params = this[data_set].params() || { };

            var data = this[data_set]();
            console.log('guideline', params.guideline || params.GuidelineName);
            var columns = this[data_set].columns[params.guideline || params.GuidelineName] || [ ];

            if(data.length > 0) {
                // if there is a drilldown
                if (hasDrill(params, data)) {
                    data.forEach(function (i) {
                        i._plus = '<i class="fa fa-plus"></i>';
                    });
                    columns = [{id:'_plus', name:''}].concat(columns);
                }
            }

            columns.forEach(function ( col ) {
                if(!col.hasOwnProperty('id_tag')) {
                    col.id_tag = col.id;
                }
            });

            function hasDrill(params, data) {
                if(window.restrictView) {
                    if(params.level2Func !== undefined) { //unsecured
                        return false;
                    } else {
                        return data.length > 0 ? (typeof data[0].GroupbyAssetClassGuideline === "string" ? data[0].GroupbyAssetClassGuideline.length > 0 : false) : false;
                    }
                } else {
                    return params.level2Func || (data.length > 0 ? (typeof data[0].GroupbyAssetClassGuideline === "string" ? data[0].GroupbyAssetClassGuideline.length > 0 : false) : false);
                }
            }

            return {
                template: {
                    name: 'guidelines_table_template',
                    data: {
                        rows: data,
                        columns: columns,
                        drill: hasDrill(params, data),
                        total: true
                    }
                },
                css: params.guideline || params.GuidelineName
            };
        },

        //table('data_level1', function ( tag ) {
        //     this.drill2({
        //         guideline: this.drill1().guideline,
        //         level2Func: this.drill1().level2Func,
        //         tag: tag
        //     });
        // }),
        guidelines_table_level1_header: function ( ctx ) {
            var params = this.data_level1.params() || { };
            return {
                html: params.tag || params.Title,
                hmTap: function () {
                    this.undrill2();
                    this.undrill3();
                    this.undrill4 ? this.undrill4() : 0;
                }
            };
        },
        guidelines_secured_table_level1_header: function ( ctx ) {
            var params = this.data_level1.params() || { };
            return {
                html: params.Title,
                hmTap: function () {
                    this.undrill2();
                    this.undrill3();
                }
            };
        },
        guidelines_table_level2: table('data_level2'),
        guidelines_table_level2_secured: table('data_level2', window.restrictView ? null : function ( GroupbyAssetClass ) {
            this.drill3(_.chain(this.data_level2()).where({GroupbyAssetClass: GroupbyAssetClass}).first().value());
        }),
        guidelines_table_level2_header: function ( ctx ) {
            var params = this.data_level2.params() || { };
            return {
                html: params.tag
            };
        },
        guidelines_secured_table_level2_header: function ( ctx ) {
            var params = this.data_level2.params() || { };
            return {
                html: params.tag,
                hmTap: function () {
                    this.undrill3();
                }
            };
        },
        guidelines_table_level3: table('data_level3', function ( tag ) {
            this.drill4({
                guideline: this.drill1().guideline,
                level2Func: this.drill3().level2Func,
                tag: tag
            });
        }),
        guidelines_table_level3_secured: table('data_level3'),
        guidelines_table_level3_header: function ( ctx ) {
            var params = this.data_level3.params() || { };
            return {
                html: params.tag || params.LegalEntityName,
                hmTap: function () {
                    this.undrill4();
                }
            };
        },
        guidelines_secured_table_level3_header: function ( ctx ) {
            var params = this.data_level3.params() || { };
            return {
                html: params.GroupbyAssetClass,
                hmTap: function () {
                    this.undrill4();
                }
            };
        },
        guidelines_table_level4: table('data_level4'),
        guidelines_table_level4_header: function ( ctx ) {
            var params = this.data_level4.params() || { };
            return {
                html: params.tag
            };
        },
        guidelines_tile_progress: function ( ctx ) {
            return {
                css: this.LimitStatus
            };
        }
    };
});


define('scalejs.styles-less!app/guidelines/style',[],function(){});

define('app/guidelines/module',[
    'scalejs.sandbox!guidelines',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['guidelines', function ( item ) {
        item.page.link.title('Guidelines Summary');

        data = data(item.date);

        data["unsecured"].data_status.subscribe(item.page.link.status);
        data["secured"].data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

define('app/crisismgmt/model',[
    'scalejs.sandbox!crisismgmt'
], function (
    sandbox
) {

    

    return function ( date ) {

        var data = {
            C_DEPOSITS: 'DMRS',
            C_SECURITIES: 'CMRS',
            C_SECURITIES_ON: 'CMRS-ON',
            C_SECURITIES_OFF: 'CMRS-OFF',
            data_selector: sandbox.mvvm.observable('DMRS'),
            data_level1: sandbox.mvvm.observable(null),
            data_level2: sandbox.mvvm.observable(null),
            data_level3: sandbox.mvvm.observable(null),
            data_status: sandbox.mvvm.observable(''),
            date: null
        };

        // xhr and internal information declaration
        data.data_level1.selected = sandbox.mvvm.observable(null);
        data.data_level1.xhr = null;
        data.data_level2.selected = sandbox.mvvm.observable(null);
        data.data_level2.total = sandbox.mvvm.observable(0);
        data.data_level2.xhr = null;
        data.data_level3.total = sandbox.mvvm.observable(0);
        data.data_level3.xhr = null;

        data.data_level1.selected.subscribe(function ( change ) {
            if (!data.data_level1() || !change) { return; }
            data.data_level1().forEach(function ( item ) {
                item.selected(false);
            });
            change.selected(true);
        });

        // level 1
        sandbox.flag.register('load.uwf', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_level1(null);
                data.data_level1.selected(null);
                data.data_level2(null);
                data.data_level2.selected(null);
                data.data_level3(null);

                if (data.data_level1.xhr) {
                    data.data_level1.xhr.abort();
                }

                data.data_level1.xhr = sandbox.query({
                    group:  'PoC',
                    menu:   'GetCrisisScenarios',
                    params: [ data.data_selector() ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('crisismgmt:', err);
                    } else if (!items[0]) {
                        console.warn('crisismgmt: aborted level 1');
                    } else {
                        if (window.restrictView && data.data_selector() === data.C_DEPOSITS) {
                            items[0] = items[0].filter(function ( item ) {
                                return !(item.Scenario === 'Single Names');
                            });
                        }
                        data.data_level1(items[0].map(function ( item ) {
                            item.selected = sandbox.mvvm.observable(false);
                            return item;
                        }));
                        data.data_level1.selected(items[0][0]);
                    }
                });
            }
        });

        // level 2

        data.data_level2.selected.subscribe(function ( change ) {
            if(window.restrictView && data.data_selector() === data.C_DEPOSITS) {
                return;
            }
            if (!data.data_level2() || !change) { return; }
            data.data_level2().forEach(function ( item ) {
                item.selected(false);
            });
            change.selected(true);
        });

        sandbox.mvvm.computed(function () {
            if (!data.data_level1.selected()) { return; }
            data.data_level2(null);
            data.data_level2.total(0);
            data.data_level2.selected(null);
            data.data_level3(null);

            if (data.data_level2.xhr) {
                data.data_level2.xhr.abort();
            }
            if(date()) {
                data.data_level2.xhr = sandbox.query({
                    group:  'PoC',
                    menu:   'GetCrisisData',
                    params: [
                        date(),
                        data.data_level1.selected().Scenario,
                        0,
                        data.data_selector()
                    ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('crisismgmt:', err);
                    } else if (!items[0]) {
                        console.warn('crisismgmt: aborted level 2');
                    } else {
                        data.data_level2(items[0].map(function ( item ) {
                            item.selected = sandbox.mvvm.observable(false);
                            return item;
                        }));
                        data.data_level2.total((_.reduce(items[0],
                        function ( memo, item ) {
                            return memo + Number(item.AmountCDE);
                        }, 0) / 1000000000).toFixed(2));
                        data.data_level2.selected(items[0][0]);
                    }
                });
            }
        });

        // level 3

        sandbox.mvvm.computed(function () {
            if (!data.data_level1.selected()) { return; }
            if (!data.data_level2.selected()) { return; }
            data.data_level3(null);
            data.data_level3.total(0);

            if (data.data_level3.xhr) {
                data.data_level3.xhr.abort();
            }
            if(date()) {
                data.data_level3.xhr = sandbox.query({
                    group:  'PoC',
                    menu:   'GetCrisisDataDetail',
                    params: [
                        date(),
                        data.data_level1.selected().Scenario,
                        1,
                        data.data_selector(),
                        data.data_level2.selected().Tag
                    ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('crisismgmt:', err);
                    } else if (!items[0]) {
                        console.warn('crisismgmt: aborted level 3');
                    } else {
                        data.data_level3(items[0]);
                        data.data_level3.total((_.reduce(items[0],
                        function ( memo, item ) {
                            return memo + Number(item.AmountCDE);
                        }, 0) / 1000000000).toFixed(2));
                    }
                });
            }
        });

        return data;
    };

});


define('text!app/crisismgmt/view.html',[],function () { return '\n<script id="crisismgmt_template">\n    <header class="title" data-class="crisismgmt_header"></header>\n    <div class="selector">\n        <div data-class="crisismgmt_deposits">Deposits-UWF</div>\n        <div data-class="crisismgmt_securities">Secs-TOTAL</div>\n        <div data-class="crisismgmt_securities_on">Secs-ON B/S</div>\n        <div data-class="crisismgmt_securities_off">Secs-OFF B/S</div>\n    </div>\n    <div class="wrapper">\n        <div class="level1">\n            <!-- ko foreach:data_level1 -->\n                <div data-class="crisismgmt_level1">\n                    <div>&nbsp;</div>\n                    <div data-class="crisismgmt_level1_title"></div>\n                </div>\n            <!-- /ko -->\n            <!-- ko if:!data_level1() -->\n                <div class="drill_loading">\n                    <div class="BMOloading"></div>\n                </div>\n            <!-- /ko -->\n        </div>\n        <div class="level2">\n            <!-- ko foreach:data_level2 -->\n                <div data-class="crisismgmt_level2">\n                    <div data-class="crisismgmt_level2_amount"></div>\n                    <div data-class="crisismgmt_level2_title"></div>\n                </div>\n            <!-- /ko -->\n            <!-- ko if:!data_level2() -->\n                <div class="drill_loading">\n                    <div class="BMOloading"></div>\n                </div>\n            <!-- /ko -->\n        </div>\n        <!-- ko if: !(window.restrictView && $data.data_selector() === $data.C_DEPOSITS) -->\n        <div class="level3">\n            <!-- ko foreach:data_level3 -->\n                <div data-class="crisismgmt_level3">\n                    <div data-class="crisismgmt_level3_amount"></div>\n                    <div data-class="crisismgmt_level3_title"></div>\n                </div>\n            <!-- /ko -->\n            <!-- ko if:!data_level3() -->\n                <div class="drill_loading">\n                    <div class="BMOloading"></div>\n                </div>\n            <!-- /ko -->\n        </div>\n        <!-- /ko -->\n    </div>\n    <div class="totals">\n        <div class="level1">Total</div>\n        <div class="level2"data-bind="text:data_level2.total() + \' Bn\'"></div>\n        <!-- ko if: !(window.restrictView && $data.data_selector() === $data.C_DEPOSITS) -->\n        <div class="level3"data-bind="text:data_level3.total() + \' Bn\'"></div>\n        <!-- /ko -->\n    </div>\n</script>\n';});


define('app/crisismgmt/bindings.js',{
    crisismgmt_header: function ( ctx ) {
        return {
            text: this.link.title
        };
    },
    crisismgmt_deposits: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_DEPOSITS
            },
            hmTap: function () {
                this.data_selector(this.C_DEPOSITS);
            }
        };
    },
    crisismgmt_securities: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_SECURITIES
            },
            hmTap: function () {
                this.data_selector(this.C_SECURITIES);
            }
        };
    },
    crisismgmt_securities_on: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_SECURITIES_ON
            },
            hmTap: function () {
                this.data_selector(this.C_SECURITIES_ON);
            }
        };
    },
    crisismgmt_securities_off: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_SECURITIES_OFF
            },
            hmTap: function () {
                this.data_selector(this.C_SECURITIES_OFF);
            }
        };
    },
    crisismgmt_level1: function ( ctx ) {
        return {
            css: {
                selected: this.selected
            },
            hmTap: function () {
                ctx.$parent.data_level1.selected(this);
            }
        };
    },
    crisismgmt_level1_title: function ( ctx ) {
        return {
            text: this.Scenario
        };
    },
    crisismgmt_level2: function ( ctx ) {
        return {
            css: {
                selected: this.selected
            },
            hmTap: function () {
                ctx.$parent.data_level2.selected(this);
            }
        };
    },
    crisismgmt_level2_title: function ( ctx ) {
        return {
            text: this.Tag
        };
    },
    crisismgmt_level2_amount: function ( ctx ) {
        return {
            text: this.AmountCdeBillions
        };
    },
    crisismgmt_level3: function ( ctx ) {
        return {
        };
    },
    crisismgmt_level3_title: function ( ctx ) {
        return {
            text: this.Tag2
        };
    },
    crisismgmt_level3_amount: function ( ctx ) {
        return {
            text: this.AmountCdeBillions
        };
    }
});


define('scalejs.styles-less!app/crisismgmt/style',[],function(){});

define('app/crisismgmt/module',[
    'scalejs.sandbox!crisismgmt',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['crisismgmt', function ( item ) {
        item.page.link.title('Liquidity Management (CDE)');

        data = data(item.date);

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});



define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

define('app/maturity/model',[
    'scalejs.sandbox!maturity'
], function (
    sandbox
) {

    

    return function ( date ) {

        var data = {
            C_NONE: 0,
            C_CCY: 1,
            C_LOB: 2,
            data_charttype: sandbox.mvvm.observable(0),
            data_profile: sandbox.mvvm.observable(null),
            data_status: sandbox.mvvm.observable(''),
            date: null
        };

        data.data_profile.xhr = null;

        function process ( data ) {
            var ret = {
                ccy: { },
                lob: { }
            };

            data = _.groupBy(data, 'Period');

            var total_ccy = 0;
            var total_lob = 0;

            _.each(data, function ( period, key ) {
                var sum = 0;
                ret.ccy[key] = _.groupBy(period, 'Ccy');
                _.each(ret.ccy[key], function ( ccy, key, list ) {
                    sum += list[key] = _.reduce(ccy, function ( memo, val ) {
                        return memo + Number(val.NotionalPrincipalAmt) / 1000000000;
                    }, 0) || 0;
                });
                total_ccy += ret.ccy[key].TOTAL = sum;

                sum = 0;
                ret.lob[key] = _.groupBy(period, 'LoB');
                _.each(ret.lob[key], function ( lob, key, list ) {
                    sum += list[key] = _.reduce(lob, function ( memo, val ) {
                        return memo + Number(val.NotionalPrincipalAmt) / 1000000000;
                    }, 0) || 0;
                });
                total_lob += ret.lob[key].TOTAL = sum;

            });
            ret.ccy.TOTAL = total_ccy;
            ret.lob.TOTAL = total_lob;

            console.log(ret)

            return ret;
        };

        sandbox.flag.register('load.maturity', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_profile(null);
                if (data.data_profile.xhr) {
                    data.data_profile.xhr.abort();
                }
                data.data_profile.xhr = sandbox.query({
                    group: 'Liquidity',
                    menu: 'GetMaturityPeriods',
                    params: [ date(), 'All' ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('maturity: ', err);
                        data.data_profile(err);
                    } else {
                        if (items.length) {
                            data.data_profile(process(items[0]));
                        }
                    }
                })
            }
        });

        return data;

    }

});


define('text!app/maturity/view.html',[],function () { return '<script id="maturity_template">\n    <div class="selector">\n        <div data-class="maturity_non">None</div>\n        <div data-class="maturity_ccy">CCY</div>\n        <div data-class="maturity_lob">LOB</div>\n    </div>\n    <header class="title" data-class="maturity_header"></header>\n    <!-- ko if: !data_profile() -->\n        <div class="drill_loading">\n            <div class="BMOloading"></div>\n        </div>\n    <!-- /ko -->\n    <!-- ko if: typeof data_profile() === "string" -->\n        <!-- ko template: "no_data_template" --><!-- /ko -->\n    <!-- /ko -->\n    <!-- ko if: typeof data_profile() !== "string" -->\n        <div class="wrapper">\n            <div class="chart" data-class="maturity_chart">\n            </div>\n            <div class="table">\n                <table data-class="maturity_table">\n                    <thead>\n                        <tr>\n                            <th data-bind="text:$data.title">\n                            </th>\n                            <!-- ko foreach: x -->\n                                <th data-bind="text:$data">\n                                </th>\n                            <!-- /ko -->\n                        </tr>\n                    </thead>\n                    <tbody>\n                        <!-- ko foreach: y -->\n                            <tr>\n                                <td data-bind="text:$data">\n                                </td>\n                                <!-- ko foreach: $parent.x -->\n                                    <td data-bind="text:($parents[1].data[$data][$parent] || 0).toFixed(2) + \' Bn\'">\n                                    </td>\n                                <!-- /ko -->\n                            </tr>\n                        <!-- /ko -->\n                        <tr>\n                            <td>TOTAL</td>\n                            <!-- ko foreach: x -->\n                                <td data-bind="text:($parent.data[$data].TOTAL || 0).toFixed(2) + \' Bn\'">\n                                </td>\n                            <!-- /ko -->\n                        </tr>\n                    </tbody>\n                </table>\n            </div>\n        </div>\n    <!-- /ko -->\n</script>\n';});


define('app/maturity/bindings.js',['scalejs.sandbox!maturity'], function ( sandbox ) {
    function _dataset ( set, r, g, b, data ) {
        var color = 'rgba(' + r + ',' + g + ',' + b + ',';
        var d = {
            label: data,
            fillColor       : color + '0.50)',
            strokeColor     : color + '0.80)',
            highlightFill   : color + '0.75)',
            highlightStroke : color + '1.00)',
            data: _.first(_.map(
                _.pluck(this.data_profile()[set], data),
                function (d) { return d || 0; }
            ), 6)//;
        };
        return d;
    }

    return {
        maturity_header: function ( ctx ) {
            return {
                text: this.link.title
            };
        },
        maturity_non: function ( ctx ) {
            return {
                css: { selected: this.data_charttype() === this.C_NONE },
                hmTap: function () { this.data_charttype(this.C_NONE); }
            };
        },
        maturity_ccy: function ( ctx ) {
            return {
                css: { selected: this.data_charttype() === this.C_CCY },
                hmTap: function () { this.data_charttype(this.C_CCY); }
            };
        },
        maturity_lob: function ( ctx ) {
            return {
                css: { selected: this.data_charttype() === this.C_LOB },
                hmTap: function () { this.data_charttype(this.C_LOB); }
            };
        },
        maturity_table: function ( ctx ) {
            var y_order;
            var profile = this.data_profile();
            var title = '', x = [ ], y = [ ];

            if (profile && typeof profile === 'object') {
                switch ( this.data_charttype() )
                {
                case this.C_NONE:
                case this.C_CCY:
                    title = 'Ccy';
                    profile = profile.ccy;
                    y_order = ['CAD', 'USD', 'EUR', 'GBP', 'OTHER'];
                    break;
                case this.C_LOB:
                    title = 'LoB';
                    profile = profile.lob;
                    y_order = ['DEBT PRODUCTS', 'FINANCIAL PRODUCTS', 'OTHER', 'TOTAL'];
                    break;
                }
                y = _.without(_.reduce(profile, function ( memo, d ) {
                    if (typeof d !== 'object') { return memo; }
                    return _.union(memo, Object.keys(d));
                }, y), 'TOTAL');

                //order rows by y_order
                y = _.sortBy(y, function ( obj ) {
                    var index = _.indexOf(y_order, obj);
                    //make sure anything not in the order specified is added at the end rather than the beginning
                    return index > -1 ? index : y_order.length;
                });
                x = _.without(Object.keys(profile), 'TOTAL');
            }

            return {
                with: {
                    title: title,
                    data: profile || {},
                    x: x,
                    y: y
                }
            };
        },
        maturity_chart: function ( ctx ) {

            this.id = 'foobar';

            return {
                attr: { id: this.id },
                component: {
                    name: 'chart',
                    params: {
                        //labels: ['0-7 Days', '8-30 Days', '31-90 Days', '91-180 Days', '181-365 Days', '> 365 Days'],
                        dataset: sandbox.mvvm.computed(function () {
                            var self = { };
                            var data = this.data_profile();
                            if (!data || typeof data !== 'object') return self;
                            var key, val;

                            switch (this.data_charttype()) {
                            case this.C_NONE:
                                for (key in data['ccy']) {
                                    if (key === 'TOTAL') { continue; }
                                    self[key] = {
                                        TOTAL: data['ccy'][key]['TOTAL'] || 0
                                    };
                                }
                                break;
                            case this.C_CCY:
                                for (key in data['ccy']) {
                                    if (key === 'TOTAL') { continue; }
                                    self[key] = {
                                        CAD: data['ccy'][key]['CAD'] || 0,
                                        USD: data['ccy'][key]['USD'] || 0,
                                        EUR: data['ccy'][key]['EUR'] || 0,
                                        GBP: data['ccy'][key]['GBP'] || 0,
                                        OTHER: data['ccy'][key]['OTHER'] || 0
                                    };
                                }
                                break;
                            case this.C_LOB:
                                for (key in data['lob']) {
                                    if (key === 'TOTAL') { continue; }
                                    self[key] = {
                                        'DP': data['lob'][key]['DEBT PRODUCTS'] || 0,
                                        'FP': data['lob'][key]['FINANCIAL PRODUCTS'] || 0,
                                        'OTHER': data['lob'][key]['OTHER'] || 0
                                    };
                                }
                                break;
                            };

                            return self;

                        }.bind(this))//;
                    }
                }//;
            };
        }//;
    };
});


define('scalejs.styles-less!app/maturity/style',[],function(){});

define('app/maturity/module',[
    'scalejs.sandbox!maturity',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['maturity', function ( item ) {
        item.page.link.title('Maturity Profile');

        data = data(item.date);

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);
});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

define('app/uwf/model',[
    'scalejs.sandbox!uwf'
], function (
    sandbox
) {

    

    return function ( date ) {

        var data = {
            C_PRODUCT: 'PRODUCT',
            C_LCR: 'Lcr',
            data_selector: sandbox.mvvm.observable('PRODUCT'),
            data_level1: sandbox.mvvm.observable(null),
            data_level2: sandbox.mvvm.observable(null),
            data_status: sandbox.mvvm.observable(''),
            date: null
        };

        // xhr and internal information declaration
        data.data_level1.selected = sandbox.mvvm.observable(null);
        data.data_level1.xhr = null;
        data.data_level2.xhr = null;

        // level 1
        sandbox.flag.register('load.uwf', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_level1(null);
                data.data_level1.selected(null);

                if (data.data_level1.xhr) {
                    data.data_level1.xhr.abort();
                }
                data.data_level1.xhr = sandbox.query({
                    group:  'Liquidity',
                    menu:   'UwfByLoB',
                    params: [ date(), data.data_selector() ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('uwf:', err);
                    } else if (!items[0]) {
                        console.warn('uwf: aborted level 1');
                    } else {
                        data.data_level1(items[0]);
                    }
                });
            }
        });

        // level 2

        sandbox.mvvm.computed(function () {
            if (!data.data_level1.selected()) { return; }
            data.data_level2(null);

            if (data.data_level2.xhr) {
                data.data_level2.xhr.abort();
            }
            if(date()) {
                data.data_level2.xhr = sandbox.query({
                    group:  'Liquidity',
                    menu:   'UwfByLoBBreakdown',
                    params: [
                        date(),
                        data.data_level1.selected().LoB.substring(7),
                        data.data_selector()
                    ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('uwf:', err);
                    } else if (!items[0]) {
                        console.warn('uwf: aborted level 2');
                    } else {
                        console.log('l2:', items);
                        data.data_level2(items[0].map(function (item) {
                            /*return global.toolkit.filter.object(item, {
                                bn: ['TotalAmtCDE', 'LessEqual30D', 'Greater30D', 'Variance']
                            });*/
                            item['TotalAmtCDE_Tag'] = global.toolkit.filter.bn(item['TotalAmtCDE']);
                            item['LessEqual30D_Tag'] = global.toolkit.filter.bn(item['LessEqual30D']);
                            item['Greater30D_Tag'] = global.toolkit.filter.bn(item['Greater30D']);
                            item['Variance_Tag'] = global.toolkit.filter.bn(item['Variance']);
                            if(item.hasOwnProperty('LCRRunOff')) {
                                item['LCRRunOff_Tag'] = global.toolkit.filter.percent(item['LCRRunOff']);
                            }
                            return item;
                        }));
                    }
                });
            }
        });

        return data;
    };

});


define('text!app/uwf/view.html',[],function () { return '\n<script id="uwf_template">\n    <div class="selector">\n        <div data-class="uwf_product">Product</div>\n        <div data-class="uwf_lcr">LCR</div>\n    </div>\n    <header class="title" data-class="uwf_header"></header>\n    <div class="wrapper">\n        <div class="level1">\n            <!-- ko if: data_level1() -->\n                <div>\n                    <header>\n                        <div></div>\n                    </header>\n                    <section>\n                        <div>\n                            <span>Amount</span>\n                        </div>\n                        <div>\n                            <span><=30 Days</span>\n                        </div>\n                        <div>\n                            <span>>30 Days</span>\n                        </div>\n                        <div>\n                            <span>DoD Variance</span>\n                        </div>\n                    </section>\n                </div>\n            <!-- /ko -->\n            <!-- ko foreach:data_level1 -->\n                <div data-class="uwf_level1">\n                    <header>\n                        <div data-class="uwf_level1_title"></div>\n                    </header>\n                    <section>\n                        <div>\n                            <span data-class="uwf_level1_total"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_less"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_more"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_variance"></span>\n                        </div>\n                    </section>\n                </div>\n            <!-- /ko -->\n            <!-- ko if: data_level1() -->\n                <div>\n                    <header>\n                        <div>TOTAL</div>\n                    </header>\n                    <section>\n                        <div>\n                            <span data-class="uwf_level1_total_total"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_less_total"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_more_total"></span>\n                        </div>\n                        <div>\n                            <span data-class="uwf_level1_variance_total"></span>\n                        </div>\n                    </section>\n                </div>\n            <!-- /ko -->\n            <!-- ko if:!data_level1() -->\n                <div class="drill_loading">\n                    <div class="BMOloading"></div>\n                </div>\n            <!-- /ko -->\n        </div>\n        <!-- ko if:data_level1.selected() -->\n        <div class="level2">\n            <!-- ko if:data_level2() -->\n                <div data-class="uwf_table_level2">\n                </div>\n            <!-- /ko -->\n            <!-- ko if:!data_level2() -->\n                <div class="drill_loading">\n                    <div class="BMOloading"></div>\n                </div>\n            <!-- /ko -->\n        </div>\n        <!-- /ko -->\n    </div>\n</script>\n';});


define('app/uwf/bindings.js',{
    uwf_header: function ( ctx ) {
        var reset = function ( ) {
            this.data_level1.selected(null);
        }.bind(this);
        this.link.reset(reset);
        return {
            text: this.link.title,
            style: {
                color: this.data_level1.selected() ? 'yellow' : ''
            },
            hmTap: function ( ) {
                reset();
            }
        };
    },
    uwf_product: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_PRODUCT
            },
            hmTap: function () {
                this.data_selector(this.C_PRODUCT);
            }
        };
    },
    uwf_lcr: function ( ctx ) {
        return {
            css: {
                selected: this.data_selector() === this.C_LCR
            },
            hmTap: function () {
                this.data_selector(this.C_LCR);
            }
        };
    },
    uwf_level1: function ( ctx ) {
        return {
            hmTap: function () {
                ctx.$parent.data_level1.selected(this);
            }
        };
    },
    uwf_level1_title: function ( ctx ) {
        return {
            text: this.LoB.substring(7)
        };
    },
    uwf_level1_variance: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(this.Variance)
        };
    },
    uwf_level1_variance_total: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(_.reduce(this.data_level1(),
                function (memo, num) {
                    return memo + parseInt(num.Variance);
                }, 0))
        }
    },
    uwf_level1_total: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(this.Total)
        };
    },
    uwf_level1_total_total: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(_.reduce(this.data_level1(),
                function (memo, num) {
                    return memo + parseInt(num.Total);
                }, 0))
        }
    },
    uwf_level1_less: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(this.LessEqual30D)
        };
    },
    uwf_level1_less_total: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(_.reduce(this.data_level1(),
                function (memo, num) {
                    return memo + parseInt(num.LessEqual30D);
                }, 0))
        }
    },
    uwf_level1_more: function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(this.Greater30D)
        };
    },
    uwf_level1_more_total : function ( ctx ) {
        return {
            text: global.toolkit.filter.bn(_.reduce(this.data_level1(),
                function (memo, num) {
                    return memo + parseInt(num.Greater30D);
                }, 0))
        };
    },
    uwf_table_level2: function ( ctx ) {
        var cols = [
            {
            id: 'Type',
            name:'Type',
            total: true,
            total_tag: 'Total'
        }, {
            id: 'TotalAmtCDE',
            id_tag: 'TotalAmtCDE_Tag',
            name:'Amount',
            bn: true,
            total: true
        }, {
            id: 'LessEqual30D',
            id_tag: 'LessEqual30D_Tag',
            name: '<= 30D',
            bn: true,
            total: true
        }, {
            id: 'Greater30D',
            id_tag: 'Greater30D_Tag',
            name: '> 30D',
            bn: true,
            total: true
        }, {
            id: 'Variance',
            id_tag: 'Variance_Tag',
            name: 'DoD Variance',
            bn: true,
            total: true
        }];

        if(this.data_selector() === 'Lcr') {
            cols.splice(1, 0, {
                id: 'LCRRunOff',
                id_tag: 'LCRRunOff_Tag',
                name: 'Total LCR',
                total: false
            });
        }

        return {
            attr: {
                id: 'uwf_drill_01'
            },
            component: {
                name: 'listjs_table',
                params: {
                    title: this.data_level2.title,
                    id: 'uwf_drill_01',
                    pagination: {
                        innerWindow: 10,
                        outerWindow: 1
                    },
                    columns: cols,
                    rows: this.data_level2()
                }//;
            }//;
        };
    }
});


define('scalejs.styles-less!app/uwf/style',[],function(){});

define('app/uwf/module',[
    'scalejs.sandbox!uwf',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['uwf', function ( item ) {
        item.page.link.title('UWF By LOB');

        data = data(item.date);

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });


define('app/nccf/data',[
    'scalejs.sandbox!nccf'
], function (
    sandbox
) {
    'use strict'
    return {
        columns: [
            {
                id: 'Tag',
                tag: 'Category'
            },
            {
                id: 'Balance',
                tag: 'Balance',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Week1',
                tag: 'Week1',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Week2',
                tag: 'Week2',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Week3',
                tag: 'Week3',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Week4',
                tag: 'Week4',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month2',
                tag: 'Month2',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month3',
                tag: 'Month3',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month4',
                tag: 'Month4',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month5',
                tag: 'Month5',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month6',
                tag: 'Month6',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month7',
                tag: 'Month7',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month8',
                tag: 'Month8',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month9',
                tag: 'Month9',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month10',
                tag: 'Month10',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month11',
                tag: 'Month11',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Month12',
                tag: 'Month12',
                format: sandbox.global.toolkit.filter.bn
            },
            {
                id: 'Grtr365',
                tag: 'Over 365',
                format: sandbox.global.toolkit.filter.bn
            }
        ],
        drilldowns: [
            {
                menu: 'GetNccfLevel1',
                params: ['ValueDate', 'Category']
            }//,
            // {
            //     menu: 'GetNccfLevel2',
            //     params: ['ValueDate', 'Category', 'Product']
            // },
            // {
            //     menu: 'GetNccfLevel3',
            //     params: ['ValueDate', 'Category', 'Product', 'Source']
            // },
            // {
            //     menu: 'GetNccfLevel4',
            //     params: ['ValueDate', 'Category', 'Product', 'Source', 'CategoryGroup3']
            // },
            // {
            //     menu: 'GetNccfLevel5',
            //     params: ['ValueDate', 'Category', 'Product', 'Source', 'CategoryGroup3', 'Rating']
            // }
        ]
    }
});


define('app/nccf/model',[
    'scalejs.sandbox!nccf',
    './data'
], function (
    sandbox,
    backendMetadata
) {

    
    return function ( date ) {
        var data_subguidelines = { };
        var drilldown_calls = backendMetadata.drilldowns;
        var data = {
            data_categories : sandbox.mvvm.observable(null),
            data_status: sandbox.mvvm.observable(''),
            no_data: sandbox.mvvm.observable(false),
            data_loading: sandbox.mvvm.observable(false),
            columns: backendMetadata.columns,
            date: null
        };

        function collect ( name, what ) {
            return function ( err, data ) {
                if ( !err ) {
                    what(data[0]);
                } else {
                    what('There was an error loading ' + name);
                    console.error('nccf: error: ' + err);
                }
            };
        }//;

        var toggle_drilldown = function () {
            if(this.drilldown_calls.length > 0) {
                if(this.drilldowns().length === 0) {
                    var params = _.map(this.drilldown_calls[0].params, function (params) {
                        return this[params];
                    }.bind(this));
                    console.log('nccf: drilldown: ', this.drilldown_calls[0].menu, params);
                    data.data_loading(true);
                    sandbox.query({
                        group:  'Nccf',
                        menu:   this.drilldown_calls[0].menu,
                        params: params
                    }, function (err, result) {
                        data.data_loading(false);
                        if(!err) {
                            console.log('nccf: drilldown: data:', this.drilldown_calls[0].menu, params, result[0]);
                            this.drilldowns(_.map(result[0], function ( item ) {
                                item.ValueDate = this.ValueDate;
                                item.drilldown_calls = this.drilldown_calls.slice(1);
                                //item.Category = item.Tag;
                                item.drilldowns = sandbox.mvvm.observableArray([]);
                                item.toggle_drilldown = this.toggle_drilldown;
                                return item;
                            }.bind(this)));
                        } else {
                            what('There was an error loading ', this.drilldown_calls[0], params);
                            console.error('nccf: error: ' + err);
                        }
                    }.bind(this));
                } else {
                    this.drilldowns([]);
                }
            }
        }

        data.reset = function () {
            _.forEach(data.data_categories(), function (item) {
                item.drilldowns([]);
            });
        }

        var collect_categories = collect('Categories', function ( categories ) {
            if (typeof categories !== 'string') {
                console.log('nccf: categories: data:', categories);
                if(categories) {
                    data.data_categories(_.map(categories, function ( item ) {
                        if (item.Tag.indexOf('NET CUMULATIVE') > -1) {
                            item.Balance = undefined;
                        }
                        item.ValueDate = date();
                        item.drilldown_calls = drilldown_calls;
                        //item.Category = item.Tag;
                        item.drilldowns = sandbox.mvvm.observableArray([]);
                        item.toggle_drilldown = toggle_drilldown;
                        return item;
                    }));
                    console.log("Nccf", categories);
                } else {
                    data.no_data(true);
                }
            } else {
                data.data_status('');
            }
        });

        // collect guidelines when date changes
        sandbox.flag.register('load.nccf', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_categories(null);
                data.no_data(false);
                sandbox.query({
                    group:  'Nccf',
                    menu:   'GetNccfTopLevel',
                    params: [ date() ]
                }, collect_categories);
            }
        });

        return data;
    };
});


define('text!app/nccf/view.html',[],function () { return '<script id="nccf_recursive_cell">\n    <li class="row" data-bind="foreach: columns">\n        <div class="cell" data-class="nccf_table_cell"></div>\n    </li>\n    <!-- ko class: nccf_table_cell_drilldown -->\n    <!-- /ko -->\n</script>\n\n<script id="nccf_recursive_category">\n    <li class="row" data-bind="foreach: columns">\n        <div class="cell" data-class="nccf_table_category"></div>\n    </li>\n    <!-- ko class: nccf_table_category_drilldown -->\n    <!-- /ko -->\n</script>\n\n<script id="nccf_template">\n    <header class="title" data-class="nccf_header"></header>\n    <div class="data_wrapper">\n        <!-- ko if:data_categories() -->\n            <div class="listjs fixed">\n                <div class="listjs-header">\n                    <ul>\n                        <li class="row">\n                            <!-- ko with: columns[0] -->\n                            <div class="cell" data-class="nccf_table_header_col"></div>\n                            <!-- /ko -->\n                        </li>\n                    </ul>\n                </div>\n                <div class="listjs-table">\n                    <div class="listjs-list">\n                        <ul class="list">\n                            <!-- ko foreach: data_categories -->\n                                <!-- ko template: {name: \'nccf_recursive_category\', data: {columns: [$parent.columns[0]], data: $data}} -->\n                                <!-- /ko -->\n                            <!-- /ko -->\n                        </ul>\n                    </div>\n                </div>\n            </div>\n        <!-- /ko -->\n        <!-- ko if:data_categories() -->\n        <div class="scrollable">\n            <div class="listjs">\n                <div class="listjs-header">\n                    <ul>\n                        <li class="row">\n                            <!-- ko foreach: columns.slice(1) -->\n                            <div class="cell" data-class="nccf_table_header_col"></div>\n                            <!-- /ko -->\n                        </li>\n                    </ul>\n                </div>\n                <div class="listjs-table">\n                    <div class="listjs-list">\n                        <ul class="list">\n                            <!-- ko foreach: data_categories -->\n                                <!-- ko template: {name: \'nccf_recursive_cell\', data: {columns: $parent.columns.slice(1), data: $data}} -->\n                                <!-- /ko -->\n                            <!-- /ko -->\n                        </ul>\n                    </div>\n                </div>\n            </div>\n        </div>\n        <!-- /ko -->\n        <!-- ko if: (!data_categories() && !no_data()) || data_loading() -->\n            <div class="drill_loading">\n                <div class="BMOloading"></div>\n            </div>\n        <!-- /ko -->\n        <!-- ko if:no_data() -->\n            <!-- ko template: "no_data_template" --><!-- /ko -->\n        <!-- /ko -->\n    </div>\n</script>\n';});


define('app/nccf/bindings.js',[],function () {

    return {
        nccf_header: function ( ctx ) {
            return {
                text: this.link.title
            };
        },
        nccf_table_header_col: function ( ctx ) {
            return {
                text: this.tag,
                id: this.id
            };
        },
        nccf_table_category: function ( ctx ) {
            var value = ctx.$parent.data[this.id],
                css = {};
            if(this.format && _.isFunction(this.format)) {
                value = this.format(value);
            }
            css[this.id] = true;
            if(ctx.$parent.data.Level > 0) {
                css['drillArrow'] = true;
            }

            css.selected = ctx.$parent.data.drilldowns().length > 0;

            return {
                text: value,
                css: css,
                style: {
                    paddingLeft: (ctx.$parent.data.Level * 30) + 'px'
                },
                click: function ( ) {
                    _.forEach(ctx.$parents[2].data_categories(), function ( item ) {
                        if(item.Tag !== ctx.$parent.data.Tag) {
                            item.drilldowns([]);
                        }
                    });
                    if(ctx.$parent.data.hasOwnProperty('Category') && ctx.$parent.data.Category.length > 0) {
                        ctx.$parent.data.toggle_drilldown();
                    }
                }
            };
        },
        // nccf_table_cell: function ( ctx ) {
        //     var value = ctx.$parent[this.id];
        //     if(this.format && _.isFunction(this.format)) {
        //         value = this.format(value);
        //     }
        //     return {
        //         text: value,
        //         css: this.id
        //     };
        // },
        nccf_table_cell: function ( ctx ) {
            var value = ctx.$parent.data[this.id];
            if(this.format && _.isFunction(this.format)) {
                value = this.format(value);
            }
            return {
                text: value,
                css: this.id
            }
        },
        nccf_table_cell_drilldown: function ( ctx ) {
            return {
                template: {
                    name: 'nccf_recursive_cell',
                    foreach: _.map(this.data.drilldowns(), function ( item ) {
                        return {
                            columns: this.columns,
                            data: item
                        };
                    }.bind(this))
                }
            }
        },
        nccf_table_category_drilldown: function ( ctx ) {
            return {
                template: {
                    name: 'nccf_recursive_category',
                    foreach: _.map(this.data.drilldowns(), function ( item ) {
                        return {
                            columns: this.columns,
                            data: item
                        };
                    }.bind(this))
                }
            }
        }

    };
});


define('scalejs.styles-less!app/nccf/style',[],function(){});

define('app/nccf/module',[
    'scalejs.sandbox!nccf',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['nccf', function ( item ) {
        item.page.link.title('Est. Net Cumulative Cash (NCCF)');

        data = data(item.date);

        item.page.link.reset(data.reset);

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

define('app/counterparties/model',[
    'scalejs.sandbox!counterparties'
], function (
    sandbox
) {

    

    return function ( date ) {

        var data = {
            data_drill: sandbox.mvvm.observable(null),
            data_status: sandbox.mvvm.observable(''),
            date: null
        };

        // xhr and internal information declaration
        data.data_drill.selected = sandbox.mvvm.observable(null);
        data.data_drill.xhr = null;

        // level 1
        sandbox.flag.register('load.counterparties', function () {
            if(date() && date() !== data.date) {
                data.date = date();
                data.data_drill(null);
                data.data_drill.selected(null);

                if (data.data_drill.xhr) {
                    data.data_drill.xhr.abort();
                }
                data.data_drill.xhr = sandbox.query({
                    group:  'Liquidity',
                    menu:   'GetTopCounterParties',
                    params: [ date() ]
                }, function ( err, items ) {
                    if (err) {
                        console.error('counterparties:', err);
                    } else if (!items[0]) {
                        console.warn('counterparties: aborted level 1');
                    } else {
                        data.data_drill(items[0].map(function (item) {
                            item.TotalCDE_tag = global.toolkit.filter.bn(item.TotalCDE);
                            item.TotalUSE_tag = global.toolkit.filter.bn(item.TotalUSE);
                            return item;
                        }));
                    }
                });
            }
        });

        return data;
    };

});


define('text!app/counterparties/view.html',[],function () { return '\n<script id="counterparties_template">\n    <header class="title" data-class="counterparties_header"></header>\n    <div class="wrapper">\n        <div class="drill" data-class="counterparties_table" id="counterparties_table"></div>\n    </div>\n</script>\n';});


define('app/counterparties/bindings.js',{
    counterparties_header: function ( ctx ) {
        return {
            text: this.link.title
        };
    },
    counterparties_table: function ( ctx ) {
        return {
            component: {
                name: 'listjs_table',
                params: {
                    // title: 'Top 20 Counterparties',
                    id: 'counterparties_table',
                    // pagination: {
                    //     innerWindow: 10,
                    //     outerWindow: 1
                    // },
                    total: true,
                    columns: [{
                            id: 'Parent_UEN_Name',
                            name: 'Counter Party',
                            type: 'string',
                            total: true,
                            total_tag: 'Totals',
                            total: false
                        }, {
                            id: 'TotalCDE',
                            id_tag: 'TotalCDE_tag',
                            type: 'number',
                            name: 'CDE',
                            total: true,
                            bn: true
                        }, {
                            id: 'TotalUSE',
                            id_tag: 'TotalUSE_tag',
                            type: 'number',
                            name: 'USE',
                            total: true,
                            bn: true
                        }],
                    rows: this.data_drill()
                }
            }
        };
    }
});


define('scalejs.styles-less!app/counterparties/style',[],function(){});
define('app/counterparties/module',[
    'scalejs.sandbox!counterparties',
    './model',
    'text!./view.html',
    './bindings.js',
    'scalejs.styles-less!./style'
], function (
    sandbox,
    data,
    view, bindings
) {

    

    if (window.restrictView) return;

    sandbox.mvvm.registerTemplates(view);
    sandbox.mvvm.registerBindings(bindings);

    sandbox.flag.wait('page.create', ['counterparties', function ( item ) {
        item.page.link.title('Top 20 Counterparties');

        data = data(item.date);

        data.data_status.subscribe(item.page.link.status);

        for (var key in data) {
            item.page[key] = data[key];
        }

    }]);

});


define("scalejs.extensions", ["scalejs.mvvm","backend","flag","table","chart","cryptex","chart-stacked-bar","external","knockout-hammer","toolkit","formattedNumber"], function () { return Array.prototype.slice(arguments); });

define('scalejs.styles-less!app/app',[],function(){});
/* global require */
require([
    'scalejs!application/app/page/module',
    'scalejs!application/app/layout/module',
    'scalejs!application/app/header/module',
    'scalejs!application/app/jump/module',
    'scalejs!application/app/unsecured/module',
    'scalejs!application/app/guidelines/module',
    'scalejs!application/app/crisismgmt/module',
    'scalejs!application/app/maturity/module',
    'scalejs!application/app/uwf/module',
    'scalejs!application/app/nccf/module',
    'scalejs!application/app/counterparties/module',
    'scalejs.styles-less!app/app'
], function (
    app
) {
    

    app.run();
});

define("app/app", function(){});

/*jshint ignore:start*/
requirejs({
    baseUrl: 'src',
    scalejs: {
        extensions: [
            'scalejs.mvvm',
            'backend',
            'flag',
            'table',
            'chart',
            // 'deferredForeach',
            'cryptex',
            'chart-stacked-bar',
            'external',
            'knockout-hammer',
            'toolkit',
            'formattedNumber'
        ]
    },
    map: {
        '*': {
            sandbox: 'scalejs.sandbox',
            bindings: 'scalejs.mvvm.bindings',
            views: 'scalejs.mvvm.views',
            styles: 'scalejs.styles-less'
        }
    },
    paths: {
        almond: '../lib/almond/almond',
        backend: 'extensions/backend',
        requirejs: '../lib/requirejs/require',
        scalejs: '../lib/scalejs/dist/scalejs.min',
        'scalejs.mvvm': '../lib/scalejs.mvvm/dist/scalejs.mvvm.min',
        'scalejs.mvvm.views': '../lib/scalejs.mvvm/dist/scalejs.mvvm',
        'scalejs.mvvm.bindings': '../lib/scalejs.mvvm/dist/scalejs.mvvm',
        knockout: '../lib/knockout/dist/knockout',
        'knockout.mapping': '../lib/knockout.mapping/knockout.mapping',
        'scalejs.functional': '../lib/scalejs.functional/dist/scalejs.functional.min',
        text: '../lib/text/text',
        panorama: '../external/panorama.min',
        easing: '../external/easing.min',
        anim: '../external/anim.min',
        scroll: '../external/scroll.min',
        cryptex: 'extensions/cryptex',
        hammer: '../external/hammer.min',
        'knockout-hammer': '../external/knockout-hammer',
        flag: 'extensions/flag',
        listjs: '../external/list.min',
        'listjs.pagination': '../external/list.pagination.min',
        table: 'extensions/table/table',
        chart: 'extensions/chart/chart',
        // 'deferredForeach': 'extensions/deferredForeach/deferredForeach',
        'chart-stacked-bar': 'extensions/chart-stacked-bar',
        external: 'extensions/external',
        underscore: '../lib/underscore/underscore',
        'scalejs.styles-less': '../lib/scalejs.styles-less/scalejs.styles',
        'less-builder': '../lib/scalejs.styles-less/less-builder',
        normalize: '../lib/scalejs.styles-less/normalize',
        toolkit: 'extensions/toolkit',
        formattedNumber: 'extensions/formattedNumber',
        less: '../lib/less/dist/less-1.5.0',
        moment: '../lib/moment/moment',
        'Chart.StackedBar': '../lib/Chart.StackedBar.js/src/Chart.StackedBar',
        Chart: '../lib/Chart.js/Chart.min',
        clndr: '../lib/clndr/clndr.min',
        jquery: '../lib/jquery/dist/jquery'
    },
    packages: [

    ],
    shim: {
        clndr: {
            deps: [
                'jquery'
            ],
            exports: 'jquery'
        },
        'Chart.StackedBar': {
            deps: [
                'Chart'
            ],
            exports: 'Chart'
        },
        hammer: {
            exports: 'Hammer'
        },
        knockout: {
            exports: 'ko'
        },
        'knockout-hammer': {
            deps: [
                'knockout',
                'hammer'
            ]
        },
        'scalejs.mvvm': {
            deps: [
                'knockout.mapping',
                'scalejs.functional'
            ]
        }
    }
});
/*jshint ignore:end*/
;
define("../rjsconfig", function(){});


(function(c){var d=document,a='appendChild',i='styleSheet',s=d.createElement('style');s.type='text/css';d.getElementsByTagName('head')[0][a](s);s[i]?s[i].cssText=c:s[a](d.createTextNode(c));})
('.drill_loading {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill_loading > svg {\n  width: 70%;\n  height: 100px;\n  padding: 30px;\n  position: relative;\n  top: 50%;\n  left: 15%;\n  margin-top: -50px;\n  float: initial !important;\n}\n.drill_nodata {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  background: #090909;\n  z-index: 5;\n  opacity: 1;\n}\n.drill.hide {\n  opacity: 0;\n  visibility: hidden;\n}\n.drill > .listjs-title {\n  font-size: 16px;\n  height: 40px;\n  position: relative;\n}\n.drill > .listjs-header {\n  height: 56px;\n  position: relative;\n  width: 100%;\n  font-size: 16px;\n  background: #222222;\n}\n.drill > .listjs-header > ul {\n  width: 100%;\n  z-index: 5;\n}\n.drill > .listjs > .listjs-table {\n  width: 100%;\n  font-size: 16px;\n  height: calc(100% - 106px);\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination {\n  font-size: 17px;\n  display: block;\n  float: right;\n  width: auto;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > * {\n  padding: 4px;\n  margin: 3px;\n  display: inline-block;\n  width: 32px;\n  text-align: center;\n  background: #111111;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *:last-child {\n  margin-right: 0px;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *.active {\n  background-color: #222222;\n}\n.drill > .listjs > .listjs-table > ul {\n  width: 100%;\n  table-layout: fixed;\n}\n.drill > .listjs > .listjs-table > ul > li:nth-child(2n) {\n  background: #111111;\n}\n/* Smartphones (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 320px) and (max-device-width: 480px) {\n  .panorama > .panel {\n    padding-top: 0 !important;\n  }\n  .panorama > .panel#jump {\n    padding-top: 54px !important;\n  }\n  * {\n    max-width: 100vw;\n  }\n  #unsecured {\n    min-width: initial !important;\n  }\n  #unsecured .info {\n    padding: 6px 12px !important;\n  }\n  #unsecured .head span,\n  #unsecured .actual span,\n  #unsecured .limit span,\n  #unsecured .capacity span,\n  #unsecured .percent span {\n    display: none;\n  }\n}\n/* Smartphones (landscape) ----------- */\n@media only screen and (min-width: 321px) {\n  /* Styles */\n}\n/* Smartphones (portrait) ----------- */\n@media only screen and (max-width: 320px) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 3vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n  #unsecured .item {\n    width: 50% !important;\n  }\n}\n/* iPads (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) {\n  /* Styles */\n}\n/* iPads (landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: landscape) {\n  /* Styles */\n}\n/* iPads (portrait) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: portrait) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 4vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n}\n/* Desktops and laptops ----------- */\n@media only screen and (min-width: 1224px) {\n  /* Styles */\n}\n/* Large screens ----------- */\n@media only screen and (min-width: 1824px) {\n  /* Styles */\n}\n/* iPhone 4 ----------- */\n@media only screen and (-webkit-min-device-pixel-ratio: 1.5), only screen and (min-device-pixel-ratio: 1.5) {\n  /* Styles */\n}\n* {\n  box-sizing: border-box;\n  -ms-overflow-style: -ms-autohiding-scrollbar;\n}\nhtml,\nbody,\n.panorama > .panel {\n  margin: 0;\n  font-family: Lato, sans-serif;\n  font-weight: 300;\n  line-height: 1.5;\n  font-size: 16px !important;\n}\na {\n  text-decoration: none;\n  color: inherit;\n}\n/* hidden isn\'t normally important */\n*[hidden] {\n  display: none !important;\n}\n.hide {\n  opacity: 0 !important;\n  visibility: hidden !important;\n}\n.tab {\n  margin: 0 2px;\n  border-top-right-radius: 10px;\n  border-top-left-radius: 10px;\n  padding: 4px 12px;\n  background: #222222;\n  position: relative;\n  text-align: center;\n  font-size: 16px;\n  display: inline-table;\n}\n::-webkit-scrollbar {\n  height: 6px;\n  width: 6px;\n  background: #000;\n}\n::-webkit-scrollbar-thumb {\n  background: #222222;\n  -webkit-border-radius: 1ex;\n  -webkit-box-shadow: 0px 1px 2px rgba(0, 0, 0, 0.75);\n}\n::-webkit-scrollbar-corner {\n  background: #000;\n}\n/*\n@keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-moz-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-webkit-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n*\n{\n    animation: bugfix infinite 1s;\n    -mox-animation: bugfix infinite 1s;\n    -webkit-animation: bugfix infinite 1s;\n}\n*/\n.panorama > .panel {\n  width: 100vw;\n  max-width: 1024px;\n}\n.panorama > .panel > header.title {\n  font-size: 20px;\n  margin-bottom: 14px;\n  text-transform: uppercase;\n  height: 40px;\n  overflow: hidden;\n}\n.no_data {\n  position: absolute;\n  top: 0px;\n  bottom: 0px;\n  left: 0px;\n  right: 0px;\n  background: none repeat scroll 0% 0% rgba(0, 0, 0, 0.6);\n  text-align: center;\n}\n.no_data > .no_data_text {\n  font-size: 24px;\n  position: absolute;\n  width: 100%;\n  height: 50%;\n  top: 25%;\n}\n#crisismgmt {\n  -webkit-transform: translateX(0);\n}\n#crisismgmt > *:not(html) {\n  -webkit-transform: translateX(0);\n}\n#nccf {\n  -webkit-transform: translateX(0);\n}\n#counterparties {\n  -webkit-transform: translateX(0);\n}\n.tableloading,\n.BMOloading {\n  position: relative;\n  top: 50%;\n  left: 50%;\n  width: 67px;\n  height: 67px;\n  border-radius: 100%;\n  -webkit-animation: flip 0.75s infinite;\n  -webkit-animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  -moz-animation: flip 0.75s infinite;\n  moz-timing-function: cubic-bezier(0, 0, 1, 1);\n  animation: flip 0.75s infinite;\n  animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  background-size: 67px;\n  background-image: url(\'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEMAAABDCAYAAADHyrhzAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wIbEzYP1acWaQAACehJREFUeNrtnHtwFdUdxz9nd+87IclNCAIpYIGOCJSqWLSddqp92DodWjpD61RpVcZWRbHSTlXQSIkV1KJFBKuFYsWKUKV1RmsBsTgKBRVnVAoqKCAIiAkm4b7v3T3945yYEPK4d++9eai/mZ1kdu6+vvt7fs/vt0JKyWeiRDTUjOrJ65nAQGAYMBQIA2WAD4gDjcAx4ADwvv4/01M3Z/XA+SuBIcBw4AvASKAGqAbKAa/+XUYD0gwcBg4C7wB7gP16XwNg9ycwhH7QLwJnA5P038F5nPMgsE1v24E3gA/7spmY+s1fAHxDb2VFALsB2ARsBNYD7wKyL4FxGvAjvZ3VQyZuA1uBfwJrNSi9CkYY+DEwHThDa0dPSxp4CVgGPA5EesNnnAPMAi4EQr0YET3AV4Fx2jTvAV5zcyLD5Q1MB1YCU3sZiLZSBvwceETfV9HBKAUWavRH0TdlHPAgMAfwFwuMQcASYKYGpS9LOXALcBdQUWgwaoClwCU9kKgVSnzA1cAfdOJXEDAGAnfosCn6WblhAJcDv8tGm7sDIwjcDPw0vwAu1NbTx7bKDOA33Wm10U1a/QvtI9w/CCBjcUilc38oIZDJJDKZLAQoNwEXuQXjPK0V7oGQEhmJgm0jo7HcABECmUhALA7JJE4sBoaRDyAeYAHwpVzBqAJqs3U8nQHh1Ddgnjqc4K2z8V12CdhpSKW6fyDDUNpgWQRmXUfg+pmYJSU4DQ1g5JXkDgV+31lu1JkNXQl8LZ+rOsc+wqgeSHDuHLyTv4/TfBxicRKr1mCEK7rWCMeGSJTAjb8mOPu3SNvGCIeJ3jAH2diIKC8D23Ul/x3gMuC+kyrNGwaE2++boNUp7M5/C2QkgvB4CNbOxn/xRSAEwufDnDAeZ/t27H37EX5/51pxtB7f1CmE6moRfj/CNDEnjEM2NpPe/F+wPAivB9yxdAYwAtigyaNOwbC0eXzbLewylUIm0wSuvZLAzBkIT6vyGeVlGKePIb1xk3rDXm+7V2Pi1NdjTTyT0oULMIa0UiDCsrDOmIC9dy/OazsQfp/yIe6kShd0z3UFxpnAbJ3BubANB2JxfFMmE7qtFhE62TTNoUMwqipJr98AGRssq1UjmpowqqspufsOrIknMwGiJIQ15jQyr72Ovb8L7cqOgKoEtgBHOgNjFvA9t8mVjESwzp5I8K7bMQd3TmxZo0ciU2nSm55HeDzg8aiogyQ07xZ8P5zc6Vs3qqsxaoaS2bIVeezYydqVW8r+HrC5IzCGAzei+Mrco0c0ilFTQ+juBXgmjO+GOLAwx41FHjhI+pXtCCGQkSjBq3+J/5orET5f15TayM9DIEDmxc2QTLVqV+7MnEezZo3tQ+s3gdGugEgkEcEgwdqb8HzlnOy8WGVY/f7ss7A/OoL3wgsI/GpGh6bVkfgvnYb/0p8hpcwnsoxtm3e0aIYJXAd82Y2fkI5NYNZM/FdcnhuO4QqsMadhVA0ieO1VGKNG5vAOBNZZZ2Dv3oOz5x0wXeUfAeCQdqSO1cZExrhyQ/EE5qkj8E272B3Vdu4krHMnufOC5WV4fzKV1HPPIxzHTXQRwEQUc3/AaEOIjHJjItJxIOBHSqdXylLh9SDch1iAz+ntY58xOhcSpDV8aJ+RsSGT6RUwSCbJc6VgIDAerVcGapWrf0r+5X1I51dhA0WkDinWvTqHDhO9eS6pJ9a6ymbji5YQX3y/qmCLBCdwOjDY0slHVTGuIhsbic29jcSyFSSGDqE0VIr3u1lm+lKSvO8BYnPrwOeHdJrArJnFAqQGGGRoNmtAwU9vZ4jfu5TEo3/HqKyCpmZitfOwd76Z1eGpp54hvniJSrkzaRKLl5Ja+2SxwCgHKgwdawu79iElyb+tJr7kTwiPCcEAorwce+cuYrV1yPqGrnF88y1i8+YjmyPg9yNKS3GO1hOrm096y7ZigBEEQi0OtKDLgukXXiR2+50QjSEGDFAFnJSI8gpS6zYQW/jHTqOP09RI9OZ52G/vhoD/4zJdVJST+d8u4nXzsffuLzQYBmAaBbeO3XvUw+zdj6isPJFzEKryTCx/iMQjq05WqHSaxJ33kNnwLCIYaI0UUoJpIsJhUus3Er/rHuTx463hvYCIZFCLt/nYBcLvRx6PEK9bQGbrS4hTBrWSuIbRunm94EjiCxaS3rL1RD+xZi3J5Q8jPV7w+k48DhDBACJcQWLFwySW/VUd5PMWAhAbSFuobplIPv5BeDzIpibiCxeRWPkXRKACmppUdtoRGyDBfmsn0ZnXU/Ln+zHHjSWz8T/EZs8h88FBjAGVyI+OdXCsVOV+Ikb01lqMkcMxQiWqLskv6YsAEQuItpSwriK0EOCxSD/1L1L/eBJj2AiELwSO7DqNt8PI998nvnARnm+dR+qxx5HJOMbI0RiYXeq/qKpCNteTXPYQnvPPA8vMp3JF038Nlv7nQ5fWoSn9JGL4MEoW3w2WB5mN3gqByNjIRBwcB/81VyECAcWhdsdtCoGwHbBtMnv35gsEwD7gSItmHMzHTHAk1jmTMAef0uPZuHzm3woMKd2m5jbwOnDI0O93d95+2bbpFXHy9p7NwKvA8ZbQ+iaq7zKvRKtXJP/rHgF2tS3hd2rt+DTKuy2K0ALGB6jeyk9b73QGtVxwtC0YAM9ShEbTPi6HNRi0B+OFFtv5FMkrwI6OwGgEnibXxnUpEaaBKBvQK08jSktwueYV089b37Kj/erLGmCa5gSzE4+FjEZJr9uAqAz3rNcRkNn+qq6Bcq45twPrTjhdBx3Cc4B5ZNv8JiUIA2EZSEOA07NgCNvRNVBOkgBuAO5tu7OjdbmVwA9QkwBZpdVIBxlJKN6iJ1vgJEjLVJVwbrINeLT9zo7AeA/V7/kgahYkO0ACvv4SmJtQTb31HfEZHcljwKqci7b+ISu14yRbMJLAfO1kPkmyGZjbWcTsykm+hWo5PvoJAeIAqv+kUza6u4ixDtX+mOjnQDQC16PmUnALhgOsAOr6MSARVBNOt0t62eQSGVTv+HwUEdTfNGI28EA2Lj7btM3W2nFLVzbXx+QQql98cbYH5JLDSh2fZwBv93EgXkf1vS/P5SA3i0irUXMnT/dRIFYDF7u5P7crai8DV6A69Y/0ERD2AdeiBm52uCp18hzlNFHdctcAUyjOUG82TnIValJqRz4nKtSQbylqzHs6cD5q/LvYchjFzi3XJE3eka7QX0kIoYZ9JwNfR/VZhihMLStRtP4bOq1+QmtCvGCMQJE+GWGgph3P1VTAeFRrZTWqK9fUvxHtgJJ6s3XCl9YhcpcG4WUUZ3mMIjAnxf5+RkvvRw2qiW4YaryhGtU6VYqaMhQahIR++/Uoxn4f6nMR72hHnSlmfSw++7JKq/wfrr01wWGPYrwAAAAASUVORK5CYII=\');\n}\n@-webkit-keyframes flip {\n  0% {\n    -webkit-transform: rotateX(0deg);\n  }\n  25% {\n    -webkit-transform: rotateX(90deg);\n  }\n  50% {\n    -webkit-transform: rotateX(180deg);\n  }\n  100% {\n    -webkit-transform: rotateX(360deg);\n  }\n}\n@-moz-keyframes flip {\n  0% {\n    -moz-transform: rotateX(0deg);\n  }\n  25% {\n    -moz-transform: rotateX(90deg);\n  }\n  50% {\n    -moz-transform: rotateX(180deg);\n  }\n  100% {\n    -moz-transform: rotateX(360deg);\n  }\n}\n@keyframes flip {\n  0% {\n    transform: rotateX(0deg);\n  }\n  25% {\n    transform: rotateX(90deg);\n  }\n  50% {\n    transform: rotateX(180deg);\n  }\n  100% {\n    transform: rotateX(360deg);\n  }\n}\n.listjs-header > ul {\n  display: table;\n  margin: 0;\n  padding: 0;\n  table-layout: fixed;\n  width: 100%;\n  background-color: #222222;\n}\n.listjs-header > ul > li {\n  display: table-row;\n}\n.listjs-header > ul > li > div {\n  white-space: normal !important;\n  overflow: visible;\n  display: table-cell;\n}\n.listjs-header > ul > li > div.filtered {\n  outline: 2px solid yellow;\n}\n.listjs-footer > ul {\n  display: table;\n  margin: 0;\n  padding: 0;\n  table-layout: fixed;\n  width: 100%;\n  background-color: #222222;\n}\n.listjs-footer > ul > li {\n  display: table-row;\n}\n.listjs-footer > ul > li > div {\n  display: table-cell;\n}\n.listjs {\n  width: 100%;\n  height: 100%;\n}\n.listjs:not(.modal) > .listjs-modal-underlay,\n.listjs:not(.modal) > .listjs-modal {\n  display: none;\n}\n.listjs > .listjs-modal-underlay {\n  position: absolute;\n  display: block;\n  z-index: 3;\n  width: 100%;\n  height: 100%;\n  left: 0;\n  top: 0;\n  background: rgba(0, 0, 0, 0.4);\n}\n.listjs > .listjs-modal {\n  position: absolute;\n  display: block;\n  z-index: 5;\n  width: 80%;\n  height: 80%;\n  left: 10%;\n  top: 5%;\n  background: rgba(0, 0, 0, 0.7);\n  border: 1px solid rgba(200, 200, 200, 0.6);\n  -webkit-transform: translateX(0);\n}\n.listjs > .listjs-modal > header {\n  font-size: 14px;\n  padding: 10px;\n  height: 40px;\n}\n.listjs > .listjs-modal > header > h4 {\n  margin: 0px;\n}\n.listjs > .listjs-modal > header > .clear_filter {\n  position: absolute;\n  top: 10px;\n  right: 100px;\n  padding: 6px 14px;\n  background: #555;\n}\n.listjs > .listjs-modal > header > i {\n  float: right;\n  position: absolute;\n  top: 13px;\n  right: 10px;\n}\n.listjs > .listjs-modal > nav.tabs > * {\n  display: inline-block;\n  margin: 0 2px;\n  border-top-right-radius: 10px;\n  border-top-left-radius: 10px;\n  padding: 4px 12px;\n  background: #222222;\n  position: relative;\n  text-align: center;\n  font-size: 16px;\n  display: inline-table;\n}\n.listjs > .listjs-modal > .hidden {\n  display: none;\n}\n.listjs > .listjs-modal > section {\n  height: calc(100% - 152px);\n}\n.listjs > .listjs-modal > section.relational {\n  height: calc(100% - 72px);\n  padding: 10px;\n}\n.listjs > .listjs-modal > section > .tabs {\n  width: 40%;\n  height: 100%;\n  float: left;\n  overflow: auto;\n  list-style: none;\n  padding: 10px;\n}\n.listjs > .listjs-modal > section > .tabs > div {\n  position: relative;\n  margin: 4px;\n  padding: 10px;\n  display: block;\n}\n.listjs > .listjs-modal > section > .tabs > div:not(.selected) {\n  outline: 2px solid gray;\n}\n.listjs > .listjs-modal > section > .tabs > div.selected {\n  outline: 2px solid yellow;\n}\n.listjs > .listjs-modal > section > .tabs > div > * {\n  display: inline-block;\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  max-width: 100%;\n}\n.listjs > .listjs-modal > section > .values {\n  width: 60%;\n  height: 100%;\n  float: left;\n  overflow: auto;\n}\n.listjs > .listjs-modal > section > .values > ul {\n  list-style: none;\n  margin: 0;\n  padding: 10px;\n}\n.listjs > .listjs-modal > section > .values > ul > li {\n  position: relative;\n  display: block;\n  padding: 6px 14px;\n  margin: 4px;\n  background: #555;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.listjs > .listjs-modal > section > .values > ul > li.disabled {\n  color: #666666;\n}\n.listjs > .listjs-modal > section > .values > ul > li.selected {\n  outline: 2px solid yellow;\n}\n.listjs > .listjs-modal > section.relational > div > div > * {\n  display: inline-block;\n  margin: 4px;\n}\n.listjs > .listjs-modal > section.relational > div > div > *:first-child {\n  width: 30%;\n}\n.listjs > .listjs-modal > .listjs-modal-buttons {\n  height: 80px;\n}\n.listjs > .listjs-modal > .listjs-modal-buttons > * {\n  padding: 10px;\n  background: #444;\n  outline: 1px solid #AAA;\n  width: 50%;\n  height: 40px;\n  box-sizing: border-box;\n  float: left;\n  text-align: center;\n  display: inline-block;\n}\n.listjs-loading {\n  position: absolute;\n  display: block;\n  z-index: 3;\n  width: 100%;\n  height: 100%;\n  left: 0;\n  top: 0;\n}\n.listjs-table {\n  height: 100%;\n  position: relative;\n  overflow: hidden !important;\n}\n.listjs-table > .listjs-list {\n  overflow: auto !important;\n  overflow: overlay !important;\n  height: 100%;\n}\n.listjs-table > .listjs-list > ul {\n  display: table;\n  table-layout: fixed;\n  width: 100%;\n  margin: 0;\n  padding: 0;\n}\n.listjs-table > .listjs-list > ul.pagination:before {\n  content: \"Pages: \";\n}\n.listjs-table > .listjs-list > ul > li {\n  display: table-row;\n}\n.listjs-table > .listjs-list > ul > li > div {\n  display: table-cell;\n}\n.chart {\n  display: block;\n  width: 100%;\n  height: 100%;\n}\n.chart ul {\n  margin: 0;\n  padding: 0;\n  width: 100%;\n  height: 100%;\n  list-style: none;\n}\n.chart > ul.data {\n  -webkit-transform: rotateZ(180deg);\n  -moz-transform: rotateZ(180deg);\n  transform: rotateZ(180deg);\n  height: calc(100% - 26px);\n}\n.chart > ul.data > .col {\n  display: block;\n  float: left;\n  height: 100%;\n  box-sizing: border-box;\n  padding: 0 10px;\n  position: relative;\n}\n.chart > ul.data > .col.show-legend .legend {\n  display: block;\n}\n.chart > ul.data > .col > ul.bars {\n  width: 100%;\n}\n.chart > ul.data > .col > ul.bars > .bar {\n  display: block;\n  width: 100%;\n}\n.chart > ul.data > .col > ul.legend {\n  display: none;\n  position: absolute;\n  top: 12px;\n  background: #222;\n  border: 1px solid #444;\n  width: auto;\n  height: auto;\n  -webkit-transform: rotateZ(180deg);\n  -moz-transform: rotateZ(180deg);\n  transform: rotateZ(180deg);\n  border-radius: 2px;\n  font-size: 12px;\n  box-sizing: border-box;\n  padding: 6px 5px;\n  text-align: right;\n  white-space: nowrap;\n  z-index: 5;\n}\n.chart > ul.data > .col > ul.legend > li {\n  clear: both;\n}\n.chart > ul.data > .col > ul.legend > li > div:first-child {\n  float: right;\n}\n.chart > ul.data > .col > ul.legend > li > div:last-child {\n  float: left;\n  padding-right: 10px;\n}\n.chart > ul.legend {\n  list-style: none;\n  height: 26px;\n}\n.chart > ul.legend > li {\n  display: inline-block;\n  float: left;\n  box-sizing: border-box;\n  text-align: center;\n}\n.cryptex {\n  position: relative;\n  width: 100%;\n  height: 100%;\n  box-sizing: border-box;\n  display: block;\n}\n.cryptex .inner {\n  height: 100%;\n  position: relative;\n  overflow: auto;\n  -webkit-overflow-scrolling: touch;\n  -ms-overflow-style: -ms-autohiding-scrollbar;\n}\n.cryptex .inner .top,\n.cryptex .inner .bot {\n  display: block;\n}\n.cryptex .inner ul {\n  box-sizing: border-box;\n  display: block;\n  margin: 0;\n  list-style: none;\n  padding: 0;\n}\n.cryptex .inner ul > li {\n  display: block;\n  box-sizing: border-box;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.cryptex .bar {\n  pointer-events: none;\n  content: \'\';\n  display: block;\n  width: 100%;\n  position: absolute;\n  z-index: 100;\n}\nhtml,\nbody {\n  width: 100%;\n  height: 100%;\n  background: #000000;\n  margin: 0;\n}\nbody > .page {\n  background: #000000;\n  color: #ffffff;\n  width: 100%;\n}\nbody > .page.panorama {\n  height: 100%;\n  padding-top: 70px;\n  padding-bottom: 20px;\n  transition: 400ms;\n  box-sizing: border-box;\n}\nbody > .page.panorama.show {\n  padding-top: 110px;\n}\nbody > .page.panorama > .panel {\n  padding: 20px;\n  height: 100%;\n  padding: 15px;\n  background: #090909;\n  margin: 5px;\n  margin-bottom: 0;\n}\nbody > .page.header {\n  height: 70px;\n}\n.page.header {\n  position: absolute;\n  z-index: 100;\n}\n.page.header > a {\n  padding: 20px;\n  height: 70px;\n  position: absolute;\n}\n.page.header > a.logo {\n  padding: 5px;\n}\n.page.header > a.logo > img {\n  height: 100%;\n}\n.page.header > a.logo > i {\n  padding: 10px;\n  line-height: 1;\n  position: relative;\n  top: -20px;\n}\n.page.header > a.date {\n  left: auto;\n  right: 0;\n  text-align: right;\n  color: white;\n  text-decoration: none;\n}\n.page.header > .datepicker_wrapper {\n  position: fixed;\n  z-index: 1000000;\n  background: black;\n  top: 0;\n  left: 0;\n  bottom: 0;\n  right: 0;\n}\n.page.header > .datepicker_wrapper.hide {\n  visibility: hidden;\n  opacity: 0;\n  pointer-events: none;\n  top: 100vh;\n}\n.page.header > .datepicker_wrapper > #datepicker {\n  position: absolute;\n  width: 60%;\n  left: 20%;\n  height: 80%;\n  top: 10%;\n  -webkit-touch-callout: none;\n  -webkit-user-select: none;\n  -khtml-user-select: none;\n  -moz-user-select: none;\n  -ms-user-select: none;\n  user-select: none;\n}\n.page.header > .datepicker_wrapper > #datepicker > .close,\n.page.header > .datepicker_wrapper > #datepicker > .go {\n  position: absolute;\n  border-radius: 100%;\n  padding: 7px;\n  box-sizing: border-box;\n  width: 32px;\n  height: 32px;\n  font-size: 12px;\n  text-align: center;\n  cursor: pointer;\n  top: calc(25% - 13px);\n}\n.page.header > .datepicker_wrapper > #datepicker > .close {\n  background: #d71a01;\n  right: 25px;\n}\n.page.header > .datepicker_wrapper > #datepicker > .go {\n  background: #38fd2f;\n  color: black;\n  right: 65px;\n}\n.page.header > .datepicker_wrapper > #datepicker .bar {\n  border: 1px solid white;\n}\n.page.header > .datepicker_wrapper > #datepicker li {\n  padding: 10px 40px;\n}\n.drill_loading {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill_loading > svg {\n  width: 70%;\n  height: 100px;\n  padding: 30px;\n  position: relative;\n  top: 50%;\n  left: 15%;\n  margin-top: -50px;\n  float: initial !important;\n}\n.drill_nodata {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  background: #090909;\n  z-index: 5;\n  opacity: 1;\n}\n.drill.hide {\n  opacity: 0;\n  visibility: hidden;\n}\n.drill > .listjs-title {\n  font-size: 16px;\n  height: 40px;\n  position: relative;\n}\n.drill > .listjs-header {\n  height: 56px;\n  position: relative;\n  width: 100%;\n  font-size: 16px;\n  background: #222222;\n}\n.drill > .listjs-header > ul {\n  width: 100%;\n  z-index: 5;\n}\n.drill > .listjs > .listjs-table {\n  width: 100%;\n  font-size: 16px;\n  height: calc(100% - 106px);\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination {\n  font-size: 17px;\n  display: block;\n  float: right;\n  width: auto;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > * {\n  padding: 4px;\n  margin: 3px;\n  display: inline-block;\n  width: 32px;\n  text-align: center;\n  background: #111111;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *:last-child {\n  margin-right: 0px;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *.active {\n  background-color: #222222;\n}\n.drill > .listjs > .listjs-table > ul {\n  width: 100%;\n  table-layout: fixed;\n}\n.drill > .listjs > .listjs-table > ul > li:nth-child(2n) {\n  background: #111111;\n}\n/* Smartphones (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 320px) and (max-device-width: 480px) {\n  .panorama > .panel {\n    padding-top: 0 !important;\n  }\n  .panorama > .panel#jump {\n    padding-top: 54px !important;\n  }\n  * {\n    max-width: 100vw;\n  }\n  #unsecured {\n    min-width: initial !important;\n  }\n  #unsecured .info {\n    padding: 6px 12px !important;\n  }\n  #unsecured .head span,\n  #unsecured .actual span,\n  #unsecured .limit span,\n  #unsecured .capacity span,\n  #unsecured .percent span {\n    display: none;\n  }\n}\n/* Smartphones (landscape) ----------- */\n@media only screen and (min-width: 321px) {\n  /* Styles */\n}\n/* Smartphones (portrait) ----------- */\n@media only screen and (max-width: 320px) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 3vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n  #unsecured .item {\n    width: 50% !important;\n  }\n}\n/* iPads (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) {\n  /* Styles */\n}\n/* iPads (landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: landscape) {\n  /* Styles */\n}\n/* iPads (portrait) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: portrait) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 4vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n}\n/* Desktops and laptops ----------- */\n@media only screen and (min-width: 1224px) {\n  /* Styles */\n}\n/* Large screens ----------- */\n@media only screen and (min-width: 1824px) {\n  /* Styles */\n}\n/* iPhone 4 ----------- */\n@media only screen and (-webkit-min-device-pixel-ratio: 1.5), only screen and (min-device-pixel-ratio: 1.5) {\n  /* Styles */\n}\n* {\n  box-sizing: border-box;\n  -ms-overflow-style: -ms-autohiding-scrollbar;\n}\nhtml,\nbody,\n.panorama > .panel {\n  margin: 0;\n  font-family: Lato, sans-serif;\n  font-weight: 300;\n  line-height: 1.5;\n  font-size: 16px !important;\n}\na {\n  text-decoration: none;\n  color: inherit;\n}\n/* hidden isn\'t normally important */\n*[hidden] {\n  display: none !important;\n}\n.hide {\n  opacity: 0 !important;\n  visibility: hidden !important;\n}\n.tab {\n  margin: 0 2px;\n  border-top-right-radius: 10px;\n  border-top-left-radius: 10px;\n  padding: 4px 12px;\n  background: #222222;\n  position: relative;\n  text-align: center;\n  font-size: 16px;\n  display: inline-table;\n}\n::-webkit-scrollbar {\n  height: 6px;\n  width: 6px;\n  background: #000;\n}\n::-webkit-scrollbar-thumb {\n  background: #222222;\n  -webkit-border-radius: 1ex;\n  -webkit-box-shadow: 0px 1px 2px rgba(0, 0, 0, 0.75);\n}\n::-webkit-scrollbar-corner {\n  background: #000;\n}\n/*\n@keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-moz-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-webkit-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n*\n{\n    animation: bugfix infinite 1s;\n    -mox-animation: bugfix infinite 1s;\n    -webkit-animation: bugfix infinite 1s;\n}\n*/\n.panorama > .panel {\n  width: 100vw;\n  max-width: 1024px;\n}\n.panorama > .panel > header.title {\n  font-size: 20px;\n  margin-bottom: 14px;\n  text-transform: uppercase;\n  height: 40px;\n  overflow: hidden;\n}\n.no_data {\n  position: absolute;\n  top: 0px;\n  bottom: 0px;\n  left: 0px;\n  right: 0px;\n  background: none repeat scroll 0% 0% rgba(0, 0, 0, 0.6);\n  text-align: center;\n}\n.no_data > .no_data_text {\n  font-size: 24px;\n  position: absolute;\n  width: 100%;\n  height: 50%;\n  top: 25%;\n}\n#crisismgmt {\n  -webkit-transform: translateX(0);\n}\n#crisismgmt > *:not(html) {\n  -webkit-transform: translateX(0);\n}\n#nccf {\n  -webkit-transform: translateX(0);\n}\n#counterparties {\n  -webkit-transform: translateX(0);\n}\n.tableloading,\n.BMOloading {\n  position: relative;\n  top: 50%;\n  left: 50%;\n  width: 67px;\n  height: 67px;\n  border-radius: 100%;\n  -webkit-animation: flip 0.75s infinite;\n  -webkit-animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  -moz-animation: flip 0.75s infinite;\n  moz-timing-function: cubic-bezier(0, 0, 1, 1);\n  animation: flip 0.75s infinite;\n  animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  background-size: 67px;\n  background-image: url(\'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEMAAABDCAYAAADHyrhzAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wIbEzYP1acWaQAACehJREFUeNrtnHtwFdUdxz9nd+87IclNCAIpYIGOCJSqWLSddqp92DodWjpD61RpVcZWRbHSTlXQSIkV1KJFBKuFYsWKUKV1RmsBsTgKBRVnVAoqKCAIiAkm4b7v3T3945yYEPK4d++9eai/mZ1kdu6+vvt7fs/vt0JKyWeiRDTUjOrJ65nAQGAYMBQIA2WAD4gDjcAx4ADwvv4/01M3Z/XA+SuBIcBw4AvASKAGqAbKAa/+XUYD0gwcBg4C7wB7gP16XwNg9ycwhH7QLwJnA5P038F5nPMgsE1v24E3gA/7spmY+s1fAHxDb2VFALsB2ARsBNYD7wKyL4FxGvAjvZ3VQyZuA1uBfwJrNSi9CkYY+DEwHThDa0dPSxp4CVgGPA5EesNnnAPMAi4EQr0YET3AV4Fx2jTvAV5zcyLD5Q1MB1YCU3sZiLZSBvwceETfV9HBKAUWavRH0TdlHPAgMAfwFwuMQcASYKYGpS9LOXALcBdQUWgwaoClwCU9kKgVSnzA1cAfdOJXEDAGAnfosCn6WblhAJcDv8tGm7sDIwjcDPw0vwAu1NbTx7bKDOA33Wm10U1a/QvtI9w/CCBjcUilc38oIZDJJDKZLAQoNwEXuQXjPK0V7oGQEhmJgm0jo7HcABECmUhALA7JJE4sBoaRDyAeYAHwpVzBqAJqs3U8nQHh1Ddgnjqc4K2z8V12CdhpSKW6fyDDUNpgWQRmXUfg+pmYJSU4DQ1g5JXkDgV+31lu1JkNXQl8LZ+rOsc+wqgeSHDuHLyTv4/TfBxicRKr1mCEK7rWCMeGSJTAjb8mOPu3SNvGCIeJ3jAH2diIKC8D23Ul/x3gMuC+kyrNGwaE2++boNUp7M5/C2QkgvB4CNbOxn/xRSAEwufDnDAeZ/t27H37EX5/51pxtB7f1CmE6moRfj/CNDEnjEM2NpPe/F+wPAivB9yxdAYwAtigyaNOwbC0eXzbLewylUIm0wSuvZLAzBkIT6vyGeVlGKePIb1xk3rDXm+7V2Pi1NdjTTyT0oULMIa0UiDCsrDOmIC9dy/OazsQfp/yIe6kShd0z3UFxpnAbJ3BubANB2JxfFMmE7qtFhE62TTNoUMwqipJr98AGRssq1UjmpowqqspufsOrIknMwGiJIQ15jQyr72Ovb8L7cqOgKoEtgBHOgNjFvA9t8mVjESwzp5I8K7bMQd3TmxZo0ciU2nSm55HeDzg8aiogyQ07xZ8P5zc6Vs3qqsxaoaS2bIVeezYydqVW8r+HrC5IzCGAzei+Mrco0c0ilFTQ+juBXgmjO+GOLAwx41FHjhI+pXtCCGQkSjBq3+J/5orET5f15TayM9DIEDmxc2QTLVqV+7MnEezZo3tQ+s3gdGugEgkEcEgwdqb8HzlnOy8WGVY/f7ss7A/OoL3wgsI/GpGh6bVkfgvnYb/0p8hpcwnsoxtm3e0aIYJXAd82Y2fkI5NYNZM/FdcnhuO4QqsMadhVA0ieO1VGKNG5vAOBNZZZ2Dv3oOz5x0wXeUfAeCQdqSO1cZExrhyQ/EE5qkj8E272B3Vdu4krHMnufOC5WV4fzKV1HPPIxzHTXQRwEQUc3/AaEOIjHJjItJxIOBHSqdXylLh9SDch1iAz+ntY58xOhcSpDV8aJ+RsSGT6RUwSCbJc6VgIDAerVcGapWrf0r+5X1I51dhA0WkDinWvTqHDhO9eS6pJ9a6ymbji5YQX3y/qmCLBCdwOjDY0slHVTGuIhsbic29jcSyFSSGDqE0VIr3u1lm+lKSvO8BYnPrwOeHdJrArJnFAqQGGGRoNmtAwU9vZ4jfu5TEo3/HqKyCpmZitfOwd76Z1eGpp54hvniJSrkzaRKLl5Ja+2SxwCgHKgwdawu79iElyb+tJr7kTwiPCcEAorwce+cuYrV1yPqGrnF88y1i8+YjmyPg9yNKS3GO1hOrm096y7ZigBEEQi0OtKDLgukXXiR2+50QjSEGDFAFnJSI8gpS6zYQW/jHTqOP09RI9OZ52G/vhoD/4zJdVJST+d8u4nXzsffuLzQYBmAaBbeO3XvUw+zdj6isPJFzEKryTCx/iMQjq05WqHSaxJ33kNnwLCIYaI0UUoJpIsJhUus3Er/rHuTx463hvYCIZFCLt/nYBcLvRx6PEK9bQGbrS4hTBrWSuIbRunm94EjiCxaS3rL1RD+xZi3J5Q8jPV7w+k48DhDBACJcQWLFwySW/VUd5PMWAhAbSFuobplIPv5BeDzIpibiCxeRWPkXRKACmppUdtoRGyDBfmsn0ZnXU/Ln+zHHjSWz8T/EZs8h88FBjAGVyI+OdXCsVOV+Ikb01lqMkcMxQiWqLskv6YsAEQuItpSwriK0EOCxSD/1L1L/eBJj2AiELwSO7DqNt8PI998nvnARnm+dR+qxx5HJOMbI0RiYXeq/qKpCNteTXPYQnvPPA8vMp3JF038Nlv7nQ5fWoSn9JGL4MEoW3w2WB5mN3gqByNjIRBwcB/81VyECAcWhdsdtCoGwHbBtMnv35gsEwD7gSItmHMzHTHAk1jmTMAef0uPZuHzm3woMKd2m5jbwOnDI0O93d95+2bbpFXHy9p7NwKvA8ZbQ+iaq7zKvRKtXJP/rHgF2tS3hd2rt+DTKuy2K0ALGB6jeyk9b73QGtVxwtC0YAM9ShEbTPi6HNRi0B+OFFtv5FMkrwI6OwGgEnibXxnUpEaaBKBvQK08jSktwueYV089b37Kj/erLGmCa5gSzE4+FjEZJr9uAqAz3rNcRkNn+qq6Bcq45twPrTjhdBx3Cc4B5ZNv8JiUIA2EZSEOA07NgCNvRNVBOkgBuAO5tu7OjdbmVwA9QkwBZpdVIBxlJKN6iJ1vgJEjLVJVwbrINeLT9zo7AeA/V7/kgahYkO0ACvv4SmJtQTb31HfEZHcljwKqci7b+ISu14yRbMJLAfO1kPkmyGZjbWcTsykm+hWo5PvoJAeIAqv+kUza6u4ixDtX+mOjnQDQC16PmUnALhgOsAOr6MSARVBNOt0t62eQSGVTv+HwUEdTfNGI28EA2Lj7btM3W2nFLVzbXx+QQql98cbYH5JLDSh2fZwBv93EgXkf1vS/P5SA3i0irUXMnT/dRIFYDF7u5P7crai8DV6A69Y/0ERD2AdeiBm52uCp18hzlNFHdctcAUyjOUG82TnIValJqRz4nKtSQbylqzHs6cD5q/LvYchjFzi3XJE3eka7QX0kIoYZ9JwNfR/VZhihMLStRtP4bOq1+QmtCvGCMQJE+GWGgph3P1VTAeFRrZTWqK9fUvxHtgJJ6s3XCl9YhcpcG4WUUZ3mMIjAnxf5+RkvvRw2qiW4YaryhGtU6VYqaMhQahIR++/Uoxn4f6nMR72hHnSlmfSw++7JKq/wfrr01wWGPYrwAAAAASUVORK5CYII=\');\n}\n@-webkit-keyframes flip {\n  0% {\n    -webkit-transform: rotateX(0deg);\n  }\n  25% {\n    -webkit-transform: rotateX(90deg);\n  }\n  50% {\n    -webkit-transform: rotateX(180deg);\n  }\n  100% {\n    -webkit-transform: rotateX(360deg);\n  }\n}\n@-moz-keyframes flip {\n  0% {\n    -moz-transform: rotateX(0deg);\n  }\n  25% {\n    -moz-transform: rotateX(90deg);\n  }\n  50% {\n    -moz-transform: rotateX(180deg);\n  }\n  100% {\n    -moz-transform: rotateX(360deg);\n  }\n}\n@keyframes flip {\n  0% {\n    transform: rotateX(0deg);\n  }\n  25% {\n    transform: rotateX(90deg);\n  }\n  50% {\n    transform: rotateX(180deg);\n  }\n  100% {\n    transform: rotateX(360deg);\n  }\n}\n.panel#jump {\n  position: absolute;\n  overflow: auto;\n  z-index: 90;\n  background: #090909;\n  color: white;\n  transition: 400ms;\n  box-shadow: 0 0 10px black;\n  width: 100%;\n  overflow-y: hidden;\n  top: 30px;\n}\n.panel#jump.show {\n  top: 70px;\n}\n.panel#jump > .grid {\n  overflow-y: hidden;\n  overflow-x: hidden;\n  white-space: nowrap;\n}\n.panel#jump > .grid > .scroll {\n  overflow-y: hidden;\n  white-space: nowrap;\n  padding: 0 14px;\n  border-bottom: 4px solid #222222;\n  -webkit-overflow-scrolling: touch;\n}\n.panel#jump > .grid > .scroll > .tile {\n  margin: 0 2px;\n  border-top-right-radius: 10px;\n  border-top-left-radius: 10px;\n  padding: 4px 12px;\n  background: #222222;\n  position: relative;\n  text-align: center;\n  font-size: 16px;\n  display: inline-table;\n}\n.panel#jump > .grid > .scroll > .tile > div {\n  width: 175px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.panel#jump > .grid > .scroll > .tile > i {\n  text-align: center;\n  width: 100%;\n  font-size: 42px;\n}\n.panel#jump > .grid > .scroll > .tile > i.fa-check {\n  color: #38fd2f;\n  display: none;\n}\n.panel#jump > .grid > .scroll > .tile > i.NearLimit {\n  color: #f7ab29;\n}\n.panel#jump > .grid > .scroll > .tile > i.OverLimit {\n  color: #d71a01;\n}\n.panel#jump > .grid > .left,\n.panel#jump > .grid > .right {\n  position: absolute;\n  top: 0;\n  padding: 5px;\n  opacity: 0.8;\n  font-size: 18px;\n  z-index: 1;\n  background: #222222;\n}\n.panel#jump > .grid > .left {\n  left: 0;\n}\n.panel#jump > .grid > .right {\n  right: 0;\n}\n#unsecured {\n  overflow: hidden;\n}\n#unsecured > .data_wrapper {\n  height: calc(100% - 60px);\n  position: relative;\n}\n#unsecured > .data_wrapper > .grid {\n  height: 100%;\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-title {\n  position: relative;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header {\n  position: absolute;\n  top: 40px;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table {\n  position: absolute;\n  top: 96px;\n  bottom: 32px;\n  height: auto !important;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer {\n  position: absolute;\n  bottom: 0;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div,\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div,\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div {\n  padding: 4px 10px;\n  width: 12.5%;\n  outline: 1px solid #222222;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div.filtered,\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div.filtered,\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div.filtered {\n  outline: 2px solid yellow;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(4),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(4),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(4),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(6),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(6),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(6),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(7),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(7),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(7) {\n  text-align: right;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(4),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(4),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(4) {\n  width: 7%;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(5),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(6),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(6),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(6) {\n  width: 10%;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(7),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(7),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(7) {\n  width: 12%;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(2),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(2),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(2),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div:nth-child(3),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div:nth-child(3),\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(3) {\n  width: 15%;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div {\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  outline: 1px solid #222222;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li.expand > div {\n  white-space: normal;\n}\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-header > ul > li > div,\n#unsecured > .data_wrapper #unsecured_drill_01 > .listjs > .listjs-footer > ul > li > div {\n  white-space: normal;\n}\n#unsecured > .data_wrapper > .grid > .tile {\n  position: relative;\n}\n#unsecured > .data_wrapper > .grid > .tile.error {\n  padding: 14px 24px;\n  background: #d71a01;\n  margin-bottom: 10px;\n}\n#unsecured > .data_wrapper > .grid > .tile * {\n  font-size: 16px;\n}\n#unsecured > .data_wrapper > .grid > .tile > .progress {\n  margin-bottom: 6px;\n  display: block;\n  height: 10px;\n  background: #111111;\n}\n#unsecured > .data_wrapper > .grid > .tile > .progress > .bar {\n  height: 100%;\n  display: block;\n  background: #38fd2f;\n}\n#unsecured > .data_wrapper > .grid > .tile > .progress > .bar.NearLimit {\n  background: #f7ab29;\n}\n#unsecured > .data_wrapper > .grid > .tile > .progress > .bar.OverLimit {\n  background: #d71a01;\n}\n#unsecured > .data_wrapper > .grid > .tile > .info {\n  background: #222222;\n  overflow: hidden;\n  padding: 6px 24px;\n}\n#unsecured > .data_wrapper > .grid > .tile > .info > header {\n  width: 100%;\n  font-size: 18px;\n}\n#unsecured > .data_wrapper > .grid > .tile > .info > header > i {\n  float: left;\n  line-height: 1.5;\n  padding-right: 10px;\n}\n#unsecured > .data_wrapper > .grid > .tile > .info > .item {\n  width: 25%;\n  float: left;\n  text-align: right;\n}\n#unsecured > .data_wrapper > .grid > .tile > .info > .item > div {\n  width: 100%;\n}\n#guidelines {\n  overflow: hidden;\n}\n#guidelines .pagination {\n  display: none;\n}\n#guidelines .selector {\n  float: right;\n  margin-top: 14px;\n}\n#guidelines .selector > * {\n  display: inline-block;\n  padding: 4px 10px;\n}\n#guidelines .selector > *.selected {\n  background: #222222;\n}\n#guidelines > .data_wrapper {\n  position: relative;\n  height: calc(100% - 60px);\n}\n#guidelines > .data_wrapper > * {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  background: #090909;\n}\n#guidelines > .data_wrapper > .level1 > header {\n  position: relative;\n  padding: 10px;\n}\n#guidelines > .data_wrapper > .level1 > .drill > .listjs > .listjs-table {\n  height: auto;\n}\n#guidelines > .data_wrapper > .level1.subs > .drill {\n  padding: 10px 0;\n  position: relative;\n  height: auto !important;\n}\n#guidelines > .data_wrapper > .level1.subs > .drill .pagination {\n  display: none;\n}\n#guidelines > .data_wrapper > .level1.subs > .drill > .total {\n  padding-bottom: 10px;\n}\n#guidelines > .data_wrapper > .level2,\n#guidelines > .data_wrapper > .level3 {\n  z-index: 30;\n}\n#guidelines > .data_wrapper > .level2 > header,\n#guidelines > .data_wrapper > .level3 > header {\n  padding: 10px;\n  display: inline-block;\n}\n#guidelines > .data_wrapper > .level2 > header:nth-child(1),\n#guidelines > .data_wrapper > .level3 > header:nth-child(1) {\n  color: yellow;\n}\n#guidelines > .data_wrapper > .level2 > .drill,\n#guidelines > .data_wrapper > .level3 > .drill {\n  height: calc(100% - 44px);\n  position: relative;\n}\n#guidelines > .data_wrapper > .level2 > .drill > .listjs > .listjs-header,\n#guidelines > .data_wrapper > .level3 > .drill > .listjs > .listjs-header {\n  position: absolute;\n  top: 0;\n}\n#guidelines > .data_wrapper > .level2 > .drill > .listjs > .listjs-table,\n#guidelines > .data_wrapper > .level3 > .drill > .listjs > .listjs-table {\n  height: auto;\n  position: absolute;\n  top: 32px;\n  bottom: 32px;\n}\n#guidelines > .data_wrapper > .level2 > .drill > .listjs > .listjs-footer,\n#guidelines > .data_wrapper > .level3 > .drill > .listjs > .listjs-footer {\n  position: absolute;\n  bottom: 0;\n}\n#guidelines > .data_wrapper.secured > .level3 > header:nth-child(3) {\n  color: yellow;\n}\n#guidelines > .data_wrapper > .level4 {\n  z-index: 60;\n}\n#guidelines > .data_wrapper > .level4 > header {\n  padding: 10px;\n  display: inline-block;\n}\n#guidelines > .data_wrapper > .level4 > header:nth-child(1),\n#guidelines > .data_wrapper > .level4 > header:nth-child(3) {\n  color: yellow;\n}\n#guidelines > .data_wrapper > .level4 > .drill {\n  height: calc(100% - 44px);\n}\n#guidelines > .data_wrapper > .level4 > .drill > .listjs > .listjs-header {\n  position: absolute;\n  top: 0;\n}\n#guidelines > .data_wrapper > .level4 > .drill > .listjs > .listjs-table {\n  height: auto;\n  position: absolute;\n  top: 32px;\n  bottom: 32px;\n}\n#guidelines > .data_wrapper > .level4 > .drill > .listjs > .listjs-footer {\n  position: absolute;\n  bottom: 0;\n}\n#guidelines > .data_wrapper .drill {\n  width: 100%;\n  height: calc(100% - 32px);\n  position: relative;\n  background: transparent !important;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul {\n  overflow-x: hidden;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li {\n  position: relative;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li.OverLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li.OverLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li.OverLimit {\n  background-color: #5b0f05;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li.NearLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li.NearLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li.NearLimit {\n  background-color: #5b0f05;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li.expand > div,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li.expand > div,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li.expand > div {\n  white-space: normal;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div {\n  padding: 4px 10px;\n  outline: 1px solid #222222;\n  text-align: right;\n  overflow-x: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div._plus,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div._plus,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div._plus {\n  width: 4%;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div._limitstatus,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div._limitstatus,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div._limitstatus {\n  position: relative;\n  padding: 0;\n  width: 0;\n  overflow: visible;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div._limitstatus > .OverLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div._limitstatus > .OverLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div._limitstatus > .OverLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div._limitstatus > .NearLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div._limitstatus > .NearLimit,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div._limitstatus > .NearLimit {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 1024px;\n  height: 100%;\n  opacity: 0.4;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.Tag,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.Tag,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.Tag,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.Title,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.Title,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.Title,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.LegalEntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.LegalEntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.LegalEntityName {\n  text-align: left;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.Tag,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.Tag,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.Tag {\n  width: 20%;\n}\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.EntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.GroupbyAssetClass,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-header > ul > li > div.LegalEntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-footer > ul > li > div.LegalEntityName,\n#guidelines > .data_wrapper .drill > .listjs > .listjs-table > .listjs-list > ul > li > div.LegalEntityName {\n  width: 45%;\n}\n#guidelines > .data_wrapper .drill.unsecuredWholesaleFunding > .listjs > .listjs-header > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-header > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.unsecuredWholesaleFunding > .listjs > .listjs-footer > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-footer > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.unsecuredWholesaleFunding > .listjs > .listjs-table > .listjs-list > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-table > .listjs-list > ul > li div.Tag {\n  width: 55%;\n}\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-header > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-footer > ul > li div.Tag,\n#guidelines > .data_wrapper .drill.byCustClassMaxMatXDaysIBUK > .listjs > .listjs-table > .listjs-list > ul > li div.Tag {\n  width: 42%;\n}\n#guidelines > .data_wrapper .grid {\n  height: 100%;\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n#guidelines > .data_wrapper .grid > .tile {\n  position: relative;\n}\n#guidelines > .data_wrapper .grid > .tile.error {\n  padding: 14px 24px;\n  background: #d71a01;\n  margin-bottom: 10px;\n}\n#guidelines > .data_wrapper .grid > .tile * {\n  font-size: 16px;\n}\n#guidelines > .data_wrapper .grid > .tile > .progress {\n  margin-bottom: 6px;\n  display: block;\n  height: 10px;\n  background: #111111;\n}\n#guidelines > .data_wrapper .grid > .tile > .progress > .bar {\n  height: 100%;\n  width: 100%;\n  display: block;\n  background: #38fd2f;\n}\n#guidelines > .data_wrapper .grid > .tile > .progress > .bar.NearLimit {\n  background: #f7ab29;\n}\n#guidelines > .data_wrapper .grid > .tile > .progress > .bar.OverLimit {\n  background: #d71a01;\n}\n#guidelines > .data_wrapper .grid > .tile > .info {\n  background: #222222;\n  overflow: hidden;\n  padding: 6px 24px;\n}\n#guidelines > .data_wrapper .grid > .tile > .info > header {\n  width: 100%;\n  font-size: 18px;\n}\n#guidelines > .data_wrapper .grid > .tile > .info > header > i {\n  float: left;\n  line-height: 1.5;\n  padding-right: 10px;\n}\n#guidelines > .data_wrapper .grid > .tile > .info > .item {\n  width: 33.333%;\n  float: left;\n  text-align: right;\n}\n#guidelines > .data_wrapper .grid > .tile > .info > .item > div {\n  width: 100%;\n}\n#crisismgmt > .title {\n  margin-bottom: 0;\n}\n#crisismgmt > .selector {\n  height: 35px;\n  margin-bottom: 14px;\n}\n#crisismgmt > .selector > * {\n  display: inline-block;\n  padding: 4px 10px;\n}\n#crisismgmt > .selector > *.selected {\n  background: #222222;\n}\n#crisismgmt > .totals {\n  width: 100%;\n  font-size: 16px;\n}\n#crisismgmt > .totals > * {\n  padding: 10px 14px;\n  text-align: right;\n}\n#crisismgmt > .totals > .level1 {\n  background: #222222;\n}\n#crisismgmt > .totals > .level2 {\n  background: #1a1a1a;\n}\n#crisismgmt > .totals > .level3 {\n  background: #131313;\n}\n#crisismgmt > .wrapper {\n  width: 100%;\n  height: calc(100% - 132px);\n  font-size: 16px;\n}\n#crisismgmt > .wrapper > * > * {\n  margin-bottom: 4px;\n  padding: 10px;\n}\n#crisismgmt > .wrapper > * > * > * {\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n#crisismgmt > .wrapper > * > * > *:first-child {\n  text-align: right;\n  float: right;\n  padding-left: 10px;\n}\n#crisismgmt > * > * {\n  float: left;\n  box-sizing: border-box;\n  padding: 0 4px;\n  height: 100%;\n  overflow-y: auto;\n  position: relative;\n  overflow-x: hidden;\n  padding-top: 1px;\n}\n#crisismgmt > * > * > .selected {\n  outline: 1px solid #26ade4;\n}\n#crisismgmt > * > .level1 {\n  width: 30%;\n}\n#crisismgmt > * > .level1 > * {\n  background: #222222;\n}\n#crisismgmt > * > .level2 {\n  width: 30%;\n}\n#crisismgmt > * > .level2 > * {\n  background: #1a1a1a;\n}\n#crisismgmt > * > .level3 {\n  width: 40%;\n}\n#crisismgmt > * > .level3 > * {\n  background: #131313;\n}\n#maturity > .selector {\n  float: right;\n}\n#maturity > .selector > * {\n  display: inline-block;\n  padding: 4px 10px;\n}\n#maturity > .selector > *.selected {\n  background: #222222;\n}\n#maturity > .wrapper {\n  width: 100%;\n  height: calc(100% - 60px);\n  position: relative;\n}\n#maturity > .wrapper > .chart {\n  width: 100%;\n  height: 50%;\n}\n#maturity > .wrapper > .chart > canvas {\n  width: 100% !important;\n  height: 100% !important;\n}\n#maturity > .wrapper > .table {\n  width: 100%;\n  height: 50%;\n  overflow-y: auto;\n}\n#maturity > .wrapper > .table > table {\n  width: 100%;\n  height: 100%;\n}\n#maturity > .wrapper > .table > table > thead > tr > th,\n#maturity > .wrapper > .table > table > tbody > tr > td {\n  font-weight: 300;\n  border: 1px solid #444;\n  background: #222;\n  padding: 0 10px;\n  text-align: right;\n}\n#maturity > .wrapper > .table > table > thead > tr > th:first-child,\n#maturity > .wrapper > .table > table > tbody > tr > td:first-child {\n  text-align: left;\n}\n#maturity > .wrapper > .table > table > tbody > tr:last-child > td {\n  background: #333;\n}\n#maturity > .wrapper > .table > table > thead > tr > th {\n  background: #333;\n  text-align: center !important;\n}\n#maturity .chart .bar:nth-child(1),\n#maturity .chart .bar.chart_TOTAL {\n  background: #26ade4;\n}\n#maturity .chart .bar.chart_CAD {\n  background: #d71a01;\n}\n#maturity .chart .bar:nth-child(2),\n#maturity .chart .bar.chart_USD {\n  background: #38fd2f;\n}\n#maturity .chart .bar:nth-child(3),\n#maturity .chart .bar.chart_EUR {\n  background: #f7ab29;\n}\n#maturity .chart .bar:nth-child(4),\n#maturity .chart .bar.chart_GBP {\n  background: #26ade4;\n}\n#maturity .chart .bar:nth-child(5),\n#maturity .chart .bar.chart_OTHER {\n  background: #ffffff;\n}\n#maturity .chart .col .legend li:before {\n  content: \'\';\n  display: inline-block;\n  width: 10px;\n  height: 10px;\n  margin: 5px 10px 2px 4px;\n  float: left;\n}\n#maturity .chart .col .legend li:nth-child(1):before,\n#maturity .chart .col .legend li.chart_TOTAL:before {\n  background: #26ade4;\n}\n#maturity .chart .col .legend li.chart_CAD:before {\n  background: #d71a01;\n}\n#maturity .chart .col .legend li:nth-child(2):before,\n#maturity .chart .col .legend li.chart_USD:before {\n  background: #38fd2f;\n}\n#maturity .chart .col .legend li:nth-child(3):before,\n#maturity .chart .col .legend li.chart_EUR:before {\n  background: #f7ab29;\n}\n#maturity .chart .col .legend li:nth-child(4):before,\n#maturity .chart .col .legend li.chart_GBP:before {\n  background: #26ade4;\n}\n#maturity .chart .col .legend li:nth-child(5):before,\n#maturity .chart .col .legend li.chart_OTHER:before {\n  background: #ffffff;\n}\n#uwf {\n  overflow-x: hidden;\n}\n#uwf > .selector {\n  float: right;\n  margin-top: 14px;\n}\n#uwf > .selector > * {\n  display: inline-block;\n  padding: 4px 10px;\n}\n#uwf > .selector > *.selected {\n  background: #222222;\n}\n#uwf > .wrapper {\n  width: 100%;\n  height: calc(100% - 60px);\n  font-size: 16px;\n  position: relative;\n}\n#uwf > .wrapper > .level1,\n#uwf > .wrapper > .level2 {\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  background: #090909;\n  overflow-y: auto;\n}\n#uwf > .wrapper > .level1 > * {\n  height: 60px;\n  box-shadow: 0 0 0 1px #222222 inset;\n}\n#uwf > .wrapper > .level1 > * > * > * {\n  width: 25%;\n  display: inline-block;\n}\n#uwf > .wrapper > .level1 > * > header {\n  width: 25%;\n  padding: 6px 14px;\n  float: left;\n  height: 100%;\n  box-sizing: border-box;\n}\n#uwf > .wrapper > .level1 > * > header > *:first-child {\n  width: 66%;\n}\n#uwf > .wrapper > .level1 > * > section {\n  width: 75%;\n  padding: 6px 14px;\n  float: left;\n  height: 100%;\n  box-sizing: border-box;\n}\n#uwf > .wrapper > .level1 > * > section > * {\n  float: left;\n}\n#uwf > .wrapper > .level1 > * > section > * > span:first-child {\n  display: block;\n  text-align: right;\n}\n#uwf > .wrapper > .level1 > * > section > * > span:first-child + span {\n  color: grey;\n  display: block;\n  text-align: right;\n}\n#uwf > .wrapper > .level1 > div:first-child:not(.drill_loading),\n#uwf > .wrapper > .level1 > div:last-child:not(.drill_loading) {\n  box-shadow: none;\n  background: #222222;\n}\n#uwf > .wrapper > .level1 > div:first-child > * > * {\n  padding-top: 15px;\n}\n#uwf > .wrapper > .level1 > .drill_loading {\n  background: none !important;\n  box-shadow: none !important;\n  outline: none !important;\n}\n#uwf #uwf_drill_01 {\n  height: calc(100% - 64px);\n}\n#uwf #uwf_drill_01 .pagination {\n  display: none;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-title {\n  position: relative;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-header {\n  position: absolute;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-table {\n  position: absolute;\n  top: 32px;\n  bottom: 32px;\n  height: auto !important;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-footer {\n  position: absolute;\n  bottom: 0;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-header > ul > li > div,\n#uwf #uwf_drill_01 > .listjs > .listjs-footer > ul > li > div,\n#uwf #uwf_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div {\n  padding: 4px 10px;\n  width: 40%;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-header > ul > li > div:not(:first-child),\n#uwf #uwf_drill_01 > .listjs > .listjs-footer > ul > li > div:not(:first-child),\n#uwf #uwf_drill_01 > .listjs > .listjs-table > .listjs-list > ul > li > div:not(:first-child) {\n  text-align: right;\n  width: 15%;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-table > .listjs-list > ul.list > li > div {\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  outline: 1px solid #222222;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-table > .listjs-list > ul.list > li.expand > div {\n  white-space: normal;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-header > ul > li > div {\n  white-space: normal;\n}\n#uwf #uwf_drill_01 > .listjs > .listjs-header > ul > li > div.filtered {\n  /*&.filtered\n                    {\n                        outline: 2px solid yellow;\n                    }*/\n}\n#nccf {\n  overflow-y: auto;\n}\n#nccf .data_wrapper .selected {\n  color: yellow;\n}\n#nccf .data_wrapper .drill_loading {\n  background: none;\n  z-index: 10000;\n}\n#nccf .data_wrapper .listjs > .listjs {\n  overflow-x: hidden;\n}\n#nccf .data_wrapper .listjs .cell {\n  white-space: nowrap !important;\n  outline: 1px solid #222;\n  padding: 4px 10px;\n}\n#nccf .data_wrapper > .scrollable {\n  position: absolute;\n  overflow-x: auto;\n  left: calc(35% + 15px);\n  z-index: 5000;\n}\n#nccf .data_wrapper > .scrollable > .listjs {\n  width: 400%;\n}\n#nccf .data_wrapper > .scrollable > .listjs > .listjs-header ul > li > div {\n  text-align: center;\n}\n#nccf .data_wrapper > .scrollable > .listjs > .listjs-table ul > li > div {\n  text-align: right;\n}\n#nccf .data_wrapper > .listjs.fixed {\n  position: absolute;\n  width: 35%;\n  height: auto;\n}\n#nccf .data_wrapper > .listjs.fixed .list {\n  width: auto;\n}\n#nccf .data_wrapper > .listjs.fixed .listjs-table {\n  box-shadow: -2px 0 0 #808080 inset;\n}\n#nccf .data_wrapper > .listjs.fixed > div ul > li > :nth-child(1) {\n  width: 14%;\n  white-space: nowrap;\n}\n#counterparties > .wrapper {\n  width: 100%;\n  height: calc(100% - 64px);\n  font-size: 16px;\n  position: relative;\n}\n#counterparties > .wrapper #counterparties_table {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-title {\n  position: relative;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-header {\n  position: absolute;\n  top: 0;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table {\n  position: absolute;\n  top: 32px;\n  bottom: 32px;\n  height: auto !important;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table > .listjs-list > .pagination {\n  display: none;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-footer {\n  position: absolute;\n  bottom: 0;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-header > ul > li > div,\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-footer > ul > li > div,\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table > .listjs-list > ul > li > div {\n  padding: 4px 10px;\n  width: 33.33333333%;\n  outline: 1px solid #222222;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-header > ul > li > div.filtered,\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-footer > ul > li > div.filtered,\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table > .listjs-list > ul > li > div.filtered {\n  outline: 2px solid yellow;\n}\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-header > ul > li > div:nth-child(2),\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-footer > ul > li > div:nth-child(2),\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(2),\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-header > ul > li > div:nth-child(3),\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-footer > ul > li > div:nth-child(3),\n#counterparties > .wrapper #counterparties_table > .listjs > .listjs-table > .listjs-list > ul > li > div:nth-child(3) {\n  text-align: right;\n}\n.drill_loading {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill_loading > svg {\n  width: 70%;\n  height: 100px;\n  padding: 30px;\n  position: relative;\n  top: 50%;\n  left: 15%;\n  margin-top: -50px;\n  float: initial !important;\n}\n.drill_nodata {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  z-index: 10;\n  opacity: 1;\n  background: #000000;\n  outline: 1px solid #000000;\n}\n.drill {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  background: #090909;\n  z-index: 5;\n  opacity: 1;\n}\n.drill.hide {\n  opacity: 0;\n  visibility: hidden;\n}\n.drill > .listjs-title {\n  font-size: 16px;\n  height: 40px;\n  position: relative;\n}\n.drill > .listjs-header {\n  height: 56px;\n  position: relative;\n  width: 100%;\n  font-size: 16px;\n  background: #222222;\n}\n.drill > .listjs-header > ul {\n  width: 100%;\n  z-index: 5;\n}\n.drill > .listjs > .listjs-table {\n  width: 100%;\n  font-size: 16px;\n  height: calc(100% - 106px);\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination {\n  font-size: 17px;\n  display: block;\n  float: right;\n  width: auto;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > * {\n  padding: 4px;\n  margin: 3px;\n  display: inline-block;\n  width: 32px;\n  text-align: center;\n  background: #111111;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *:last-child {\n  margin-right: 0px;\n}\n.drill > .listjs > .listjs-table > .listjs-list > .pagination > *.active {\n  background-color: #222222;\n}\n.drill > .listjs > .listjs-table > ul {\n  width: 100%;\n  table-layout: fixed;\n}\n.drill > .listjs > .listjs-table > ul > li:nth-child(2n) {\n  background: #111111;\n}\n/* Smartphones (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 320px) and (max-device-width: 480px) {\n  .panorama > .panel {\n    padding-top: 0 !important;\n  }\n  .panorama > .panel#jump {\n    padding-top: 54px !important;\n  }\n  * {\n    max-width: 100vw;\n  }\n  #unsecured {\n    min-width: initial !important;\n  }\n  #unsecured .info {\n    padding: 6px 12px !important;\n  }\n  #unsecured .head span,\n  #unsecured .actual span,\n  #unsecured .limit span,\n  #unsecured .capacity span,\n  #unsecured .percent span {\n    display: none;\n  }\n}\n/* Smartphones (landscape) ----------- */\n@media only screen and (min-width: 321px) {\n  /* Styles */\n}\n/* Smartphones (portrait) ----------- */\n@media only screen and (max-width: 320px) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 3vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n  #unsecured .item {\n    width: 50% !important;\n  }\n}\n/* iPads (portrait and landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) {\n  /* Styles */\n}\n/* iPads (landscape) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: landscape) {\n  /* Styles */\n}\n/* iPads (portrait) ----------- */\n@media only screen and (min-device-width: 768px) and (max-device-width: 1024px) and (orientation: portrait) {\n  #datepicker header > div,\n  #datepicker .controls > div > div > i {\n    font-size: 4vh !important;\n  }\n  #datepicker li > div {\n    font-size: 3vh !important;\n  }\n}\n/* Desktops and laptops ----------- */\n@media only screen and (min-width: 1224px) {\n  /* Styles */\n}\n/* Large screens ----------- */\n@media only screen and (min-width: 1824px) {\n  /* Styles */\n}\n/* iPhone 4 ----------- */\n@media only screen and (-webkit-min-device-pixel-ratio: 1.5), only screen and (min-device-pixel-ratio: 1.5) {\n  /* Styles */\n}\n* {\n  box-sizing: border-box;\n  -ms-overflow-style: -ms-autohiding-scrollbar;\n}\nhtml,\nbody,\n.panorama > .panel {\n  margin: 0;\n  font-family: Lato, sans-serif;\n  font-weight: 300;\n  line-height: 1.5;\n  font-size: 16px !important;\n}\na {\n  text-decoration: none;\n  color: inherit;\n}\n/* hidden isn\'t normally important */\n*[hidden] {\n  display: none !important;\n}\n.hide {\n  opacity: 0 !important;\n  visibility: hidden !important;\n}\n.tab {\n  margin: 0 2px;\n  border-top-right-radius: 10px;\n  border-top-left-radius: 10px;\n  padding: 4px 12px;\n  background: #222222;\n  position: relative;\n  text-align: center;\n  font-size: 16px;\n  display: inline-table;\n}\n::-webkit-scrollbar {\n  height: 6px;\n  width: 6px;\n  background: #000;\n}\n::-webkit-scrollbar-thumb {\n  background: #222222;\n  -webkit-border-radius: 1ex;\n  -webkit-box-shadow: 0px 1px 2px rgba(0, 0, 0, 0.75);\n}\n::-webkit-scrollbar-corner {\n  background: #000;\n}\n/*\n@keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-moz-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n@-webkit-keyframes bugfix {\n    from { margin: 0; }\n    to { margin: 0; }\n}\n*\n{\n    animation: bugfix infinite 1s;\n    -mox-animation: bugfix infinite 1s;\n    -webkit-animation: bugfix infinite 1s;\n}\n*/\n.panorama > .panel {\n  width: 100vw;\n  max-width: 1024px;\n}\n.panorama > .panel > header.title {\n  font-size: 20px;\n  margin-bottom: 14px;\n  text-transform: uppercase;\n  height: 40px;\n  overflow: hidden;\n}\n.no_data {\n  position: absolute;\n  top: 0px;\n  bottom: 0px;\n  left: 0px;\n  right: 0px;\n  background: none repeat scroll 0% 0% rgba(0, 0, 0, 0.6);\n  text-align: center;\n}\n.no_data > .no_data_text {\n  font-size: 24px;\n  position: absolute;\n  width: 100%;\n  height: 50%;\n  top: 25%;\n}\n#crisismgmt {\n  -webkit-transform: translateX(0);\n}\n#crisismgmt > *:not(html) {\n  -webkit-transform: translateX(0);\n}\n#nccf {\n  -webkit-transform: translateX(0);\n}\n#counterparties {\n  -webkit-transform: translateX(0);\n}\n.tableloading,\n.BMOloading {\n  position: relative;\n  top: 50%;\n  left: 50%;\n  width: 67px;\n  height: 67px;\n  border-radius: 100%;\n  -webkit-animation: flip 0.75s infinite;\n  -webkit-animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  -moz-animation: flip 0.75s infinite;\n  moz-timing-function: cubic-bezier(0, 0, 1, 1);\n  animation: flip 0.75s infinite;\n  animation-timing-function: cubic-bezier(0, 0, 1, 1);\n  background-size: 67px;\n  background-image: url(\'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEMAAABDCAYAAADHyrhzAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wIbEzYP1acWaQAACehJREFUeNrtnHtwFdUdxz9nd+87IclNCAIpYIGOCJSqWLSddqp92DodWjpD61RpVcZWRbHSTlXQSIkV1KJFBKuFYsWKUKV1RmsBsTgKBRVnVAoqKCAIiAkm4b7v3T3945yYEPK4d++9eai/mZ1kdu6+vvt7fs/vt0JKyWeiRDTUjOrJ65nAQGAYMBQIA2WAD4gDjcAx4ADwvv4/01M3Z/XA+SuBIcBw4AvASKAGqAbKAa/+XUYD0gwcBg4C7wB7gP16XwNg9ycwhH7QLwJnA5P038F5nPMgsE1v24E3gA/7spmY+s1fAHxDb2VFALsB2ARsBNYD7wKyL4FxGvAjvZ3VQyZuA1uBfwJrNSi9CkYY+DEwHThDa0dPSxp4CVgGPA5EesNnnAPMAi4EQr0YET3AV4Fx2jTvAV5zcyLD5Q1MB1YCU3sZiLZSBvwceETfV9HBKAUWavRH0TdlHPAgMAfwFwuMQcASYKYGpS9LOXALcBdQUWgwaoClwCU9kKgVSnzA1cAfdOJXEDAGAnfosCn6WblhAJcDv8tGm7sDIwjcDPw0vwAu1NbTx7bKDOA33Wm10U1a/QvtI9w/CCBjcUilc38oIZDJJDKZLAQoNwEXuQXjPK0V7oGQEhmJgm0jo7HcABECmUhALA7JJE4sBoaRDyAeYAHwpVzBqAJqs3U8nQHh1Ddgnjqc4K2z8V12CdhpSKW6fyDDUNpgWQRmXUfg+pmYJSU4DQ1g5JXkDgV+31lu1JkNXQl8LZ+rOsc+wqgeSHDuHLyTv4/TfBxicRKr1mCEK7rWCMeGSJTAjb8mOPu3SNvGCIeJ3jAH2diIKC8D23Ul/x3gMuC+kyrNGwaE2++boNUp7M5/C2QkgvB4CNbOxn/xRSAEwufDnDAeZ/t27H37EX5/51pxtB7f1CmE6moRfj/CNDEnjEM2NpPe/F+wPAivB9yxdAYwAtigyaNOwbC0eXzbLewylUIm0wSuvZLAzBkIT6vyGeVlGKePIb1xk3rDXm+7V2Pi1NdjTTyT0oULMIa0UiDCsrDOmIC9dy/OazsQfp/yIe6kShd0z3UFxpnAbJ3BubANB2JxfFMmE7qtFhE62TTNoUMwqipJr98AGRssq1UjmpowqqspufsOrIknMwGiJIQ15jQyr72Ovb8L7cqOgKoEtgBHOgNjFvA9t8mVjESwzp5I8K7bMQd3TmxZo0ciU2nSm55HeDzg8aiogyQ07xZ8P5zc6Vs3qqsxaoaS2bIVeezYydqVW8r+HrC5IzCGAzei+Mrco0c0ilFTQ+juBXgmjO+GOLAwx41FHjhI+pXtCCGQkSjBq3+J/5orET5f15TayM9DIEDmxc2QTLVqV+7MnEezZo3tQ+s3gdGugEgkEcEgwdqb8HzlnOy8WGVY/f7ss7A/OoL3wgsI/GpGh6bVkfgvnYb/0p8hpcwnsoxtm3e0aIYJXAd82Y2fkI5NYNZM/FdcnhuO4QqsMadhVA0ieO1VGKNG5vAOBNZZZ2Dv3oOz5x0wXeUfAeCQdqSO1cZExrhyQ/EE5qkj8E272B3Vdu4krHMnufOC5WV4fzKV1HPPIxzHTXQRwEQUc3/AaEOIjHJjItJxIOBHSqdXylLh9SDch1iAz+ntY58xOhcSpDV8aJ+RsSGT6RUwSCbJc6VgIDAerVcGapWrf0r+5X1I51dhA0WkDinWvTqHDhO9eS6pJ9a6ymbji5YQX3y/qmCLBCdwOjDY0slHVTGuIhsbic29jcSyFSSGDqE0VIr3u1lm+lKSvO8BYnPrwOeHdJrArJnFAqQGGGRoNmtAwU9vZ4jfu5TEo3/HqKyCpmZitfOwd76Z1eGpp54hvniJSrkzaRKLl5Ja+2SxwCgHKgwdawu79iElyb+tJr7kTwiPCcEAorwce+cuYrV1yPqGrnF88y1i8+YjmyPg9yNKS3GO1hOrm096y7ZigBEEQi0OtKDLgukXXiR2+50QjSEGDFAFnJSI8gpS6zYQW/jHTqOP09RI9OZ52G/vhoD/4zJdVJST+d8u4nXzsffuLzQYBmAaBbeO3XvUw+zdj6isPJFzEKryTCx/iMQjq05WqHSaxJ33kNnwLCIYaI0UUoJpIsJhUus3Er/rHuTx463hvYCIZFCLt/nYBcLvRx6PEK9bQGbrS4hTBrWSuIbRunm94EjiCxaS3rL1RD+xZi3J5Q8jPV7w+k48DhDBACJcQWLFwySW/VUd5PMWAhAbSFuobplIPv5BeDzIpibiCxeRWPkXRKACmppUdtoRGyDBfmsn0ZnXU/Ln+zHHjSWz8T/EZs8h88FBjAGVyI+OdXCsVOV+Ikb01lqMkcMxQiWqLskv6YsAEQuItpSwriK0EOCxSD/1L1L/eBJj2AiELwSO7DqNt8PI998nvnARnm+dR+qxx5HJOMbI0RiYXeq/qKpCNteTXPYQnvPPA8vMp3JF038Nlv7nQ5fWoSn9JGL4MEoW3w2WB5mN3gqByNjIRBwcB/81VyECAcWhdsdtCoGwHbBtMnv35gsEwD7gSItmHMzHTHAk1jmTMAef0uPZuHzm3woMKd2m5jbwOnDI0O93d95+2bbpFXHy9p7NwKvA8ZbQ+iaq7zKvRKtXJP/rHgF2tS3hd2rt+DTKuy2K0ALGB6jeyk9b73QGtVxwtC0YAM9ShEbTPi6HNRi0B+OFFtv5FMkrwI6OwGgEnibXxnUpEaaBKBvQK08jSktwueYV089b37Kj/erLGmCa5gSzE4+FjEZJr9uAqAz3rNcRkNn+qq6Bcq45twPrTjhdBx3Cc4B5ZNv8JiUIA2EZSEOA07NgCNvRNVBOkgBuAO5tu7OjdbmVwA9QkwBZpdVIBxlJKN6iJ1vgJEjLVJVwbrINeLT9zo7AeA/V7/kgahYkO0ACvv4SmJtQTb31HfEZHcljwKqci7b+ISu14yRbMJLAfO1kPkmyGZjbWcTsykm+hWo5PvoJAeIAqv+kUza6u4ixDtX+mOjnQDQC16PmUnALhgOsAOr6MSARVBNOt0t62eQSGVTv+HwUEdTfNGI28EA2Lj7btM3W2nFLVzbXx+QQql98cbYH5JLDSh2fZwBv93EgXkf1vS/P5SA3i0irUXMnT/dRIFYDF7u5P7crai8DV6A69Y/0ERD2AdeiBm52uCp18hzlNFHdctcAUyjOUG82TnIValJqRz4nKtSQbylqzHs6cD5q/LvYchjFzi3XJE3eka7QX0kIoYZ9JwNfR/VZhihMLStRtP4bOq1+QmtCvGCMQJE+GWGgph3P1VTAeFRrZTWqK9fUvxHtgJJ6s3XCl9YhcpcG4WUUZ3mMIjAnxf5+RkvvRw2qiW4YaryhGtU6VYqaMhQahIR++/Uoxn4f6nMR72hHnSlmfSw++7JKq/wfrr01wWGPYrwAAAAASUVORK5CYII=\');\n}\n@-webkit-keyframes flip {\n  0% {\n    -webkit-transform: rotateX(0deg);\n  }\n  25% {\n    -webkit-transform: rotateX(90deg);\n  }\n  50% {\n    -webkit-transform: rotateX(180deg);\n  }\n  100% {\n    -webkit-transform: rotateX(360deg);\n  }\n}\n@-moz-keyframes flip {\n  0% {\n    -moz-transform: rotateX(0deg);\n  }\n  25% {\n    -moz-transform: rotateX(90deg);\n  }\n  50% {\n    -moz-transform: rotateX(180deg);\n  }\n  100% {\n    -moz-transform: rotateX(360deg);\n  }\n}\n@keyframes flip {\n  0% {\n    transform: rotateX(0deg);\n  }\n  25% {\n    transform: rotateX(90deg);\n  }\n  50% {\n    transform: rotateX(180deg);\n  }\n  100% {\n    transform: rotateX(360deg);\n  }\n}\n');

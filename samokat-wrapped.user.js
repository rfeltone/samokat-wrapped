// ==UserScript==
// @name         Samokat Wrapped 2.0
// @namespace    samokat-wrapped.local
// @version      1.1.0
// @description  Локальная статистика заказов Самоката. Неофициальный проект.
// @match        https://samokat.ru/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/lib/db.ts
  var db_exports = {};
  __export(db_exports, {
    clear: () => clear,
    job: () => job,
    orders: () => orders,
    saveJob: () => saveJob,
    saveOrders: () => saveOrders,
    saveSettings: () => saveSettings,
    settings: () => settings
  });

  // node_modules/idb/build/index.js
  var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
  var idbProxyableTypes;
  var cursorAdvanceMethods;
  function getIdbProxyableTypes() {
    return idbProxyableTypes || (idbProxyableTypes = [
      IDBIndex,
      IDBObjectStore,
      IDBCursor,
      IDBDatabase,
      IDBTransaction
    ]);
  }
  function getCursorAdvanceMethods() {
    return cursorAdvanceMethods || (cursorAdvanceMethods = ["advance", "continue", "continuePrimaryKey"].map((method) => IDBCursor.prototype[method]));
  }
  var transactionDoneMap = /* @__PURE__ */ new WeakMap();
  var transformCache = /* @__PURE__ */ new WeakMap();
  var reverseTransformCache = /* @__PURE__ */ new WeakMap();
  function promisifyRequest(request) {
    const promise = new Promise((resolve, reject) => {
      const unlisten = () => {
        request.removeEventListener("success", success);
        request.removeEventListener("error", error);
      };
      const success = () => {
        resolve(wrap(request.result));
        unlisten();
      };
      const error = () => {
        reject(request.error);
        unlisten();
      };
      request.addEventListener("success", success);
      request.addEventListener("error", error);
    });
    reverseTransformCache.set(promise, request);
    return promise;
  }
  function cacheDonePromiseForTransaction(tx) {
    if (transactionDoneMap.has(tx))
      return;
    const done = new Promise((resolve, reject) => {
      const unlisten = () => {
        tx.removeEventListener("complete", complete);
        tx.removeEventListener("error", error);
        tx.removeEventListener("abort", error);
      };
      const complete = () => {
        resolve();
        unlisten();
      };
      const error = () => {
        reject(tx.error || new DOMException("AbortError", "AbortError"));
        unlisten();
      };
      tx.addEventListener("complete", complete);
      tx.addEventListener("error", error);
      tx.addEventListener("abort", error);
    });
    transactionDoneMap.set(tx, done);
  }
  var idbProxyTraps = {
    get(target, prop, receiver) {
      if (target instanceof IDBTransaction) {
        if (prop === "done")
          return transactionDoneMap.get(target);
        if (prop === "store") {
          return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
        }
      }
      return wrap(target[prop]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
        return true;
      }
      return prop in target;
    }
  };
  function replaceTraps(callback) {
    idbProxyTraps = callback(idbProxyTraps);
  }
  function wrapFunction(func) {
    if (getCursorAdvanceMethods().includes(func)) {
      return function(...args) {
        func.apply(unwrap(this), args);
        return wrap(this.request);
      };
    }
    return function(...args) {
      return wrap(func.apply(unwrap(this), args));
    };
  }
  function transformCachableValue(value) {
    if (typeof value === "function")
      return wrapFunction(value);
    if (value instanceof IDBTransaction)
      cacheDonePromiseForTransaction(value);
    if (instanceOfAny(value, getIdbProxyableTypes()))
      return new Proxy(value, idbProxyTraps);
    return value;
  }
  function wrap(value) {
    if (value instanceof IDBRequest)
      return promisifyRequest(value);
    if (transformCache.has(value))
      return transformCache.get(value);
    const newValue = transformCachableValue(value);
    if (!Object.is(newValue, value)) {
      transformCache.set(value, newValue);
      reverseTransformCache.set(newValue, value);
    }
    return newValue;
  }
  var unwrap = (value) => reverseTransformCache.get(value);
  function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
    const request = indexedDB.open(name, version);
    const openPromise = wrap(request);
    if (upgrade) {
      request.addEventListener("upgradeneeded", (event) => {
        upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
      });
    }
    if (blocked) {
      request.addEventListener("blocked", (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion,
        event.newVersion,
        event
      ));
    }
    openPromise.then((db2) => {
      if (terminated)
        db2.addEventListener("close", () => terminated());
      if (blocking) {
        db2.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
      }
    }).catch(() => {
    });
    return openPromise;
  }
  var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
  var writeMethods = ["put", "add", "delete", "clear"];
  var cachedMethods = {};
  function getMethod(target, prop) {
    if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
      return;
    }
    if (cachedMethods[prop])
      return cachedMethods[prop];
    const targetFuncName = prop.replace(/FromIndex$/, "");
    const useIndex = prop !== targetFuncName;
    const isWrite = writeMethods.includes(targetFuncName);
    if (
      // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
      !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
    ) {
      return;
    }
    const method = async function(storeName, ...args) {
      const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
      let target2 = tx.store;
      if (useIndex)
        target2 = target2.index(args.shift());
      return (await Promise.all([
        target2[targetFuncName](...args),
        isWrite && tx.done
      ]))[0];
    };
    return cachedMethods[prop] = method;
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
    has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
  }));
  var advanceMethodProps = ["advance", "continue", "continuePrimaryKey"];
  var methodMap = {};
  var advanceResults = /* @__PURE__ */ new WeakMap();
  var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
  var cursorIteratorTraps = {
    get(target, prop) {
      if (!advanceMethodProps.includes(prop))
        return target[prop];
      let cachedFunc = methodMap[prop];
      if (!cachedFunc) {
        cachedFunc = methodMap[prop] = function(...args) {
          advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
        };
      }
      return cachedFunc;
    }
  };
  async function* iterate(...args) {
    let cursor = this;
    if (!(cursor instanceof IDBCursor)) {
      cursor = await cursor.openCursor(...args);
    }
    if (!cursor)
      return;
    cursor = cursor;
    const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
    ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
    reverseTransformCache.set(proxiedCursor, unwrap(cursor));
    while (cursor) {
      yield proxiedCursor;
      cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
      advanceResults.delete(proxiedCursor);
    }
  }
  function isIteratorProp(target, prop) {
    return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get(target, prop, receiver) {
      if (isIteratorProp(target, prop))
        return iterate;
      return oldTraps.get(target, prop, receiver);
    },
    has(target, prop) {
      return isIteratorProp(target, prop) || oldTraps.has(target, prop);
    }
  }));

  // src/types/index.ts
  var initialJob = () => ({ state: "idle", phase: "list", offset: 0, total: 0, done: 0, message: "\u0413\u043E\u0442\u043E\u0432 \u043A \u0441\u0431\u043E\u0440\u0443", observed: false, attempts: 0, nextAt: 0, updated: Date.now() });

  // src/lib/parser.ts
  var obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  var str = (v) => typeof v === "string" || typeof v === "number" ? String(v) : "";
  var money = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : void 0;
  var date = (v) => {
    const s = str(v);
    return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : "";
  };
  function extract(v) {
    if (Array.isArray(v)) return v;
    const o = obj(v);
    for (const key of ["orders", "items", "content", "data", "results"]) {
      if (Array.isArray(o[key])) return o[key];
      if (o[key] && typeof o[key] === "object") {
        try {
          return extract(o[key]);
        } catch {
        }
      }
    }
    if (o.orderId || o.id) return [v];
    throw new Error("\u041D\u0435\u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 API \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0441\u044F: \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u043A\u0430\u0437\u043E\u0432");
  }
  function normalize(v, detail = false) {
    const o = obj(v), d = Object.keys(obj(o.details)).length ? obj(o.details) : o;
    const id = str(o.orderId || o.id || d.orderId || d.id);
    if (!id || id.length > 200) throw new Error("\u0417\u0430\u043A\u0430\u0437 \u0431\u0435\u0437 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0433\u043E orderId");
    const a = obj(d.address), sl = obj(d.statusLabel), warnings = [];
    const when = date(o.date || d.date);
    if (!when) warnings.push("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0434\u0430\u0442\u0430");
    const lines = Array.isArray(d.orderLines) ? d.orderLines.map((v2, i) => {
      const l = obj(v2), p = obj(l.product), q = l.quantity;
      return { id: str(l.productId || p.id || l.id) || `unknown-${i}`, name: str(p.name || p.title || l.name) || "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u043E\u0432\u0430\u0440", quantity: typeof q === "number" && Number.isFinite(q) && q >= 0 ? q : 0, price: money(l.price), image: typeof p.image === "string" && /^https:\/\//.test(p.image) ? p.image : void 0 };
    }) : [];
    const total = money(d.totalPrice), amount = money(o.amount ?? d.amount);
    if (total === void 0 && amount === void 0) warnings.push("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430");
    return { id, date: when, status: str(o.status || d.status) || "UNKNOWN", amount, total, price: money(d.price), discount: money(d.discountAmount), delivered: date(sl.deliveredDate) || void 0, address: { city: str(a.city), street: str(a.street), house: str(a.house) }, lines, complete: (detail || Array.isArray(d.orderLines)) && Array.isArray(d.orderLines), refunds: Array.isArray(d.refunds) ? d.refunds.length > 0 : !!d.refunds, warnings };
  }
  function merge(a, b) {
    const best = b.complete || !a.complete ? b : a, other = best === a ? b : a;
    return { ...other, ...best, date: best.date || other.date, amount: best.amount ?? other.amount, total: best.total ?? other.total, address: best.address.city || best.address.street ? best.address : other.address, lines: best.lines.length ? best.lines : other.lines, complete: a.complete || b.complete };
  }
  function importOrders(value) {
    const root = obj(value);
    const input = extract(value);
    const map = /* @__PURE__ */ new Map();
    for (const v of input) {
      const n2 = root.format === "samokat-wrapped-v1" ? fromBackup(v) : normalize(v);
      map.set(n2.id, map.has(n2.id) ? merge(map.get(n2.id), n2) : n2);
    }
    return [...map.values()];
  }
  function fromBackup(v) {
    const o = obj(v);
    const a = obj(o.address);
    return normalize({ id: o.id, date: o.date, status: o.status, amount: o.amount, details: { totalPrice: o.total, price: o.price, discountAmount: o.discount, address: a, statusLabel: { deliveredDate: o.delivered }, refunds: o.refunds, orderLines: o.complete ? (Array.isArray(o.lines) ? o.lines : []).map((v2) => {
      const l = obj(v2);
      return { product: { id: l.id, name: l.name, image: l.image }, quantity: l.quantity, price: l.price };
    }) : void 0 } });
  }
  function backup(orders2, anonymous = false) {
    return JSON.stringify({ format: "samokat-wrapped-v1", orders: orders2.map((o, i) => ({ ...o, id: anonymous ? `order-${i + 1}` : o.id, address: anonymous ? { city: "", street: "", house: "" } : o.address, lines: o.lines.map((l) => ({ ...l, image: void 0 })) })) }, null, 2);
  }

  // src/lib/db.ts
  var db = () => openDB("samokat-wrapped", 1, { upgrade(db2) {
    db2.createObjectStore("orders", { keyPath: "id" });
    db2.createObjectStore("meta");
  } });
  async function orders() {
    return (await db()).getAll("orders");
  }
  async function saveOrders(items) {
    const d = await db(), tx = d.transaction("orders", "readwrite");
    for (const o of items) {
      const old = await tx.store.get(o.id);
      await tx.store.put(old ? merge(old, o) : o);
    }
    await tx.done;
  }
  async function job() {
    return (await db()).get("meta", "job").then((v) => v ?? initialJob());
  }
  async function saveJob(v) {
    await (await db()).put("meta", v, "job");
  }
  async function settings() {
    return (await db()).get("meta", "settings").then((v) => v ?? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, privacy: true, images: false });
  }
  async function saveSettings(v) {
    new Intl.DateTimeFormat("ru", { timeZone: v.timezone });
    await (await db()).put("meta", v, "settings");
  }
  async function clear() {
    const d = await db(), tx = d.transaction(["orders", "meta"], "readwrite");
    await Promise.all([tx.objectStore("orders").clear(), tx.objectStore("meta").clear()]);
    await tx.done;
  }

  // src/background/collector.ts
  var Collector = class {
    constructor(store, request = fetch) {
      this.store = store;
      this.request = request;
    }
    store;
    request;
    headers = null;
    showcase = "";
    busy = false;
    controller = null;
    forget() {
      this.headers = null;
      this.showcase = "";
      this.controller?.abort();
    }
    async step() {
      if (this.busy) return;
      this.busy = true;
      try {
        const j = await this.store.job();
        if (j.state !== "running" || Date.now() < j.nextAt) return;
        if (!this.headers) {
          j.state = "waiting";
          j.message = "\u041D\u0443\u0436\u0435\u043D \u0434\u043E\u0441\u0442\u0443\u043F \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043E\u0434\u0438\u043D \u0440\u0430\u0437 \u2014 \u043F\u0440\u043E\u043A\u0440\u0443\u0447\u0438\u0432\u0430\u0442\u044C \u0435\u0451 \u043D\u0435 \u043D\u0443\u0436\u043D\u043E. \u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D.";
          await this.store.saveJob(j);
          return;
        }
        const cached = await this.store.orders();
        let target;
        let path = `/orders?limit=10&offset=${j.offset}`;
        if (j.phase === "details") {
          target = cached.find((o) => !o.complete);
          j.total = cached.length;
          j.done = cached.filter((o) => o.complete).length;
          if (!target) {
            j.state = "done";
            j.message = `\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${j.done}/${j.total}`;
            this.forget();
            await this.store.saveJob(j);
            return;
          }
          path = `/orders/${encodeURIComponent(target.id)}${this.showcase ? "?embedProductsOfShowcaseId=" + encodeURIComponent(this.showcase) : ""}`;
        }
        this.controller = new AbortController();
        const timeout = setTimeout(() => this.controller?.abort(), 2e4);
        let response;
        const sentHeaders = { ...this.headers };
        try {
          response = await this.request("https://api-web.samokat.ru" + path, { headers: sentHeaders, credentials: "include", redirect: "error", signal: this.controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if ((await this.store.job()).state !== "running") return;
        if (response.status === 401 || response.status === 403) {
          if (response.status === 401 && this.headers && JSON.stringify(this.headers) !== JSON.stringify(sentHeaders)) {
            j.nextAt = Date.now() + 1e3;
            j.message = "\u041F\u043E\u043B\u0443\u0447\u0435\u043D \u043D\u043E\u0432\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u0441\u0430\u0439\u0442\u0430 \xB7 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u0435\u043C \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441";
            await this.store.saveJob(j);
            return;
          }
          this.forget();
          j.state = "waiting";
          j.message = response.status === 401 ? `401 \u2014 \u0441\u0430\u0439\u0442 \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u0434\u043E\u0441\u0442\u0443\u043F. \u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D (${j.offset} \u0432 \u0441\u043F\u0438\u0441\u043A\u0435, ${j.done}/${j.total} \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0435\u0439). \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0438\u043B\u0438 \u0437\u0430\u043A\u0430\u0437 \u043E\u0434\u0438\u043D \u0440\u0430\u0437 \u2014 \u043F\u0440\u043E\u043A\u0440\u0443\u0442\u043A\u0430 \u043D\u0435 \u043D\u0443\u0436\u043D\u0430. \u041F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 \u0432\u0445\u043E\u0434 \u043D\u0443\u0436\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0441\u0430\u043C \u0441\u0430\u0439\u0442 \u043F\u0440\u043E\u0441\u0438\u0442 \u0432\u043E\u0439\u0442\u0438.` : "403 \u2014 \u0441\u0430\u0439\u0442 \u0437\u0430\u043F\u0440\u0435\u0442\u0438\u043B \u0437\u0430\u043F\u0440\u043E\u0441. \u0421\u0431\u043E\u0440 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D, \u0434\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0414\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0438\u043C\u043F\u043E\u0440\u0442 JSON.";
          await this.store.saveJob(j);
          return;
        }
        if (response.status === 429 || response.status >= 500) {
          j.attempts++;
          j.state = j.attempts > 5 ? "error" : "running";
          const retry = response.headers.get("Retry-After");
          const seconds = retry ? Number(retry) || Math.max(0, (Date.parse(retry) - Date.now()) / 1e3) : 0;
          j.nextAt = Date.now() + Math.max(seconds * 1e3, Math.min(3e5, 3e4 * 2 ** (j.attempts - 1)));
          j.message = `${response.status} \u2014 ${j.state === "error" ? "\u043B\u0438\u043C\u0438\u0442 \u043F\u043E\u0432\u0442\u043E\u0440\u043E\u0432, \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435" : "\u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u0434 \u043F\u043E\u0432\u0442\u043E\u0440\u043E\u043C"}`;
          await this.store.saveJob(j);
          return;
        }
        if (!response.ok) throw new Error("API");
        const body = await response.json();
        if ((await this.store.job()).state !== "running") return;
        if (target) {
          const raw = body;
          const detail = raw?.data ?? raw?.order ?? body;
          const order = normalize(detail, true);
          if (order.id !== target.id || !order.complete) throw new Error("Schema");
          await this.store.saveOrders([order]);
          j.done++;
        } else {
          const list = extract(body);
          const parsed = list.map((v) => normalize(v));
          const signature = parsed.map((o) => o.id).join("|");
          if (parsed.length && j.lastPage === signature) throw new Error("Pagination");
          j.lastPage = signature;
          await this.store.saveOrders(parsed);
          j.offset += list.length;
          if (!list.length) j.phase = "details";
          const now = await this.store.orders();
          j.total = now.length;
          j.done = now.filter((o) => o.complete).length;
        }
        j.attempts = 0;
        j.nextAt = Date.now() + 1e3;
        j.updated = Date.now();
        j.message = `\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${j.done}/${j.total} \xB7 ${j.phase === "list" ? "\u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u0441\u043F\u0438\u0441\u043A\u0430" : "\u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438"}`;
        await this.store.saveJob(j);
      } catch {
        const j = await this.store.job();
        if (j.state === "running") {
          j.state = "error";
          j.message = "\u0421\u0435\u0442\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0438\u043B\u0438 \u043D\u0435\u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 API \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0441\u044F. \u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B; \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0438\u043B\u0438 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C JSON.";
          await this.store.saveJob(j);
        }
        this.forget();
      } finally {
        this.busy = false;
      }
    }
  };

  // src/auth.ts
  var allow = /* @__PURE__ */ new Set(["authorization", "deviceid", "x-application-platform", "x-creeper"]);
  var ttl = 5 * 60 * 1e3;
  function installObserver(onRequest) {
    const originalFetch = window.fetch;
    const open = XMLHttpRequest.prototype.open, set = XMLHttpRequest.prototype.setRequestHeader, send = XMLHttpRequest.prototype.send;
    let enabled = true, latest = null, expires = 0, expiry;
    let xhr = /* @__PURE__ */ new WeakMap();
    const ownSignals = /* @__PURE__ */ new WeakSet();
    const ownURLs = /* @__PURE__ */ new Map();
    function clear2() {
      latest = null;
      expires = 0;
      clearTimeout(expiry);
      xhr = /* @__PURE__ */ new WeakMap();
    }
    function isAPI(url) {
      return new URL(url, location.href).origin === "https://api-web.samokat.ru";
    }
    function observe(url, headers) {
      if (!enabled) return;
      try {
        const u = new URL(url, location.href);
        if (!isAPI(url) || ownURLs.has(u.href)) return;
        const safe = {};
        headers.forEach((v, k) => {
          if (allow.has(k.toLowerCase())) safe[k.toLowerCase()] = v;
        });
        if (!safe.authorization) return;
        const previous = latest?.headers.authorization === safe.authorization ? latest : null;
        latest = { headers: { ...previous?.headers, ...safe }, showcase: u.searchParams.get("embedProductsOfShowcaseId") ?? previous?.showcase ?? "" };
        expires = Date.now() + ttl;
        clearTimeout(expiry);
        expiry = setTimeout(clear2, ttl);
        onRequest({ headers: { ...latest.headers }, showcase: latest.showcase });
      } catch {
      }
    }
    const wrapped = function(input, init) {
      try {
        const req = input instanceof Request ? input : null;
        const signal = init?.signal ?? req?.signal;
        if (!signal || !ownSignals.has(signal)) observe(req?.url ?? String(input), new Headers(init?.headers ?? req?.headers));
      } catch {
      }
      return originalFetch.call(this, input, init);
    };
    window.fetch = wrapped;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      xhr.set(this, { url: String(url), headers: new Headers() });
      return Reflect.apply(open, this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      const state = xhr.get(this);
      if (enabled && state && allow.has(name.toLowerCase())) {
        try {
          if (isAPI(state.url)) state.headers.append(name, value);
        } catch {
        }
      }
      return set.call(this, name, value);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const state = xhr.get(this);
      if (state) observe(state.url, state.headers);
      xhr.delete(this);
      return send.call(this, body);
    };
    const request = (input, init) => {
      const req = input instanceof Request ? input : null, signal = init?.signal ?? req?.signal;
      if (signal) ownSignals.add(signal);
      const url = new URL(req?.url ?? String(input), location.href).href;
      ownURLs.set(url, (ownURLs.get(url) ?? 0) + 1);
      const release = () => {
        const count = (ownURLs.get(url) ?? 1) - 1;
        if (count) ownURLs.set(url, count);
        else ownURLs.delete(url);
      };
      try {
        return window.fetch.call(window, input, init).finally(release);
      } catch (e) {
        release();
        throw e;
      }
    };
    return {
      enable() {
        enabled = true;
      },
      disable() {
        enabled = false;
        clear2();
      },
      clear: clear2,
      snapshot() {
        if (Date.now() >= expires) {
          clear2();
          return null;
        }
        return latest ? { headers: { ...latest.headers }, showcase: latest.showcase } : null;
      },
      request,
      healthy: () => window.fetch === wrapped
    };
  }

  // src/lib/analytics.ts
  var paid = (o) => o.status === "DELIVERED" ? o.total ?? o.amount ?? 0 : 0;
  var addressKey = (o) => [o.address.city, o.address.street, o.address.house].map((s) => s.trim().toLocaleLowerCase("ru")).join("|");
  function parts(date2, timezone) {
    if (!date2) return { month: "\u0411\u0435\u0437 \u0434\u0430\u0442\u044B", year: "\u0411\u0435\u0437 \u0434\u0430\u0442\u044B", hour: 0, day: 0 };
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(date2));
    const get = (t) => p.find((x) => x.type === t)?.value ?? "";
    return { month: `${get("year")}-${get("month")}`, year: get("year"), hour: Number(get("hour")), day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) };
  }
  function analytics(all, timezone) {
    const delivered = all.filter((o) => o.status === "DELIVERED"), sum = delivered.reduce((s, o) => s + paid(o), 0);
    const month = /* @__PURE__ */ new Map(), year = /* @__PURE__ */ new Map();
    const products = /* @__PURE__ */ new Map();
    const addresses = /* @__PURE__ */ new Map();
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    const times = [];
    let discount = 0, difference = 0;
    for (const o of delivered) {
      const p = parts(o.date, timezone), amount = paid(o);
      month.set(p.month, (month.get(p.month) ?? 0) + amount);
      year.set(p.year, (year.get(p.year) ?? 0) + amount);
      if (o.date && p.day >= 0) heat[p.day][p.hour]++;
      const k = addressKey(o), a = addresses.get(k) ?? { key: k, label: [o.address.city, o.address.street, o.address.house].filter(Boolean).join(", ") || "\u0410\u0434\u0440\u0435\u0441 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D", count: 0, spent: 0 };
      a.count++;
      a.spent += amount;
      addresses.set(k, a);
      discount += o.discount ?? 0;
      if (o.price !== void 0 && o.total !== void 0) difference += Math.max(0, o.price - o.total);
      if (o.delivered && o.date) {
        const t = (Date.parse(o.delivered) - Date.parse(o.date)) / 6e4;
        if (t >= 0 && Number.isFinite(t)) times.push(t);
      }
      for (const l of o.lines) {
        const v = products.get(l.id) ?? { id: l.id, name: l.name, quantity: 0, spent: 0, unknown: 0, image: l.image };
        v.quantity += l.quantity;
        v.spent += (l.price ?? 0) * l.quantity;
        if (l.price === void 0) v.unknown++;
        products.set(l.id, v);
      }
    }
    let cumulative = 0;
    const months = [...month].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value: value / 100, cumulative: (cumulative += value) / 100 }));
    return { sum, delivered: delivered.length, cancelled: all.filter((o) => /CANCEL/.test(o.status)).length, average: delivered.length ? sum / delivered.length : 0, max: Math.max(0, ...delivered.map(paid)), discount, difference, months, years: [...year].sort().map(([name, value]) => ({ name, value: value / 100 })), products: [...products.values()], addresses: [...addresses.values()], heat, times, refunds: all.some((o) => o.refunds), incomplete: all.filter((o) => !o.complete).length, unknown: all.filter((o) => o.warnings.length).length };
  }

  // src/dashboard/ui.ts
  var escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var rub = (n2) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(n2 / 100);
  var n = (v) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(v);
  var pages = ["\u041E\u0431\u0437\u043E\u0440", "\u0410\u0434\u0440\u0435\u0441\u0430", "\u0422\u043E\u0432\u0430\u0440\u044B", "\u0421\u043A\u0438\u0434\u043A\u0438", "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430", "\u0418\u0441\u0442\u043E\u0440\u0438\u044F", "Wrapped", "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438"];
  var icons = ["\u25C8", "\u2302", "\u25EB", "%", "\u25F7", "\u2261", "\u2726", "\u2699"];
  function download(data, name) {
    const u = URL.createObjectURL(data), a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1e3);
  }
  function chart(values, title) {
    if (!values.length) return '<div class="empty">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434</div>';
    const max = Math.max(...values.map((v) => v.value), 1), width = Math.max(600, values.length * 52), step = width / values.length;
    return `<div class="scrollchart"><svg viewBox="0 0 ${width} 245" role="img" aria-label="${escape(title)}" style="min-width:${Math.min(width, 1e3)}px">${values.map((v, i) => {
      const h = v.value / max * 175;
      return `<g><rect x="${i * step + 8}" y="${195 - h}" width="${Math.max(6, step - 16)}" height="${h}" rx="5" fill="#b9f66b"><title>${escape(v.name)}: ${escape(rub(v.value * 100))}</title></rect><text x="${i * step + step / 2}" y="218" text-anchor="middle" fill="#89998d" font-size="10">${escape(v.name)}</text></g>`;
    }).join("")}</svg></div>`;
  }
  var card = (label, value, sub = "") => `<article class="stat-box"><div class="label">${escape(label)}</div><div class="big num" style="margin-top:18px">${escape(value)}</div><div class="secondary">${escape(sub)}</div></article>`;
  var Dashboard = class {
    constructor(actions) {
      this.actions = actions;
      this.host.id = "samokat-wrapped";
      const style = document.createElement("style");
      style.textContent = '/* Samokat Wrapped: \u0432\u0438\u0437\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u0440\u0435\u0444\u0435\u0440\u0435\u043D\u0441 \u0431\u0435\u0437 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445. */\n:root{--bg:#080c0b;--panel:#121a16;--panel2:#161f19;--panel3:#1c2820;--stroke:#26352a;--stroke2:#304135;--muted:#89998d;--white:#f0f6ef;--green:#b9f66b;--green2:#8fde56;--soft:#d5f3b4;--red:#ff8786;--gold:#efc878;--blue:#93ccf3;--radius:20px}\n*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--white);font-size:14px;-webkit-font-smoothing:antialiased}body:before{content:"";position:fixed;inset:0;background:radial-gradient(800px 650px at 62% -20%,#315b2924,transparent),radial-gradient(560px 440px at 100% 75%,#17372825,transparent);pointer-events:none;z-index:-1}a{color:inherit}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--green);outline-offset:2px}::selection{background:#b9f66b;color:#080d08}::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-track{background:#0d130f}::-webkit-scrollbar-thumb{background:#3a4e3b;border-radius:10px}\n.shell{min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:236px;border-right:1px solid #233127;background:#0c120fcc;backdrop-filter:blur(24px);z-index:10;padding:28px 14px 24px;display:flex;flex-direction:column;overflow:auto}.brand{display:flex;align-items:center;gap:12px;margin:2px 12px 42px}.brand-icon{width:43px;height:43px;background:var(--green);color:#10210f;border-radius:13px;display:grid;place-items:center;transform:rotate(-8deg);box-shadow:0 0 36px #a4fc642a}.brand-icon svg{transform:rotate(8deg)}.brand-title{font-size:20px;font-weight:900;letter-spacing:-.065em;line-height:1}.brand-caption{font-size:10px;color:var(--green);font-weight:750;letter-spacing:.23em;margin-top:6px}.side-label{color:#748b78;font-weight:800;font-size:10px;letter-spacing:.17em;margin:0 14px 14px;text-transform:uppercase}.nav{display:flex;flex-direction:column;gap:5px}.nav button{width:100%;display:flex;align-items:center;gap:13px;text-align:left;border:1px solid transparent;background:transparent;color:#93a297;padding:13px 15px;border-radius:12px;font-weight:650;transition:all .17s}.nav button svg{width:18px;height:18px;flex-shrink:0}.nav button:hover{background:#1a271d;color:#fff}.nav button.active{background:#b9f66b18;border-color:#b9f66b23;color:var(--green)}.nav button.active:before{content:"";height:21px;width:3px;background:var(--green);position:absolute;left:13px;border-radius:3px}.side-foot{margin-top:auto;padding:20px 10px 4px}.side-mini{background:linear-gradient(150deg,#1d3220,#142019);border:1px solid #37523a;border-radius:17px;padding:18px;overflow:hidden;position:relative}.side-mini:after{content:"\u2726";color:#c6fc7e22;font-size:108px;position:absolute;right:-10px;top:-18px}.side-mini b{font-size:16px;display:block;position:relative;z-index:1}.side-mini p{color:#b7c7b9;font-size:12px;line-height:1.5;position:relative;z-index:1}.side-mini span{font-size:10px;letter-spacing:.15em;color:var(--green);font-weight:800}\n.main{margin-left:236px;min-width:0;padding:33px clamp(24px,3.15vw,58px) 60px;max-width:1800px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:30px}.eyebrow{color:var(--green);font-size:11px;font-weight:900;letter-spacing:.2em;text-transform:uppercase}.top-sub{color:#809184;font-size:12px;margin-top:7px}.top-right{display:flex;align-items:center;gap:11px}.pill{border:1px solid #365037;background:#17241a;color:#b5dfae;border-radius:50px;padding:10px 13px;font-size:11px;font-weight:700;letter-spacing:.05em;white-space:nowrap}.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green);margin-right:7px}.ghost-btn,.outline-btn{border:1px solid #3a4b3e;background:#172019;color:#eaf8e8;padding:10px 14px;border-radius:11px;display:inline-flex;gap:8px;align-items:center;justify-content:center;font-weight:700;white-space:nowrap}.ghost-btn:hover,.outline-btn:hover{border-color:#8cc766;background:#1b2d20}.primary-btn{border:0;background:var(--green);color:#10200f;border-radius:11px;padding:12px 17px;font-weight:850;display:inline-flex;align-items:center;gap:9px}.primary-btn:hover{background:#d2ff92}.filters{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:27px}.filterwrap{display:flex;align-items:center;gap:8px;background:#111a14;border:1px solid #29382c;padding:0 13px;border-radius:10px;color:#93a898}.filterwrap svg{width:15px;height:15px}.filterwrap select{background:transparent;color:#e0eae0;border:0;outline:none;padding:11px 13px 11px 0;max-width:245px;min-width:72px;cursor:pointer;font-size:12px;font-weight:700}.filterwrap option{background:#111a14;color:#eee}.filterhint{color:#7f9182;font-size:11px;margin-left:auto}.clearbtn{background:transparent;border:none;color:var(--green);font-size:11px;font-weight:800;padding:8px}\n.page{animation:fadeUp .22s ease-out}@keyframes fadeUp{from{opacity:.55;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin:32px 0 17px}.section-head h2{font-size:22px;letter-spacing:-.045em;margin:0;font-weight:850}.section-head p{color:var(--muted);font-size:12px;line-height:1.5;margin:7px 0 0}.section-head:first-child{margin-top:0}.section-head .action{color:var(--green);border:0;background:none;font-weight:750;font-size:12px;white-space:nowrap}.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}.card{background:linear-gradient(145deg,#162019,#121a16 72%);border:1px solid var(--stroke);border-radius:var(--radius);padding:23px;min-width:0;position:relative;overflow:hidden}.card-plain{background:#121b15}.card-title{font-size:15px;font-weight:800;letter-spacing:-.025em}.card-sub{font-size:11px;color:#85988a;margin-top:7px;line-height:1.5}.card-line{display:flex;align-items:center;justify-content:space-between;gap:12px}.tag{border-radius:50px;background:#293d29;color:#c1e2b5;padding:5px 10px;font-size:10px;font-weight:750;white-space:nowrap}.tag.positive{background:#284b2c;color:var(--green)}.tag.danger{background:#4c2c2a;color:#ffb6ad}.tag.gold{background:#4b3b26;color:#f2d299}.muted{color:var(--muted)}.small{font-size:12px}.tiny{font-size:10px}.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}\n.hero{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(340px,.72fr);gap:17px}.hero-main{border:1px solid #4b7743;background:radial-gradient(480px 320px at 87% 13%,#9cfc532b,transparent 70%),linear-gradient(138deg,#214023,#14291b 70%);padding:34px 36px 24px;border-radius:24px;position:relative;min-height:295px;overflow:hidden}.hero-main:after{content:"";position:absolute;width:330px;height:330px;border:1px solid #b7f76626;border-radius:50%;right:-115px;bottom:-215px;box-shadow:0 0 0 64px #b7f7660a,0 0 0 130px #b7f76609;pointer-events:none}.hero-main .intro{display:flex;align-items:center;gap:7px;color:#cfeabe;font-size:12px;font-weight:750}.hero-num{font-size:clamp(49px,5.1vw,83px);font-weight:920;letter-spacing:-.083em;line-height:1.07;margin:25px 0 9px;color:#eaffdb}.hero-num span{font-size:.48em;color:var(--green);letter-spacing:-.03em}.hero-foot{color:#a9c5a5;font-size:13px}.hero-rail{display:flex;gap:20px;align-items:center;margin-top:29px;border-top:1px solid #9fea7950;padding-top:17px}.hero-rail b{font-size:19px;font-weight:850;letter-spacing:-.04em}.hero-rail small{font-size:10px;color:#aac8a2;display:block;margin-top:4px}.hero-side{display:grid;grid-template-columns:1fr 1fr;gap:13px}.stat-box{border:1px solid #2b3b2e;border-radius:18px;background:#151f18;padding:22px 18px;position:relative}.stat-box .icon-circle{display:grid;place-items:center;background:#29472e;border-radius:12px;color:var(--green);width:36px;height:36px;margin-bottom:20px}.stat-box .big{font-size:clamp(26px,2.55vw,36px);font-weight:850;letter-spacing:-.065em;line-height:1}.stat-box .label{font-size:11px;margin-top:9px;color:#9cae9e}.stat-box .secondary{font-size:10px;margin-top:8px;color:#718975}.stat-box.goldbox .icon-circle{color:var(--gold);background:#413821}.stat-box.bluebox .icon-circle{color:var(--blue);background:#213b45}.stat-box.pinkbox .icon-circle{color:#ffaaa4;background:#4c302f}\n.split{display:grid;grid-template-columns:minmax(0,1.58fr) minmax(290px,.82fr);gap:16px}.chart-legend{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.chart-legend button{border:1px solid #36483a;border-radius:8px;padding:7px 10px;background:transparent;color:#8da08f;font-size:11px;font-weight:700}.chart-legend button.active{background:#2b422a;border-color:#658d4a;color:var(--green)}.chart-svg{display:block;width:100%;height:auto;overflow:visible}.chartbar{cursor:pointer}.chartbar:hover{filter:brightness(1.2)}.axis{font-size:11px;fill:#819587;font-weight:600}.hline{stroke:#344837;stroke-dasharray:3 6;stroke-width:.8}.rankrow{display:flex;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid #26352b}.rankrow:last-child{border-bottom:0}.rank{width:22px;font-weight:900;color:#829787;font-size:12px;flex:0 0 22px}.rank.n1{color:var(--green)}.ranklabel{font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ranksub{font-size:10px;color:#889c8c;margin-top:5px}.rankright{font-size:13px;font-weight:800;white-space:nowrap;text-align:right}.track{height:5px;background:#263629;border-radius:5px;margin-top:8px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#6fb94b,var(--green));border-radius:5px}.img-thumb{width:42px;height:42px;border-radius:10px;background:#334035;flex-shrink:0;object-fit:cover}.prodrow{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #28372c}.prodrow:last-child{border:0}.prodrow .name{font-size:12px;line-height:1.4;font-weight:700;max-height:3em;overflow:hidden}.prodrow .desc{font-size:10px;color:#879a8a;margin-top:5px}.prodrow .price{font-size:13px;font-weight:800;text-align:right;white-space:nowrap}.prodrow .index{width:20px;color:#859889;font-size:12px;font-weight:800}.empty{padding:50px 16px;text-align:center;color:#9bad9b}.empty strong{color:#fff;display:block;font-size:16px;margin:8px}.heatmap{display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));gap:7px;margin-top:18px}.heatcell{min-height:32px;border-radius:7px;background:#1c2b1e;display:grid;place-items:center;font-size:10px;color:#c2e4af;cursor:default}.heatlabel{display:flex;align-items:center;justify-content:center;font-size:10px;color:#8d9b8e}.weekday{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#aabcac}.heatlegend{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--muted);justify-content:flex-end;margin-top:14px}.heatlegend i{height:12px;width:14px;border-radius:3px}.donutwrap{display:grid;grid-template-columns:170px 1fr;gap:20px;align-items:center;margin-top:21px}.donut{border-radius:50%;width:170px;height:170px;position:relative;display:grid;place-items:center;box-shadow:inset 0 0 0 1px #46634738}.donut:after{content:"";position:absolute;width:116px;height:116px;background:#151e17;border-radius:50%}.donut-core{position:relative;z-index:1;text-align:center}.donut-core b{font-size:26px;letter-spacing:-.07em}.donut-core small{display:block;color:#96a895;font-size:10px;margin-top:3px}.legend-row{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12px;margin:12px 0}.legend-row i{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:7px}.legend-row b{font-weight:850}\n.address-card{padding:23px;background:linear-gradient(135deg,#17251b,#121a15);border:1px solid #2b3c2e;border-radius:17px;cursor:pointer;transition:all .18s}.address-card:hover{border-color:#83b05f;transform:translateY(-2px)}.address-card.selected{border-color:var(--green);background:#1a3020}.addr-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.addr-heading .bigicon{width:39px;height:39px;background:#304633;color:var(--green);display:grid;place-items:center;border-radius:11px}.addr-val{font-size:29px;font-weight:880;letter-spacing:-.06em;margin-top:25px}.addr-stats{display:flex;gap:16px;color:#a5baa7;margin-top:15px;font-size:11px}.address-table{width:100%;border-collapse:collapse;margin-top:12px}.address-table th{text-align:left;text-transform:uppercase;color:#819789;font-size:10px;letter-spacing:.1em;padding:12px 8px;border-bottom:1px solid #344337}.address-table td{font-size:12px;padding:16px 8px;border-bottom:1px solid #29382c}.address-table tr:last-child td{border-bottom:none}.address-table tbody tr{cursor:pointer}.address-table tbody tr:hover{background:#223325}.address-table .right{text-align:right}.address-table strong{font-weight:850}\n.figure{font-size:clamp(38px,4.3vw,60px);font-weight:900;letter-spacing:-.08em;line-height:1.1}.info-banner{border:1px solid #3c523b;background:#1a2c1d;border-radius:13px;padding:14px 17px;color:#bbd5b9;font-size:12px;line-height:1.7}.info-banner b{color:#e7f6e3}.barrow{display:grid;grid-template-columns:110px 1fr 92px;align-items:center;gap:14px;margin:15px 0}.barrow .label{font-size:11px;color:#a6b9a7}.barrow .value{font-size:12px;text-align:right;font-weight:800}.bartrack{background:#27372b;border-radius:8px;height:10px;overflow:hidden}.barfill{height:100%;border-radius:8px;background:linear-gradient(90deg,#629b47,var(--green))}.del-stat{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid #2a3b2e}.del-stat:last-child{border:0}.del-stat b{font-size:21px;letter-spacing:-.045em}.del-stat span{font-size:11px;color:#829a86}.badge-icon{display:grid;place-items:center;background:#27412b;border-radius:12px;color:var(--green);width:43px;height:43px;flex-shrink:0}\n.orders-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.search{background:#142018;border:1px solid #334637;color:#f5faf4;border-radius:10px;padding:12px 14px;width:min(420px,100%);min-width:160px;flex:1;outline:none}.search::placeholder{color:#78917b}.orders-controls select{background:#142018;color:#eaf6e8;border:1px solid #344637;border-radius:10px;padding:12px;font-size:12px}.tablewrap{overflow:auto;border:1px solid #2b3c30;border-radius:17px;background:#121b15}.orders-table{width:100%;border-collapse:collapse;min-width:760px}.orders-table th{background:#1a291e;color:#8fa991;font-size:10px;letter-spacing:.12em;text-align:left;text-transform:uppercase;padding:16px 19px;white-space:nowrap}.orders-table td{padding:15px 19px;border-bottom:1px solid #27382c;font-size:12px;color:#c8d9c7;white-space:nowrap}.orders-table tbody tr{cursor:pointer}.orders-table tbody tr:hover{background:#203024}.orders-table tr:last-child td{border:0}.orders-table td strong{color:#f6fff2;font-size:13px}.status-dot{width:7px;height:7px;background:var(--green);border-radius:50%;display:inline-block;margin-right:7px}.status-dot.cancel{background:var(--red)}.pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin:20px}.pagination span{font-size:12px;color:#91a892}\n.wrapped-hero{background:radial-gradient(ellipse at 90% 0,#b6fa4440,transparent 40%),linear-gradient(110deg,#1b3b21,#101c14);border:1px solid #567448;border-radius:25px;padding:35px 36px;min-height:250px}.wrapped-hero h1{font-size:clamp(37px,4.5vw,68px);font-weight:950;line-height:1;letter-spacing:-.08em;margin:19px 0}.wrapped-hero h1 span{color:var(--green)}.wrap-card{min-height:190px;display:flex;flex-direction:column;justify-content:space-between}.wrap-card .emoji{font-size:29px}.wrap-card h3{font-size:23px;line-height:1.12;letter-spacing:-.055em;margin:15px 0 4px}.wrap-card p{font-size:12px;color:#a2b5a4;line-height:1.65;margin:0}.wrap-card .super{color:var(--green)}\n.modal-bg{position:fixed;inset:0;background:#040704ce;z-index:40;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px)}.modal{background:#151f18;border:1px solid #466349;border-radius:22px;width:min(610px,100%);max-height:min(90vh,830px);overflow:auto;padding:26px 27px;box-shadow:0 25px 100px #000c}.modal-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.xbtn{border:1px solid #415844;background:#243328;color:white;border-radius:10px;height:35px;width:35px;font-size:20px}.detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:20px 0}.detail-box{border:1px solid #324638;background:#1b2920;border-radius:11px;padding:12px}.detail-box small{color:#89a28e;display:block;font-size:10px;margin-bottom:6px}.detail-box b{font-size:16px;font-weight:850}.modal-products{max-height:285px;overflow:auto}.modal-bottom{border-top:1px solid #344639;margin-top:12px;padding-top:14px;font-size:11px;line-height:1.6;color:#93ad98}.tooltip{position:fixed;z-index:100;background:#edfce4;color:#162618;padding:8px 11px;border-radius:8px;pointer-events:none;font-size:11px;font-weight:800;box-shadow:0 7px 22px #0006;transform:translate(12px,-115%);max-width:220px;display:none}.footer{text-align:center;font-size:11px;color:#687e6d;border-top:1px solid #24362a;padding:23px 0 0;margin-top:42px}.sparkline{width:100%;height:65px;margin-top:9px}\n@media(max-width:1190px){.sidebar{width:202px}.main{margin-left:202px;padding:26px 25px 55px}.hero{grid-template-columns:1fr}.hero-side{grid-template-columns:repeat(4,1fr)}.stat-box{padding:16px 13px}.stat-box .icon-circle{margin-bottom:14px}.split{grid-template-columns:1fr 1fr}.donutwrap{grid-template-columns:140px 1fr}.donut{width:140px;height:140px}.donut:after{width:98px;height:98px}}\n@media(max-width:900px){.sidebar{position:static;width:auto;height:auto;padding:14px 20px 12px;border-right:0;border-bottom:1px solid #2a3e2d;overflow:visible}.brand{margin:1px 0 15px}.brand-icon{width:34px;height:34px}.brand-title{font-size:17px}.brand-caption{font-size:9px}.nav{flex-direction:row;overflow-x:auto;gap:5px;padding-bottom:2px}.nav button{width:auto;white-space:nowrap;padding:10px 11px;font-size:12px}.nav button.active:before{display:none}.side-label,.side-foot{display:none}.main{margin-left:0;padding:24px 20px}.top{margin-bottom:22px}.split{grid-template-columns:1fr}.hero-side{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(2,minmax(0,1fr))}.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:620px){.main{padding:19px 13px}.top{flex-wrap:wrap}.top-right{width:100%;justify-content:space-between}.filters{gap:7px}.filterwrap{flex:1}.filterwrap select{max-width:145px}.filterhint{width:100%;margin:0}.hero-main{padding:27px 24px;min-height:265px}.hero-num{font-size:51px}.hero-side{grid-template-columns:repeat(2,minmax(0,1fr))}.stat-box .big{font-size:28px}.g2,.g3{grid-template-columns:1fr}.grid{gap:12px}.card{padding:18px}.section-head h2{font-size:20px}.donutwrap{grid-template-columns:130px 1fr;gap:10px}.donut{width:130px;height:130px}.heatmap{gap:4px;grid-template-columns:40px repeat(7,minmax(0,1fr))}.heatcell{min-height:27px}.wrap-card{min-height:165px}.modal{padding:20px}.hero-rail{gap:15px}}\n'.replace(/:root/g, ":host").replace(/html\{/g, ":host{").replace(/body:before/g, ".shell:before").replace(/body\{/g, ".shell{") + `
 :host{all:initial;font-family:Inter,ui-sans-serif,Arial,sans-serif;color:var(--white);font-size:14px}*{box-sizing:border-box}.shell{position:fixed;inset:0;z-index:2147483646;overflow:auto;background:var(--bg);text-align:left}.sidebar{z-index:2}.sw-launcher{position:fixed;bottom:24px;right:24px;z-index:2147483645;border:1px solid #d0ff97;background:#b9f66b;color:#10200f;border-radius:16px;padding:16px 22px;font:bold 15px Arial;box-shadow:0 8px 35px #0005}.sw-launcher:hover{background:#d5ffab}.progress{margin:0 0 24px;padding:18px;border:1px solid var(--stroke2);border-radius:16px;background:#121a16}.progress p{line-height:1.6;margin:8px 0}.actions{display:flex;gap:8px;flex-wrap:wrap}.scrollchart{overflow:auto;margin-top:20px}.scrollchart svg{display:block;width:100%;height:245px}.stack{display:grid;gap:18px}.section-head h1{font-size:32px;letter-spacing:-.05em;margin:0}label{line-height:1.6}input,select{accent-color:var(--green)}.settings-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}.settings-row select{background:var(--panel2);color:var(--white);padding:10px;border:1px solid var(--stroke2);border-radius:8px}.heat-grid{display:grid;grid-template-columns:34px repeat(24,minmax(18px,1fr));gap:3px;min-width:640px}.heat-grid span{height:24px;display:grid;place-items:center;border-radius:4px;font-size:9px}.heat-grid .heatlabel{background:none}.table-button{color:var(--green);background:none;border:0;text-align:left;padding:4px;white-space:normal}.warning{color:var(--gold)}.ranklabel{white-space:normal}.hero{margin:12px 0 22px}.hero-num{overflow-wrap:anywhere}.details-lines{list-style:none;padding:0}.details-lines li{padding:12px 0;border-bottom:1px solid var(--stroke)}progress{width:100%;accent-color:var(--green)}.notice{color:var(--gold);line-height:1.6}.modal-bg{z-index:5}.main:focus{outline:none}.page{min-height:300px}.brand{margin-bottom:30px}.hero-rail{flex-wrap:wrap}.footer{line-height:1.7}button{font-family:inherit}button:focus-visible{outline:2px solid var(--green);outline-offset:3px}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}`;
      this.shadow.append(style, this.launcher, this.root);
      this.launcher.className = "sw-launcher";
      this.launcher.textContent = "\u2726 \u041C\u043E\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430";
      this.launcher.onclick = () => void this.open();
      this.root.addEventListener("click", (e) => void this.click(e));
      this.root.addEventListener("change", (e) => void this.change(e));
      this.shadow.addEventListener("keydown", (e) => {
        const k = e;
        if (k.key === "Escape") {
          if (this.shadow.querySelector(".modal-bg")) this.closeModal();
          else this.close();
        }
        if (k.key === "Tab" && this.opened) {
          const area = this.shadow.querySelector(".modal") ?? this.root;
          const all = [...area.querySelectorAll('button,input,select,[tabindex="0"]')].filter((v) => v.offsetParent !== null);
          const first = all[0], last = all.at(-1);
          if (k.shiftKey && this.shadow.activeElement === first) {
            k.preventDefault();
            last?.focus();
          } else if (!k.shiftKey && this.shadow.activeElement === last) {
            k.preventDefault();
            first?.focus();
          }
        }
      });
    }
    actions;
    host = document.createElement("div");
    shadow = this.host.attachShadow({ mode: "open" });
    root = document.createElement("div");
    launcher = document.createElement("button");
    data = [];
    preferences = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, privacy: true, images: false };
    status = null;
    page = 0;
    year = "";
    address = "";
    query = "";
    sort = "quantity";
    statusFilter = "";
    historyPage = 0;
    opened = false;
    notice = "";
    previousFocus = null;
    pendingContent = false;
    mount() {
      document.body.append(this.host);
    }
    async refresh(force = false) {
      const [data, status, preferences] = await Promise.all([orders(), job(), settings()]);
      const changed = JSON.stringify(data) !== JSON.stringify(this.data) || JSON.stringify(preferences) !== JSON.stringify(this.preferences);
      this.data = data;
      this.status = status;
      this.preferences = preferences;
      if (!this.opened) return;
      if (!this.root.querySelector(".shell") || force) {
        this.render();
        return;
      }
      this.pendingContent = this.pendingContent || changed;
      const editing = this.shadow.activeElement?.matches("input,select");
      if (this.pendingContent && !editing && !this.shadow.querySelector(".modal-bg") && !["running", "waiting"].includes(status.state)) {
        this.render();
        return;
      }
      this.updateProgress();
    }
    updateProgress() {
      const text = this.root.querySelector("[data-status]");
      if (text && text.textContent !== this.status?.message) text.textContent = this.status?.message ?? "\u0413\u043E\u0442\u043E\u0432 \u043A \u0441\u0431\u043E\u0440\u0443";
      const count = this.root.querySelector("[data-count]");
      if (count) count.textContent = `${this.data.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432`;
      const progress = this.root.querySelector("progress");
      if (progress) {
        progress.max = Math.max(1, this.status?.total ?? 0);
        progress.value = this.status?.done ?? 0;
      }
      const preview = this.root.querySelector('[data-action="view"]');
      if (preview) preview.hidden = !this.pendingContent;
    }
    async open() {
      this.opened = true;
      this.previousFocus = document.activeElement;
      await this.refresh(true);
      this.launcher.hidden = true;
      this.shadow.querySelector(".main")?.focus({ preventScroll: true });
    }
    close() {
      this.opened = false;
      this.root.replaceChildren();
      this.launcher.hidden = false;
      this.previousFocus?.focus();
    }
    label(o) {
      const index = [...new Set(this.data.map(addressKey))].indexOf(addressKey(o)) + 1;
      return this.preferences.privacy ? `\u0410\u0434\u0440\u0435\u0441 ${index}` : [o.address.city, o.address.street, o.address.house].filter(Boolean).join(", ") || "\u0410\u0434\u0440\u0435\u0441 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D";
    }
    filtered() {
      return this.data.filter((o) => (!this.year || parts(o.date, this.preferences.timezone).year === this.year) && (!this.address || addressKey(o) === this.address));
    }
    render() {
      const scroll = this.root.querySelector(".shell")?.scrollTop ?? 0;
      const focused = this.shadow.activeElement;
      const filter = focused?.dataset?.filter;
      const selection = focused?.tagName === "INPUT" && focused.type === "text" ? [focused.selectionStart, focused.selectionEnd] : null;
      this.pendingContent = false;
      const filtered = this.filtered(), a = analytics(filtered, this.preferences.timezone), all = analytics(this.data, this.preferences.timezone);
      const years = [...new Set(this.data.map((o) => parts(o.date, this.preferences.timezone).year))].sort().reverse();
      this.root.innerHTML = `<div class="shell" role="dialog" aria-modal="true" aria-label="Samokat Wrapped"><aside class="sidebar"><div class="brand"><div class="brand-icon">\u2726</div><div><div class="brand-title">samokat</div><div class="brand-caption">WRAPPED 2.0</div></div></div><div class="side-label">\u0412\u0430\u0448\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u044F</div><nav class="nav" aria-label="\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0438">${pages.map((p, i) => `<button data-page="${i}" class="${i === this.page ? "active" : ""}" ${i === this.page ? 'aria-current="page"' : ""}><span>${icons[i]}</span>${p}</button>`).join("")}</nav><div class="side-foot"><div class="side-mini"><span>\u0422\u041E\u041B\u042C\u041A\u041E \u0412 \u042D\u0422\u041E\u041C \u0411\u0420\u0410\u0423\u0417\u0415\u0420\u0415</span><b>\u0412\u0441\u0451 \u043E \u0432\u0430\u0448\u0438\u0445 \u0437\u0430\u043A\u0430\u0437\u0430\u0445</b><p>\u0411\u0435\u0437 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u0432, \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438 \u0438 \u0442\u0435\u043B\u0435\u043C\u0435\u0442\u0440\u0438\u0438.</p></div></div></aside><main class="main" tabindex="-1"><header class="top"><div><div class="eyebrow">YOUR EVERYDAY, UNWRAPPED</div><div class="top-sub">\u041B\u0438\u0447\u043D\u0430\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0445 \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A</div></div><div class="top-right"><span class="pill"><i class="live-dot"></i>\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435</span><button class="ghost-btn" data-action="close" aria-label="\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443">\u0417\u0430\u043A\u0440\u044B\u0442\u044C \xD7</button></div></header><section class="progress" aria-label="\u0421\u0431\u043E\u0440 \u0437\u0430\u043A\u0430\u0437\u043E\u0432"><div class="card-line"><b>\u0412\u0430\u0448\u0430 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430</b><span class="tag" data-count>${this.data.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432</span></div><p role="status" data-status aria-live="polite" aria-atomic="true">${escape(this.status?.message ?? "\u0413\u043E\u0442\u043E\u0432 \u043A \u0441\u0431\u043E\u0440\u0443")}</p><progress value="${this.status?.done ?? 0}" max="${Math.max(1, this.status?.total ?? 0)}" aria-label="\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0435\u0439 \u0437\u0430\u043A\u0430\u0437\u043E\u0432"></progress><div class="actions"><button class="primary-btn" data-action="start">${this.data.length ? "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E" : "\u0421\u043E\u0431\u0440\u0430\u0442\u044C \u043C\u043E\u044E \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443"} \u2197</button><button class="outline-btn" data-action="pause">\u041F\u0430\u0443\u0437\u0430</button><button class="outline-btn" data-action="resume">\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C</button><button class="ghost-btn" data-action="import">\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043C\u043E\u0439 JSON</button><button class="ghost-btn" data-action="view" hidden>\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u043E\u0435</button></div><p class="card-sub">\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438, \u043F\u0440\u043E\u043A\u0440\u0443\u0447\u0438\u0432\u0430\u0442\u044C \u0435\u0451 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 \u043D\u0435 \u043D\u0443\u0436\u043D\u043E. \u041F\u0440\u0438 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043E\u0434\u0438\u043D \u0440\u0430\u0437 \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0438\u043B\u0438 \u0437\u0430\u043A\u0430\u0437. \u041F\u0435\u0440\u0435\u0437\u0430\u0445\u043E\u0434\u0438\u0442\u044C \u0432 \u0430\u043A\u043A\u0430\u0443\u043D\u0442 \u043D\u0443\u0436\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0441\u0430\u043C \u0421\u0430\u043C\u043E\u043A\u0430\u0442 \u043F\u0440\u043E\u0441\u0438\u0442 \u0432\u043E\u0439\u0442\u0438.</p></section>${this.notice ? `<p role="alert" class="notice">${escape(this.notice)}</p>` : ""}<div class="filters"><label class="filterwrap">\u041F\u0435\u0440\u0438\u043E\u0434 <select data-filter="year" aria-label="\u0413\u043E\u0434"><option value="">\u0417\u0430 \u0432\u0441\u0451 \u0432\u0440\u0435\u043C\u044F</option>${years.map((y) => `<option ${this.year === y ? "selected" : ""}>${escape(y)}</option>`).join("")}</select></label><label class="filterwrap">\u0410\u0434\u0440\u0435\u0441 <select data-filter="address" aria-label="\u0410\u0434\u0440\u0435\u0441"><option value="">\u0412\u0441\u0435 \u0430\u0434\u0440\u0435\u0441\u0430</option>${all.addresses.map((v) => `<option value="${escape(v.key)}" ${this.address === v.key ? "selected" : ""}>${escape(this.label(this.data.find((o) => addressKey(o) === v.key)))}</option>`).join("")}</select></label><span class="filterhint">${escape(this.preferences.timezone)} \xB7 \u0441\u0443\u043C\u043C\u044B \u0432 \u20BD</span></div><section class="page"><div class="section-head"><div><h1>${pages[this.page]}</h1><p>${filtered.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u043C \u043F\u0435\u0440\u0438\u043E\u0434\u0435</p></div></div>${!this.data.length && this.page !== 7 ? '<div class="empty"><strong>\u0412\u0430\u0448\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u0435\u0449\u0451 \u0432\u043F\u0435\u0440\u0435\u0434\u0438</strong><p>\u0421\u043E\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0438\u0437 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0438\u043B\u0438 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0439\u0442\u0435 \u0433\u043E\u0442\u043E\u0432\u044B\u0439 JSON.<br>\u0414\u0435\u043C\u043E\u043D\u0441\u0442\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0432 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 \u043D\u0435 \u043F\u043E\u0434\u043C\u0435\u0448\u0438\u0432\u0430\u044E\u0442\u0441\u044F.</p></div>' : this.content(a, filtered)}</section><footer class="footer">\u041D\u0435\u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u0440\u043E\u0435\u043A\u0442, \u043D\u0435 \u0441\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0439 \u0441 \u0421\u0430\u043C\u043E\u043A\u0430\u0442\u043E\u043C.<br>\u0412\u043E\u0437\u0432\u0440\u0430\u0442\u044B \u043D\u0435 \u0432\u044B\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F: \u0441\u0435\u043C\u0430\u043D\u0442\u0438\u043A\u0430 \u0434\u0435\u043D\u0435\u0436\u043D\u044B\u0445 \u043F\u043E\u043B\u0435\u0439 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430. \u041D\u0435\u043F\u043E\u043B\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432: ${a.incomplete}; \u0441 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u043C\u0438 \u043F\u043E\u043B\u044F\u043C\u0438: ${a.unknown}.</footer></main><input type="file" id="import-file" accept=".json,application/json" hidden></div>`;
      const shell = this.root.querySelector(".shell");
      if (shell) shell.scrollTop = scroll;
      if (filter) {
        const target = [...this.root.querySelectorAll("[data-filter]")].find((v) => v.dataset.filter === filter);
        target?.focus({ preventScroll: true });
        if (target?.tagName === "INPUT" && selection) target.setSelectionRange(selection[0], selection[1]);
      }
    }
    content(a, filtered) {
      if (this.page === 0) {
        const last = a.months.at(-1), prev = a.months.at(-2);
        const comparison = last && prev && prev.value ? `${n((last.value / prev.value - 1) * 100)}% \u043A \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u043C\u0443 \u043C\u0435\u0441\u044F\u0446\u0443 \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438 (${prev.name}); \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043C\u0435\u0441\u044F\u0446 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043D\u0435\u043F\u043E\u043B\u043D\u044B\u043C` : "\u0414\u043B\u044F \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u044F \u043D\u0443\u0436\u043D\u044B \u0434\u0432\u0430 \u043C\u0435\u0441\u044F\u0446\u0430 \u0441 \u0437\u0430\u043A\u0430\u0437\u0430\u043C\u0438";
        return `<div class="hero"><article class="hero-main"><div class="intro">\u2726 \u0412\u0430\u0448\u0438 \u043F\u043E\u0432\u0441\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u0440\u0430\u0434\u043E\u0441\u0442\u0438 \u0432 \u0446\u0438\u0444\u0440\u0430\u0445</div><div class="hero-num num">${escape(rub(a.sum))}</div><div class="hero-foot">\u041F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u043E \u043D\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B</div><div class="hero-rail"><div><b>${a.delivered}</b><small>\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E</small></div><div><b>${a.cancelled}</b><small>\u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E</small></div><div><b>${escape(rub(a.average))}</b><small>\u0441\u0440\u0435\u0434\u043D\u0438\u0439 \u0447\u0435\u043A</small></div></div></article><div class="hero-side">${card("\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u044B\u0439 \u0447\u0435\u043A", rub(a.max))}${card("\u0422\u043E\u0432\u0430\u0440\u043E\u0432 \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438", n(a.products.reduce((s, p) => s + p.quantity, 0)))}${card("\u0410\u0434\u0440\u0435\u0441\u043E\u0432", String(a.addresses.length))}${card("\u0421\u0440\u0435\u0434\u043D\u044F\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430", a.times.length ? n(a.times.reduce((s, v) => s + v, 0) / a.times.length) + " \u043C\u0438\u043D" : "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445")}</div></div><div class="stack"><article class="card"><div class="card-title">\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u043C\u0435\u0441\u044F\u0446\u0430\u043C</div><p class="card-sub">${escape(comparison)}</p>${chart(a.months, "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u043C\u0435\u0441\u044F\u0446\u0430\u043C")}</article><div class="grid g2"><article class="card"><div class="card-title">\u041D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B</div>${chart(a.months.map((v) => ({ name: v.name, value: v.cumulative })), "\u041D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B")}</article><article class="card"><div class="card-title">\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u0433\u043E\u0434\u0430\u043C</div>${chart(a.years, "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u0433\u043E\u0434\u0430\u043C")}</article></div></div>`;
      }
      if (this.page === 1) return `<div class="grid g3">${a.addresses.sort((x, y) => y.spent - x.spent).map((v) => `<button class="address-card" data-address="${escape(v.key)}" style="color:inherit;text-align:left"><div class="card-title">${escape(this.label(this.data.find((o) => addressKey(o) === v.key)))}</div><div class="addr-val">${escape(rub(v.spent))}</div><div class="addr-stats">${v.count} \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \xB7 ${n(a.sum ? v.spent / a.sum * 100 : 0)}%</div><p class="card-sub">\u0421\u0440\u0435\u0434\u043D\u0438\u0439 \u0447\u0435\u043A ${escape(rub(v.spent / v.count))} \xB7 \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0434\u043B\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u043F\u043E \u043C\u0435\u0441\u044F\u0446\u0430\u043C</p></button>`).join("")}</div>${this.address ? `<article class="card" style="margin-top:20px"><div class="card-title">\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430</div>${chart(a.months, "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u043F\u043E \u0430\u0434\u0440\u0435\u0441\u0443")}</article>` : ""}`;
      if (this.page === 2) {
        const products = a.products.filter((p) => p.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).sort((x, y) => this.sort === "spent" ? y.spent - x.spent : y.quantity - x.quantity);
        return `<div class="orders-controls"><input class="search" data-filter="query" aria-label="\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430" placeholder="\u041D\u0430\u0439\u0442\u0438 \u043B\u044E\u0431\u0438\u043C\u044B\u0439 \u0442\u043E\u0432\u0430\u0440\u2026" value="${escape(this.query)}"><select data-filter="sort" aria-label="\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432"><option value="quantity">\u041F\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0443</option><option value="spent" ${this.sort === "spent" ? "selected" : ""}>\u041F\u043E \u0437\u0430\u0442\u0440\u0430\u0442\u0430\u043C</option></select></div><div class="card">${products.map((p, i) => `<div class="prodrow"><span class="index">${i + 1}</span>${this.preferences.images && p.image ? `<img class="img-thumb" src="${escape(p.image)}" referrerpolicy="no-referrer" loading="lazy" alt="">` : ""}<div style="flex:1"><button class="table-button" data-product="${escape(p.id)}">${escape(p.name)}</button><div class="desc">${n(p.quantity)} \u0448\u0442. ${p.unknown ? "\xB7 \u0435\u0441\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438 \u0431\u0435\u0437 \u0438\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u0446\u0435\u043D\u044B" : ""}</div></div><b class="price">${escape(rub(p.spent))}</b></div>`).join("") || '<div class="empty">\u0422\u043E\u0432\u0430\u0440\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B</div>'}</div>`;
      }
      if (this.page === 3) return `<div class="grid g2">${card("discountAmount", rub(a.discount), "\u0421\u0443\u043C\u043C\u0430 \u043F\u043E\u043B\u044F \u0441\u043A\u0438\u0434\u043A\u0438 \u0432 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u0430\u0445")}${card("\u041F\u043E\u043B\u043E\u0436\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0440\u0430\u0437\u043D\u0438\u0446\u0430 price \u2212 totalPrice", rub(a.difference), "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C; \u043D\u0435 \u043F\u0440\u0438\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u043A discountAmount")}</div><p class="info-banner">\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u043C\u043E\u0433\u0443\u0442 \u043F\u0435\u0440\u0435\u0441\u0435\u043A\u0430\u0442\u044C\u0441\u044F \u0438 \u043D\u0435 \u0441\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u044E\u0442\u0441\u044F. \u0420\u0430\u0437\u043D\u0438\u0446\u0430 \u0446\u0435\u043D \u043D\u0435 \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u0441\u043A\u0438\u0434\u043A\u0443 \u043F\u043E \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0443. \u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0443\u0436\u0435 \u0432\u0445\u043E\u0434\u0438\u0442 \u0432 \u0438\u0442\u043E\u0433 \u0437\u0430\u043A\u0430\u0437\u0430 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043D\u0435 \u043F\u0440\u0438\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F.</p>`;
      if (this.page === 4) {
        const max = Math.max(1, ...a.heat.flat());
        const days = ["\u041F\u043D", "\u0412\u0442", "\u0421\u0440", "\u0427\u0442", "\u041F\u0442", "\u0421\u0431", "\u0412\u0441"];
        return `<div class="grid g3">${card("\u0421\u0440\u0435\u0434\u043D\u044F\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430", a.times.length ? n(a.times.reduce((s, v) => s + v, 0) / a.times.length) + " \u043C\u0438\u043D" : "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445")}${card("\u0421\u0430\u043C\u0430\u044F \u0431\u044B\u0441\u0442\u0440\u0430\u044F", a.times.length ? n(Math.min(...a.times)) + " \u043C\u0438\u043D" : "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445")}${card("\u0421\u0430\u043C\u0430\u044F \u0434\u043E\u043B\u0433\u0430\u044F", a.times.length ? n(Math.max(...a.times)) + " \u043C\u0438\u043D" : "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445")}</div><article class="card" style="margin-top:20px"><h2 class="card-title">\u041A\u043E\u0433\u0434\u0430 \u0432\u044B \u0437\u0430\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0435</h2><p class="card-sub">\u0414\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u043F\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \xB7 ${escape(this.preferences.timezone)}</p><div style="overflow:auto"><div class="heat-grid"><span></span>${Array.from({ length: 24 }, (_, i) => `<span class="heatlabel">${i}</span>`).join("")}${a.heat.map((row, d) => `<span class="heatlabel">${days[d]}</span>${row.map((v, h) => `<span style="background:rgba(185,246,107,${0.05 + v / max * 0.75})" title="${days[d]}, ${h}:00 \u2014 ${v} \u0437\u0430\u043A\u0430\u0437\u043E\u0432">${v || ""}</span>`).join("")}`).join("")}</div></div><p class="card-sub">\u0412\u0440\u0435\u043C\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 = deliveredDate \u2212 date. \u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0435 \u043D\u0435\u043E\u0442\u0440\u0438\u0446\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B (${a.times.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432).</p></article>`;
      }
      if (this.page === 5) {
        const q = this.query.toLowerCase(), list = filtered.filter((o) => (!this.statusFilter || o.status === this.statusFilter) && [o.id, this.label(o), ...o.lines.map((l) => l.name)].join(" ").toLowerCase().includes(q)).sort((x, y) => y.date.localeCompare(x.date));
        const maxPage = Math.max(0, Math.ceil(list.length / 50) - 1);
        this.historyPage = Math.min(this.historyPage, maxPage);
        return `<div class="orders-controls"><input class="search" data-filter="query" aria-label="\u041F\u043E\u0438\u0441\u043A \u0437\u0430\u043A\u0430\u0437\u043E\u0432" placeholder="\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430, \u0442\u043E\u0432\u0430\u0440 \u0438\u043B\u0438 \u0430\u0434\u0440\u0435\u0441\u2026" value="${escape(this.query)}"><select data-filter="status" aria-label="\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043A\u0430\u0437\u0430"><option value="">\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044B</option>${[...new Set(filtered.map((o) => o.status))].map((s) => `<option ${this.statusFilter === s ? "selected" : ""}>${escape(s)}</option>`).join("")}</select></div><div class="tablewrap"><table class="orders-table"><thead><tr><th>\u0417\u0430\u043A\u0430\u0437 / \u0434\u0430\u0442\u0430</th><th>\u0410\u0434\u0440\u0435\u0441</th><th>\u0421\u0442\u0430\u0442\u0443\u0441</th><th>\u0421\u0443\u043C\u043C\u0430</th><th>\u0421\u043E\u0441\u0442\u0430\u0432</th></tr></thead><tbody>${list.slice(this.historyPage * 50, this.historyPage * 50 + 50).map((o) => `<tr><td><button class="table-button" data-order="${escape(o.id)}">${escape(o.id)}</button><div class="tiny">${escape(this.date(o.date))}</div></td><td>${escape(this.label(o))}</td><td><span class="tag ${o.status === "DELIVERED" ? "positive" : "danger"}">${escape(o.status)}</span></td><td>${escape(o.total !== void 0 || o.amount !== void 0 ? rub(o.total ?? o.amount ?? 0) : "\u041D\u0435\u0442 \u0441\u0443\u043C\u043C\u044B")}</td><td>${o.complete ? o.lines.length + " \u043F\u043E\u0437." : "\u041D\u0435\u043F\u043E\u043B\u043D\u044B\u0439"}</td></tr>`).join("")}</tbody></table></div><div class="pagination"><button class="ghost-btn" data-action="prev" ${!this.historyPage ? "disabled" : ""}>\u2190</button><span>${this.historyPage + 1} / ${maxPage + 1} \xB7 ${list.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432</span><button class="ghost-btn" data-action="next" ${this.historyPage === maxPage ? "disabled" : ""}>\u2192</button></div>`;
      }
      if (this.page === 6) {
        const top = [...a.products].sort((x, y) => y.quantity - x.quantity)[0];
        return `<div class="wrapped-hero"><div class="eyebrow">\u0412\u0410\u0428 SAMOKAT WRAPPED</div><h1>\u041C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0435 \u0437\u0430\u043A\u0430\u0437\u044B.<br><span>\u0411\u043E\u043B\u044C\u0448\u0430\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F.</span></h1><p>${a.delivered} \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A \xB7 ${escape(rub(a.sum))} \xB7 ${a.addresses.length} \u0430\u0434\u0440\u0435\u0441\u043E\u0432</p><button class="primary-btn" data-action="card">\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043E\u0431\u0435\u0437\u043B\u0438\u0447\u0435\u043D\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 PNG \u2197</button></div><div class="grid g3" style="margin-top:18px"><article class="card wrap-card"><span class="emoji">\u2726</span><h3>\u0412\u0430\u0448 \u0444\u0430\u0432\u043E\u0440\u0438\u0442</h3><p>${top ? escape(top.name) + " \xB7 " + n(top.quantity) + " \u0448\u0442." : "\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u043E \u0442\u043E\u0432\u0430\u0440\u0430\u0445"}</p></article><article class="card wrap-card"><span class="emoji">\u25F7</span><h3>${a.times.length ? n(Math.min(...a.times)) + " \u043C\u0438\u043D\u0443\u0442" : "\u0412\u0440\u0435\u043C\u044F \u043F\u043E\u043A\u0430\u0436\u0435\u0442"}</h3><p>\u0421\u0430\u043C\u0430\u044F \u0431\u044B\u0441\u0442\u0440\u0430\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0441\u0440\u0435\u0434\u0438 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0441 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0435\u043C</p></article><article class="card wrap-card"><span class="emoji">\u2197</span><h3>${escape(rub(a.max))}</h3><p>\u0421\u0430\u043C\u044B\u0439 \u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0439 \u0437\u0430\u043A\u0430\u0437</p></article></div>`;
      }
      return `<article class="card"><h2 class="card-title">\u0414\u0430\u043D\u043D\u044B\u0435 \u043F\u043E\u0434 \u0432\u0430\u0448\u0438\u043C \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0435\u043C</h2><label class="settings-row"><input type="checkbox" data-filter="privacy" ${this.preferences.privacy ? "checked" : ""}> \u041F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C: \u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0443\u043B\u0438\u0446\u0443 \u0438 \u0434\u043E\u043C</label><label class="settings-row"><input type="checkbox" data-filter="images" ${this.preferences.images ? "checked" : ""}> \u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0443 \u0432\u043D\u0435\u0448\u043D\u0438\u0445 \u0444\u043E\u0442\u043E \u0442\u043E\u0432\u0430\u0440\u043E\u0432 (\u0437\u0430\u043F\u0440\u043E\u0441\u044B \u043A \u0445\u043E\u0441\u0442\u0430\u043C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0439)</label><label class="settings-row">\u0427\u0430\u0441\u043E\u0432\u043E\u0439 \u043F\u043E\u044F\u0441 <select data-filter="timezone" aria-label="\u0427\u0430\u0441\u043E\u0432\u043E\u0439 \u043F\u043E\u044F\u0441">${[.../* @__PURE__ */ new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, "Asia/Yekaterinburg", "Europe/Moscow", "UTC", this.preferences.timezone])].map((t) => `<option ${t === this.preferences.timezone ? "selected" : ""}>${escape(t)}</option>`).join("")}</select></label><div class="actions"><button class="outline-btn" data-action="export">\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u0430\u044F \u043A\u043E\u043F\u0438\u044F JSON</button><button class="outline-btn" data-action="anonymous">\u041E\u0431\u0435\u0437\u043B\u0438\u0447\u0435\u043D\u043D\u044B\u0439 JSON</button><button class="outline-btn" data-action="import">\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043C\u043E\u0439 JSON</button><button class="outline-btn" data-action="clear">\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0441\u0435 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435</button></div><p class="info-banner">\u0411\u0430\u0437\u0430 IndexedDB \u043F\u0440\u0438\u043D\u0430\u0434\u043B\u0435\u0436\u0438\u0442 origin samokat.ru. \u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0421\u0430\u043C\u043E\u043A\u0430\u0442\u0430 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438 \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043A \u043D\u0435\u0439 \u0434\u043E\u0441\u0442\u0443\u043F. \u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u0441\u043A\u0440\u0438\u043F\u0442\u043E\u043C \u0438 \u043D\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0443. \u041D\u0435 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0439\u0442\u0435 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0432 \u044D\u0442\u0443 \u0436\u0435 \u0431\u0430\u0437\u0443: \u043F\u0435\u0440\u0435\u0434 \u0441\u043C\u0435\u043D\u043E\u0439 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0443\u0434\u0430\u043B\u0438\u0442\u0435 \u0434\u0430\u043D\u043D\u044B\u0435.</p><p class="card-sub">\u041D\u0430\u0431\u043B\u044E\u0434\u0430\u0442\u0435\u043B\u044C fetch: ${this.actions.health() ? "\u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C window" : "\u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D \u0441\u0430\u0439\u0442\u043E\u043C; \u0437\u0430\u043F\u0440\u043E\u0441\u044B \u0438\u0434\u0443\u0442 \u0447\u0435\u0440\u0435\u0437 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0446\u0435\u043F\u043E\u0447\u043A\u0443 fetch"}. \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 API: ${this.status?.observed ? "\u0437\u0430\u043C\u0435\u0447\u0435\u043D" : "\u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u043C\u0435\u0447\u0435\u043D"}. \u0421\u0435\u043A\u0440\u0435\u0442\u044B \u0432 \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0435 \u043D\u0435 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u044E\u0442\u0441\u044F.</p></article>`;
    }
    date(value) {
      return value ? new Intl.DateTimeFormat("ru", { timeZone: this.preferences.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "\u0414\u0430\u0442\u0430 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430";
    }
    async click(event) {
      const t = event.target.closest("button");
      if (!t) return;
      try {
        if (t.dataset.page) {
          this.page = Number(t.dataset.page);
          this.query = "";
          this.render();
          this.shadow.querySelector(".main")?.focus({ preventScroll: true });
          return;
        }
        if (t.dataset.address !== void 0) {
          this.address = t.dataset.address;
          this.render();
          return;
        }
        if (t.dataset.order) {
          const o = this.data.find((o2) => o2.id === t.dataset.order);
          this.modal(`\u0417\u0430\u043A\u0430\u0437 ${o.id}`, `<p>${escape(this.date(o.date))} \xB7 ${escape(o.status)}</p><p>${escape(this.label(o))}</p><div class="detail-grid"><div class="detail-box"><small>\u0418\u0442\u043E\u0433 \u0437\u0430\u043A\u0430\u0437\u0430</small><b>${escape(rub(o.total ?? o.amount ?? 0))}</b></div><div class="detail-box"><small>discountAmount</small><b>${escape(rub(o.discount ?? 0))}</b></div></div><ul class="details-lines">${o.lines.map((l) => `<li>${escape(l.name)} <b>${n(l.quantity)} \u0448\u0442.</b> \xB7 ${l.price === void 0 ? "\u0426\u0435\u043D\u0430 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430" : escape(rub(l.price)) + " / \u0448\u0442."}</li>`).join("")}</ul><p class="card-sub">${o.complete ? "\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B" : "\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B"}. ${escape(o.warnings.join("; "))}</p>`);
          return;
        }
        if (t.dataset.product) {
          const p = t.dataset.product;
          const list = this.filtered().filter((o) => o.status === "DELIVERED" && o.lines.some((l) => l.id === p));
          this.modal(list[0]?.lines.find((l) => l.id === p)?.name ?? "\u0422\u043E\u0432\u0430\u0440", `<p>\u0412 ${list.length} \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u0430\u0445</p><ul class="details-lines">${list.map((o) => `<li>${escape(this.date(o.date))} \xB7 ${o.lines.filter((l) => l.id === p).map((l) => n(l.quantity) + " \u0448\u0442. \xD7 " + (l.price === void 0 ? "\u0446\u0435\u043D\u0430 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430" : escape(rub(l.price)))).join(", ")}</li>`).join("")}</ul>`);
          return;
        }
        const action = t.dataset.action;
        if (action === "close") {
          this.close();
          return;
        }
        if (action === "modal-close") {
          this.closeModal();
          return;
        }
        if (action === "start") await this.actions.start();
        if (action === "resume") await this.actions.resume();
        if (action === "pause") await this.actions.pause();
        if (action === "import") {
          this.shadow.querySelector("#import-file")?.click();
          return;
        }
        if (action === "clear") {
          await this.actions.clear();
          this.address = "";
          this.year = "";
          this.notice = "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u044B";
        }
        if (action === "export" || action === "anonymous") download(new Blob([backup(this.data, action === "anonymous")], { type: "application/json" }), action === "anonymous" ? "samokat-anonymous.json" : "samokat-full-details-backup.json");
        if (action === "prev") this.historyPage--;
        if (action === "next") this.historyPage++;
        if (action === "card") this.exportCard();
        await this.refresh(true);
      } catch {
        this.notice = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0441\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430 \u0438 \u0444\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445.";
        this.render();
      }
    }
    async change(event) {
      const t = event.target;
      try {
        if (t.id === "import-file") {
          const file = t.files?.[0];
          if (!file) return;
          if (file.size > 50 * 1024 * 1024) throw new Error("\u0424\u0430\u0439\u043B \u0431\u043E\u043B\u044C\u0448\u0435 50 \u041C\u0411");
          const parsed = importOrders(JSON.parse(await file.text()));
          if (!parsed.length) throw new Error("\u0412 \u0444\u0430\u0439\u043B\u0435 \u043D\u0435\u0442 \u0437\u0430\u043A\u0430\u0437\u043E\u0432");
          await this.actions.pause();
          await saveOrders(parsed);
          this.notice = `\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E ${parsed.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432`;
          await this.refresh(true);
          return;
        }
        const key = t.dataset.filter;
        if (key === "year") this.year = t.value;
        if (key === "address") this.address = t.value;
        if (key === "query") this.query = t.value;
        if (key === "sort") this.sort = t.value;
        if (key === "status") this.statusFilter = t.value;
        if (key === "timezone") this.preferences.timezone = t.value;
        if (key === "privacy") this.preferences.privacy = t.checked;
        if (key === "images") this.preferences.images = t.checked;
        if (["timezone", "privacy", "images"].includes(key ?? "")) await saveSettings(this.preferences);
        this.historyPage = 0;
        this.render();
      } catch {
        this.notice = "\u0418\u043C\u043F\u043E\u0440\u0442 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D: \u043D\u0443\u0436\u0435\u043D JSON \u0441\u043E \u0441\u043F\u0438\u0441\u043A\u043E\u043C \u0437\u0430\u043A\u0430\u0437\u043E\u0432 (orders/items/data) \u0438 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u043C\u0438 orderId. \u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B.";
        this.render();
      }
    }
    modal(title, body) {
      const el = document.createElement("div");
      el.className = "modal-bg";
      el.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${escape(title)}"><div class="modal-top"><h2 class="card-title">${escape(title)}</h2><button class="xbtn" data-action="modal-close" aria-label="\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438">\xD7</button></div>${body}</section>`;
      this.root.append(el);
      el.querySelector("button")?.focus();
    }
    closeModal() {
      this.shadow.querySelector(".modal-bg")?.remove();
      this.shadow.querySelector(".main")?.focus();
    }
    exportCard() {
      const a = analytics(this.filtered(), this.preferences.timezone), canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const c = canvas.getContext("2d");
      c.fillStyle = "#080c0b";
      c.fillRect(0, 0, 1200, 800);
      c.fillStyle = "#b9f66b";
      c.font = "bold 28px Arial";
      c.fillText("SAMOKAT WRAPPED", 70, 100);
      c.fillStyle = "#f0f6ef";
      c.font = "bold 65px Arial";
      c.fillText("\u041C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0435 \u0437\u0430\u043A\u0430\u0437\u044B.", 70, 230);
      c.fillText("\u0411\u043E\u043B\u044C\u0448\u0430\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F.", 70, 310);
      c.fillStyle = "#b9f66b";
      c.font = "bold 90px Arial";
      c.fillText(rub(a.sum), 70, 480);
      c.fillStyle = "#c1d4bb";
      c.font = "32px Arial";
      c.fillText(`${a.delivered} \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A \xB7 \u0441\u0440\u0435\u0434\u043D\u0438\u0439 \u0447\u0435\u043A ${rub(a.average)}`, 70, 580);
      canvas.toBlob((blob) => {
        if (blob) download(blob, "samokat-wrapped.png");
      });
    }
  };

  // src/main.ts
  if (location.origin === "https://samokat.ru" && window.top === window.self) {
    let fail2 = function() {
      active = false;
      pendingSession = null;
      clearTimeout(scheduled);
      observer.disable();
      collector.forget();
    }, mount2 = function() {
      ui.mount();
      void (async () => {
        const j = await job();
        if (["running", "waiting"].includes(j.state)) {
          j.state = "paused";
          j.message = "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C\xBB; \u0434\u043E\u0441\u0442\u0443\u043F \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043B\u0443\u0447\u0435\u043D \u0437\u0430\u043D\u043E\u0432\u043E, \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D.";
          await saveJob(j);
        }
        await ui.refresh();
      })();
    };
    fail = fail2, mount = mount2;
    let active = false, locked = false, ticking = false;
    let scheduled;
    let pendingSession = null;
    const observer = installObserver((v) => {
      if (!active) return;
      pendingSession = v;
      collector.headers = v.headers;
      collector.showcase = v.showcase || collector.showcase;
      if (!ticking && !locked) void tick().catch(fail2);
    });
    const collector = new Collector(db_exports, observer.request);
    const exclusive = async (fn) => {
      if (locked) return;
      locked = true;
      try {
        await fn();
      } finally {
        locked = false;
      }
    };
    async function stop(keepObservation = false) {
      active = false;
      pendingSession = null;
      clearTimeout(scheduled);
      if (!keepObservation) observer.disable();
      collector.forget();
      const j = await job();
      j.state = "paused";
      j.message = "\u0421\u0431\u043E\u0440 \u043D\u0430 \u043F\u0430\u0443\u0437\u0435. \u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u043A\u0430\u0437\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B.";
      await saveJob(j);
      while (collector.busy || ticking) await new Promise((r) => setTimeout(r, 20));
    }
    async function begin(restart) {
      if (!restart && active) return;
      observer.enable();
      let session = observer.snapshot();
      if (restart) await stop(true);
      const j = restart ? initialJob() : await job();
      if (!restart && j.state === "done") {
        j.message = "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0443\u0436\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430. \u0414\u043B\u044F \u043D\u043E\u0432\u044B\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E\xBB.";
        await saveJob(j);
        return;
      }
      j.state = "running";
      j.attempts = 0;
      j.nextAt = 0;
      j.observed = !!session;
      j.message = session ? "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C \u0434\u043E\u0441\u0442\u0443\u043F \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \xB7 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u043C \u0437\u0430\u043A\u0430\u0437\u044B" : "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C \u0434\u043E\u0441\u0442\u0443\u043F \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B";
      await saveJob(j);
      session = observer.snapshot() ?? session;
      active = true;
      collector.headers = session?.headers ?? {};
      collector.showcase = session?.showcase ?? "";
      void tick().catch(fail2);
    }
    const ui = new Dashboard({
      start: () => exclusive(() => begin(true)),
      resume: () => exclusive(() => begin(false)),
      pause: () => exclusive(stop),
      clear: () => exclusive(async () => {
        await stop();
        await clear();
      }),
      health: observer.healthy
    });
    async function tick() {
      if (!active || ticking) return;
      ticking = true;
      clearTimeout(scheduled);
      try {
        if (pendingSession) {
          const session = pendingSession;
          pendingSession = null;
          const before = await job();
          if (!active) return;
          collector.headers = session.headers;
          collector.showcase = session.showcase || collector.showcase;
          if (before.state === "waiting") {
            before.state = "running";
            before.nextAt = 0;
            before.observed = true;
            before.message = "\u041F\u043E\u043B\u0443\u0447\u0435\u043D \u0441\u0432\u0435\u0436\u0438\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u0441\u0430\u0439\u0442\u0430 \xB7 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u043C \u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u043E\u0433\u043E \u043C\u0435\u0441\u0442\u0430";
            await saveJob(before);
          }
        }
        await collector.step();
        const j = await job();
        if (["done", "error"].includes(j.state)) {
          active = false;
          pendingSession = null;
          observer.disable();
          collector.forget();
        }
        if (j.state === "waiting" && !pendingSession) observer.clear();
        await ui.refresh();
        if (active && (j.state === "running" || pendingSession)) scheduled = setTimeout(() => void tick().catch(fail2), j.state === "running" ? Math.max(100, j.nextAt - Date.now()) : 100);
      } finally {
        ticking = false;
      }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount2, { once: true });
    else mount2();
    window.addEventListener("pagehide", fail2);
  }
  var fail;
  var mount;
})();

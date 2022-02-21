(function () {
  'use strict';

  const equalFn = (a, b) => a === b;
  const $PROXY = Symbol("solid-proxy");
  const signalOptions = {
    equals: equalFn
  };
  let runEffects = runQueue;
  const NOTPENDING = {};
  const STALE = 1;
  const PENDING = 2;
  const UNOWNED = {
    owned: null,
    cleanups: null,
    context: null,
    owner: null
  };
  var Owner = null;
  let Transition = null;
  let Listener = null;
  let Pending = null;
  let Updates = null;
  let Effects = null;
  let ExecCount = 0;
  function createRoot(fn, detachedOwner) {
    detachedOwner && (Owner = detachedOwner);
    const listener = Listener,
          owner = Owner,
          root = fn.length === 0 && !false ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: null,
      owner,
      attached: !!detachedOwner
    };
    Owner = root;
    Listener = null;
    let result;
    try {
      runUpdates(() => result = fn(() => cleanNode(root)), true);
    } finally {
      Listener = listener;
      Owner = owner;
    }
    return result;
  }
  function createSignal(value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const s = {
      value,
      observers: null,
      observerSlots: null,
      pending: NOTPENDING,
      comparator: options.equals || undefined
    };
    return [readSignal.bind(s), value => {
      if (typeof value === "function") {
        value = value(s.pending !== NOTPENDING ? s.pending : s.value);
      }
      return writeSignal(s, value);
    }];
  }
  function createRenderEffect(fn, value, options) {
    updateComputation(createComputation(fn, value, false));
  }
  function createEffect(fn, value, options) {
    runEffects = runUserEffects;
    const c = createComputation(fn, value, false);
    c.user = true;
    Effects && Effects.push(c);
  }
  function createMemo(fn, value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const c = createComputation(fn, value, true);
    c.pending = NOTPENDING;
    c.observers = null;
    c.observerSlots = null;
    c.state = 0;
    c.comparator = options.equals || undefined;
    updateComputation(c);
    return readSignal.bind(c);
  }
  function batch(fn) {
    if (Pending) return fn();
    let result;
    const q = Pending = [];
    try {
      result = fn();
    } finally {
      Pending = null;
    }
    runUpdates(() => {
      for (let i = 0; i < q.length; i += 1) {
        const data = q[i];
        if (data.pending !== NOTPENDING) {
          const pending = data.pending;
          data.pending = NOTPENDING;
          writeSignal(data, pending);
        }
      }
    }, false);
    return result;
  }
  function untrack(fn) {
    let result,
        listener = Listener;
    Listener = null;
    result = fn();
    Listener = listener;
    return result;
  }
  function onCleanup(fn) {
    if (Owner === null) ;else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
    return fn;
  }
  function getListener() {
    return Listener;
  }
  function readSignal() {
    if (this.state && this.sources) {
      const updates = Updates;
      Updates = null;
      this.state === STALE ? updateComputation(this) : lookDownstream(this);
      Updates = updates;
    }
    if (Listener) {
      const sSlot = this.observers ? this.observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [this];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(this);
        Listener.sourceSlots.push(sSlot);
      }
      if (!this.observers) {
        this.observers = [Listener];
        this.observerSlots = [Listener.sources.length - 1];
      } else {
        this.observers.push(Listener);
        this.observerSlots.push(Listener.sources.length - 1);
      }
    }
    return this.value;
  }
  function writeSignal(node, value, isComp) {
    if (node.comparator) {
      if (node.comparator(node.value, value)) return value;
    }
    if (Pending) {
      if (node.pending === NOTPENDING) Pending.push(node);
      node.pending = value;
      return value;
    }
    node.value = value;
    if (node.observers && (!Updates || node.observers.length)) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          if (Transition && Transition.running && Transition.disposed.has(o)) ;
          if (o.observers && o.state !== PENDING) markUpstream(o);
          o.state = STALE;
          if (o.pure) Updates.push(o);else Effects.push(o);
        }
        if (Updates.length > 10e5) {
          Updates = [];
          if (false) ;
          throw new Error();
        }
      }, false);
    }
    return value;
  }
  function updateComputation(node) {
    if (!node.fn) return;
    cleanNode(node);
    const owner = Owner,
          listener = Listener,
          time = ExecCount;
    Listener = Owner = node;
    runComputation(node, node.value, time);
    Listener = listener;
    Owner = owner;
  }
  function runComputation(node, value, time) {
    let nextValue;
    try {
      nextValue = node.fn(value);
    } catch (err) {
      handleError(err);
    }
    if (!node.updatedAt || node.updatedAt <= time) {
      if (node.observers && node.observers.length) {
        writeSignal(node, nextValue);
      } else node.value = nextValue;
      node.updatedAt = time;
    }
  }
  function createComputation(fn, init, pure, options) {
    const c = {
      fn,
      state: STALE,
      updatedAt: null,
      owned: null,
      sources: null,
      sourceSlots: null,
      cleanups: null,
      value: init,
      owner: Owner,
      context: null,
      pure
    };
    if (Owner === null) ;else if (Owner !== UNOWNED) {
      {
        if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
      }
    }
    return c;
  }
  function runTop(node) {
    let top = node.state === STALE && node,
        pending;
    if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
    const runningTransition = Transition ;
    while ((node.fn || runningTransition ) && (node = node.owner)) {
      if (node.state === PENDING) pending = node;else if (node.state === STALE) {
        top = node;
        pending = undefined;
      }
    }
    if (pending) {
      const updates = Updates;
      Updates = null;
      lookDownstream(pending);
      Updates = updates;
      if (!top || top.state !== STALE) return;
    }
    top && updateComputation(top);
  }
  function runUpdates(fn, init) {
    if (Updates) return fn();
    let wait = false;
    if (!init) Updates = [];
    if (Effects) wait = true;else Effects = [];
    ExecCount++;
    try {
      fn();
    } catch (err) {
      handleError(err);
    } finally {
      completeUpdates(wait);
    }
  }
  function completeUpdates(wait) {
    if (Updates) {
      runQueue(Updates);
      Updates = null;
    }
    if (wait) return;
    if (Effects.length) batch(() => {
      runEffects(Effects);
      Effects = null;
    });else {
      Effects = null;
    }
  }
  function runQueue(queue) {
    for (let i = 0; i < queue.length; i++) runTop(queue[i]);
  }
  function runUserEffects(queue) {
    let i,
        userLength = 0;
    for (i = 0; i < queue.length; i++) {
      const e = queue[i];
      if (!e.user) runTop(e);else queue[userLength++] = e;
    }
    const resume = queue.length;
    for (i = 0; i < userLength; i++) runTop(queue[i]);
    for (i = resume; i < queue.length; i++) runTop(queue[i]);
  }
  function lookDownstream(node) {
    node.state = 0;
    for (let i = 0; i < node.sources.length; i += 1) {
      const source = node.sources[i];
      if (source.sources) {
        if (source.state === STALE) runTop(source);else if (source.state === PENDING) lookDownstream(source);
      }
    }
  }
  function markUpstream(node) {
    for (let i = 0; i < node.observers.length; i += 1) {
      const o = node.observers[i];
      if (!o.state) {
        o.state = PENDING;
        o.observers && markUpstream(o);
      }
    }
  }
  function cleanNode(node) {
    let i;
    if (node.sources) {
      while (node.sources.length) {
        const source = node.sources.pop(),
              index = node.sourceSlots.pop(),
              obs = source.observers;
        if (obs && obs.length) {
          const n = obs.pop(),
                s = source.observerSlots.pop();
          if (index < obs.length) {
            n.sourceSlots[s] = index;
            obs[index] = n;
            source.observerSlots[index] = s;
          }
        }
      }
    }
    if (node.owned) {
      for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
      node.owned = null;
    }
    if (node.cleanups) {
      for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
      node.cleanups = null;
    }
    node.state = 0;
    node.context = null;
  }
  function handleError(err) {
    throw err;
  }

  const FALLBACK = Symbol("fallback");
  function dispose(d) {
    for (let i = 0; i < d.length; i++) d[i]();
  }
  function mapArray(list, mapFn, options = {}) {
    let items = [],
        mapped = [],
        disposers = [],
        len = 0,
        indexes = mapFn.length > 1 ? [] : null,
        ctx = Owner;
    onCleanup(() => dispose(disposers));
    return () => {
      let newItems = list() || [],
          i,
          j;
      return untrack(() => {
        let newLen = newItems.length,
            newIndices,
            newIndicesNext,
            temp,
            tempdisposers,
            tempIndexes,
            start,
            end,
            newEnd,
            item;
        if (newLen === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            indexes && (indexes = []);
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot(disposer => {
              disposers[0] = disposer;
              return options.fallback();
            }, ctx);
            len = 1;
          }
        }
        else if (len === 0) {
            mapped = new Array(newLen);
            for (j = 0; j < newLen; j++) {
              items[j] = newItems[j];
              mapped[j] = createRoot(mapper, ctx);
            }
            len = newLen;
          } else {
            temp = new Array(newLen);
            tempdisposers = new Array(newLen);
            indexes && (tempIndexes = new Array(newLen));
            for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
            for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
              temp[newEnd] = mapped[end];
              tempdisposers[newEnd] = disposers[end];
              indexes && (tempIndexes[newEnd] = indexes[end]);
            }
            newIndices = new Map();
            newIndicesNext = new Array(newEnd + 1);
            for (j = newEnd; j >= start; j--) {
              item = newItems[j];
              i = newIndices.get(item);
              newIndicesNext[j] = i === undefined ? -1 : i;
              newIndices.set(item, j);
            }
            for (i = start; i <= end; i++) {
              item = items[i];
              j = newIndices.get(item);
              if (j !== undefined && j !== -1) {
                temp[j] = mapped[i];
                tempdisposers[j] = disposers[i];
                indexes && (tempIndexes[j] = indexes[i]);
                j = newIndicesNext[j];
                newIndices.set(item, j);
              } else disposers[i]();
            }
            for (j = start; j < newLen; j++) {
              if (j in temp) {
                mapped[j] = temp[j];
                disposers[j] = tempdisposers[j];
                if (indexes) {
                  indexes[j] = tempIndexes[j];
                  indexes[j](j);
                }
              } else mapped[j] = createRoot(mapper, ctx);
            }
            mapped = mapped.slice(0, len = newLen);
            items = newItems.slice(0);
          }
        return mapped;
      });
      function mapper(disposer) {
        disposers[j] = disposer;
        if (indexes) {
          const [s, set] = createSignal(j);
          indexes[j] = set;
          return mapFn(newItems[j], s);
        }
        return mapFn(newItems[j]);
      }
    };
  }

  function createComponent(Comp, props) {
    return untrack(() => Comp(props));
  }

  function For(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(mapArray(() => props.each, props.children, fallback ? fallback : undefined));
  }
  function Show(props) {
    let strictEqual = false;
    const condition = createMemo(() => props.when, undefined, {
      equals: (a, b) => strictEqual ? a === b : !a === !b
    });
    return createMemo(() => {
      const c = condition();
      if (c) {
        const child = props.children;
        return (strictEqual = typeof child === "function" && child.length > 0) ? untrack(() => child(c)) : child;
      }
      return props.fallback;
    });
  }

  function reconcileArrays(parentNode, a, b) {
    let bLength = b.length,
        aEnd = a.length,
        bEnd = bLength,
        aStart = 0,
        bStart = 0,
        after = a[aEnd - 1].nextSibling,
        map = null;
    while (aStart < aEnd || bStart < bEnd) {
      if (a[aStart] === b[bStart]) {
        aStart++;
        bStart++;
        continue;
      }
      while (a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--;
        bEnd--;
      }
      if (aEnd === aStart) {
        const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
        while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) parentNode.removeChild(a[aStart]);
          aStart++;
        }
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const node = a[--aEnd].nextSibling;
        parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
        parentNode.insertBefore(b[--bEnd], node);
        a[aEnd] = b[bEnd];
      } else {
        if (!map) {
          map = new Map();
          let i = bStart;
          while (i < bEnd) map.set(b[i], i++);
        }
        const index = map.get(a[aStart]);
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart,
                sequence = 1,
                t;
            while (++i < aEnd && i < bEnd) {
              if ((t = map.get(a[i])) == null || t !== index + sequence) break;
              sequence++;
            }
            if (sequence > index - bStart) {
              const node = a[aStart];
              while (bStart < index) parentNode.insertBefore(b[bStart++], node);
            } else parentNode.replaceChild(b[bStart++], a[aStart++]);
          } else aStart++;
        } else parentNode.removeChild(a[aStart++]);
      }
    }
  }

  const $$EVENTS = Symbol("delegated-events");
  function render(code, element, init) {
    let disposer;
    createRoot(dispose => {
      disposer = dispose;
      insert(element, code(), element.firstChild ? null : undefined, init);
    });
    return () => {
      disposer();
      element.textContent = "";
    };
  }
  function template(html, check, isSVG) {
    const t = document.createElement("template");
    t.innerHTML = html;
    let node = t.content.firstChild;
    if (isSVG) node = node.firstChild;
    return node;
  }
  function delegateEvents(eventNames, document = window.document) {
    const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
    for (let i = 0, l = eventNames.length; i < l; i++) {
      const name = eventNames[i];
      if (!e.has(name)) {
        e.add(name);
        document.addEventListener(name, eventHandler);
      }
    }
  }
  function insert(parent, accessor, marker, initial) {
    if (marker !== undefined && !initial) initial = [];
    if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
    createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
  }
  function eventHandler(e) {
    const key = `$$${e.type}`;
    let node = e.composedPath && e.composedPath()[0] || e.target;
    if (e.target !== node) {
      Object.defineProperty(e, "target", {
        configurable: true,
        value: node
      });
    }
    Object.defineProperty(e, "currentTarget", {
      configurable: true,
      get() {
        return node;
      }
    });
    while (node !== null) {
      const handler = node[key];
      if (handler) {
        const data = node[`${key}Data`];
        data !== undefined ? handler(data, e) : handler(e);
        if (e.cancelBubble) return;
      }
      node = node.host && node.host !== node && node.host instanceof Node ? node.host : node.parentNode;
    }
  }
  function insertExpression(parent, value, current, marker, unwrapArray) {
    while (typeof current === "function") current = current();
    if (value === current) return current;
    const t = typeof value,
          multi = marker !== undefined;
    parent = multi && current[0] && current[0].parentNode || parent;
    if (t === "string" || t === "number") {
      if (t === "number") value = value.toString();
      if (multi) {
        let node = current[0];
        if (node && node.nodeType === 3) {
          node.data = value;
        } else node = document.createTextNode(value);
        current = cleanChildren(parent, current, marker, node);
      } else {
        if (current !== "" && typeof current === "string") {
          current = parent.firstChild.data = value;
        } else current = parent.textContent = value;
      }
    } else if (value == null || t === "boolean") {
      current = cleanChildren(parent, current, marker);
    } else if (t === "function") {
      createRenderEffect(() => {
        let v = value();
        while (typeof v === "function") v = v();
        current = insertExpression(parent, v, current, marker);
      });
      return () => current;
    } else if (Array.isArray(value)) {
      const array = [];
      if (normalizeIncomingArray(array, value, unwrapArray)) {
        createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
        return () => current;
      }
      if (array.length === 0) {
        current = cleanChildren(parent, current, marker);
        if (multi) return current;
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, array, marker);
          } else reconcileArrays(parent, current, array);
        } else if (current == null || current === "") {
          appendNodes(parent, array);
        } else {
          reconcileArrays(parent, multi && current || [parent.firstChild], array);
        }
      }
      current = array;
    } else if (value instanceof Node) {
      if (Array.isArray(current)) {
        if (multi) return current = cleanChildren(parent, current, marker, value);
        cleanChildren(parent, current, null, value);
      } else if (current == null || current === "" || !parent.firstChild) {
        parent.appendChild(value);
      } else parent.replaceChild(value, parent.firstChild);
      current = value;
    } else ;
    return current;
  }
  function normalizeIncomingArray(normalized, array, unwrap) {
    let dynamic = false;
    for (let i = 0, len = array.length; i < len; i++) {
      let item = array[i],
          t;
      if (item instanceof Node) {
        normalized.push(item);
      } else if (item == null || item === true || item === false) ; else if (Array.isArray(item)) {
        dynamic = normalizeIncomingArray(normalized, item) || dynamic;
      } else if ((t = typeof item) === "string") {
        normalized.push(document.createTextNode(item));
      } else if (t === "function") {
        if (unwrap) {
          while (typeof item === "function") item = item();
          dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
        } else {
          normalized.push(item);
          dynamic = true;
        }
      } else normalized.push(document.createTextNode(item.toString()));
    }
    return dynamic;
  }
  function appendNodes(parent, array, marker) {
    for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
  }
  function cleanChildren(parent, current, marker, replacement) {
    if (marker === undefined) return parent.textContent = "";
    const node = replacement || document.createTextNode("");
    if (current.length) {
      let inserted = false;
      for (let i = current.length - 1; i >= 0; i--) {
        const el = current[i];
        if (node !== el) {
          const isParent = el.parentNode === parent;
          if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && parent.removeChild(el);
        } else inserted = true;
      }
    } else parent.insertBefore(node, marker);
    return [node];
  }

  const $RAW = Symbol("store-raw"),
        $NODE = Symbol("store-node"),
        $NAME = Symbol("store-name");
  function wrap$1(value, name) {
    let p = value[$PROXY];
    if (!p) {
      Object.defineProperty(value, $PROXY, {
        value: p = new Proxy(value, proxyTraps$1)
      });
      const keys = Object.keys(value),
            desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          const get = desc[prop].get.bind(p);
          Object.defineProperty(value, prop, {
            get
          });
        }
      }
    }
    return p;
  }
  function isWrappable(obj) {
    return obj != null && typeof obj === "object" && (!obj.__proto__ || obj.__proto__ === Object.prototype || Array.isArray(obj));
  }
  function unwrap(item, set = new Set()) {
    let result, unwrapped, v, prop;
    if (result = item != null && item[$RAW]) return result;
    if (!isWrappable(item) || set.has(item)) return item;
    if (Array.isArray(item)) {
      if (Object.isFrozen(item)) item = item.slice(0);else set.add(item);
      for (let i = 0, l = item.length; i < l; i++) {
        v = item[i];
        if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
      }
    } else {
      if (Object.isFrozen(item)) item = Object.assign({}, item);else set.add(item);
      const keys = Object.keys(item),
            desc = Object.getOwnPropertyDescriptors(item);
      for (let i = 0, l = keys.length; i < l; i++) {
        prop = keys[i];
        if (desc[prop].get) continue;
        v = item[prop];
        if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
      }
    }
    return item;
  }
  function getDataNodes(target) {
    let nodes = target[$NODE];
    if (!nodes) Object.defineProperty(target, $NODE, {
      value: nodes = {}
    });
    return nodes;
  }
  function proxyDescriptor(target, property) {
    const desc = Reflect.getOwnPropertyDescriptor(target, property);
    if (!desc || desc.get || property === $PROXY || property === $NODE || property === $NAME) return desc;
    delete desc.value;
    delete desc.writable;
    desc.get = () => target[$PROXY][property];
    return desc;
  }
  function createDataNode() {
    const [s, set] = createSignal(undefined, {
      equals: false
    });
    s.$ = set;
    return s;
  }
  const proxyTraps$1 = {
    get(target, property, receiver) {
      if (property === $RAW) return target;
      if (property === $PROXY) return receiver;
      const value = target[property];
      if (property === $NODE || property === "__proto__") return value;
      const wrappable = isWrappable(value);
      if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property))) {
        let nodes, node;
        if (wrappable && (nodes = getDataNodes(value))) {
          node = nodes._ || (nodes._ = createDataNode());
          node();
        }
        nodes = getDataNodes(target);
        node = nodes[property] || (nodes[property] = createDataNode());
        node();
      }
      return wrappable ? wrap$1(value) : value;
    },
    set() {
      return true;
    },
    deleteProperty() {
      return true;
    },
    getOwnPropertyDescriptor: proxyDescriptor
  };
  function setProperty(state, property, value) {
    if (state[property] === value) return;
    const array = Array.isArray(state);
    const len = state.length;
    const isUndefined = value === undefined;
    const notify = array || isUndefined === property in state;
    if (isUndefined) {
      delete state[property];
    } else state[property] = value;
    let nodes = getDataNodes(state),
        node;
    (node = nodes[property]) && node.$();
    if (array && state.length !== len) (node = nodes.length) && node.$(node, undefined);
    notify && (node = nodes._) && node.$(node, undefined);
  }
  function mergeStoreNode(state, value) {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      setProperty(state, key, value[key]);
    }
  }
  function updatePath(current, path, traversed = []) {
    let part,
        prev = current;
    if (path.length > 1) {
      part = path.shift();
      const partType = typeof part,
            isArray = Array.isArray(current);
      if (Array.isArray(part)) {
        for (let i = 0; i < part.length; i++) {
          updatePath(current, [part[i]].concat(path), [part[i]].concat(traversed));
        }
        return;
      } else if (isArray && partType === "function") {
        for (let i = 0; i < current.length; i++) {
          if (part(current[i], i)) updatePath(current, [i].concat(path), [i].concat(traversed));
        }
        return;
      } else if (isArray && partType === "object") {
        const {
          from = 0,
          to = current.length - 1,
          by = 1
        } = part;
        for (let i = from; i <= to; i += by) {
          updatePath(current, [i].concat(path), [i].concat(traversed));
        }
        return;
      } else if (path.length > 1) {
        updatePath(current[part], path, [part].concat(traversed));
        return;
      }
      prev = current[part];
      traversed = [part].concat(traversed);
    }
    let value = path[0];
    if (typeof value === "function") {
      value = value(prev, traversed);
      if (value === prev) return;
    }
    if (part === undefined && value == undefined) return;
    value = unwrap(value);
    if (part === undefined || isWrappable(prev) && isWrappable(value) && !Array.isArray(value)) {
      mergeStoreNode(prev, value);
    } else setProperty(current, part, value);
  }
  function createStore(store, options) {
    const unwrappedStore = unwrap(store || {});
    const wrappedStore = wrap$1(unwrappedStore);
    function setStore(...args) {
      batch(() => updatePath(unwrappedStore, args));
    }
    return [wrappedStore, setStore];
  }

  const _tmpl$ = template(`<section class="main"><input id="toggle-all" class="toggle-all" type="checkbox"><label for="toggle-all"></label><ul class="todo-list"></ul></section>`),
        _tmpl$2 = template(`<button class="clear-completed">Clear completed</button>`),
        _tmpl$3 = template(`<footer class="footer"><span class="todo-count"><strong></strong> <!> left</span><ul class="filters"><li><a href="#/">All</a></li><li><a href="#/active">Active</a></li><li><a href="#/completed">Completed</a></li></ul></footer>`),
        _tmpl$4 = template(`<section class="todoapp"><header class="header"><h1>todos</h1><input class="new-todo" placeholder="What needs to be done?"></header></section>`),
        _tmpl$5 = template(`<input class="edit">`),
        _tmpl$6 = template(`<li class="todo"><div class="view"><input class="toggle" type="checkbox"><label></label><button class="destroy"></button></div></li>`);
  const ESCAPE_KEY = 27;
  const ENTER_KEY = 13;

  const setFocus = el => setTimeout(() => el.focus());

  const LOCAL_STORAGE_KEY = "todos-solid";

  function createLocalStore(value) {
    // load stored todos on init
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY),
          [state, setState] = createStore(stored ? JSON.parse(stored) : value); // JSON.stringify creates deps on every iterable field

    createEffect(() => localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state)));
    return [state, setState];
  }

  const TodoApp = () => {
    const [state, setState] = createLocalStore({
      counter: 1,
      todos: [],
      showMode: "all",
      editingTodoId: null
    }),
          remainingCount = createMemo(() => state.todos.length - state.todos.filter(todo => todo.completed).length),
          filterList = todos => {
      if (state.showMode === "active") return todos.filter(todo => !todo.completed);else if (state.showMode === "completed") return todos.filter(todo => todo.completed);else return todos;
    },
          removeTodo = todoId => setState("todos", t => t.filter(item => item.id !== todoId)),
          editTodo = todo => setState("todos", item => item.id === todo.id, todo),
          clearCompleted = () => setState("todos", t => t.filter(todo => !todo.completed)),
          toggleAll = completed => setState("todos", todo => todo.completed !== completed, {
      completed
    }),
          setEditing = todoId => setState("editingTodoId", todoId),
          addTodo = ({
      target,
      keyCode
    }) => {
      const title = target.value.trim();

      if (keyCode === ENTER_KEY && title) {
        setState({
          todos: [{
            title,
            id: state.counter,
            completed: false
          }, ...state.todos],
          counter: state.counter + 1
        });
        target.value = "";
      }
    },
          save = (todoId, {
      target: {
        value
      }
    }) => {
      const title = value.trim();

      if (state.editingTodoId === todoId && title) {
        editTodo({
          id: todoId,
          title
        });
        setEditing();
      }
    },
          toggle = (todoId, {
      target: {
        checked
      }
    }) => editTodo({
      id: todoId,
      completed: checked
    }),
          doneEditing = (todoId, e) => {
      if (e.keyCode === ENTER_KEY) save(todoId, e);else if (e.keyCode === ESCAPE_KEY) setEditing();
    };

    const locationHandler = () => setState("showMode", location.hash.slice(2) || "all");

    window.addEventListener("hashchange", locationHandler);
    onCleanup(() => window.removeEventListener("hashchange", locationHandler));
    return (() => {
      const _el$ = _tmpl$4.cloneNode(true),
            _el$2 = _el$.firstChild,
            _el$3 = _el$2.firstChild,
            _el$4 = _el$3.nextSibling;

      _el$4.$$keydown = addTodo;

      insert(_el$, createComponent(Show, {
        get when() {
          return state.todos.length > 0;
        },

        get children() {
          return [(() => {
            const _el$5 = _tmpl$.cloneNode(true),
                  _el$6 = _el$5.firstChild,
                  _el$7 = _el$6.nextSibling,
                  _el$8 = _el$7.nextSibling;

            _el$6.$$input = ({
              target: {
                checked
              }
            }) => toggleAll(checked);

            insert(_el$8, createComponent(For, {
              get each() {
                return filterList(state.todos);
              },

              children: todo => (() => {
                const _el$23 = _tmpl$6.cloneNode(true),
                      _el$24 = _el$23.firstChild,
                      _el$25 = _el$24.firstChild,
                      _el$26 = _el$25.nextSibling,
                      _el$27 = _el$26.nextSibling;

                _el$25.$$input = toggle;
                _el$25.$$inputData = todo.id;
                _el$26.$$dblclick = setEditing;
                _el$26.$$dblclickData = todo.id;

                insert(_el$26, () => todo.title);

                _el$27.$$click = removeTodo;
                _el$27.$$clickData = todo.id;

                insert(_el$23, createComponent(Show, {
                  get when() {
                    return state.editingTodoId === todo.id;
                  },

                  get children() {
                    const _el$28 = _tmpl$5.cloneNode(true);

                    setFocus(_el$28);
                    _el$28.$$keyup = doneEditing;
                    _el$28.$$keyupData = todo.id;
                    _el$28.$$focusout = save;
                    _el$28.$$focusoutData = todo.id;

                    createRenderEffect(() => _el$28.value = todo.title);

                    return _el$28;
                  }

                }), null);

                createRenderEffect(_p$ => {
                  const _v$4 = state.editingTodoId === todo.id,
                        _v$5 = todo.completed,
                        _v$6 = todo.completed;

                  _v$4 !== _p$._v$4 && _el$23.classList.toggle("editing", _p$._v$4 = _v$4);
                  _v$5 !== _p$._v$5 && _el$23.classList.toggle("completed", _p$._v$5 = _v$5);
                  _v$6 !== _p$._v$6 && (_el$25.checked = _p$._v$6 = _v$6);
                  return _p$;
                }, {
                  _v$4: undefined,
                  _v$5: undefined,
                  _v$6: undefined
                });

                return _el$23;
              })()
            }));

            createRenderEffect(() => _el$6.checked = !remainingCount());

            return _el$5;
          })(), (() => {
            const _el$9 = _tmpl$3.cloneNode(true),
                  _el$10 = _el$9.firstChild,
                  _el$11 = _el$10.firstChild,
                  _el$12 = _el$11.nextSibling,
                  _el$14 = _el$12.nextSibling;
                  _el$14.nextSibling;
                  const _el$15 = _el$10.nextSibling,
                  _el$16 = _el$15.firstChild,
                  _el$17 = _el$16.firstChild,
                  _el$18 = _el$16.nextSibling,
                  _el$19 = _el$18.firstChild,
                  _el$20 = _el$18.nextSibling,
                  _el$21 = _el$20.firstChild;

            insert(_el$11, remainingCount);

            insert(_el$10, () => remainingCount() === 1 ? " item " : " items ", _el$14);

            insert(_el$9, createComponent(Show, {
              get when() {
                return remainingCount() !== state.todos.length;
              },

              get children() {
                const _el$22 = _tmpl$2.cloneNode(true);

                _el$22.$$click = clearCompleted;
                return _el$22;
              }

            }), null);

            createRenderEffect(_p$ => {
              const _v$ = state.showMode === "all",
                    _v$2 = state.showMode === "active",
                    _v$3 = state.showMode === "completed";

              _v$ !== _p$._v$ && _el$17.classList.toggle("selected", _p$._v$ = _v$);
              _v$2 !== _p$._v$2 && _el$19.classList.toggle("selected", _p$._v$2 = _v$2);
              _v$3 !== _p$._v$3 && _el$21.classList.toggle("selected", _p$._v$3 = _v$3);
              return _p$;
            }, {
              _v$: undefined,
              _v$2: undefined,
              _v$3: undefined
            });

            return _el$9;
          })()];
        }

      }), null);

      return _el$;
    })();
  };

  render(TodoApp, document.getElementById("main"));

  delegateEvents(["keydown", "input", "click", "dblclick", "focusout", "keyup"]);

}());

# Visitor 设计文档

本文档梳理 `src/deobfuscate.js` 中 5 个 Babel `Visitor` 的设计思路、适用场景和局限。每个 visitor 对应一类 Webpack 风格 JavaScript 混淆器常见的混淆模式。

阅读本文档前建议先了解 Babel 的核心概念:
- **AST (Abstract Syntax Tree)**:源码经 `@babel/parser` 解析后的语法树。
- **Visitor**:遍历 AST 时按节点类型触发的回调对象,形如 `{ MemberExpression(path) {...} }`。
- **Path**:对节点的有状态封装,提供 `replaceWith` / `remove` / `getBinding` 等操作。
- **Binding**:作用域中标识符的绑定信息,包含所有引用路径,可用于判断变量是否被使用。

---

## Visitor 1:字符串数组还原

**匹配模式**

```js
const decrypt = require('./descrypt.js');
const { n, e, r } = decrypt;   // n / e / r 是字符串/数字/布尔数组

// 业务代码处处看到这种引用:
foo(n[0], e[3]);               // 实际语义: foo('add', 16)
```

**触发条件**

节点是 `MemberExpression`,且:
1. `object` 是 `Identifier`,且名字在字符串数组模块的导出 key 中(`n` / `e` / `r`)。
2. `property` 是 `NumericLiteral`。

**处理动作**

到运行时模块中查找 `decrypt[objectName][index]` 的实际值,按类型替换为 `StringLiteral` / `NumericLiteral` / `BooleanLiteral`。

**为什么需要 `path.skip()`**

防止替换出的 `StringLiteral` 节点被父级 `MemberExpression` 重新遍历进入死循环。

**局限**

仅支持静态下标。若混淆器把下标也表达式化(例如 `n[idx + 3]`),需要先做常量传播再启用本 visitor。

---

## Visitor 2:switch 控制流扁平化恢复

**匹配模式**

```js
for (var orderArray = [0, 2, 1], idx = 0; idx < orderArray.length; idx++) {
    switch (orderArray[idx]) {
        case 0: stmtA(); continue;
        case 1: stmtB(); continue;
        case 2: stmtC(); continue;
    }
}
```

这是混淆器最常见的控制流隐藏手法:把顺序代码拆成 case 分支,执行顺序由 `orderArray` 决定,静态阅读时几乎看不出谁先谁后。

**还原结果**

按 `orderArray` 元素顺序展开为 BlockStatement:

```js
{
    stmtA();    // orderArray[0] = 0 -> case 0
    stmtC();    // orderArray[1] = 2 -> case 2
    stmtB();    // orderArray[2] = 1 -> case 1
}
```

**实现要点**

1. **识别 orderArray 与 indexVariable**:遍历 `init` 的 declarations,把 `ArrayExpression` 类型当作 orderArray,`NumericLiteral` 当作起始下标。
2. **建立 case 字典 `temp2`**:`temp2[caseValue] = caseConsequent[0]`,跳过 `ContinueStatement` 作为分隔。
3. **按 orderArray 顺序输出**:对每个元素查 `temp2`,组装成新的语句序列。
4. **支持两种声明形式**:
   - orderArray 与 idx 同在 `for` 的 init(标准形式)。
   - orderArray 声明在 `for` 的兄弟节点(扩展形式)。

**局限**

- 只支持 `case` 的 `consequent` 第一条非 continue 语句为目标语句的简单形式。
- 嵌套的控制流扁平化需要递归调用 visitor2。
- 混淆器若引入"假 case"(永不被命中的分支),需要在 visitor2 之前做静态执行排除。

---

## Visitor 3:数组 `join` 字面量合并

**匹配模式**

```js
['c', 'a', 'l', 'c'].join('')          // -> 'calc'
['user', userId, 'session'].join('|')  // 元素含变量时,若变量是常量绑定也能解析
```

**触发条件**

`CallExpression`,且:
1. callee 是 `MemberExpression`,property 名 `join`,object 是 `ArrayExpression`。
2. 数组元素全部为 `StringLiteral`,或绑定到 `StringLiteral` 初始值的 `Identifier`。

**处理动作**

在 JS 层手工 `join`,替换原 `CallExpression` 为单一 `StringLiteral`。

**为什么需要查 binding**

混淆器有时会把字符串拆分到独立的常量声明里:

```js
var part1 = 'cal';
var part2 = 'c';
[part1, part2].join('');     // -> 'calc'
```

通过 `path.scope.getBinding(name)` 拿到声明节点,如果初始化值是字面量,就当作可替换元素;否则保守不动。

**局限**

- 不处理 `.concat()` / 模板字面量这类等价模式(可作为扩展点)。
- 元素是函数调用结果时,需先跑 visitor5(内联解码函数)再回头处理。

---

## Visitor 4:无引用字符串变量清理

**匹配模式**

```js
var _decoy = "noise_xxx";   // 声明后从未被读/写
```

**触发条件**

`VariableDeclarator`,且:
1. `id` 是 `Identifier`(不处理解构)。
2. `init` 是 `StringLiteral`。
3. 通过 `path.scope.getBinding(name)`:
   - `binding.referencePaths.length === 0`(无读引用)。
   - `binding.constantViolations.length === 0`(无重新赋值)。

**处理动作**

直接 `path.remove()`。

**为什么必须在 visitor1 / 2 / 3 之后跑**

混淆器注入的"噪声字符串"经常被混到主逻辑里使用,只有在前几个 visitor 把字符串数组还原、控制流恢复之后,才能准确判断哪些变量真的没被引用。`deobfuscate.js` 在跑 visitor4 之前会先 `generator(ast).code` -> 重新 `parse`,目的是刷新 Babel 的作用域绑定缓存。

**局限**

- 只清理 `string` 类型;扩展到 `number` / `boolean` 一行加判断即可。
- 不清理无副作用的函数声明 —— 那是 visitor5 的工作。

---

## Visitor 5:内联十六进制 / 异或解码函数

**匹配模式**

```js
function _h2s(t) {
    if (!t) return "";
    var o = [];
    t = t.split(",");
    for (var i = 0; i < t.length; i++) {
        o.push(String.fromCharCode(parseInt(t[i], 16)));
    }
    return o.join("");
}

_h2s("65,78,70,6f,72,74,73");    // -> 'exports'
```

或异或变种:

```js
function decode(r) {
    if (!r) return '';
    for (var t = '', o = 57805, i = 0; i < r.length; i++) {
        var a = r.charCodeAt(i), c = a ^ o;
        o = a;
        t += String.fromCharCode(c);
    }
    return t;
}
```

**触发条件**

`CallExpression`,callee 是 `Identifier`,参数恰好一个 `StringLiteral`,且 `callee` 绑定到 `FunctionDeclaration`。

**处理动作**

1. 用正则提取目标函数的形参名和函数体源码字符串。
2. **结构判断**:函数体必须含 (`split(",")` + `parseInt` + `String.fromCharCode`) 或 (`charCodeAt` + `^` + `String.fromCharCode`),否则跳过 —— 避免把业务函数误当解码器。
3. `new Function(paramName, funcBody)` 在沙箱里执行,拿到解码结果。
4. 替换 `CallExpression` 为 `StringLiteral(result)`。
5. 若该函数当前只剩这一处引用(`binding.referencePaths.length === 1`),顺手删除函数定义。

**关于 `new Function` 的安全性**

混淆器投放的解码函数通常是纯函数,但执行任意第三方代码原则上有风险。生产场景建议用 `vm.runInNewContext` 加超时和资源限制,或换成 AST 层的纯静态解释器。

**局限**

- 仅处理单参数、字面量输入的"无状态"解码;多参数或带闭包状态的解码需要更复杂的执行模型。
- 一个解码函数被多处调用时,只有最后一处替换前 `binding.referencePaths.length === 1` 才会触发函数定义删除。可改为先全部替换、再扫一遍未引用的 FunctionDeclaration 统一删除。

---

## 执行顺序与作用域刷新

`src/deobfuscate.js` 主流程:

```text
parse(encode.js)
  -> visitor1   字符串数组还原
  -> visitor2   switch 控制流恢复
  -> visitor3   join 字面量合并
  -> generator -> 重新 parse        # 刷新作用域绑定
  -> visitor4   无引用变量清理
  -> visitor5   内联解码函数
write(decode.js)
```

**为什么中途要 `generator -> parse` 一次**

Babel 的 `path.scope.getBinding(name).referencePaths` 是构建作用域时建立的,后续 `replaceWith` / `remove` 并不会自动更新引用计数。当 visitor1 把所有 `n[0]` / `e[3]` 替换为字面量后,原本 `n` / `e` / `r` 这些标识符的引用数应当为 0,但 Babel 不会感知到。把代码 print 出来再重新 parse 一次,作用域信息就同步了 —— 这是常见的工程化技巧。

---

## 扩展思路

如果要把这个 lab 继续推进,几个有意思的方向:

1. **常量传播 / 折叠**:把数学表达式 `0x123 + 0x456` 静态求值,合并 `'a' + 'b'` 等价的二元字符串拼接。
2. **死代码消除**:基于活跃变量分析删除整段无副作用的逻辑。
3. **变量重命名**:用类型推断或上下文,把 `_0xabc123` 这种乱码名重命名成有语义的名字。
4. **CFG 重建**:把 switch-CFF + dispatcher 模式的控制流图重建为可读的 if/while。
5. **AST diff 可视化**:对照混淆前后的 AST 节点变化,做 web 端的可视化教学工具。

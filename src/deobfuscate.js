/**
 * 基于 Babel AST 的 JavaScript 反混淆工具
 *
 * 处理以下混淆模式:
 *   1. 字符串数组模块引用:  arr[index]  ->  原始字符串/数字/布尔
 *   2. switch 控制流扁平化:  for + switch(orderArray) -> 顺序执行的 BlockStatement
 *   3. Array.prototype.join 字面量合并:  ['a','b'].join('|') -> 'a|b'
 *   4. 无引用变量清理:  未被使用的字符串声明节点移除
 *   5. 内联十六进制/异或解码函数:  decode("65,78") -> "ex" 并删除函数定义
 *
 * 用法:
 *   node src/deobfuscate.js <input.js> <output.js> <string-array-module.js>
 *
 *   默认输入: examples/obfuscated/encode.js
 *   默认字符串数组模块: examples/obfuscated/descrypt.js
 *   默认输出: examples/deobfuscated/decode.js
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
globalThis.generator = require('@babel/generator').default;

// ---------- CLI 参数 ----------
const ROOT = path.resolve(__dirname, '..');
const encode_file = process.argv[2] || path.join(ROOT, 'examples/obfuscated/encode.js');
const decode_file = process.argv[3] || path.join(ROOT, 'examples/deobfuscated/decode.js');
const decrypt_path = process.argv[4] || path.join(ROOT, 'examples/obfuscated/descrypt.js');

// 加载字符串数组模块 (require 进来后是 {n: [...], e: [...], r: [...]} 这种结构)
const decrypt = require(decrypt_path);

let js_code = fs.readFileSync(encode_file, { encoding: 'utf-8' });

console.log('开始解析混淆代码...');
let ast = parser.parse(js_code);

// ============================================================
// visitor1: 字符串数组还原
// ------------------------------------------------------------
// 在 Webpack 风格的混淆中,字符串常被抽到独立的数组模块里,业务代码通过
//   n[3] / e[10] / r[0]  这类 MemberExpression 引用。
// 该 visitor 把这类引用替换回原始字面量。
// ============================================================
const visitor1 = {
    MemberExpression(path) {
        if (
            Object.keys(decrypt).includes(path.get('object').toString()) &&
            path.get('object').isIdentifier() &&
            path.get('property').isNumericLiteral()
        ) {
            const str = decrypt[path.get('object').toString()][path.get('property').toString()];
            if (typeof str === 'string') {
                path.replaceWith(t.StringLiteral(str));
                path.skip();
            } else if (typeof str === 'number') {
                path.replaceWith(t.NumericLiteral(str));
                path.skip();
            } else if (typeof str === 'boolean') {
                path.replaceWith(t.BooleanLiteral(str));
                path.skip();
            }
        }
    },
};

// ============================================================
// visitor2: switch 控制流扁平化恢复
// ------------------------------------------------------------
// 混淆器常用模式: 用一个 orderArray 数组定义实际执行顺序,然后用
//   for (...) switch(orderArray[i]) { case 0: ... case 1: ... }
// 把顺序代码打散。本 visitor 按 orderArray 顺序还原 BlockStatement。
// ============================================================
const temp2 = {};
const visitor2 = {
    ForStatement(path) {
        if (!t.isSwitchStatement(path.get('body.body')[0])) return;

        if (t.isVariableDeclaration(path.get('init'))) {
            // 形式 1: for(var arr=[...], i=0; ...) switch(arr[i]) {...}
            const cases = path.get('body.body')[0].get('cases');
            for (const cas of cases) {
                const test = cas.get('test').node.value;
                const consts = cas.get('consequent');
                if (!consts[0].isContinueStatement()) {
                    temp2[test] = consts[0].node;
                }
            }

            let orderArray;
            const initDeclarations = path.get('init').get('declarations');
            for (const decl of initDeclarations) {
                if (decl.get('init').isArrayExpression()) {
                    orderArray = decl.get('init');
                }
            }

            const block = [];
            if (!orderArray || !t.isArrayExpression(orderArray)) return;
            for (const bloc of orderArray.get('elements')) {
                block.push(temp2[bloc.node.value]);
            }
            path.replaceWith(t.blockStatement(block));
        } else {
            // 形式 2: orderArray 声明在 for 的兄弟节点里
            const cases = path.get('body.body')[0].get('cases');
            for (const cas of cases) {
                const test = cas.get('test').node.value;
                const consts = cas.get('consequent');
                if (!consts[0].isContinueStatement()) {
                    temp2[test] = consts[0].node;
                }
            }
            const orderArray = path.parentPath.get('body')[0].get('declarations')[0].get('init');
            if (!t.isArrayExpression(orderArray)) return;
            const block = [];
            for (const bloc of orderArray.get('elements')) {
                block.push(temp2[bloc.node.value]);
            }
            path.parentPath.replaceWith(t.blockStatement(block));
        }
    },
};

// ============================================================
// visitor3: Array.prototype.join 字面量合并
// ------------------------------------------------------------
// ["a","b","c"].join("")  ->  "abc"
// 在混淆中常用于把一个完整字符串拆成多个小片段以躲避静态扫描。
// 支持元素是字面量或可静态求值的常量绑定。
// ============================================================
const visitor3 = {
    CallExpression(path) {
        if (
            path.get('callee').isMemberExpression() &&
            path.get('callee.property').isIdentifier({ name: 'join' }) &&
            path.get('callee.object').isArrayExpression()
        ) {
            const arrayExpression = path.get('callee.object');
            const sepValue = path.get('arguments')[0].node.value;
            const elements = arrayExpression.get('elements');
            const elementValues = [];
            let canResolve = true;
            for (const element of elements) {
                if (element.isStringLiteral()) {
                    elementValues.push(element.node.value);
                } else if (element.isIdentifier()) {
                    // 元素是变量时,尝试拿到绑定的常量值
                    const binding = path.scope.getBinding(element.node.name);
                    if (
                        binding &&
                        binding.path.isVariableDeclarator() &&
                        binding.path.get('init').isStringLiteral()
                    ) {
                        elementValues.push(binding.path.get('init').node.value);
                    } else {
                        canResolve = false;
                        break;
                    }
                } else {
                    canResolve = false;
                    break;
                }
            }
            if (canResolve && elementValues.length > 0) {
                path.replaceWith(t.stringLiteral(elementValues.join(sepValue)));
            }
        }
    },
};

// ============================================================
// visitor4: 无引用字符串变量清理
// ------------------------------------------------------------
// 混淆器会注入大量假变量做"噪声",此处统一删除从未被读取/修改的
// 字符串声明,缩小代码体积、提升可读性。
// ============================================================
const visitor4 = {
    VariableDeclarator(path) {
        if (path.get('id').isIdentifier() && path.get('init').isStringLiteral()) {
            const name = path.get('id').node.name;
            const binding = path.scope.getBinding(name);
            if (
                binding &&
                binding.referencePaths.length === 0 &&
                binding.constantViolations.length === 0
            ) {
                path.remove();
            }
        }
    },
};

// ============================================================
// visitor5: 内联十六进制/异或解码函数调用
// ------------------------------------------------------------
// 形如  decode("65,78,70,6f,72,74,73")  -> "exports"
// 思路: 通过 new Function 在沙箱里执行解码函数,把结果作为字符串字面量
// 替换原调用。若该函数只剩这一处调用,顺手删除函数定义。
// ============================================================
const visitor5 = {
    CallExpression(path) {
        const callee = path.get('callee');
        const args = path.get('arguments');
        if (callee.isIdentifier() && args.length === 1 && args[0].isStringLiteral()) {
            const functionName = callee.node.name;
            const argValue = args[0].node.value;
            const binding = path.scope.getBinding(functionName);
            if (binding && binding.path.isFunctionDeclaration()) {
                const funcPath = binding.path;
                const decodedValue = tryDecodeHexString(argValue, funcPath);
                if (decodedValue !== null) {
                    path.replaceWith(t.stringLiteral(decodedValue));
                    console.log(`内联 ${functionName}("${argValue}") -> "${decodedValue}"`);
                    if (binding.referencePaths.length === 1) {
                        console.log(`函数 ${functionName} 仅一处引用,删除定义`);
                        funcPath.remove();
                    }
                }
            }
        }
    },
};

function tryDecodeHexString(hexString, funcPath) {
    const func = funcPath.toString();
    const funcMatch = func.match(/function\s+(\w+)\((\w+)\)\s*{([\s\S]*)}/);
    if (!funcMatch) {
        console.log('无法解析函数格式');
        return null;
    }
    const paramName = funcMatch[2];
    const funcBody = funcMatch[3];
    // 仅对结构匹配的"纯解码器"执行,避免误伤业务函数
    if (
        (funcBody.includes('split(",")') &&
            funcBody.includes('parseInt') &&
            funcBody.includes('String.fromCharCode')) ||
        (funcBody.includes('charCodeAt') &&
            funcBody.includes('^') &&
            funcBody.includes('String.fromCharCode'))
    ) {
        const decodeFunc = new Function(paramName, funcBody);
        return decodeFunc(hexString);
    }
    return null;
}

// ============================================================
// 主流程
// ============================================================
traverse(ast, visitor1);                       // 1. 字符串数组还原
traverse(ast, visitor2);                       // 2. switch 控制流恢复
traverse(ast, visitor3);                       // 3. join 字面量合并

const intermediateCode = generator(ast).code;  // 重新生成,刷新作用域绑定
ast = parser.parse(intermediateCode);

traverse(ast, visitor4);                       // 4. 无引用字符串删除
traverse(ast, visitor5);                       // 5. 内联解码函数

const { code } = generator(ast);
fs.writeFileSync(decode_file, code);
console.log(`\n反混淆完成 -> ${decode_file}`);

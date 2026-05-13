/**
 * 合成混淆样本 (synthetic)
 * ============================================================
 * 本文件用于演示反混淆工具能处理的 5 类常见模式,代码完全自造,
 * 不来自任何真实生产项目。
 *
 *   Pattern 1: 字符串数组模块引用       (n[0] / e[3] / r[2])
 *   Pattern 2: switch 控制流扁平化       (for + switch on orderArray)
 *   Pattern 3: 数组 join 字面量拼接       (['a','b'].join('|'))
 *   Pattern 4: 无引用字符串噪声变量       (visitor4 会清理)
 *   Pattern 5: 内联十六进制解码函数       (visitor5 会替换并删除)
 *
 * 还原后等价代码:
 *
 *   function calc(op, x, y) {
 *       var tag = 'calc|demo';
 *       var result;
 *       result = x + y;
 *       result = result + 1;
 *       result = result * 2;
 *       var label = 'done';
 *       switch (op) {
 *           case 'add':      return result + tag + label;
 *           case 'sub':      return x - y;
 *           case 'multiply': return x * y;
 *           default:         return 'unknown op';
 *       }
 *   }
 *   module.exports = { calc: calc };
 */

const decrypt = require('./descrypt.js');
const { n, e, r } = decrypt;

// === Pattern 4: 无引用字符串噪声变量 ===
var _decoy_alpha = "noise_a_0xff";
var _decoy_beta = "noise_b_0xee";
var _decoy_gamma = "noise_c_0xdd";

// === Pattern 5: 十六进制解码函数 ===
function _h2s(t) {
    if (!t) return "";
    var o = [];
    t = t.split(",");
    for (var i = 0; i < t.length; i++) {
        o.push(String.fromCharCode(parseInt(t[i], 16)));
    }
    return o.join("");
}

function calc(op, x, y) {
    // === Pattern 3: 数组 join 字面量拼接 ===
    var tag = ["calc", "demo"].join(e[4]);            // 'calc' + '|' + 'demo'

    var result;

    // === Pattern 2: switch 控制流扁平化 ===
    // orderArray = [0, 2, 1] 表示按 case 0 -> case 2 -> case 1 顺序执行
    for (var orderArray = [r[0], r[2], r[1]], idx = r[0]; idx < orderArray[e[1]]; idx++) {
        switch (orderArray[idx]) {
            case 0:
                result = x + y;
                continue;
            case 1:
                result = result * r[2];
                continue;
            case 2:
                result = result + r[1];
                continue;
        }
    }

    // === Pattern 5 用法: 调用解码函数 ===
    var label = _h2s("64,6f,6e,65");                  // 'done'

    // === Pattern 1: 字符串数组直接引用 ===
    switch (op) {
        case n[0]:                                    // 'add'
            return result + tag + label;
        case n[1]:                                    // 'sub'
            return x - y;
        case n[2]:                                    // 'multiply'
            return x * y;
        default:
            return n[3];                              // 'unknown op'
    }
}

module[e[0]] = { calc: calc };                        // module['exports']
